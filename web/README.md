# Lottery AMM Web Interface

A browser-based interface for interacting with the Lottery AMM Solana program.

## Features

- **Wallet Connection**: Connect using Phantom wallet
- **Network Switching**: Toggle between localhost and X1 testnet
- **Pool Status Viewer**: Real-time pool information display
- **Settle Lottery**: Trigger price discovery and settlement
- **Transaction Tracking**: View transaction hashes in console

## Setup

### Prerequisites

1. **Phantom Wallet**: Install the [Phantom browser extension](https://phantom.app/)
2. **Local Validator** (if using localhost):
   ```bash
   solana-test-validator --reset
   ```
3. **Create Test Pools**: Run the on-chain tests first to create pools
   ```bash
   cd ..
   yarn test tests/simple-onchain.ts
   ```

### Running the Web Interface

**Option 1: Simple HTTP Server (Node.js)**
```bash
node serve.js
```
Then open http://localhost:3030 in your browser.

**Option 2: Python HTTP Server**
```bash
python3 -m http.server 3030
```
Then open http://localhost:3030 in your browser.

**Option 3: Open directly**
Just open `index.html` in your browser (some features may be limited without CORS).

## Usage

### 1. Get Pool Status

The most functional feature - fetches real-time pool information:

1. Copy a pool address from your test output (e.g., `DpkLHTkgQYYXrQAo1hRdn2ETxpZYo5d2aCbNLyCFLnJJ`)
2. Paste it into the "Pool Status" section
3. Click "Get Status"
4. View pool information including:
   - Current status (Registration/Settled/Completed)
   - Current price
   - Total participants
   - Settlement slot timing

### 2. Settle Lottery

Once a pool's settlement slot has been reached:

1. Connect your Phantom wallet (click any button to trigger connection)
2. Enter the pool address in "Settle Lottery" section
3. Click "Settle & Discover Price"
4. The interface will:
   - Check if settlement slot has been reached
   - Show time remaining if not ready
   - Execute settlement transaction
   - Display the clearing price

### 3. Create Pool / Register / Claim

These features require additional setup (token mints, vaults, accounts). For now, use the CLI test scripts:

```bash
# From project root
yarn test tests/simple-onchain.ts
```

The web interface will guide you to use CLI commands for these operations.

## Pool Addresses from Recent Tests

From the test output logs:

- **Lottery Pool PDA**: `DpkLHTkgQYYXrQAo1hRdn2ETxpZYo5d2aCbNLyCFLnJJ`
- **Program ID**: `C8x5EWRYp1QMESFn3pPeNVEfCD6ecE4iziUbqjw6RNrG`

Use these to test the "Get Pool Status" and "Settle Lottery" features.

## Network Configuration

- **Localhost** (default): `http://localhost:8899`
  - Requires `solana-test-validator` running
  - Fastest for development and testing

- **X1 Testnet**: `https://rpc.testnet.x1.xyz`
  - Public testnet (may require manual funding)
  - No validator needed

## Transaction Hashes

The console output displays transaction hashes from your interactions. Recent test transactions:

- Initialize Pool: `31EnkYZRSVEc3vRr9JcgHNvuy8GjathYGxdRpk7JHZEv2gZJxGSVsDWTcH9hgVaL4xS5ZStLVs3jRwRiYFLiZrMm`
- Register User: `3kd7UZ49QkRoJThp8DknpQm2CmNnZwibWYKuEXpYDVdoVh19ngSn5rR15ZymRiot3C3ryUiwpQRTmd9LNXvizn5y`

## Troubleshooting

**"Phantom wallet not found"**
- Install the Phantom browser extension
- Refresh the page after installation

**"Settlement slot has not been reached yet"**
- The interface shows estimated wait time
- Each slot is ~400ms
- For 100-slot registration period, wait ~40 seconds after pool creation

**Pool status fails to load**
- Ensure the pool address is correct
- Check that you're on the correct network (localhost vs testnet)
- Verify the validator is running (for localhost)

**Transaction fails**
- Ensure your wallet has enough SOL for transaction fees
- On localhost: `solana airdrop 1 <your-wallet-address> --url http://localhost:8899`
- On testnet: Use a faucet or request airdrop

## Architecture

The web interface uses:
- **Solana Web3.js**: Blockchain connection and transactions
- **Anchor Browser Bundle**: Program IDL and typed interactions
- **Embedded IDL**: No need to fetch IDL separately
- **Phantom Wallet**: Browser wallet integration

## Limitations

Currently, the following require CLI usage:
- Creating new pools (requires creating token mints and vaults)
- Registering for lotteries (requires USDC token accounts)
- Claiming tokens (requires XNT token accounts)

These features require more complex token account setup that's easier to handle via the TypeScript test scripts.

## Next Steps

To make the interface fully functional, you would need to:
1. Add token mint creation UI
2. Add token vault creation and initialization
3. Add associated token account creation for users
4. Add token transfer instructions
5. Handle all edge cases and error states

For now, use the CLI test scripts for the full workflow, and use the web interface for:
- Viewing pool status
- Settling lotteries
- Monitoring transactions
