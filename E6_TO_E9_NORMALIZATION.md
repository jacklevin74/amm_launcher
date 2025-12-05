# Why We Normalize e6 USDC to e9 Internally

## The Problem

**Token Decimal Mismatch:**
- XNT (wrapped SOL): 9 decimals (e9) → 1 SOL = 1,000,000,000 lamports
- USDC (standard): 6 decimals (e6) → 1 USDC = 1,000,000 atomic units

**Can't do AMM math with different decimals!**

## The Solution: Normalize to e9

**Internally store USDC reserves in e9 format (multiply by 1000)**

```
External (e6)          Internal (e9)
─────────────────────────────────────
1,000,000 USDC    →   1,000,000,000  (normalized)
(1 USDC in e6)         (same value in e9)
```

## Why This Works

### 1. Constant Product Formula Requires Matching Decimals

```rust
// AMM formula: k = x * y
k = xnt_reserve * usdc_reserve

// Only works if both reserves have same decimal places!
```

**Example at $1.00 price:**
```
XNT:  10,000,000,000,000,000 (10M SOL in e9)
USDC: 10,000,000,000,000,000 (10M USDC normalized to e9)
k = 10M * 10M = 100,000,000,000,000 (constant)
```

### 2. Price Calculation

```rust
// Price in USD (e6 format)
price = (usdc_reserve * 1_000_000) / xnt_reserve

// Where:
// - usdc_reserve is e9 (normalized)
// - xnt_reserve is e9 (native SOL)
// - Result is e6 (standard USD price)
```

**Example:**
```
USDC Reserve: 10,000,000,000,000,000 (e9)
XNT Reserve:  10,000,000,000,000,000 (e9)

Price = (10,000,000,000,000,000 * 1,000,000) / 10,000,000,000,000,000
      = 1,000,000 (e6)
      = $1.00
```

## The Flow

```
┌─────────────────────────────────────────────────────┐
│ USER DEPOSITS 1M USDC                               │
└─────────────────────────────────────────────────────┘
                    ↓
        1,000,000,000,000 (e6 atomic units)
                    ↓
        ┌──────────────────────────┐
        │  NORMALIZE (× 1000)      │
        └──────────────────────────┘
                    ↓
        1,000,000,000,000,000 (e9 normalized)
                    ↓
        ┌──────────────────────────┐
        │  pool.usdc_reserve       │ ← Stored as e9
        │  10,000,000,000,000,000  │
        └──────────────────────────┘
                    ↓
        ┌──────────────────────────┐
        │  AMM CALCULATIONS        │
        │  k = xnt × usdc (both e9)│
        └──────────────────────────┘
                    ↓
        ┌──────────────────────────┐
        │  DENORMALIZE (÷ 1000)    │
        └──────────────────────────┘
                    ↓
        1,000,000,000,000 (e6 atomic units)
                    ↓
┌─────────────────────────────────────────────────────┐
│ TRANSFER ACTUAL USDC TOKENS (e6)                    │
└─────────────────────────────────────────────────────┘
```

## Code Examples

### Rust Program (lib.rs)

```rust
// Buy function - normalize USDC input
let usdc_normalized = if pool.usdc_decimals == 6 {
    usdc_amount.checked_mul(1000).ok_or(ErrorCode::MathOverflow)?
} else {
    usdc_amount
};

// Now use normalized value in AMM calculations
pool.usdc_reserve += usdc_normalized;
```

### Withdraw USDC - Must Normalize

```rust
pub fn withdraw_usdc_price_neutral(ctx: Context<WithdrawUsdc>, usdc_amount: u64) -> Result<()> {
    // 1. Transfer real USDC tokens (e6 format)
    token::transfer(cpi_ctx, usdc_amount)?;

    // 2. Normalize e6 to e9 before adjusting internal reserve
    let usdc_amount_normalized = usdc_amount.checked_mul(1000)?;

    // 3. Decrease virtual reserve (which is stored in e9)
    pool.usdc_reserve -= usdc_amount_normalized;

    // This keeps price = usdc_reserve / xnt_reserve constant!
}
```

## Key Points

1. **External USDC**: Always e6 (actual token transfers)
2. **Internal `pool.usdc_reserve`**: Always e9 (normalized for AMM math)
3. **Conversion factor**: e6 → e9 = multiply by 1000
4. **Why 1000?**: Because 10^9 / 10^6 = 1000

## Without Normalization (Wrong!)

```rust
// ❌ WRONG - mixing decimals
k = 10,000,000,000,000,000 (XNT e9) * 10,000,000,000,000 (USDC e6)
  = nonsensical value (decimals don't match!)

// Price calculation would be off by 1000x!
```

## With Normalization (Correct!)

```rust
// ✅ CORRECT - both e9
k = 10,000,000,000,000,000 (XNT e9) * 10,000,000,000,000,000 (USDC e9 normalized)
  = 100,000,000,000,000,000,000,000,000,000,000 (constant product)

// Price calculation is accurate
price = usdc_reserve / xnt_reserve = 1.0
```

## Summary

**Why normalize?**
- AMM math requires matching decimal places
- XNT is e9 (native SOL), so we normalize USDC to e9 internally
- External USDC transfers still use e6 (standard USDC format)
- Conversion happens at the boundary (input/output)

**Where to normalize?**
- Every function that receives USDC amounts from external calls
- Every function that adjusts `pool.usdc_reserve`
- Examples: `buy()`, `sell()`, `withdraw_usdc_price_neutral()`

**What happens if we forget?**
- Price calculations will be wrong (off by 1000x)
- AMM constant product formula breaks
- Reserve accounting becomes inconsistent
- Pool becomes unbalanced
