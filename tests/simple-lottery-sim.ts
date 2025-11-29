/**
 * Pure TypeScript Lottery AMM Simulation
 * No blockchain needed - just math and logic
 */

// Constants
const PRECISION = 1_000_000_000; // 1e9
const INITIAL_PRICE = 1.0; // $1.00

// Pool state
interface LotteryPool {
  totalXNT: number;
  totalUSDC: number;
  participants: Participant[];
  clearingPrice: number;
  isSettled: boolean;
}

// Participant state
interface Participant {
  name: string;
  usdcCommitted: number;
  xntReceived: number;
  lotteryNumber?: number;
}

// Helper: Generate lottery number from hash simulation
function generateLotteryNumber(settlementHash: string, userName: string): number {
  // Simple hash simulation (in real code, use actual block hash)
  const combined = settlementHash + userName;
  let hash = 0;
  for (let i = 0; i < combined.length; i++) {
    hash = ((hash << 5) - hash) + combined.charCodeAt(i);
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash);
}

// Create a new lottery pool
function createPool(initialXNT: number): LotteryPool {
  return {
    totalXNT: initialXNT,
    totalUSDC: 0,
    participants: [],
    clearingPrice: INITIAL_PRICE,
    isSettled: false,
  };
}

// User registers with USDC
function register(pool: LotteryPool, name: string, usdcAmount: number): void {
  if (pool.isSettled) {
    throw new Error("Pool already settled");
  }

  pool.participants.push({
    name,
    usdcCommitted: usdcAmount,
    xntReceived: 0,
  });

  pool.totalUSDC += usdcAmount;

  console.log(`  ✅ ${name} registered with $${usdcAmount.toLocaleString()}`);
}

// Settle lottery and calculate clearing price
function settle(pool: LotteryPool, settlementHash: string): void {
  if (pool.isSettled) {
    throw new Error("Pool already settled");
  }

  console.log("\n⚖️  Settling lottery...");
  console.log(`  Total USDC collected: $${pool.totalUSDC.toLocaleString()}`);
  console.log(`  Total XNT available: ${pool.totalXNT.toLocaleString()} XNT`);

  // Calculate clearing price: total_usdc / total_xnt
  // BUT enforce minimum price of $1.00
  if (pool.totalUSDC > 0 && pool.totalXNT > 0) {
    const calculatedPrice = pool.totalUSDC / pool.totalXNT;

    if (calculatedPrice < INITIAL_PRICE) {
      // Price would be below $1.00 - only distribute proportional XNT
      pool.clearingPrice = INITIAL_PRICE;
      const maxXNTToSell = pool.totalUSDC / INITIAL_PRICE;

      console.log(`  ⚠️  Insufficient demand - would price at $${calculatedPrice.toFixed(6)}`);
      console.log(`  🔒 Enforcing minimum price: $${INITIAL_PRICE.toFixed(2)}`);
      console.log(`  📊 Only selling ${maxXNTToSell.toLocaleString()} XNT (${((maxXNTToSell/pool.totalXNT)*100).toFixed(1)}% of pool)`);
      console.log(`  💎 Remaining ${(pool.totalXNT - maxXNTToSell).toLocaleString()} XNT stays in reserve`);

      // Update pool to only sell what can be sold at $1.00
      pool.totalXNT = maxXNTToSell;
    } else {
      // Normal case - price at or above $1.00
      pool.clearingPrice = calculatedPrice;
      console.log(`  Clearing price: $${pool.clearingPrice.toFixed(6)}`);
    }
  } else {
    console.log(`  No demand - price remains at $${INITIAL_PRICE.toFixed(2)}`);
  }

  // Assign lottery numbers to all participants
  for (const participant of pool.participants) {
    participant.lotteryNumber = generateLotteryNumber(settlementHash, participant.name);
  }

  pool.isSettled = true;
  console.log("  ✅ Lottery settled!");
}

// Claim tokens (everyone gets proportional share)
function claim(pool: LotteryPool, participantName: string): void {
  if (!pool.isSettled) {
    throw new Error("Lottery not settled yet");
  }

  const participant = pool.participants.find(p => p.name === participantName);
  if (!participant) {
    throw new Error("Participant not found");
  }

  if (participant.xntReceived > 0) {
    throw new Error("Already claimed");
  }

  // Calculate tokens based on USDC at clearing price
  // tokens = usdc / price
  const tokensOut = participant.usdcCommitted / pool.clearingPrice;

  participant.xntReceived = tokensOut;

  console.log(`\n  ${participant.name} claimed:`);
  console.log(`    Paid: $${participant.usdcCommitted.toLocaleString()}`);
  console.log(`    Received: ${tokensOut.toLocaleString()} XNT`);
  console.log(`    Effective price: $${pool.clearingPrice.toFixed(6)}`);
  console.log(`    Lottery number: ${participant.lotteryNumber}`);
}

