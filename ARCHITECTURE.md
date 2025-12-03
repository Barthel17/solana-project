# Architecture Documentation

## System Overview

The Solana Prediction Market Data Aggregator is a **real-time indexing and API service** that normalizes data from multiple Solana-based prediction market protocols into a unified schema. It provides both REST and WebSocket APIs for consuming market data.

## Core Principles

1. **Modularity**: Each protocol has its own adapter that can be added/removed independently
2. **Real-time**: WebSocket subscriptions for instant updates, with polling as fallback
3. **Scalability**: Batched operations, connection pooling, and efficient indexing
4. **Reliability**: Auto-retry, reconnection handling, and graceful degradation
5. **Type Safety**: Full TypeScript with Zod validation
6. **Extensibility**: Easy to add new protocols via the adapter pattern

## Architecture Layers

```
┌─────────────────────────────────────────────────────────────┐
│                     API Layer                               │
│  ┌──────────────────┐         ┌──────────────────┐         │
│  │   REST Endpoints │         │  WebSocket Feed  │         │
│  │                  │         │                  │         │
│  │ /markets         │         │  Real-time       │         │
│  │ /markets/:id     │         │  Event Stream    │         │
│  │ /health          │         │  + Replay Buffer │         │
│  └──────────────────┘         └──────────────────┘         │
└──────────────────┬──────────────────┬──────────────────────┘
                   │                  │
                   ▼                  ▼
┌─────────────────────────────────────────────────────────────┐
│                  Event Dispatcher                           │
│                                                             │
│  - Pub/Sub event routing                                   │
│  - Replay buffer (last 1000 events)                        │
│  - Type-safe event handlers                                │
│  - Async event processing queue                            │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────┐
│                     Indexer                                 │
│                                                             │
│  ┌──────────────────┐         ┌──────────────────┐         │
│  │  WebSocket Sub   │         │  Polling Backup  │         │
│  │                  │         │                  │         │
│  │  - Real-time     │         │  - Periodic sync │         │
│  │  - Auto-reconnect│         │  - Gap detection │         │
│  │  - Per-program   │         │  - Health checks │         │
│  └──────────────────┘         └──────────────────┘         │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────┐
│                 Program Adapters                            │
│                                                             │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐           │
│  │Switchboard │  │    Hxro    │  │   Custom   │           │
│  │            │  │            │  │            │           │
│  │ - Oracle   │  │ - Parimutuel│ │ - Your     │           │
│  │   feeds    │  │   markets  │  │   protocol │           │
│  └────────────┘  └────────────┘  └────────────┘           │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────┐
│              Normalization Layer                            │
│                                                             │
│  - Unified Market schema                                   │
│  - Outcome probability calculation                         │
│  - Data validation (Zod)                                   │
│  - Type conversions (BigInt, PublicKey → string)           │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────┐
│                  Storage Layer                              │
│                                                             │
│  ┌──────────────────────────────────────────────┐          │
│  │  Database (SQLite / PostgreSQL)              │          │
│  │                                              │          │
│  │  - Markets, Outcomes                        │          │
│  │  - Trades, Orders, Orderbook               │          │
│  │  - Resolutions, Oracle Updates             │          │
│  │  - Historical Candles                      │          │
│  └──────────────────────────────────────────────┘          │
└─────────────────────────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────┐
│                   RPC Layer                                 │
│                                                             │
│  - Connection management                                   │
│  - Auto-retry with exponential backoff                     │
│  - Multi-endpoint failover                                 │
│  - Request batching                                        │
│  - WebSocket management                                    │
└─────────────────────────────────────────────────────────────┘
                   │
                   ▼
              Solana Blockchain
```

## Component Details

### 1. RPC Layer (`src/rpc/`)

**Purpose**: Manage connections to Solana RPC endpoints

**Key Features**:
- **Auto-retry**: Exponential backoff for failed requests
- **Failover**: Automatically switch to backup RPC endpoints
- **Batching**: Group multiple requests to avoid rate limits
- **WebSocket Management**: Subscribe to program account changes

**Files**:
- `connection.ts`: HTTP RPC client with retry logic
- `websocket.ts`: WebSocket subscription manager

**Design Decisions**:
- Uses `@solana/web3.js` v2 for latest features
- Implements circuit breaker pattern for failover
- Singleton pattern for global RPC client access

### 2. Indexer (`src/indexer/`)

**Purpose**: Subscribe to and process on-chain events

**Key Features**:
- **Dual-mode**: WebSocket for real-time + polling as backup
- **Program-specific**: Subscribes to multiple program IDs
- **Batch Processing**: Handle multiple accounts efficiently
- **Gap Detection**: Polling ensures no missed events

**Files**:
- `indexer.ts`: Main indexing engine
- `eventDispatcher.ts`: Event pub/sub system

