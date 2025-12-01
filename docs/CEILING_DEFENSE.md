# Automatic Price Stabilization Reserve

## Overview

The Automatic Price Stabilization Reserve is a protocol-level feature that stabilizes the XNT price by automatically injecting XNT tokens from a dedicated PDA-controlled reserve when the price approaches the configured ceiling (default: $2.00) during buy transactions. The reserve PDA balance is used to stabilize the price and prevent excessive volatility.

## Design Goals

1. **Price Stabilization**: The reserve PDA balance is used to stabilize the price and prevent excessive upward volatility
2. **Protocol-Level Enforcement**: Price stabilization happens automatically within the smart contract, not via external bots
3. **Transparent**: All stabilization actions are logged on-chain
4. **Capital Efficient**: Uses a dedicated PDA-owned reserve that can be topped up by the authority
5. **No External Dependencies**: Works autonomously without requiring off-chain services

## Architecture

### Components

#### 1. Pool State Extensions
```rust
pub struct Pool {
    // ... existing fields
    pub ceiling_reserve_xnt: Pubkey,      // PDA-owned XNT reserve account
    pub price_ceiling: u64,                // Price threshold (e.g., 2_000_000 for $2.00)
    pub ceiling_reserve_bump: u8,          // Bump seed for ceiling reserve PDA
}
```

#### 2. Ceiling Reserve PDA
- **Seeds**: `["ceiling_reserve", pool_address]`
- **Purpose**: Authority for the ceiling reserve XNT token account
- **Controlled by**: Pool program via PDA signing

#### 3. Ceiling Reserve XNT Account
- **Type**: SPL Token Account
- **Mint**: XNT token mint
- **Authority**: Ceiling Reserve PDA
- **Initial Funding**: 10M XNT (configurable)

### Price Ceiling Logic

The ceiling defense mechanism is implemented in the `buy()` instruction:

```rust
// 1. Calculate price after buy (before injection)
let price_after = new_usdc_reserve / new_xnt_reserve;

// 2. Check if ceiling is breached
if price_after > pool.price_ceiling {
    // 3. Calculate required XNT injection
    let target_xnt_reserve = (new_usdc_reserve * 1_000_000) / pool.price_ceiling;
    let xnt_to_inject = target_xnt_reserve - new_xnt_reserve + buffer;

    // 4. Transfer XNT from ceiling reserve to pool using PDA authority
    // CPI to SPL Token program

    // 5. Update pool state with injected XNT
    pool.xnt_reserve = new_xnt_reserve + xnt_to_inject;
    pool.k = pool.xnt_reserve * new_usdc_reserve;
}
```

### Calculation Details

**Price Calculation:**
- Price = USDC Reserve / XNT Reserve
- All values use 6 decimals
- Price ceiling: 2_000_000 (represents $2.00)

**Injection Amount:**
```
target_xnt = (usdc_reserve * 1_000_000) / price_ceiling
injection = target_xnt - current_xnt + buffer
```

The buffer (1 XNT) ensures the price stays slightly below the ceiling after injection.

## Instructions

### 1. `initialize_pool`
**Added Parameters:**
- `price_ceiling: u64` - Maximum allowed price (6 decimals)

**Added Accounts:**
- `ceiling_reserve_pda` - PDA derived from `["ceiling_reserve", pool]`
- `ceiling_reserve_xnt` - Token account for ceiling reserve (initialized)

**Initialization:**
```rust
pool.ceiling_reserve_xnt = ceiling_reserve_xnt.key();
pool.price_ceiling = price_ceiling;
pool.ceiling_reserve_bump = ctx.bumps.ceiling_reserve_pda;
```

### 2. `fund_ceiling_reserve`
**Purpose:** Allow authority to add XNT to the ceiling reserve

**Parameters:**
- `xnt_amount: u64` - Amount of XNT to add to reserve

**Accounts:**
- `authority` - Pool authority (signer)
- `pool` - Pool account
- `authority_xnt` - Authority's XNT token account
- `ceiling_reserve_xnt` - Ceiling reserve XNT account
- `token_program` - SPL Token program

**Access Control:**
- Only pool authority can fund the reserve

### 3. `buy` (Modified)
**Added Accounts:**
- `ceiling_reserve_pda` - PDA for ceiling reserve authority
- `ceiling_reserve_xnt` - Ceiling reserve XNT account

**New Behavior:**
- Checks price after buy calculation
- If price > ceiling, automatically injects XNT from reserve
- Logs injection amount and new price
- Updates pool state (xnt_reserve, k constant)

## Setup Instructions

### 1. Deploy Program
```bash
anchor build
anchor deploy
```

### 2. Initialize Pool with Ceiling Defense
```bash
npx ts-node scripts/setup-spl-token-pool.ts
```

This script:
- Creates XNT and USDC mints
- Derives pool and ceiling reserve PDAs
- Initializes pool with $2.00 ceiling
- Funds ceiling reserve with 10M XNT
- Creates trader wallet with 10M USDC

### 3. Configuration
Edit `scripts/setup-spl-token-pool.ts`:

