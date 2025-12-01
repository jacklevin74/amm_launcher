/**
 * Check Pool Balances
 *
 * Displays pool state and actual balances
 */

import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider } from "@coral-xyz/anchor";
import { BondingCurve } from "../target/types/bonding_curve";
import { PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";

async function main() {
  const poolAddress = process.argv[2];

  if (!poolAddress) {
    console.error("Usage: npx ts-node scripts/check-pool-balances.ts <pool-address>");
    process.exit(1);
  }

  console.log("\n📊 Pool Balance Check\n");

  // Setup provider
  const provider = AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.BondingCurve as Program<BondingCurve>;

  const poolPda = new PublicKey(poolAddress);

  // Fetch pool state
  const pool = await program.account.pool.fetch(poolPda);

  // Derive pool_xnt PDA
  const [poolXntPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("pool_xnt"), poolPda.toBuffer()],
    program.programId
  );

  // Derive bot reserve PDA
  const [botReservePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("bot_reserve"), poolPda.toBuffer()],
    program.programId
  );

  // Get actual balances
  const poolXntBalance = await provider.connection.getBalance(poolXntPda);
  const botReserveBalance = await provider.connection.getBalance(botReservePda);

  console.log("═══════════════════════════════════════════════════════════");
  console.log("                      POOL STATE                           ");
  console.log("═══════════════════════════════════════════════════════════\n");

  console.log(`Pool Address:    ${poolAddress}`);
  console.log(`Pool XNT PDA:    ${poolXntPda.toBase58()}`);
  console.log(`Bot Reserve PDA: ${botReservePda.toBase58()}\n`);

  console.log("📊 Virtual Reserves (from pool state):");
  console.log(`   XNT Reserve:  ${pool.solReserve.div(new anchor.BN(LAMPORTS_PER_SOL)).toString()} XNT`);
  console.log(`   USDC Reserve: ${pool.usdcReserve.div(new anchor.BN(1e6)).toString()} USDC`);
  const price = pool.usdcReserve.mul(new anchor.BN(1e9)).div(pool.solReserve).toNumber() / 1e9;
  console.log(`   Current Price: $${price}\n`);

  console.log("💰 Actual Balances (on-chain):");
  console.log(`   Pool XNT:     ${poolXntBalance / LAMPORTS_PER_SOL} XNT`);
  console.log(`   Bot Reserve:  ${botReserveBalance / LAMPORTS_PER_SOL} XNT\n`);

  console.log("═══════════════════════════════════════════════════════════\n");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n❌ Error:", error);
    process.exit(1);
  });
