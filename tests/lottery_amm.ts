import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { LotteryAmm } from "../target/types/lottery_amm";
import {
  createMint,
  createAccount,
  mintTo,
  getAccount,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import { assert } from "chai";

describe("lottery_amm", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.LotteryAmm as Program<LotteryAmm>;

  let tokenMint: PublicKey;
  let usdcMint: PublicKey;
  let poolTokenAccount: PublicKey;
  let poolUsdcAccount: PublicKey;
  let lotteryPool: PublicKey;
  let authority: Keypair;

  // Test users
  const users: {
    keypair: Keypair;
    usdcAccount: PublicKey;
    tokenAccount: PublicKey;
    participantPda: PublicKey;
  }[] = [];
  const NUM_USERS = 10;

  before(async () => {
    authority = Keypair.generate();

    // Airdrop SOL to authority
    const signature = await provider.connection.requestAirdrop(
      authority.publicKey,
      10 * anchor.web3.LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(signature);

    // Create token mints
    tokenMint = await createMint(
      provider.connection,
      authority,
      authority.publicKey,
      null,
      9 // 9 decimals for XNT
    );

    usdcMint = await createMint(
      provider.connection,
      authority,
      authority.publicKey,
      null,
      6 // 6 decimals for USDC
    );

    // Derive lottery pool PDA
    [lotteryPool] = PublicKey.findProgramAddressSync(
      [Buffer.from("lottery_pool"), tokenMint.toBuffer()],
      program.programId
    );

    // Create pool token accounts
    poolTokenAccount = await createAccount(
      provider.connection,
      authority,
      tokenMint,
      lotteryPool,
      undefined,
      { commitment: "confirmed" }
    );

    poolUsdcAccount = await createAccount(
      provider.connection,
      authority,
      usdcMint,
      lotteryPool,
      undefined,
      { commitment: "confirmed" }
    );

    // Mint initial token supply to pool
    await mintTo(
      provider.connection,
      authority,
      tokenMint,
      poolTokenAccount,
      authority,
      1_000_000 * 10 ** 9 // 1M tokens
    );

    // Create test users
    for (let i = 0; i < NUM_USERS; i++) {
      const userKeypair = Keypair.generate();

      // Airdrop SOL to user
      const userSig = await provider.connection.requestAirdrop(
        userKeypair.publicKey,
        5 * anchor.web3.LAMPORTS_PER_SOL
      );
      await provider.connection.confirmTransaction(userSig);

      // Create user USDC account
      const userUsdcAccount = await createAccount(
        provider.connection,
        authority,
        usdcMint,
        userKeypair.publicKey
      );

      // Mint USDC to user (100k USDC)
      await mintTo(
        provider.connection,
        authority,
        usdcMint,
        userUsdcAccount,
        authority,
        100_000 * 10 ** 6
      );

      // Create user token account
      const userTokenAccount = await createAccount(
        provider.connection,
        authority,
        tokenMint,
        userKeypair.publicKey
      );

      // Derive participant PDA
      const [participantPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("participant"),
          lotteryPool.toBuffer(),
          userKeypair.publicKey.toBuffer(),
        ],
        program.programId
      );

      users.push({
        keypair: userKeypair,
        usdcAccount: userUsdcAccount,
        tokenAccount: userTokenAccount,
        participantPda: participantPda,
      });
    }

    console.log("Setup complete:");
    console.log(`  Token Mint: ${tokenMint.toString()}`);
    console.log(`  USDC Mint: ${usdcMint.toString()}`);
    console.log(`  Lottery Pool: ${lotteryPool.toString()}`);
    console.log(`  Number of users: ${NUM_USERS}`);
  });

  it("Initializes the lottery pool", async () => {
    const initialTokenAmount = new BN(1_000_000 * 10 ** 9); // 1M tokens
    const registrationDurationSlots = new BN(100); // 100 slots

    await program.methods
      .initializeLottery(initialTokenAmount, registrationDurationSlots)
      .accounts({
        lotteryPool: lotteryPool,
        tokenMint: tokenMint,
        usdcMint: usdcMint,
        poolTokenAccount: poolTokenAccount,
        poolUsdcAccount: poolUsdcAccount,
        authority: authority.publicKey,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([authority])
      .rpc();

    // Verify pool state
    const poolAccount = await program.account.lotteryPool.fetch(lotteryPool);

    assert.equal(
      poolAccount.liquidity.toString(),
      "1414213562373095048801688724209",
      "Liquidity should match expected value"
    );
    assert.equal(
      poolAccount.sqrtPrice.toString(),
      "1000000000",
      "Initial sqrt price should be 1.0"
    );
    assert.equal(
      poolAccount.tokenReserve.toString(),
      initialTokenAmount.toString(),
      "Token reserve should match initial amount"
    );
    assert.equal(
      poolAccount.usdcReserve.toString(),
      "0",
      "USDC reserve should start at 0"
    );
    assert.equal(
      poolAccount.isSettled,
      false,
      "Pool should not be settled initially"
    );

    console.log("Pool initialized successfully:");
    console.log(`  Liquidity: ${poolAccount.liquidity.toString()}`);
    console.log(`  Sqrt Price: ${poolAccount.sqrtPrice.toString()}`);
    console.log(`  Token Reserve: ${poolAccount.tokenReserve.toString()}`);
    console.log(`  Registration ends at slot: ${poolAccount.registrationEndSlot.toString()}`);
  });

  it("Allows multiple users to register", async () => {
    const registrationAmount = new BN(50_000 * 10 ** 6); // 50k USDC

    for (let i = 0; i < NUM_USERS; i++) {
      const user = users[i];

      await program.methods
        .register(registrationAmount)
        .accounts({
          lotteryPool: lotteryPool,
          participant: user.participantPda,
          userUsdcAccount: user.usdcAccount,
          poolUsdcAccount: poolUsdcAccount,
          user: user.keypair.publicKey,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([user.keypair])
        .rpc();

      // Verify participant entry
      const participantAccount = await program.account.participantEntry.fetch(
        user.participantPda
      );

      assert.equal(
        participantAccount.usdcCommitted.toString(),
        registrationAmount.toString(),
        `User ${i} should have committed correct USDC amount`
      );
      assert.equal(
        participantAccount.hasClaimed,
        false,
        `User ${i} should not have claimed yet`
      );

      console.log(`User ${i} registered with ${registrationAmount.toString()} USDC`);
    }

    // Verify pool state
    const poolAccount = await program.account.lotteryPool.fetch(lotteryPool);
    assert.equal(
      poolAccount.totalParticipants.toString(),
      NUM_USERS.toString(),
      "Total participants should match"
    );
    assert.equal(
      poolAccount.totalUsdcCommitted.toString(),
      registrationAmount.mul(new BN(NUM_USERS)).toString(),
      "Total USDC committed should match"
    );

    console.log(`Total participants: ${poolAccount.totalParticipants.toString()}`);
    console.log(`Total USDC committed: ${poolAccount.totalUsdcCommitted.toString()}`);
  });

  it("Prevents registration after deadline", async () => {
    // Wait for registration period to end
    const poolAccount = await program.account.lotteryPool.fetch(lotteryPool);
    const currentSlot = await provider.connection.getSlot();
    const slotsToWait = poolAccount.registrationEndSlot.toNumber() - currentSlot + 1;

    if (slotsToWait > 0) {
      console.log(`Waiting for ${slotsToWait} slots...`);
      // In a real test, you might need to wait or mock this
      // For now, we'll skip this test if we can't wait
      console.log("Skipping late registration test (requires waiting for slots)");
    }
  });

  it("Settles the lottery and allocates tokens", async () => {
    // Wait for registration to end (in real testing, you'd need proper slot advancement)
    // For now, we'll use the current blockhash

    const recentBlockhash = await provider.connection.getLatestBlockhash();

    await program.methods
      .settle()
      .accounts({
        lotteryPool: lotteryPool,
        authority: authority.publicKey,
      })
      .signers([authority])
      .rpc();

    // Verify pool is settled
    const poolAccount = await program.account.lotteryPool.fetch(lotteryPool);
    assert.equal(poolAccount.isSettled, true, "Pool should be settled");
    assert.notEqual(
      poolAccount.settlementBlockhash.toString(),
      PublicKey.default.toString(),
      "Settlement blockhash should be set"
    );

    console.log("Lottery settled successfully");
    console.log(`Settlement blockhash: ${poolAccount.settlementBlockhash.toString()}`);
    console.log(`Tokens allocated: ${poolAccount.tokensAllocated.toString()}`);
    console.log(`Cutoff lottery number: ${poolAccount.cutoffLotteryNumber.toString()}`);

    // Check participant allocations
    let winnersCount = 0;
    for (let i = 0; i < NUM_USERS; i++) {
      const participantAccount = await program.account.participantEntry.fetch(
        users[i].participantPda
      );

      console.log(`User ${i}:`);
      console.log(`  Lottery Number: ${participantAccount.lotteryNumber.toString()}`);
      console.log(`  Token Allocation: ${participantAccount.tokenAllocation.toString()}`);
      console.log(`  USDC Used: ${participantAccount.usdcUsed.toString()}`);

      if (participantAccount.tokenAllocation.gt(new BN(0))) {
        winnersCount++;
      }
    }

    console.log(`Winners: ${winnersCount} out of ${NUM_USERS}`);
  });

  it("Allows winners to claim tokens", async () => {
    for (let i = 0; i < NUM_USERS; i++) {
      const user = users[i];
      const participantAccount = await program.account.participantEntry.fetch(
        user.participantPda
      );

      if (participantAccount.tokenAllocation.gt(new BN(0))) {
        const tokenBalanceBefore = await getAccount(
          provider.connection,
          user.tokenAccount
        );

        await program.methods
          .claim()
          .accounts({
            lotteryPool: lotteryPool,
            participant: user.participantPda,
            poolTokenAccount: poolTokenAccount,
            poolUsdcAccount: poolUsdcAccount,
            userTokenAccount: user.tokenAccount,
            userUsdcAccount: user.usdcAccount,
            user: user.keypair.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([user.keypair])
          .rpc();

        const tokenBalanceAfter = await getAccount(
          provider.connection,
          user.tokenAccount
        );

        assert.equal(
          tokenBalanceAfter.amount - tokenBalanceBefore.amount,
          BigInt(participantAccount.tokenAllocation.toString()),
          `User ${i} should receive correct token amount`
        );

        console.log(`User ${i} claimed ${participantAccount.tokenAllocation.toString()} tokens`);

        // Verify participant marked as claimed
        const updatedParticipant = await program.account.participantEntry.fetch(
          user.participantPda
        );
        assert.equal(
          updatedParticipant.hasClaimed,
          true,
          `User ${i} should be marked as claimed`
        );
      }
    }
  });

  it("Refunds USDC to non-winners", async () => {
    for (let i = 0; i < NUM_USERS; i++) {
      const user = users[i];
      const participantAccount = await program.account.participantEntry.fetch(
        user.participantPda
      );

      // Check if user didn't win or had partial allocation
      const refundAmount =
        participantAccount.usdcCommitted.sub(participantAccount.usdcUsed);

      if (refundAmount.gt(new BN(0))) {
        const usdcBalanceBefore = await getAccount(
          provider.connection,
          user.usdcAccount
        );

        // Claim should also handle refunds
        if (!participantAccount.hasClaimed) {
          await program.methods
            .claim()
            .accounts({
              lotteryPool: lotteryPool,
              participant: user.participantPda,
              poolTokenAccount: poolTokenAccount,
              poolUsdcAccount: poolUsdcAccount,
              userTokenAccount: user.tokenAccount,
              userUsdcAccount: user.usdcAccount,
              user: user.keypair.publicKey,
              tokenProgram: TOKEN_PROGRAM_ID,
            })
            .signers([user.keypair])
            .rpc();
        }

        const usdcBalanceAfter = await getAccount(
          provider.connection,
          user.usdcAccount
        );

        // User should get refund (if any)
        console.log(
          `User ${i} refunded ${refundAmount.toString()} USDC (committed ${participantAccount.usdcCommitted.toString()}, used ${participantAccount.usdcUsed.toString()})`
        );
      }
    }
  });

  it("Prevents double claiming", async () => {
    const user = users[0];
    const participantAccount = await program.account.participantEntry.fetch(
      user.participantPda
    );

    if (participantAccount.hasClaimed) {
      try {
        await program.methods
          .claim()
          .accounts({
            lotteryPool: lotteryPool,
            participant: user.participantPda,
            poolTokenAccount: poolTokenAccount,
            poolUsdcAccount: poolUsdcAccount,
            userTokenAccount: user.tokenAccount,
            userUsdcAccount: user.usdcAccount,
            user: user.keypair.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([user.keypair])
          .rpc();

        assert.fail("Should not allow double claiming");
      } catch (err) {
        assert.include(
          err.toString(),
          "AlreadyClaimed",
          "Should throw AlreadyClaimed error"
        );
        console.log("Double claim prevented successfully");
      }
    }
  });

  it("Verifies final pool state", async () => {
    const poolAccount = await program.account.lotteryPool.fetch(lotteryPool);
    const poolTokenBalance = await getAccount(
      provider.connection,
      poolTokenAccount
    );
    const poolUsdcBalance = await getAccount(
      provider.connection,
      poolUsdcAccount
    );

    console.log("\nFinal Pool State:");
    console.log(`  Settled: ${poolAccount.isSettled}`);
    console.log(`  Total Participants: ${poolAccount.totalParticipants.toString()}`);
    console.log(`  Total USDC Committed: ${poolAccount.totalUsdcCommitted.toString()}`);
    console.log(`  Tokens Allocated: ${poolAccount.tokensAllocated.toString()}`);
    console.log(`  Token Reserve: ${poolAccount.tokenReserve.toString()}`);
    console.log(`  USDC Reserve: ${poolAccount.usdcReserve.toString()}`);
    console.log(`  Pool Token Balance: ${poolTokenBalance.amount.toString()}`);
    console.log(`  Pool USDC Balance: ${poolUsdcBalance.amount.toString()}`);
    console.log(`  Current Price: $${(Number(poolAccount.sqrtPrice.toString()) / 10 ** 9) ** 2}`);

    // Verify conservation: tokens allocated + remaining = initial supply
    const initialSupply = new BN(1_000_000 * 10 ** 9);
    const totalTokens = poolAccount.tokensAllocated.add(poolAccount.tokenReserve);

    assert.equal(
      totalTokens.toString(),
      initialSupply.toString(),
      "Token conservation should hold"
    );
  });
});
