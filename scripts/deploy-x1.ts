import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { LotteryAmm } from "../target/types/lottery_amm";
import {
  createMint,
  createAccount,
  mintTo,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import * as fs from "fs";

/**
 * Deployment script for X1 Testnet
 *
 * This script will:
 * 1. Create XNT token mint
 * 2. Create USDC-equivalent mint (or use existing)
 * 3. Initialize lottery pool
 * 4. Save deployment info to JSON file
 */

async function main() {
  console.log("Starting deployment to X1 Testnet...\n");

  // Configure provider for X1 testnet
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.LotteryAmm as Program<LotteryAmm>;
  const authority = provider.wallet.publicKey;

  console.log("Provider configured:");
  console.log(`  Network: ${provider.connection.rpcEndpoint}`);
  console.log(`  Authority: ${authority.toString()}\n`);

  // Check authority balance
  const balance = await provider.connection.getBalance(authority);
  console.log(`Authority balance: ${balance / anchor.web3.LAMPORTS_PER_SOL} SOL`);

  if (balance < 1 * anchor.web3.LAMPORTS_PER_SOL) {
    throw new Error(
      "Insufficient SOL balance. Please fund your wallet with at least 1 SOL."
    );
  }

  // Step 1: Create XNT token mint
  console.log("\n1. Creating XNT token mint...");
  const tokenMintKeypair = Keypair.generate();

  const tokenMint = await createMint(
    provider.connection,
    provider.wallet as any,
    authority,
    null,
    9, // 9 decimals for XNT
    tokenMintKeypair
  );

  console.log(`   ✓ XNT Token Mint: ${tokenMint.toString()}`);

  // Step 2: Create or use USDC mint
  console.log("\n2. Creating USDC-equivalent token mint...");
  const usdcMintKeypair = Keypair.generate();

  const usdcMint = await createMint(
    provider.connection,
    provider.wallet as any,
    authority,
    null,
    6, // 6 decimals for USDC
    usdcMintKeypair
  );

  console.log(`   ✓ USDC Mint: ${usdcMint.toString()}`);

  // Step 3: Derive lottery pool PDA
  console.log("\n3. Deriving lottery pool PDA...");
  const [lotteryPool, poolBump] = PublicKey.findProgramAddressSync(
    [Buffer.from("lottery_pool"), tokenMint.toBuffer()],
    program.programId
  );

  console.log(`   ✓ Lottery Pool PDA: ${lotteryPool.toString()}`);
  console.log(`   ✓ Pool Bump: ${poolBump}`);

  // Step 4: Create pool token accounts
  console.log("\n4. Creating pool token accounts...");

  const poolTokenAccount = await createAccount(
    provider.connection,
    provider.wallet as any,
    tokenMint,
    lotteryPool,
    undefined,
    { commitment: "confirmed" }
  );

  console.log(`   ✓ Pool Token Account: ${poolTokenAccount.toString()}`);

  const poolUsdcAccount = await createAccount(
    provider.connection,
    provider.wallet as any,
    usdcMint,
    lotteryPool,
    undefined,
    { commitment: "confirmed" }
  );

  console.log(`   ✓ Pool USDC Account: ${poolUsdcAccount.toString()}`);

  // Step 5: Mint initial XNT supply to pool
  console.log("\n5. Minting initial XNT token supply...");
  const initialTokenAmount = new BN(1_000_000 * 10 ** 9); // 1M tokens

  await mintTo(
    provider.connection,
    provider.wallet as any,
    tokenMint,
    poolTokenAccount,
    authority,
    initialTokenAmount.toNumber()
  );

  console.log(`   ✓ Minted ${initialTokenAmount.toString()} XNT to pool`);

  // Step 6: Initialize lottery pool
  console.log("\n6. Initializing lottery pool...");
  const registrationDurationSlots = new BN(1000); // ~7 minutes at 400ms/slot

  const tx = await program.methods
    .initializeLottery(initialTokenAmount, registrationDurationSlots)
    .accounts({
      lotteryPool: lotteryPool,
      tokenMint: tokenMint,
      usdcMint: usdcMint,
      poolTokenAccount: poolTokenAccount,
      poolUsdcAccount: poolUsdcAccount,
      authority: authority,
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .rpc();

  console.log(`   ✓ Transaction: ${tx}`);

  // Step 7: Verify pool state
  console.log("\n7. Verifying pool state...");
  const poolAccount = await program.account.lotteryPool.fetch(lotteryPool);

  console.log("   Pool State:");
  console.log(`     Liquidity: ${poolAccount.liquidity.toString()}`);
  console.log(`     Sqrt Price: ${poolAccount.sqrtPrice.toString()}`);
  console.log(`     Token Reserve: ${poolAccount.tokenReserve.toString()}`);
  console.log(`     USDC Reserve: ${poolAccount.usdcReserve.toString()}`);
  console.log(`     Registration End Slot: ${poolAccount.registrationEndSlot.toString()}`);
  console.log(`     Price Range: $1.00 - $2.00`);

  // Step 8: Save deployment info
  const deploymentInfo = {
    network: "x1testnet",
    programId: program.programId.toString(),
    authority: authority.toString(),
    tokenMint: tokenMint.toString(),
    usdcMint: usdcMint.toString(),
    lotteryPool: lotteryPool.toString(),
    poolTokenAccount: poolTokenAccount.toString(),
    poolUsdcAccount: poolUsdcAccount.toString(),
    initialTokenAmount: initialTokenAmount.toString(),
    registrationDurationSlots: registrationDurationSlots.toString(),
    deployedAt: new Date().toISOString(),
    transactionSignature: tx,
  };

  const outputPath = "./deployment-x1.json";
  fs.writeFileSync(outputPath, JSON.stringify(deploymentInfo, null, 2));

  console.log(`\n✅ Deployment complete!`);
  console.log(`   Deployment info saved to: ${outputPath}`);

  console.log("\n📋 Summary:");
  console.log(`   Program ID: ${program.programId.toString()}`);
  console.log(`   XNT Token: ${tokenMint.toString()}`);
  console.log(`   USDC Token: ${usdcMint.toString()}`);
  console.log(`   Lottery Pool: ${lotteryPool.toString()}`);
  console.log(`   Registration Period: ${registrationDurationSlots.toString()} slots (~7 minutes)`);

  console.log("\n🚀 Next Steps:");
  console.log("   1. Users can register by calling 'register' with USDC");
  console.log("   2. After registration ends, call 'settle' to run the lottery");
  console.log("   3. Winners can call 'claim' to receive their XNT tokens");
  console.log("   4. Non-winners get USDC refunds when they call 'claim'");
}

main()
  .then(() => {
    console.log("\n✨ Deployment script completed successfully");
    process.exit(0);
  })
  .catch((err) => {
    console.error("\n❌ Deployment failed:");
    console.error(err);
    process.exit(1);
  });
