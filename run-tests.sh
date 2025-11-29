#!/bin/bash

# Bonding Curve AMM Test Runner
# Usage: ./run-tests.sh [test-file] [--restart]
# Examples:
#   ./run-tests.sh                                    # Run default test
#   ./run-tests.sh tests/bonding-curve-deposits.ts   # Run specific test
#   ./run-tests.sh tests/bonding-curve-deposits.ts --restart  # Restart validator first

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║         Bonding Curve AMM - Test Runner                   ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════╝${NC}"
echo ""

# Get test file from argument or use default
TEST_FILE=${1:-"tests/bonding-curve-deposits.ts"}

echo -e "${YELLOW}📋 Test Configuration:${NC}"
echo -e "   Test file: ${TEST_FILE}"
echo -e "   Provider: http://localhost:8899"
echo -e "   Wallet: ~/.config/solana/id.json"
echo ""

# Step 1: Check if validator is running
echo -e "${YELLOW}🔍 Step 1: Checking validator status...${NC}"
if pgrep -x "solana-test-va" > /dev/null; then
    echo -e "${GREEN}✅ Validator is running${NC}"
    VALIDATOR_RUNNING=true
else
    echo -e "${RED}❌ Validator not running${NC}"
    VALIDATOR_RUNNING=false
fi
echo ""

# Step 2: Restart validator if requested or not running
if [ "$VALIDATOR_RUNNING" = false ] || [ "$2" = "--restart" ]; then
    echo -e "${YELLOW}🔄 Step 2: Starting fresh validator...${NC}"
    pkill solana-test-validator 2>/dev/null || true
    sleep 2
    solana-test-validator --reset > /dev/null 2>&1 &
    echo -e "${GREEN}✅ Validator started${NC}"
    sleep 5
else
    echo -e "${YELLOW}⏭️  Step 2: Skipping validator restart (use --restart to force)${NC}"
fi
echo ""

# Step 3: Check SOL balance and airdrop if needed
echo -e "${YELLOW}💰 Step 3: Checking wallet balance...${NC}"
BALANCE=$(solana balance 2>/dev/null | awk '{print $1}')
echo -e "   Current balance: ${BALANCE} SOL"

if (( $(echo "$BALANCE < 100" | bc -l) )); then
    echo -e "   Airdropping 1000 SOL..."
    solana airdrop 1000 > /dev/null 2>&1
    echo -e "${GREEN}✅ Airdrop complete${NC}"
else
    echo -e "${GREEN}✅ Sufficient balance${NC}"
fi
echo ""

# Step 4: Airdrop to test wallet
echo -e "${YELLOW}💸 Step 4: Funding test wallet...${NC}"
TEST_WALLET="FMEbtsgxMmxMBUvRRBAXye7XZPbJdXaADCPQ2nf7emXG"
solana airdrop 1000 $TEST_WALLET > /dev/null 2>&1 || true
echo -e "${GREEN}✅ Test wallet funded${NC}"
echo ""

# Step 5: Build program
echo -e "${YELLOW}🔨 Step 5: Building bonding curve program...${NC}"
anchor build --skip-lint --program-name bonding_curve 2>&1 | tail -5
if [ ${PIPESTATUS[0]} -eq 0 ]; then
    echo -e "${GREEN}✅ Build successful${NC}"
else
    echo -e "${RED}❌ Build failed${NC}"
    exit 1
fi
echo ""

# Step 6: Deploy program
echo -e "${YELLOW}🚀 Step 6: Deploying program...${NC}"
DEPLOY_OUTPUT=$(solana program deploy target/deploy/bonding_curve.so \
    --program-id target/deploy/bonding_curve-keypair.json 2>&1)
PROGRAM_ID=$(echo "$DEPLOY_OUTPUT" | grep "Program Id:" | awk '{print $3}')
echo -e "   Program ID: ${PROGRAM_ID}"
echo -e "${GREEN}✅ Deployment successful${NC}"
echo ""

# Step 7: Run tests
echo -e "${YELLOW}🧪 Step 7: Running tests...${NC}"
echo -e "${BLUE}════════════════════════════════════════════════════════════${NC}"
echo ""

export ANCHOR_PROVIDER_URL=http://localhost:8899
export ANCHOR_WALLET=~/.config/solana/id.json

yarn run ts-mocha -p ./tsconfig.json -t 200000 "$TEST_FILE"

TEST_EXIT_CODE=$?

echo ""
echo -e "${BLUE}════════════════════════════════════════════════════════════${NC}"

if [ $TEST_EXIT_CODE -eq 0 ]; then
    echo -e "${GREEN}╔════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║                 ✅ ALL TESTS PASSED ✅                      ║${NC}"
    echo -e "${GREEN}╚════════════════════════════════════════════════════════════╝${NC}"
else
    echo -e "${RED}╔════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${RED}║                 ❌ TESTS FAILED ❌                          ║${NC}"
    echo -e "${RED}╚════════════════════════════════════════════════════════════╝${NC}"
fi

exit $TEST_EXIT_CODE
