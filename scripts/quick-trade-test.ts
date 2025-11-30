/**
 * Quick test to execute a few trades and verify bot detection
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

const poolAddress = new PublicKey("41BtpyzrYMGoM3ivFkw5ZiaEurSc4HBW1fdBKzQYuJ63");
const walletPath = process.env.ANCHOR_WALLET || process.env.HOME + "/.config/solana/id.json";
const rpcUrl = process.env.ANCHOR_PROVIDER_URL || "http://localhost:8899";

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

  console.log("\n🧪 Quick Trade Test - Testing Bot Detection\n");
  console.log("📍 Pool:", poolAddress.toString());

  // Fetch pool info
  const pool = await program.account.pool.fetch(poolAddress);

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

  // Fund with USDC and XNT
  console.log("🔧 Funding wallet...");
  await mintTo(
    connection,
    walletKeypair,
    pool.usdcMint,
    traderUsdc.address,
    walletKeypair.publicKey,
    100_000_000_000 // 100K USDC
  );

  await mintTo(
    connection,
    walletKeypair,
    pool.xntMint,
    traderXnt.address,
    walletKeypair.publicKey,
    100_000_000_000 // 100M XNT
  );

  console.log("✅ Wallet funded\n");

  // Execute 3 buy trades
  console.log("🚀 Executing 3 BUY trades (6 seconds apart)...");
  for (let i = 1; i <= 3; i++) {
    await program.methods
      .buy(new anchor.BN(10_000_000_000)) // 10K USDC
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
    console.log(`   ✅ Buy trade ${i} completed`);
    await sleep(6000); // Wait 6 seconds for bot to detect
  }

  console.log("\n⏸️  Pausing 5 seconds...\n");
  await sleep(5000);

  // Execute 3 sell trades
  console.log("🚀 Executing 3 SELL trades (6 seconds apart)...");
  for (let i = 1; i <= 3; i++) {
    await program.methods
      .sell(new anchor.BN(10_000_000_000)) // 10M XNT
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
    console.log(`   ✅ Sell trade ${i} completed`);
    await sleep(6000); // Wait 6 seconds for bot to detect
  }

  console.log("\n✅ Test complete! Check bot logs for colored BUY/SELL detection:");
  console.log("   tail -30 /tmp/new-bot-test.log\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
