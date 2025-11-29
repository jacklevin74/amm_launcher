/**
 * Live Trading Simulation
 * Simulates sequential USDC buy orders and shows pool evolution
 *
 * Usage:
 *   npx ts-node --transpile-only tests/live-trading-sim.ts [trades] [usdc_per_trade] [delay_ms] [-c]
 *
 * Arguments:
 *   trades        - Number of trades to simulate (default: 1000)
 *   usdc_per_trade - USDC amount per trade (default: 1000)
 *   delay_ms      - Milliseconds between trades (default: 1000)
 *   -c, --continuous - Run continuously until Ctrl+C
 *
 * Examples:
 *   npx ts-node --transpile-only tests/live-trading-sim.ts 100 5000 0
 *   npx ts-node --transpile-only tests/live-trading-sim.ts 500 2000 500
 *   npx ts-node --transpile-only tests/live-trading-sim.ts -c 1000 1000  # Continuous mode
 */

// Pool state
interface PoolState {
  xntSold: number;        // Total XNT sold so far
  totalUSDC: number;      // Total USDC collected
  tradeCount: number;
}

const INITIAL_XNT = 1_000_000;
const MIN_PRICE = 1.0;

// Create initial pool
function createPool(): PoolState {
  return {
    xntSold: 0,
    totalUSDC: 0,
    tradeCount: 0,
  };
}

// Execute a single buy order
function executeBuyOrder(pool: PoolState, usdcAmount: number): {
  xntReceived: number;
  price: number;
  xntRemaining: number;
} {
  // Calculate what would be the new total USDC after this trade
  const newTotalUSDC = pool.totalUSDC + usdcAmount;

  // Calculate avg price across all XNT if we sold all of it
  const hypotheticalAvgPrice = newTotalUSDC / INITIAL_XNT;

  // Determine effective price based on minimum floor
  let effectivePrice: number;
  let maxXNTCanSellAfterTrade: number;

  if (hypotheticalAvgPrice < MIN_PRICE) {
    // Below floor - can only sell portion at $1.00
    effectivePrice = MIN_PRICE;
    maxXNTCanSellAfterTrade = newTotalUSDC / MIN_PRICE;
  } else {
    // Above floor - can sell all XNT at avg price
    effectivePrice = hypotheticalAvgPrice;
    maxXNTCanSellAfterTrade = INITIAL_XNT;
  }

  // How much XNT this specific trade gets
  const xntForThisTrade = usdcAmount / effectivePrice;

  // How much total would be sold after this trade
  const newTotalXNTSold = pool.xntSold + xntForThisTrade;

  // How much XNT will remain in the actual pool (not sellable, but physical)
  const xntRemainingInPool = INITIAL_XNT - newTotalXNTSold;

  // Update pool state
  pool.xntSold = newTotalXNTSold;
  pool.totalUSDC = newTotalUSDC;
  pool.tradeCount += 1;

  return {
    xntReceived: xntForThisTrade,
    price: effectivePrice,
    xntRemaining: Math.max(0, xntRemainingInPool),
  };
}