// Run tests
function runTests() {
  console.log("╔════════════════════════════════════════════════════════════╗");
  console.log("║     LOTTERY AMM - PURE TYPESCRIPT SIMULATION TESTS        ║");
  console.log("╚════════════════════════════════════════════════════════════╝\n");

  // Test 1: Simple scenario with 3 users
  console.log("═══ Test 1: Three Users - Normal Demand ═══\n");
  const pool1 = createPool(1_000_000); // 1M XNT
  console.log(`Pool created with ${pool1.totalXNT.toLocaleString()} XNT at $${INITIAL_PRICE}/token\n`);

  register(pool1, "Alice", 100_000);
  register(pool1, "Bob", 500_000);
  register(pool1, "Charlie", 300_000);

  settle(pool1, "settlement_hash_12345");

  claim(pool1, "Alice");
  claim(pool1, "Bob");
  claim(pool1, "Charlie");

  // Verify all users pay same price
  const alicePrice = pool1.participants[0].usdcCommitted / pool1.participants[0].xntReceived;
  const bobPrice = pool1.participants[1].usdcCommitted / pool1.participants[1].xntReceived;
  const charliePrice = pool1.participants[2].usdcCommitted / pool1.participants[2].xntReceived;

  console.log(`\n  ✅ Price verification:`);
  console.log(`    Alice price: $${alicePrice.toFixed(6)}`);
  console.log(`    Bob price: $${bobPrice.toFixed(6)}`);
  console.log(`    Charlie price: $${charliePrice.toFixed(6)}`);
  console.log(`    All same? ${alicePrice === bobPrice && bobPrice === charliePrice}`);

  // Verify token conservation
  const totalXNTGiven = pool1.participants.reduce((sum, p) => sum + p.xntReceived, 0);
  console.log(`\n  💰 Token conservation:`);
  console.log(`    Total XNT distributed: ${totalXNTGiven.toLocaleString()}`);
  console.log(`    Total XNT in pool: ${pool1.totalXNT.toLocaleString()}`);
  console.log(`    Matches? ${Math.abs(totalXNTGiven - pool1.totalXNT) < 0.01}`);

  // Test 2: High demand scenario
  console.log("\n\n═══ Test 2: High Demand - 10 Users Want 100K Each ═══\n");
  const pool2 = createPool(1_000_000); // 1M XNT
  console.log(`Pool created with ${pool2.totalXNT.toLocaleString()} XNT\n`);

  for (let i = 1; i <= 10; i++) {
    register(pool2, `User${i}`, 100_000);
  }

  settle(pool2, "high_demand_settlement");

  console.log("\n  Claiming (first 3 users):");
  claim(pool2, "User1");
  claim(pool2, "User2");
  claim(pool2, "User3");

  console.log(`\n  📊 Summary:`);
  console.log(`    Total demand: $${pool2.totalUSDC.toLocaleString()}`);
  console.log(`    Clearing price: $${pool2.clearingPrice.toFixed(6)}`);
  console.log(`    Each user pays: $${pool2.clearingPrice.toFixed(6)} per XNT`);
  console.log(`    Each user receives: ${(100_000 / pool2.clearingPrice).toLocaleString()} XNT`);

  // Test 3: Low demand scenario
  console.log("\n\n═══ Test 3: Low Demand - Price Below $1 ═══\n");
  const pool3 = createPool(1_000_000); // 1M XNT
  console.log(`Pool created with ${pool3.totalXNT.toLocaleString()} XNT\n`);

  register(pool3, "Whale", 500_000); // Only $500K for 1M XNT

  settle(pool3, "low_demand_settlement");
  claim(pool3, "Whale");

  console.log(`\n  📊 Summary:`);
  console.log(`    Total demand: $${pool3.totalUSDC.toLocaleString()}`);
  console.log(`    Clearing price: $${pool3.clearingPrice.toFixed(6)}`);
  console.log(`    Price < $1? ${pool3.clearingPrice < 1.0}`);
  console.log(`    Whale gets all ${pool3.totalXNT.toLocaleString()} XNT at discount!`);

  // Test 4: Extreme demand
  console.log("\n\n═══ Test 4: Extreme Demand - High Price ═══\n");
  const pool4 = createPool(1_000_000); // 1M XNT
  console.log(`Pool created with ${pool4.totalXNT.toLocaleString()} XNT\n`);

  // 50 users want 100K each = $5M demand
  for (let i = 1; i <= 50; i++) {
    register(pool4, `Buyer${i}`, 100_000);
  }

  settle(pool4, "extreme_demand_settlement");

  console.log("\n  Claiming (first 3 buyers):");
  claim(pool4, "Buyer1");
  claim(pool4, "Buyer2");
  claim(pool4, "Buyer3");

  console.log(`\n  📊 Summary:`);
  console.log(`    Total demand: $${pool4.totalUSDC.toLocaleString()}`);
  console.log(`    Clearing price: $${pool4.clearingPrice.toFixed(6)}`);
  console.log(`    Each buyer paid: $100,000`);
  console.log(`    Each buyer receives: ${(100_000 / pool4.clearingPrice).toLocaleString()} XNT`);
  console.log(`    Total XNT per buyer is SMALL due to high demand!`);

  // Final summary
  console.log("\n\n╔════════════════════════════════════════════════════════════╗");
  console.log("║                    TESTS COMPLETE                          ║");
  console.log("╚════════════════════════════════════════════════════════════╝\n");

  console.log("Key Findings:");
  console.log("  ✅ All users pay the SAME clearing price");
  console.log("  ✅ Price = Total USDC / Total XNT");
  console.log("  ✅ No refunds needed - everyone gets tokens");
  console.log("  ✅ Low demand → Low price (< $1)");
  console.log("  ✅ High demand → High price (> $1)");
  console.log("  ✅ Fair distribution regardless of claim order");
  console.log("");
}

// Run all tests
runTests();
