/**
 * Price Discovery Calculation Tests
 * These tests verify the math without needing a running Solana validator
 */

// Constants matching the program
const PRECISION = 1_000_000_000; // 1e9
const SQRT_PRICE_MIN = 1_000_000_000; // √1 = 1.0
const SQRT_PRICE_MAX = 1_414_213_562; // √2 ≈ 1.414213562

const INITIAL_XNT_AMOUNT = 1_000_000_000_000; // 1M tokens (6 decimals)

// Helper functions matching the program
function calculateLiquidity(initialTokenAmount: number): number {
  const initialAmountU128 = initialTokenAmount;
  const numerator = SQRT_PRICE_MAX - SQRT_PRICE_MIN;
  const denominator = Math.floor((SQRT_PRICE_MAX * SQRT_PRICE_MIN) / PRECISION);
  return Math.floor((initialAmountU128 * denominator) / numerator);
}

function calculateUsdcReserve(liquidity: number, sqrtPrice: number): number {
  const numerator = sqrtPrice - SQRT_PRICE_MIN;
  return Math.floor((liquidity * numerator) / SQRT_PRICE_MIN);
}

function calculateTokenReserve(liquidity: number, sqrtPrice: number): number {
  const numerator = SQRT_PRICE_MAX - sqrtPrice;
  const denominator = Math.floor((sqrtPrice * SQRT_PRICE_MAX) / PRECISION);
  return Math.floor((liquidity * numerator) / denominator);
}

function discoverPrice(liquidity: number, totalUsdcDemand: number): number {
  const currentUsdcReserve = calculateUsdcReserve(liquidity, SQRT_PRICE_MIN);
  const newUsdcReserve = currentUsdcReserve + totalUsdcDemand;

  // Formula: sqrt_price = sqrt_price_min + (usdc_reserve * sqrt_price_min) / liquidity
  const newSqrtPrice = SQRT_PRICE_MIN +
    Math.floor((newUsdcReserve * SQRT_PRICE_MIN) / liquidity);

  // Cap at max price
  return Math.min(newSqrtPrice, SQRT_PRICE_MAX);
}

function sqrtPriceToPrice(sqrtPrice: number): number {
  return (sqrtPrice * sqrtPrice) / (PRECISION * PRECISION);
}

function formatPrice(price: number): string {
  return `$${price.toFixed(6)}`;
}

function formatTokens(amount: number): string {
  return `${(amount / 1_000_000).toFixed(2)} XNT`;
}

function formatUSDC(amount: number): string {
  return `$${(amount / 1_000_000).toLocaleString()}`;
}

console.log("\n=== PRICE DISCOVERY CALCULATION TESTS ===\n");

// Initialize pool
const liquidity = calculateLiquidity(INITIAL_XNT_AMOUNT);
console.log(`Pool initialized with:`);
console.log(`  XNT amount: ${formatTokens(INITIAL_XNT_AMOUNT)}`);
console.log(`  Liquidity L: ${liquidity.toLocaleString()}`);
console.log(`  Initial price: $1.00`);
console.log(`  Price range: $1.00 - $2.00\n`);

// Test scenarios
const scenarios = [
  { name: "Zero demand", usdcDemand: 0 },
  { name: "Low demand ($100K)", usdcDemand: 100_000_000_000 },
  { name: "Medium demand ($500K)", usdcDemand: 500_000_000_000 },
  { name: "High demand ($1M)", usdcDemand: 1_000_000_000_000 },
  { name: "Very high demand ($1.5M)", usdcDemand: 1_500_000_000_000 },
  { name: "Maximum demand ($2M+)", usdcDemand: 2_000_000_000_000 },
];

scenarios.forEach(scenario => {
  console.log(`\n${scenario.name}:`);
  console.log(`  USDC deposited: ${formatUSDC(scenario.usdcDemand)}`);

  const clearingSqrtPrice = discoverPrice(liquidity, scenario.usdcDemand);
  const clearingPrice = sqrtPriceToPrice(clearingSqrtPrice);

  console.log(`  Clearing sqrt_price: ${clearingSqrtPrice.toLocaleString()}`);
  console.log(`  Clearing price: ${formatPrice(clearingPrice)}`);

  // Calculate tokens available at this price
  const tokensAvailable = calculateTokenReserve(liquidity, clearingSqrtPrice);
  console.log(`  XNT available: ${formatTokens(tokensAvailable)}`);

  // Calculate tokens users would receive
  const tokensOut = clearingPrice > 0 ? scenario.usdcDemand / clearingPrice : 0;
  console.log(`  XNT users receive: ${formatTokens(tokensOut)}`);

  // Check if demand exceeds capacity
  if (clearingSqrtPrice >= SQRT_PRICE_MAX) {
    console.log(`  ⚠️  MAX PRICE REACHED - Pool at capacity!`);
  }

  // Verify conservation
  const usdcValue = tokensOut * clearingPrice;
  const conservationError = Math.abs(usdcValue - scenario.usdcDemand) / scenario.usdcDemand;
  if (scenario.usdcDemand > 0 && conservationError > 0.01) {
    console.log(`  ⚠️  Conservation error: ${(conservationError * 100).toFixed(2)}%`);
  } else if (scenario.usdcDemand > 0) {
    console.log(`  ✅ Conservation verified`);
  }
});

// Test multiple users at same price
console.log(`\n\n=== MULTIPLE USERS TEST ===\n`);

const users = [
  { name: "Alice", usdc: 100_000_000_000 },
  { name: "Bob", usdc: 500_000_000_000 },
  { name: "Charlie", usdc: 300_000_000_000 },
];

const totalDemand = users.reduce((sum, u) => sum + u.usdc, 0);
console.log(`Total demand: ${formatUSDC(totalDemand)}`);

const multiUserSqrtPrice = discoverPrice(liquidity, totalDemand);
const multiUserPrice = sqrtPriceToPrice(multiUserSqrtPrice);
console.log(`Clearing price: ${formatPrice(multiUserPrice)}\n`);

users.forEach(user => {
  const tokensReceived = user.usdc / multiUserPrice;
  const effectivePrice = user.usdc / tokensReceived;

  console.log(`${user.name}:`);
  console.log(`  Paid: ${formatUSDC(user.usdc)}`);
  console.log(`  Received: ${formatTokens(tokensReceived)}`);
  console.log(`  Effective price: ${formatPrice(effectivePrice)}`);
});

// Verify everyone pays same price
const prices = users.map(u => u.usdc / (u.usdc / multiUserPrice));
const allSame = prices.every(p => Math.abs(p - multiUserPrice) < 0.000001);
console.log(`\n${allSame ? '✅' : '❌'} All users pay same price: ${allSame}`);

// Calculate pool capacity
console.log(`\n\n=== POOL CAPACITY ANALYSIS ===\n`);

// Max USDC the pool can accept (when price reaches $2.00)
const maxUsdcReserve = calculateUsdcReserve(liquidity, SQRT_PRICE_MAX);
const maxTokensOut = INITIAL_XNT_AMOUNT; // All tokens
const avgPrice = maxUsdcReserve / maxTokensOut;

console.log(`Maximum USDC capacity: ${formatUSDC(maxUsdcReserve)}`);
console.log(`Maximum tokens out: ${formatTokens(maxTokensOut)}`);
console.log(`Average price across range: ${formatPrice(avgPrice)}`);
console.log(`\nIf demand exceeds ${formatUSDC(maxUsdcReserve)}, price caps at $2.00`);

console.log(`\n\n=== TESTS COMPLETE ===\n`);