// Format number with commas
function fmt(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Print table header
function printHeader() {
  console.log("╔═══════╦═══════════════╦═══════════════╦═══════════════╦═══════════════╦═══════════════╗");
  console.log("║ Trade ║  USDC Paid    ║  XNT Received ║  Avg Price    ║  XNT Remaining║ Total USDC    ║");
  console.log("╠═══════╬═══════════════╬═══════════════╬═══════════════╬═══════════════╬═══════════════╣");
}

function printFooter() {
  console.log("╚═══════╩═══════════════╩═══════════════╩═══════════════╩═══════════════╩═══════════════╝");
}

function printRow(
  trade: number,
  usdcPaid: number,
  xntReceived: number,
  price: number,
  xntRemaining: number,
  totalUSDC: number
) {
  const tradeStr = String(trade).padStart(5);
  const usdcPaidStr = ("$" + fmt(usdcPaid)).padStart(13);
  const xntRecStr = fmt(xntReceived).padStart(13);
  const priceStr = ("$" + price.toFixed(4)).padStart(13);
  const xntRemStr = fmt(xntRemaining).padStart(13);
  const totalUSDCStr = ("$" + fmt(totalUSDC)).padStart(13);

  console.log(`║ ${tradeStr} ║ ${usdcPaidStr} ║ ${xntRecStr} ║ ${priceStr} ║ ${xntRemStr} ║ ${totalUSDCStr} ║`);
}

// Sleep utility
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Main simulation
async function runSimulation(ordersCount: number, usdcPerOrder: number, delayMs: number) {
  console.log("\n╔════════════════════════════════════════════════════════════════════════════════════════╗");
  console.log("║                        LOTTERY AMM - LIVE TRADING SIMULATION                          ║");
  console.log("╚════════════════════════════════════════════════════════════════════════════════════════╝\n");

  console.log(`📊 Simulation Parameters:`);
  console.log(`   Initial XNT Supply: ${INITIAL_XNT.toLocaleString()} XNT`);
  console.log(`   Minimum Price: $${MIN_PRICE.toFixed(2)}`);
  console.log(`   Total Orders: ${ordersCount.toLocaleString()}`);
  console.log(`   USDC per Order: $${usdcPerOrder.toLocaleString()}`);
  console.log(`   Total USDC Demand: $${(ordersCount * usdcPerOrder).toLocaleString()}`);
  console.log(`   Delay per Trade: ${delayMs}ms\n`);

  const pool = createPool();

  printHeader();

  // Execute trades
  for (let i = 1; i <= ordersCount; i++) {
    const result = executeBuyOrder(pool, usdcPerOrder);

    // Print every trade, or every 10th if > 100 trades, or every 100th if > 1000
    const shouldPrint =
      ordersCount <= 100 ||
      (ordersCount <= 1000 && i % 10 === 0) ||
      (ordersCount > 1000 && i % 100 === 0) ||
      i === 1 ||
      i === ordersCount;

    if (shouldPrint) {
      printRow(
        i,
        usdcPerOrder,
        result.xntReceived,
        result.price,
        result.xntRemaining,
        pool.totalUSDC
      );
    }

    // Check if pool is exhausted
    if (result.xntRemaining <= 0) {
      console.log("╠═══════╬═══════════════╬═══════════════╬═══════════════╬═══════════════╬═══════════════╣");
      console.log("║       ║               ║               ║ 🚫 POOL SOLD OUT - NO MORE XNT AVAILABLE       ║");
      console.log("╠═══════╬═══════════════╬═══════════════╬═══════════════╬═══════════════╬═══════════════╣");
      break;
    }

    if (delayMs > 0) {
      await sleep(delayMs);
    }
  }

  printFooter();

  // Final summary
  console.log("\n╔════════════════════════════════════════════════════════════════════════════════════════╗");
  console.log("║                                   FINAL SUMMARY                                       ║");
  console.log("╚════════════════════════════════════════════════════════════════════════════════════════╝\n");

  const xntRemaining = INITIAL_XNT - pool.xntSold;
  const pctSold = (pool.xntSold / INITIAL_XNT) * 100;
  const avgPrice = pool.totalUSDC / INITIAL_XNT;

  console.log(`  📈 Total Trades Executed: ${pool.tradeCount.toLocaleString()}`);
  console.log(`  💰 Total USDC Collected: $${fmt(pool.totalUSDC)}`);
  console.log(`  🪙  Total XNT Sold: ${fmt(pool.xntSold)} (${pctSold.toFixed(1)}%)`);
  console.log(`  💎 XNT Remaining in Pool: ${fmt(xntRemaining)}`);
  console.log(`  📊 Average Price: $${avgPrice.toFixed(6)}`);
  console.log(`  🎯 Final Pool State:`);
  console.log(`     - At minimum price ($${MIN_PRICE}): ${avgPrice <= MIN_PRICE ? "YES ✅" : "NO"}`);
  console.log(`     - Above minimum price: ${avgPrice > MIN_PRICE ? "YES ✅" : "NO"}`);
  console.log(``);

  if (avgPrice === MIN_PRICE) {
    console.log(`  ℹ️  Pool is trading at floor price - demand is low`);
    console.log(`     To sell more XNT, need more USDC demand`);
  } else if (avgPrice < MIN_PRICE) {
    console.log(`  ℹ️  Total demand below minimum - only sold ${pctSold.toFixed(1)}%`);
    console.log(`     Need $${(INITIAL_XNT * MIN_PRICE).toLocaleString()} USDC to sell entire pool`);
  } else {
    console.log(`  ℹ️  Pool is trading above floor - strong demand!`);
    console.log(`     Price increased ${((avgPrice / MIN_PRICE - 1) * 100).toFixed(1)}% from base`);
  }
  console.log(``);
}

// Parse CLI arguments
const args = process.argv.slice(2);
let continuous = false;
let ordersCount = 1000;
let usdcPerOrder = 1000;
let delayMs = 1000; // Default to 1 second for visual appeal

// Check for -c (continuous) flag
if (args.includes('-c') || args.includes('--continuous')) {
  continuous = true;
  // Remove the flag from args
  const flagIndex = args.findIndex(arg => arg === '-c' || arg === '--continuous');
  args.splice(flagIndex, 1);
}

// Parse remaining args
if (args.length > 0) ordersCount = parseInt(args[0]) || 1000;
if (args.length > 1) usdcPerOrder = parseInt(args[1]) || 1000;
if (args.length > 2) delayMs = parseInt(args[2]) || 1000;

if (continuous) {
  // In continuous mode, keep running until interrupted
  console.log("\n🔄 CONTINUOUS MODE - Press Ctrl+C to stop\n");
  ordersCount = Number.MAX_SAFE_INTEGER; // Effectively infinite
}

// Run simulation
runSimulation(ordersCount, usdcPerOrder, delayMs).catch(console.error);
