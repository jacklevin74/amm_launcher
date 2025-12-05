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

  console.log("🧪 XNT Price-Neutral DEPOSIT & WITHDRAWAL Test\n");
  console.log("=".repeat(70));

  // Check and fund wallet with SOL if needed
  const balance = await connection.getBalance(walletKeypair.publicKey);
  const requiredSol = 25;
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
  console.log("💰 Creating and wrapping 10M SOL into wSOL...");
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

  // Wrap SOL
  const wrapIx = SystemProgram.transfer({
    fromPubkey: walletKeypair.publicKey,
    toPubkey: authorityXntAccount.address,
    lamports: INITIAL_XNT,
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
  console.log(`   XNT Reserve:  ${pool.xntReserve.toString()} (e9) = 10M XNT`);
  console.log(`   USDC Reserve: ${pool.usdcReserve.toString()} (e9) = 10M USDC`);

  const initialPrice = Number(pool.usdcReserve) / Number(pool.xntReserve);
  const initialPriceE6 = Math.round(initialPrice * 1_000_000);
  console.log(`   Initial Price: ${formatPrice(initialPriceE6)}\n`);
  console.log("=".repeat(70));

  // ============================================================================
  // TEST 1: DEPOSIT XNT (price-neutral)
  // ============================================================================
  console.log("\n🟢 TEST 1: DEPOSIT 2M XNT (price-neutral)");
  console.log("─".repeat(70));

  const depositAmount = 2_000_000 * LAMPORTS_PER_SOL;
  console.log(`💰 Depositing ${(depositAmount / 1e9).toLocaleString()} XNT...\n`);

  // Wrap more SOL for deposit
  const wrapIx2 = SystemProgram.transfer({
    fromPubkey: walletKeypair.publicKey,
    toPubkey: authorityXntAccount.address,
    lamports: depositAmount,
  });
  const syncIx2 = createSyncNativeInstruction(authorityXntAccount.address);
  const wrapTx2 = new anchor.web3.Transaction().add(wrapIx2, syncIx2);
  await provider.sendAndConfirm(wrapTx2);

  const xntBefore = Number(pool.xntReserve);
  const usdcBefore = Number(pool.usdcReserve);
  const priceBefore = usdcBefore / xntBefore;
  const priceBeforeE6 = Math.round(priceBefore * 1_000_000);

  console.log("📊 Before Deposit:");
  console.log(`   XNT Reserve:  ${xntBefore.toLocaleString()} (e9)`);
  console.log(`   USDC Reserve: ${usdcBefore.toLocaleString()} (e9)`);
  console.log(`   Price: ${formatPrice(priceBeforeE6)}\n`);

  await program.methods
    .depositXntPriceNeutral(new anchor.BN(depositAmount))
    .accountsPartial({
      authority: walletKeypair.publicKey,
      pool: poolPda,
      poolXnt: pool.poolXnt,
      authorityXnt: authorityXntAccount.address,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .rpc();

  pool = await program.account.pool.fetch(poolPda);

  const xntAfter = Number(pool.xntReserve);
  const usdcAfter = Number(pool.usdcReserve);
  const priceAfter = usdcAfter / xntAfter;
  const priceAfterE6 = Math.round(priceAfter * 1_000_000);

  console.log("📊 After Deposit:");
  console.log(`   XNT Reserve:  ${xntAfter.toLocaleString()} (e9) [+${((xntAfter - xntBefore) / 1e9).toLocaleString()}M]`);
  console.log(`   USDC Reserve: ${usdcAfter.toLocaleString()} (e9) [+${((usdcAfter - usdcBefore) / 1e9).toLocaleString()}M]`);
  console.log(`   Price: ${formatPrice(priceAfterE6)}\n`);

  console.log(`🔍 VERIFICATION (Deposit):`);
  console.log(`   Price Before: ${formatPrice(priceBeforeE6)}`);
  console.log(`   Price After:  ${formatPrice(priceAfterE6)}`);
  console.log(`   Price Change: ${formatPrice(priceAfterE6 - priceBeforeE6)}`);
  console.log(`   Price constant: ${priceBeforeE6 === priceAfterE6 ? "✅ YES!" : "❌ NO"}`);

  // Verify proportional increase
  const xntRatio = xntAfter / xntBefore;
  const usdcRatio = usdcAfter / usdcBefore;
  const ratioMatch = Math.abs(xntRatio - usdcRatio) < 0.0001;
  console.log(`   XNT increased by ratio: ${xntRatio.toFixed(4)}`);
  console.log(`   USDC increased by ratio: ${usdcRatio.toFixed(4)}`);
  console.log(`   Proportional increase: ${ratioMatch ? "✅ YES!" : "❌ NO"}\n`);

  if (priceBeforeE6 === priceAfterE6 && ratioMatch) {
    console.log("✅ DEPOSIT TEST PASSED! Price-neutral XNT deposit works correctly.\n");
  } else {
    console.log("❌ DEPOSIT TEST FAILED!\n");
  }

  console.log("=".repeat(70));

  // ============================================================================
  // TEST 2: WITHDRAW XNT (price-neutral)
  // ============================================================================
  console.log("\n🔴 TEST 2: WITHDRAW 1M XNT (price-neutral)");
  console.log("─".repeat(70));

  const withdrawAmount = 1_000_000 * LAMPORTS_PER_SOL;
  console.log(`💸 Withdrawing ${(withdrawAmount / 1e9).toLocaleString()} XNT...\n`);

  const xntBefore2 = Number(pool.xntReserve);
  const usdcBefore2 = Number(pool.usdcReserve);
  const priceBefore2 = usdcBefore2 / xntBefore2;
  const priceBefore2E6 = Math.round(priceBefore2 * 1_000_000);

  console.log("📊 Before Withdrawal:");
  console.log(`   XNT Reserve:  ${xntBefore2.toLocaleString()} (e9)`);
  console.log(`   USDC Reserve: ${usdcBefore2.toLocaleString()} (e9)`);
  console.log(`   Price: ${formatPrice(priceBefore2E6)}\n`);

  await program.methods
    .withdrawXntPriceNeutral(new anchor.BN(withdrawAmount))
    .accountsPartial({
      authority: walletKeypair.publicKey,
      pool: poolPda,
      poolXnt: pool.poolXnt,
      authorityXnt: authorityXntAccount.address,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .rpc();

  pool = await program.account.pool.fetch(poolPda);

  const xntAfter2 = Number(pool.xntReserve);
  const usdcAfter2 = Number(pool.usdcReserve);
  const priceAfter2 = usdcAfter2 / xntAfter2;
  const priceAfter2E6 = Math.round(priceAfter2 * 1_000_000);

  console.log("📊 After Withdrawal:");
  console.log(`   XNT Reserve:  ${xntAfter2.toLocaleString()} (e9) [-${((xntBefore2 - xntAfter2) / 1e9).toLocaleString()}M]`);
  console.log(`   USDC Reserve: ${usdcAfter2.toLocaleString()} (e9) [-${((usdcBefore2 - usdcAfter2) / 1e9).toLocaleString()}M]`);
  console.log(`   Price: ${formatPrice(priceAfter2E6)}\n`);

  console.log(`🔍 VERIFICATION (Withdrawal):`);
  console.log(`   Price Before: ${formatPrice(priceBefore2E6)}`);
  console.log(`   Price After:  ${formatPrice(priceAfter2E6)}`);
  console.log(`   Price Change: ${formatPrice(priceAfter2E6 - priceBefore2E6)}`);
  console.log(`   Price constant: ${priceBefore2E6 === priceAfter2E6 ? "✅ YES!" : "❌ NO"}`);

  // Verify proportional decrease
  const xntRatio2 = xntAfter2 / xntBefore2;
  const usdcRatio2 = usdcAfter2 / usdcBefore2;
  const ratioMatch2 = Math.abs(xntRatio2 - usdcRatio2) < 0.0001;
  console.log(`   XNT decreased by ratio: ${xntRatio2.toFixed(4)}`);
  console.log(`   USDC decreased by ratio: ${usdcRatio2.toFixed(4)}`);
  console.log(`   Proportional decrease: ${ratioMatch2 ? "✅ YES!" : "❌ NO"}\n`);

  if (priceBefore2E6 === priceAfter2E6 && ratioMatch2) {
    console.log("✅ WITHDRAWAL TEST PASSED! Price-neutral XNT withdrawal works correctly.\n");
  } else {
    console.log("❌ WITHDRAWAL TEST FAILED!\n");
  }

  console.log("=".repeat(70));

  // ============================================================================
  // FINAL SUMMARY
  // ============================================================================
  console.log("\n📊 FINAL SUMMARY");
  console.log("─".repeat(70));
  console.log(`Starting Price:  ${formatPrice(initialPriceE6)}`);
  console.log(`After Deposit:   ${formatPrice(priceAfterE6)}`);
  console.log(`After Withdraw:  ${formatPrice(priceAfter2E6)}`);
  console.log(`\nFinal Price matches initial: ${initialPriceE6 === priceAfter2E6 ? "✅ YES!" : "❌ NO"}`);

  if (priceBeforeE6 === priceAfterE6 && priceBefore2E6 === priceAfter2E6 && initialPriceE6 === priceAfter2E6) {
    console.log("\n✅ ALL TESTS PASSED!");
    console.log("   • XNT deposit maintains price by proportionally increasing both reserves");
    console.log("   • XNT withdrawal maintains price by proportionally decreasing both reserves");
    console.log("   • Price = usdc_reserve / xnt_reserve remains constant throughout");
  } else {
    console.log("\n❌ SOME TESTS FAILED!");
  }

  console.log("\n" + "=".repeat(70));
}

main().catch((err) => {
  console.error("❌ Test failed:", err);
  process.exit(1);
});
