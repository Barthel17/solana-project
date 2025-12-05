# 🌤️ Weather Prediction Market Trading Bot

A production-ready automated trading bot for weather prediction markets on Solana. The bot discovers weather markets, aggregates forecasts from multiple sources, calculates edges, and executes trades via Jupiter aggregator.

## Features

- **Market Discovery**: Fetches weather prediction markets from Kalshi (via tokenized markets)
- **Multi-Source Forecasting**: Aggregates forecasts from NWS (official), OpenWeatherMap, and more
- **Edge Detection**: Computes probability distributions and identifies mispricings
- **Automated Trading**: Executes trades via Jupiter with Kelly criterion position sizing
- **Real-time Dashboard**: Next.js dashboard for monitoring markets, edges, and PnL
- **Alerts**: Telegram and Discord notifications for trades and edges
- **Backtesting**: Historical simulation for strategy validation

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Market Fetcher │────▶│  Forecast Engine │────▶│     Trader      │
│  (Kalshi/Jupiter)│     │  (NWS/OWM/etc)   │     │ (Jupiter Swaps) │
└─────────────────┘     └──────────────────┘     └─────────────────┘
         │                       │                        │
         └───────────────────────┼────────────────────────┘
                                 │
                        ┌────────▼────────┐
                        │   Bot Manager   │
                        │  (Orchestrator) │
                        └────────┬────────┘
                                 │
              ┌──────────────────┼──────────────────┐
              │                  │                  │
      ┌───────▼───────┐  ┌───────▼───────┐  ┌──────▼──────┐
      │  HTTP API     │  │    Logger     │  │   Alerts    │
      │  (Dashboard)  │  │   (Winston)   │  │ (TG/Discord)│
      └───────────────┘  └───────────────┘  └─────────────┘
```

## Quick Start

### Prerequisites

- Node.js 18+ 
- npm or yarn
- Solana wallet with USDC (for trading)
- API keys (optional but recommended):
  - OpenWeatherMap API key
  - Telegram bot token (for alerts)
  - Discord webhook URL (for alerts)

### Installation

```bash
# Clone and install dependencies
cd "MBC Hackathon"
npm install

# Install frontend dependencies
cd frontend
npm install
cd ..
```

### Configuration

1. Copy the example environment file:
```bash
cp .env.example .env
```

2. Edit `.env` with your configuration:
```env
# Required: Your Solana wallet private key (base58 encoded)
SOLANA_PRIVATE_KEY=your_private_key_here

# Required: RPC endpoint (use a dedicated one for production)
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com

# Recommended: Weather API for better forecasts
OPENWEATHERMAP_API_KEY=your_key_here

# Trading settings
MIN_EDGE_THRESHOLD=0.08    # 8% minimum edge to trade
AUTO_TRADE_ENABLED=false   # Set to true for live trading

# Optional: Alerts
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_chat_id
```

3. Configure frontend:
```bash
cp frontend/.env.local.example frontend/.env.local
```

### Running the Bot

```bash
# Start the trading bot
npm run bot

# Or with ts-node directly
npx ts-node --esm src/bot.ts
```

The bot will:
1. Connect to your Solana wallet
2. Fetch active weather markets
3. Get forecasts from multiple sources
4. Calculate edges and identify opportunities
5. Execute trades (if AUTO_TRADE_ENABLED=true)
6. Start HTTP API on port 3001

### Running the Dashboard

```bash
cd frontend
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to view the dashboard.

### Running the Backtester

```bash
npm run backtest
```

## Project Structure

```
.
├── src/
│   ├── bot.ts              # Main bot orchestrator
│   ├── marketFetcher.ts    # Market discovery & aggregation
│   ├── forecastEngine.ts   # Weather forecast processing
│   ├── trader.ts           # Trade execution via Jupiter
│   ├── alerts.ts           # Telegram/Discord notifications
│   ├── backtester.ts       # Historical backtesting
│   ├── config.ts           # Configuration loader
│   ├── logger.ts           # Winston logging setup
│   └── types.ts            # TypeScript type definitions
├── frontend/
│   ├── src/
│   │   ├── app/
│   │   │   ├── page.tsx    # Main dashboard
│   │   │   └── layout.tsx  # App layout
│   │   ├── components/
│   │   │   ├── ui/         # shadcn/ui components
│   │   │   └── dashboard/  # Dashboard components
│   │   └── lib/
│   │       ├── api.ts      # Bot API client
│   │       └── utils.ts    # Utility functions
│   └── package.json
├── .env.example            # Environment template
├── package.json
└── tsconfig.json
```

