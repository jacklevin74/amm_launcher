/**
 * Test script for Price Corridor Bot
 *
 * Simulates market activity with random buy/sell orders to test
 * how the bot defends the $1.00 - $2.00 price corridor
 *
 * Usage:
 *   npx ts-node bots/test-corridor-bot.ts
 */

import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider, Wallet } from "@coral-xyz/anchor";
import { BondingCurve } from "../target/types/bonding_curve";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import fs from "fs";

// Configuration
const CONFIG = {
  INITIAL_XNT: 5_000_000_000_000,      // 5M XNT
  VIRTUAL_USDC: 5_000_000_000_000,     // 5M USDC
  NUM_TRADES: 50,                       // Number of random trades to execute
  TRADE_SIZE_MIN: 50_000_000_000,      // Min 50K USDC
  TRADE_SIZE_MAX: 300_000_000_000,     // Max 300K USDC
  BUY_PROBABILITY: 0.7,                 // 70% buy, 30% sell (creates upward pressure)
  DELAY_BETWEEN_TRADES: 2000,          // 2 second delay between trades
  RPC_URL: process.env.ANCHOR_PROVIDER_URL || "http://localhost:8899",
  WALLET_PATH: process.env.ANCHOR_WALLET || `${process.env.HOME}/.config/solana/id.json`,
};

