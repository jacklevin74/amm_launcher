# SECURITY AUDIT REPORT
## XNT Bonding Curve AMM - Solana Program

**Audit Date:** December 5, 2025
**Program:** bonding_curve (programs/bonding_curve/src/lib.rs)
**Program ID:** 2zKpM4k4kp7qRNvBVzkEAAt8DU8t1vpAfzsRagha4NNF
**Total Lines:** 1389

---

## EXECUTIVE SUMMARY

This security audit identified **20 vulnerabilities** across critical, high, medium, and low severity levels. The program implements a bonding curve AMM with automatic price ceiling/floor defenses, but has significant security concerns that should be addressed before mainnet deployment.

**Severity Breakdown:**
- **CRITICAL:** 5 issues
- **HIGH:** 4 issues
- **MEDIUM:** 6 issues
- **LOW:** 5 issues

---

## CRITICAL SEVERITY ISSUES

### 1. Missing Token Account Mint Validation
**Location:** lib.rs:1031-1036, 1083-1088
**Severity:** CRITICAL

**Description:**
In `Buy` and `Sell` contexts, user token accounts don't validate that they match the expected mints. An attacker could provide token accounts with wrong mints.

```rust
// Buy context - NO mint validation
#[account(mut)]
pub buyer_usdc: Account<'info, TokenAccount>,  // ❌ No constraint
#[account(mut)]
pub buyer_xnt: Account<'info, TokenAccount>,   // ❌ No constraint
```

**Recommendation:**
```rust
#[account(
    mut,
    constraint = buyer_usdc.mint == pool.usdc_mint @ ErrorCode::InvalidMint
)]
pub buyer_usdc: Account<'info, TokenAccount>,

#[account(
    mut,
    constraint = buyer_xnt.mint == pool.xnt_mint @ ErrorCode::InvalidMint
)]
pub buyer_xnt: Account<'info, TokenAccount>,
```

---

### 2. Missing Token Account Ownership Validation
**Location:** lib.rs:1005-1054 (Buy), 1057-1098 (Sell), 1261-1306 (AddLiquidity)
**Severity:** CRITICAL

**Description:**
The program doesn't verify that user token accounts belong to the signer. An attacker could provide someone else's token account and steal their funds.

**Recommendation:**
```rust
#[account(
    mut,
    constraint = buyer_xnt.owner == buyer.key() @ ErrorCode::InvalidOwner,
    constraint = buyer_xnt.mint == pool.xnt_mint @ ErrorCode::InvalidMint
)]
pub buyer_xnt: Account<'info, TokenAccount>,
```

---

### 3. Integer Division Precision Loss in Price Calculations
**Location:** lib.rs:130, 186, 276, 283, 412-413, 663-664
**Severity:** CRITICAL

**Description:**
Price calculations use integer division which loses precision. This can be exploited for price manipulation or cause users to receive incorrect amounts.

```rust
// lib.rs:130 - Precision loss
let price_before = pool.usdc_reserve / pool.xnt_reserve;  // ❌ Truncates

// lib.rs:270 - Rounding down hurts users
let usdc_out_transfer = if pool.usdc_decimals == 6 {
    usdc_out / 1000  // ❌ User loses fractional amounts
} else {
    usdc_out
};
```

**Recommendation:**
- Use fixed-point arithmetic or multiply first, divide last
- For user payouts, round UP (favor user)
- For protocol calculations, use higher precision

```rust
// Better approach for price calculation
let price_before = (pool.usdc_reserve as u128)
    .checked_mul(1_000_000)
    .unwrap()
    .checked_div(pool.xnt_reserve as u128)
    .unwrap();

// Round UP for user payouts
let usdc_out_transfer = if pool.usdc_decimals == 6 {
    (usdc_out + 999) / 1000  // Round up
} else {
    usdc_out
};
```

---

### 4. Ceiling Reserve Drain via Repeated Defense Triggers
**Location:** lib.rs:144-190
**Severity:** CRITICAL

**Description:**
The ceiling defense mechanism can be triggered repeatedly without cooldown. An attacker could execute multiple small buys to drain the entire ceiling reserve.

**Attack Scenario:**
1. Attacker executes small USDC buys that push price just above ceiling
2. Each buy triggers XNT injection from ceiling reserve
3. Repeat until ceiling reserve is empty
4. Protocol can no longer defend price ceiling

