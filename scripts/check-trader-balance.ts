/**
 * Check Trader Wallet Balance
 */

import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider, Wallet } from "@coral-xyz/anchor";
import { BondingCurve } from "../target/types/bonding_curve";
import { PublicKey, Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { getAccount } from "@solana/spl-token";
import fs from "fs";

async function main() {
  const poolAddress = process.argv[2] || "Gi6qRtNsaYuHo4m228ZcQq2SzJfAvvPkVoWuvEywfjRX";

  console.log("\n💰 Checking Trader Wallet Balance...\n");

  const provider = AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.BondingCurve as Program<BondingCurve>;
  const payer = provider.wallet as Wallet;

  // Load trader wallet
  const traderWalletData = JSON.parse(fs.readFileSync("/tmp/trader-wallet.json", "utf-8"));
  const traderKeypair = Keypair.fromSecretKey(new Uint8Array(traderWalletData));

  console.log(`👤 Trader Address: ${traderKeypair.publicKey.toBase58()}`);

  // Get pool data
  const poolPda = new PublicKey(poolAddress);
  const pool = await program.account.pool.fetch(poolPda);

  console.log(`🏊 Pool: ${poolAddress}`);
  console.log(`   USDC Mint: ${pool.usdcMint.toBase58()}\n`);

  // Check SOL balance
  const solBalance = await provider.connection.getBalance(traderKeypair.publicKey);
  console.log(`SOL Balance: ${solBalance / LAMPORTS_PER_SOL} SOL\n`);

  // Derive token accounts
  const [traderUsdcAccount] = PublicKey.findProgramAddressSync(
    [
      traderKeypair.publicKey.toBuffer(),
      new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA").toBuffer(),
      pool.usdcMint.toBuffer(),
    ],
    new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL")
  );

  // Check USDC balance
  try {
    const usdcAccount = await getAccount(provider.connection, traderUsdcAccount);
    console.log(`✅ USDC Account: ${traderUsdcAccount.toBase58()}`);
    console.log(`   Balance: ${Number(usdcAccount.amount) / 1e6} USDC\n`);
  } catch (e) {
    console.log(`❌ USDC Account does not exist yet`);
    console.log(`   Expected Address: ${traderUsdcAccount.toBase58()}\n`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n❌ Error:", error);
    process.exit(1);
  });
