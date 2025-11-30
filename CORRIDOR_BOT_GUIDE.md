# Price Corridor Bot - Continuous Monitoring Guide

## 🤖 Overview

The Price Corridor Bot is a **continuously running** daemon that monitors an XNT/USDC bonding curve pool and automatically intervenes to maintain price within a **$1.00 - $2.00 corridor**.

### How It Works

```
┌─────────────────────────────────────────────────────────────┐
│                    CONTINUOUS MONITORING                    │
│                                                             │
│  1. Every 5 seconds (configurable):                        │
│     ├─ Fetch pool state                                    │
│     ├─ Calculate current price                             │
│     └─ Check if intervention needed                        │
│                                                             │
│  2. If price outside corridor:                             │
│     ├─ Calculate XNT delta to reach target ($1.50)         │
│     ├─ Apply intervention percentage (50% or 100%)         │
│     └─ Execute deposit_xnt or withdraw_xnt                 │
│                                                             │
│  3. Log intervention:                                      │
│     ├─ Update statistics                                   │
│     ├─ Display before/after prices                         │
│     └─ Continue monitoring...                              │
│                                                             │
│  4. Runs indefinitely until Ctrl+C                         │
└─────────────────────────────────────────────────────────────┘
```

## 🎯 Price Corridor Strategy

### Price Boundaries

```
$2.00 ━━━━━━━━━━━━━━━━━━━━━━━━━━ CEILING (Hard boundary)
                                   ↑ Aggressive intervention: 100% to $1.50
$1.90 ━━━━━━━━━━━━━━━━━━━━━━━━━━ SOFT HIGH
                                   ↑ Gentle intervention: 50% to $1.50

$1.50 ━━━━━━━━━━━━━━━━━━━━━━━━━━ TARGET PRICE

$1.10 ━━━━━━━━━━━━━━━━━━━━━━━━━━ SOFT LOW
                                   ↓ Gentle intervention: 50% to $1.50
$1.00 ━━━━━━━━━━━━━━━━━━━━━━━━━━ FLOOR (Hard boundary)
                                   ↓ Aggressive intervention: 100% to $1.50
```

### Intervention Rules

| Condition | Action | Strategy | Effect |
|-----------|--------|----------|--------|
| Price ≥ $2.00 | Inject XNT | Aggressive (100%) | Price → $1.50 |
| Price ≥ $1.90 | Inject XNT | Gentle (50%) | Price → ~$1.70 |
| $1.10 < Price < $1.90 | Do nothing | Monitor only | Maintain |
| Price ≤ $1.10 | Withdraw XNT | Gentle (50%) | Price → ~$1.30 |
| Price ≤ $1.00 | Withdraw XNT | Aggressive (100%) | Price → $1.50 |

### Mathematical Formula

The bot calculates the XNT delta needed to reach target price:

```
Current:  price = usdc_reserve / xnt_reserve
Target:   target_price = usdc_reserve / new_xnt_reserve

Solve for new_xnt_reserve:
  new_xnt_reserve = usdc_reserve / target_price

Calculate delta:
  delta = new_xnt_reserve - xnt_reserve

Apply intervention percentage:
  adjusted_delta = delta × percentage

If delta > 0: Inject XNT (price too high)
If delta < 0: Withdraw XNT (price too low)
```

## 🚀 Running the Bot

### Quick Start (3 Terminals)

**Terminal 1: Start Local Test Validator**
```bash
cd /Users/yakovlevin/dev/lottery_amm
./run-tests.sh
```
Keep this running in the background.

---

**Terminal 2: Start the Corridor Bot**

Using the launcher script:
```bash
./scripts/run-corridor-bot.sh --pool <POOL_PDA>
```

Or run directly:
```bash
ANCHOR_PROVIDER_URL=http://localhost:8899 \
ANCHOR_WALLET=~/.config/solana/id.json \
npx ts-node bots/price-corridor-bot.ts --pool-address <POOL_PDA>
```

The bot will now run continuously, checking the price every 5 seconds.

---

**Terminal 3: Generate Market Activity (Optional)**

To test the bot, generate random trades:
```bash
ANCHOR_PROVIDER_URL=http://localhost:8899 \
ANCHOR_WALLET=~/.config/solana/id.json \
npx ts-node bots/test-corridor-bot.ts
```

This simulates 50 random buy/sell orders, pushing the price around to trigger bot interventions.

---

### Example Bot Output

