# Setup Commands Reference

## 🚀 Automated Setup (Recommended)

**One command does everything:**

```bash
./scripts/setup-test-pool.sh
```

This will:
1. ✅ Build the program
2. ✅ Start test validator
3. ✅ Deploy program
4. ✅ Fund wallet with SOL
5. ✅ Create token mints
6. ✅ Initialize pool with 10M XNT at $1.00
7. ✅ Mint 20M XNT bot reserves
8. ✅ Display pool address and next steps

---

## 📝 Manual Setup (Step-by-Step)

If you prefer to run commands manually:

### Step 1: Build the Program

```bash
cd /Users/yakovlevin/dev/lottery_amm
anchor build
```

Get the program ID:
```bash
solana address -k target/deploy/bonding_curve-keypair.json
```

---

### Step 2: Start Test Validator

```bash
# Get your program ID first
PROGRAM_ID=$(solana address -k target/deploy/bonding_curve-keypair.json)

# Start validator with program preloaded
solana-test-validator \
  --reset \
  --bpf-program $PROGRAM_ID target/deploy/bonding_curve.so
```

**Keep this terminal running!**

---

### Step 3: Configure Solana CLI (New Terminal)

```bash
# Set cluster to localhost
solana config set --url http://localhost:8899

# Verify
solana cluster-version
```

---

### Step 4: Fund Your Wallet

```bash
# Check your wallet address
solana address

# Airdrop SOL
solana airdrop 10

# Verify balance
solana balance
```

---

### Step 5: Deploy Program (If Not Preloaded)

```bash
# If you didn't use --bpf-program flag
solana program deploy target/deploy/bonding_curve.so

# Verify deployment
PROGRAM_ID=$(solana address -k target/deploy/bonding_curve-keypair.json)
solana program show $PROGRAM_ID
```

---

### Step 6: Initialize Pool

Use the TypeScript initialization script:

```bash
# Set environment variables
export ANCHOR_PROVIDER_URL=http://localhost:8899
export ANCHOR_WALLET=~/.config/solana/id.json

# Run initialization (you'll need to create this script or use the test)
npx ts-node -e "
import * as anchor from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';
import { BondingCurve } from './target/types/bonding_curve';
import {
  TOKEN_PROGRAM_ID,
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from '@solana/spl-token';
import { Keypair, Connection } from '@solana/web3.js';
import * as fs from 'fs';

const INITIAL_XNT = 10_000_000_000_000;
const VIRTUAL_USDC = 10_000_000_000_000;
const BOT_RESERVE = 20_000_000_000_000;

async function main() {
  const walletPath = process.env.HOME + '/.config/solana/id.json';
  const walletKeypair = Keypair.fromSecretKey(
    Buffer.from(JSON.parse(fs.readFileSync(walletPath, 'utf-8')))
  );

  const connection = new Connection('http://localhost:8899', 'confirmed');
  const wallet = new anchor.Wallet(walletKeypair);
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: 'confirmed',
  });
  anchor.setProvider(provider);

  const program = anchor.workspace.BondingCurve as Program<BondingCurve>;

  // Create mints
  const xntMint = await createMint(connection, walletKeypair, walletKeypair.publicKey, null, 6);
  const usdcMint = await createMint(connection, walletKeypair, walletKeypair.publicKey, null, 6);

  console.log('XNT Mint:', xntMint.toString());
  console.log('USDC Mint:', usdcMint.toString());

  // Derive pool
  const [poolPda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from('pool'), xntMint.toBuffer(), usdcMint.toBuffer()],
    program.programId
  );

  console.log('Pool PDA:', poolPda.toString());

  // Create and fund authority account
  const authorityXnt = await getOrCreateAssociatedTokenAccount(
    connection, walletKeypair, xntMint, walletKeypair.publicKey
  );

  await mintTo(
    connection, walletKeypair, xntMint,
    authorityXnt.address, walletKeypair.publicKey,
    INITIAL_XNT + BOT_RESERVE
  );

  // Initialize pool
  const poolXntKeypair = Keypair.generate();
  const poolUsdcKeypair = Keypair.generate();

  await program.methods
    .initializePool(new anchor.BN(INITIAL_XNT), new anchor.BN(VIRTUAL_USDC))
    .accounts({
      initializer: walletKeypair.publicKey,
      pool: poolPda,
      xntMint,
      usdcMint,
      poolXnt: poolXntKeypair.publicKey,
      poolUsdc: poolUsdcKeypair.publicKey,
      initializerXnt: authorityXnt.address,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .signers([poolXntKeypair, poolUsdcKeypair])
    .rpc();

  const pool = await program.account.pool.fetch(poolPda);
  console.log('Pool initialized!');
  console.log('Price:', pool.usdcReserve.toNumber() / pool.xntReserve.toNumber());
  console.log('');
  console.log('START BOT WITH:');
  console.log('./scripts/run-corridor-bot.sh --pool', poolPda.toString());
}

main().catch(console.error);
"
```

