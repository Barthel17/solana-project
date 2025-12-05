# Solana Weather Bot

## Title & Team Members

**Project Title:** Solana Weather Bot

**Team Members:**
- **Matteo Shafer** - Developer
- **Hunter Barthel** - Developer

---

## Table of Contents

- [Project Description](#project-description)
- [Demo Video](#demo-video)
- [GitHub Repository](#github-repository)
- [Technical Summary](#technical-summary)
  - [Problem Statement](#problem-statement)
  - [Architecture](#architecture)
  - [Solana Tools Used](#solana-tools-used)
  - [Why Solana?](#why-solana)
- [Deployed Program Address](#deployed-program-address)
- [Quick Start](#quick-start)
- [Features](#features)
- [Installation](#installation)
- [Configuration](#configuration)
- [Usage](#usage)
- [API Documentation](#api-documentation)
- [Security](#security)
- [Contributing](#contributing)
- [License](#license)

---

## Project Description

Solana Weather Bot is an automated trading system that identifies and exploits pricing inefficiencies in weather prediction markets on Solana. The bot aggregates professional weather forecasts from multiple sources (National Weather Service, OpenWeatherMap), calculates probability distributions for weather outcomes, and compares them against market prices on tokenized prediction markets.

When the bot detects a significant edge (mispricing), it automatically executes trades via Jupiter aggregator, using Kelly criterion for optimal position sizing. The system includes a real-time Next.js dashboard for monitoring markets, edges, positions, and PnL. Built entirely in TypeScript with production-ready error handling, logging, and alerting via Telegram/Discord.

The bot supports multiple weather market types including temperature thresholds, precipitation amounts, and snow forecasts across major US cities. It runs continuously, scanning markets every 10 minutes, calculating edges, and executing trades when opportunities exceed configurable thresholds.

---

## Demo Video

[Link to demo video - to be added]

*Demo video should be ≤ 3 minutes and demonstrate:*
- Bot startup and configuration
- Market discovery and edge detection
- Real-time dashboard monitoring
- Trade execution (paper trading mode)
- Alert notifications

---

## GitHub Repository

**Repository:** https://github.com/Barthel17/solana-project

**Public Codebase:** Complete source code available at the repository link above.

---

## Technical Summary

### Problem Statement

Weather prediction markets on Solana (tokenized via platforms like Kalshi) often exhibit pricing inefficiencies due to:
1. **Information asymmetry** - Market participants may not have access to professional weather forecasts
2. **Delayed updates** - Market prices may lag behind rapidly changing weather conditions
3. **Limited forecast aggregation** - Most traders rely on single sources rather than ensemble forecasts
4. **Manual trading limitations** - Human traders cannot monitor and trade 24/7 across hundreds of markets

Our solution automates the entire process: fetching markets, aggregating forecasts, calculating probabilities, detecting edges, and executing trades programmatically.

### Architecture

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
              ┌───────────────────┼──────────────────┐
              │                  │                  │
      ┌───────▼───────┐  ┌───────▼───────┐  ┌──────▼──────┐
      │  HTTP API     │  │    Logger     │  │   Alerts    │
      │  (Dashboard)  │  │   (Winston)   │  │ (TG/Discord)│
      └───────────────┘  └───────────────┘  └─────────────┘
```

**Key Components:**

1. **Market Discovery (`marketFetcher.ts`)**
   - Fetches weather markets from Kalshi API (authenticated via RSA-PSS)
   - Discovers tokenized markets via Jupiter token list
   - Filters by weather keywords and city names
   - Parses market conditions (temperature thresholds, precipitation amounts)

2. **Forecast Engine (`forecastEngine.ts`)**
   - Aggregates forecasts from NWS (40% weight) and OpenWeatherMap (25% weight)
   - Builds probability distributions using normal CDF
   - Calculates P(outcome) for each market condition
   - Implements ensemble forecasting with weighted averaging

3. **Edge Detection**
   - Compares our probability vs. market implied probability
   - Flags edges when |our_prob - market_price| > threshold (default 8%)
   - Calculates expected value and Kelly criterion position sizing
   - Filters suspicious edges (>50% typically indicates bad data)

4. **Trading Agent (`trader.ts`)**
   - Executes swaps via Jupiter aggregator
   - Uses @solana/web3.js for transaction signing
   - Implements position limits and risk management
   - Tracks positions and monitors for take-profit conditions

5. **Dashboard (`frontend/`)**
   - Next.js 14 with Tailwind CSS and shadcn/ui components
   - Real-time market table with edge highlighting
   - Statistics cards (PnL, win rate, avg edge)
   - Trade log and position tracking
   - Manual cycle trigger

### Solana Tools Used

1. **@solana/web3.js** (v1.95.0)
   - Connection management and RPC communication
   - Transaction building and signing
   - Keypair management for wallet operations
   - Account queries for balance checking

2. **@solana/spl-token** (v0.4.0)
   - Associated Token Account (ATA) operations
   - Token balance queries
   - Token account creation instructions

3. **@jup-ag/api** (v6.0.29)
   - Jupiter quote API for price discovery
   - Swap transaction generation
   - Route optimization for best execution
   - Slippage protection

4. **Jupiter Aggregator**
   - DEX aggregation for optimal swap routes
   - USDC ↔ Yes/No token swaps
   - Price quotes and execution

### Why Solana?

1. **Low Transaction Costs**
   - Weather markets require frequent rebalancing and position management
   - Solana's sub-cent fees enable profitable trading on smaller edges
   - High-frequency market scanning and updates are economically viable

2. **Fast Finality**
   - Weather conditions change rapidly; trades must execute quickly
   - Solana's ~400ms block time ensures timely position entry/exit
   - Critical for capturing short-lived pricing inefficiencies

3. **Programmable Money**
   - Smart contracts enable automated position management
   - Conditional logic for take-profit and stop-loss
   - Future: on-chain forecast oracles and automated resolution

4. **Tokenized Prediction Markets**
   - Kalshi and other platforms tokenize markets on Solana
   - Yes/No tokens trade like any SPL token
   - Jupiter aggregator provides liquidity across DEXs

5. **Developer Ecosystem**
   - Mature tooling (@solana/web3.js, Jupiter SDK)
   - Active community and documentation
   - Easy integration with off-chain data sources

6. **Scalability**
   - Can monitor hundreds of markets simultaneously
   - Parallel forecast fetching and edge calculations
   - No gas limit constraints on computation

---

## Deployed Program Address

*Not applicable - This is an off-chain trading bot that interacts with existing Solana programs (Jupiter, SPL Token) rather than deploying its own program.*

The bot operates as a Node.js application that:
- Connects to Solana RPC endpoints
- Interacts with Jupiter aggregator (on-chain program)
- Executes swaps on existing DEXs
- Manages positions via standard SPL token operations

---

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
# Clone the repository
git clone https://github.com/Barthel17/solana-project.git
cd solana-project

# Install dependencies
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

# Required: RPC endpoint
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com

# Trading settings
MIN_EDGE_THRESHOLD=0.08    # 8% minimum edge to trade
AUTO_TRADE_ENABLED=false   # Set to true for live trading

# Weather APIs
OPENWEATHERMAP_API_KEY=your_key_here
```

3. Configure frontend:
```bash
cp frontend/.env.local.example frontend/.env.local
```

### Running

```bash
# Start the trading bot
npm run bot

# In another terminal, start the dashboard
cd frontend
npm run dev
```

Open http://localhost:3000 to view the dashboard.

---

## Features

- **Market Discovery** - Fetches weather markets, parses conditions (temp ≥ 80°F, rain > 0.1", etc.)
- **Ensemble Forecasting** - Combines NWS (40% weight) + OpenWeatherMap (25% weight) with probability distributions
- **Edge Detection** - Calculates P(outcome) using normal CDF, compares to market price, flags edges ≥ 8%
- **Kelly Criterion Sizing** - Optimal position sizing with 25% Kelly fraction for safety
- **Jupiter Integration** - Gets quotes and executes swaps for USDC → Yes/No tokens
- **Real-time Dashboard** - Shows markets, edges, positions, trades, PnL, and alerts
- **Alerts System** - Telegram and Discord notifications for trades and edges
- **Backtester** - Simulates trading on historical weather data

---

## Installation

See [Quick Start](#quick-start) section above.

---

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `SOLANA_PRIVATE_KEY` | Base58-encoded wallet private key | Required |
| `SOLANA_RPC_URL` | Solana RPC endpoint | `https://api.mainnet-beta.solana.com` |
| `MIN_EDGE_THRESHOLD` | Minimum edge to trade (0-1) | `0.08` (8%) |
| `AUTO_TRADE_ENABLED` | Enable automatic trading | `false` |
| `KELLY_FRACTION` | Kelly multiplier for safety | `0.25` (quarter Kelly) |
| `MAX_POSITION_SIZE_USDC` | Max single position | `500` |
| `BOT_INTERVAL_MINUTES` | Cycle frequency | `10` |
| `OPENWEATHERMAP_API_KEY` | OpenWeatherMap API key | Optional |
| `KALSHI_API_KEY` | Kalshi API key ID | Optional |
| `KALSHI_PRIVATE_KEY` | Kalshi RSA private key | Optional |

See `.env.example` for complete configuration options.

---

## Usage

### Running the Bot

```bash
# Production mode
npm run bot

# Development mode (with watch)
npm run bot:dev

# Run backtester
npm run backtest
```

### Dashboard

The dashboard provides:
- Real-time market data and edge calculations
- Bot statistics and PnL tracking
- Manual trade triggers
- Position monitoring
- Alert feed

Access at http://localhost:3000 (when frontend is running).

### API Endpoints

The bot exposes an HTTP API on port 3001:

- `GET /api/status` - Bot status
- `GET /api/stats` - Trading statistics
- `GET /api/markets` - Active markets
- `GET /api/edges` - Current edges
- `GET /api/positions` - Open positions
- `GET /api/trades` - Recent trades
- `POST /api/trigger` - Trigger manual cycle

All endpoints require `Authorization: Bearer <API_KEY>` header.

---

## API Documentation

### Bot API

Base URL: `http://localhost:3001`

**Authentication:** All requests require `Authorization: Bearer <BOT_API_KEY>` header.

**Endpoints:**

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

---

## Security

⚠️ **Important Security Practices:**

1. **Never commit `.env` files** - Use `.env.example` as template
2. **Use dedicated wallet** - Create a new wallet for trading
3. **Start with `AUTO_TRADE=false`** - Paper trade first
4. **Use dedicated RPC** - Avoid rate limits
5. **Set reasonable limits** - Start with small position sizes
6. **Monitor continuously** - Use alerts for important events
7. **Protect API keys** - Store Kalshi private key securely

---

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
├── tsconfig.json
└── README.md
```

---

## Contributing

Contributions welcome! Please read the contributing guidelines first.

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## License

MIT License - see LICENSE file for details

---

## Disclaimer

⚠️ **This software is for educational purposes only.**

- Trading prediction markets involves significant risk
- Past performance does not guarantee future results
- Always do your own research
- Never risk more than you can afford to lose
- This is not financial advice

---

## Contact

For questions or issues, please open an issue on GitHub or contact:
- **Matteo Shafer** - [GitHub](https://github.com/Barthel17)
- **Hunter Barthel** - [GitHub](https://github.com/Barthel17)

---

## Acknowledgments

- National Weather Service for free, high-quality forecasts
- Jupiter Aggregator for DEX liquidity
- Kalshi for prediction market infrastructure
- Solana Foundation for the blockchain platform