**Recommendation:**
- Implement cooldown period between ceiling defense activations
- Add maximum injection amount per block/time period
- Require minimum trade size to trigger defense
- Add reserve threshold checks before activation

```rust
pub struct Pool {
    // ... existing fields
    pub last_ceiling_defense: i64,  // Timestamp of last defense
    pub defense_cooldown: i64,      // Minimum seconds between defenses
}

// In buy instruction:
let clock = Clock::get()?;
if price_after > pool.price_ceiling {
    require!(
        clock.unix_timestamp - pool.last_ceiling_defense >= pool.defense_cooldown,
        ErrorCode::DefenseCooldownActive
    );

    // Perform ceiling defense...
    pool.last_ceiling_defense = clock.unix_timestamp;
}
```

---

### 5. Rounding Error Exploitation in E6/E9 Conversion
**Location:** lib.rs:270
**Severity:** CRITICAL

**Description:**
Converting from E9 to E6 for USDC uses truncating division. Users lose fractional amounts on every sell transaction.

```rust
let usdc_out_transfer = if pool.usdc_decimals == 6 {
    usdc_out / 1000  // ❌ Always rounds down
} else {
    usdc_out
};
```

**Impact:**
- User sells 1,999 XNT for 1,999,999 (e9) USDC
- After conversion: 1,999,999 / 1000 = 1,999 (e6) USDC
- User loses 999 units (0.000999 USDC) per transaction
- Over many transactions, this adds up significantly

**Recommendation:**
```rust
let usdc_out_transfer = if pool.usdc_decimals == 6 {
    // Round up to favor user
    (usdc_out + 999) / 1000
} else {
    usdc_out
};
```

---

## HIGH SEVERITY ISSUES

### 6. Authority Centralization Risk
**Location:** Multiple functions (deposit_xnt, withdraw_xnt, withdraw_usdc, etc.)
**Severity:** HIGH

**Description:**
Single authority address controls all privileged functions with no timelock, multisig, or governance mechanism. Authority can:
- Manipulate price through deposits/withdrawals
- Drain ceiling reserve
- Extract all USDC from pool (via withdraw_usdc_price_neutral)

**Recommendation:**
- Implement multisig requirement for authority (e.g., Squads)
- Add timelock for sensitive operations
- Consider governance token for decentralization
- Add maximum withdrawal limits per time period
- Implement pausable guardian with different key than authority

---

### 7. No Trading Fees = No LP Incentive
**Location:** lib.rs:92-236 (buy/sell functions)
**Severity:** HIGH

**Description:**
The AMM has zero trading fees. This means:
- No revenue for liquidity providers
- No economic incentive to provide liquidity
- Protocol cannot sustain itself
- Standard AMMs charge 0.3% fee (Uniswap model)

**Recommendation:**
```rust
pub struct Pool {
    // ... existing fields
    pub fee_bps: u16,  // Fee in basis points (30 = 0.3%)
}

// In buy instruction:
let fee_amount = (usdc_normalized as u128)
    .checked_mul(pool.fee_bps as u128)
    .ok_or(ErrorCode::MathOverflow)?
    .checked_div(10000)
    .ok_or(ErrorCode::MathOverflow)? as u64;

let usdc_after_fee = usdc_normalized
    .checked_sub(fee_amount)
    .ok_or(ErrorCode::MathOverflow)?;

// Use usdc_after_fee for AMM calculation
// Add fee_amount to LP reserves
```

---

### 8. State Updates Not Atomic
**Location:** lib.rs:220-233 (buy), 370-377 (sell)
**Severity:** HIGH

**Description:**
Reserve updates and k updates happen at different times. If a transaction fails between updates, pool state becomes inconsistent.

```rust
// lib.rs:225-231 - Non-atomic updates
pool.xnt_reserve = final_xnt_reserve;  // ❌ Update 1
pool.usdc_reserve = new_usdc_reserve as u64;  // ❌ Update 2

// Update k to reflect new reserves after ceiling defense
pool.k = (final_xnt_reserve as u128)  // ❌ Update 3
    .checked_mul(new_usdc_reserve)
    .ok_or(ErrorCode::MathOverflow)?;
```

**Recommendation:**
- Calculate all new values first
- Update all state fields in one atomic block
- Add invariant checks after updates

