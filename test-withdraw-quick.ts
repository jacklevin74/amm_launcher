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
} from "@solana/spl-token";
import { Keypair, Connection, LAMPORTS_PER_SOL } from "@solana/web3.js";
import * as fs from "fs";

// Quick test for withdraw_usdc_price_neutral fix
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

  console.log("🧪 Quick Test: withdraw_usdc_price_neutral e6 normalization\n");

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
  console.log(`✅ Created USDC mint (e6): ${usdcMint.toString()}`);

  // Find pool PDA
  const [poolPda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("pool"), NATIVE_MINT.toBuffer(), usdcMint.toBuffer()],
    program.programId
  );

  // Create pool accounts
  const poolXntKeypair = Keypair.generate();
  const poolUsdcKeypair = Keypair.generate();
  const ceilingReserveXntKeypair = Keypair.generate();

  // Create authority XNT account
  const authorityXntAccount = await getOrCreateAssociatedTokenAccount(
    connection,
    walletKeypair,
    NATIVE_MINT,
    walletKeypair.publicKey
  );

  // Initialize pool with 10M XNT and 10M virtual USDC
  const INITIAL_XNT_STR = "10000000000000000"; // 10M XNT (e9)
  const VIRTUAL_USDC_STR = "10000000000000"; // 10M USDC (e6)

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

  const poolBefore = await program.account.pool.fetch(poolPda);
  console.log(`✅ Pool initialized`);
  console.log(`   Virtual USDC Reserve (e9): ${poolBefore.usdcReserve.toString()}`);
  console.log(`   Expected: 10,000,000,000,000 (10M USDC normalized to e9)\n`);

  // Withdraw 1M USDC (e6 amount)
  const withdrawAmount = 1_000_000_000_000; // 1M USDC in e6 = 1,000,000 * 1e6

  console.log(`💰 Withdrawing ${(withdrawAmount / 1e6).toLocaleString()} USDC (e6)...`);
  console.log(`   This is ${withdrawAmount.toLocaleString()} atomic units (e6)`);
  console.log(`   Normalized to e9: ${(withdrawAmount * 1000).toLocaleString()}\n`);

  // Create authority USDC account to receive withdrawal
  const authorityUsdcAccount = await getOrCreateAssociatedTokenAccount(
    connection,
    walletKeypair,
    usdcMint,
    walletKeypair.publicKey
  );

  // Mint USDC to pool first
  await mintTo(
    connection,
    walletKeypair,
    usdcMint,
    poolBefore.poolUsdc,
    walletKeypair.publicKey,
    withdrawAmount
  );

  console.log("📤 Executing withdraw_usdc_price_neutral...");
  await program.methods
    .withdrawUsdcPriceNeutral(new anchor.BN(withdrawAmount))
    .accountsPartial({
      authority: walletKeypair.publicKey,
      pool: poolPda,
      poolUsdc: poolBefore.poolUsdc,
      authorityUsdc: authorityUsdcAccount.address,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .rpc();

  const poolAfter = await program.account.pool.fetch(poolPda);

  console.log("\n✅ Withdrawal complete!\n");
  console.log("📊 Virtual Reserve Changes:");
  console.log(`   Before: ${poolBefore.usdcReserve.toString()}`);
  console.log(`   After:  ${poolAfter.usdcReserve.toString()}`);
  console.log(`   Change: ${(Number(poolBefore.usdcReserve) - Number(poolAfter.usdcReserve)).toLocaleString()}\n`);

  // Verify normalization
  const withdrawAmountNormalized = withdrawAmount * 1000;
  const expectedAfter = Number(poolBefore.usdcReserve) - withdrawAmountNormalized;
  const actualAfter = Number(poolAfter.usdcReserve);

  console.log("🔍 Verification:");
  console.log(`   Withdrawal (e6): ${withdrawAmount.toLocaleString()}`);
  console.log(`   Normalized (e9): ${withdrawAmountNormalized.toLocaleString()}`);
  console.log(`   Expected reserve after: ${expectedAfter.toLocaleString()}`);
  console.log(`   Actual reserve after:   ${actualAfter.toLocaleString()}`);

  if (actualAfter === expectedAfter) {
    console.log("\n✅ TEST PASSED: Virtual reserve correctly decreased by normalized amount!");
    console.log("   The fix is working - e6 USDC is being normalized to e9 before adjusting reserves.");
  } else {
    console.log("\n❌ TEST FAILED: Virtual reserve mismatch!");
    console.log(`   Difference: ${actualAfter - expectedAfter}`);
  }
}

main().catch((err) => {
  console.error("❌ Test failed:", err);
  process.exit(1);
});
