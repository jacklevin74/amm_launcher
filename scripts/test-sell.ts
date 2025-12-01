/**
 * Test Sell Trade
 */

import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider, Wallet } from "@coral-xyz/anchor";
import { BondingCurve } from "../target/types/bonding_curve";
import { PublicKey, Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { getOrCreateAssociatedTokenAccount, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import fs from "fs";

async function main() {
  const poolAddress = process.argv[2] || "Gi6qRtNsaYuHo4m228ZcQq2SzJfAvvPkVoWuvEywfjRX";
  const xntAmount = parseFloat(process.argv[3] || "50000"); // Default 50K XNT

  console.log("\n💰 Testing SELL Trade...\n");

  const provider = AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.BondingCurve as Program<BondingCurve>;
  const payer = provider.wallet as Wallet;

  // Load trader wallet
  const traderWalletData = JSON.parse(fs.readFileSync("/tmp/trader-wallet.json", "utf-8"));
  const traderKeypair = Keypair.fromSecretKey(new Uint8Array(traderWalletData));

  console.log(`👤 Trader: ${traderKeypair.publicKey.toBase58()}`);
  console.log(`🏊 Pool: ${poolAddress}`);
  console.log(`💎 Selling: ${xntAmount} XNT\n`);

  // Get pool data
  const poolPda = new PublicKey(poolAddress);
  const pool = await program.account.pool.fetch(poolPda);

  // Get trader USDC account
  const traderUsdcAccount = await getOrCreateAssociatedTokenAccount(
    provider.connection,
    payer.payer,
    pool.usdcMint,
    traderKeypair.publicKey
  );

  // Get trader balances before
  const solBalanceBefore = await provider.connection.getBalance(traderKeypair.publicKey);
  const usdcBalanceBefore = Number(traderUsdcAccount.amount);

  console.log(`📊 Before Trade:`);
  console.log(`   SOL: ${solBalanceBefore / LAMPORTS_PER_SOL} SOL`);
  console.log(`   USDC: ${usdcBalanceBefore / 1e6} USDC\n`);

  // Execute sell
  console.log(`📍 Executing SELL...`);
  const tx = await program.methods
    .sell(new anchor.BN(xntAmount * LAMPORTS_PER_SOL)) // Convert to lamports
    .accountsPartial({
      seller: traderKeypair.publicKey,
      pool: poolPda,
      poolXnt: pool.poolXnt,
      poolUsdc: pool.poolUsdc,
      sellerUsdc: traderUsdcAccount.address,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .signers([traderKeypair])
    .rpc();

  console.log(`✅ SELL Success! Tx: ${tx}\n`);

  // Get balances after
  const solBalanceAfter = await provider.connection.getBalance(traderKeypair.publicKey);
  const traderUsdcAccountAfter = await getOrCreateAssociatedTokenAccount(
    provider.connection,
    payer.payer,
    pool.usdcMint,
    traderKeypair.publicKey
  );
  const usdcBalanceAfter = Number(traderUsdcAccountAfter.amount);

  const solSpent = (solBalanceBefore - solBalanceAfter) / LAMPORTS_PER_SOL;
  const usdcReceived = (usdcBalanceAfter - usdcBalanceBefore) / 1e6;

  console.log(`📊 After Trade:`);
  console.log(`   SOL: ${solBalanceAfter / LAMPORTS_PER_SOL} SOL`);
  console.log(`   USDC: ${usdcBalanceAfter / 1e6} USDC\n`);

  console.log(`📈 Trade Summary:`);
  console.log(`   Sold: ${solSpent.toFixed(4)} XNT (SOL)`);
  console.log(`   Received: ${usdcReceived} USDC`);
  console.log(`   Effective Price: $${(usdcReceived / solSpent).toFixed(6)} per XNT\n`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n❌ Error:", error);
    process.exit(1);
  });
