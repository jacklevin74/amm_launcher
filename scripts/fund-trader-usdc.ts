/**
 * Fund Trader with USDC
 */

import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider, Wallet } from "@coral-xyz/anchor";
import { BondingCurve } from "../target/types/bonding_curve";
import { PublicKey, Keypair } from "@solana/web3.js";
import { getOrCreateAssociatedTokenAccount, mintTo } from "@solana/spl-token";
import fs from "fs";

async function main() {
  const poolAddress = process.argv[2] || "Gi6qRtNsaYuHo4m228ZcQq2SzJfAvvPkVoWuvEywfjRX";
  const amount = parseInt(process.argv[3] || "1100000"); // Default 1.1M USDC

  console.log("\n💸 Funding Trader with USDC...\n");

  const provider = AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.BondingCurve as Program<BondingCurve>;
  const payer = provider.wallet as Wallet;

  // Load trader wallet
  const traderWalletData = JSON.parse(fs.readFileSync("/tmp/trader-wallet.json", "utf-8"));
  const traderKeypair = Keypair.fromSecretKey(new Uint8Array(traderWalletData));

  console.log(`👤 Trader: ${traderKeypair.publicKey.toBase58()}`);

  // Get pool data
  const poolPda = new PublicKey(poolAddress);
  const pool = await program.account.pool.fetch(poolPda);

  console.log(`🏊 Pool: ${poolAddress}`);
  console.log(`   USDC Mint: ${pool.usdcMint.toBase58()}`);
  console.log(`   Amount: ${amount / 1e6} USDC\n`);

  // Create or get USDC account
  const traderUsdcAccount = await getOrCreateAssociatedTokenAccount(
    provider.connection,
    payer.payer,
    pool.usdcMint,
    traderKeypair.publicKey
  );

  console.log(`📍 Creating/Getting USDC account...`);
  console.log(`   Address: ${traderUsdcAccount.address.toBase58()}\n`);

  // Mint USDC
  console.log(`📍 Minting ${amount} USDC...`);
  const mintSig = await mintTo(
    provider.connection,
    payer.payer,
    pool.usdcMint,
    traderUsdcAccount.address,
    payer.publicKey,
    amount * 1e6 // Convert to base units
  );

  console.log(`✅ Minted! Tx: ${mintSig}`);
  console.log(`   Trader USDC Balance: ${amount / 1e6} USDC\n`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n❌ Error:", error);
    process.exit(1);
  });
