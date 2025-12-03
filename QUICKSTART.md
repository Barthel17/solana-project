# Quick Start Guide

## Installation

```bash
npm install
```

## Configuration

1. Copy the example environment file:
```bash
cp .env.example .env
```

2. Edit `.env` to configure your RPC endpoints and program IDs:
```bash
# Use your own RPC endpoints for better performance
SOLANA_RPC_HTTP=https://your-rpc-endpoint.com
SOLANA_RPC_WS=wss://your-rpc-endpoint.com

# Add program IDs you want to index
PROGRAM_IDS=SW1TCHw1TCH7qNvdvZzTA1jjCbqRX7w9QHfxhWUq6xfU,HXroKJzRNV3GJxaNS5rCZRUUYFAqqCjYnA9NKCkQ8gJ8
```

## Database Setup

Initialize the database:
```bash
npm run db:migrate
```

This creates the SQLite database at `./data/markets.db` with all required tables.

## Running the Application

### Development Mode (with hot reload)
```bash
npm run dev
```

### Production Mode
```bash
npm run build
npm start
```

## Testing the API

Once the server is running, test the endpoints:

### Health Check
```bash
curl http://localhost:3000/api/health
```

### Get All Markets
```bash
curl http://localhost:3000/api/markets
```

### Get Specific Market
```bash
curl http://localhost:3000/api/markets/{MARKET_ID}
```

### WebSocket Connection

```javascript
const ws = new WebSocket('ws://localhost:3000/ws');

ws.onopen = () => {
  console.log('Connected to market data stream');
};

ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  console.log('Received:', message);
};
```

## Adding Custom Program Adapters

1. Create a new directory: `src/programs/your-protocol/`

2. Create adapter:
```typescript
// src/programs/your-protocol/adapter.ts
import { BaseMarketAdapter } from '../shared/baseAdapter.js';

export class YourProtocolAdapter extends BaseMarketAdapter {
  constructor() {
    super('YOUR_PROGRAM_ID');
    // Register decoders
  }

  async normalize(decoded, accountData) {
    // Convert to unified Market schema
  }
}
```

3. Register in `src/index.ts`:
```typescript
import { YourProtocolAdapter } from './programs/your-protocol/adapter.js';

const yourAdapter = new YourProtocolAdapter();
registry.registerAdapter(yourAdapter);
```

4. Add program ID to `.env`:
```
PROGRAM_IDS=YOUR_PROGRAM_ID,OTHER_IDS
```

## Architecture Overview

```
┌─────────────────────────────────────────────────┐
│                  API Layer                      │
│  ┌──────────┐  ┌──────────────┐                │
│  │   REST   │  │  WebSocket   │                │
│  └──────────┘  └──────────────┘                │
└──────────────────┬──────────────────────────────┘
                   │
┌──────────────────▼──────────────────────────────┐
│              Event Dispatcher                   │
│         (Pub/Sub + Replay Buffer)               │
└──────────────────┬──────────────────────────────┘
                   │
┌──────────────────▼──────────────────────────────┐
│                 Indexer                         │
│  ┌────────────┐  ┌────────────┐                │
│  │ WebSocket  │  │  Polling   │                │
│  │ Real-time  │  │  Backup    │                │
│  └────────────┘  └────────────┘                │
└──────────────────┬──────────────────────────────┘
                   │
┌──────────────────▼──────────────────────────────┐
│           Program Adapters                      │
│  ┌────────────┐  ┌────────────┐  ┌──────────┐ │
│  │Switchboard │  │    Hxro    │  │  Custom  │ │
│  └────────────┘  └────────────┘  └──────────┘ │
└──────────────────┬──────────────────────────────┘
                   │
┌──────────────────▼──────────────────────────────┐
│         Normalization Layer                     │
│      (Unified Market Schema)                    │
└──────────────────┬──────────────────────────────┘
                   │
┌──────────────────▼──────────────────────────────┐
│             Database Layer                      │
│          (SQLite / Postgres)                    │
└─────────────────────────────────────────────────┘
```

## Project Structure

```
src/
├── api/                    # REST & WebSocket API
│   ├── server.ts
│   └── routes/
│       ├── health.ts
│       └── markets.ts
├── indexer/                # Event indexing engine
│   ├── indexer.ts
│   └── eventDispatcher.ts
├── programs/               # Protocol adapters
│   ├── shared/             # Base classes & utilities
│   ├── switchboard/
│   └── hxro/
├── normalize/              # Data normalization
│   ├── types.ts
│   └── marketNormalizer.ts
├── rpc/                    # Solana RPC wrapper
│   ├── connection.ts
│   └── websocket.ts
├── storage/                # Database layer
│   ├── db.ts
│   └── migrate.ts
├── utils/                  # Helpers
│   ├── config.ts
│   ├── logger.ts
│   └── retry.ts
└── index.ts               # Application entry point
```

## Troubleshooting

### Database locked error
If you get a "database is locked" error, ensure no other instance is running:
```bash
pkill -f "node.*index.ts"
rm data/markets.db-wal data/markets.db-shm
```

### RPC rate limiting
Use a dedicated RPC provider (Helius, QuickNode, Alchemy) for production:
```env
SOLANA_RPC_HTTP=https://your-dedicated-rpc.com
```

### WebSocket disconnections
The system auto-reconnects. Check logs for connection status:
```bash
npm run dev | grep websocket
```

## Production Deployment

### Using PM2
```bash
npm run build
pm2 start dist/index.js --name solana-market-aggregator
```

### Docker
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY dist ./dist
CMD ["node", "dist/index.js"]
```

## Performance Tips

1. **Use dedicated RPC endpoints** - Free endpoints have rate limits
2. **Enable database WAL mode** - Already configured for SQLite
3. **Adjust batch sizes** - Configure `INDEXER_BATCH_SIZE` based on RPC limits
4. **Use Postgres for production** - Better concurrent write performance
5. **Monitor replay buffer size** - Adjust based on memory constraints

## Support

For issues or questions:
- Check logs: `tail -f logs/*.log`
- Review health endpoint: `curl http://localhost:3000/api/health`
- Inspect database: `sqlite3 data/markets.db "SELECT * FROM markets LIMIT 5;"`

