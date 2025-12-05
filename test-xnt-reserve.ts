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

  console.log("🧪 XNT RESERVE POOL DEPOSIT Test (Direct, Non-Price-Neutral)\n");
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
  console.log("💰 Creating and wrapping 15M SOL into wSOL...");
  const authorityXntAccount = await getOrCreateAssociatedTokenAccount(
    connection,
    walletKeypair,
    NATIVE_MINT,
    walletKeypair.publicKey
  );

  // Initialize pool with 10M XNT and 15M virtual USDC (starting at $1.50)
  const INITIAL_XNT = 10_000_000 * LAMPORTS_PER_SOL;
  const INITIAL_XNT_STR = "10000000000000000"; // 10M XNT (e9)
  const VIRTUAL_USDC_STR = "15000000000000"; // 15M USDC (e6)

  // Wrap SOL for initial pool + deposit
  const totalSolNeeded = 15_000_000 * LAMPORTS_PER_SOL; // 10M initial + 5M for deposit
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
      true, // price_floor_enabled
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
  console.log(`   USDC Reserve: ${pool.usdcReserve.toString()} (e9) = 15M USDC`);

  const initialPrice = Number(pool.usdcReserve) / Number(pool.xntReserve);
  const initialPriceE6 = Math.round(initialPrice * 1_000_000);
  console.log(`   Initial Price: ${formatPrice(initialPriceE6)}\n`);
  console.log("=".repeat(70));

  // ============================================================================
  // TEST: DIRECT DEPOSIT XNT (NOT price-neutral - price will decrease)
  // ============================================================================
  console.log("\n🟢 TEST: DIRECT DEPOSIT 5M XNT to Reserve Pool");
  console.log("─".repeat(70));
  console.log("NOTE: This is a DIRECT deposit (not price-neutral)");
  console.log("      XNT increases, USDC stays same → Price DECREASES");
  console.log("      Price floor protection ensures price stays >= $1.00\n");

  // Deposit 5M XNT: 10M → 15M, price: $1.50 → $1.00 (at floor)
  const depositAmount = 5_000_000 * LAMPORTS_PER_SOL;
  console.log(`💰 Depositing ${(depositAmount / 1e9).toLocaleString()} XNT...\n`);

  const xntBefore = Number(pool.xntReserve);
  const usdcBefore = Number(pool.usdcReserve);
  const priceBefore = usdcBefore / xntBefore;
  const priceBeforeE6 = Math.round(priceBefore * 1_000_000);

  console.log("📊 Before Direct Deposit:");
  console.log(`   XNT Reserve:  ${xntBefore.toLocaleString()} (e9)`);
  console.log(`   USDC Reserve: ${usdcBefore.toLocaleString()} (e9)`);
  console.log(`   Price: ${formatPrice(priceBeforeE6)}\n`);

  await program.methods
    .depositXnt(new anchor.BN(depositAmount))
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

  console.log("📊 After Direct Deposit:");
  console.log(`   XNT Reserve:  ${xntAfter.toLocaleString()} (e9) [+${((xntAfter - xntBefore) / 1e9).toLocaleString()}M]`);
  console.log(`   USDC Reserve: ${usdcAfter.toLocaleString()} (e9) [unchanged]`);
  console.log(`   Price: ${formatPrice(priceAfterE6)}\n`);

  console.log(`🔍 VERIFICATION (Direct Deposit):`);
  console.log(`   Price Before: ${formatPrice(priceBeforeE6)}`);
  console.log(`   Price After:  ${formatPrice(priceAfterE6)}`);
  console.log(`   Price Change: ${formatPrice(priceAfterE6 - priceBeforeE6)}`);
  console.log(`   Price DECREASED: ${priceAfterE6 < priceBeforeE6 ? "✅ YES (as expected)" : "❌ NO"}`);

  // Verify XNT increased and USDC stayed same
  const xntIncreased = xntAfter === xntBefore + depositAmount;
  const usdcUnchanged = usdcAfter === usdcBefore;
  console.log(`   XNT increased by exactly ${(depositAmount / 1e9).toLocaleString()}M: ${xntIncreased ? "✅ YES" : "❌ NO"}`);
  console.log(`   USDC remained unchanged: ${usdcUnchanged ? "✅ YES" : "❌ NO"}\n`);

  // Calculate expected price
  const expectedPriceE6 = Math.round((usdcAfter / xntAfter) * 1_000_000);
  console.log(`   Expected Price: ${formatPrice(expectedPriceE6)}`);
  console.log(`   Calculation: ${usdcAfter.toLocaleString()} / ${xntAfter.toLocaleString()} = ${formatPrice(expectedPriceE6)}`);
  console.log(`   Expected: $1.000000 (15M / 15M) - at price floor!`);

  const priceAtFloor = priceAfterE6 === 1_000_000;

  if (xntIncreased && usdcUnchanged && priceAfterE6 < priceBeforeE6 && priceAtFloor) {
    console.log("\n✅ DIRECT DEPOSIT TEST PASSED!");
    console.log(`   • XNT increased from ${(xntBefore / 1e9).toLocaleString()}M to ${(xntAfter / 1e9).toLocaleString()}M`);
    console.log(`   • USDC remained at ${(usdcAfter / 1e9).toLocaleString()}M`);
    console.log(`   • Price decreased from ${formatPrice(priceBeforeE6)} to ${formatPrice(priceAfterE6)}`);
    console.log(`   • Price hit the floor at exactly $1.00 ✅`);
    console.log(`   • This is expected behavior for direct reserve deposits`);
  } else {
    console.log("\n❌ DIRECT DEPOSIT TEST FAILED!");
  }

  console.log("\n" + "=".repeat(70));

  // ============================================================================
  // FINAL SUMMARY
  // ============================================================================
  console.log("\n📊 FINAL SUMMARY");
  console.log("─".repeat(70));
  console.log(`Starting Price:  ${formatPrice(initialPriceE6)}`);
  console.log(`After Deposit:   ${formatPrice(priceAfterE6)}`);
  console.log(`\nPrice Decrease:  ${formatPrice(priceBeforeE6 - priceAfterE6)}`);

  console.log("\n💡 KEY INSIGHTS:");
  console.log("   • deposit_xnt() is a DIRECT deposit (not price-neutral)");
  console.log("   • It adds XNT to reserves without adjusting USDC");
  console.log("   • This DECREASES price (XNT becomes cheaper)");
  console.log("   • Use deposit_xnt_price_neutral() to maintain constant price");
  console.log("   • Price floor protection ensures price stays >= $1.00");

  console.log("\n" + "=".repeat(70));
}

main().catch((err) => {
  console.error("❌ Test failed:", err);
  process.exit(1);
});
