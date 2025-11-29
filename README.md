# Lottery AMM - Fair Token Launch on X1 Testnet

A lottery-based Automated Market Maker (AMM) built with Anchor for Solana, designed to provide fair token distribution during launches by using cryptographic randomness instead of first-come-first-served (FCFS).

## Why Lottery AMM?

Traditional token launches using FCFS mechanics suffer from:
- **Bot Dominance:** MEV bots and high-frequency traders get 100% of allocations
- **Unfair Distribution:** Early buyers pay $1.00, late buyers pay $2.00 (80% price difference)
- **Exclusion:** Most regular users get nothing when pool exhausts

**Lottery AMM solves this:**
- **Equal Opportunity:** Everyone has the same chance regardless of speed
- **Fair Pricing:** All winners pay the same average price
- **Predictable Randomness:** Uses future block hashes that cannot be manipulated
- **Automatic Refunds:** Non-winners get 100% USDC back

## Features

### Concentrated Liquidity (Uniswap V3 style)
- Price range: $1.00 - $2.00
- Capital efficient bonding curve
- 1M XNT tokens → ~$1.414M USDC capacity
- Average price: ~$1.41 per token

### Three-Phase Lottery System

**Phase 1: Registration** (e.g., 7 minutes)
- Users commit USDC to participate
- USDC held in escrow
- No tokens allocated yet
- No advantage to being first

**Phase 2: Settlement** (single transaction)
- Authority calls `settle()` after registration ends
- Uses future block hash for unpredictable randomness
- Calculates lottery numbers for all participants
- Determines winners based on available liquidity
- Proportional allocation if demand > supply

**Phase 3: Claiming** (anytime after settlement)
- Winners receive XNT tokens
- Non-winners receive USDC refunds
- Partial winners get tokens + partial refund
- Automatic, permissionless claiming

### Security
- **Verifiable Randomness:** Block hash unpredictable during registration
- **No Manipulation:** Authority cannot favor specific users
- **Escrow Safety:** USDC locked in program until settlement
- **No Double Claim:** Users can only claim once
- **Token Conservation:** All tokens accounted for

## Architecture

### Program Structure
```
lottery_amm/
├── programs/
│   └── lottery_amm/
│       └── src/
│           └── lib.rs          # 505 lines of Rust
├── tests/
│   └── lottery_amm.ts          # 503 lines of comprehensive tests
├── scripts/
│   ├── deploy-x1.ts            # Deployment automation
│   └── settle-lottery.ts       # Settlement automation
├── Anchor.toml                 # X1 testnet configuration
└── DEPLOYMENT.md               # Detailed deployment guide
```

### Key Instructions

**initialize_lottery**
- Sets up lottery pool
- Defines price range ($1-$2)
- Sets registration duration
- Initializes concentrated liquidity

**register**
- User commits USDC during registration period
- Creates participant PDA
- Transfers USDC to escrow
- Increments participant counter

**settle**
- Called by authority after registration ends
- Captures settlement block hash
- Calculates all lottery numbers
- Determines cutoff and allocations
- Updates pool reserves and price

**claim**
- User retrieves allocation
- Winners get XNT tokens
- Non-winners get USDC refund
- Marks participant as claimed

### Account Structure

**LotteryPool** (PDA)
```rust
pub struct LotteryPool {
    pub authority: Pubkey,
    pub token_mint: Pubkey,
    pub usdc_mint: Pubkey,
    pub liquidity: u128,              // Concentrated liquidity
    pub sqrt_price: u128,             // Current √P
    pub token_reserve: u64,           // XNT remaining
    pub usdc_reserve: u64,            // USDC collected
    pub registration_end_slot: u64,   // Deadline
    pub is_settled: bool,             // Settlement status
    pub settlement_blockhash: Pubkey, // Randomness source
    pub total_participants: u64,      // Registration count
    pub total_usdc_committed: u64,    // Total demand
    pub tokens_allocated: u64,        // Tokens distributed
    pub cutoff_lottery_number: u64,   // Winner threshold
}
```

