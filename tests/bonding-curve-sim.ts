/**
 * Bonding Curve Trading Simulation (Constant Product)
 * Price increases/decreases with BUY/SELL trades
 *
 * Usage:
 *   npx ts-node --transpile-only tests/bonding-curve-sim.ts [trades] [usdc_per_trade] [delay_ms] [buy_pct] [-c]
 *
 * Arguments:
 *   trades        - Number of trades (default: 100)
 *   usdc_per_trade - USDC per trade (default: 1000)
 *   delay_ms      - Delay between trades in ms (default: 100)
 *   buy_pct       - Percentage of BUY orders 0-100 (default: 50, use 100 for USDC-only mode)
 *   -c            - Continuous mode
 */

// Pool state for constant product AMM
interface BondingCurvePool {
  xntReserve: number;    // XNT in pool
  usdcReserve: number;   // USDC in pool
  k: number;             // Constant product (x * y = k)
  tradeCount: number;
}

const INITIAL_XNT = 1_000_000;
const INITIAL_USDC = 1_000_000; // Virtual USDC to bootstrap at $1.00 starting price

// Create initial pool with constant product
function createBondingCurvePool(): BondingCurvePool {
  const k = INITIAL_XNT * INITIAL_USDC;
  return {
    xntReserve: INITIAL_XNT,
    usdcReserve: INITIAL_USDC,
    k,
    tradeCount: 0,
  };
}

// Execute a buy order using constant product formula
function executeBondingCurveBuy(pool: BondingCurvePool, usdcIn: number): {
  xntOut: number;
  price: number;
  newPrice: number;
  xntRemaining: number;
  totalUSDC: number;
} {
  // Constant product: x * y = k
  // When adding USDC: new_y = y + usdc_in
  // new_x = k / new_y
  // xnt_out = x - new_x

  const newUsdcReserve = pool.usdcReserve + usdcIn;
  const newXntReserve = pool.k / newUsdcReserve;
  const xntOut = pool.xntReserve - newXntReserve;

  // Price BEFORE this trade
  const priceBefore = pool.usdcReserve / pool.xntReserve;

  // Price AFTER this trade
  const priceAfter = newUsdcReserve / newXntReserve;

  // Effective price for THIS trade
  const effectivePrice = usdcIn / xntOut;

  // Update pool
  pool.xntReserve = newXntReserve;
  pool.usdcReserve = newUsdcReserve;
  pool.tradeCount += 1;

  return {
    xntOut,
    price: effectivePrice,
    newPrice: priceAfter,
    xntRemaining: newXntReserve,
    totalUSDC: newUsdcReserve - INITIAL_USDC, // Subtract virtual bootstrap
  };
}

// Execute a sell order using constant product formula
function executeBondingCurveSell(pool: BondingCurvePool, xntIn: number): {
  usdcOut: number;
  price: number;
  newPrice: number;
  xntRemaining: number;
  totalUSDC: number;
} {
  // Constant product: x * y = k
  // When adding XNT: new_x = x + xnt_in
  // new_y = k / new_x
  // usdc_out = y - new_y

  const newXntReserve = pool.xntReserve + xntIn;
  const newUsdcReserve = pool.k / newXntReserve;
  const usdcOut = pool.usdcReserve - newUsdcReserve;

  // Price BEFORE this trade
  const priceBefore = pool.usdcReserve / pool.xntReserve;

  // Price AFTER this trade
  const priceAfter = newUsdcReserve / newXntReserve;

  // Effective price for THIS trade
  const effectivePrice = usdcOut / xntIn;

  // Update pool
  pool.xntReserve = newXntReserve;
  pool.usdcReserve = newUsdcReserve;
  pool.tradeCount += 1;

  return {
    usdcOut,
    price: effectivePrice,
    newPrice: priceAfter,
    xntRemaining: newXntReserve,
    totalUSDC: newUsdcReserve - INITIAL_USDC,
  };
}

