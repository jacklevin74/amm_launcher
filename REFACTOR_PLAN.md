# Refactor Plan: Use Native SOL Mint (wSOL)

## Overview
Refactor XNT to use Solana's native mint (`So11111111111111111111111111111111111111112`) instead of a custom SPL token with wrap/unwrap functions.

## Key Benefits
- ✅ **Simpler code**: Remove 150+ lines of wrap/unwrap logic
- ✅ **Standard compatibility**: All wallets support wSOL natively
- ✅ **No decimal conversion**: Both SOL and wSOL are 9 decimals
- ✅ **No SOL vault needed**: wSOL handles wrapping automatically
- ✅ **Fewer bugs**: Less custom code = fewer edge cases

## Changes Required

### 1. Constants
```rust
// Add constant for native SOL mint
use anchor_spl::token::spl_token::native_mint;
const NATIVE_MINT: Pubkey = native_mint::ID; // So11111111111111111111111111111111111111112
```

### 2. Pool Struct (lines 1381-1400)
**Remove:**
- `pub sol_vault_bump: u8` (line 1399)

### 3. InitializePool Context (lines 955-1023)
**Remove:**
- `sol_vault` account (lines 1013-1019)

**Update:**
- Remove `pool.sol_vault_bump = ctx.bumps.sol_vault;` from initialize_pool function (line 53)

### 4. Remove Functions Entirely (lines 728-845)
- ❌ `wrap_sol()` function
- ❌ `unwrap_sol()` function

### 5. Remove Context Structs (lines 1305-1372)
- ❌ `WrapSol` struct
- ❌ `UnwrapSol` struct

### 6. Update Comments/Documentation
- Change all "XNT (6 decimals)" references to "XNT/wSOL (9 decimals)"
- Update comments about wrapping/unwrapping to reference standard Solana wSOL

### 7. No Decimal Conversion Needed
Since both native SOL and wSOL are 9 decimals, remove all `/1000` and `*1000` conversions that were handling 9→6 and 6→9 decimal conversions.

## Files to Update

### Smart Contract
- [x] `programs/bonding_curve/src/lib.rs` - Main refactor

### Scripts
- [ ] `scripts/init-pool-simple.ts` - Use native mint, remove SOL vault
- [ ] `scripts/test-buy-sell-roundtrip.ts` - Remove wrap/unwrap calls
- [ ] `scripts/test-buy-xnt.ts` - Update for wSOL
- [ ] `scripts/test-wallet-balances.ts` - Update for wSOL

### Web Interface
- [ ] `web/trading-app.js` - Update to use native mint
- [ ] `web/server.js` - Update pool initialization
- [ ] Comments/labels - Keep "XNT" branding for user-facing text

## Migration Path

1. ✅ Create new branch `refactor/use-native-sol-mint`
2. Update lib.rs with all changes
3. Update initialization scripts
4. Update test scripts
5. Rebuild and deploy to local validator
6. Run comprehensive tests
7. Update web interface
8. Test end-to-end trading flow

## Testing Checklist

- [ ] Pool initializes with native mint
- [ ] Buy XNT (wSOL) with USDC works
- [ ] Sell XNT (wSOL) for USDC works
- [ ] No wrap/unwrap needed - users work directly with wSOL
- [ ] Price ceiling/floor defense still works
- [ ] Ceiling reserve injections work
- [ ] All existing tests pass with wSOL

## Notes

- **Keep "XNT" branding** in UI/comments - users don't need to know it's wSOL
- Native mint is immutable - can't change decimals or supply
- Users can wrap/unwrap SOL ↔ wSOL using standard Solana wallet features
- AMM becomes standard USDC/wSOL pool (like every other DEX)
