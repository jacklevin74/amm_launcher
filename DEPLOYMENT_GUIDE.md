# XNT Lottery AMM - Deployment & Operations Guide

## Table of Contents
1. [Overview](#overview)
2. [Prerequisites](#prerequisites)
3. [Initial Setup](#initial-setup)
4. [Starting the System](#starting-the-system)
5. [Reinitialization Process](#reinitialization-process)
6. [Common Gotchas](#common-gotchas)
7. [Troubleshooting](#troubleshooting)
8. [Architecture Notes](#architecture-notes)

---

## Overview

This is a Solana-based bonding curve AMM using native SOL (wSOL) as XNT token with a price corridor mechanism ($1.00 - $2.00).

**Key Components:**
- Solana program (Anchor framework)
- Local test validator
- Node.js web server
- Trading UI
- Admin panel

---

## Prerequisites

**Required Software:**
- Solana CLI tools (1.18+)
- Anchor CLI (0.29+)
- Node.js (16+)
- TypeScript (`ts-node`)

**Required Files:**
- Main wallet: `~/.config/solana/id.json` (authority)
- Trader wallet: `/tmp/trader-wallet.json` (for testing)

**Environment Variables:**
```bash
export ANCHOR_PROVIDER_URL=http://localhost:8899
export ANCHOR_WALLET=~/.config/solana/id.json
```

---

## Initial Setup

### 1. Build the Program

```bash
cd /Users/yakovlevin/dev/lottery_amm
anchor build
```

**Gotcha:** Always rebuild after modifying Rust code. The IDL will be regenerated.

### 2. Start Local Validator

```bash
# Kill any existing validator
pkill -9 solana-test-validator

# Start fresh validator
solana-test-validator --reset --quiet &

# Wait 3-5 seconds for validator to start
sleep 5

# Verify it's running
solana cluster-version
```

**Gotcha:** Validator must be fully started before deploying. If you get connection errors, wait longer.

### 3. Deploy Program

```bash
anchor deploy
```

**Output will show:**
```
Program Id: 2zKpM4k4kp7qRNvBVzkEAAt8DU8t1vpAfzsRagha4NNF
```

**Gotcha:** The program ID must match what's in `Anchor.toml` and `lib.rs`. If it doesn't match, update those files and rebuild.

### 4. Initialize Pool

```bash
ANCHOR_PROVIDER_URL=http://localhost:8899 \
ANCHOR_WALLET=~/.config/solana/id.json \
npx ts-node --transpile-only scripts/init-pool-native-mint.ts
```

**This script will:**
1. Create USDC mint (9 decimals)
2. Use native SOL mint for XNT (wSOL)
3. Create pool with 10M XNT and 10M virtual USDC
4. Fund ceiling reserve with 10M wSOL
5. Create trader wallet with 10M SOL and 10M USDC
6. Save configuration to:
   - `POOL_INFO.txt`
   - `web/pool-config.json`

**Expected Output:**
```
✅ XNT Mint (Native wSOL): So11111111111111111111111111111111111111112
✅ USDC Mint: [some address]
✅ Pool PDA: [pool address]
✅ Ceiling Reserve: [reserve address]
✅ Ceiling Reserve Balance: 10,000,000 wSOL
✅ Pool initialized with 10M wSOL (XNT)
```

**Gotcha:** The ceiling reserve MUST show 10M wSOL. If it shows 0, the init script has a bug.

### 5. Start Web Server

```bash
# Kill any existing server instances
pkill -9 -f "node server.js"
sleep 2

# Start server
cd web
node server.js &
```

**Server will start on:**
- Trading UI: http://localhost:3030/trading
- Admin Panel: http://localhost:3030/

**Gotcha:** Server caches the pool config on startup. If you reinitialize the pool, you MUST restart the server.

---

## Starting the System

### Quick Start (After Initial Setup)

```bash
# 1. Start validator
pkill -9 solana-test-validator
sleep 2
solana-test-validator --reset --quiet &
sleep 5

# 2. Deploy program
cd /Users/yakovlevin/dev/lottery_amm
anchor deploy

# 3. Initialize pool
ANCHOR_PROVIDER_URL=http://localhost:8899 \
ANCHOR_WALLET=~/.config/solana/id.json \
npx ts-node --transpile-only scripts/init-pool-native-mint.ts

# 4. Start web server
pkill -9 -f "node server.js"
sleep 2
cd web
node server.js &
```

### Verify Everything is Running

```bash
# Check validator
solana cluster-version

# Check pool state
solana account [pool-address-from-POOL_INFO.txt]

# Check ceiling reserve balance
solana account [ceiling-reserve-from-POOL_INFO.txt]

# Check web server
curl http://localhost:3030/api/config
```

---

## Reinitialization Process

**When to Reinitialize:**
- Validator was reset
- Testing changes to initialization logic
- Pool state became corrupted
- Starting fresh for testing

### Full Reinitialization Steps

```bash
# 1. Stop everything
pkill -9 solana-test-validator
pkill -9 -f "node server.js"
sleep 2

# 2. Start fresh validator
solana-test-validator --reset --quiet &
sleep 5

# 3. Ensure you have SOL for deployment
solana balance
# If balance is low:
solana airdrop 100

# 4. Deploy program
cd /Users/yakovlevin/dev/lottery_amm
anchor deploy

# 5. Initialize pool
ANCHOR_PROVIDER_URL=http://localhost:8899 \
ANCHOR_WALLET=~/.config/solana/id.json \
npx ts-node --transpile-only scripts/init-pool-native-mint.ts

# 6. Verify pool state
ANCHOR_PROVIDER_URL=http://localhost:8899 \
ANCHOR_WALLET=~/.config/solana/id.json \
npx ts-node -e "
import * as anchor from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';
import { BondingCurve } from './target/types/bonding_curve';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import * as fs from 'fs';

(async () => {
  const config = JSON.parse(fs.readFileSync('web/pool-config.json', 'utf-8'));
  const walletPath = process.env.ANCHOR_WALLET || process.env.HOME + '/.config/solana/id.json';
  const walletKeypair = Keypair.fromSecretKey(Buffer.from(JSON.parse(fs.readFileSync(walletPath, 'utf-8'))));

  const connection = new Connection('http://localhost:8899', 'confirmed');
  const wallet = new anchor.Wallet(walletKeypair);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: 'confirmed' });
  anchor.setProvider(provider);

  const program = anchor.workspace.BondingCurve as Program<BondingCurve>;
  const pool = await program.account.pool.fetch(new PublicKey(config.poolAddress));
  const ceilingBalance = await connection.getTokenAccountBalance(new PublicKey(config.ceilingReserveWSOL));

  console.log('✅ Pool State:');
  console.log('   XNT Reserve:', (Number(pool.xntReserve.toString()) / 1e9).toLocaleString(), 'wSOL');
  console.log('   USDC Reserve:', (Number(pool.usdcReserve.toString()) / 1e9).toLocaleString(), 'USDC');
  console.log('   Price:', '\$' + (Number(pool.usdcReserve.toString()) / Number(pool.xntReserve.toString())).toFixed(6));
  console.log('   Ceiling Reserve:', (Number(ceilingBalance.value.amount) / 1e9).toLocaleString(), 'wSOL');
})();
"

# 7. Start web server
cd web
node server.js &
```

**Expected Verification Output:**
```
✅ Pool State:
   XNT Reserve: 10,000,000 wSOL
   USDC Reserve: 10,000,000 USDC
   Price: $1.000000
   Ceiling Reserve: 10,000,000 wSOL
```

---

## Common Gotchas

### 1. Server Using Old Pool Address

**Symptom:** Buy/sell operations fail with "account not found"

**Cause:** Server loaded old pool config on startup

**Fix:**
```bash
pkill -9 -f "node server.js"
sleep 2
cd /Users/yakovlevin/dev/lottery_amm/web
node server.js &
```

### 2. Ceiling Reserve Shows 0 Balance

**Symptom:** Admin panel shows 0 wSOL in ceiling reserve

**Cause:** Init script didn't properly fund the ceiling reserve

**Fix:** The init script has been fixed in commit `64f7fc0`. If you're using an older version:
```bash
git pull
# Then reinitialize
```

### 3. Bash Variable Substitution Error

**Symptom:** `"/bin/sh: ${poolConfig.poolAddress}: bad substitution"`

**Cause:** Server.js has literal strings instead of variable references

**Fix:** This was fixed in commit `ac703fd`. Update code:
```bash
git pull
pkill -9 -f "node server.js"
cd /Users/yakovlevin/dev/lottery_amm/web
node server.js &
```

### 4. TypeScript Variable Redeclaration

**Symptom:** `error TS2451: Cannot redeclare block-scoped variable`

**Cause:** Variable names used twice in init script

**Fix:** Fixed in commit `199fd72`. Variables were renamed to:
- `wrapReserveIx`, `syncReserveIx`, `wrapReserveTx`

### 5. Program ID Mismatch

**Symptom:** `Program [...] not found` or `Invalid program id`

**Cause:** Program ID in code doesn't match deployed program

**Fix:**
1. Check deployed program ID: `solana program show [program-id]`
2. Update `Anchor.toml`:
   ```toml
   [programs.localnet]
   bonding_curve = "2zKpM4k4kp7qRNvBVzkEAAt8DU8t1vpAfzsRagha4NNF"
   ```
3. Update `programs/bonding_curve/src/lib.rs`:
   ```rust
   declare_id!("2zKpM4k4kp7qRNvBVzkEAAt8DU8t1vpAfzsRagha4NNF");
   ```
4. Rebuild: `anchor build`

### 6. Validator Not Fully Started

**Symptom:** Connection refused errors during deployment

**Fix:** Wait longer after starting validator:
```bash
solana-test-validator --reset --quiet &
sleep 10  # Increase wait time
```

### 7. Insufficient SOL for Transactions

**Symptom:** Transaction fails with insufficient funds

**Fix:**
```bash
solana airdrop 100
```

---

## Troubleshooting

### Check Validator Status

```bash
# Is validator running?
ps aux | grep solana-test-validator

# Can you connect?
solana cluster-version

# Check validator logs
solana logs --url localhost
```

### Check Server Status

```bash
# Is server running?
ps aux | grep "node server.js"

# Check server logs (if running in background)
# Server logs to stdout, check terminal where it was started

# Test API endpoints
curl http://localhost:3030/api/config
curl http://localhost:3030/api/pool-data
```

### Check Pool State

```bash
# Using Solana CLI
solana account [pool-address] --url http://localhost:8899

# Using Anchor
anchor run check-pool
```

### View Transaction Logs

```bash
# Real-time logs filtered for pool/errors
solana logs --url localhost 2>&1 | grep -i "pool\|error"
```

### Common Error Messages

| Error | Cause | Fix |
|-------|-------|-----|
| `Account not found` | Wrong pool address or not initialized | Verify pool-config.json, reinitialize if needed |
| `Invalid account data` | Program mismatch | Redeploy program, reinitialize pool |
| `Transaction simulation failed` | Insufficient funds or invalid instruction | Check SOL balance, verify parameters |
| `bad substitution` | JavaScript variable error in server.js | Update to latest code (commit ac703fd) |
| `Cannot redeclare variable` | TypeScript compilation error | Update to latest code (commit 199fd72) |

---

## Architecture Notes

### Token Design

- **XNT Token:** Uses native SOL mint (`So11111111111111111111111111111111111111112`)
  - This is wSOL (wrapped SOL)
  - No custom wrap/unwrap needed
  - Standard Solana wallets handle wrapping automatically

- **USDC Token:** Custom SPL token with 9 decimals (matching wSOL)
  - Created during pool initialization
  - Minted to trader for testing

### Pool Mechanism

```
Price = USDC_Reserve / XNT_Reserve

Initial State:
- XNT Reserve: 10,000,000 wSOL
- USDC Reserve: 10,000,000 USDC (virtual)
- Price: $1.00

Price Corridor:
- Floor: $1.00 (enforced by program)
- Ceiling: $2.00 (enforced by ceiling reserve injection)
```

### Ceiling Reserve Mechanism

When price exceeds $2.00:
1. Program calculates XNT needed to push price back to $2.00
2. Transfers XNT from ceiling reserve to pool
3. Price automatically drops back to $2.00
4. Reserve is depleted over time

**Critical:** Ceiling reserve MUST be funded with sufficient wSOL. Current target: 10M wSOL.

### File Structure

```
lottery_amm/
├── programs/
│   └── bonding_curve/
│       ├── src/
│       │   └── lib.rs          # Solana program
│       └── Cargo.toml
├── scripts/
│   ├── init-pool-native-mint.ts  # Pool initialization
│   ├── web-buy.ts                # Buy execution script
│   └── web-sell.ts               # Sell execution script
├── web/
│   ├── server.js                 # Node.js backend
│   ├── trading.html              # Trading UI
│   ├── trading-app.js            # Trading UI logic
│   ├── index.html                # Admin panel
│   ├── admin-app.js              # Admin panel logic
│   └── pool-config.json          # Generated config (DO NOT EDIT)
├── POOL_INFO.txt                 # Generated pool info
├── Anchor.toml                   # Anchor config
└── package.json
```

### Configuration Files

**Auto-generated (don't edit manually):**
- `web/pool-config.json` - Pool addresses and mints
- `POOL_INFO.txt` - Human-readable pool info
- `target/idl/bonding_curve.json` - Program IDL

**Edit these to configure:**
- `Anchor.toml` - Program ID, cluster URLs
- `programs/bonding_curve/src/lib.rs` - Program ID declaration

---

## Git Commits Reference

Key commits for troubleshooting:

- `ac703fd` - Fix bash variable substitution bug in server.js
- `64f7fc0` - Fix ceiling reserve funding in init script
- `199fd72` - Fix variable name conflicts in init script
- `cb0165d` - Update pool configuration after reinitialization
- `966cd75` - Improve UI layout: remove XNT balance, add section divider

---

## Quick Command Reference

```bash
# Start everything fresh
pkill -9 solana-test-validator; pkill -9 -f "node server.js"; sleep 2
solana-test-validator --reset --quiet & sleep 5
cd /Users/yakovlevin/dev/lottery_amm
anchor deploy
ANCHOR_PROVIDER_URL=http://localhost:8899 ANCHOR_WALLET=~/.config/solana/id.json \
  npx ts-node --transpile-only scripts/init-pool-native-mint.ts
cd web && node server.js &

# Restart just the server
pkill -9 -f "node server.js"; sleep 2
cd /Users/yakovlevin/dev/lottery_amm/web && node server.js &

# Check pool balance
solana account $(jq -r '.ceilingReserveWSOL' web/pool-config.json)

# View real-time logs
solana logs --url localhost
```

---

## Support

For issues:
1. Check this guide first
2. Review recent commits for fixes
3. Check background bash processes: `ps aux | grep -E "solana|node"`
4. Review server logs and validator logs
