# XNT Price Corridor Defense Bot

Automated bot that maintains XNT token price within a **$1.00 - $2.00 corridor** by dynamically injecting or withdrawing XNT from the bonding curve pool.

## 📋 Overview

The bot continuously monitors the pool price and intervenes when:
- **Price too high (≥$1.90):** Injects XNT → Lowers price toward $1.50
- **Price too low (≤$1.10):** Withdraws XNT → Raises price toward $1.50
- **Hard boundaries:** Aggressive intervention at $2.00 ceiling and $1.00 floor

## 🎯 Features

- ✅ Real-time price monitoring (5-second intervals)
- ✅ Two-tier intervention strategy (gentle/aggressive)
- ✅ Automatic XNT injection when price too high
- ✅ Automatic XNT withdrawal when price too low
- ✅ Configurable thresholds and parameters
- ✅ Comprehensive logging and statistics
- ✅ Graceful shutdown (Ctrl+C)

## 🚀 Quick Start

### 1. Run the Bot

```bash
npx ts-node bots/price-corridor-bot.ts --pool-address <POOL_PDA>
```

**Arguments:**
- `--pool-address <address>` - **Required:** Pool PDA address to monitor
- `--interval <ms>` - Optional: Poll interval in milliseconds (default: 5000)

**Example:**
```bash
npx ts-node bots/price-corridor-bot.ts \
  --pool-address 6FNG6RSnewmUzFsQ8Uj7aunEQFm9BYpqhq8NYREwQLFp \
  --interval 3000
```

### 2. Test with Market Simulation

In a **second terminal**, run the test simulator to generate random market activity:

```bash
npx ts-node bots/test-corridor-bot.ts
```

This will:
1. Create a new pool with 5M XNT at $1.00
2. Wait 10 seconds for you to start the bot
3. Execute 50 random buy/sell trades
4. Show how the bot defends the corridor

## ⚙️ Configuration

Edit `CONFIG` in `price-corridor-bot.ts`:

```typescript
const CONFIG = {
  // Price boundaries
  PRICE_FLOOR: 1.0,           // $1.00 minimum
  PRICE_CEILING: 2.0,          // $2.00 maximum
  PRICE_TARGET: 1.5,           // Target price for interventions
  SOFT_LOW: 1.1,               // Gentle intervention threshold
  SOFT_HIGH: 1.9,              // Gentle intervention threshold

  // Intervention strategy
  AGGRESSIVE_PERCENT: 1.0,     // 100% move on ceiling/floor breach
  GENTLE_PERCENT: 0.5,         // 50% move on soft boundary breach

  // Monitoring
  POLL_INTERVAL_MS: 5000,      // Check every 5 seconds
};
```

## 📊 Intervention Logic

### Price Too High (Inject XNT)

| Condition | Action | Effect |
|-----------|--------|--------|
| Price ≥ $2.00 (ceiling) | Inject XNT (100% to target) | Price → $1.50 |
| Price ≥ $1.90 (soft high) | Inject XNT (50% to target) | Price → ~$1.70 |

### Price Too Low (Withdraw XNT)

| Condition | Action | Effect |
|-----------|--------|--------|
| Price ≤ $1.00 (floor) | Withdraw XNT (100% to target) | Price → $1.50 |
| Price ≤ $1.10 (soft low) | Withdraw XNT (50% to target) | Price → ~$1.30 |

## 📈 Example Output

```
╔════════════════════════════════════════════════════════════╗
║              PRICE CORRIDOR CONFIGURATION                 ║
╚════════════════════════════════════════════════════════════╝
  💵 Price Floor:       $1.00
  📊 Soft Low:          $1.10
  🎯 Target Price:      $1.50
  📊 Soft High:         $1.90
  💵 Price Ceiling:     $2.00
  ⏱️  Poll Interval:     5000ms

🚀 Starting price corridor monitoring...

[2025-11-30T10:15:23.456Z] Price: $1.234567 | XNT: 4.5M | USDC: $5.5M

============================================================
⚠️  SOFT HIGH BREACH ($1.95 >= $1.90)
   Current Price: $1.950000
   Target Price:  $1.500000
   Full Delta:    1,833,333 XNT
   Move:          50%
   Action Delta:  916,666 XNT

💉 INJECTING XNT: ⚠️  SOFT HIGH BREACH ($1.95 >= $1.90)
   Amount: 916,666 XNT
   ✅ Injection successful
   New Price:     $1.724138
   Price Change:  -11.58%
============================================================

╔════════════════════════════════════════════════════════════╗
║                    BOT STATISTICS                         ║
╚════════════════════════════════════════════════════════════╝
  💉 XNT Injected:       2,500,000 XNT
  💊 XNT Withdrawn:      1,200,000 XNT
  📊 Net XNT Position:   1,300,000 XNT
  🔧 Interventions:      7
```

## 🧪 Testing

### Option 1: Manual Testing
1. Start the bot: `npx ts-node bots/price-corridor-bot.ts --pool-address <POOL>`
2. Manually execute buy/sell trades using the UI or CLI
3. Watch the bot intervene when price goes outside corridor

### Option 2: Automated Testing
1. Start the bot in terminal 1
2. Run `npx ts-node bots/test-corridor-bot.ts` in terminal 2
3. Watch 50 random trades execute while bot defends corridor

## 🛡️ Safety Features

- ✅ **Authority verification:** Only pool authority can inject/withdraw
- ✅ **Balance checks:** Prevents withdrawing more XNT than available
- ✅ **Error handling:** Continues monitoring if intervention fails
- ✅ **Graceful shutdown:** Clean exit with Ctrl+C
- ✅ **Transaction logging:** All interventions logged with timestamps

## 📝 Requirements

- Node.js 16+
- Anchor CLI
- Solana CLI
- Wallet with authority over the pool
- XNT tokens for injections (bot reserve)

## 🔐 Security Considerations

1. **Private Key:** Bot uses your Solana wallet - keep it secure
2. **Bot Reserves:** Ensure bot has sufficient XNT for injections
3. **Monitoring:** Bot only monitors one pool at a time
4. **Network:** Test on devnet/testnet before mainnet

## 🐛 Troubleshooting

**Bot won't start:**
- Check pool address is correct
- Verify wallet has authority over pool
- Ensure RPC connection is working

**Interventions failing:**
- Check bot has sufficient XNT balance
- Verify authority permissions
- Check transaction logs for errors

**Price still outside corridor:**
- Bot may need more XNT reserves
- Adjust intervention percentages
- Check poll interval (may be too slow)

## 📚 Files

- `price-corridor-bot.ts` - Main bot implementation
- `test-corridor-bot.ts` - Test simulator with random trades
- `README.md` - This file

## 🤝 Contributing

Improvements welcome! Key areas:
- More sophisticated intervention strategies
- Multi-pool monitoring
- Web dashboard for monitoring
- Alert notifications (Discord, Telegram, etc.)

## 📄 License

Same as parent project