## Configuration Options

### Trading Parameters

| Variable | Default | Description |
|----------|---------|-------------|
| `MIN_EDGE_THRESHOLD` | 0.08 | Minimum edge (8%) to consider trading |
| `MAX_EDGE_THRESHOLD` | 0.50 | Maximum edge (50%) - reject suspicious data |
| `POSITION_SIZING_METHOD` | kelly | "kelly" or "fixed" |
| `KELLY_FRACTION` | 0.25 | Quarter Kelly for safety |
| `MAX_POSITION_SIZE_USDC` | 500 | Max single position |
| `MAX_TOTAL_EXPOSURE_USDC` | 2000 | Max total portfolio exposure |
| `SLIPPAGE_TOLERANCE` | 0.02 | 2% slippage tolerance |
| `AUTO_TRADE_ENABLED` | false | Enable/disable automatic trading |

### Bot Settings

| Variable | Default | Description |
|----------|---------|-------------|
| `BOT_INTERVAL_MINUTES` | 10 | How often to run the main loop |
| `FOCUS_CITIES` | (all) | Comma-separated city codes |
| `MARKET_CATEGORIES` | temperature,precipitation | Market types to trade |
| `LOG_LEVEL` | info | error, warn, info, debug |

### Supported Cities

NYC, LAX, CHI, DFW, DEN, MIA, PHX, SEA, ATL, BOS

## API Endpoints

The bot exposes an HTTP API for the dashboard:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/status` | GET | Bot status and timing |
| `/api/stats` | GET | Trading statistics |
| `/api/markets` | GET | Active weather markets |
| `/api/edges` | GET | Current edge calculations |
| `/api/positions` | GET | Open positions |
| `/api/trades` | GET | Recent trades |
| `/api/alerts` | GET | Recent alerts |
| `/api/state` | GET | Full bot state |
| `/api/trigger` | POST | Trigger manual cycle |
| `/api/health` | GET | Health check |

All endpoints require `Authorization: Bearer <API_KEY>` header.

## How It Works

### 1. Market Discovery

The bot fetches weather markets from:
- Kalshi API (direct, if available)
- Jupiter token list (for tokenized markets)

Markets are filtered by:
- Weather-related keywords (temperature, rain, snow, etc.)
- City names
- Configured categories

### 2. Forecast Aggregation

For each market, the bot:
1. Fetches forecasts from NWS (official source)
2. Fetches forecasts from OpenWeatherMap
3. Combines into weighted ensemble
4. Builds probability distributions

### 3. Edge Calculation

For each market:
1. Calculate P(outcome) using ensemble forecast
2. Compare to market price (implied probability)
3. Edge = Our Probability - Market Probability
4. Flag if |Edge| > threshold

### 4. Trade Execution

When edge is found:
1. Calculate position size (Kelly criterion)
2. Get Jupiter quote for swap
3. Execute swap transaction
4. Track position

### 5. Position Management

- Monitor position values
- Check for take-profit conditions
- Auto-close when edge disappears

## Security Best Practices

1. **Never commit `.env` files** - Use `.env.example` as template
2. **Use dedicated wallet** - Create a new wallet for trading
3. **Start with AUTO_TRADE=false** - Paper trade first
4. **Use dedicated RPC** - Avoid rate limits
5. **Set reasonable limits** - Start with small position sizes
6. **Monitor continuously** - Use alerts for important events

## Development

```bash
# Run bot in development mode
npm run bot:dev

# Run frontend in development
cd frontend && npm run dev

# Type checking
npx tsc --noEmit

# Lint
npm run lint
```

## Disclaimer

⚠️ **This software is for educational purposes only.** 

- Trading prediction markets involves significant risk
- Past performance does not guarantee future results
- Always do your own research
- Never risk more than you can afford to lose
- This is not financial advice

## License

MIT

## Contributing

Contributions welcome! Please read the contributing guidelines first.


