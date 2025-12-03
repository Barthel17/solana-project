/**
 * Example client for consuming the prediction market API
 */

import WebSocket from 'ws';

// REST API Examples
async function restApiExamples() {
  const BASE_URL = 'http://localhost:3000';

  console.log('=== REST API Examples ===\n');

  // 1. Health check
  console.log('1. Health Check:');
  const healthResponse = await fetch(`${BASE_URL}/api/health`);
  const health = await healthResponse.json();
  console.log(JSON.stringify(health, null, 2));
  console.log('\n');

  // 2. Get all markets
  console.log('2. Get All Markets:');
  const marketsResponse = await fetch(`${BASE_URL}/api/markets?limit=5`);
  const markets = await marketsResponse.json();
  console.log(`Found ${markets.count} markets`);
  console.log(JSON.stringify(markets.data[0], null, 2));
  console.log('\n');

  // 3. Get specific market
  if (markets.data.length > 0) {
    const marketId = markets.data[0].id;
    console.log(`3. Get Market ${marketId}:`);
    const marketResponse = await fetch(`${BASE_URL}/api/markets/${marketId}`);
    const market = await marketResponse.json();
    console.log(JSON.stringify(market, null, 2));
    console.log('\n');

    // 4. Get market trades
    console.log(`4. Get Trades for Market ${marketId}:`);
    const tradesResponse = await fetch(`${BASE_URL}/api/markets/${marketId}/trades?limit=10`);
    const trades = await tradesResponse.json();
    console.log(`Found ${trades.count} trades`);
    console.log('\n');

    // 5. Get market orders
    console.log(`5. Get Orders for Market ${marketId}:`);
    const ordersResponse = await fetch(`${BASE_URL}/api/markets/${marketId}/orders?status=open`);
    const orders = await ordersResponse.json();
    console.log(`Found ${orders.count} open orders`);
    console.log('\n');
  }

  // 6. Filter markets by status
  console.log('6. Get Active Markets:');
  const activeMarketsResponse = await fetch(`${BASE_URL}/api/markets?status=active&limit=3`);
  const activeMarkets = await activeMarketsResponse.json();
  console.log(`Found ${activeMarkets.count} active markets`);
  console.log('\n');
}

// WebSocket Example
function websocketExample() {
  console.log('=== WebSocket Example ===\n');

  const ws = new WebSocket('ws://localhost:3000/ws');

  ws.on('open', () => {
    console.log('✓ Connected to market data stream');

    // Send ping to test connection
    ws.send(JSON.stringify({ type: 'ping' }));

    // Subscribe to specific market (optional)
    // ws.send(JSON.stringify({ 
    //   type: 'subscribe', 
    //   marketId: 'YOUR_MARKET_ID' 
    // }));
  });

  ws.on('message', (data) => {
    const message = JSON.parse(data.toString());
    
    switch (message.type) {
      case 'connected':
        console.log('Welcome message:', message.data.message);
        break;

      case 'replay':
        console.log(`Received replay buffer: ${message.data.count} historical events`);
        break;

      case 'event':
        const event = message.data;
        console.log('\n📊 Market Event:');
        console.log(`  Type: ${event.type}`);
        console.log(`  Time: ${new Date(event.timestamp).toISOString()}`);
        console.log(`  Slot: ${event.slot}`);
        
        if (event.data.name) {
          console.log(`  Market: ${event.data.name}`);
        }
        
        if (event.data.outcomes) {
          console.log(`  Outcomes:`);
          event.data.outcomes.forEach((outcome: any) => {
            console.log(`    - ${outcome.name}: ${(outcome.probability * 100).toFixed(2)}%`);
          });
        }
        break;

      case 'pong':
        console.log('✓ Pong received');
        break;

      case 'error':
        console.error('Error:', message.data.message);
        break;

      default:
        console.log('Unknown message type:', message.type);
    }
  });

  ws.on('close', () => {
    console.log('\n✗ Disconnected from market data stream');
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });

  // Keep alive with periodic pings
  setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'ping' }));
    }
  }, 30000);
}

