#!/bin/bash

###############################################################################
# Price Corridor Bot Runner
#
# Runs the price corridor defense bot continuously, monitoring a pool
# and intervening when price moves outside $1.00-$2.00 corridor.
#
# Usage:
#   ./scripts/run-corridor-bot.sh [OPTIONS]
#
# Options:
#   --pool <address>     Pool PDA address to monitor (required)
#   --interval <ms>      Poll interval in milliseconds (default: 5000)
#   --rpc <url>          RPC endpoint (default: http://localhost:8899)
#   --wallet <path>      Wallet path (default: ~/.config/solana/id.json)
#   --help               Show this help message
#
# Examples:
#   # Monitor local pool
#   ./scripts/run-corridor-bot.sh --pool 9ZtH6nKCcb2kK6dkWrqXEjmdTR3G4L9CZG84tZ9m7nxb
#
#   # Monitor with custom interval
#   ./scripts/run-corridor-bot.sh --pool <POOL> --interval 3000
#
#   # Monitor on devnet
#   ./scripts/run-corridor-bot.sh --pool <POOL> --rpc https://api.devnet.solana.com
#
###############################################################################

set -e

# Default configuration
POOL_ADDRESS=""
POLL_INTERVAL=5000
RPC_URL="http://localhost:8899"
WALLET_PATH="$HOME/.config/solana/id.json"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Parse command line arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --pool)
      POOL_ADDRESS="$2"
      shift 2
      ;;
    --interval)
      POLL_INTERVAL="$2"
      shift 2
      ;;
    --rpc)
      RPC_URL="$2"
      shift 2
      ;;
    --wallet)
      WALLET_PATH="$2"
      shift 2
      ;;
    --help)
      head -n 30 "$0" | grep "^#" | sed 's/^# //; s/^#//'
      exit 0
      ;;
    *)
      echo -e "${RED}Unknown option: $1${NC}"
      echo "Use --help for usage information"
      exit 1
      ;;
  esac
done

# Validate required arguments
if [ -z "$POOL_ADDRESS" ]; then
  echo -e "${RED}Error: --pool argument is required${NC}"
  echo ""
  echo "Usage: $0 --pool <POOL_ADDRESS> [OPTIONS]"
  echo "Use --help for more information"
  exit 1
fi

# Validate wallet exists
if [ ! -f "$WALLET_PATH" ]; then
  echo -e "${RED}Error: Wallet file not found at $WALLET_PATH${NC}"
  echo "Specify wallet path with --wallet <path>"
  exit 1
fi

# Display configuration
echo ""
echo -e "${BLUE}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║          STARTING PRICE CORRIDOR DEFENSE BOT              ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${GREEN}Configuration:${NC}"
echo "  Pool Address:    $POOL_ADDRESS"
echo "  Poll Interval:   ${POLL_INTERVAL}ms"
echo "  RPC Endpoint:    $RPC_URL"
echo "  Wallet Path:     $WALLET_PATH"
echo ""
echo -e "${YELLOW}Press Ctrl+C to stop the bot gracefully${NC}"
echo ""

# Set environment variables
export ANCHOR_PROVIDER_URL="$RPC_URL"
export ANCHOR_WALLET="$WALLET_PATH"

# Run the bot
npx ts-node bots/price-corridor-bot.ts \
  --pool-address "$POOL_ADDRESS" \
  --interval "$POLL_INTERVAL"