**Design Decisions**:
- WebSocket-first approach for low latency
- Polling as safety net (5-second intervals by default)
- Event queue for sequential processing
- Replay buffer for new subscribers (last 1000 events)

### 3. Program Adapters (`src/programs/`)

**Purpose**: Decode and normalize protocol-specific data

**Adapter Pattern**:
```typescript
interface MarketAdapter {
  programId: string;
  decodeAccount(data): DecodedAccount;
  normalize(decoded): Market;
}
```

**Built-in Adapters**:

#### Switchboard (`switchboard/adapter.ts`)
- Decodes oracle aggregator accounts
- Converts oracle values to binary outcomes (Yes/No)
- Calculates confidence from oracle consensus
- Uses manual buffer decoding

#### Hxro (`hxro/adapter.ts`)
- Decodes parimutuel market accounts
- Calculates odds from pool ratios
- Supports multiple outcomes per market
- Tracks betting volume and liquidity

**Adding Custom Adapters**:
1. Extend `BaseMarketAdapter`
2. Implement `decodeAccount()` - parse binary data
3. Implement `normalize()` - convert to unified schema
4. Register with `ProgramRegistry`

### 4. Normalization (`src/normalize/`)

**Purpose**: Unified data schema across all protocols

**Core Types**:
```typescript
Market {
  id, name, description, status
  outcomes: Outcome[]
  volume, liquidity, fees
  timestamps, resolution info
}

Outcome {
  id, name, probability
  volume, liquidity, lastPrice
}
```

**Why Normalization**:
- Different protocols use different data structures
- APIs need consistent response format
- Easier to build frontends against one schema
- Simplifies analytics and aggregations

**Design Decisions**:
- Use Zod for runtime validation
- Store BigInts as strings for JSON compatibility
- Probability always 0-1 range
- Status enum for lifecycle management

### 5. Storage (`src/storage/`)

**Purpose**: Persist historical and current market data

**Database Schema**:
```sql
markets
├── outcomes (1:N)
├── trades (1:N)
├── orders (1:N)
├── orderbook_snapshots (1:N)
├── resolutions (1:1)
├── oracle_updates (1:N)
└── candles (1:N)
```

**Supported Databases**:
- **SQLite**: Development, small deployments
- **PostgreSQL**: Production, high throughput

**Design Decisions**:
- WAL mode for SQLite (better concurrency)
- Foreign keys with CASCADE delete
- Indexes on common query patterns
- JSON columns for flexible metadata
- Separate outcomes table (normalized)

### 6. API Layer (`src/api/`)

**Purpose**: Expose data via HTTP and WebSocket

**REST Endpoints**:
```
GET  /api/health              - System health
GET  /api/markets             - List markets (filterable)
GET  /api/markets/:id         - Market details
GET  /api/markets/:id/trades  - Trade history
GET  /api/markets/:id/orders  - Order book
GET  /api/markets/:id/history - Price candles
```

**WebSocket Protocol**:
```javascript
// Client → Server
{ type: 'subscribe', marketId: '...' }
{ type: 'ping' }

// Server → Client
{ type: 'connected', data: {...} }
{ type: 'event', data: MarketEvent }
{ type: 'replay', data: { events: [...] } }
{ type: 'pong', data: {...} }
```

**Design Decisions**:
- Express for REST (simple, widely used)
- `ws` library for WebSocket (lightweight)
- Rate limiting per IP
- CORS enabled by default
- Replay buffer for new connections

## Data Flow

### Market Update Flow

```
1. On-chain event occurs
   ↓
2. WebSocket receives account update
   ↓
3. Indexer identifies program adapter
   ↓
4. Adapter decodes binary data
   ↓
5. Adapter normalizes to Market schema
   ↓
6. EventDispatcher broadcasts event
   ↓
7. Database handler persists data
   ↓
8. API layer receives event
   ↓
9. WebSocket clients notified in real-time
```

### Query Flow

```
1. HTTP GET /api/markets/:id
   ↓
2. API route handler
   ↓
3. Database.getMarket(id)
   ↓
4. Join with outcomes table
   ↓
5. Format as JSON
   ↓
6. Return to client
```

## Scalability Considerations

### Horizontal Scaling

**What scales**:
- API servers (stateless, can add more)
- Database read replicas

**What doesn't scale**:
- Indexer (single instance per program to avoid duplicates)
- WebSocket connections (sticky sessions needed)

**Recommended Setup**:
```
          Load Balancer
                │
        ┌───────┴───────┐
        ▼               ▼
    API Server 1    API Server 2
        │               │
        └───────┬───────┘
                ▼
        Database Primary
                │
        ┌───────┴───────┐
        ▼               ▼
    Read Replica 1  Read Replica 2
```

### Performance Optimization

