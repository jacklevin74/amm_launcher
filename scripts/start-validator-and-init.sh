#!/bin/bash

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${YELLOW}🛑 Stopping any existing validator...${NC}"
pkill -9 solana-test-validator 2>/dev/null || true
sleep 2

echo -e "${YELLOW}🧹 Cleaning up test ledger...${NC}"
rm -rf test-ledger

echo -e "${GREEN}🚀 Starting test validator...${NC}"

# Start validator in background
solana-test-validator --reset > /tmp/validator.log 2>&1 &

VALIDATOR_PID=$!
echo -e "${GREEN}✅ Validator started (PID: ${VALIDATOR_PID})${NC}"

echo -e "${YELLOW}⏳ Waiting for validator to be ready...${NC}"
for i in {1..10}; do
  if solana cluster-version --url http://localhost:8899 &>/dev/null; then
    echo -e "${GREEN}✅ Validator is ready!${NC}"
    break
  fi
  echo "   Waiting... ($i/10)"
  sleep 1
done

# Verify validator is running
if ! solana cluster-version --url http://localhost:8899 &>/dev/null; then
  echo -e "${RED}❌ Validator failed to start. Check /tmp/validator.log for details.${NC}"
  exit 1
fi

WALLET_PATH="$HOME/.config/solana/id.json"
WALLET_ADDRESS=$(solana address -k ${WALLET_PATH})
FAUCET_KEYPAIR="test-ledger/faucet-keypair.json"

echo -e "${YELLOW}💰 Transferring 50M SOL from faucet to ${WALLET_ADDRESS}...${NC}"
solana transfer ${WALLET_ADDRESS} 50000000 --from ${FAUCET_KEYPAIR} --url http://localhost:8899 --allow-unfunded-recipient

echo -e "${GREEN}💰 Checking wallet balance...${NC}"
BALANCE=$(solana balance ${WALLET_ADDRESS} --url http://localhost:8899)
echo -e "${GREEN}   Balance: ${BALANCE}${NC}"

echo -e "${YELLOW}🏗️  Building program...${NC}"
anchor build

echo -e "${YELLOW}📦 Deploying program...${NC}"
anchor deploy --provider.cluster http://localhost:8899

echo -e "${YELLOW}🎯 Running pool initialization...${NC}"
ANCHOR_PROVIDER_URL=http://localhost:8899 ANCHOR_WALLET=~/.config/solana/id.json npx ts-node scripts/init-pool-native-mint.ts

echo -e "${GREEN}🎉 Complete! Validator is running in background (PID: ${VALIDATOR_PID})${NC}"
echo -e "${YELLOW}📝 To stop validator: pkill solana-test-validator${NC}"
echo -e "${YELLOW}📊 View logs: tail -f /tmp/validator.log${NC}"
