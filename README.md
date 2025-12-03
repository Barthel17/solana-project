# Solana Prediction Market Data Aggregator

A real-time, production-ready indexer and API for Solana-based prediction markets.

## 🎯 Features

- **Real-time Indexing**: WebSocket-based event streaming from Solana mainnet
- **Multi-Protocol Support**: Extensible adapter system for any prediction market protocol
- **Normalized Data**: Unified schemas across different market implementations
- **Historical + Live APIs**: REST and WebSocket endpoints for market data
- **Production-Ready**: Retry logic, reconnection handling, rate limiting, error recovery

## 🏗️ Architecture

```
src/
├── rpc/              # Solana RPC client wrapper with retry/failover
├── indexer/          # Event-driven indexing engine
├── programs/         # Market protocol adapters
│   ├── shared/       # Common decoder utilities
│   ├── switchboard/  # Switchboard prediction feeds
│   └── hxro/         # Hxro protocol
├── normalize/        # Data normalization layer
├── storage/          # Database layer with migrations
├── api/              # REST & WebSocket API server
└── utils/            # Logging, config, helpers
```

## 🚀 Quick Start

### Installation

```bash
npm install
```

### Configuration

```bash
cp .env.example .env
# Edit .env with your RPC endpoints
```

### Run Migrations

```bash
npm run db:migrate
```

### Development

```bash
npm run dev
```

### Production

```bash
npm run build
npm start
```

## 📡 API Endpoints

### REST API

- `GET /api/markets` - List all markets
- `GET /api/markets/:id` - Get market details
- `GET /api/markets/:id/history` - Historical data
- `GET /api/markets/:id/orderbook` - Current orderbook
- `GET /api/health` - Service health check

### WebSocket

Connect to `ws://localhost:3000/ws` for real-time updates:

```javascript
const ws = new WebSocket('ws://localhost:3000/ws');

ws.on('message', (data) => {
  const event = JSON.parse(data);
  console.log(event); // { type: 'market_update', data: {...} }
});
```

## 🔌 Adding New Market Adapters

Create a new adapter in `src/programs/your-market/`:

```typescript
// src/programs/your-market/adapter.ts
export class YourMarketAdapter extends BaseAdapter {
  async decodeAccount(data: Buffer): Promise<MarketAccount> {
    // Implement decoding logic
  }
  
  async normalize(account: MarketAccount): Promise<NormalizedMarket> {
    // Convert to unified schema
  }
}
```

Register it in `src/programs/shared/programRegistry.ts`.

## 📊 Database Schema

The system stores:
- Markets metadata
- Outcomes and probabilities
- Trades and volume
- Orderbook snapshots
- Oracle updates
- Resolution events

## 🛠️ Technology Stack

- **Runtime**: Node.js 18+
- **Language**: TypeScript 5+
- **Blockchain**: Solana Web3.js v2
- **Database**: SQLite (development) / Postgres (production)
- **API**: Express + WebSocket
- **Validation**: Zod
- **Logging**: Pino

## 📝 License

MIT