```typescript
const CONFIG = {
  INITIAL_XNT: 10_000_000 * 1e6,         // Pool XNT
  VIRTUAL_USDC: 10_000_000 * 1e6,        // Virtual USDC
  CEILING_RESERVE_XNT: 10_000_000 * 1e6, // Ceiling reserve
  PRICE_CEILING: 2_000_000,              // $2.00 (6 decimals)
  // ...
};
```

## Web Interface Integration

### Frontend Updates (trading-app.js)

**Configuration:**
```javascript
const CONFIG = {
    CEILING_RESERVE_XNT: '2Ckf88dRPontfyTnPYgppEj9mn2ebPHCRvrURLCa4Pnh',
    // ...
};
```

**Display Ceiling Reserve:**
```javascript
// Fetch ceiling reserve balance
const ceilingReserveInfo = await connection.getTokenAccountBalance(
    new PublicKey(CONFIG.CEILING_RESERVE_XNT)
);
const ceilingReserveXnt = parseInt(ceilingReserveInfo.value.amount) / 1e6;
document.getElementById('ceilingReserveXnt').textContent =
    ceilingReserveXnt.toLocaleString();
```

### Backend Updates (server.js)

**Buy Endpoint:**
```javascript
// Derive ceiling reserve PDA
const [ceilingReservePda] = anchor.web3.PublicKey.findProgramAddressSync(
  [Buffer.from('ceiling_reserve'), poolAddress.toBuffer()],
  program.programId
);

// Include in buy transaction
.accountsPartial({
  // ... existing accounts
  ceilingReservePda: ceilingReservePda,
  ceilingReserveXnt: pool.ceilingReserveXnt,
})
```

## Monitoring & Observability

### On-Chain Logs

When ceiling defense triggers, the program logs:
```
⚠️ Price ceiling breach detected!
🛡️ Injecting XNT from ceiling reserve
💉 Injection amount: X XNT
📊 New price: $Y
```

### Web Interface Display

The trading interface shows:
- **Ceiling Reserve Balance**: Real-time XNT balance in reserve
- **Status**: "⚡ Auto-injected when price > $2.00"
- **Styling**: Orange theme for visibility

## Security Considerations

### Access Control
1. **Ceiling Reserve Funding**: Only pool authority can add funds
2. **PDA Authority**: Ceiling reserve controlled by program-derived address
3. **No Withdrawal**: No instruction to withdraw from ceiling reserve (one-way only)

### Economic Security
1. **Reserve Depletion**: Reserve can be exhausted if demand is too high
2. **Monitoring Required**: Authority should monitor reserve levels
3. **Refill Mechanism**: Authority can call `fund_ceiling_reserve` to top up

### Attack Vectors
1. **Reserve Drain**: Malicious actors could intentionally trigger ceiling defense to deplete reserve
   - **Mitigation**: Monitor reserve levels and adjust ceiling or refill as needed
2. **Price Manipulation**: Large buys could trigger excessive injections
   - **Mitigation**: Reserve acts as natural circuit breaker when depleted

## Testing

### Unit Tests
```bash
anchor test
```

### Integration Test
1. Start local validator
2. Run setup script
3. Execute large buy to trigger ceiling defense
4. Verify XNT injection and price cap

### Web Interface Test
1. Navigate to http://localhost:3030/trading
2. Create wallet and get airdrop
3. Execute buy orders
4. Observe ceiling reserve balance decrease when price > $2.00

## Performance Characteristics

### Gas Costs
- **Normal Buy**: Standard buy instruction cost
- **Ceiling Defense Triggered**: +1 CPI call to SPL Token (minimal overhead)
- **Estimated Additional Cost**: ~5,000 compute units

### Latency
- Ceiling defense executes synchronously within buy transaction
- No additional round trips or confirmations needed
- Total transaction time unchanged

## Future Enhancements

### Potential Improvements
1. **Dynamic Ceiling**: Allow authority to adjust price ceiling
2. **Reserve Alerts**: Emit events when reserve falls below threshold
3. **Gradual Injection**: Inject XNT gradually over multiple blocks
4. **Floor Defense**: Mirror mechanism for price floor protection
5. **Reserve Withdrawal**: Allow authority to withdraw excess reserves

### Monitoring Tools
1. Dashboard for reserve levels
2. Alerts when reserve < 10% of initial funding
3. Historical injection logs and analytics

## Comparison to Bot-Based Approach

| Feature | Ceiling Defense (Protocol) | External Bot |
|---------|---------------------------|--------------|
| Reliability | 100% (on-chain) | Depends on uptime |
| Latency | Instant (same tx) | Seconds delay |
| Gas Costs | Included in user tx | Separate bot txs |
| Complexity | Simple PDA + CPI | Monitoring + WebSockets |
| Security | Trustless | Requires secure key mgmt |
| Maintenance | Zero | Ongoing |

## Conclusion

The Automatic Ceiling Defense mechanism provides a robust, trustless way to enforce price ceilings without relying on external infrastructure. By integrating directly into the buy instruction, it guarantees that prices cannot exceed the configured ceiling while maintaining simplicity and capital efficiency.

The design leverages Solana's PDA system for secure, autonomous operation and requires minimal computational overhead. Combined with the web interface's real-time monitoring, it provides both users and administrators with full transparency into the ceiling defense system's operation.
