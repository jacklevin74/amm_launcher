import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { BondingCurve } from "./target/types/bonding_curve";
import {
  TOKEN_PROGRAM_ID,
  NATIVE_MINT,
  createMint,
  getOrCreateAssociatedTokenAccount,
  getAccount,
  createSyncNativeInstruction,
} from "@solana/spl-token";
import { Keypair, Connection, LAMPORTS_PER_SOL, SystemProgram } from "@solana/web3.js";
import * as fs from "fs";

function formatPrice(priceE6: number): string {
  return `$${(priceE6 / 1_000_000).toFixed(6)}`;
}

async function main() {
  const connection = new Connection("http://localhost:8899", "confirmed");
  const walletPath = process.env.HOME + "/.config/solana/id.json";
  const walletKeypair = Keypair.fromSecretKey(
    Buffer.from(JSON.parse(fs.readFileSync(walletPath, "utf-8")))
  );

  const wallet = new anchor.Wallet(walletKeypair);
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  anchor.setProvider(provider);

  const program = anchor.workspace.BondingCurve as Program<BondingCurve>;

  console.log("🧪 CEILING RESERVE FUNDING Test (Price-Invariant)\n");
  console.log("=".repeat(70));

  // Check and fund wallet with SOL if needed
  const balance = await connection.getBalance(walletKeypair.publicKey);
  const requiredSol = 20;
  if (balance < requiredSol * LAMPORTS_PER_SOL) {
    console.log(`💰 Airdropping ${requiredSol} SOL to wallet...`);
    const airdropSignature = await connection.requestAirdrop(
      walletKeypair.publicKey,
      requiredSol * LAMPORTS_PER_SOL
    );
    await connection.confirmTransaction(airdropSignature);
    console.log(`✅ Airdrop complete\n`);
  } else {
    console.log(`✅ Wallet has sufficient SOL: ${balance / LAMPORTS_PER_SOL} SOL\n`);
  }

  // Create e6 USDC mint
  const usdcMint = await createMint(connection, walletKeypair, walletKeypair.publicKey, null, 6);
  console.log(`✅ Created USDC mint (e6): ${usdcMint.toString()}\n`);

  // Find pool PDA
  const [poolPda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("pool"), NATIVE_MINT.toBuffer(), usdcMint.toBuffer()],
    program.programId
  );

  // Create pool accounts
  const poolXntKeypair = Keypair.generate();
  const poolUsdcKeypair = Keypair.generate();
  const ceilingReserveXntKeypair = Keypair.generate();

  // Create authority XNT account and wrap SOL
  console.log("💰 Creating and wrapping 15M SOL into wSOL...");
  const authorityXntAccount = await getOrCreateAssociatedTokenAccount(
    connection,
    walletKeypair,
    NATIVE_MINT,
    walletKeypair.publicKey
  );

  // Initialize pool with 10M XNT and 10M virtual USDC (starting at $1.00)
  const INITIAL_XNT = 10_000_000 * LAMPORTS_PER_SOL;
  const INITIAL_XNT_STR = "10000000000000000"; // 10M XNT (e9)
  const VIRTUAL_USDC_STR = "10000000000000"; // 10M USDC (e6)

  // Wrap SOL for initial pool + ceiling reserve funding
  const totalSolNeeded = 15_000_000 * LAMPORTS_PER_SOL; // 10M initial + 5M for ceiling reserve
  const wrapIx = SystemProgram.transfer({
    fromPubkey: walletKeypair.publicKey,
    toPubkey: authorityXntAccount.address,
    lamports: totalSolNeeded,
  });
  const syncIx = createSyncNativeInstruction(authorityXntAccount.address);
  const wrapTx = new anchor.web3.Transaction().add(wrapIx, syncIx);
  await provider.sendAndConfirm(wrapTx);

  const authorityBalance = await getAccount(connection, authorityXntAccount.address);
  console.log(`✅ Wrapped ${(Number(authorityBalance.amount) / 1e9).toLocaleString()} wSOL\n`);

  console.log("📊 Initializing pool with 10M XNT and 10M virtual USDC...");
  await program.methods
    .initializePool(
      new anchor.BN(INITIAL_XNT_STR),
      new anchor.BN(VIRTUAL_USDC_STR),
      true,
      new anchor.BN(2_000_000),
      new anchor.BN(1_000_000)
    )
    .accountsPartial({
      initializer: walletKeypair.publicKey,
      xntMint: NATIVE_MINT,
      usdcMint,
      poolXnt: poolXntKeypair.publicKey,
      poolUsdc: poolUsdcKeypair.publicKey,
      initializerXnt: authorityXntAccount.address,
      ceilingReserveXnt: ceilingReserveXntKeypair.publicKey,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .signers([poolXntKeypair, poolUsdcKeypair, ceilingReserveXntKeypair])
    .rpc();

  let pool = await program.account.pool.fetch(poolPda);

  console.log(`✅ Pool initialized\n`);
  console.log("📊 INITIAL STATE:");
  console.log(`   Pool XNT Reserve:  ${pool.xntReserve.toString()} (e9) = 10M XNT`);
  console.log(`   Pool USDC Reserve: ${pool.usdcReserve.toString()} (e9) = 10M USDC`);

  const initialPrice = Number(pool.usdcReserve) / Number(pool.xntReserve);
  const initialPriceE6 = Math.round(initialPrice * 1_000_000);
  console.log(`   Pool Price: ${formatPrice(initialPriceE6)}\n`);
  console.log("=".repeat(70));

  // ============================================================================
  // TEST: FUND CEILING RESERVE (does NOT affect price)
  // ============================================================================
  console.log("\n🟢 TEST: FUND CEILING RESERVE with 5M XNT");
  console.log("─".repeat(70));
  console.log("NOTE: Ceiling reserve is SEPARATE from pool AMM reserves");
  console.log("      Used to defend price ceiling ($2.00) during buy pressure");
  console.log("      Does NOT affect current pool price or constant k\n");

  const fundAmount = 5_000_000 * LAMPORTS_PER_SOL;
  console.log(`💰 Funding ceiling reserve with ${(fundAmount / 1e9).toLocaleString()} XNT...\n`);

  const xntBefore = Number(pool.xntReserve);
  const usdcBefore = Number(pool.usdcReserve);
  const priceBefore = usdcBefore / xntBefore;
  const priceBeforeE6 = Math.round(priceBefore * 1_000_000);

  // Get ceiling reserve balance before
  const ceilingReserveBefore = await getAccount(connection, pool.ceilingReserveXnt);
  const ceilingBalanceBefore = Number(ceilingReserveBefore.amount);

  console.log("📊 Before Funding:");
  console.log(`   Pool XNT Reserve:     ${xntBefore.toLocaleString()} (e9)`);
  console.log(`   Pool USDC Reserve:    ${usdcBefore.toLocaleString()} (e9)`);
  console.log(`   Ceiling Reserve:      ${ceilingBalanceBefore.toLocaleString()} (e9)`);
  console.log(`   Pool Price: ${formatPrice(priceBeforeE6)}\n`);

  await program.methods
    .fundCeilingReserve(new anchor.BN(fundAmount))
    .accountsPartial({
      authority: walletKeypair.publicKey,
      pool: poolPda,
      ceilingReserveXnt: pool.ceilingReserveXnt,
      authorityXnt: authorityXntAccount.address,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .rpc();

  pool = await program.account.pool.fetch(poolPda);

  const xntAfter = Number(pool.xntReserve);
  const usdcAfter = Number(pool.usdcReserve);
  const priceAfter = usdcAfter / xntAfter;
  const priceAfterE6 = Math.round(priceAfter * 1_000_000);

  // Get ceiling reserve balance after
  const ceilingReserveAfter = await getAccount(connection, pool.ceilingReserveXnt);
  const ceilingBalanceAfter = Number(ceilingReserveAfter.amount);

  console.log("📊 After Funding:");
  console.log(`   Pool XNT Reserve:     ${xntAfter.toLocaleString()} (e9) [unchanged]`);
  console.log(`   Pool USDC Reserve:    ${usdcAfter.toLocaleString()} (e9) [unchanged]`);
  console.log(`   Ceiling Reserve:      ${ceilingBalanceAfter.toLocaleString()} (e9) [+${((ceilingBalanceAfter - ceilingBalanceBefore) / 1e9).toLocaleString()}M]`);
  console.log(`   Pool Price: ${formatPrice(priceAfterE6)}\n`);

  console.log(`🔍 VERIFICATION (Ceiling Reserve Funding):`);
  console.log(`   Price Before: ${formatPrice(priceBeforeE6)}`);
  console.log(`   Price After:  ${formatPrice(priceAfterE6)}`);
  console.log(`   Price Change: ${formatPrice(priceAfterE6 - priceBeforeE6)}`);
  console.log(`   Price UNCHANGED: ${priceBeforeE6 === priceAfterE6 ? "✅ YES!" : "❌ NO"}`);

  // Verify pool reserves unchanged and ceiling reserve increased
  const xntUnchanged = xntAfter === xntBefore;
  const usdcUnchanged = usdcAfter === usdcBefore;
  const ceilingIncreased = ceilingBalanceAfter === ceilingBalanceBefore + fundAmount;

  console.log(`   Pool XNT unchanged: ${xntUnchanged ? "✅ YES" : "❌ NO"}`);
  console.log(`   Pool USDC unchanged: ${usdcUnchanged ? "✅ YES" : "❌ NO"}`);
  console.log(`   Ceiling reserve increased by ${(fundAmount / 1e9).toLocaleString()}M: ${ceilingIncreased ? "✅ YES" : "❌ NO"}\n`);

  if (xntUnchanged && usdcUnchanged && ceilingIncreased && priceBeforeE6 === priceAfterE6) {
    console.log("\n✅ CEILING RESERVE FUNDING TEST PASSED!");
    console.log(`   • Pool AMM reserves UNCHANGED at ${(xntAfter / 1e9).toLocaleString()}M XNT / ${(usdcAfter / 1e9).toLocaleString()}M USDC`);
    console.log(`   • Pool price UNCHANGED at ${formatPrice(priceAfterE6)}`);
    console.log(`   • Ceiling reserve increased from ${(ceilingBalanceBefore / 1e9).toLocaleString()}M to ${(ceilingBalanceAfter / 1e9).toLocaleString()}M`);
    console.log(`   • This reserve is stored separately for price ceiling defense`);
  } else {
    console.log("\n❌ CEILING RESERVE FUNDING TEST FAILED!");
  }

  console.log("\n" + "=".repeat(70));

  // ============================================================================
  // FINAL SUMMARY
  // ============================================================================
  console.log("\n📊 FINAL SUMMARY");
  console.log("─".repeat(70));
  console.log(`Pool Price (constant product): ${formatPrice(initialPriceE6)}`);
  console.log(`Ceiling Reserve Balance: ${(ceilingBalanceAfter / 1e9).toLocaleString()}M XNT`);

  console.log("\n💡 KEY INSIGHTS:");
  console.log("   • fund_ceiling_reserve() deposits to SEPARATE ceiling reserve account");
  console.log("   • Does NOT affect pool AMM reserves (xnt_reserve, usdc_reserve)");
  console.log("   • Does NOT affect pool price or constant k");
  console.log("   • Ceiling reserve is used ONLY for price ceiling defense ($2.00)");
  console.log("   • When price approaches $2.00, XNT is injected FROM ceiling reserve");
  console.log("   • This is TRUE price-invariant reserve funding");

  console.log("\n" + "=".repeat(70));
}

main().catch((err) => {
  console.error("❌ Test failed:", err);
  process.exit(1);
});
