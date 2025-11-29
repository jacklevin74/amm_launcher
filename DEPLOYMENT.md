# Lottery AMM Deployment on X1 Testnet

## Deployment Details

**Program ID:** `C8x5EWRYp1QMESFn3pPeNVEfCD6ecE4iziUbqjw6RNrG`

**Network:** X1 Testnet  
**RPC URL:** `https://rpc.testnet.x1.xyz`

**IDL Account:** `GfHi1fWdyf1eurvgC28yr8uXzbv2tfaw77Yoi2KRUmbW`

**Program Data Address:** `6ur1zzTP92punVNgRq7MGJTcwEWPAgAgkQadVVZkNNdm`  
**Upgrade Authority:** `FMEbtsgxMmxMBUvRRBAXye7XZPbJdXaADCPQ2nf7emXG`

**Last Deployed Slot:** 117746938  
**Program Size:** 311,760 bytes (304 KB)  
**Program Balance:** 2.17 SOL

---

## Program Features

### Price Discovery Mechanism
- **Dynamic clearing price** based on total USDC demand
- **Fair pricing:** All users pay the same price (no FCFS advantage)
- **Price range:** $1.00 - $2.00
- **Capacity:** Up to $1.414M USDC

### Instructions Available

1. **initialize_lottery** - Create new lottery pool with initial XNT
2. **register** - Users register with USDC (escrowed)
3. **settle** - Trigger price discovery (anyone can call after registration ends)
4. **claim** - Users claim XNT at clearing price
5. **get_pool_info** - View pool state

### Price Discovery Examples

```
Demand: $100K   → Price: ~$1.06
Demand: $500K   → Price: ~$1.31
Demand: $1M     → Price: ~$1.67
Demand: $1.5M+  → Price: $2.00 (capped)
```

---

## Using the Program

### View Program on Explorer

```bash
# Check program details
solana program show C8x5EWRYp1QMESFn3pPeNVEfCD6ecE4iziUbqjw6RNrG \
  --url https://rpc.testnet.x1.xyz
```

### Fetch IDL

```bash
anchor idl fetch C8x5EWRYp1QMESFn3pPeNVEfCD6ecE4iziUbqjw6RNrG \
  --provider.cluster https://rpc.testnet.x1.xyz \
  --out lottery_amm.json
```

---

## Next Steps

### Test Price Discovery
Run the calculation tests:
```bash
node -e "$(cat tests/price-calc-test.ts)"
```

### Initialize a Lottery Pool
Use the deployment script:
```bash
yarn run deploy-x1
```

---

## Technical Details

**Anchor Version:** 0.31.1  
**Solana Version:** 1.18+  
**Token Standard:** SPL Token

**Math Precision:**
- Fixed-point: 1e9 (PRECISION)
- sqrt_price range: 1.0e9 to 1.414213562e9
- Overflow protection: u128 for intermediate calculations

---

## Deployment Date
November 28, 2025 - Slot 117746938