**RPC Layer**:
- Use dedicated RPC endpoints
- Batch `getMultipleAccounts` calls
- Cache account data (with TTL)
- Connection pooling

**Database**:
- Index frequently queried fields
- Use connection pooling
- Partition historical data by time
- Archive old data to separate tables

**API**:
- Response caching (Redis)
- Paginate large result sets
- Compress responses (gzip)
- CDN for static content

## Error Handling

### Retry Strategy

```
Attempt 1: immediate
Attempt 2: wait 1s
Attempt 3: wait 2s
Attempt 4: wait 4s
Attempt 5: wait 8s
Max wait: 30s
```

### Failover Strategy

1. Primary RPC fails
2. Switch to fallback #1
3. Test connection
4. If successful, continue
5. If failed, try fallback #2
6. Log all failovers

### Graceful Degradation

- RPC fails → Use last cached data
- Database fails → Return 503 with cached health
- WebSocket fails → Auto-reconnect with backoff
- Adapter fails → Log error, skip account

## Security

### Input Validation

- All inputs validated with Zod schemas
- SQL injection prevented (parameterized queries)
- XSS prevented (no HTML in responses)
- Rate limiting per IP

### Authentication (Optional)

To add API keys:

```typescript
// middleware/auth.ts
export function requireApiKey(req, res, next) {
  const apiKey = req.headers['x-api-key'];
  if (!validApiKey(apiKey)) {
    return res.status(401).json({ error: 'Invalid API key' });
  }
  next();
}

// In server.ts
app.use('/api', requireApiKey);
```

### Production Security

- Use HTTPS (TLS 1.3)
- Enable CORS selectively
- Hide error details in production
- Log security events
- Regular dependency updates
- Environment variable secrets

## Monitoring

### Health Metrics

```json
{
  "status": "healthy",
  "components": {
    "rpc": { "healthy": true, "endpoint": "..." },
    "database": { "healthy": true },
    "indexer": { "running": true, "subscriptions": 2 },
    "eventDispatcher": { "queuedEvents": 0 }
  }
}
```

### Key Metrics to Track

- RPC request latency
- RPC error rate
- WebSocket connection count
- Event processing lag
- Database query time
- API response time
- Memory usage
- Disk usage

### Logging Levels

```
fatal: System crash
error: Operation failed
warn: Degraded functionality
info: Normal operations
debug: Detailed debugging
trace: Very verbose
```

## Testing Strategy

### Unit Tests

```typescript
// Test adapter decoding
test('decodes Hxro market account', () => {
  const buffer = createMockAccountData();
  const adapter = new HxroAdapter();
  const decoded = adapter.decodeAccount(buffer);
  expect(decoded.marketName).toBe('Test Market');
});
```

### Integration Tests

```typescript
// Test full indexing flow
test('indexes and normalizes market', async () => {
  const indexer = initializeIndexer();
  await indexer.start();
  
  // Trigger account update
  const event = await waitForEvent('market_updated');
  
  expect(event.data.status).toBe('active');
});
```

### Load Testing

```bash
# Test API throughput
ab -n 10000 -c 100 http://localhost:3000/api/markets

# Test WebSocket connections
websocket-bench -n 1000 ws://localhost:3000/ws
```

## Future Enhancements

### Phase 2 Features

- [ ] GraphQL API
- [ ] Multi-language SDK (Python, Rust, Go)
- [ ] Advanced analytics (APY, volume charts)
- [ ] Notifications (Discord, Telegram, Slack)
- [ ] Market maker integration
- [ ] Price prediction models

### Performance Improvements

- [ ] Redis caching layer
- [ ] Account data compression
- [ ] Incremental snapshots
- [ ] Parallel indexing (with deduplication)

### Protocol Support

- [ ] Solana Flux aggregator
- [ ] Monaco Protocol
- [ ] Drift prediction markets
- [ ] Custom Anchor programs
- [ ] Cross-chain bridges

## Debugging

### Common Issues

**"Database is locked"**
```bash
# SQLite concurrency limit reached
# Solution: Use PostgreSQL or reduce concurrent writes
```

**"WebSocket disconnected"**
```bash
# RPC endpoint dropped connection
# Check logs for auto-reconnect attempts
pm2 logs solana-markets | grep websocket
```

**"No adapter found"**
```bash
# Program ID not registered
# Add to PROGRAM_IDS in .env and register adapter
```

### Debug Mode

```bash
# Enable verbose logging
LOG_LEVEL=debug npm run dev

# Trace specific module
DEBUG=indexer,adapter npm run dev
```

## Contributing

To add a new protocol:

1. **Create adapter** in `src/programs/your-protocol/`
2. **Write tests** for decoder and normalizer
3. **Register** in `src/index.ts`
4. **Document** account structure and API
5. **Add example** to `/examples`

See `CONTRIBUTING.md` for code style guide.

## License

MIT License - see LICENSE file