```
╔════════════════════════════════════════════════════════════╗
║          XNT PRICE CORRIDOR DEFENSE BOT v1.0             ║
╚════════════════════════════════════════════════════════════╝

🤖 Initializing Price Corridor Bot...

📍 Pool Address: 9ZtH6nKCcb2kK6dkWrqXEjmdTR3G4L9CZG84tZ9m7nxb
👤 Authority: H8W3ctz92svYg6mkn1UtGfu2aQr2fnUFHM48CxqQQaXp
🌐 RPC: http://localhost:8899

✅ Bot initialized successfully!

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

[2025-11-29T10:15:23.456Z] Price: $1.234567 | XNT: 8.5M | USDC: $10.5M
[2025-11-29T10:15:28.456Z] Price: $1.567890 | XNT: 7.2M | USDC: $11.3M
[2025-11-29T10:15:33.456Z] Price: $1.876543 | XNT: 6.8M | USDC: $12.8M

============================================================
⚠️  SOFT HIGH BREACH ($1.92 >= $1.90)
   Current Price: $1.920000
   Target Price:  $1.500000
   Full Delta:    2,500,000 XNT
   Move:          50%
   Action Delta:  1,250,000 XNT

💉 INJECTING XNT: ⚠️  SOFT HIGH BREACH ($1.92 >= $1.90)
   Amount: 1,250,000 XNT
   ✅ Injection successful
   New Price:     $1.696552
   Price Change:  -11.64%
============================================================

[2025-11-29T10:15:38.456Z] Price: $1.696552 | XNT: 8.95M | USDC: $15.2M
[2025-11-29T10:15:43.456Z] Price: $1.543210 | XNT: 9.2M | USDC: $14.2M

... continues monitoring indefinitely ...
```

### Stopping the Bot

Press **Ctrl+C** to stop gracefully. The bot will display final statistics:

```
🛑 Stopping bot...

╔════════════════════════════════════════════════════════════╗
║                    BOT STATISTICS                         ║
╚════════════════════════════════════════════════════════════╝
  💉 XNT Injected:       5,750,000 XNT
  💊 XNT Withdrawn:      2,100,000 XNT
  📊 Net XNT Position:   3,650,000 XNT
  🔧 Interventions:      12
  ⏰ Last Intervention:  11/29/2025, 10:16:45 AM
```

## ⚙️ Configuration

Edit `bots/price-corridor-bot.ts` to customize:

```typescript
const CONFIG = {
  // Price corridor boundaries
  PRICE_FLOOR: 1.0,           // Minimum price (hard floor)
  PRICE_CEILING: 2.0,          // Maximum price (hard ceiling)
  PRICE_TARGET: 1.5,           // Target price for interventions
  SOFT_LOW: 1.1,               // Soft lower boundary
  SOFT_HIGH: 1.9,              // Soft upper boundary

  // Intervention settings
  AGGRESSIVE_PERCENT: 1.0,     // Move 100% to target on ceiling/floor
  GENTLE_PERCENT: 0.5,         // Move 50% to target on soft boundary

  // Monitoring
  POLL_INTERVAL_MS: 5000,      // Check price every 5 seconds

  // RPC
  RPC_URL: process.env.ANCHOR_PROVIDER_URL || "http://localhost:8899",
  WALLET_PATH: process.env.ANCHOR_WALLET || `${process.env.HOME}/.config/solana/id.json`,
};
```

### Tuning Parameters

**Poll Interval:**
- Faster (1000-3000ms): More responsive but higher RPC usage
- Slower (10000-30000ms): Lower RPC usage but slower response

**Intervention Percentages:**
- Higher (0.8-1.0): More aggressive corrections, faster convergence
- Lower (0.3-0.5): Gentler corrections, smoother price action

**Soft Boundaries:**
- Wider gap ($1.05/$1.95): Fewer interventions, more price volatility
- Narrower gap ($1.15/$1.85): More interventions, tighter price control

## 🔒 Security & Requirements

### Prerequisites

1. **Wallet Authority:** Bot must use the pool authority wallet
2. **XNT Reserves:** Bot needs XNT tokens for injections (e.g., 20M XNT)
3. **SOL Balance:** Sufficient SOL for transaction fees
4. **RPC Access:** Reliable RPC endpoint (local validator or public RPC)

### Security Checklist

- ✅ Bot only runs with pool authority's private key
- ✅ All transactions require authority signature
- ✅ Cannot withdraw more XNT than pool has
- ✅ No external API calls (only Solana RPC)
- ✅ Graceful error handling (continues monitoring if intervention fails)
- ✅ Transaction logging for audit trail

### Production Deployment

**For Mainnet:**

1. Use a dedicated wallet with bot reserves
2. Set up monitoring/alerting (log files, Discord webhooks, etc.)
3. Use a reliable RPC provider (not public endpoints)
4. Consider running bot on a VPS with high uptime
5. Implement additional logging to persistent storage
6. Set up automated restarts (systemd, pm2, etc.)

**Example systemd service:**

