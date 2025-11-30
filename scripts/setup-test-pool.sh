#!/bin/bash

###############################################################################
# Setup Test Pool for Price Corridor Bot
#
# This script:
# 1. Builds the Solana program
# 2. Starts a local test validator
# 3. Deploys the program
# 4. Creates and funds accounts
# 5. Initializes a bonding curve pool
# 6. Provides the pool address for bot monitoring
#
# Usage:
#   ./scripts/setup-test-pool.sh
#
###############################################################################

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Configuration
INITIAL_XNT=10000000000000        # 10M XNT
VIRTUAL_USDC=10000000000000       # 10M USDC (virtual)
BOT_RESERVE_XNT=20000000000000    # 20M XNT for bot reserves
WALLET_PATH="$HOME/.config/solana/id.json"

echo ""
echo -e "${BLUE}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║         BONDING CURVE POOL SETUP FOR BOT TESTING          ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════╝${NC}"
echo ""

# Step 1: Build the program
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}Step 1: Building Solana program...${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# Build only bonding_curve program (skip lottery_amm which has errors)
cd programs/bonding_curve && cargo build-sbf 2>&1 | grep -E "(Finished|error)" && cd ../..

PROGRAM_ID=$(solana address -k target/deploy/bonding_curve-keypair.json)
echo ""
echo -e "${GREEN}✅ Program built successfully!${NC}"
echo -e "   Program ID: ${YELLOW}$PROGRAM_ID${NC}"
echo ""

# Step 2: Check if validator is already running
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}Step 2: Checking test validator...${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

if lsof -Pi :8899 -sTCP:LISTEN -t >/dev/null 2>&1 ; then
    echo -e "${YELLOW}⚠️  Test validator already running on port 8899${NC}"
    echo -e "   If you need to restart, run: ${CYAN}pkill -9 solana-test-validator${NC}"
    echo -e "   Using existing validator..."
    echo ""
else
    echo -e "${GREEN}Starting new test validator...${NC}"
    echo ""

    # Start validator in background
    solana-test-validator \
        --reset \
        --quiet \
        --bpf-program $PROGRAM_ID target/deploy/bonding_curve.so \
        > /tmp/test-validator.log 2>&1 &

    VALIDATOR_PID=$!
    echo -e "${GREEN}✅ Test validator started (PID: $VALIDATOR_PID)${NC}"
    echo ""

    # Wait for validator to be ready
    echo -e "${YELLOW}Waiting for validator to be ready...${NC}"
    sleep 5

    # Check if validator is responsive
    if ! solana cluster-version -u http://localhost:8899 >/dev/null 2>&1; then
        echo -e "${RED}❌ Validator failed to start properly${NC}"
        exit 1
    fi

    echo -e "${GREEN}✅ Validator is ready!${NC}"
    echo ""
fi

# Set Solana config to use local validator
solana config set --url http://localhost:8899 >/dev/null 2>&1

# Step 3: Fund the wallet
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}Step 3: Funding wallet...${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

WALLET_PUBKEY=$(solana address -k $WALLET_PATH)
echo -e "   Wallet: ${YELLOW}$WALLET_PUBKEY${NC}"

# Airdrop SOL
solana airdrop 10 $WALLET_PUBKEY -u http://localhost:8899 >/dev/null 2>&1
BALANCE=$(solana balance $WALLET_PUBKEY -u http://localhost:8899 | awk '{print $1}')

echo -e "${GREEN}✅ Wallet funded with $BALANCE SOL${NC}"
echo ""

# Step 4: Deploy program (if not already deployed)
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}Step 4: Verifying program deployment...${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

if solana program show $PROGRAM_ID -u http://localhost:8899 >/dev/null 2>&1; then
    echo -e "${GREEN}✅ Program already deployed at: ${YELLOW}$PROGRAM_ID${NC}"
else
    echo -e "${YELLOW}Deploying program...${NC}"
    solana program deploy target/deploy/bonding_curve.so -u http://localhost:8899
    echo -e "${GREEN}✅ Program deployed at: ${YELLOW}$PROGRAM_ID${NC}"
fi
echo ""

# Step 5: Initialize pool using TypeScript
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}Step 5: Creating bonding curve pool...${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# Create a temporary TypeScript file to initialize the pool
cat > /tmp/init-pool.ts << 'EOF'
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { BondingCurve } from "./target/types/bonding_curve";
import {
  TOKEN_PROGRAM_ID,
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import { Keypair, Connection } from "@solana/web3.js";
import * as fs from "fs";

const INITIAL_XNT = 10_000_000_000_000;      // 10M XNT
const VIRTUAL_USDC = 10_000_000_000_000;     // 10M USDC
const BOT_RESERVE_XNT = 20_000_000_000_000;  // 20M XNT

async function main() {
  const walletPath = process.env.HOME + "/.config/solana/id.json";
  const walletKeypair = Keypair.fromSecretKey(
    Buffer.from(JSON.parse(fs.readFileSync(walletPath, "utf-8")))
  );

  const connection = new Connection("http://localhost:8899", "confirmed");
  const wallet = new anchor.Wallet(walletKeypair);
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  anchor.setProvider(provider);

  const program = anchor.workspace.BondingCurve as Program<BondingCurve>;

  console.log("📊 Creating token mints...");

  // Create XNT mint
  const xntMint = await createMint(
    connection,
    walletKeypair,
    walletKeypair.publicKey,
    null,
    6
  );
  console.log(`   ✅ XNT Mint: ${xntMint.toString()}`);

  // Create USDC mint
  const usdcMint = await createMint(
    connection,
    walletKeypair,
    walletKeypair.publicKey,
    null,
    6
  );
  console.log(`   ✅ USDC Mint: ${usdcMint.toString()}`);

  // Derive pool PDA
  const [poolPda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("pool"), xntMint.toBuffer(), usdcMint.toBuffer()],
    program.programId
  );
  console.log(`   ✅ Pool PDA: ${poolPda.toString()}`);

  // Create authority XNT account
  const authorityXntAccount = await getOrCreateAssociatedTokenAccount(
    connection,
    walletKeypair,
    xntMint,
    walletKeypair.publicKey
  );

  // Mint XNT (pool + bot reserves)
  console.log("\n💰 Minting tokens...");
  await mintTo(
    connection,
    walletKeypair,
    xntMint,
    authorityXntAccount.address,
    walletKeypair.publicKey,
    INITIAL_XNT + BOT_RESERVE_XNT
  );
  console.log(`   ✅ Minted ${(INITIAL_XNT + BOT_RESERVE_XNT) / 1e6}M XNT`);
  console.log(`      - ${INITIAL_XNT / 1e6}M for pool`);
  console.log(`      - ${BOT_RESERVE_XNT / 1e6}M for bot reserves`);

  // Initialize pool
  console.log("\n📊 Initializing bonding curve pool...");
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
      initializerXnt: authorityXntAccount.address,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .signers([poolXntKeypair, poolUsdcKeypair])
    .rpc();

  const pool = await program.account.pool.fetch(poolPda);
  const startingPrice = pool.usdcReserve.toNumber() / pool.xntReserve.toNumber();

  console.log(`   ✅ Pool initialized!`);
  console.log(`      XNT Reserve: ${pool.xntReserve.toNumber() / 1e6}M XNT`);
  console.log(`      USDC Reserve: $${pool.usdcReserve.toNumber() / 1e6}M (virtual)`);
  console.log(`      Starting Price: $${startingPrice.toFixed(2)}`);

  // Save pool info to file
  const poolInfo = {
    programId: program.programId.toString(),
    poolPda: poolPda.toString(),
    xntMint: xntMint.toString(),
    usdcMint: usdcMint.toString(),
    poolXnt: poolXntKeypair.publicKey.toString(),
    poolUsdc: poolUsdcKeypair.publicKey.toString(),
    authorityXnt: authorityXntAccount.address.toString(),
    initialXnt: INITIAL_XNT,
    virtualUsdc: VIRTUAL_USDC,
    botReserveXnt: BOT_RESERVE_XNT,
    startingPrice,
  };

  fs.writeFileSync(".test-pool-info.json", JSON.stringify(poolInfo, null, 2));
  console.log("\n   📄 Pool info saved to .test-pool-info.json");

  // Output just the pool address for the script
  console.log("\nPOOL_ADDRESS=" + poolPda.toString());
}

main().catch(console.error);
EOF

# Run the pool initialization
export ANCHOR_PROVIDER_URL=http://localhost:8899
export ANCHOR_WALLET=$WALLET_PATH

OUTPUT=$(npx ts-node /tmp/init-pool.ts 2>&1)
echo "$OUTPUT"

# Extract pool address from output
POOL_ADDRESS=$(echo "$OUTPUT" | grep "POOL_ADDRESS=" | cut -d'=' -f2)

if [ -z "$POOL_ADDRESS" ]; then
    echo -e "${RED}❌ Failed to create pool${NC}"
    exit 1
fi

# Clean up temp file
rm /tmp/init-pool.ts

echo ""
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}✅ SETUP COMPLETE!${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "${BLUE}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║                    POOL INFORMATION                       ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "   Program ID:       ${YELLOW}$PROGRAM_ID${NC}"
echo -e "   Pool Address:     ${YELLOW}$POOL_ADDRESS${NC}"
echo -e "   Wallet:           ${YELLOW}$WALLET_PUBKEY${NC}"
echo -e "   RPC Endpoint:     ${YELLOW}http://localhost:8899${NC}"
echo ""
echo -e "   Pool State:"
echo -e "     • 10M XNT at $1.00"
echo -e "     • 10M USDC (virtual)"
echo -e "     • 20M XNT bot reserves"
echo ""
echo -e "${BLUE}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║                   NEXT STEPS                              ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${GREEN}1. Start the Price Corridor Bot:${NC}"
echo ""
echo -e "   ${CYAN}./scripts/run-corridor-bot.sh --pool $POOL_ADDRESS${NC}"
echo ""
echo -e "${GREEN}2. Generate market activity (in another terminal):${NC}"
echo ""
echo -e "   ${CYAN}ANCHOR_PROVIDER_URL=http://localhost:8899 \\${NC}"
echo -e "   ${CYAN}ANCHOR_WALLET=~/.config/solana/id.json \\${NC}"
echo -e "   ${CYAN}npx ts-node bots/test-corridor-bot.ts${NC}"
echo ""
echo -e "${GREEN}3. Or run the automated demo:${NC}"
echo ""
echo -e "   ${CYAN}ANCHOR_PROVIDER_URL=http://localhost:8899 \\${NC}"
echo -e "   ${CYAN}ANCHOR_WALLET=~/.config/solana/id.json \\${NC}"
echo -e "   ${CYAN}npx ts-mocha -p ./tsconfig.json -t 1000000 tests/price-corridor-demo.ts${NC}"
echo ""
echo -e "${YELLOW}📝 Note: Test validator is running in the background${NC}"
echo -e "${YELLOW}   To stop it: ${CYAN}pkill -9 solana-test-validator${NC}"
echo ""
