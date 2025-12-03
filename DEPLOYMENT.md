# Production Deployment Guide

## Prerequisites

- Node.js 18+
- Dedicated Solana RPC endpoint (Helius, QuickNode, Alchemy, etc.)
- PostgreSQL database (recommended for production)
- Server with at least 2GB RAM

## 1. Server Setup

### Install Dependencies

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Node.js 18
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install PostgreSQL (optional)
sudo apt install postgresql postgresql-contrib -y

# Install PM2 for process management
sudo npm install -g pm2
```

## 2. Application Setup

### Clone and Build

```bash
# Clone repository
git clone <your-repo-url>
cd solana-prediction-market-aggregator

# Install dependencies
npm ci --only=production

# Build TypeScript
npm run build
```

### Configure Environment

Create production `.env` file:

```bash
# Use your dedicated RPC endpoints
SOLANA_RPC_HTTP=https://your-dedicated-rpc.helius-rpc.com/?api-key=YOUR_KEY
SOLANA_RPC_WS=wss://your-dedicated-rpc.helius-rpc.com/?api-key=YOUR_KEY

# PostgreSQL connection (recommended)
DATABASE_TYPE=postgres
DATABASE_PATH=postgres://user:password@localhost:5432/prediction_markets

# Or SQLite for smaller deployments
# DATABASE_TYPE=sqlite
# DATABASE_PATH=/var/lib/solana-markets/markets.db

# API Configuration
PORT=3000
HOST=0.0.0.0
API_RATE_LIMIT=500

# Indexer tuning
INDEXER_ENABLED=true
INDEXER_BATCH_SIZE=100
INDEXER_POLL_INTERVAL=5000

# Logging
LOG_LEVEL=info
LOG_PRETTY=false

# Program IDs to index
PROGRAM_IDS=SW1TCHw1TCH7qNvdvZzTA1jjCbqRX7w9QHfxhWUq6xfU,HXroKJzRNV3GJxaNS5rCZRUUYFAqqCjYnA9NKCkQ8gJ8
```

### Database Setup

For PostgreSQL:

```bash
# Create database
sudo -u postgres psql
CREATE DATABASE prediction_markets;
CREATE USER solana_user WITH PASSWORD 'secure_password';
GRANT ALL PRIVILEGES ON DATABASE prediction_markets TO solana_user;
\q

# Run migrations
npm run db:migrate
```

For SQLite:

```bash
# Create data directory
sudo mkdir -p /var/lib/solana-markets
sudo chown $USER:$USER /var/lib/solana-markets

# Run migrations
npm run db:migrate
```

## 3. Process Management with PM2

### Start Application

```bash
# Start with PM2
pm2 start dist/index.js --name solana-markets

# Save PM2 configuration
pm2 save

# Setup PM2 to start on boot
pm2 startup
```

### PM2 Configuration File

Create `ecosystem.config.js`:

```javascript
module.exports = {
  apps: [{
    name: 'solana-markets',
    script: './dist/index.js',
    instances: 1,
    exec_mode: 'fork',
    max_memory_restart: '2G',
    env: {
      NODE_ENV: 'production',
    },
    error_file: './logs/err.log',
    out_file: './logs/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    autorestart: true,
    max_restarts: 10,
    min_uptime: '10s',
  }],
};
```

Start with config:

```bash
pm2 start ecosystem.config.js
```

### PM2 Commands

```bash
# View logs
pm2 logs solana-markets

# Monitor
pm2 monit

# Restart
pm2 restart solana-markets

# Stop
pm2 stop solana-markets

# View status
pm2 status
```

## 4. Nginx Reverse Proxy

### Install Nginx

```bash
sudo apt install nginx -y
```

### Configure Nginx

Create `/etc/nginx/sites-available/solana-markets`:

```nginx
# HTTP -> HTTPS redirect
server {
    listen 80;
    server_name your-domain.com;
    return 301 https://$server_name$request_uri;
}

