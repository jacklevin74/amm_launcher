/**
 * Fund Bot Reserve Script
 *
 * Funds an existing pool's bot reserve with 10M XNT
 */

import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider, Wallet } from "@coral-xyz/anchor";
import { BondingCurve } from "../target/types/bonding_curve";
import { PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";

async function main() {
  const poolAddress = process.argv[2];

  if (!poolAddress) {
    console.error("Usage: npx ts-node scripts/fund-bot-reserve.ts <pool-address>");
    process.exit(1);
  }

  console.log("\n🔧 Funding Bot Reserve...\n");

  // Setup provider
  const provider = AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.BondingCurve as Program<BondingCurve>;
  const payer = provider.wallet as Wallet;

  console.log(`👤 Authority: ${payer.publicKey.toBase58()}`);
  console.log(`🏊 Pool: ${poolAddress}\n`);

  const poolPda = new PublicKey(poolAddress);

  // Derive bot reserve PDA
  const [botReservePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("bot_reserve"), poolPda.toBuffer()],
    program.programId
  );

  console.log(`💰 Bot Reserve PDA: ${botReservePda.toBase58()}`);

  // Check current balance
  const currentBalance = await provider.connection.getBalance(botReservePda);
  console.log(`   Current Balance: ${currentBalance / LAMPORTS_PER_SOL} XNT\n`);

  // Fund with 10M XNT
  console.log("📍 Funding bot reserve with 10M XNT...");
  const fundTx = await program.methods
    .fundBotReserve(new anchor.BN("10000000000000000")) // 10M XNT in lamports
    .accountsPartial({
      authority: payer.publicKey,
      pool: poolPda,
      botReserve: botReservePda,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .rpc();

  console.log(`✅ Bot reserve funded! Tx: ${fundTx}`);

  // Verify new balance
  const newBalance = await provider.connection.getBalance(botReservePda);
  console.log(`   New Balance: ${newBalance / LAMPORTS_PER_SOL} XNT\n`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n❌ Error:", error);
    process.exit(1);
  });
