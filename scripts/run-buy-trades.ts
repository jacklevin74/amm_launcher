/**
 * Execute multiple buy trades to test price corridor bot
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
  console.error("Usage: npx ts-node scripts/run-buy-trades.ts --pool=<POOL_ADDRESS>");
  process.exit(1);
}
const poolAddress = new PublicKey(poolAddressArg.split('=')[1]);

const walletPath = process.env.ANCHOR_WALLET || process.env.HOME + "/.config/solana/id.json";
const rpcUrl = process.env.ANCHOR_PROVIDER_URL || "http://localhost:8899";

// Trade configuration - continuous small buys to watch bot react
const NUM_TRADES = 1000; // Run continuously
const BUY_AMOUNT = 100_000_000_000; // Fixed 100K USDC per trade
const DELAY_MS = 3000; // 3 seconds between trades

function randomBuyAmount(): number {
  return BUY_AMOUNT; // Fixed amount
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
  console.log("║        CONTINUOUS BUY BOT - WATCH CEILING DEFENSE         ║");
  console.log("╚════════════════════════════════════════════════════════════╝\n");

  // Fetch pool info
  const pool = await program.account.pool.fetch(poolAddress);
  const startPrice = pool.usdcReserve.toNumber() / pool.xntReserve.toNumber();

  console.log("📍 Pool:", poolAddress.toString());
  console.log("💹 Starting Price: $" + startPrice.toFixed(6));
  console.log("📊 Strategy: Continuous small buys every " + (DELAY_MS / 1000) + "s");
  console.log("💵 Buy Amount: $" + (BUY_AMOUNT / 1e6).toLocaleString() + "K USDC per trade");
  console.log("🎯 Goal: Push price toward $2.00 and watch bot defend");
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

  // Check if needs funding
  const usdcBalance = await connection.getTokenAccountBalance(traderUsdc.address);
  const totalNeeded = BUY_AMOUNT * NUM_TRADES;
  if (parseInt(usdcBalance.value.amount) < totalNeeded) {
    console.log("🔧 Funding wallet with USDC...");
    await mintTo(
      connection,
      walletKeypair,
      pool.usdcMint,
      traderUsdc.address,
      walletKeypair.publicKey,
      totalNeeded * 2 // Extra for safety
    );
    console.log("✅ Wallet funded\n");
  }

  console.log("🚀 Starting buy trades...\n");
  console.log("═══════════════════════════════════════════════════════════");
  console.log(" # │  USDC In   │   XNT Out  │ Eff. Price │  New Price  ");
  console.log("═══════════════════════════════════════════════════════════");

  let totalUsdcSpent = 0;
  let totalXntReceived = 0;

  for (let i = 1; i <= NUM_TRADES; i++) {
    try {
      const buyAmount = randomBuyAmount();

      // Get XNT balance before
      const xntBefore = await connection.getTokenAccountBalance(traderXnt.address);

      // Execute buy
      await program.methods
        .buy(new anchor.BN(buyAmount))
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
      const effectivePrice = buyAmount / xntReceived;

      totalUsdcSpent += buyAmount;
      totalXntReceived += xntReceived;

      // Format output
      const numStr = String(i).padStart(2);
      const usdcStr = ("$" + (buyAmount / 1e6).toFixed(0) + "K").padStart(10);
      const xntStr = ((xntReceived / 1e6).toFixed(2) + "M").padStart(10);
      const effPriceStr = ("$" + effectivePrice.toFixed(4)).padStart(10);
      const newPriceStr = ("$" + newPrice.toFixed(4)).padStart(11);

      console.log(`${numStr} │ ${usdcStr} │ ${xntStr} │ ${effPriceStr} │ ${newPriceStr}`);

      // Delay before next trade
      if (i < NUM_TRADES) {
        await sleep(DELAY_MS);
      }

    } catch (error) {
      console.error(`\n❌ Trade ${i} failed:`, error.message);
      if (error.message.includes("TradingLocked")) {
        console.log("\n🎓 Pool graduated! Trading locked.");
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
  console.log("📊 Total Trades:       " + NUM_TRADES);
  console.log("💵 Total USDC Spent:   $" + (totalUsdcSpent / 1e6).toLocaleString());
  console.log("🪙  Total XNT Bought:   " + (totalXntReceived / 1e6).toLocaleString() + " XNT");
  console.log("📈 Avg Buy Price:      $" + (totalUsdcSpent / totalXntReceived).toFixed(6));
  console.log("");
  console.log("💹 Starting Price:     $" + startPrice.toFixed(6));
  console.log("💹 Final Price:        $" + finalPrice.toFixed(6));
  console.log("📊 Price Change:       " + (priceChange > 0 ? "+" : "") + priceChange.toFixed(2) + "%");
  console.log("");
  console.log("🤖 Check bot log to see interventions:");
  console.log("   tail -f /tmp/bot-run.log");
  console.log("");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
