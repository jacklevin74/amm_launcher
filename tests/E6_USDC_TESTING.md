# E6 USDC Testing Strategy

## Overview

This directory contains two complementary test suites for validating the e6 USDC normalization approach:

1. **Pure TypeScript Simulation** (`e6-usdc-simulation.test.ts`)
2. **Anchor Integration Tests** (`e6-usdc-integration.ts`)

## Test Suite Comparison

| Feature | TypeScript Simulation | Anchor Integration |
|---------|----------------------|-------------------|
| **Speed** | ⚡ Very Fast (<1s) | 🐢 Slower (~10s+) |
| **What it tests** | Mathematical correctness | Actual Rust implementation |
| **Dependencies** | None (pure math) | Requires validator + deployed program |
| **Coverage** | 30 comprehensive scenarios | 5 key integration scenarios |
| **Best for** | Fast iteration & math validation | Final validation before deployment |

## TypeScript Simulation (`e6-usdc-simulation.test.ts`)

### Purpose
Validates the mathematical correctness of the e6 → e9 normalization approach **before** implementing in Rust.

### What it Tests
- ✅ E6 to e9 normalization (multiply by 1000)
- ✅ E9 to e6 denormalization (divide by 1000)
- ✅ 1:1 exchange ratio at $1.00 price
- ✅ Constant product AMM formula (x * y = k)
- ✅ Ceiling defense ($2.00 cap via XNT injection)
- ✅ Floor defense ($1.00 floor via XNT buyback)
- ✅ Price calculation precision
- ✅ Dust amount handling
- ✅ Complex multi-trade scenarios
- ✅ Round-trip consistency

### Run Command
```bash
npx ts-mocha tests/e6-usdc-simulation.test.ts
```

### Example Output
```
30 passing (8ms)

✔ should initialize pool with correct reserves and price
✔ should buy XNT with correct 1:1 ratio at $1.00 price
✔ should auto-defend price floor by removing XNT
...
```

## Anchor Integration Tests (`e6-usdc-integration.ts`)

### Purpose
Validates that the **actual Rust program** correctly implements the e6 USDC normalization logic.

### What it Tests
- ✅ 1:1 exchange ratio with real e6 USDC mint
- ✅ E6 to e9 normalization in Rust code
- ✅ Price calculation with e6 USDC on-chain
- ✅ Dust amount handling in program
- ✅ Constant product invariant on-chain

### Prerequisites
1. Solana test validator running
2. Program deployed
3. Pool initialized

### Run Command
```bash
# Start validator
pkill -9 solana-test-validator
solana-test-validator --reset --quiet &
sleep 5

# Deploy program
anchor deploy

# Run integration tests
anchor test --skip-local-validator
```

### Example Output
```
E6 USDC Integration
  🔧 Setting up E6 USDC integration test environment...
  ✅ Created USDC mint (e6): [address]

  ✔ validates 1:1 exchange ratio with e6 USDC at $1.00 price
  ✔ correctly normalizes e6 USDC to e9 internally
  ✔ validates price calculation with e6 USDC
  ...
```

## Development Workflow

### 1. Fast Iteration (Simulation Only)
When making changes to the normalization logic:

```bash
# Run fast simulation
npx ts-mocha tests/e6-usdc-simulation.test.ts

# If all 30 tests pass, proceed to Rust implementation
```

### 2. Pre-Deployment (Integration Tests)
Before deploying to testnet/mainnet:

```bash
# Start validator & deploy
./scripts/start-validator-and-deploy.sh

# Run integration tests to validate Rust implementation
anchor test --skip-local-validator

# Run ALL tests (simulation + integration)
anchor test
```

## Key Normalization Concepts

### The Problem
- **USDC**: Standard token with 6 decimals (e6)
- **XNT (wSOL)**: Native SOL with 9 decimals (e9)
- **Issue**: Can't do AMM math with mismatched decimals

### The Solution
**Normalize e6 USDC to e9 internally by multiplying by 1000**

```typescript
// Normalization (e6 → e9)
function normalizeUsdc(e6Amount: bigint): bigint {
  return e6Amount * BigInt(1000);
}

// Denormalization (e9 → e6)
function denormalizeUsdc(e9Amount: bigint): bigint {
  return e9Amount / BigInt(1000);
}
```

### In Rust
```rust
// Normalize USDC from e6 to e9
let usdc_normalized = usdc_e6 * 1000;

// AMM calculations use normalized amounts
let k = xnt_reserve * usdc_normalized;

// Denormalize back to e6 for transfers
let usdc_out_e6 = usdc_out_e9 / 1000;
```

## Price Calculation

With e6 USDC normalization:

```
Price (in e6 precision) = (usdc_reserve * 1_000_000) / xnt_reserve

Where:
- usdc_reserve is already normalized to e9 internally
- xnt_reserve is e9 (wSOL native)
- Result is e6 precision (standard for USD prices)
```

### Example
```
USDC Reserve: 10,000,000 (e6) → 10,000,000,000 (e9 normalized)
XNT Reserve:  10,000,000,000 (e9)

Price = (10,000,000,000 * 1,000,000) / 10,000,000,000
      = 1,000,000 (e6)
      = $1.00
```

## Defense Mechanisms

### Ceiling Defense ($2.00)
When price > $2.00:
1. Calculate XNT needed to push price to $2.00
2. **Inject** XNT from reserve into pool
3. Increases supply → price drops

### Floor Defense ($1.00)
When price < $1.00:
1. Calculate XNT needed to push price to $1.00
2. **Buy back** XNT from pool to reserve
3. Decreases supply → price rises

**Both use the same reserve - a two-way stabilization mechanism!**

## Test Coverage

### Simulation Coverage (30 tests)
- Pool initialization
- Buy operations (5 tests)
- Sell operations (6 tests)
- Ceiling defense (4 tests)
- Floor defense (3 tests)
- Reserve management (3 tests)
- Multi-trade scenarios (2 tests)
- Edge cases (7 tests)

### Integration Coverage (5 tests)
- 1:1 ratio validation
- Normalization verification
- Price calculation
- Dust handling
- K invariant

## Common Issues

### Issue: "expected X to be a number or a date"
**Cause**: Chai doesn't handle BigInt assertions
**Fix**: Use `toNum()` helper to wrap BigInt values

### Issue: "Constant product not equal"
**Cause**: Integer division causes tiny rounding errors
**Fix**: Use tolerance (0.01%) instead of strict equality

### Issue: "Price below floor"
**Cause**: Expected rejection, but we auto-defend now
**Fix**: Test should verify XNT was removed, not expect error

## Resources

- [E6_USDC_IMPLEMENTATION.md](../E6_USDC_IMPLEMENTATION.md) - Full implementation guide
- [DEPLOYMENT_GUIDE.md](../DEPLOYMENT_GUIDE.md) - Deployment instructions
- [Anchor Testing](https://www.anchor-lang.com/docs/testing) - Official Anchor test docs

## Next Steps

1. ✅ Validate simulation (30/30 tests passing)
2. ⏭️ Implement e6 normalization in Rust
3. ⏭️ Run integration tests to verify Rust matches simulation
4. ⏭️ Deploy to testnet
5. ⏭️ Run live trading tests
6. ⏭️ Deploy to mainnet

---

**Status**: ✅ Simulation complete and validated (30/30 passing)
**Next**: Implement e6 normalization in Rust `lib.rs`
