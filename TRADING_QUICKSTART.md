# 🎮 XNT Trading Terminal - Quick Start

## ✅ Setup Complete!

Your trading wallet has been created and funded with **$100,000 USDC**!

**Trader Wallet:** `6fsofBh5tsKb66MTcgeQPAbi32zWTvm6pQ2ENDuVxUBM`
**Pool Address:** `41BtpyzrYMGoM3ivFkw5ZiaEurSc4HBW1fdBKzQYuJ63`
**Current Price:** `$1.003834`

---

## 🚀 Start Trading NOW

Run this command in your terminal:

```bash
npx ts-node scripts/interactive-trader.ts --pool=41BtpyzrYMGoM3ivFkw5ZiaEurSc4HBW1fdBKzQYuJ63
```

---

## 📋 Trading Commands

Once the interactive trader loads, you'll see:

```
╔════════════════════════════════════════════════════════════╗
║              XNT INTERACTIVE TRADING TERMINAL              ║
╚════════════════════════════════════════════════════════════╝

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
💹 MARKET DATA
  Current XNT Price:  $1.003834
  Pool XNT Reserve:   6,984,000 XNT
  Pool USDC Reserve:  $7,010

💼 YOUR BALANCES
  USDC Balance:       $100,000
  XNT Balance:        0 XNT
  XNT Value:          $0
  Total Portfolio:    $100,000
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

COMMANDS:
  [b] Buy XNT       [s] Sell XNT      [a] Airdrop USDC
  [r] Refresh       [q] Quit

Enter command: _
```

### Available Commands:

- **`b`** - Buy XNT with USDC
- **`s`** - Sell XNT for USDC
- **`a`** - Airdrop more USDC (you already have $100K)
- **`r`** - Refresh balances and price
- **`q`** - Quit

---

## 💡 Example Trading Session

### 1. Buy XNT

```
Enter command: b
Enter USDC amount to spend: 10000

📊 QUOTE:
  You Pay:        $10.0K USDC
  You Receive:    9962.12 XNT
  Effective Price: $1.003800
  Price Impact:   +0.14%
  New Pool Price: $1.005234

Execute trade? (y/n): y
🔄 Executing BUY...
✅ BUY successful!
📝 Transaction: 3k7HZ...
```

### 2. Sell XNT

```
Enter command: s
Enter XNT amount to sell: 5000

📊 QUOTE:
  You Pay:        5.0K XNT
  You Receive:    $5015.23
  Effective Price: $1.003046
  Price Impact:   -0.08%
  New Pool Price: $1.002951

Execute trade? (y/n): y
🔄 Executing SELL...
✅ SELL successful!
📝 Transaction: 5mN9P...
```

### 3. Refresh to See Updated Balances

```
Enter command: r

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
💹 Current Price: $1.002951
💼 USDC Balance:  $95,015.23
💼 XNT Balance:   4,962.12 XNT
💼 XNT Value:     $4,976.78
💼 Total Portfolio: $99,992.01
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## 🤖 Trading with the Bot Running

For the ultimate experience, run the bot in another terminal window:

### Terminal 1: Price Corridor Bot
```bash
npx ts-node bots/price-corridor-bot.ts --pool-address 41BtpyzrYMGoM3ivFkw5ZiaEurSc4HBW1fdBKzQYuJ63
```

### Terminal 2: Interactive Trader
```bash
npx ts-node scripts/interactive-trader.ts --pool=41BtpyzrYMGoM3ivFkw5ZiaEurSc4HBW1fdBKzQYuJ63
```

Now you can:
1. Buy lots of XNT to push the price toward $2.00
2. Watch the bot **DEPOSIT** XNT to defend the ceiling
3. Sell XNT to push the price toward $1.00
4. Watch the bot **REMOVE** XNT to defend the floor

---

## 🎯 Try These Trades

**Test Ceiling Defense:**
```
Enter command: b
Enter USDC amount to spend: 50000
```
Watch the bot add XNT to prevent price from exceeding $2.00!

**Test Floor Defense:**
```
Enter command: s
Enter XNT amount to sell: 50000
```
Watch the bot remove XNT to prevent price from dropping below $1.00!

---

## 📊 Features

✅ **Live Price Updates** - See current market price and reserves
✅ **Balance Tracking** - Monitor your USDC and XNT balances
✅ **Quote Preview** - See exactly what you'll get before trading
✅ **Price Impact** - Know how your trade affects the pool
✅ **P&L Tracking** - See your profit/loss in real-time
✅ **Simple Commands** - One-letter commands for fast trading
✅ **Persistent Wallet** - Your wallet is saved at `/tmp/trader-wallet.json`

---

## 📖 Full Documentation

See `web/TRADING.md` for complete documentation including:
- Web interface setup
- Advanced features
- Troubleshooting
- Architecture details

---

## 🎮 Ready to Trade?

Copy and paste this command to start:

```bash
npx ts-node scripts/interactive-trader.ts --pool=41BtpyzrYMGoM3ivFkw5ZiaEurSc4HBW1fdBKzQYuJ63
```

**Happy Trading! 🚀**