# HTTPS configuration
server {
    listen 443 ssl http2;
    server_name your-domain.com;

    # SSL certificates (use Let's Encrypt)
    ssl_certificate /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;

    # Security headers
    add_header Strict-Transport-Security "max-age=31536000" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;

    # API endpoints
    location /api/ {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # WebSocket endpoint
    location /ws {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 86400;
    }

    # Rate limiting
    limit_req_zone $binary_remote_addr zone=api_limit:10m rate=100r/m;
    limit_req zone=api_limit burst=20 nodelay;
}
```

Enable site:

```bash
sudo ln -s /etc/nginx/sites-available/solana-markets /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

### SSL with Let's Encrypt

```bash
# Install certbot
sudo apt install certbot python3-certbot-nginx -y

# Get certificate
sudo certbot --nginx -d your-domain.com

# Auto-renewal is configured by default
sudo systemctl status certbot.timer
```

## 5. Monitoring

### Setup Logging

```bash
# Create log directory
mkdir -p logs

# Rotate logs with logrotate
sudo nano /etc/logrotate.d/solana-markets
```

Add:

```
/path/to/app/logs/*.log {
    daily
    rotate 14
    compress
    delaycompress
    missingok
    notifempty
    create 0644 user user
}
```

### Health Monitoring

Create a monitoring script `monitor.sh`:

```bash
#!/bin/bash

HEALTH_URL="http://localhost:3000/api/health"
SLACK_WEBHOOK="your-slack-webhook-url"

response=$(curl -s -o /dev/null -w "%{http_code}" $HEALTH_URL)

if [ $response -ne 200 ]; then
    message="🚨 Alert: Solana Markets API is down (HTTP $response)"
    curl -X POST -H 'Content-type: application/json' \
        --data "{\"text\":\"$message\"}" \
        $SLACK_WEBHOOK
fi
```

Add to crontab:

```bash
crontab -e
# Add: */5 * * * * /path/to/monitor.sh
```

## 6. Backup Strategy

### Database Backups

For PostgreSQL:

```bash
#!/bin/bash
# backup.sh

BACKUP_DIR="/backups/solana-markets"
DATE=$(date +%Y%m%d_%H%M%S)

mkdir -p $BACKUP_DIR

pg_dump prediction_markets | gzip > $BACKUP_DIR/backup_$DATE.sql.gz

# Keep only last 7 days
find $BACKUP_DIR -name "backup_*.sql.gz" -mtime +7 -delete
```

For SQLite:

```bash
#!/bin/bash
BACKUP_DIR="/backups/solana-markets"
DATE=$(date +%Y%m%d_%H%M%S)

mkdir -p $BACKUP_DIR

sqlite3 /var/lib/solana-markets/markets.db ".backup '$BACKUP_DIR/backup_$DATE.db'"
gzip $BACKUP_DIR/backup_$DATE.db

find $BACKUP_DIR -name "backup_*.db.gz" -mtime +7 -delete
```

Add to crontab for daily backups:

```bash
0 2 * * * /path/to/backup.sh
```

## 7. Performance Tuning

### PostgreSQL Configuration

Edit `/etc/postgresql/14/main/postgresql.conf`:

```conf
# Memory
shared_buffers = 256MB
effective_cache_size = 1GB
work_mem = 4MB
maintenance_work_mem = 64MB

# Connections
max_connections = 100

# Checkpoints
checkpoint_completion_target = 0.9
wal_buffers = 16MB

# Performance
random_page_cost = 1.1
effective_io_concurrency = 200
```

Restart PostgreSQL:

```bash
sudo systemctl restart postgresql
```

### Application Tuning

Adjust `.env` based on your RPC limits:

```env
# Higher batch size for premium RPCs
INDEXER_BATCH_SIZE=200

# Faster polling for premium RPCs
INDEXER_POLL_INTERVAL=2000

# Higher rate limits for production
API_RATE_LIMIT=1000
```

## 8. Security Checklist

- [ ] Use dedicated RPC endpoints (not public)
- [ ] Enable firewall (only ports 80, 443, 22)
- [ ] Use strong database passwords
- [ ] Enable SSL/TLS
- [ ] Configure rate limiting
- [ ] Regular security updates
- [ ] Backup encryption
- [ ] Monitor logs for suspicious activity
- [ ] Use environment variables (never commit secrets)
- [ ] Enable fail2ban for SSH

## 9. Docker Deployment (Alternative)

### Dockerfile

```dockerfile
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY dist ./dist
COPY .env ./

EXPOSE 3000

CMD ["node", "dist/index.js"]
```

### Docker Compose

```yaml
version: '3.8'

services:
  app:
    build: .
    ports:
      - "3000:3000"
    environment:
      - DATABASE_TYPE=postgres
      - DATABASE_PATH=postgres://user:pass@db:5432/markets
    depends_on:
      - db
    restart: unless-stopped

  db:
    image: postgres:14-alpine
    environment:
      POSTGRES_DB: markets
      POSTGRES_USER: user
      POSTGRES_PASSWORD: pass
    volumes:
      - pgdata:/var/lib/postgresql/data
    restart: unless-stopped

volumes:
  pgdata:
```

Deploy:

```bash
docker-compose up -d
```

## 10. Maintenance

### Regular Tasks

```bash
# Update application
git pull
npm ci --only=production
npm run build
pm2 restart solana-markets

# Vacuum database (PostgreSQL)
psql prediction_markets -c "VACUUM ANALYZE;"

# Check disk space
df -h

# View system resources
htop

# Check application health
curl http://localhost:3000/api/health | jq
```

### Troubleshooting

```bash
# View application logs
pm2 logs solana-markets --lines 100

# Check database connections
psql prediction_markets -c "SELECT count(*) FROM pg_stat_activity;"

# Test RPC connection
curl -X POST -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' \
  $SOLANA_RPC_HTTP

# Monitor WebSocket connections
pm2 monit
```

## Support

For production issues:
- Check logs: `pm2 logs`
- Monitor resources: `pm2 monit`
- Health endpoint: `/api/health`
- Database status: Check connection pool

