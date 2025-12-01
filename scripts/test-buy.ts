/**
 * Test Buy Trade
 */

import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider, Wallet } from "@coral-xyz/anchor";
import { BondingCurve } from "../target/types/bonding_curve";
import { PublicKey, Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { getOrCreateAssociatedTokenAccount, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import fs from "fs";

async function main() {
  const poolAddress = process.argv[2] || "Gi6qRtNsaYuHo4m228ZcQq2SzJfAvvPkVoWuvEywfjRX";
  const usdcAmount = parseInt(process.argv[3] || "100000"); // Default 100K USDC

  console.log("\n🛒 Testing BUY Trade...\n");

  const provider = AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.BondingCurve as Program<BondingCurve>;
  const payer = provider.wallet as Wallet;

  // Load trader wallet
  const traderWalletData = JSON.parse(fs.readFileSync("/tmp/trader-wallet.json", "utf-8"));
  const traderKeypair = Keypair.fromSecretKey(new Uint8Array(traderWalletData));

  console.log(`👤 Trader: ${traderKeypair.publicKey.toBase58()}`);
  console.log(`🏊 Pool: ${poolAddress}`);
  console.log(`💵 Buying with: ${usdcAmount / 1e6} USDC\n`);

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

  // Get trader SOL balance before
  const solBalanceBefore = await provider.connection.getBalance(traderKeypair.publicKey);
  console.log(`📊 Before Trade:`);
  console.log(`   SOL: ${solBalanceBefore / LAMPORTS_PER_SOL} SOL`);
  console.log(`   USDC: ${Number(traderUsdcAccount.amount) / 1e6} USDC\n`);

  // Execute buy
  console.log(`📍 Executing BUY...`);
  const tx = await program.methods
    .buy(new anchor.BN(usdcAmount * 1e6)) // Convert to base units
    .accountsPartial({
      buyer: traderKeypair.publicKey,
      pool: poolPda,
      poolXnt: pool.poolXnt,
      poolUsdc: pool.poolUsdc,
      buyerUsdc: traderUsdcAccount.address,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .signers([traderKeypair])
    .rpc();

  console.log(`✅ BUY Success! Tx: ${tx}\n`);

  // Get balances after
  const solBalanceAfter = await provider.connection.getBalance(traderKeypair.publicKey);
  const traderUsdcAccountAfter = await getOrCreateAssociatedTokenAccount(
    provider.connection,
    payer.payer,
    pool.usdcMint,
    traderKeypair.publicKey
  );

  const solReceived = (solBalanceAfter - solBalanceBefore) / LAMPORTS_PER_SOL;
  const usdcSpent = (Number(traderUsdcAccount.amount) - Number(traderUsdcAccountAfter.amount)) / 1e6;

  console.log(`📊 After Trade:`);
  console.log(`   SOL: ${solBalanceAfter / LAMPORTS_PER_SOL} SOL`);
  console.log(`   USDC: ${Number(traderUsdcAccountAfter.amount) / 1e6} USDC\n`);

  console.log(`📈 Trade Summary:`);
  console.log(`   Spent: ${usdcSpent} USDC`);
  console.log(`   Received: ${solReceived.toFixed(4)} XNT (SOL)`);
  console.log(`   Effective Price: $${(usdcSpent / solReceived).toFixed(6)} per XNT\n`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n❌ Error:", error);
    process.exit(1);
  });