// Format number
function fmt(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Print table header
function printHeader() {
  console.log("╔═══════╦══════╦═══════════════╦═══════════════╦═══════════════╦═══════════════╦═══════════════╦═══════════════╗");
  console.log("║ Trade ║ Type ║   Amount      ║   Received    ║  Price/XNT    ║  New Price    ║ Total USDC    ║  XNT Remaining║");
  console.log("╠═══════╬══════╬═══════════════╬═══════════════╬═══════════════╬═══════════════╬═══════════════╬═══════════════╣");
}

function printFooter() {
  console.log("╚═══════╩══════╩═══════════════╩═══════════════╩═══════════════╩═══════════════╩═══════════════╩═══════════════╝");
}

function printRow(
  trade: number,
  type: 'BUY' | 'SELL',
  amountIn: number,
  amountOut: number,
  price: number,
  newPrice: number,
  totalUSDC: number,
  xntRemaining: number
) {
  const tradeStr = String(trade).padStart(5);
  const typeStr = type === 'BUY' ? ' BUY ' : 'SELL';
  const amountInStr = type === 'BUY'
    ? ("$" + fmt(amountIn)).padStart(13)
    : (fmt(amountIn) + " XNT").padStart(13);
  const amountOutStr = type === 'BUY'
    ? (fmt(amountOut) + " XNT").padStart(13)
    : ("$" + fmt(amountOut)).padStart(13);
  const priceStr = ("$" + price.toFixed(4)).padStart(13);
  const newPriceStr = ("$" + newPrice.toFixed(4)).padStart(13);
  const totalUSDCStr = ("$" + fmt(totalUSDC)).padStart(13);
  const xntRemStr = fmt(xntRemaining).padStart(13);

  console.log(`║ ${tradeStr} ║ ${typeStr} ║ ${amountInStr} ║ ${amountOutStr} ║ ${priceStr} ║ ${newPriceStr} ║ ${totalUSDCStr} ║ ${xntRemStr} ║`);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Main simulation
async function runSimulation(ordersCount: number, usdcPerOrder: number, delayMs: number, buyPercentage: number = 50) {
  const sellPercentage = 100 - buyPercentage;
  const tradeMixLabel = buyPercentage === 100
    ? "100% BUY (USDC-only mode)"
    : buyPercentage === 0
    ? "100% SELL"
    : `${buyPercentage}% BUY / ${sellPercentage}% SELL (random)`;

  console.log("\n╔════════════════════════════════════════════════════════════════════════════════════════╗");
  console.log("║                   BONDING CURVE AMM - LIVE TRADING SIMULATION                         ║");
  console.log("║                        (Constant Product: x * y = k)                                  ║");
  console.log(`║                          ${tradeMixLabel.padEnd(58)}║`);
  console.log("╚════════════════════════════════════════════════════════════════════════════════════════╝\n");

  console.log(`📊 Simulation Parameters:`);
  console.log(`   Initial XNT Reserve: ${INITIAL_XNT.toLocaleString()} XNT`);
  console.log(`   Initial USDC Reserve: ${INITIAL_USDC.toLocaleString()} USDC (virtual bootstrap)`);
  console.log(`   Starting Price: $${(INITIAL_USDC / INITIAL_XNT).toFixed(2)}`);
  console.log(`   Constant k: ${(INITIAL_XNT * INITIAL_USDC).toExponential(2)}`);
  console.log(`   Total Orders: ${ordersCount.toLocaleString()}`);
  console.log(`   Trade Size: ~$${usdcPerOrder.toLocaleString()} USDC equivalent`);
  console.log(`   Trade Mix: ${tradeMixLabel}`);
  console.log(`   Delay per Trade: ${delayMs}ms\n`);

  const pool = createBondingCurvePool();
  const startingPrice = pool.usdcReserve / pool.xntReserve;

  let buyCount = 0;
  let sellCount = 0;

  printHeader();

  // Execute trades
  for (let i = 1; i <= ordersCount; i++) {
    // Randomly choose BUY or SELL based on buyPercentage
    const isBuy = Math.random() * 100 < buyPercentage;

    let tradeType: 'BUY' | 'SELL';
    let amountIn: number;
    let amountOut: number;
    let effectivePrice: number;
    let newPrice: number;
    let xntRemaining: number;
    let totalUSDC: number;

    if (isBuy) {
      // Execute buy order
      const result = executeBondingCurveBuy(pool, usdcPerOrder);
      tradeType = 'BUY';
      amountIn = usdcPerOrder;
      amountOut = result.xntOut;
      effectivePrice = result.price;
      newPrice = result.newPrice;
      xntRemaining = result.xntRemaining;
      totalUSDC = result.totalUSDC;
      buyCount++;
    } else {
      // Execute sell order - sell equivalent XNT value
      const currentPrice = pool.usdcReserve / pool.xntReserve;
      const xntToSell = usdcPerOrder / currentPrice; // Sell roughly same $ value

      const result = executeBondingCurveSell(pool, xntToSell);
      tradeType = 'SELL';
      amountIn = xntToSell;
      amountOut = result.usdcOut;
      effectivePrice = result.price;
      newPrice = result.newPrice;
      xntRemaining = result.xntRemaining;
      totalUSDC = result.totalUSDC;
      sellCount++;
    }

    // Print every trade, or every 10th if > 100 trades
    const shouldPrint =
      ordersCount <= 100 ||
      (ordersCount <= 1000 && i % 10 === 0) ||
      (ordersCount > 1000 && i % 100 === 0) ||
      i === 1 ||
      i === ordersCount;

    if (shouldPrint) {
      printRow(
        i,
        tradeType,
        amountIn,
        amountOut,
        effectivePrice,
        newPrice,
        totalUSDC,
        xntRemaining
      );
    }

    // Check if pool is nearly exhausted (< 1000 XNT remaining for buys)
    if (isBuy && xntRemaining < 1000) {
      console.log("╠═══════╬══════╬═══════════════╬═══════════════╬═══════════════╬═══════════════╬═══════════════╬═══════════════╣");
      console.log("║       ║      ║  ⚠️  POOL NEARLY EMPTY - PRICES EXTREMELY HIGH                                     ║");
      console.log("╠═══════╬══════╬═══════════════╬═══════════════╬═══════════════╬═══════════════╬═══════════════╬═══════════════╣");
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

  const xntChange = INITIAL_XNT - pool.xntReserve;
  const currentPrice = pool.usdcReserve / pool.xntReserve;
  const priceChange = ((currentPrice / startingPrice - 1) * 100);
  const totalRealUSDC = pool.usdcReserve - INITIAL_USDC;

  console.log(`  📈 Total Trades Executed: ${pool.tradeCount.toLocaleString()}`);
  console.log(`  📊 Trade Breakdown:`);
  console.log(`     - BUY orders: ${buyCount.toLocaleString()} (${((buyCount / pool.tradeCount) * 100).toFixed(1)}%)`);
  console.log(`     - SELL orders: ${sellCount.toLocaleString()} (${((sellCount / pool.tradeCount) * 100).toFixed(1)}%)`);
  console.log(`  💰 Net USDC in Pool: $${fmt(totalRealUSDC)} (excluding bootstrap)`);
  console.log(`  💎 XNT Reserve: ${fmt(pool.xntReserve)} (${xntChange > 0 ? '-' : '+'}${Math.abs(xntChange).toLocaleString()} from start)`);
  console.log(`  💵 USDC Reserve: $${fmt(pool.usdcReserve)}`);
  console.log(`  📊 Starting Price: $${startingPrice.toFixed(6)}`);
  console.log(`  📊 Current Price: $${currentPrice.toFixed(6)}`);
  console.log(`  📈 Price Change: ${priceChange > 0 ? '+' : ''}${priceChange.toFixed(2)}%`);
  console.log(`  🎯 Market Impact:`);

  if (Math.abs(priceChange) < 5) {
    console.log(`     ⚖️  Balanced market - BUY/SELL pressure nearly equal`);
  } else if (priceChange > 50) {
    console.log(`     🚀 Strong upward momentum - net buying pressure`);
  } else if (priceChange > 10) {
    console.log(`     📈 Moderate upward trend - more buyers than sellers`);
  } else if (priceChange < -50) {
    console.log(`     📉 Strong downward momentum - net selling pressure`);
  } else if (priceChange < -10) {
    console.log(`     📉 Moderate downward trend - more sellers than buyers`);
  }

  console.log(``);
  console.log(`  💡 Key Insights:`);
  console.log(`     - BUY orders push price UP (add USDC, remove XNT)`);
  console.log(`     - SELL orders push price DOWN (add XNT, remove USDC)`);
  console.log(`     - Price discovery is automatic and continuous`);
  console.log(`     - Constant product (x * y = k) ensures liquidity always exists`);
  console.log(`     - Random order mix creates realistic price action`);
  console.log(``);
}

// Parse CLI arguments
const args = process.argv.slice(2);
let continuous = false;
let ordersCount = 100;
let usdcPerOrder = 1000;
let delayMs = 100;
let buyPercentage = 50;

if (args.includes('-c') || args.includes('--continuous')) {
  continuous = true;
  const flagIndex = args.findIndex(arg => arg === '-c' || arg === '--continuous');
  args.splice(flagIndex, 1);
}

if (args.length > 0) ordersCount = parseInt(args[0]) || 100;
if (args.length > 1) usdcPerOrder = parseInt(args[1]) || 1000;
if (args.length > 2) delayMs = parseInt(args[2]) || 100;
if (args.length > 3) buyPercentage = Math.max(0, Math.min(100, parseInt(args[3]) || 50));

if (continuous) {
  console.log("\n🔄 CONTINUOUS MODE - Press Ctrl+C to stop\n");
  ordersCount = Number.MAX_SAFE_INTEGER;
}

runSimulation(ordersCount, usdcPerOrder, delayMs, buyPercentage).catch(console.error);