**ParticipantEntry** (PDA)
```rust
pub struct ParticipantEntry {
    pub lottery_pool: Pubkey,
    pub user: Pubkey,
    pub usdc_committed: u64,      // Escrow amount
    pub lottery_number: u64,      // Assigned randomly
    pub token_allocation: u64,    // XNT won
    pub usdc_used: u64,           // USDC spent
    pub has_claimed: bool,        // Claim status
}
```

## Mathematics

### Concentrated Liquidity Formula
Based on Uniswap V3's constant product curve within a range:

**Token Reserve:**
```
x = L * (√P_max - √P) / (√P * √P_max)
```

**USDC Reserve:**
```
y = L * (√P - √P_min) / √P_min
```

**Liquidity Constant:**
```
L = initial_tokens * (√P_max * √P_min) / (√P_max - √P_min)
  = 1,000,000 * (√2 * √1) / (√2 - √1)
  ≈ 1.414213562 × 10^15
```

### Lottery Allocation
1. Generate lottery number per user:
   ```rust
   lottery_number = hash(settlement_blockhash + user_pubkey)
   ```

2. Sort users by lottery number (ascending)

3. Allocate tokens sequentially using bonding curve:
   - User with lowest number gets first
   - Calculate tokens from their USDC using AMM formula
   - Update price and reserves
   - Continue until pool exhausted or all users served

4. Users with lottery number > cutoff get full refunds

## Quick Start

### Prerequisites
```bash
# Install Anchor
cargo install --git https://github.com/coral-xyz/anchor avm --locked --force
avm install latest
avm use latest

# Install dependencies
yarn install
```

### Build
```bash
anchor build --no-idl
```

**Note:** The `--no-idl` flag is required with Anchor 0.32.1 and Rust 1.89+ due to IDL build compatibility issues.

### Test
```bash
# Local tests (recommended first)
anchor test

# X1 testnet tests
anchor test --provider.cluster x1testnet
```

### Deploy to X1 Testnet

1. **Configure Solana CLI:**
   ```bash
   solana config set --url https://rpc.x1.testnet.x1.tech
   solana-keygen new  # Or import existing wallet
   ```

2. **Get testnet tokens from X1 faucet**

3. **Deploy program:**
   ```bash
   anchor deploy --provider.cluster https://rpc.testnet.x1.xyz
   ```

4. **Initialize lottery pool:**
   ```bash
   yarn deploy-x1
   ```
   This creates:
   - XNT token mint (1M supply)
   - USDC-equivalent mint
   - Lottery pool with price range $1-$2
   - Saves deployment info to `deployment-x1.json`

5. **After registration period, settle lottery:**
   ```bash
   yarn settle-lottery
   ```

See [DEPLOYMENT.md](./DEPLOYMENT.md) for detailed instructions.

## Web Interface

A browser-based interface is available for interacting with deployed pools:

```bash
# Start the web server
yarn web
```

Then open http://localhost:3030 in your browser.

**Features:**
- Connect Phantom wallet
- View pool status and current price
- Settle lotteries after registration period
- Switch between localhost and X1 testnet
- Real-time transaction monitoring

**Currently Functional:**
- **Pool Status Viewer**: Fetch and display pool information including current price, participants, and timing
- **Settle Lottery**: Trigger settlement and view clearing price once settlement slot is reached

**Requires CLI for Now:**
- Creating new pools (requires token mint and vault setup)
- Registering for lotteries (requires USDC token accounts)
- Claiming tokens (requires XNT token accounts)

See [web/README.md](./web/README.md) for detailed usage instructions.

## Example Scenario

**Setup:**
- 100 users each want to buy $100k worth of XNT
- Total demand: $10M
- Pool capacity: $1.414M (only ~14 users can be fully filled)

**FCFS Result:**
- First 14 users: Get allocation (bots)
- Remaining 86 users: Get nothing
- Regular users: 0% success rate