async function main() {
  console.log("\n╔════════════════════════════════════════════════════════════╗");
  console.log("║        PRICE CORRIDOR BOT - TEST SIMULATION               ║");
  console.log("╚════════════════════════════════════════════════════════════╝\n");

  // Setup
  const walletKeypair = Keypair.fromSecretKey(
    Buffer.from(JSON.parse(fs.readFileSync(CONFIG.WALLET_PATH, "utf-8")))
  );

  const connection = new Connection(CONFIG.RPC_URL, "confirmed");
  const wallet = new Wallet(walletKeypair);
  const provider = new AnchorProvider(connection, wallet, { commitment: "confirmed" });
  anchor.setProvider(provider);

  const program = anchor.workspace.BondingCurve as Program<BondingCurve>;

  console.log("🔧 Setting up test environment...\n");

  // Create mints
  const xntMint = await createMint(connection, walletKeypair, walletKeypair.publicKey, null, 6);
  const usdcMint = await createMint(connection, walletKeypair, walletKeypair.publicKey, null, 6);

  console.log(`✅ XNT Mint:  ${xntMint.toBase58()}`);
  console.log(`✅ USDC Mint: ${usdcMint.toBase58()}`);

  // Derive pool PDA
  const [poolPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("pool"), xntMint.toBuffer(), usdcMint.toBuffer()],
    program.programId
  );
  console.log(`✅ Pool PDA:  ${poolPda.toBase58()}\n`);

  // Create token accounts
  const authorityXnt = (
    await getOrCreateAssociatedTokenAccount(connection, walletKeypair, xntMint, walletKeypair.publicKey)
  ).address;

  const traderUsdc = (
    await getOrCreateAssociatedTokenAccount(connection, walletKeypair, usdcMint, walletKeypair.publicKey)
  ).address;

  const traderXnt = (
    await getOrCreateAssociatedTokenAccount(connection, walletKeypair, xntMint, walletKeypair.publicKey)
  ).address;

  // Mint tokens
  console.log("💰 Minting tokens...");
  await mintTo(connection, walletKeypair, xntMint, authorityXnt, walletKeypair.publicKey, CONFIG.INITIAL_XNT * 4); // Extra for bot reserves
  await mintTo(connection, walletKeypair, usdcMint, traderUsdc, walletKeypair.publicKey, 100_000_000_000_000); // 100M USDC for trading
  console.log("✅ Tokens minted\n");

  // Initialize pool
  console.log("📊 Initializing pool...");
  const poolXntKeypair = Keypair.generate();
  const poolUsdcKeypair = Keypair.generate();

  await program.methods
    .initializePool(new anchor.BN(CONFIG.INITIAL_XNT), new anchor.BN(CONFIG.VIRTUAL_USDC))
    .accounts({
      initializer: walletKeypair.publicKey,
      pool: poolPda,
      xntMint,
      usdcMint,
      poolXnt: poolXntKeypair.publicKey,
      poolUsdc: poolUsdcKeypair.publicKey,
      initializerXnt: authorityXnt,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .signers([poolXntKeypair, poolUsdcKeypair])
    .rpc();

  const poolXnt = poolXntKeypair.publicKey;
  const poolUsdc = poolUsdcKeypair.publicKey;

  console.log("✅ Pool initialized\n");

  // Display initial state
  let pool = await program.account.pool.fetch(poolPda);
  const startPrice = pool.usdcReserve.toNumber() / pool.xntReserve.toNumber();

  console.log("╔════════════════════════════════════════════════════════════╗");
  console.log("║                    INITIAL STATE                          ║");
  console.log("╚════════════════════════════════════════════════════════════╝");
  console.log(`  XNT Reserve:   ${(pool.xntReserve.toNumber() / 1e6).toLocaleString()} XNT`);
  console.log(`  USDC Reserve:  $${(pool.usdcReserve.toNumber() / 1e6).toLocaleString()}`);
  console.log(`  Price:         $${startPrice.toFixed(6)}`);
  console.log(`  Constant k:    ${pool.k.toString()}`);
  console.log("");

  console.log("╔════════════════════════════════════════════════════════════╗");
  console.log("║                  SIMULATION PARAMETERS                    ║");
  console.log("╚════════════════════════════════════════════════════════════╝");
  console.log(`  Total Trades:      ${CONFIG.NUM_TRADES}`);
  console.log(`  Trade Size:        $${CONFIG.TRADE_SIZE_MIN / 1e6}K - $${CONFIG.TRADE_SIZE_MAX / 1e6}K`);
  console.log(`  Buy Probability:   ${(CONFIG.BUY_PROBABILITY * 100).toFixed(0)}%`);
  console.log(`  Trade Interval:    ${CONFIG.DELAY_BETWEEN_TRADES}ms`);
  console.log("");

  console.log("🎯 NOW START THE BOT IN ANOTHER TERMINAL:");
  console.log(`   npx ts-node bots/price-corridor-bot.ts --pool-address ${poolPda.toBase58()}\n`);

  console.log("⏳ Waiting 10 seconds for you to start the bot...");
  await new Promise((resolve) => setTimeout(resolve, 10000));

  console.log("\n🚀 Starting market simulation...\n");
  console.log("╔═══════╦══════╦═══════════════╦═══════════════╦═══════════════╦═══════════════╗");
  console.log("║ Trade ║ Type ║   Amount      ║   Received    ║  Price Before ║  Price After  ║");
  console.log("╠═══════╬══════╬═══════════════╬═══════════════╬═══════════════╬═══════════════╣");

  let buyCount = 0;
  let sellCount = 0;
  let totalVolume = 0;

  for (let i = 1; i <= CONFIG.NUM_TRADES; i++) {
    // Random trade size
    const tradeSize =
      Math.floor(Math.random() * (CONFIG.TRADE_SIZE_MAX - CONFIG.TRADE_SIZE_MIN)) +
      CONFIG.TRADE_SIZE_MIN;

    // Decide buy or sell
    const isBuy = Math.random() < CONFIG.BUY_PROBABILITY;

    // Get price before
    pool = await program.account.pool.fetch(poolPda);
    const priceBefore = pool.usdcReserve.toNumber() / pool.xntReserve.toNumber();

    try {
      if (isBuy) {
        // BUY XNT with USDC
        await program.methods
          .buy(new anchor.BN(tradeSize))
          .accounts({
            buyer: walletKeypair.publicKey,
            pool: poolPda,
            poolXnt,
            poolUsdc,
            buyerUsdc: traderUsdc,
            buyerXnt: traderXnt,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .rpc();

        buyCount++;
      } else {
        // SELL XNT for USDC
        // Calculate how much XNT to sell based on current price
        const xntAmount = Math.floor(tradeSize / priceBefore);

        await program.methods
          .sell(new anchor.BN(xntAmount))
          .accounts({
            seller: walletKeypair.publicKey,
            pool: poolPda,
            poolXnt,
            poolUsdc,
            sellerXnt: traderXnt,
            sellerUsdc: traderUsdc,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .rpc();

        sellCount++;
      }

      totalVolume += tradeSize;

      // Get price after
      pool = await program.account.pool.fetch(poolPda);
      const priceAfter = pool.usdcReserve.toNumber() / pool.xntReserve.toNumber();

      // Print row
      const typeStr = isBuy ? " BUY " : "SELL";
      const amountStr = isBuy
        ? `$${(tradeSize / 1e6).toFixed(0)}K`.padStart(13)
        : `${(tradeSize / priceBefore / 1e6).toFixed(0)}K XNT`.padStart(13);
      const receivedStr = isBuy
        ? `${(tradeSize / priceBefore / 1e6).toFixed(0)}K XNT`.padStart(13)
        : `$${(tradeSize / 1e6).toFixed(0)}K`.padStart(13);

      console.log(
        `║ ${String(i).padStart(5)} ║ ${typeStr} ║ ${amountStr} ║ ${receivedStr} ║ $${priceBefore
          .toFixed(6)
          .padStart(11)} ║ $${priceAfter.toFixed(6).padStart(11)} ║`
      );
    } catch (error: any) {
      if (error.toString().includes("PriceBelowMinimum")) {
        console.log(
          `║ ${String(i).padStart(5)} ║ ${
            isBuy ? " BUY " : "SELL"
          } ║   BLOCKED     ║   BLOCKED     ║ $${priceBefore
            .toFixed(6)
            .padStart(11)} ║  $1.00 FLOOR  ║`
        );
      } else {
        console.log(`║ ${String(i).padStart(5)} ║ ERROR ║   ${error.message?.substring(0, 50).padEnd(50)} ║`);
      }
    }

    // Wait before next trade
    await new Promise((resolve) => setTimeout(resolve, CONFIG.DELAY_BETWEEN_TRADES));
  }

  console.log("╚═══════╩══════╩═══════════════╩═══════════════╩═══════════════╩═══════════════╝");

  // Final summary
  pool = await program.account.pool.fetch(poolPda);
  const endPrice = pool.usdcReserve.toNumber() / pool.xntReserve.toNumber();

  console.log("\n╔════════════════════════════════════════════════════════════╗");
  console.log("║                      FINAL SUMMARY                        ║");
  console.log("╚════════════════════════════════════════════════════════════╝");
  console.log(`  📊 Total Trades:       ${CONFIG.NUM_TRADES}`);
  console.log(`  📈 Buy Trades:         ${buyCount} (${((buyCount / CONFIG.NUM_TRADES) * 100).toFixed(1)}%)`);
  console.log(`  📉 Sell Trades:        ${sellCount} (${((sellCount / CONFIG.NUM_TRADES) * 100).toFixed(1)}%)`);
  console.log(`  💰 Total Volume:       $${(totalVolume / 1e6).toLocaleString()}`);
  console.log(`  📊 Starting Price:     $${startPrice.toFixed(6)}`);
  console.log(`  📊 Ending Price:       $${endPrice.toFixed(6)}`);
  console.log(`  📈 Price Change:       ${((endPrice / startPrice - 1) * 100).toFixed(2)}%`);
  console.log(`  🎯 Price In Corridor:  ${endPrice >= 1.0 && endPrice <= 2.0 ? "✅ YES" : "❌ NO"}`);
  console.log("");

  console.log("🤖 Check the bot terminal to see intervention statistics!");
  console.log("");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
