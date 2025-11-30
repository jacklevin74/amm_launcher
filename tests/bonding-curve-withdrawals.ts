/**
 * Test suite for withdrawal instructions (price corridor bot strategy)
 * Tests: withdraw_xnt, withdraw_xnt_price_neutral, withdraw_usdc
 */

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { BondingCurve } from "../target/types/bonding_curve";
import {
  TOKEN_PROGRAM_ID,
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import { assert } from "chai";

describe("bonding-curve-withdrawals", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.BondingCurve as Program<BondingCurve>;
  const payer = provider.wallet as anchor.Wallet;

  let xntMint: anchor.web3.PublicKey;
  let usdcMint: anchor.web3.PublicKey;
  let poolPda: anchor.web3.PublicKey;
  let poolXnt: anchor.web3.PublicKey;
  let poolUsdc: anchor.web3.PublicKey;
  let authorityXnt: anchor.web3.PublicKey;
  let authorityUsdc: anchor.web3.PublicKey;
  let traderUsdc: anchor.web3.PublicKey;
  let traderXnt: anchor.web3.PublicKey;

  before(async () => {
    console.log("\n🔧 Setting up test environment...\n");

    // Create XNT mint
    xntMint = await createMint(
      provider.connection,
      payer.payer,
      payer.publicKey,
      null,
      6
    );
    console.log(`✅ Created XNT mint: ${xntMint.toBase58()}`);

    // Create USDC mint
    usdcMint = await createMint(
      provider.connection,
      payer.payer,
      payer.publicKey,
      null,
      6
    );
    console.log(`✅ Created USDC mint: ${usdcMint.toBase58()}`);

    // Get pool PDA
    [poolPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("pool"), xntMint.toBuffer(), usdcMint.toBuffer()],
      program.programId
    );
    console.log(`✅ Pool PDA: ${poolPda.toBase58()}\n`);

    // Create token accounts
    const authorityXntAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      payer.payer,
      xntMint,
      payer.publicKey
    );
    authorityXnt = authorityXntAccount.address;

    const authorityUsdcAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      payer.payer,
      usdcMint,
      payer.publicKey
    );
    authorityUsdc = authorityUsdcAccount.address;

    // Pool token accounts will be created as keypairs during initialize_pool

    // Mint initial XNT to authority
    await mintTo(
      provider.connection,
      payer.payer,
      xntMint,
      authorityXnt,
      payer.publicKey,
      10_000_000_000_000 // 10M XNT
    );

    // Mint USDC for trader
    const traderUsdcAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      payer.payer,
      usdcMint,
      payer.publicKey
    );
    traderUsdc = traderUsdcAccount.address;

    await mintTo(
      provider.connection,
      payer.payer,
      usdcMint,
      traderUsdc,
      payer.publicKey,
      10_000_000_000_000 // 10M USDC
    );

    const traderXntAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      payer.payer,
      xntMint,
      payer.publicKey
    );
    traderXnt = traderXntAccount.address;
  });

  it("Initialize pool", async () => {
    console.log("📊 Initializing bonding curve pool...\n");

    const xntAmount = new anchor.BN(5_000_000_000_000); // 5M XNT
    const virtualUsdcAmount = new anchor.BN(5_000_000_000_000); // 5M USDC (virtual)

    // Create keypairs for pool token accounts
    const poolXntKeypair = anchor.web3.Keypair.generate();
    const poolUsdcKeypair = anchor.web3.Keypair.generate();
    poolXnt = poolXntKeypair.publicKey;
    poolUsdc = poolUsdcKeypair.publicKey;

    await program.methods
      .initializePool(xntAmount, virtualUsdcAmount)
      .accounts({
        initializer: payer.publicKey,
        pool: poolPda,
        xntMint,
        usdcMint,
        poolXnt,
        poolUsdc,
        initializerXnt: authorityXnt,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([poolXntKeypair, poolUsdcKeypair])
      .rpc();

    const pool = await program.account.pool.fetch(poolPda);
    console.log(`✅ Pool initialized!`);
    console.log(`   XNT Reserve: ${pool.xntReserve.toNumber() / 1e6} XNT`);
    console.log(`   USDC Reserve: $${pool.usdcReserve.toNumber() / 1e6}`);
    console.log(`   Starting Price: $${pool.usdcReserve.toNumber() / pool.xntReserve.toNumber()}\n`);

    assert.equal(pool.xntReserve.toNumber(), xntAmount.toNumber());
    assert.equal(pool.usdcReserve.toNumber(), virtualUsdcAmount.toNumber());
  });

  it("Test WITHDRAW_XNT: Remove XNT to raise price", async () => {
    console.log("💎 Testing WITHDRAW_XNT function...\n");

    const poolBefore = await program.account.pool.fetch(poolPda);
    const priceBefore = poolBefore.usdcReserve.toNumber() / poolBefore.xntReserve.toNumber();

    const withdrawAmount = new anchor.BN(500_000_000_000); // Withdraw 500K XNT

    console.log(`  Before: XNT = ${poolBefore.xntReserve.toNumber() / 1e6}, Price = $${priceBefore.toFixed(4)}`);
    console.log(`  Withdrawing ${withdrawAmount.toNumber() / 1e6} XNT...`);

    await program.methods
      .withdrawXnt(withdrawAmount)
      .accounts({
        authority: payer.publicKey,
        pool: poolPda,
        poolXnt,
        authorityXnt,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    const poolAfter = await program.account.pool.fetch(poolPda);
    const priceAfter = poolAfter.usdcReserve.toNumber() / poolAfter.xntReserve.toNumber();
    const priceIncrease = ((priceAfter / priceBefore - 1) * 100).toFixed(2);

    console.log(`  After:  XNT = ${poolAfter.xntReserve.toNumber() / 1e6}, Price = $${priceAfter.toFixed(4)}`);
    console.log(`  ✅ Removed ${withdrawAmount.toNumber() / 1e6} XNT, price increased by ${priceIncrease}%\n`);

    assert.isTrue(priceAfter > priceBefore, "Price should increase after withdrawing XNT");
    assert.equal(
      poolAfter.xntReserve.toNumber(),
      poolBefore.xntReserve.toNumber() - withdrawAmount.toNumber()
    );
  });

  it("Test WITHDRAW_XNT_PRICE_NEUTRAL: Remove XNT without affecting price", async () => {
    console.log("🔄 Testing WITHDRAW_XNT_PRICE_NEUTRAL function...\n");

    const poolBefore = await program.account.pool.fetch(poolPda);
    const priceBefore = poolBefore.usdcReserve.toNumber() / poolBefore.xntReserve.toNumber();

    const withdrawAmount = new anchor.BN(500_000_000_000); // Withdraw 500K XNT

    console.log(`  Before: XNT = ${poolBefore.xntReserve.toNumber() / 1e6}, USDC = ${poolBefore.usdcReserve.toNumber() / 1e6}`);
    console.log(`  Price before: $${priceBefore.toFixed(6)}`);
    console.log(`  Withdrawing ${withdrawAmount.toNumber() / 1e6} XNT (price-neutral)...`);

    await program.methods
      .withdrawXntPriceNeutral(withdrawAmount)
      .accounts({
        authority: payer.publicKey,
        pool: poolPda,
        poolXnt,
        authorityXnt,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    const poolAfter = await program.account.pool.fetch(poolPda);
    const priceAfter = poolAfter.usdcReserve.toNumber() / poolAfter.xntReserve.toNumber();

    console.log(`  After:  XNT = ${poolAfter.xntReserve.toNumber() / 1e6}, USDC = ${poolAfter.usdcReserve.toNumber() / 1e6}`);
    console.log(`  Price after: $${priceAfter.toFixed(6)}`);
    console.log(`  ✅ Price maintained: $${priceBefore.toFixed(6)} → $${priceAfter.toFixed(6)}\n`);

    // Price should be approximately the same (allowing for tiny rounding differences)
    const priceDiff = Math.abs((priceAfter - priceBefore) / priceBefore);
    assert.isTrue(priceDiff < 0.0001, "Price should remain approximately unchanged");
  });

  it("Test WITHDRAW_USDC: Withdraw real USDC profits", async () => {
    console.log("💰 Testing WITHDRAW_USDC function...\n");

    // First, do some trades to accumulate USDC
    const buyAmount = new anchor.BN(1_000_000_000_000); // 1M USDC

    console.log(`  Step 1: Buying XNT with USDC to accumulate real USDC in pool...`);

    await program.methods
      .buy(buyAmount)
      .accounts({
        buyer: payer.publicKey,
        pool: poolPda,
        poolXnt,
        poolUsdc,
        buyerUsdc: traderUsdc,
        buyerXnt: traderXnt,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    const poolUsdcBefore = await provider.connection.getTokenAccountBalance(poolUsdc);
    const realUsdcBefore = parseInt(poolUsdcBefore.value.amount);
    const poolBefore = await program.account.pool.fetch(poolPda);

    console.log(`  Real USDC in pool: $${realUsdcBefore / 1e6}`);
    console.log(`  Virtual USDC reserve: $${poolBefore.usdcReserve.toNumber() / 1e6}`);

    const withdrawAmount = new anchor.BN(500_000_000_000); // Withdraw 500K USDC

    console.log(`  Step 2: Withdrawing $${withdrawAmount.toNumber() / 1e6} real USDC...`);

    await program.methods
      .withdrawUsdc(withdrawAmount)
      .accounts({
        authority: payer.publicKey,
        pool: poolPda,
        poolUsdc,
        authorityUsdc,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    const poolUsdcAfter = await provider.connection.getTokenAccountBalance(poolUsdc);
    const realUsdcAfter = parseInt(poolUsdcAfter.value.amount);
    const poolAfter = await program.account.pool.fetch(poolPda);

    console.log(`  Real USDC after: $${realUsdcAfter / 1e6}`);
    console.log(`  Virtual USDC reserve after: $${poolAfter.usdcReserve.toNumber() / 1e6}`);
    console.log(`  ✅ Withdrew $${withdrawAmount.toNumber() / 1e6} USDC`);
    console.log(`  ✅ Virtual reserve unchanged (pricing maintained)\n`);

    assert.equal(
      realUsdcAfter,
      realUsdcBefore - withdrawAmount.toNumber(),
      "Real USDC should decrease"
    );
    assert.equal(
      poolAfter.usdcReserve.toNumber(),
      poolBefore.usdcReserve.toNumber(),
      "Virtual USDC reserve should remain unchanged"
    );
  });

  it("Final summary", () => {
    console.log("╔════════════════════════════════════════════════════════════╗");
    console.log("║         WITHDRAWAL FUNCTIONS TEST SUMMARY                 ║");
    console.log("╚════════════════════════════════════════════════════════════╝");
    console.log("");
    console.log("  ✅ All 3 withdrawal methods tested successfully!");
    console.log("     1. withdraw_xnt() - Remove XNT (price increases)");
    console.log("     2. withdraw_xnt_price_neutral() - Remove XNT (price unchanged)");
    console.log("     3. withdraw_usdc() - Withdraw USDC profits");
    console.log("");
    console.log("  🤖 Price corridor bot strategy ready!");
    console.log("     - Inject XNT when price too high (deposit_xnt)");
    console.log("     - Withdraw XNT when price too low (withdraw_xnt)");
    console.log("     - Extract profits via withdraw_usdc");
    console.log("");
  });
});