```rust
// Calculate all values first
let new_xnt = final_xnt_reserve;
let new_usdc = new_usdc_reserve as u64;
let new_k = (new_xnt as u128).checked_mul(new_usdc as u128)?;

// Invariant check
require!(new_k > 0, ErrorCode::InvalidState);
require!(new_xnt > 0 && new_usdc > 0, ErrorCode::InvalidState);

// Atomic update
pool.xnt_reserve = new_xnt;
pool.usdc_reserve = new_usdc;
pool.k = new_k;
pool.trade_count += 1;
```

---

### 9. Excessive Slippage Tolerance in add_liquidity
**Location:** lib.rs:850-856
**Severity:** HIGH

**Description:**
The 1% slippage tolerance is too generous and can be exploited via sandwich attacks.

```rust
// lib.rs:851 - 1% is too high
let slippage_tolerance = expected_usdc / 100;  // ❌ 1%
```

**Recommendation:**
- Allow user to specify max slippage
- Default to 0.1% - 0.5%
- Enforce maximum slippage of 1%

```rust
pub fn add_liquidity(
    ctx: Context<AddLiquidity>,
    xnt_amount: u64,
    usdc_amount: u64,
    min_liquidity: u64,
    max_slippage_bps: u16,  // In basis points
) -> Result<()> {
    require!(max_slippage_bps <= 100, ErrorCode::SlippageTooHigh);  // Max 1%

    let slippage_tolerance = (expected_usdc as u128)
        .checked_mul(max_slippage_bps as u128)
        .unwrap()
        .checked_div(10000)
        .unwrap() as u64;

    // ... rest of logic
}
```

---

## MEDIUM SEVERITY ISSUES

### 10. No Emergency Pause Mechanism
**Location:** All trading functions
**Severity:** MEDIUM

**Description:**
If an exploit is discovered, there's no way to pause trading while fixing the issue.

**Recommendation:**
```rust
pub struct Pool {
    // ... existing fields
    pub paused: bool,
    pub pause_guardian: Pubkey,
}

// Add to buy/sell:
require!(!pool.paused, ErrorCode::TradingPaused);
```

---

### 11. Missing Checks-Effects-Interactions Pattern
**Location:** lib.rs:192-218 (buy), 342-368 (sell)
**Severity:** MEDIUM

**Description:**
State updates happen AFTER external token transfers. While Solana doesn't have Ethereum-style reentrancy, following CEI pattern is best practice.

**Current Order:**
1. Transfer tokens (external call)
2. Update state

**Recommended Order:**
1. Validate inputs
2. Update state
3. Transfer tokens (external calls last)

---

### 12. Unchecked Magic Numbers in Defense Buffers
**Location:** lib.rs:160, 306
**Severity:** MEDIUM

**Description:**
```rust
// lib.rs:160 - Why 1 XNT buffer?
.saturating_add(1_000_000);  // Add 1 XNT buffer

// lib.rs:306 - Asymmetric with ceiling
.saturating_sub(1_000_000);  // Subtract 1 XNT buffer
```

**Issues:**
- No justification for 1 XNT value
- Ceiling adds, floor subtracts (asymmetric)
- Should be configurable parameter

**Recommendation:**
```rust
pub struct Pool {
    // ... existing fields
    pub defense_buffer: u64,  // Configurable buffer amount
}
```

---

### 13. View Function Returns Result Instead of Pure Value
**Location:** lib.rs:802-827
**Severity:** MEDIUM

**Description:**
`get_max_sellable_xnt` is a view function but returns `Result<u64>`. View functions should be infallible.

**Recommendation:**
- Make function infallible
- Return 0 for edge cases instead of error

---

### 14. LP Position Initialization Logic Redundant
**Location:** lib.rs:919-929
**Severity:** MEDIUM

**Description:**
Manual check for `Pubkey::default()` is redundant with Anchor's `init_if_needed`.

**Recommendation:**
- Remove manual initialization check
- Trust Anchor's `init_if_needed` macro

---

### 15. No Events for Critical Operations
**Location:** All functions
**Severity:** MEDIUM

**Description:**
Program uses `msg!` logging but doesn't emit proper events. This makes:
- Off-chain indexing difficult
- Historical analysis impossible
- Monitoring/alerting harder

