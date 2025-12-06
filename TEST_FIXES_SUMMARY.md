# Test Fixes Summary

## Overview
Updated test files to work with new security fixes implemented in the bonding curve program:
- Atomic state updates (Issue #8)
- Mint validation (Issues #1 & #2)
- Ownership validation
- Defense cooldown mechanism (Issue #4)

## Files Fixed (2/13)

### ✅ tests/bidirectional-swap.ts
**Changes Made:**
1. Added `xntMint` and `usdcMint` accounts to all buy/sell operations
2. Fixed account naming:
   - `trader` → `buyer` (for buy operations)
   - `trader` → `seller` (for sell operations)
3. Updated token account names to match:
   - `traderXnt` → `buyerXnt` / `sellerXnt`
   - `traderUsdc` → `buyerUsdc` / `sellerUsdc`
4. Added 2-second delays between consecutive trades to respect defense cooldown

**Code Example:**
```typescript
// Before
.accounts({
  trader: payer.publicKey,
  pool: poolPda,
  poolXnt: poolXnt,
  poolUsdc: poolUsdc,
  traderXnt: traderXnt,
  traderUsdc: traderUsdc,
  ...
})

// After
.accounts({
  buyer: payer.publicKey,
  pool: poolPda,
  xntMint: xntMint,
  usdcMint: usdcMint,
  poolXnt: poolXnt,
  poolUsdc: poolUsdc,
  buyerXnt: traderXnt,
  buyerUsdc: traderUsdc,
  ceilingReservePda: ceilingReservePda,
  ceilingReserveXnt: ceilingReserveXnt,
  ...
})
```

### ✅ tests/bonding-curve-amm.ts
**Changes Made:**
1. Added ceiling reserve PDA variables and derivation
2. Updated pool initialization to include:
   - Ceiling reserve keypair generation
   - Price ceiling/floor parameters
   - Ceiling reserve accounts in initialization
3. Added required accounts to all buy calls:
   - `xntMint`
   - `usdcMint`
   - `ceilingReservePda`
   - `ceilingReserveXnt`

**Code Example:**
```typescript
// Added ceiling reserve setup
[ceilingReservePda] = anchor.web3.PublicKey.findProgramAddressSync(
  [Buffer.from("ceiling_reserve"), poolPda.toBuffer()],
  program.programId
);

// Updated initialization
await program.methods
  .initializePool(
    new anchor.BN(INITIAL_XNT),
    new anchor.BN(VIRTUAL_USDC),
    false, // price floor enabled
    new anchor.BN(0), // price ceiling
    new anchor.BN(0)  // price floor
  )
  .accounts({
    ...
    ceilingReservePda,
    ceilingReserveXnt,
    ...
  })
  .signers([poolXntKeypair, poolUsdcKeypair, ceilingReserveXntKeypair])
  .rpc();
```

## Remaining Files (11)

### Priority 1 - Core Trading Tests
- **e6-usdc-integration.ts** - Critical for E6/E9 decimal testing
- **bonding-curve-withdrawals.ts** - Tests withdrawal functions
- **bonding-curve-deposits.ts** - Tests deposit functions

### Priority 2 - Simulation & Advanced Tests
- **e6-usdc-simulation.test.ts**
- **live-trading-sim.ts**
- **bonding-curve-sim.ts**
- **bonding-curve-to-dex.ts**

### Priority 3 - Demo & Utility Tests
- **price-corridor-demo.ts**
- **price-calc-test.ts**
- **bonding-curve-real-tokens.ts**

### Special Case
- **sol-wrapping.ts** - Has missing `unwrapSol` function issue

## Common Fix Patterns

### Pattern 1: Buy Operations
```typescript
// Add these accounts to ALL .buy() calls:
.accounts({
  buyer: payer.publicKey,           // Changed from 'trader'
  pool: poolPda,
  xntMint: xntMint,                 // NEW - Required
  usdcMint: usdcMint,               // NEW - Required
  poolXnt: poolXnt,
  poolUsdc: poolUsdc,
  buyerXnt: buyerXnt,               // Changed from 'traderXnt'
  buyerUsdc: buyerUsdc,             // Changed from 'traderUsdc'
  ceilingReservePda: ceilingReservePda,    // NEW - Required
  ceilingReserveXnt: ceilingReserveXnt,    // NEW - Required
  tokenProgram: TOKEN_PROGRAM_ID,
})
```

### Pattern 2: Sell Operations
```typescript
// Add these accounts to ALL .sell() calls:
.accounts({
  seller: payer.publicKey,          // Changed from 'trader'
  pool: poolPda,
  xntMint: xntMint,                 // NEW - Required
  usdcMint: usdcMint,               // NEW - Required
  poolXnt: poolXnt,
  poolUsdc: poolUsdc,
  sellerXnt: sellerXnt,             // Changed from 'traderXnt'
  sellerUsdc: sellerUsdc,           // Changed from 'traderUsdc'
  tokenProgram: TOKEN_PROGRAM_ID,
})
```

### Pattern 3: Defense Cooldown Delays
```typescript
// Add delays between trades that might trigger ceiling/floor defense:
await program.methods.buy(...).rpc();

// Wait 2 seconds for defense cooldown
await new Promise(resolve => setTimeout(resolve, 2000));

await program.methods.buy(...).rpc();
```

### Pattern 4: Ceiling Reserve Setup
```typescript
// Add to variable declarations:
let ceilingReservePda: anchor.web3.PublicKey;
let ceilingReserveXnt: anchor.web3.PublicKey;

// Add to before() or setup block:
[ceilingReservePda] = anchor.web3.PublicKey.findProgramAddressSync(
  [Buffer.from("ceiling_reserve"), poolPda.toBuffer()],
  program.programId
);

// In initialization:
const ceilingReserveXntKeypair = anchor.web3.Keypair.generate();
ceilingReserveXnt = ceilingReserveXntKeypair.publicKey;

// Add to .signers():
.signers([..., ceilingReserveXntKeypair])
```

## Quick Fix Checklist

For each test file:

- [ ] Add ceiling reserve variables
- [ ] Derive ceiling reserve PDA
- [ ] Update all `buy()` calls with:
  - [ ] Change `trader` to `buyer`
  - [ ] Add `xntMint` and `usdcMint`
  - [ ] Add `ceilingReservePda` and `ceilingReserveXnt`
  - [ ] Update token account names to `buyerXnt`/`buyerUsdc`
- [ ] Update all `sell()` calls with:
  - [ ] Change `trader` to `seller`
  - [ ] Add `xntMint` and `usdcMint`
  - [ ] Update token account names to `sellerXnt`/`sellerUsdc`
- [ ] Add cooldown delays between consecutive trades
- [ ] Update initialization calls with ceiling reserve accounts

## Testing After Fixes

Run individual test files:
```bash
anchor test --skip-local-validator tests/bidirectional-swap.ts
```

Run full test suite:
```bash
anchor test --skip-local-validator
```

## Known Issues

1. **sol-wrapping.ts**: Missing `unwrapSol` function - needs to be implemented in program
2. **connection vs provider.connection**: Some files may have `connection` instead of `provider.connection`

## Next Steps

1. Fix remaining 11 test files using patterns above
2. Test each file individually after fixing
3. Run full test suite to verify all fixes
4. Address any remaining issues (e.g., sol-wrapping.ts)

---

**Status**: 2/13 files fixed and tested
**Core functionality**: Validated with bidirectional-swap and bonding-curve-amm tests
**Program changes**: Successfully deployed with Issue #8 (atomic state updates) fix
