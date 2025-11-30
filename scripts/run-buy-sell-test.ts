/**
 * Execute 25 buy trades, then 50 sell trades to test floor defense bot
 */

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { BondingCurve } from "../target/types/bonding_curve";
import {
  TOKEN_PROGRAM_ID,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import { Keypair, Connection, PublicKey } from "@solana/web3.js";
import * as fs from "fs";

// Get pool address from command line
const args = process.argv.slice(2);
const poolAddressArg = args.find(arg => arg.startsWith('--pool='));
if (!poolAddressArg) {
  console.error("Usage: npx ts-node scripts/run-buy-sell-test.ts --pool=<POOL_ADDRESS>");
  process.exit(1);
}
const poolAddress = new PublicKey(poolAddressArg.split('=')[1]);

const walletPath = process.env.ANCHOR_WALLET || process.env.HOME + "/.config/solana/id.json";
const rpcUrl = process.env.ANCHOR_PROVIDER_URL || "http://localhost:8899";

// Trade configuration
const NUM_BUY_TRADES = 100;  // Buy trades first
const NUM_SELL_TRADES = 100; // Sell trades after
const MIN_TRADE_AMOUNT = 20_000_000_000; // Minimum 20K USDC/XNT per trade
const MAX_TRADE_AMOUNT = 50_000_000_000; // Maximum 50K USDC/XNT per trade
const DELAY_MS = 500; // 500ms between trades

// Helper to get random trade amount between min and max
function getRandomTradeAmount(): number {
  return Math.floor(Math.random() * (MAX_TRADE_AMOUNT - MIN_TRADE_AMOUNT + 1)) + MIN_TRADE_AMOUNT;
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  const walletKeypair = Keypair.fromSecretKey(
    Buffer.from(JSON.parse(fs.readFileSync(walletPath, "utf-8")))
  );

  const connection = new Connection(rpcUrl, "confirmed");
  const wallet = new anchor.Wallet(walletKeypair);
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  anchor.setProvider(provider);

  const program = anchor.workspace.BondingCurve as Program<BondingCurve>;

  console.log("\n╔════════════════════════════════════════════════════════════╗");
  console.log("║      BUY-SELL TEST - WATCH FLOOR DEFENSE BOT              ║");
  console.log("╚════════════════════════════════════════════════════════════╝\n");

  // Fetch pool info
  const pool = await program.account.pool.fetch(poolAddress);
  const startPrice = pool.usdcReserve.toNumber() / pool.xntReserve.toNumber();

  console.log("📍 Pool:", poolAddress.toString());
  console.log("💹 Starting Price: $" + startPrice.toFixed(6));
  console.log("📊 Strategy: 50 buys, then 50 sells");
  console.log("💵 Trade Amount: $" + (MIN_TRADE_AMOUNT / 1e6).toFixed(0) + "K - $" + (MAX_TRADE_AMOUNT / 1e6).toFixed(0) + "K USDC per trade (random)");
  console.log("🎯 Goal: Push price to $2.00 ceiling and $1.00 floor, watch bot DEPOSIT/REMOVE");
  console.log("");

  // Get trader accounts
  const traderXnt = await getOrCreateAssociatedTokenAccount(
    connection,
    walletKeypair,
    pool.xntMint,
    walletKeypair.publicKey
  );

  const traderUsdc = await getOrCreateAssociatedTokenAccount(
    connection,
    walletKeypair,
    pool.usdcMint,
    walletKeypair.publicKey
  );

  // Fund wallet with USDC for buys and extra XNT for sells
  console.log("🔧 Funding wallet...");
  const totalUsdcNeeded = MAX_TRADE_AMOUNT * NUM_BUY_TRADES;
  const totalXntNeeded = MAX_TRADE_AMOUNT * NUM_SELL_TRADES; // Approximate XNT needed for sells

  await mintTo(
    connection,
    walletKeypair,
    pool.usdcMint,
    traderUsdc.address,
    walletKeypair.publicKey,
    totalUsdcNeeded * 2 // Extra for safety
  );

  await mintTo(
    connection,
    walletKeypair,
    pool.xntMint,
    traderXnt.address,
    walletKeypair.publicKey,
    totalXntNeeded * 2 // Extra for safety
  );

  console.log("✅ Wallet funded\n");

  // ========== PHASE 1: BUY TRADES ==========
  console.log("🚀 PHASE 1: BUYING XNT (pushing price UP)...\n");
  console.log("═══════════════════════════════════════════════════════════");
  console.log(" # │  USDC In   │   XNT Out  │ Eff. Price │  New Price  ");
  console.log("═══════════════════════════════════════════════════════════");

  let totalUsdcSpent = 0;
  let totalXntReceived = 0;

  for (let i = 1; i <= NUM_BUY_TRADES; i++) {
    try {
      // Get random trade amount for this trade
      const tradeAmount = getRandomTradeAmount();

      // Get XNT balance before
      const xntBefore = await connection.getTokenAccountBalance(traderXnt.address);

      // Execute buy
      await program.methods
        .buy(new anchor.BN(tradeAmount))
        .accountsPartial({
          buyer: walletKeypair.publicKey,
          pool: poolAddress,
          poolXnt: pool.poolXnt,
          poolUsdc: pool.poolUsdc,
          buyerUsdc: traderUsdc.address,
          buyerXnt: traderXnt.address,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();

      // Get XNT balance after
      const xntAfter = await connection.getTokenAccountBalance(traderXnt.address);
      const xntReceived = parseInt(xntAfter.value.amount) - parseInt(xntBefore.value.amount);

      // Get new price
      const poolAfter = await program.account.pool.fetch(poolAddress);
      const newPrice = poolAfter.usdcReserve.toNumber() / poolAfter.xntReserve.toNumber();
      const effectivePrice = tradeAmount / xntReceived;

      totalUsdcSpent += tradeAmount;
      totalXntReceived += xntReceived;

      // Format output
      const numStr = String(i).padStart(2);
      const usdcStr = ("$" + (tradeAmount / 1e6).toFixed(0) + "K").padStart(10);
      const xntStr = ((xntReceived / 1e6).toFixed(2) + "M").padStart(10);
      const effPriceStr = ("$" + effectivePrice.toFixed(4)).padStart(10);
      const newPriceStr = ("$" + newPrice.toFixed(4)).padStart(11);

      console.log(`${numStr} │ ${usdcStr} │ ${xntStr} │ ${effPriceStr} │ ${newPriceStr}`);

      // Delay before next trade
      if (i < NUM_BUY_TRADES) {
        await sleep(DELAY_MS);
      }

    } catch (error) {
      console.error(`\n❌ Buy trade ${i} failed:`, error.message);
      continue;
    }
  }

  console.log("═══════════════════════════════════════════════════════════\n");

  // Get price after buy phase
  const poolAfterBuys = await program.account.pool.fetch(poolAddress);
  const priceAfterBuys = poolAfterBuys.usdcReserve.toNumber() / poolAfterBuys.xntReserve.toNumber();

  console.log("📊 After buy phase:");
  console.log(`   Price: $${priceAfterBuys.toFixed(6)}`);
  console.log(`   Total XNT acquired: ${(totalXntReceived / 1e6).toLocaleString()}M XNT`);
  console.log("");

  // Small pause before sell phase
  console.log("⏸️  Pausing 5 seconds before sell phase...\n");
  await sleep(5000);

  // ========== PHASE 2: SELL TRADES ==========
  console.log("🚀 PHASE 2: SELLING XNT (pushing price DOWN)...\n");
  console.log("═══════════════════════════════════════════════════════════");
  console.log(" # │  XNT In    │  USDC Out  │ Eff. Price │  New Price  ");
  console.log("═══════════════════════════════════════════════════════════");

  let totalXntSold = 0;
  let totalUsdcReceived = 0;
  let numSellsCompleted = 0;

  for (let i = 1; i <= NUM_SELL_TRADES; i++) {
    try {
      // Get random trade amount for this trade
      const tradeAmount = getRandomTradeAmount();

      // Get USDC balance before
      const usdcBefore = await connection.getTokenAccountBalance(traderUsdc.address);

      // Execute sell
      await program.methods
        .sell(new anchor.BN(tradeAmount))
        .accountsPartial({
          seller: walletKeypair.publicKey,
          pool: poolAddress,
          poolXnt: pool.poolXnt,
          poolUsdc: pool.poolUsdc,
          sellerXnt: traderXnt.address,
          sellerUsdc: traderUsdc.address,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();

      // Get USDC balance after
      const usdcAfter = await connection.getTokenAccountBalance(traderUsdc.address);
      const usdcReceived = parseInt(usdcAfter.value.amount) - parseInt(usdcBefore.value.amount);

      // Get new price
      const poolAfter = await program.account.pool.fetch(poolAddress);
      const newPrice = poolAfter.usdcReserve.toNumber() / poolAfter.xntReserve.toNumber();
      const effectivePrice = usdcReceived / tradeAmount;

      totalXntSold += tradeAmount;
      totalUsdcReceived += usdcReceived;
      numSellsCompleted++;

      // Format output
      const numStr = String(i).padStart(2);
      const xntStr = ((tradeAmount / 1e6).toFixed(0) + "M").padStart(10);
      const usdcStr = ("$" + (usdcReceived / 1e6).toFixed(2) + "K").padStart(10);
      const effPriceStr = ("$" + effectivePrice.toFixed(4)).padStart(10);
      const newPriceStr = ("$" + newPrice.toFixed(4)).padStart(11);

      console.log(`${numStr} │ ${xntStr} │ ${usdcStr} │ ${effPriceStr} │ ${newPriceStr}`);

      // Delay before next trade
      if (i < NUM_SELL_TRADES) {
        await sleep(DELAY_MS);
      }

    } catch (error) {
      console.error(`\n❌ Sell trade ${i} failed:`, error.message);

      // If we hit the floor, stop selling
      if (error.message.includes("PriceFloorViolation") || error.message.includes("InsufficientUsdc")) {
        console.log("\n🎓 Hit price floor or pool exhausted! Stopping sells.\n");
        break;
      }
      continue;
    }
  }

  console.log("═══════════════════════════════════════════════════════════");

  // Final stats
  const finalPool = await program.account.pool.fetch(poolAddress);
  const finalPrice = finalPool.usdcReserve.toNumber() / finalPool.xntReserve.toNumber();
  const priceChange = ((finalPrice / startPrice - 1) * 100);

  console.log("\n╔════════════════════════════════════════════════════════════╗");
  console.log("║                    TRADING SUMMARY                        ║");
  console.log("╚════════════════════════════════════════════════════════════╝");
  console.log("");
  console.log("📊 Buy Phase:");
  console.log("   Total Buys:        " + NUM_BUY_TRADES);
  console.log("   Total USDC Spent:  $" + (totalUsdcSpent / 1e6).toLocaleString());
  console.log("   Total XNT Bought:  " + (totalXntReceived / 1e6).toLocaleString() + " XNT");
  console.log("");
  console.log("📊 Sell Phase:");
  console.log("   Total Sells:       " + numSellsCompleted);
  console.log("   Total XNT Sold:    " + (totalXntSold / 1e6).toLocaleString() + " XNT");
  console.log("   Total USDC Got:    $" + (totalUsdcReceived / 1e6).toLocaleString());
  console.log("");
  console.log("💹 Price Journey:");
  console.log("   Starting Price:    $" + startPrice.toFixed(6));
  console.log("   After Buys:        $" + priceAfterBuys.toFixed(6));
  console.log("   Final Price:       $" + finalPrice.toFixed(6));
  console.log("   Total Change:      " + (priceChange > 0 ? "+" : "") + priceChange.toFixed(2) + "%");
  console.log("");
  console.log("🤖 Check bot log to see floor defense interventions:");
  console.log("   tail -f /tmp/bot-run.log");
  console.log("");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