**Lottery Result:**
- All 100 users register with $100k USDC
- Settlement assigns random lottery numbers
- Top ~14 lottery numbers win proportional allocations
- Everyone else gets full refund
- Regular users: 14% success rate

**Price Fairness:**
- FCFS: First buyer pays $1.00, last pays $1.92 (92% difference)
- Lottery: All winners pay same average price ~$1.41

## Testing

The test suite covers:
- Pool initialization with correct liquidity
- Multi-user registration
- Registration deadline enforcement
- Lottery settlement with randomness
- Winner claiming and refunds
- Double claim prevention
- Token conservation verification

Run tests:
```bash
anchor test
```

Expected output:
```
lottery_amm
  ✔ Initializes the lottery pool (1523ms)
  ✔ Allows multiple users to register (8234ms)
  ✔ Prevents registration after deadline
  ✔ Settles the lottery and allocates tokens (1856ms)
  ✔ Allows winners to claim tokens (3421ms)
  ✔ Refunds USDC to non-winners (2156ms)
  ✔ Prevents double claiming (234ms)
  ✔ Verifies final pool state (145ms)

8 passing (18s)
```

## Comparison with Other Approaches

| Approach | Fairness | Bot Resistance | Complexity | Permissionless |
|----------|----------|----------------|------------|----------------|
| **FCFS** | ❌ Low | ❌ None | ✅ Simple | ✅ Yes |
| **Lottery (this)** | ✅ High | ✅ Full | ⚠️ Medium | ✅ Yes |
| **Whitelist** | ⚠️ Medium | ✅ Full | ❌ High | ❌ No |
| **Per-wallet Limit** | ⚠️ Medium | ⚠️ Sybil Attack | ✅ Simple | ✅ Yes |

## Limitations

1. **Single Settlement:** Each pool can only be settled once
2. **Slot-based Timing:** Registration period based on slots (not wall time)
3. **Gas Costs:** More expensive than simple FCFS
4. **Authority Required:** Settlement must be triggered by authority
5. **Demand > Supply:** Not all users will get allocations in high-demand launches

## Future Improvements

- Multiple lottery rounds/tranches
- Dynamic registration periods
- Whale caps (max per user)
- Partial fill preferences
- Secondary market integration
- Cross-chain lottery bridges

## Technical Details

**Language:** Rust with Anchor Framework v0.32.1
**Network:** X1 Testnet
**Randomness:** Solana block hash (future_slot)
**Precision:** Fixed-point arithmetic (10^9)
**Price Range:** $1.00 - $2.00
**Token Decimals:** 9 (XNT), 6 (USDC)

## Links

- [Anchor Documentation](https://www.anchor-lang.com/)
- [X1 Testnet](https://x1.tech/)
- [Uniswap V3 Whitepaper](https://uniswap.org/whitepaper-v3.pdf)
- [Solana Documentation](https://docs.solana.com/)

## Project Structure

```
lottery_amm/
├── programs/lottery_amm/
│   ├── src/lib.rs              # Main program (509 lines)
│   └── Cargo.toml              # Rust dependencies
├── tests/
│   ├── simple-onchain.ts       # On-chain integration tests
│   └── price-calc-test.ts      # Price discovery math tests
├── scripts/
│   ├── deploy-x1.ts            # Deployment script
│   └── settle-lottery.ts       # Settlement script
├── web/
│   ├── index.html              # Browser interface
│   ├── serve.js                # Simple HTTP server
│   └── README.md               # Web interface guide
├── Anchor.toml                 # Network configuration
├── DEPLOYMENT.md               # Deployment guide
├── package.json                # Node dependencies
└── README.md                   # This file
```

## License

ISC

## Contributing

This is a demonstration project for X1 testnet. For production use:
1. Complete security audit
2. Stress test with high participant counts
3. Consider economic attack vectors
4. Add monitoring and alerting
5. Implement pause mechanism

---

**Built with ❤️ using Anchor Framework**
