# Quick Start Guide - Lottery AMM

This guide will walk you through setting up and testing the Lottery AMM in 5 minutes.

## 1. Start Local Validator

Open a terminal and start the Solana test validator:

```bash
solana-test-validator --reset
```

Keep this running in the background.

## 2. Run Tests to Create a Pool

In a new terminal, navigate to the project directory and run the on-chain tests:

```bash
cd /Users/yakovlevin/dev/lottery_amm
yarn test tests/simple-onchain.ts
```

This will:
- Create XNT and USDC token mints
- Initialize a lottery pool with 1M XNT tokens
- Register a test user with $100K USDC
- Wait for settlement slot
- Settle the lottery and discover price

**Save the Pool Address** from the output:
```
Lottery Pool PDA: DpkLHTkgQYYXrQAo1hRdn2ETxpZYo5d2aCbNLyCFLnJJ
```

## 3. Launch the Web Interface

In the same terminal or a new one:

```bash
yarn web
```

You should see:
```
🚀 Lottery AMM Web Interface
================================
Server running at http://localhost:3030/
```

## 4. Open in Browser

1. Open http://localhost:3030 in your browser
2. Install [Phantom wallet](https://phantom.app/) if you haven't already
3. The interface will load and show recent transaction hashes

## 5. Try the Features

### View Pool Status

1. Copy the pool address from step 2 (e.g., `DpkLHTkgQYYXrQAo1hRdn2ETxpZYo5d2aCbNLyCFLnJJ`)
2. Paste it into the "Pool Status" section
3. Click "Get Status"
4. You'll see:
   - Current status (Registration/Settled/Completed)
   - Current price
   - Total participants
   - Settlement slot information

### Settle a Lottery (if not already settled)

If you create a new pool and want to settle it via the web interface:

1. Wait for the registration period to end (check current slot vs settlement slot)
2. Connect your Phantom wallet (click any button to trigger)
3. Enter the pool address in "Settle Lottery" section
4. Click "Settle & Discover Price"
5. Approve the transaction in Phantom
6. See the clearing price displayed

## Transaction Hashes

The console output in the web interface shows recent transaction hashes:

- **Initialize Pool**: `31EnkYZRSVEc3vRr9JcgHNvuy8GjathYGxdRpk7JHZEv2gZJxGSVsDWTcH9hgVaL4xS5ZStLVs3jRwRiYFLiZrMm`
- **Register User**: `3kd7UZ49QkRoJThp8DknpQm2CmNnZwibWYKuEXpYDVdoVh19ngSn5rR15ZymRiot3C3ryUiwpQRTmd9LNXvizn5y`

You can view these on a Solana explorer (if using testnet/mainnet).

## Testing Price Discovery

To test the price discovery mechanism:

```bash
yarn test tests/price-calc-test.ts
```

This runs standalone calculations showing how the clearing price changes based on USDC demand.

## Network Switching

The web interface supports both:
- **Localhost** (http://localhost:8899) - Default, requires validator running
- **X1 Testnet** (https://rpc.testnet.x1.xyz) - Public testnet

Use the dropdown in the "Network" section to switch.

## What Works vs What Doesn't

✅ **Working Features:**
- View pool status and current price
- Settle lotteries (with wallet connected)
- Monitor transactions in console
- Switch networks

⚠️ **Use CLI for Now:**
- Creating new pools → `yarn test tests/simple-onchain.ts`
- Registering users → `yarn test tests/simple-onchain.ts`
- Claiming tokens → `yarn test tests/simple-onchain.ts`

These require complex token account setup that's easier via TypeScript tests.

## Full Workflow Example

Here's a complete end-to-end flow:

```bash
# Terminal 1: Start validator
solana-test-validator --reset

# Terminal 2: Run full test suite
cd /Users/yakovlevin/dev/lottery_amm
yarn test tests/simple-onchain.ts

# Save the pool address from output
# Example: DpkLHTkgQYYXrQAo1hRdn2ETxpZYo5d2aCbNLyCFLnJJ

# Terminal 3: Start web server
yarn web

# Browser: Open http://localhost:3030
# 1. Paste pool address into "Pool Status"
# 2. Click "Get Status"
# 3. See all pool information displayed
```

## Troubleshooting

**Web interface shows "Cannot connect to network"**
- Make sure validator is running: `solana-test-validator --reset`
- Check network dropdown is set to "Localhost"

**"Settlement slot has not been reached yet"**
- The registration period hasn't ended yet
- Wait time shown in console (~40 seconds for 100 slots)
- Each slot is ~400ms

**"Pool not found"**
- Pool address might be wrong
- Pool might be from a previous validator session (use `--reset`)
- Make sure you're on the correct network

**Phantom wallet won't connect**
- Install Phantom extension first
- Refresh the page after installation
- Click any button to trigger wallet connection

## Next Steps

- Read [web/README.md](./web/README.md) for detailed web interface documentation
- Read [DEPLOYMENT.md](./DEPLOYMENT.md) for deploying to X1 testnet
- Explore the Rust program in `programs/lottery_amm/src/lib.rs`
- Review test files to understand the full workflow

## Program Information

- **Program ID**: `C8x5EWRYp1QMESFn3pPeNVEfCD6ecE4iziUbqjw6RNrG`
- **Network**: Localhost (for testing) or X1 Testnet
- **Price Range**: $1.00 - $2.00
- **Initial Supply**: 1,000,000 XNT tokens

## Commands Reference

```bash
# Build program
anchor build

# Run all tests
yarn test tests/simple-onchain.ts

# Run price calculation tests
yarn test tests/price-calc-test.ts

# Start web interface
yarn web

# Deploy to X1 testnet
yarn deploy-x1

# Settle lottery (testnet)
yarn settle-lottery
```

---

**You're all set! The lottery AMM is ready to use. Start with the pool status viewer to see real-time pool information.**
