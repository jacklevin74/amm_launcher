import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { LotteryAmm } from "../target/types/lottery_amm";
import { PublicKey, Keypair, SystemProgram, SYSVAR_RECENT_BLOCKHASHES_PUBKEY } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createMint,
  createAccount,
  mintTo,
  getAccount,
} from "@solana/spl-token";
import { assert } from "chai";

describe("Price Discovery Tests", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.LotteryAmm as Program<LotteryAmm>;

  let xntMint: PublicKey;
  let usdcMint: PublicKey;
  let authority: Keypair;
  let lotteryPool: PublicKey;
  let tokenVault: PublicKey;
  let usdcVault: PublicKey;

  const INITIAL_XNT_AMOUNT = 1_000_000_000_000; // 1M tokens (6 decimals)
  const REGISTRATION_DURATION = 100; // 100 slots

  // Price constants matching the program
  const PRECISION = 1_000_000_000;
  const SQRT_PRICE_MIN = 1_000_000_000; // √1
  const SQRT_PRICE_MAX = 1_414_213_562; // √2

  beforeEach(async () => {
    // Create authority keypair
    authority = Keypair.generate();

    // Airdrop SOL to authority
    const airdropSignature = await provider.connection.requestAirdrop(
      authority.publicKey,
      10 * anchor.web3.LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(airdropSignature);

    // Create XNT token mint (6 decimals)
    xntMint = await createMint(
      provider.connection,
      authority,
      authority.publicKey,
      null,
      6
    );

    // Create USDC token mint (6 decimals)
    usdcMint = await createMint(
      provider.connection,
      authority,
      authority.publicKey,
      null,
      6
    );

    // Create token vaults
    tokenVault = await createAccount(
      provider.connection,
      authority,
      xntMint,
      authority.publicKey
    );

    usdcVault = await createAccount(
      provider.connection,
      authority,
      usdcMint,
      authority.publicKey
    );

    // Derive lottery pool PDA
    [lotteryPool] = PublicKey.findProgramAddressSync(
      [Buffer.from("lottery"), authority.publicKey.toBuffer()],
      program.programId
    );

    // Create authority's token account and mint initial supply
    const authorityTokenAccount = await createAccount(
      provider.connection,
      authority,
      xntMint,
      authority.publicKey
    );

    await mintTo(
      provider.connection,
      authority,
      xntMint,
      authorityTokenAccount,
      authority,
      INITIAL_XNT_AMOUNT
    );

    // Initialize lottery pool
    await program.methods
      .initializeLottery(
        new anchor.BN(INITIAL_XNT_AMOUNT),
        new anchor.BN(REGISTRATION_DURATION)
      )
      .accounts({
        lotteryPool,
        authority: authority.publicKey,
        depositorTokenAccount: authorityTokenAccount,
        tokenVault,
        usdcVault,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc();
  });

  async function registerUser(usdcAmount: number): Promise<{ user: Keypair; participant: PublicKey }> {
    const user = Keypair.generate();

    // Airdrop SOL to user
    const airdropSig = await provider.connection.requestAirdrop(
      user.publicKey,
      2 * anchor.web3.LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(airdropSig);

    // Create user's USDC account
    const userUsdcAccount = await createAccount(
      provider.connection,
      user,
      usdcMint,
      user.publicKey
    );

    // Mint USDC to user
    await mintTo(
      provider.connection,
      authority,
      usdcMint,
      userUsdcAccount,
      authority,
      usdcAmount
    );

    // Derive participant PDA
    const [participant] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("participant"),
        lotteryPool.toBuffer(),
        user.publicKey.toBuffer(),
      ],
      program.programId
    );

    // Register
    await program.methods
      .register(new anchor.BN(usdcAmount))
      .accounts({
        lotteryPool,
        participant,
        user: user.publicKey,
        userUsdcAccount,
        usdcVault,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([user])
      .rpc();

    return { user, participant };
  }

  async function settleAndGetPrice(): Promise<{ clearingPrice: number; sqrtPrice: number }> {
    // Wait for settlement slot
    await new Promise((resolve) => setTimeout(resolve, 1000));

    await program.methods
      .settle()
      .accounts({
        lotteryPool,
        usdcVault,
        recentBlockhashes: SYSVAR_RECENT_BLOCKHASHES_PUBKEY,
      })
      .rpc();

    const poolData = await program.account.lotteryPool.fetch(lotteryPool);
    const sqrtPrice = poolData.sqrtPrice.toNumber();
    const clearingPrice = (sqrtPrice * sqrtPrice) / (PRECISION * PRECISION);

    return { clearingPrice, sqrtPrice };
  }

  it("Price discovery: Zero demand → Price stays at $1.00", async () => {
    // Don't register anyone
    const { clearingPrice, sqrtPrice } = await settleAndGetPrice();

    console.log(`  No demand → Clearing price: $${clearingPrice}`);
    console.log(`  sqrt_price: ${sqrtPrice}`);

    assert.equal(sqrtPrice, SQRT_PRICE_MIN, "Price should remain at min");
    assert.equal(clearingPrice, 1, "Clearing price should be $1.00");
  });

  it("Price discovery: Low demand (100K USDC) → Price ~$1.10", async () => {
    const demand = 100_000_000_000; // $100K USDC

    await registerUser(demand);

    const { clearingPrice, sqrtPrice } = await settleAndGetPrice();

    console.log(`  $100K demand → Clearing price: $${clearingPrice.toFixed(6)}`);
    console.log(`  sqrt_price: ${sqrtPrice}`);

    assert.isAbove(clearingPrice, 1.0, "Price should be above $1.00");
    assert.isBelow(clearingPrice, 1.2, "Price should be below $1.20");
  });

  it("Price discovery: Medium demand (500K USDC) → Price ~$1.35", async () => {
    const demand = 500_000_000_000; // $500K USDC

    await registerUser(demand);

    const { clearingPrice, sqrtPrice } = await settleAndGetPrice();

    console.log(`  $500K demand → Clearing price: $${clearingPrice.toFixed(6)}`);
    console.log(`  sqrt_price: ${sqrtPrice}`);

    assert.isAbove(clearingPrice, 1.25, "Price should be above $1.25");
    assert.isBelow(clearingPrice, 1.45, "Price should be below $1.45");
  });

  it("Price discovery: High demand (1M USDC) → Price ~$1.70", async () => {
    const demand = 1_000_000_000_000; // $1M USDC

    await registerUser(demand);

    const { clearingPrice, sqrtPrice } = await settleAndGetPrice();

    console.log(`  $1M demand → Clearing price: $${clearingPrice.toFixed(6)}`);
    console.log(`  sqrt_price: ${sqrtPrice}`);

    assert.isAbove(clearingPrice, 1.5, "Price should be above $1.50");
    assert.isBelow(clearingPrice, 1.9, "Price should be below $1.90");
  });

  it("Price discovery: Maximum demand (>1.414M USDC) → Price caps at $2.00", async () => {
    const demand = 2_000_000_000_000; // $2M USDC (exceeds capacity)

    await registerUser(demand);

    const { clearingPrice, sqrtPrice } = await settleAndGetPrice();

    console.log(`  $2M demand → Clearing price: $${clearingPrice.toFixed(6)}`);
    console.log(`  sqrt_price: ${sqrtPrice}`);

    assert.equal(sqrtPrice, SQRT_PRICE_MAX, "sqrt_price should cap at max");
    assert.approximately(clearingPrice, 2.0, 0.01, "Price should cap at ~$2.00");
  });

  it("Price discovery: Multiple users aggregate demand", async () => {
    // 5 users each requesting $100K
    for (let i = 0; i < 5; i++) {
      await registerUser(100_000_000_000);
    }

    const { clearingPrice, sqrtPrice } = await settleAndGetPrice();

    console.log(`  5 users × $100K = $500K total → Clearing price: $${clearingPrice.toFixed(6)}`);
    console.log(`  sqrt_price: ${sqrtPrice}`);

    // Total demand is $500K, should be similar to single user with $500K
    assert.isAbove(clearingPrice, 1.25, "Price should be above $1.25");
    assert.isBelow(clearingPrice, 1.45, "Price should be below $1.45");
  });

  it("Price discovery: 10 users with varying demand", async () => {
    const demands = [
      50_000_000_000,  // $50K
      100_000_000_000, // $100K
      75_000_000_000,  // $75K
      200_000_000_000, // $200K
      150_000_000_000, // $150K
      80_000_000_000,  // $80K
      120_000_000_000, // $120K
      90_000_000_000,  // $90K
      110_000_000_000, // $110K
      60_000_000_000,  // $60K
    ];

    const totalDemand = demands.reduce((sum, d) => sum + d, 0);
    const totalDemandUSD = totalDemand / 1_000_000;

    for (const demand of demands) {
      await registerUser(demand);
    }

    const { clearingPrice, sqrtPrice } = await settleAndGetPrice();

    console.log(`  10 users, total demand: $${totalDemandUSD.toLocaleString()} → Clearing price: $${clearingPrice.toFixed(6)}`);
    console.log(`  sqrt_price: ${sqrtPrice}`);

    assert.isAbove(clearingPrice, 1.0, "Price should be above $1.00");
    assert.isBelow(clearingPrice, 2.0, "Price should be below $2.00");
  });

  it("Everyone pays same clearing price", async () => {
    const user1Demand = 100_000_000_000; // $100K
    const user2Demand = 500_000_000_000; // $500K

    const { user: user1, participant: participant1 } = await registerUser(user1Demand);
    const { user: user2, participant: participant2 } = await registerUser(user2Demand);

    const { clearingPrice } = await settleAndGetPrice();

    // Create token accounts for claiming
    const user1TokenAccount = await createAccount(
      provider.connection,
      user1,
      xntMint,
      user1.publicKey
    );

    const user2TokenAccount = await createAccount(
      provider.connection,
      user2,
      xntMint,
      user2.publicKey
    );

    const user1UsdcAccount = await createAccount(
      provider.connection,
      user1,
      usdcMint,
      user1.publicKey
    );

    const user2UsdcAccount = await createAccount(
      provider.connection,
      user2,
      usdcMint,
      user2.publicKey
    );

    // User 1 claims
    await program.methods
      .claim()
      .accounts({
        lotteryPool,
        participant: participant1,
        user: user1.publicKey,
        userTokenAccount: user1TokenAccount,
        userUsdcAccount: user1UsdcAccount,
        tokenVault,
        usdcVault,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([user1])
      .rpc();

    // User 2 claims
    await program.methods
      .claim()
      .accounts({
        lotteryPool,
        participant: participant2,
        user: user2.publicKey,
        userTokenAccount: user2TokenAccount,
        userUsdcAccount: user2UsdcAccount,
        tokenVault,
        usdcVault,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([user2])
      .rpc();

    // Fetch participant data
    const participant1Data = await program.account.participantEntry.fetch(participant1);
    const participant2Data = await program.account.participantEntry.fetch(participant2);

    const user1TokensReceived = participant1Data.tokensReceived.toNumber();
    const user2TokensReceived = participant2Data.tokensReceived.toNumber();

    // Calculate effective price each user paid
    const user1Price = user1Demand / user1TokensReceived;
    const user2Price = user2Demand / user2TokensReceived;

    console.log(`  User 1: Paid $${user1Demand / 1_000_000}, got ${user1TokensReceived / 1_000_000} XNT`);
    console.log(`  User 1 effective price: $${user1Price.toFixed(6)}`);
    console.log(`  User 2: Paid $${user2Demand / 1_000_000}, got ${user2TokensReceived / 1_000_000} XNT`);
    console.log(`  User 2 effective price: $${user2Price.toFixed(6)}`);
    console.log(`  Clearing price: $${clearingPrice.toFixed(6)}`);

    // Both users should get same price (within rounding error)
    assert.approximately(user1Price, user2Price, 0.01, "Both users should pay same price");
    assert.approximately(user1Price, clearingPrice, 0.01, "Price should match clearing price");
  });

  it("Token conservation: All USDC converts to tokens at clearing price", async () => {
    // Register multiple users
    const users = [
      await registerUser(100_000_000_000),
      await registerUser(200_000_000_000),
      await registerUser(150_000_000_000),
    ];

    const totalUsdcIn = 450_000_000_000;

    const { clearingPrice } = await settleAndGetPrice();

    // Expected tokens out = total USDC / price
    const expectedTokensOut = totalUsdcIn / clearingPrice;

    let totalTokensClaimed = 0;

    for (const { user, participant } of users) {
      const userTokenAccount = await createAccount(
        provider.connection,
        user,
        xntMint,
        user.publicKey
      );

      const userUsdcAccount = await createAccount(
        provider.connection,
        user,
        usdcMint,
        user.publicKey
      );

      await program.methods
        .claim()
        .accounts({
          lotteryPool,
          participant,
          user: user.publicKey,
          userTokenAccount,
          userUsdcAccount,
          tokenVault,
          usdcVault,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([user])
        .rpc();

      const participantData = await program.account.participantEntry.fetch(participant);
      totalTokensClaimed += participantData.tokensReceived.toNumber();
    }

    console.log(`  Total USDC in: $${totalUsdcIn / 1_000_000}`);
    console.log(`  Clearing price: $${clearingPrice.toFixed(6)}`);
    console.log(`  Expected tokens out: ${(expectedTokensOut / 1_000_000).toFixed(2)} XNT`);
    console.log(`  Actual tokens claimed: ${(totalTokensClaimed / 1_000_000).toFixed(2)} XNT`);

    // Should match within rounding tolerance
    assert.approximately(
      totalTokensClaimed,
      expectedTokensOut,
      expectedTokensOut * 0.01, // 1% tolerance for rounding
      "Total tokens should match expected from clearing price"
    );
  });
});