Or simply run the demo test which does all of this:

```bash
export ANCHOR_PROVIDER_URL=http://localhost:8899
export ANCHOR_WALLET=~/.config/solana/id.json
npx ts-mocha -p ./tsconfig.json -t 1000000 tests/price-corridor-demo.ts
```

---

## 🎯 Quick Commands Summary

### Automated (Easiest)
```bash
./scripts/setup-test-pool.sh
```

### Manual (Full Control)
```bash
# 1. Build
anchor build

# 2. Start validator
PROGRAM_ID=$(solana address -k target/deploy/bonding_curve-keypair.json)
solana-test-validator --reset --bpf-program $PROGRAM_ID target/deploy/bonding_curve.so

# 3. In new terminal - Configure & fund
solana config set --url http://localhost:8899
solana airdrop 10

# 4. Initialize pool
# Use the automated script:
./scripts/setup-test-pool.sh
# (It will detect existing validator and just create the pool)
```

---

## 📍 Getting Pool Address

After setup, the pool address is displayed. You can also find it:

### From setup script output:
```bash
./scripts/setup-test-pool.sh
# Look for "Pool Address: <address>" in the output
```

### From saved file:
```bash
cat .test-pool-info.json | grep poolPda
```

### Calculate it manually:
```typescript
// The pool PDA is derived as:
[poolPda] = PublicKey.findProgramAddressSync(
  [Buffer.from("pool"), xntMint.toBuffer(), usdcMint.toBuffer()],
  programId
);
```

---

## 🤖 Starting the Bot

Once you have the pool address:

```bash
./scripts/run-corridor-bot.sh --pool <POOL_ADDRESS>
```

Example:
```bash
./scripts/run-corridor-bot.sh --pool 9ZtH6nKCcb2kK6dkWrqXEjmdTR3G4L9CZG84tZ9m7nxb
```

---

## 🧪 Testing the Bot

### Option 1: Run demo test
```bash
export ANCHOR_PROVIDER_URL=http://localhost:8899
export ANCHOR_WALLET=~/.config/solana/id.json
npx ts-mocha -p ./tsconfig.json -t 1000000 tests/price-corridor-demo.ts
```

### Option 2: Bot + Simulator (2 terminals)

**Terminal 1:** Start bot
```bash
./scripts/run-corridor-bot.sh --pool <POOL_ADDRESS>
```

**Terminal 2:** Generate trades
```bash
export ANCHOR_PROVIDER_URL=http://localhost:8899
export ANCHOR_WALLET=~/.config/solana/id.json
npx ts-node bots/test-corridor-bot.ts
```

---

## 🔧 Troubleshooting

### Port 8899 already in use
```bash
# Kill existing validator
pkill -9 solana-test-validator

# Then restart
./scripts/setup-test-pool.sh
```

### Program not found
```bash
# Make sure you built first
anchor build

# Verify program ID matches
solana address -k target/deploy/bonding_curve-keypair.json
```

### Wallet not found
```bash
# Check wallet exists
ls -la ~/.config/solana/id.json

# If not, create one
solana-keygen new --outfile ~/.config/solana/id.json
```

### Pool already exists
```bash
# If you get "account already exists", restart validator with --reset
pkill -9 solana-test-validator
solana-test-validator --reset --bpf-program $PROGRAM_ID target/deploy/bonding_curve.so
```

---

## 📚 Environment Variables

These are automatically set by the scripts, but if running manually:

```bash
export ANCHOR_PROVIDER_URL=http://localhost:8899
export ANCHOR_WALLET=~/.config/solana/id.json
```

For devnet:
```bash
export ANCHOR_PROVIDER_URL=https://api.devnet.solana.com
export ANCHOR_WALLET=~/.config/solana/devnet.json
```

---

## 🎓 Understanding the Setup

**What the automated script does:**

1. **Builds program** → Compiles Rust code to BPF bytecode
2. **Starts validator** → Local Solana blockchain on port 8899
3. **Deploys program** → Uploads bytecode to blockchain
4. **Creates mints** → XNT and USDC token contracts
5. **Funds accounts** → Airdrops SOL, mints tokens
6. **Initializes pool** → Creates bonding curve with:
   - 10M XNT at $1.00
   - 10M virtual USDC
   - 20M XNT bot reserves

**Why bot needs reserves:**

The bot injects XNT when price is too high. It needs a supply of XNT tokens to inject. The 20M reserve ensures the bot can intervene multiple times without running out.

---

## 🚀 Production Deployment

For mainnet/devnet deployment:

1. Use a dedicated wallet with sufficient SOL
2. Deploy using Anchor deploy:
   ```bash
   anchor deploy --provider.cluster mainnet
   ```
3. Initialize pool using the deployment script
4. Fund bot wallet with XNT reserves
5. Run bot on a VPS with monitoring

See [CORRIDOR_BOT_GUIDE.md](./CORRIDOR_BOT_GUIDE.md) for production best practices.
