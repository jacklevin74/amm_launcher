# How to Run Tests Against Local Validator

## Step-by-Step Instructions

### Step 1: Open Two Terminal Windows

You'll need two terminal windows/tabs.

---

### Step 2: Terminal 1 - Start the Validator

In the first terminal, navigate to the project and start the validator:

```bash
cd /Users/yakovlevin/dev/lottery_amm

# Kill any existing validators
pkill -9 solana-test-validator

# Start fresh validator
solana-test-validator --reset
```

**Keep this terminal open!** You should see output like:
```
Ledger location: test-ledger
Log: test-ledger/validator.log
Identity: ...
Genesis Hash: ...
```

---

### Step 3: Terminal 2 - Run the Tests

In the second terminal, run:

```bash
cd /Users/yakovlevin/dev/lottery_amm

# Wait a few seconds for validator to fully start, then:
anchor test --skip-local-validator
```

This will:
1. Build the program
2. Deploy to your local validator
3. Run all the tests

---

## Expected Output

You should see:

1. **Price Calculation Tests** passing ✅
2. **Integration Tests** running transactions
3. Test results showing:
   - Pool initialization
   - User registrations
   - Settlement with price discovery
   - Claims at clearing price

---

## If Tests Fail

### Error: "Connection refused" or "Unable to obtain blockhash"
**Solution:** Validator isn't running. Check Terminal 1.

### Error: "Account has insufficient funds"
**Solution:** Run in Terminal 2:
```bash
solana airdrop 100
```

### Error: "Program not found"
**Solution:** Rebuild and redeploy:
```bash
anchor build
anchor deploy
anchor test --skip-build --skip-deploy
```

---

## Quick Test (No Validator Needed)

To just verify the price discovery math:

```bash
node -e "$(cat tests/price-calc-test.ts)"
```

This runs instantly and proves the core logic works.

---

## To Stop

When you're done:
- **Terminal 1:** Press `Ctrl+C` to stop the validator
- Clean up: `rm -rf test-ledger`

---

## Troubleshooting

### Validator won't start
```bash
# Check if another validator is running
ps aux | grep solana-test-validator

# Kill it
pkill -9 solana-test-validator

# Try again
solana-test-validator --reset
```

### Tests hang
- Make sure validator is running in Terminal 1
- Check `Anchor.toml` has `cluster = "localnet"`
- Try `solana config set --url http://localhost:8899`

---

## What Tests Verify

✅ Price discovery (all demand scenarios)
✅ Multiple users pay same clearing price  
✅ Token conservation
✅ Registration, settlement, claiming flow
✅ Pool state management
✅ PDA account creation