```ini
[Unit]
Description=XNT Price Corridor Defense Bot
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/lottery_amm
Environment="ANCHOR_PROVIDER_URL=https://api.mainnet-beta.solana.com"
Environment="ANCHOR_WALLET=/home/ubuntu/.config/solana/mainnet-wallet.json"
ExecStart=/usr/bin/npx ts-node bots/price-corridor-bot.ts --pool-address <POOL_PDA>
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

## 📊 Monitoring & Observability

### Real-Time Monitoring

The bot logs every price check:
```
[2025-11-29T10:15:23.456Z] Price: $1.234567 | XNT: 8.5M | USDC: $10.5M
```

### Intervention Alerts

When intervening, detailed logs show:
- Current price vs threshold
- Calculated delta
- Intervention percentage
- New price after intervention
- Price change percentage

### Statistics Tracking

The bot tracks:
- Total XNT injected
- Total XNT withdrawn
- Net XNT position
- Number of interventions
- Last intervention timestamp

### External Monitoring (Optional Enhancements)

You could add:
- Discord/Telegram notifications on interventions
- Prometheus metrics export
- Grafana dashboards
- Alert emails on critical events
- Database logging for historical analysis

## 🧪 Testing Strategy

### 1. Automated Test (Recommended First Step)

Run the full demonstration test:
```bash
ANCHOR_PROVIDER_URL=http://localhost:8899 \
ANCHOR_WALLET=~/.config/solana/id.json \
npx ts-mocha -p ./tsconfig.json -t 1000000 tests/price-corridor-demo.ts
```

This validates all intervention scenarios in ~10 seconds.

### 2. Live Bot + Market Simulator

**Terminal 1:** Start bot
```bash
./scripts/run-corridor-bot.sh --pool <POOL_PDA>
```

**Terminal 2:** Generate trades
```bash
npx ts-node bots/test-corridor-bot.ts
```

Watch the bot intervene in real-time as the simulator creates market pressure.

### 3. Manual Testing

Start the bot and manually execute buy/sell orders via CLI or UI to trigger interventions.

## 🎓 Architecture

### Class Structure

```typescript
class PriceCorridorBot {
  private program: Program<BondingCurve>;
  private provider: AnchorProvider;
  private authority: Keypair;
  private poolAddress: PublicKey;
  private state: BotState;

  async initialize(): Promise<void>
  async getPoolState(): Promise<PoolState>
  calculateXntDelta(state, targetPrice): number
  async injectXnt(amount, reason): Promise<void>
  async withdrawXnt(amount, reason): Promise<void>
  async checkAndIntervene(): Promise<void>
  async start(): Promise<void>
  stop(): void
}
```

### State Management

```typescript
interface BotState {
  xntInjected: number;
  xntWithdrawn: number;
  interventionCount: number;
  lastIntervention: Date | null;
  usdcCollected: number;
}

interface PoolState {
  xntReserve: number;
  usdcReserve: number;
  price: number;
  realXnt: number;
  realUsdc: number;
}
```

### Main Loop

```typescript
async start(): Promise<void> {
  this.isRunning = true;

  while (this.isRunning) {
    try {
      await this.checkAndIntervene();
    } catch (error) {
      console.error("Error in monitoring loop:", error);
      // Continue monitoring despite errors
    }

    await new Promise(resolve =>
      setTimeout(resolve, CONFIG.POLL_INTERVAL_MS)
    );
  }
}
```

## 📝 Troubleshooting

### Bot won't start

**Error:** "Pool not found"
- **Fix:** Verify pool address is correct
- **Check:** `solana account <POOL_PDA>`

**Error:** "Unauthorized"
- **Fix:** Ensure wallet is the pool authority
- **Check:** Pool state and compare authority pubkey

**Error:** "Insufficient funds"
- **Fix:** Bot needs XNT tokens for injections
- **Check:** Bot wallet XNT balance

### Interventions failing

**Error:** "Insufficient liquidity"
- **Fix:** Trying to withdraw more XNT than pool has
- **Solution:** Reduce intervention percentages or add more XNT

**Error:** Transaction timeout
- **Fix:** RPC may be slow or congested
- **Solution:** Use faster RPC or increase timeout

### Price still drifting

**Issue:** Price consistently outside corridor
- **Cause:** Bot may not have enough XNT reserves
- **Solution:** Add more XNT to bot wallet
- **Alternative:** Adjust intervention percentages to be more aggressive

## 📚 Files Reference

| File | Purpose |
|------|---------|
| `bots/price-corridor-bot.ts` | Main bot implementation (continuous monitoring) |
| `bots/test-corridor-bot.ts` | Market simulator (generates random trades) |
| `bots/README.md` | Quick reference documentation |
| `tests/price-corridor-demo.ts` | Automated test demonstration |
| `scripts/run-corridor-bot.sh` | Easy launcher script |
| `CORRIDOR_BOT_GUIDE.md` | This comprehensive guide |

## 🚀 Next Steps

1. **Test locally:** Run the automated demo test
2. **Understand behavior:** Run bot + simulator side-by-side
3. **Deploy to devnet:** Test with real network conditions
4. **Monitor performance:** Track intervention frequency and effectiveness
5. **Deploy to mainnet:** Run in production with proper monitoring

---

**Happy Bot Running! 🤖**

The bot will continuously defend your price corridor 24/7, keeping XNT price stable between $1.00 and $2.00.
