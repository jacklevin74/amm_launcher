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

  console.log("🧪 TRUE Price-Neutral Test: 5M Virtual + 5M Real USDC\n");
  console.log("=" .repeat(70));

  // Check and fund wallet with SOL if needed
  const balance = await connection.getBalance(walletKeypair.publicKey);
  const requiredSol = 15;
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

  // Initialize pool with 10M XNT and 5M VIRTUAL USDC
  const INITIAL_XNT_STR = "10000000000000000"; // 10M XNT (e9)
  const INITIAL_XNT = 10_000_000 * LAMPORTS_PER_SOL;
  const VIRTUAL_USDC_STR = "5000000000000"; // 5M USDC (e6) = will be normalized to 5M in e9

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

  console.log("📊 Initializing pool with 5M VIRTUAL USDC...");
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

  // Now deposit 5M REAL USDC to the pool
  console.log("\n💵 Depositing 5M REAL USDC to pool...");
  const realUsdcAmount = 5_000_000_000_000; // 5M USDC (e6)

  // Create authority USDC account
  const authorityUsdcAccount = await getOrCreateAssociatedTokenAccount(
    connection,
    walletKeypair,
    usdcMint,
    walletKeypair.publicKey
  );

  // Mint USDC to authority
  await mintTo(
    connection,
    walletKeypair,
    usdcMint,
    authorityUsdcAccount.address,
    walletKeypair.publicKey,
    realUsdcAmount
  );

  // Transfer USDC from authority to pool
  await mintTo(
    connection,
    walletKeypair,
    usdcMint,
    pool.poolUsdc,
    walletKeypair.publicKey,
    realUsdcAmount
  );

  // Get initial state
  const poolUsdcAccountBefore = await getAccount(connection, pool.poolUsdc);
  const realUsdcBefore = Number(poolUsdcAccountBefore.amount);
  const virtualUsdcBefore = Number(pool.usdcReserve);
  const totalUsdcBefore = realUsdcBefore * 1000 + virtualUsdcBefore;
  const xntReserve = Number(pool.xntReserve);

  console.log(`✅ Pool now has 5M real USDC + 5M virtual USDC\n`);
  console.log("📊 INITIAL STATE:");
  console.log(`   XNT Reserve:  ${xntReserve.toLocaleString()} (e9) = 10M XNT`);
  console.log(`   Virtual USDC: ${virtualUsdcBefore.toLocaleString()} (e9) = 5M USDC`);
  console.log(`   Real USDC:    ${realUsdcBefore.toLocaleString()} (e6) = 5M USDC`);
  console.log(`   Real USDC (normalized): ${(realUsdcBefore * 1000).toLocaleString()} (e9)`);
  console.log(`   TOTAL USDC:   ${totalUsdcBefore.toLocaleString()} (e9) = 10M USDC`);

  const initialPrice = (totalUsdcBefore * 1_000_000) / xntReserve;
  console.log(`\n💰 Initial Price (using TOTAL USDC): ${formatPrice(initialPrice)}`);
  console.log(`   Calculation: ${totalUsdcBefore.toLocaleString()} / ${xntReserve.toLocaleString()} = ${formatPrice(initialPrice)}`);
  console.log(`   Expected: $1.000000 (10M USDC / 10M XNT)\n`);

  console.log("=" .repeat(70));

  // Now withdraw 2M USDC
  const withdrawAmount = 2_000_000_000_000; // 2M USDC (e6)

  console.log(`\n🔴 TEST: WITHDRAW 2M USDC (price-neutral)`);
  console.log("─".repeat(70));
  console.log(`💸 Withdrawing ${(withdrawAmount / 1e6).toLocaleString()} USDC...\n`);

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

  // Get final state
  const poolUsdcAccountAfter = await getAccount(connection, pool.poolUsdc);
  const realUsdcAfter = Number(poolUsdcAccountAfter.amount);
  const virtualUsdcAfter = Number(pool.usdcReserve);
  const totalUsdcAfter = realUsdcAfter * 1000 + virtualUsdcAfter;

  console.log("📊 AFTER WITHDRAWAL:");
  console.log(`   XNT Reserve:  ${xntReserve.toLocaleString()} (e9) [unchanged]`);
  console.log(`   Virtual USDC: ${virtualUsdcAfter.toLocaleString()} (e9) [INCREASED]`);
  console.log(`   Real USDC:    ${realUsdcAfter.toLocaleString()} (e6) [DECREASED]`);
  console.log(`   Real USDC (normalized): ${(realUsdcAfter * 1000).toLocaleString()} (e9)`);
  console.log(`   TOTAL USDC:   ${totalUsdcAfter.toLocaleString()} (e9)`);

  const finalPrice = (totalUsdcAfter * 1_000_000) / xntReserve;
  console.log(`\n💰 Final Price (using TOTAL USDC): ${formatPrice(finalPrice)}`);
  console.log(`   Calculation: ${totalUsdcAfter.toLocaleString()} / ${xntReserve.toLocaleString()} = ${formatPrice(finalPrice)}`);

  console.log(`\n🔍 VERIFICATION:`);
  console.log(`   Initial TOTAL USDC: ${totalUsdcBefore.toLocaleString()} (e9)`);
  console.log(`   Final TOTAL USDC:   ${totalUsdcAfter.toLocaleString()} (e9)`);
  console.log(`   Change: ${(totalUsdcAfter - totalUsdcBefore).toLocaleString()}`);
  console.log(`   Total constant: ${totalUsdcBefore === totalUsdcAfter ? "✅ YES!" : "❌ NO"}`);

  console.log(`\n   Initial Price: ${formatPrice(initialPrice)}`);
  console.log(`   Final Price:   ${formatPrice(finalPrice)}`);
  console.log(`   Price Change:  ${formatPrice(finalPrice - initialPrice)}`);
  console.log(`   Price constant: ${initialPrice === finalPrice ? "✅ YES!" : "❌ NO"}`);

  console.log("\n" + "=".repeat(70));

  if (totalUsdcBefore === totalUsdcAfter && initialPrice === finalPrice) {
    console.log("\n✅ SUCCESS! TRULY PRICE-NEUTRAL!");
    console.log(`   • TOTAL USDC (virtual + real) remained constant at ${(totalUsdcAfter / 1e9).toLocaleString()}M`);
    console.log(`   • Price remained constant at ${formatPrice(initialPrice)}`);
    console.log(`   • Virtual increased by ${((virtualUsdcAfter - virtualUsdcBefore) / 1e9).toLocaleString()}M`);
    console.log(`   • Real decreased by ${((realUsdcBefore - realUsdcAfter) / 1e6).toLocaleString()}M`);
    console.log(`   • E6 to E9 normalization working perfectly! ✅`);
  } else {
    console.log("\n❌ FAILED!");
    if (totalUsdcBefore !== totalUsdcAfter) {
      console.log(`   Total USDC changed by ${((totalUsdcAfter - totalUsdcBefore) / 1e9).toLocaleString()}M`);
    }
    if (initialPrice !== finalPrice) {
      console.log(`   Price changed by ${formatPrice(finalPrice - initialPrice)}`);
    }
  }

  console.log("\n" + "=".repeat(70));
}

main().catch((err) => {
  console.error("❌ Test failed:", err);
  process.exit(1);
});