**Recommendation:**
```rust
#[event]
pub struct TradeExecuted {
    pub pool: Pubkey,
    pub trader: Pubkey,
    pub is_buy: bool,
    pub input_amount: u64,
    pub output_amount: u64,
    pub price_before: u64,
    pub price_after: u64,
    pub timestamp: i64,
}

// In buy function:
emit!(TradeExecuted {
    pool: pool.key(),
    trader: buyer.key(),
    is_buy: true,
    input_amount: usdc_amount,
    output_amount: xnt_out,
    price_before,
    price_after,
    timestamp: Clock::get()?.unix_timestamp,
});
```

---

## LOW SEVERITY ISSUES

### 16. Deprecated Field in Struct
**Location:** lib.rs:1330
**Severity:** LOW

**Description:**
`is_graduated` field is deprecated but kept for compatibility.

**Recommendation:**
- Document clearly that it's deprecated
- Remove in next major version
- Add migration path

---

### 17. Price Floor Only Checked in deposit_xnt
**Location:** lib.rs:398-404
**Severity:** LOW

**Description:**
Price floor check only happens in `deposit_xnt`, not in `deposit_xnt_price_neutral`.

**Recommendation:**
- Add consistent price validation across all functions
- Or document why price_neutral doesn't need it

---

### 18. Division by Zero Not Fully Protected
**Location:** lib.rs:80-82
**Severity:** LOW

**Description:**
```rust
if xnt_amount > 0 {
    msg!("Starting price: ${}", virtual_usdc_normalized / xnt_amount);
}
```

**Recommendation:**
- Good that it's checked
- Should also validate `virtual_usdc_amount > 0` in initialization

---

### 19. No Minimum Trade Size
**Location:** buy/sell functions
**Severity:** LOW

**Description:**
No minimum trade size allows dust trades that could be used for griefing or price manipulation.

**Recommendation:**
```rust
pub struct Pool {
    // ... existing fields
    pub min_trade_amount: u64,
}

// In buy/sell:
require!(
    usdc_amount >= pool.min_trade_amount,
    ErrorCode::TradeTooSmall
);
```

---

### 20. Integer Square Root Edge Cases
**Location:** lib.rs:1353-1366
**Severity:** LOW

**Description:**
Custom `integer_sqrt` implementation should be tested for edge cases.

**Recommendation:**
- Add comprehensive unit tests
- Consider using audited math library
- Test with u128::MAX and other edge values

---

## RECOMMENDATIONS SUMMARY

### Immediate Actions (Before Mainnet)
1. ✅ **Add mint validation** to all token accounts
2. ✅ **Add ownership validation** to user token accounts
3. ✅ **Fix rounding errors** - round up for user payouts
4. ✅ **Implement cooldown** for ceiling/floor defense
5. ✅ **Add trading fees** (0.3% standard)
6. ✅ **Implement multisig** authority

### Important Improvements
7. Add emergency pause mechanism
8. Follow checks-effects-interactions pattern
9. Emit events for all critical operations
10. Add minimum trade size requirements
11. Improve precision in price calculations
12. Add comprehensive unit tests

### Nice to Have
13. Implement timelock for authority operations
14. Add governance mechanism
15. Document all magic numbers
16. Create migration plan for deprecated fields
17. Add monitoring and alerting infrastructure

---

## TESTING RECOMMENDATIONS

1. **Fuzz Testing:** Test with random inputs, edge values (0, u64::MAX)
2. **Integration Tests:** Test ceiling/floor defense scenarios
3. **Economic Tests:** Verify AMM invariants hold under all conditions
4. **Attack Simulations:** Simulate sandwich attacks, flash loan attacks
5. **Load Testing:** Test under high transaction volume

---

## CONCLUSION

The bonding curve AMM implementation has good structure and interesting price defense mechanisms, but **requires significant security improvements before mainnet deployment**. The most critical issues are:

1. Missing account validations (CRITICAL)
2. Precision loss in calculations (CRITICAL)
3. Ceiling reserve drain vulnerability (CRITICAL)
4. Centralized authority control (HIGH)
5. No trading fees (HIGH)

**Estimated time to address critical issues:** 2-3 weeks
**Recommended:** Full professional security audit before mainnet deployment

---

**Auditor Note:** This audit is comprehensive but not exhaustive. A professional third-party audit is strongly recommended before handling real user funds.
