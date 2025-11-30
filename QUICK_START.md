# 🚀 Quick Start: Run the Continuous Monitoring Bot

## Three Simple Steps

### 1️⃣ Start Test Validator (Terminal 1)

```bash
cd /Users/yakovlevin/dev/lottery_amm
./run-tests.sh
```

**Leave this running** ✅

---

### 2️⃣ Start the Bot (Terminal 2)

```bash
cd /Users/yakovlevin/dev/lottery_amm

# Use the launcher script
./scripts/run-corridor-bot.sh --pool <POOL_PDA>

# Or run directly
ANCHOR_PROVIDER_URL=http://localhost:8899 \
ANCHOR_WALLET=~/.config/solana/id.json \
npx ts-node bots/price-corridor-bot.ts --pool-address <POOL_PDA>
```

**The bot is now running continuously!** 🤖

You'll see:
```
╔════════════════════════════════════════════════════════════╗
║          XNT PRICE CORRIDOR DEFENSE BOT v1.0             ║
╚════════════════════════════════════════════════════════════╝

🚀 Starting price corridor monitoring...

[2025-11-29T10:15:23.456Z] Price: $1.234567 | XNT: 8.5M | USDC: $10.5M
[2025-11-29T10:15:28.456Z] Price: $1.567890 | XNT: 7.2M | USDC: $11.3M
```

Every 5 seconds, the bot checks the price and intervenes if needed.

**Leave this running** ✅

---

### 3️⃣ Generate Market Activity (Terminal 3) [Optional]

```bash
cd /Users/yakovlevin/dev/lottery_amm

# Run the test simulator to generate random trades
ANCHOR_PROVIDER_URL=http://localhost:8899 \
ANCHOR_WALLET=~/.config/solana/id.json \
npx ts-node bots/test-corridor-bot.ts
```

This creates 50 random buy/sell orders to test the bot's response.

**Watch Terminal 2** to see the bot intervening! 👀

---

## 🎯 What the Bot Does

```
Price goes above $1.90 → Bot injects XNT → Price goes down ✅
Price goes above $2.00 → Bot aggressively injects XNT → Price drops to $1.50 ✅

Price stays $1.10-$1.90 → Bot does nothing → Just monitors ⏱️

Price goes below $1.10 → Bot withdraws XNT → Price goes up ✅
Price goes below $1.00 → Bot aggressively withdraws XNT → Price rises to $1.50 ✅
```

---

## 🛑 Stopping the Bot

In Terminal 2, press **Ctrl+C**

The bot will show final statistics:
```
╔════════════════════════════════════════════════════════════╗
║                    BOT STATISTICS                         ║
╚════════════════════════════════════════════════════════════╝
  💉 XNT Injected:       5,750,000 XNT
  💊 XNT Withdrawn:      2,100,000 XNT
  📊 Net XNT Position:   3,650,000 XNT
  🔧 Interventions:      12
```

---

## 🧪 First Time? Run the Demo Test

Before running the bot manually, see it in action with the automated test:

```bash
# Terminal 1: Start validator
./run-tests.sh

# Terminal 2: Run demo
ANCHOR_PROVIDER_URL=http://localhost:8899 \
ANCHOR_WALLET=~/.config/solana/id.json \
npx ts-mocha -p ./tsconfig.json -t 1000000 tests/price-corridor-demo.ts
```

This runs a complete demonstration in ~10 seconds showing:
- ✅ Bot injecting XNT when price too high
- ✅ Bot withdrawing XNT when price too low
- ✅ Final statistics

---

## 📚 Need More Details?

- **Comprehensive Guide:** [CORRIDOR_BOT_GUIDE.md](./CORRIDOR_BOT_GUIDE.md)
- **Bot Documentation:** [bots/README.md](./bots/README.md)
- **Code:** [bots/price-corridor-bot.ts](./bots/price-corridor-bot.ts)

---

## ⚙️ Common Options

```bash
# Custom poll interval (check every 3 seconds instead of 5)
./scripts/run-corridor-bot.sh --pool <POOL_PDA> --interval 3000

# Use devnet
./scripts/run-corridor-bot.sh \
  --pool <POOL_PDA> \
  --rpc https://api.devnet.solana.com \
  --wallet ~/.config/solana/devnet.json

# Show help
./scripts/run-corridor-bot.sh --help
```

---

**That's it! The bot will run 24/7 defending your price corridor.** 🛡️
