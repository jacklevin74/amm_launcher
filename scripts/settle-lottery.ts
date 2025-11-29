import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { LotteryAmm } from "../target/types/lottery_amm";
import * as fs from "fs";

/**
 * Settle lottery script
 *
 * This script settles the lottery after registration period ends
 * and calculates allocations for all participants
 */

async function main() {
  console.log("Starting lottery settlement...\n");

  // Load deployment info
  const deploymentInfo = JSON.parse(
    fs.readFileSync("./deployment-x1.json", "utf-8")
  );

  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.LotteryAmm as Program<LotteryAmm>;
  const authority = provider.wallet.publicKey;

  console.log("Configuration:");
  console.log(`  Network: ${provider.connection.rpcEndpoint}`);
  console.log(`  Authority: ${authority.toString()}`);
  console.log(`  Lottery Pool: ${deploymentInfo.lotteryPool}\n`);

  const lotteryPool = new anchor.web3.PublicKey(deploymentInfo.lotteryPool);

  // Check pool state
  const poolAccount = await program.account.lotteryPool.fetch(lotteryPool);

  console.log("Pool State:");
  console.log(`  Is Settled: ${poolAccount.isSettled}`);
  console.log(`  Total Participants: ${poolAccount.totalParticipants.toString()}`);
  console.log(`  Total USDC Committed: ${poolAccount.totalUsdcCommitted.toString()}`);
  console.log(`  Registration End Slot: ${poolAccount.registrationEndSlot.toString()}`);

  if (poolAccount.isSettled) {
    console.log("\n⚠️  Lottery has already been settled!");
    process.exit(0);
  }

  // Check if registration period has ended
  const currentSlot = await provider.connection.getSlot();
  console.log(`  Current Slot: ${currentSlot}`);

  if (currentSlot < poolAccount.registrationEndSlot.toNumber()) {
    const slotsRemaining =
      poolAccount.registrationEndSlot.toNumber() - currentSlot;
    const minutesRemaining = Math.ceil((slotsRemaining * 0.4) / 60); // ~400ms per slot
    console.log(
      `\n⚠️  Registration period has not ended yet!`
    );
    console.log(`   Slots remaining: ${slotsRemaining} (~${minutesRemaining} minutes)`);
    console.log(`   Please wait until slot ${poolAccount.registrationEndSlot.toString()}`);
    process.exit(0);
  }

  console.log("\n✓ Registration period has ended. Proceeding with settlement...\n");

  // Settle the lottery
  const tx = await program.methods
    .settle()
    .accounts({
      lotteryPool: lotteryPool,
      authority: authority,
    })
    .rpc();

  console.log(`Transaction: ${tx}\n`);

  // Fetch updated pool state
  const updatedPool = await program.account.lotteryPool.fetch(lotteryPool);

  console.log("✅ Lottery settled successfully!\n");
  console.log("Settlement Results:");
  console.log(`  Settlement Blockhash: ${updatedPool.settlementBlockhash.toString()}`);
  console.log(`  Tokens Allocated: ${updatedPool.tokensAllocated.toString()}`);
  console.log(`  Cutoff Lottery Number: ${updatedPool.cutoffLotteryNumber.toString()}`);
  console.log(`  Final Price: $${(Number(updatedPool.sqrtPrice.toString()) / 10 ** 9) ** 2}`);
  console.log(`  Token Reserve: ${updatedPool.tokenReserve.toString()}`);
  console.log(`  USDC Reserve: ${updatedPool.usdcReserve.toString()}`);

  // Save settlement info
  const settlementInfo = {
    ...deploymentInfo,
    settlementBlockhash: updatedPool.settlementBlockhash.toString(),
    tokensAllocated: updatedPool.tokensAllocated.toString(),
    cutoffLotteryNumber: updatedPool.cutoffLotteryNumber.toString(),
    settledAt: new Date().toISOString(),
    settlementTx: tx,
  };

  fs.writeFileSync(
    "./deployment-x1.json",
    JSON.stringify(settlementInfo, null, 2)
  );

  console.log("\n🎉 Settlement complete!");
  console.log("\n📋 Next Steps:");
  console.log("   1. Winners can now call 'claim' to receive their XNT tokens");
  console.log("   2. Non-winners can call 'claim' to receive their USDC refunds");
}

main()
  .then(() => {
    console.log("\n✨ Settlement script completed successfully");
    process.exit(0);
  })
  .catch((err) => {
    console.error("\n❌ Settlement failed:");
    console.error(err);
    process.exit(1);
  });
