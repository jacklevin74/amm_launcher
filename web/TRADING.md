# XNT Trading Terminal

## Overview

This directory contains two trading interfaces for the XNT bonding curve:

1. **Interactive CLI Trader** (`scripts/interactive-trader.ts`) - Terminal-based trading interface
2. **Web Interface** (`web/trading.html`) - Browser-based trading interface (basic, shows quotes only)

## Quick Start - Interactive CLI Trader (Recommended)

The interactive CLI trader is the easiest way to trade XNT. It provides a full-featured terminal interface with:
- Live price updates
- Real-time balance tracking
- Quote preview before trading
- Wallet management
- USDC airdrop functionality

### Usage

```bash
# Start the interactive trader
export ANCHOR_PROVIDER_URL=http://localhost:8899
export ANCHOR_WALLET=~/.config/solana/id.json
npx ts-node scripts/interactive-trader.ts --pool=41BtpyzrYMGoM3ivFkw5ZiaEurSc4HBW1fdBKzQYuJ63
```

### Features

**Commands:**
- `[b]` - Buy XNT with USDC
- `[s]` - Sell XNT for USDC
- `[a]` - Airdrop USDC to your wallet
- `[r]` - Refresh balances and price
- `[q]` - Quit

**What you'll see:**
```
╔════════════════════════════════════════════════════════════╗
║              XNT INTERACTIVE TRADING TERMINAL              ║
╚════════════════════════════════════════════════════════════╝

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
💹 MARKET DATA
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Current XNT Price:  $1.016471
  Pool XNT Reserve:   5,984,000 XNT
  Pool USDC Reserve:  $6,083

💼 YOUR BALANCES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
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

### Example Trading Session

1. **Airdrop USDC** (first time only):
   ```
   Enter command: a
   Enter USDC amount to airdrop: 100000
   💰 Airdropping 100K USDC...
   ✅ Airdrop successful!
   ```

2. **Buy XNT**:
   ```
   Enter command: b
   Enter USDC amount to spend: 10000

   📊 QUOTE:
     You Pay:        $10.0K USDC
     You Receive:    5234.12 XNT
     Effective Price: $1.911234
     Price Impact:   +0.85%
     New Pool Price: $1.025123

   Execute trade? (y/n): y
   🔄 Executing BUY...
   ✅ BUY successful!
   📝 Transaction: 3k7HZ...
   ```

3. **Sell XNT**:
   ```
   Enter command: s
   Enter XNT amount to sell: 1000

   📊 QUOTE:
     You Pay:        1.0K XNT
     You Receive:    $1015.23
     Effective Price: $1.015234
     Price Impact:   -0.12%
     New Pool Price: $1.014891

   Execute trade? (y/n): y
   🔄 Executing SELL...
   ✅ SELL successful!
   📝 Transaction: 5mN9P...
   ```

## Web Interface (Basic)

The web interface provides a visual trading dashboard but currently only shows quotes. Actual trading is handled via the CLI trader.

### Start Web Server

```bash
cd web
node server.js
```

Then open http://localhost:3030/trading in your browser.

### Features

- Create browser-based wallet (stored in localStorage)
- View live XNT price
- See your USDC and XNT balances
- Get trade quotes with price impact
- Position summary with P&L tracking
- Trade history

**Note:** The web interface currently shows quotes only. Use the interactive CLI trader for actual trades.

## Wallet Management

### Interactive CLI Trader

The CLI trader automatically creates and manages a wallet at `/tmp/trader-wallet.json`. This wallet:
- Is created on first run
- Persists between sessions
- Receives SOL airdrops automatically for gas fees
- Is separate from your main Anchor wallet

### Web Interface

The web interface creates a wallet in your browser's localStorage. This wallet:
- Is created when you click "Create New Wallet"
- Persists in your browser
- Is separate from other wallets

## Pool Address

Update the pool address in:
- `scripts/interactive-trader.ts` - Pass via `--pool=<ADDRESS>` flag
- `web/trading-app.js` - Update `CONFIG.POOL_ADDRESS`

Current pool: `41BtpyzrYMGoM3ivFkw5ZiaEurSc4HBW1fdBKzQYuJ63`

## Tips

1. **Start with the CLI trader** - It's fully functional and easy to use
2. **Airdrop USDC first** - Use the `[a]` command to fund your wallet
3. **Check quotes** - Review the quote before confirming each trade
4. **Watch the bot** - Run the price corridor bot in another terminal to see it defend the $1-$2 corridor
5. **Monitor your P&L** - The interface tracks your average entry price and profit/loss

## Trading with the Bot Running

For the best experience, run the trading interface alongside the price corridor bot:

**Terminal 1 - Price Corridor Bot:**
```bash
npx ts-node bots/price-corridor-bot.ts --pool-address 41BtpyzrYMGoM3ivFkw5ZiaEurSc4HBW1fdBKzQYuJ63
```

**Terminal 2 - Interactive Trader:**
```bash
npx ts-node scripts/interactive-trader.ts --pool=41BtpyzrYMGoM3ivFkw5ZiaEurSc4HBW1fdBKzQYuJ63
```

This way you can see:
- Your trades in the interactive trader
- The bot's DEPOSIT/REMOVE actions in the bot terminal
- How the bot maintains the $1-$2 price corridor as you trade

## Troubleshooting

**Error: "Pool not found"**
- Make sure your local validator is running
- Ensure a pool is initialized (run test scripts)

**Error: "Insufficient funds"**
- Use the `[a]` command to airdrop USDC
- Check your balances with `[r]`

**Error: "Transaction failed"**
- Check that the pool address is correct
- Ensure your wallet has SOL for gas fees (auto-airdropped on first run)

**Wallet not persisting**
- CLI: Check that `/tmp/trader-wallet.json` exists
- Web: Clear browser localStorage to reset

## Architecture

```
┌─────────────────────────────────────────────┐
│  Interactive CLI Trader                     │
│  (scripts/interactive-trader.ts)            │
│  - Full trading functionality               │
│  - Wallet management                        │
│  - Quote calculations                       │
│  - Transaction execution                    │
└─────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────┐
│  Anchor Program                             │
│  (BondingCurve)                             │
│  - buy() instruction                        │
│  - sell() instruction                       │
│  - Constant product AMM logic               │
└─────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────┐
│  Pool Account                               │
│  - XNT Reserve                              │
│  - USDC Reserve                             │
│  - Price = USDC / XNT                       │
└─────────────────────────────────────────────┘
```

## Next Steps

To enhance the web interface with full trading functionality:
1. Add Anchor program IDL to web interface
2. Implement buy/sell transaction construction in browser
3. Add transaction signing with browser wallet
4. Integrate with Phantom/Solflare wallet adapters

For now, use the interactive CLI trader for the best trading experience!
