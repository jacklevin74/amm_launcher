/**
 * E6 USDC AMM Simulation Test
 *
 * This test suite simulates the entire AMM logic from the Rust program
 * using TypeScript to validate the e6 USDC normalization approach.
 *
 * Tests cover:
 * - Pool initialization with virtual USDC
 * - Buy operations (USDC → XNT)
 * - Sell operations (XNT → USDC)
 * - Price calculations
 * - Ceiling defense mechanism
 * - Price floor enforcement
 * - Reserve management
 *
 * NO SOLANA DEPENDENCIES - Pure mathematical simulation
 */

import { expect } from 'chai';

// ============================================================================
// CONSTANTS (matching Rust program)
// ============================================================================

const USDC_DECIMALS = 6;
const XNT_DECIMALS = 9;
const USDC_MULTIPLIER = 1000; // 10^(XNT_DECIMALS - USDC_DECIMALS)

const PRICE_CEILING = 2_000_000; // $2.00 (6 decimals)
const PRICE_FLOOR = 1_000_000;   // $1.00 (6 decimals)

// ============================================================================
// POOL STATE (matching Rust struct)
// ============================================================================

interface Pool {
  xntReserve: bigint;           // e9 - XNT reserve
  usdcReserve: bigint;          // e9 - USDC reserve (normalized internally!)
  k: bigint;                    // e18 - constant product
  tradeCount: number;
  priceCeiling: bigint;         // e6 - $2.00
  priceFloor: bigint;           // e6 - $1.00
  priceFloorEnabled: boolean;
  ceilingReserveXnt: bigint;    // e9 - ceiling reserve balance
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Normalize e6 USDC to e9 for internal calculations
 */
function normalizeUsdc(usdcE6: bigint): bigint {
  return usdcE6 * BigInt(USDC_MULTIPLIER);
}

/**
 * Denormalize e9 USDC to e6 for transfers
 */
function denormalizeUsdc(usdcE9: bigint): bigint {
  return usdcE9 / BigInt(USDC_MULTIPLIER);
}

/**
 * Calculate price with 6 decimal precision
 * Formula: (usdc * 1e6) / xnt
 */
function calculatePrice(usdcReserve: bigint, xntReserve: bigint): bigint {
  return (usdcReserve * BigInt(1_000_000)) / xntReserve;
}

/**
 * Format token amount for display
 */
function formatE9(amount: bigint): string {
  return (Number(amount) / 1e9).toFixed(6);
}

function formatE6(amount: bigint): string {
  return (Number(amount) / 1e6).toFixed(6);
}

function formatPrice(price: bigint): string {
  return `$${(Number(price) / 1e6).toFixed(6)}`;
}

/**
 * Convert bigint to number for assertions
 * Chai doesn't handle BigInt well, so we convert for comparisons
 */
function toNum(value: bigint): number {
  return Number(value);
}

// ============================================================================
// AMM OPERATIONS (matching Rust program logic)
// ============================================================================

/**
 * Initialize pool with single-sided XNT liquidity
 * Uses virtual USDC for price bootstrapping
 */
function initializePool(
  xntAmount: bigint,              // e9 - XNT deposit
  virtualUsdcAmountRaw: bigint,   // e6 - virtual USDC (user input)
  ceilingReserveXnt: bigint       // e9 - initial ceiling reserve
): Pool {
  // NORMALIZE: Convert e6 input to e9 for internal storage
  const virtualUsdcAmount = normalizeUsdc(virtualUsdcAmountRaw);

  // Calculate constant product
  const k = xntAmount * virtualUsdcAmount;

  return {
    xntReserve: xntAmount,
    usdcReserve: virtualUsdcAmount,  // Stored as e9!
    k,
    tradeCount: 0,
    priceCeiling: BigInt(PRICE_CEILING),
    priceFloor: BigInt(PRICE_FLOOR),
    priceFloorEnabled: true,
    ceilingReserveXnt,
  };
}

/**
 * Buy XNT with USDC using constant product formula
 * Automatically injects XNT from ceiling reserve if price approaches ceiling
 */
function buy(
  pool: Pool,
  usdcAmountRaw: bigint  // e6 - user deposits this
): {
  pool: Pool;
  xntOut: bigint;        // e9 - user receives this
  usdcTransferred: bigint; // e6 - actual transfer amount
  xntInjected: bigint;   // e9 - amount injected from ceiling reserve
  priceBefore: bigint;   // e6
  priceAfter: bigint;    // e6
  effectivePrice: bigint; // e6
} {
  // NORMALIZE: Convert e6 input to e9 for calculations
  const usdcAmount = normalizeUsdc(usdcAmountRaw);

  // Calculate new USDC reserve (add user's USDC)
  const newUsdcReserve = pool.usdcReserve + usdcAmount;

  // Calculate new XNT reserve using constant product formula
  // k = x * y (constant)
  // new_xnt_reserve = k / new_usdc_reserve
  const newXntReserve = pool.k / newUsdcReserve;

  if (newXntReserve >= pool.xntReserve) {
    throw new Error('InsufficientLiquidity');
  }

  // Calculate XNT output
  const xntOut = pool.xntReserve - newXntReserve;

  if (xntOut === 0n) {
    throw new Error('ZeroOutput');
  }

  // Calculate prices
  const priceBefore = calculatePrice(pool.usdcReserve, pool.xntReserve);
  const priceAfter = calculatePrice(newUsdcReserve, newXntReserve);
  const effectivePrice = (usdcAmount * BigInt(1_000_000)) / xntOut;

  console.log(`  Buy: ${formatE6(usdcAmountRaw)} USDC → ${formatE9(xntOut)} XNT`);
  console.log(`  Price: ${formatPrice(priceBefore)} → ${formatPrice(priceAfter)} (effective: ${formatPrice(effectivePrice)})`);

  // AUTO-CEILING DEFENSE: If price would exceed ceiling, inject XNT from reserve
  let xntInjected = 0n;
  let finalXntReserve = newXntReserve;
  let finalPriceAfter = priceAfter;

  if (priceAfter > pool.priceCeiling) {
    console.log(`  ⚠️  CEILING BREACH! Price would be ${formatPrice(priceAfter)}, ceiling is ${formatPrice(pool.priceCeiling)}`);

    // Calculate how much XNT to inject to bring price back to ceiling
    // Target: new_usdc / (new_xnt + injection) = price_ceiling
    // Solve for injection: injection = (new_usdc * 1e6 / price_ceiling) - new_xnt
    const targetXntReserve = (newUsdcReserve * BigInt(1_000_000)) / pool.priceCeiling;
    xntInjected = targetXntReserve - newXntReserve + BigInt(1_000_000); // +1 XNT buffer

    if (xntInjected > pool.ceilingReserveXnt) {
      throw new Error('InsufficientCeilingReserve');
    }

    console.log(`  💉 Injecting ${formatE9(xntInjected)} XNT from ceiling reserve`);

    // Recalculate after injection
    finalXntReserve = newXntReserve + xntInjected;
    finalPriceAfter = calculatePrice(newUsdcReserve, finalXntReserve);

    console.log(`  ✅ Price defended: ${formatPrice(finalPriceAfter)}`);
  }

  // Update pool state
  const updatedPool: Pool = {
    ...pool,
    xntReserve: finalXntReserve,
    usdcReserve: newUsdcReserve,
    k: finalXntReserve * newUsdcReserve, // Update k after ceiling defense
    ceilingReserveXnt: pool.ceilingReserveXnt - xntInjected,
    tradeCount: pool.tradeCount + 1,
  };

  return {
    pool: updatedPool,
    xntOut,
    usdcTransferred: usdcAmountRaw, // Transfer original e6 amount
    xntInjected,
    priceBefore,
    priceAfter: finalPriceAfter,
    effectivePrice,
  };
}

/**
 * Sell XNT for USDC using constant product formula
 * AUTO-DEFENDS price floor by buying back XNT from pool with defense reserve
 */
function sell(
  pool: Pool,
  xntAmount: bigint  // e9 - user deposits this
): {
  pool: Pool;
  usdcOut: bigint;        // e6 - user receives this (denormalized!)
  usdcOutInternal: bigint; // e9 - internal calculation
  xntTransferred: bigint; // e9 - actual transfer amount
  xntRemoved: bigint;     // e9 - XNT bought back by defense reserve to defend floor
  priceBefore: bigint;    // e6
  priceAfter: bigint;     // e6
  effectivePrice: bigint; // e6
} {
  // Calculate new XNT reserve (add user's XNT)
  const newXntReserve = pool.xntReserve + xntAmount;

  // Calculate new USDC reserve using constant product formula
  // new_usdc_reserve = k / new_xnt_reserve
  const newUsdcReserve = pool.k / newXntReserve;

  if (newUsdcReserve >= pool.usdcReserve) {
    throw new Error('InsufficientLiquidity');
  }

  // Calculate USDC output (in e9 internally)
  const usdcOutInternal = pool.usdcReserve - newUsdcReserve;

  // DENORMALIZE: Convert e9 to e6 for transfer
  const usdcOut = denormalizeUsdc(usdcOutInternal);

  if (usdcOut === 0n) {
    throw new Error('ZeroOutput');
  }

  // Calculate prices
  const priceBefore = calculatePrice(pool.usdcReserve, pool.xntReserve);
  let priceAfter = calculatePrice(newUsdcReserve, newXntReserve);
  const effectivePrice = (usdcOutInternal * BigInt(1_000_000)) / xntAmount;

  console.log(`  Sell: ${formatE9(xntAmount)} XNT → ${formatE6(usdcOut)} USDC`);
  console.log(`  Price: ${formatPrice(priceBefore)} → ${formatPrice(priceAfter)} (effective: ${formatPrice(effectivePrice)})`);

  // AUTO-FLOOR DEFENSE: Buy back XNT from pool if price falls below floor
  let xntRemoved = 0n;
  let finalXntReserve = newXntReserve;
  let finalPriceAfter = priceAfter;

  if (pool.priceFloorEnabled && priceAfter < pool.priceFloor) {
    console.log(`  ⚠️  FLOOR BREACH! Price would be ${formatPrice(priceAfter)}, floor is ${formatPrice(pool.priceFloor)}`);

    // Calculate how much XNT to buy back from pool to bring price back to floor
    // Target: new_usdc / (new_xnt - removal) = price_floor
    // Solve: removal = new_xnt - (new_usdc * 1e6 / price_floor)
    const targetXntReserve = (newUsdcReserve * BigInt(1_000_000)) / pool.priceFloor;
    xntRemoved = newXntReserve - targetXntReserve - BigInt(1_000_000); // Subtract 1 XNT buffer

    if (xntRemoved < 0n) xntRemoved = 0n;

    console.log(`  🛡️  Buying back ${formatE9(xntRemoved)} XNT from pool with defense reserve`);

    // Recalculate after buyback
    finalXntReserve = newXntReserve - xntRemoved;
    finalPriceAfter = calculatePrice(newUsdcReserve, finalXntReserve);

    console.log(`  ✅ Floor defended: ${formatPrice(finalPriceAfter)}`);
  }

  // Update pool state
  const updatedPool: Pool = {
    ...pool,
    xntReserve: finalXntReserve,
    usdcReserve: newUsdcReserve,
    k: finalXntReserve * newUsdcReserve, // Update k after floor defense
    ceilingReserveXnt: pool.ceilingReserveXnt + xntRemoved,
    tradeCount: pool.tradeCount + 1,
  };

  return {
    pool: updatedPool,
    usdcOut,
    usdcOutInternal,
    xntTransferred: xntAmount,
    xntRemoved,
    priceBefore,
    priceAfter: finalPriceAfter,
    effectivePrice,
  };
}

/**
 * Fund ceiling reserve (authority operation)
 */
function fundCeilingReserve(pool: Pool, xntAmount: bigint): Pool {
  return {
    ...pool,
    ceilingReserveXnt: pool.ceilingReserveXnt + xntAmount,
  };
}

/**
 * Withdraw from ceiling reserve (authority operation)
 */
function withdrawCeilingReserve(pool: Pool, xntAmount: bigint): Pool {
  if (xntAmount > pool.ceilingReserveXnt) {
    throw new Error('InsufficientCeilingReserve');
  }
  return {
    ...pool,
    ceilingReserveXnt: pool.ceilingReserveXnt - xntAmount,
  };
}

// ============================================================================
// TEST SUITE
// ============================================================================

describe('E6 USDC AMM Simulation', () => {

  // ========================================================================
  // INITIALIZATION TESTS
  // ========================================================================

  describe('Pool Initialization', () => {
    it('should initialize pool with correct reserves and price', () => {
      const xntAmount = BigInt(10_000_000) * BigInt(1e9); // 10M XNT (e9)
      const usdcAmount = BigInt(10_000_000) * BigInt(1e6); // 10M USDC (e6)
      const ceilingReserve = BigInt(10_000_000) * BigInt(1e9); // 10M XNT (e9)

      const pool = initializePool(xntAmount, usdcAmount, ceilingReserve);

      // Check reserves
      expect(pool.xntReserve).to.equal(xntAmount);
      expect(pool.usdcReserve).to.equal(normalizeUsdc(usdcAmount)); // Should be e9 internally!

      // Check k (e9 * e9 = e18)
      expect(pool.k).to.equal(xntAmount * normalizeUsdc(usdcAmount));

      // Check price (should be $1.00)
      const price = calculatePrice(pool.usdcReserve, pool.xntReserve);
      expect(price).to.equal(BigInt(PRICE_FLOOR)); // $1.00

      // Check ceiling reserve
      expect(pool.ceilingReserveXnt).to.equal(ceilingReserve);

      console.log('Pool initialized:');
      console.log(`  XNT Reserve: ${formatE9(pool.xntReserve)}`);
      console.log(`  USDC Reserve (normalized): ${formatE9(pool.usdcReserve)}`);
      console.log(`  Price: ${formatPrice(price)}`);
      console.log(`  K: ${pool.k}`);
      console.log(`  Ceiling Reserve: ${formatE9(pool.ceilingReserveXnt)}`);
    });

    it('should correctly normalize e6 USDC to e9 internally', () => {
      const usdcE6 = BigInt(1_000_000); // 1 USDC (e6)
      const usdcE9 = normalizeUsdc(usdcE6);

      expect(usdcE9).to.equal(BigInt(1_000_000_000)); // 1 USDC (e9)
      expect(usdcE9).to.equal(usdcE6 * BigInt(USDC_MULTIPLIER));
    });

    it('should correctly denormalize e9 USDC to e6', () => {
      const usdcE9 = BigInt(1_000_000_000); // 1 USDC (e9)
      const usdcE6 = denormalizeUsdc(usdcE9);

      expect(usdcE6).to.equal(BigInt(1_000_000)); // 1 USDC (e6)
      expect(usdcE6).to.equal(usdcE9 / BigInt(USDC_MULTIPLIER));
    });
  });

  // ========================================================================
  // BUY OPERATION TESTS
  // ========================================================================

  describe('Buy Operations (USDC → XNT)', () => {
    it('should buy XNT with correct 1:1 ratio at $1.00 price', () => {
      // Initialize pool at $1.00
      let pool = initializePool(
        BigInt(10_000_000) * BigInt(1e9), // 10M XNT
        BigInt(10_000_000) * BigInt(1e6), // 10M USDC (e6)
        BigInt(10_000_000) * BigInt(1e9)  // 10M ceiling reserve
      );

      // Buy with 1000 USDC (e6)
      const usdcIn = BigInt(1000) * BigInt(1e6);
      const result = buy(pool, usdcIn);

      // Should get approximately 1000 XNT (accounting for slippage)
      const xntOutNumber = Number(result.xntOut) / 1e9;
      expect(xntOutNumber).to.be.greaterThan(999);
      expect(xntOutNumber).to.be.lessThan(1001);

      // Price should increase slightly
      expect(toNum(result.priceAfter)).to.be.greaterThan(toNum(result.priceBefore));

      // No ceiling injection should occur
      expect(result.xntInjected).to.equal(0n);
    });

    it('should handle small buy correctly', () => {
      let pool = initializePool(
        BigInt(10_000_000) * BigInt(1e9),
        BigInt(10_000_000) * BigInt(1e6),
        BigInt(10_000_000) * BigInt(1e9)
      );

      // Buy with 10 USDC
      const usdcIn = BigInt(10) * BigInt(1e6);
      const result = buy(pool, usdcIn);

      const xntOutNumber = Number(result.xntOut) / 1e9;
      expect(xntOutNumber).to.be.greaterThan(9.99);
      expect(xntOutNumber).to.be.lessThan(10.01);
    });

    it('should handle large buy correctly', () => {
      let pool = initializePool(
        BigInt(10_000_000) * BigInt(1e9),
        BigInt(10_000_000) * BigInt(1e6),
        BigInt(10_000_000) * BigInt(1e9)
      );

      // Buy with 1M USDC
      const usdcIn = BigInt(1_000_000) * BigInt(1e6);
      const result = buy(pool, usdcIn);

      // Should get less than 1M XNT due to significant slippage
      const xntOutNumber = Number(result.xntOut) / 1e9;
      expect(xntOutNumber).to.be.greaterThan(900_000);
      expect(xntOutNumber).to.be.lessThan(1_000_000);

      // Price should increase significantly
      const priceIncrease = Number(result.priceAfter - result.priceBefore) / 1e6;
      expect(priceIncrease).to.be.greaterThan(0.09); // > $0.09 increase
    });

    it('should maintain constant product invariant', () => {
      let pool = initializePool(
        BigInt(10_000_000) * BigInt(1e9),
        BigInt(10_000_000) * BigInt(1e6),
        BigInt(10_000_000) * BigInt(1e9)
      );

      const kBefore = pool.k;

      const result = buy(pool, BigInt(1000) * BigInt(1e6));

      // K should be equal (or very close, accounting for integer division rounding)
      if (result.xntInjected === 0n) {
        // Allow tiny tolerance for integer division rounding (< 0.001%)
        const kDiff = result.pool.k > kBefore ? result.pool.k - kBefore : kBefore - result.pool.k;
        const tolerance = kBefore / 10000n; // 0.01% tolerance
        expect(toNum(kDiff)).to.be.lessThanOrEqual(toNum(tolerance));
      } else {
        // If ceiling defense triggered, k will change
        expect(toNum(result.pool.k)).to.be.greaterThan(toNum(kBefore));
      }
    });

    it('should update pool state correctly', () => {
      let pool = initializePool(
        BigInt(10_000_000) * BigInt(1e9),
        BigInt(10_000_000) * BigInt(1e6),
        BigInt(10_000_000) * BigInt(1e9)
      );

      const usdcIn = BigInt(1000) * BigInt(1e6);
      const result = buy(pool, usdcIn);

      // USDC reserve should increase (normalized)
      expect(result.pool.usdcReserve).to.equal(pool.usdcReserve + normalizeUsdc(usdcIn));

      // XNT reserve should decrease
      expect(toNum(result.pool.xntReserve)).to.be.lessThan(toNum(pool.xntReserve));

      // Trade count should increment
      expect(result.pool.tradeCount).to.equal(pool.tradeCount + 1);
    });
  });

  // ========================================================================
  // SELL OPERATION TESTS
  // ========================================================================

  describe('Sell Operations (XNT → USDC)', () => {
    it('should sell XNT with correct 1:1 ratio at $1.00 price', () => {
      let pool = initializePool(
        BigInt(10_000_000) * BigInt(1e9),
        BigInt(10_000_000) * BigInt(1e6),
        BigInt(10_000_000) * BigInt(1e9)
      );

      // Sell 1000 XNT
      const xntIn = BigInt(1000) * BigInt(1e9);
      const result = sell(pool, xntIn);

      // Should get approximately 1000 USDC (e6)
      const usdcOutNumber = Number(result.usdcOut) / 1e6;
      expect(usdcOutNumber).to.be.greaterThan(999);
      expect(usdcOutNumber).to.be.lessThan(1001);

      // Price should decrease slightly
      expect(toNum(result.priceAfter)).to.be.lessThan(toNum(result.priceBefore));
    });

    it('should handle small sell correctly', () => {
      let pool = initializePool(
        BigInt(10_000_000) * BigInt(1e9),
        BigInt(10_000_000) * BigInt(1e6),
        BigInt(10_000_000) * BigInt(1e9)
      );

      const xntIn = BigInt(10) * BigInt(1e9);
      const result = sell(pool, xntIn);

      const usdcOutNumber = Number(result.usdcOut) / 1e6;
      expect(usdcOutNumber).to.be.greaterThan(9.99);
      expect(usdcOutNumber).to.be.lessThan(10.01);
    });

    it('should handle large sell correctly', () => {
      let pool = initializePool(
        BigInt(10_000_000) * BigInt(1e9),
        BigInt(10_000_000) * BigInt(1e6),
        BigInt(10_000_000) * BigInt(1e9)
      );

      // Disable price floor for this large sell test
      pool.priceFloorEnabled = false;

      const xntIn = BigInt(1_000_000) * BigInt(1e9);
      const result = sell(pool, xntIn);

      // Should get less than 1M USDC due to slippage
      const usdcOutNumber = Number(result.usdcOut) / 1e6;
      expect(usdcOutNumber).to.be.greaterThan(900_000);
      expect(usdcOutNumber).to.be.lessThan(1_000_000);
    });

    it('should auto-defend price floor by removing XNT', () => {
      let pool = initializePool(
        BigInt(10_000_000) * BigInt(1e9),
        BigInt(10_000_000) * BigInt(1e6),
        BigInt(10_000_000) * BigInt(1e9)
      );

      const ceilingReserveBefore = pool.ceilingReserveXnt;

      // Sell massive amount - should trigger floor defense
      const xntIn = BigInt(9_000_000) * BigInt(1e9);
      const result = sell(pool, xntIn);

      // XNT should have been removed from pool to ceiling reserve
      expect(toNum(result.xntRemoved)).to.be.greaterThan(0);

      // Price should be at or very close to floor
      expect(toNum(result.priceAfter)).to.be.greaterThanOrEqual(toNum(BigInt(PRICE_FLOOR)) * 0.999);

      // Ceiling reserve should have increased
      expect(toNum(result.pool.ceilingReserveXnt)).to.be.greaterThan(toNum(ceilingReserveBefore));
    });

    it('should maintain constant product invariant', () => {
      let pool = initializePool(
        BigInt(10_000_000) * BigInt(1e9),
        BigInt(10_000_000) * BigInt(1e6),
        BigInt(10_000_000) * BigInt(1e9)
      );

      const kBefore = pool.k;
      const result = sell(pool, BigInt(1000) * BigInt(1e9));

      // If floor defense triggered, k will change
      if (result.xntRemoved === 0n) {
        // Allow tiny tolerance for integer division rounding (< 0.001%)
        const kDiff = result.pool.k > kBefore ? result.pool.k - kBefore : kBefore - result.pool.k;
        const tolerance = kBefore / 10000n; // 0.01% tolerance
        expect(toNum(kDiff)).to.be.lessThanOrEqual(toNum(tolerance));
      } else {
        // If floor defense triggered, k will be lower (XNT removed)
        expect(toNum(result.pool.k)).to.be.lessThan(toNum(kBefore));
      }
    });

    it('should denormalize USDC output correctly', () => {
      let pool = initializePool(
        BigInt(10_000_000) * BigInt(1e9),
        BigInt(10_000_000) * BigInt(1e6),
        BigInt(10_000_000) * BigInt(1e9)
      );

      const result = sell(pool, BigInt(1000) * BigInt(1e9));

      // Check denormalization
      expect(result.usdcOut).to.equal(denormalizeUsdc(result.usdcOutInternal));

      // Verify it's in e6
      expect(toNum(result.usdcOut)).to.be.lessThan(toNum(BigInt(2000) * BigInt(1e6)));
      expect(toNum(result.usdcOut)).to.be.greaterThan(toNum(BigInt(900) * BigInt(1e6)));
    });
  });

  // ========================================================================
  // CEILING DEFENSE TESTS
  // ========================================================================

  describe('Ceiling Defense Mechanism', () => {
    it('should trigger ceiling defense when price exceeds $2.00', () => {
      // Initialize pool at $1.50
      let pool = initializePool(
        BigInt(10_000_000) * BigInt(1e9),  // 10M XNT
        BigInt(15_000_000) * BigInt(1e6),  // 15M USDC (e6) → $1.50
        BigInt(10_000_000) * BigInt(1e9)   // 10M ceiling reserve
      );

      const priceBefore = calculatePrice(pool.usdcReserve, pool.xntReserve);
      console.log(`Initial price: ${formatPrice(priceBefore)}`);

      // Large buy that would push price above $2.00
      const usdcIn = BigInt(8_000_000) * BigInt(1e6); // 8M USDC
      const result = buy(pool, usdcIn);

      // Should have injected XNT
      expect(toNum(result.xntInjected)).to.be.greaterThan(toNum(0n));
      console.log(`Injected: ${formatE9(result.xntInjected)} XNT`);

      // Final price should be at or below ceiling
      expect(toNum(result.priceAfter)).to.be.lessThanOrEqual(toNum(BigInt(PRICE_CEILING)));

      // Ceiling reserve should be depleted
      expect(toNum(result.pool.ceilingReserveXnt)).to.be.lessThan(toNum(pool.ceilingReserveXnt));
    });

    it('should calculate correct injection amount', () => {
      let pool = initializePool(
        BigInt(10_000_000) * BigInt(1e9),
        BigInt(15_000_000) * BigInt(1e6),
        BigInt(20_000_000) * BigInt(1e9)  // Large ceiling reserve
      );

      const usdcIn = BigInt(10_000_000) * BigInt(1e6);
      const result = buy(pool, usdcIn);

      if (result.xntInjected > 0n) {
        // Verify price is at ceiling
        const finalPrice = calculatePrice(result.pool.usdcReserve, result.pool.xntReserve);
        const priceDiff = Number(finalPrice - BigInt(PRICE_CEILING)) / 1e6;

        // Should be very close to ceiling (within $0.01)
        expect(Math.abs(priceDiff)).to.be.lessThan(0.01);
      }
    });

    it('should fail if ceiling reserve is insufficient', () => {
      let pool = initializePool(
        BigInt(10_000_000) * BigInt(1e9),
        BigInt(15_000_000) * BigInt(1e6),
        BigInt(100_000) * BigInt(1e9)  // Small ceiling reserve
      );

      // Massive buy
      const usdcIn = BigInt(50_000_000) * BigInt(1e6);

      expect(() => buy(pool, usdcIn)).to.throw('InsufficientCeilingReserve');
    });

    it('should not trigger ceiling defense when price stays below ceiling', () => {
      let pool = initializePool(
        BigInt(10_000_000) * BigInt(1e9),
        BigInt(10_000_000) * BigInt(1e6),
        BigInt(10_000_000) * BigInt(1e9)
      );

      const usdcIn = BigInt(100_000) * BigInt(1e6); // Small buy
      const result = buy(pool, usdcIn);

      expect(result.xntInjected).to.equal(0n);
      expect(result.pool.ceilingReserveXnt).to.equal(pool.ceilingReserveXnt);
    });
  });

  // ========================================================================
  // PRICE FLOOR TESTS
  // ========================================================================

  describe('Price Floor Enforcement', () => {
    it('should allow sell when price stays above floor', () => {
      let pool = initializePool(
        BigInt(10_000_000) * BigInt(1e9),
        BigInt(10_000_000) * BigInt(1e6),
        BigInt(10_000_000) * BigInt(1e9)
      );

      const xntIn = BigInt(10_000) * BigInt(1e9); // Very small sell to keep price above floor
      const result = sell(pool, xntIn);

      // Price should stay above effective floor (with 3% tolerance)
      const floorTolerance = (BigInt(PRICE_FLOOR) * 30n) / 1000n;
      const effectiveFloor = BigInt(PRICE_FLOOR) - floorTolerance;
      expect(toNum(result.priceAfter)).to.be.greaterThanOrEqual(toNum(effectiveFloor));
    });

    it('should auto-defend floor on massive sell', () => {
      let pool = initializePool(
        BigInt(10_000_000) * BigInt(1e9),
        BigInt(10_000_000) * BigInt(1e6),
        BigInt(10_000_000) * BigInt(1e9)
      );

      // Massive sell - should trigger floor defense
      const xntIn = BigInt(9_500_000) * BigInt(1e9);
      const result = sell(pool, xntIn);

      // XNT should have been removed
      expect(toNum(result.xntRemoved)).to.be.greaterThan(toNum(BigInt(10_000_000) * BigInt(1e9)));

      // Price should be defended at floor
      expect(toNum(result.priceAfter)).to.be.greaterThanOrEqual(toNum(BigInt(PRICE_FLOOR)) * 0.999);
    });

    it('should allow sell when price floor is disabled', () => {
      let pool = initializePool(
        BigInt(10_000_000) * BigInt(1e9),
        BigInt(10_000_000) * BigInt(1e6),
        BigInt(10_000_000) * BigInt(1e9)
      );

      pool.priceFloorEnabled = false;

      // Large sell
      const xntIn = BigInt(5_000_000) * BigInt(1e9);
      const result = sell(pool, xntIn);

      // Should succeed even if price drops below $1.00
      expect(toNum(result.priceAfter)).to.be.lessThan(toNum(BigInt(PRICE_FLOOR)));
    });
  });

  // ========================================================================
  // RESERVE MANAGEMENT TESTS
  // ========================================================================

  describe('Reserve Management', () => {
    it('should allow funding ceiling reserve', () => {
      let pool = initializePool(
        BigInt(10_000_000) * BigInt(1e9),
        BigInt(10_000_000) * BigInt(1e6),
        BigInt(5_000_000) * BigInt(1e9)
      );

      const fundAmount = BigInt(5_000_000) * BigInt(1e9);
      pool = fundCeilingReserve(pool, fundAmount);

      expect(pool.ceilingReserveXnt).to.equal(BigInt(10_000_000) * BigInt(1e9));
    });

    it('should allow withdrawing from ceiling reserve', () => {
      let pool = initializePool(
        BigInt(10_000_000) * BigInt(1e9),
        BigInt(10_000_000) * BigInt(1e6),
        BigInt(10_000_000) * BigInt(1e9)
      );

      const withdrawAmount = BigInt(3_000_000) * BigInt(1e9);
      pool = withdrawCeilingReserve(pool, withdrawAmount);

      expect(pool.ceilingReserveXnt).to.equal(BigInt(7_000_000) * BigInt(1e9));
    });

    it('should fail withdrawal if insufficient reserve', () => {
      let pool = initializePool(
        BigInt(10_000_000) * BigInt(1e9),
        BigInt(10_000_000) * BigInt(1e6),
        BigInt(5_000_000) * BigInt(1e9)
      );

      const withdrawAmount = BigInt(6_000_000) * BigInt(1e9);

      expect(() => withdrawCeilingReserve(pool, withdrawAmount))
        .to.throw('InsufficientCeilingReserve');
    });
  });

  // ========================================================================
  // COMPREHENSIVE TRADING SCENARIO
  // ========================================================================

  describe('Comprehensive Trading Scenario', () => {
    it('should handle multiple buys and sells correctly', () => {
      console.log('\n========================================');
      console.log('COMPREHENSIVE TRADING SCENARIO');
      console.log('========================================\n');

      let pool = initializePool(
        BigInt(10_000_000) * BigInt(1e9),
        BigInt(10_000_000) * BigInt(1e6),
        BigInt(10_000_000) * BigInt(1e9)
      );

      console.log('Initial state:');
      console.log(`  Price: ${formatPrice(calculatePrice(pool.usdcReserve, pool.xntReserve))}`);
      console.log(`  XNT Reserve: ${formatE9(pool.xntReserve)}`);
      console.log(`  USDC Reserve: ${formatE9(pool.usdcReserve)}`);
      console.log(`  Ceiling Reserve: ${formatE9(pool.ceilingReserveXnt)}\n`);

      // Trade 1: Buy 100k USDC worth
      console.log('Trade 1: Buy 100,000 USDC worth of XNT');
      let result = buy(pool, BigInt(100_000) * BigInt(1e6));
      pool = result.pool;
      console.log('');

      // Trade 2: Buy another 50k
      console.log('Trade 2: Buy 50,000 USDC worth of XNT');
      result = buy(pool, BigInt(50_000) * BigInt(1e6));
      pool = result.pool;
      console.log('');

      // Trade 3: Sell 25k XNT
      console.log('Trade 3: Sell 25,000 XNT');
      let sellResult = sell(pool, BigInt(25_000) * BigInt(1e9));
      pool = sellResult.pool;
      console.log('');

      // Trade 4: Large buy that might trigger ceiling
      console.log('Trade 4: Large buy - 5M USDC');
      result = buy(pool, BigInt(5_000_000) * BigInt(1e6));
      pool = result.pool;
      console.log('');

      // Verify pool state
      const finalPrice = calculatePrice(pool.usdcReserve, pool.xntReserve);
      console.log('Final state:');
      console.log(`  Price: ${formatPrice(finalPrice)}`);
      console.log(`  XNT Reserve: ${formatE9(pool.xntReserve)}`);
      console.log(`  USDC Reserve: ${formatE9(pool.usdcReserve)}`);
      console.log(`  Ceiling Reserve: ${formatE9(pool.ceilingReserveXnt)}`);
      console.log(`  Total trades: ${pool.tradeCount}\n`);

      // Assertions
      expect(pool.tradeCount).to.equal(4);
      expect(toNum(finalPrice)).to.be.lessThanOrEqual(toNum(BigInt(PRICE_CEILING)));
      expect(toNum(finalPrice)).to.be.greaterThanOrEqual(toNum(BigInt(PRICE_FLOOR)));
    });

    it('should maintain 1:1 ratio throughout multiple small trades', () => {
      let pool = initializePool(
        BigInt(10_000_000) * BigInt(1e9),
        BigInt(10_000_000) * BigInt(1e6),
        BigInt(10_000_000) * BigInt(1e9)
      );

      let totalUsdcSpent = 0n;
      let totalXntReceived = 0n;

      // 10 small buys
      for (let i = 0; i < 10; i++) {
        const usdcIn = BigInt(100) * BigInt(1e6);
        const result = buy(pool, usdcIn);
        pool = result.pool;

        totalUsdcSpent += usdcIn;
        totalXntReceived += result.xntOut;
      }

      // Average price should be close to $1.00
      const avgPrice = (Number(totalUsdcSpent) / 1e6) / (Number(totalXntReceived) / 1e9);
      expect(avgPrice).to.be.greaterThan(0.99);
      expect(avgPrice).to.be.lessThan(1.01);
    });
  });

  // ========================================================================
  // E6/E9 NORMALIZATION EDGE CASES
  // ========================================================================

  describe('E6/E9 Normalization Edge Cases', () => {
    it('should handle very small USDC amounts (dust)', () => {
      let pool = initializePool(
        BigInt(10_000_000) * BigInt(1e9),
        BigInt(10_000_000) * BigInt(1e6),
        BigInt(10_000_000) * BigInt(1e9)
      );

      const usdcIn = BigInt(1); // 0.000001 USDC (e6)
      const result = buy(pool, usdcIn);

      expect(toNum(result.xntOut)).to.be.greaterThan(toNum(0n));
    });

    it('should handle very small XNT amounts', () => {
      let pool = initializePool(
        BigInt(10_000_000) * BigInt(1e9),
        BigInt(10_000_000) * BigInt(1e6),
        BigInt(10_000_000) * BigInt(1e9)
      );

      const xntIn = BigInt(1000); // 0.000001 XNT (e9)
      const result = sell(pool, xntIn);

      expect(toNum(result.usdcOut)).to.be.greaterThanOrEqual(toNum(0n));
    });

    it('should verify normalization round-trip consistency', () => {
      const amounts = [
        BigInt(1) * BigInt(1e6),
        BigInt(100) * BigInt(1e6),
        BigInt(10_000) * BigInt(1e6),
        BigInt(1_000_000) * BigInt(1e6),
      ];

      for (const amount of amounts) {
        const normalized = normalizeUsdc(amount);
        const denormalized = denormalizeUsdc(normalized);
        expect(denormalized).to.equal(amount);
      }
    });

    it('should verify price calculation precision', () => {
      const pool = initializePool(
        BigInt(10_000_000) * BigInt(1e9),
        BigInt(10_000_000) * BigInt(1e6),
        BigInt(10_000_000) * BigInt(1e9)
      );

      const price = calculatePrice(pool.usdcReserve, pool.xntReserve);

      // Price should be exactly $1.000000 (6 decimals)
      expect(price).to.equal(BigInt(1_000_000));
    });
  });
});
