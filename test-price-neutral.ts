import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { BondingCurve } from "./target/types/bonding_curve";
import {
  TOKEN_PROGRAM_ID,
  NATIVE_MINT,
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getAccount,
  createSyncNativeInstruction,
} from "@solana/spl-token";
import { Keypair, Connection, LAMPORTS_PER_SOL, SystemProgram } from "@solana/web3.js";
import * as fs from "fs";

// Calculate price from pool reserves (returns price in e6 format, e.g., 1_000_000 = $1.00)
function calculatePrice(usdcReserve: anchor.BN, xntReserve: anchor.BN): number {
  // Price = (usdc_reserve * 1_000_000) / xnt_reserve
  // usdc_reserve is already in e9, xnt_reserve is in e9
  // Result is in e6 (standard USD price format)
  return Number(usdcReserve.muln(1_000_000).div(xntReserve));
}

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

  console.log("🧪 Price-Neutral USDC Deposit & Withdrawal Test\n");
  console.log("=" .repeat(70));

  // Check and fund wallet with SOL if needed
  const balance = await connection.getBalance(walletKeypair.publicKey);
  const requiredSol = 15; // 15 SOL should be plenty
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
  const INITIAL_XNT_STR = "10000000000000000"; // 10M XNT (e9)
  const INITIAL_XNT = 10_000_000 * LAMPORTS_PER_SOL;  // 10M SOL in lamports for wrapping
  const VIRTUAL_USDC_STR = "10000000000000"; // 10M USDC (e6) = 10,000,000,000,000 atomic units

  // Wrap SOL by transferring to the account and syncing
  const wrapIx = SystemProgram.transfer({
    fromPubkey: walletKeypair.publicKey,
    toPubkey: authorityXntAccount.address,
    lamports: INITIAL_XNT,  // 10M SOL
  });
  const syncIx = createSyncNativeInstruction(authorityXntAccount.address);

  const wrapTx = new anchor.web3.Transaction().add(wrapIx, syncIx);
  await provider.sendAndConfirm(wrapTx);

  const authorityBalance = await getAccount(connection, authorityXntAccount.address);
  console.log(`✅ Wrapped ${(Number(authorityBalance.amount) / 1e9).toLocaleString()} wSOL\n`);

  console.log("📊 Initializing pool...");
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
  const initialPrice = calculatePrice(pool.usdcReserve, pool.xntReserve);

  console.log(`✅ Pool initialized`);
  console.log(`   XNT Reserve:  ${pool.xntReserve.toString()} (e9)`);
  console.log(`   USDC Reserve: ${pool.usdcReserve.toString()} (e9 normalized)`);
  console.log(`   Initial Price: ${formatPrice(initialPrice)}`);
  console.log(`   Expected: $1.000000 (10M USDC / 10M XNT)\n`);
  console.log("=" .repeat(70));

  // Create authority USDC account
  const authorityUsdcAccount = await getOrCreateAssociatedTokenAccount(
    connection,
    walletKeypair,
    usdcMint,
    walletKeypair.publicKey
  );

  // Test withdrawal amount
  const withdrawAmount = 2_000_000_000_000; // 2M USDC (e6)

  console.log("\n🔴 TEST: WITHDRAW 2M USDC (should NOT change price)");
  console.log("─".repeat(70));

  // Mint USDC to pool for withdrawal
  await mintTo(
    connection,
    walletKeypair,
    usdcMint,
    pool.poolUsdc,
    walletKeypair.publicKey,
    withdrawAmount
  );

  // Get real USDC balance before withdrawal
  const poolUsdcAccountBefore = await getAccount(connection, pool.poolUsdc);
  const realUsdcBefore = Number(poolUsdcAccountBefore.amount);
  const virtualUsdcBefore = Number(pool.usdcReserve);
  const totalUsdcBefore = realUsdcBefore * 1000 + virtualUsdcBefore; // normalize real to e9 and add to virtual

  const priceBeforeWithdraw = calculatePrice(pool.usdcReserve, pool.xntReserve);
  console.log(`📊 Before Withdrawal:`);
  console.log(`   XNT Reserve:  ${pool.xntReserve.toString()}`);
  console.log(`   Virtual USDC Reserve: ${pool.usdcReserve.toString()} (e9)`);
  console.log(`   Real USDC Balance: ${realUsdcBefore.toLocaleString()} (e6)`);
  console.log(`   Real USDC (normalized): ${(realUsdcBefore * 1000).toLocaleString()} (e9)`);
  console.log(`   TOTAL USDC (virtual + real): ${totalUsdcBefore.toLocaleString()} (e9)`);
  console.log(`   Price: ${formatPrice(priceBeforeWithdraw)}\n`);

  console.log(`💸 Withdrawing ${(withdrawAmount / 1e6).toLocaleString()} USDC...`);

  await program.methods
    .withdrawUsdcPriceNeutral(new anchor.BN(withdrawAmount))
    .accountsPartial({
      authority: walletKeypair.publicKey,
      pool: poolPda,
      poolUsdc: pool.poolUsdc,
      authorityUsdc: authorityUsdcAccount.address,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .rpc();

  pool = await program.account.pool.fetch(poolPda);
  const priceAfterWithdraw = calculatePrice(pool.usdcReserve, pool.xntReserve);

  // Get real USDC balance after withdrawal
  const poolUsdcAccountAfter = await getAccount(connection, pool.poolUsdc);
  const realUsdcAfter = Number(poolUsdcAccountAfter.amount);
  const virtualUsdcAfter = Number(pool.usdcReserve);
  const totalUsdcAfter = realUsdcAfter * 1000 + virtualUsdcAfter; // normalize real to e9 and add to virtual

  console.log(`\n📊 After Withdrawal:`);
  console.log(`   XNT Reserve:  ${pool.xntReserve.toString()}`);
  console.log(`   Virtual USDC Reserve: ${pool.usdcReserve.toString()} (e9) - INCREASED`);
  console.log(`   Real USDC Balance: ${realUsdcAfter.toLocaleString()} (e6)`);
  console.log(`   Real USDC (normalized): ${(realUsdcAfter * 1000).toLocaleString()} (e9)`);
  console.log(`   TOTAL USDC (virtual + real): ${totalUsdcAfter.toLocaleString()} (e9)`);
  console.log(`   Price: ${formatPrice(priceAfterWithdraw)}\n`);

  // Verify virtual reserve increased
  const withdrawAmountNormalized = withdrawAmount * 1000;
  const expectedReserve = Number(pool.usdcReserve);
  const initialReserve = 10_000_000_000_000_000;
  const actualIncrease = expectedReserve - initialReserve;

  console.log(`🔍 Reserve Change Verification:`);
  console.log(`   Withdrew (e6):           ${withdrawAmount.toLocaleString()}`);
  console.log(`   Normalized (e9):         ${withdrawAmountNormalized.toLocaleString()}`);
  console.log(`   Expected increase (e9):  ${withdrawAmountNormalized.toLocaleString()}`);
  console.log(`   Actual increase (e9):    ${actualIncrease.toLocaleString()}`);
  console.log(`   Match: ${actualIncrease === withdrawAmountNormalized ? "✅" : "❌"}\n`);

  const withdrawPriceChange = priceAfterWithdraw - priceBeforeWithdraw;
  console.log(`✅ Price Change: ${withdrawPriceChange} (${withdrawPriceChange === 0 ? "✓ PERFECT!" : "✗ CHANGED"})`);
  console.log(`   Before: ${formatPrice(priceBeforeWithdraw)}`);
  console.log(`   After:  ${formatPrice(priceAfterWithdraw)}`);

  console.log(`\n🔍 TOTAL USDC Verification (Virtual + Real):`);
  console.log(`   Before: ${totalUsdcBefore.toLocaleString()} (e9)`);
  console.log(`   After:  ${totalUsdcAfter.toLocaleString()} (e9)`);
  console.log(`   Change: ${(totalUsdcAfter - totalUsdcBefore).toLocaleString()}`);
  console.log(`   Total remains constant: ${totalUsdcBefore === totalUsdcAfter ? "✅ YES!" : "❌ NO"}\n`);

  // Calculate price using TOTAL USDC instead of just virtual reserve
  const xntReserve = Number(pool.xntReserve);
  const priceUsingTotal = (totalUsdcAfter * 1_000_000) / xntReserve;
  const priceUsingVirtual = (virtualUsdcAfter * 1_000_000) / xntReserve;

  console.log(`💰 Price Calculation Comparison:`);
  console.log(`   XNT Reserve: ${xntReserve.toLocaleString()} (e9)`);
  console.log(`   `);
  console.log(`   Method 1: Using VIRTUAL USDC only`);
  console.log(`     Virtual USDC: ${virtualUsdcAfter.toLocaleString()} (e9)`);
  console.log(`     Price = ${virtualUsdcAfter.toLocaleString()} / ${xntReserve.toLocaleString()} = ${formatPrice(priceUsingVirtual)}`);
  console.log(`   `);
  console.log(`   Method 2: Using TOTAL USDC (virtual + real)`);
  console.log(`     Total USDC: ${totalUsdcAfter.toLocaleString()} (e9)`);
  console.log(`     Price = ${totalUsdcAfter.toLocaleString()} / ${xntReserve.toLocaleString()} = ${formatPrice(priceUsingTotal)}`);
  console.log(`   `);
  console.log(`   Initial Price: ${formatPrice(initialPrice)}`);
  console.log(`   Price using TOTAL matches initial: ${priceUsingTotal === initialPrice ? "✅ YES!" : "❌ NO"}\n`);

  if (totalUsdcBefore === totalUsdcAfter) {
    console.log(`✅ TOTAL USDC (virtual + real) REMAINS CONSTANT!`);
    console.log(`   When we withdraw ${(withdrawAmount / 1e6).toLocaleString()} real USDC:`);
    console.log(`   - Real USDC decreases by ${(withdrawAmount / 1e6).toLocaleString()}`);
    console.log(`   - Virtual USDC increases by ${(withdrawAmountNormalized / 1e9).toLocaleString()}`);
    console.log(`   - Net effect: TOTAL stays the same = PRICE-NEUTRAL!`);

    if (priceUsingTotal === initialPrice) {
      console.log(`\n✅ TRUE PRICE-NEUTRAL: Price calculated from TOTAL USDC remains ${formatPrice(initialPrice)}`);
    }
  } else {
    console.log(`❌ TOTAL USDC CHANGED!`);
  }

  console.log("\n" + "=".repeat(70));

  console.log("\n📊 FINAL SUMMARY");
  console.log("─".repeat(70));
  console.log(`Initial Price:     ${formatPrice(initialPrice)}`);
  console.log(`After Withdrawal:  ${formatPrice(priceAfterWithdraw)}`);
  console.log(`\nPrice Change:      ${formatPrice(priceAfterWithdraw - initialPrice)}`);

  if (initialPrice === priceAfterWithdraw) {
    console.log(`\n✅ WITHDRAWAL IS PRICE-NEUTRAL!`);
    console.log(`   Price remained constant at ${formatPrice(initialPrice)}`);
  } else {
    console.log(`\n❌ PRICE CHANGED - NOT NEUTRAL!`);
  }

  console.log("\n" + "=".repeat(70));
}

main().catch((err) => {
  console.error("❌ Test failed:", err);
  process.exit(1);
});
