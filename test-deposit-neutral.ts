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

  console.log("🧪 Price-Neutral USDC DEPOSIT Test\\n");
  console.log("=".repeat(70));

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
    console.log(`✅ Airdrop complete\\n`);
  } else {
    console.log(`✅ Wallet has sufficient SOL: ${balance / LAMPORTS_PER_SOL} SOL\\n`);
  }

  // Create e6 USDC mint
  const usdcMint = await createMint(connection, walletKeypair, walletKeypair.publicKey, null, 6);
  console.log(`✅ Created USDC mint (e6): ${usdcMint.toString()}\\n`);

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

  // Initialize pool with 10M XNT and 7M virtual USDC (starts at $0.70)
  const INITIAL_XNT_STR = "10000000000000000"; // 10M XNT (e9)
  const INITIAL_XNT = 10_000_000 * LAMPORTS_PER_SOL;
  const VIRTUAL_USDC_STR = "7000000000000"; // 7M USDC (e6) = will be normalized to 7M in e9

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
  console.log(`✅ Wrapped ${(Number(authorityBalance.amount) / 1e9).toLocaleString()} wSOL\\n`);

  console.log("📊 Initializing pool with 7M virtual USDC...");
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

  // Now deposit 3M REAL USDC to the pool
  console.log("\\n💵 Depositing 3M REAL USDC to pool (price-neutral)...");
  const realUsdcAmount = 3_000_000_000_000; // 3M USDC (e6)

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

  // Get initial state (before deposit)
  const poolUsdcAccountBefore = await getAccount(connection, pool.poolUsdc);
  const realUsdcBefore = Number(poolUsdcAccountBefore.amount);
  const virtualUsdcBefore = Number(pool.usdcReserve);
  const totalUsdcBefore = realUsdcBefore * 1000 + virtualUsdcBefore;
  const xntReserve = Number(pool.xntReserve);

  console.log(`✅ Prepared 3M USDC for deposit\\n`);
  console.log("📊 BEFORE DEPOSIT:");
  console.log(`   XNT Reserve:  ${xntReserve.toLocaleString()} (e9) = 10M XNT`);
  console.log(`   Virtual USDC: ${virtualUsdcBefore.toLocaleString()} (e9) = 7M USDC`);
  console.log(`   Real USDC:    ${realUsdcBefore.toLocaleString()} (e6) = 0 USDC`);
  console.log(`   Real USDC (normalized): ${(realUsdcBefore * 1000).toLocaleString()} (e9)`);
  console.log(`   TOTAL USDC:   ${totalUsdcBefore.toLocaleString()} (e9) = 7M USDC`);

  const initialPrice = (totalUsdcBefore * 1_000_000) / xntReserve;
  console.log(`\\n💰 Initial Price (using TOTAL USDC): ${formatPrice(initialPrice)}`);
  console.log(`   Calculation: ${totalUsdcBefore.toLocaleString()} / ${xntReserve.toLocaleString()} = ${formatPrice(initialPrice)}`);
  console.log(`   Expected: $0.700000 (7M USDC / 10M XNT)\\n`);

  console.log("=".repeat(70));

  // Now deposit 3M USDC using price-neutral deposit
  console.log(`\\n🟢 TEST: DEPOSIT 3M USDC (price-neutral)`);
  console.log("─".repeat(70));
  console.log(`💸 Depositing ${(realUsdcAmount / 1e6).toLocaleString()} USDC...\\n`);

  await program.methods
    .depositUsdcPriceNeutral(new anchor.BN(realUsdcAmount))
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

  console.log("📊 AFTER DEPOSIT:");
  console.log(`   XNT Reserve:  ${xntReserve.toLocaleString()} (e9) [unchanged]`);
  console.log(`   Virtual USDC: ${virtualUsdcAfter.toLocaleString()} (e9) [DECREASED]`);
  console.log(`   Real USDC:    ${realUsdcAfter.toLocaleString()} (e6) [INCREASED]`);
  console.log(`   Real USDC (normalized): ${(realUsdcAfter * 1000).toLocaleString()} (e9)`);
  console.log(`   TOTAL USDC:   ${totalUsdcAfter.toLocaleString()} (e9)`);

  const finalPrice = (totalUsdcAfter * 1_000_000) / xntReserve;
  console.log(`\\n💰 Final Price (using TOTAL USDC): ${formatPrice(finalPrice)}`);
  console.log(`   Calculation: ${totalUsdcAfter.toLocaleString()} / ${xntReserve.toLocaleString()} = ${formatPrice(finalPrice)}`);

  console.log(`\\n🔍 VERIFICATION:`);
  console.log(`   Initial TOTAL USDC: ${totalUsdcBefore.toLocaleString()} (e9)`);
  console.log(`   Final TOTAL USDC:   ${totalUsdcAfter.toLocaleString()} (e9)`);
  console.log(`   Change: ${(totalUsdcAfter - totalUsdcBefore).toLocaleString()}`);
  console.log(`   Total constant: ${totalUsdcBefore === totalUsdcAfter ? "✅ YES!" : "❌ NO"}`);

  console.log(`\\n   Initial Price: ${formatPrice(initialPrice)}`);
  console.log(`   Final Price:   ${formatPrice(finalPrice)}`);
  console.log(`   Price Change:  ${formatPrice(finalPrice - initialPrice)}`);
  console.log(`   Price constant: ${initialPrice === finalPrice ? "✅ YES!" : "❌ NO"}`);

  console.log("\\n" + "=".repeat(70));

  if (totalUsdcBefore === totalUsdcAfter && initialPrice === finalPrice) {
    console.log("\\n✅ SUCCESS! TRULY PRICE-NEUTRAL DEPOSIT!");
    console.log(`   • TOTAL USDC (virtual + real) remained constant at ${(totalUsdcAfter / 1e9).toLocaleString()}M`);
    console.log(`   • Price remained constant at ${formatPrice(initialPrice)}`);
    console.log(`   • Virtual decreased by ${((virtualUsdcBefore - virtualUsdcAfter) / 1e9).toLocaleString()}M`);
    console.log(`   • Real increased by ${((realUsdcAfter - realUsdcBefore) / 1e6).toLocaleString()}M`);
    console.log(`   • E6 to E9 normalization working perfectly! ✅`);
  } else {
    console.log("\\n❌ FAILED!");
    if (totalUsdcBefore !== totalUsdcAfter) {
      console.log(`   Total USDC changed by ${((totalUsdcAfter - totalUsdcBefore) / 1e9).toLocaleString()}M`);
    }
    if (initialPrice !== finalPrice) {
      console.log(`   Price changed by ${formatPrice(finalPrice - initialPrice)}`);
    }
  }

  console.log("\\n" + "=".repeat(70));
}

main().catch((err) => {
  console.error("❌ Test failed:", err);
  process.exit(1);
});