// Market Analytics Example
async function marketAnalyticsExample() {
  const BASE_URL = 'http://localhost:3000';

  console.log('=== Market Analytics Example ===\n');

  const marketsResponse = await fetch(`${BASE_URL}/api/markets?status=active&limit=10`);
  const markets = await marketsResponse.json();

  if (markets.data.length === 0) {
    console.log('No active markets found');
    return;
  }

  console.log('Market Analysis:\n');

  for (const market of markets.data) {
    console.log(`📈 ${market.name}`);
    console.log(`   Status: ${market.status}`);
    console.log(`   Total Volume: ${market.totalVolume} lamports`);
    console.log(`   Total Liquidity: ${market.totalLiquidity} lamports`);
    
    if (market.expiresAt) {
      const expiresIn = market.expiresAt - Date.now();
      const hours = Math.floor(expiresIn / (1000 * 60 * 60));
      console.log(`   Expires in: ${hours} hours`);
    }

    console.log('   Outcomes:');
    market.outcomes.forEach((outcome: any) => {
      const prob = (outcome.probability * 100).toFixed(1);
      const price = outcome.lastPrice ? `$${outcome.lastPrice.toFixed(3)}` : 'N/A';
      console.log(`     ${outcome.name}: ${prob}% (Price: ${price})`);
    });

    console.log('');
  }
}

// Historical Data Example
async function historicalDataExample() {
  const BASE_URL = 'http://localhost:3000';

  console.log('=== Historical Data Example ===\n');

  const marketsResponse = await fetch(`${BASE_URL}/api/markets?limit=1`);
  const markets = await marketsResponse.json();

  if (markets.data.length === 0) {
    console.log('No markets found');
    return;
  }

  const market = markets.data[0];
  const outcomeId = market.outcomes[0]?.id;

  if (outcomeId) {
    console.log(`Fetching historical data for ${market.name} - ${market.outcomes[0].name}\n`);

    // Get candles
    const endTime = Date.now();
    const startTime = endTime - (24 * 60 * 60 * 1000); // Last 24 hours

    const candlesResponse = await fetch(
      `${BASE_URL}/api/markets/${market.id}/history?` +
      `outcomeId=${outcomeId}&interval=1h&startTime=${startTime}&endTime=${endTime}`
    );
    
    const candles = await candlesResponse.json();
    
    if (candles.count > 0) {
      console.log(`Found ${candles.count} candles:`);
      candles.data.slice(0, 5).forEach((candle: any) => {
        const time = new Date(candle.timestamp).toISOString();
        console.log(
          `  ${time}: O:${candle.open.toFixed(3)} H:${candle.high.toFixed(3)} ` +
          `L:${candle.low.toFixed(3)} C:${candle.close.toFixed(3)} V:${candle.volume}`
        );
      });
    } else {
      console.log('No historical candle data available yet');
    }

    // Get oracle updates
    const oracleResponse = await fetch(
      `${BASE_URL}/api/markets/${market.id}/oracle-updates?limit=5`
    );
    const oracleUpdates = await oracleResponse.json();
    
    if (oracleUpdates.count > 0) {
      console.log(`\nRecent Oracle Updates (${oracleUpdates.count}):`);
      oracleUpdates.data.forEach((update: any) => {
        const time = new Date(update.timestamp).toISOString();
        console.log(`  ${time}: ${update.value} (${update.oracleType})`);
      });
    }
  }
}

// Main execution
async function main() {
  try {
    // Run REST API examples
    await restApiExamples();

    // Run analytics example
    await marketAnalyticsExample();

    // Run historical data example
    await historicalDataExample();

    // Start WebSocket connection (runs continuously)
    console.log('\nStarting WebSocket connection (press Ctrl+C to exit)...\n');
    websocketExample();

  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { restApiExamples, websocketExample, marketAnalyticsExample, historicalDataExample };

