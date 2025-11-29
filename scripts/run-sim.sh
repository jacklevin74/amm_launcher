#!/bin/bash

# Run trading simulation with CLI arguments
# Usage: ./scripts/run-sim.sh [orders] [usdc_per_order] [delay_ms]

ORDERS=${1:-1000}
USDC=${2:-1000}
DELAY=${3:-0}

cd "$(dirname "$0")/.."
npx ts-node --transpile-only tests/live-trading-sim.ts "$ORDERS" "$USDC" "$DELAY"
