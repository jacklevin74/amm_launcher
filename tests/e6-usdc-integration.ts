import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { BondingCurve } from "../target/types/bonding_curve";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getAccount,
  TOKEN_PROGRAM_ID,
  NATIVE_MINT,
} from "@solana/spl-token";
import { assert, expect } from "chai";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";

/**
 * E6 USDC Integration Tests
 *
 * Tests that the Rust implementation correctly handles e6 USDC normalization
 * and matches the behavior validated in e6-usdc-simulation.test.ts
 */
describe("E6 USDC Integration", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.BondingCurve as Program<BondingCurve>;
  const payer = provider.wallet as anchor.Wallet;

  let usdcMint: anchor.web3.PublicKey;
  let poolPda: anchor.web3.PublicKey;
  let poolXnt: anchor.web3.PublicKey;
  let poolUsdc: anchor.web3.PublicKey;
  let traderXnt: anchor.web3.PublicKey;
  let traderUsdc: anchor.web3.PublicKey;
  let ceilingReservePda: anchor.web3.PublicKey;
  let ceilingReserveXnt: anchor.web3.PublicKey;

  // Use e6 decimals for USDC (standard)
  const USDC_DECIMALS = 6;
  const XNT_DECIMALS = 9; // wSOL native mint

  const INITIAL_XNT = 100_000 * 10 ** XNT_DECIMALS; // 100K XNT (reduced for validator balance)
  const VIRTUAL_USDC = 100_000 * 10 ** USDC_DECIMALS; // 100K USDC (e6!)
  const CEILING_RESERVE_XNT = 300_000 * 10 ** XNT_DECIMALS; // 300K XNT reserve (for ceiling defense)
  const PRICE_CEILING = 2_000_000; // $2.00 (e6 precision)
  const PRICE_FLOOR = 1_000_000; // $1.00 (e6 precision)

  before("Setup pool with e6 USDC", async () => {
    console.log("\n🔧 Setting up E6 USDC integration test environment...\n");

    // Create USDC mint with 6 decimals (standard)
    usdcMint = await createMint(
      provider.connection,
      payer.payer,
      payer.publicKey,
      null,
      USDC_DECIMALS
    );
    console.log(`✅ Created USDC mint (e6): ${usdcMint.toBase58()}`);
    console.log(`   Decimals: ${USDC_DECIMALS}`);

    // XNT = Native SOL mint (wSOL, 9 decimals)
    console.log(`✅ Using native SOL mint for XNT: ${NATIVE_MINT.toBase58()}`);
    console.log(`   Decimals: ${XNT_DECIMALS}`);

    // Derive pool PDA
    [poolPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("pool"), NATIVE_MINT.toBuffer(), usdcMint.toBuffer()],
      program.programId
    );
    console.log(`📍 Pool PDA: ${poolPda.toBase58()}`);

    // Derive ceiling reserve PDA
    [ceilingReservePda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("ceiling_reserve"), poolPda.toBuffer()],
      program.programId
    );

    // Create keypairs for token accounts
    const poolXntKeypair = anchor.web3.Keypair.generate();
    const poolUsdcKeypair = anchor.web3.Keypair.generate();
    const ceilingReserveXntKeypair = anchor.web3.Keypair.generate();

    poolXnt = poolXntKeypair.publicKey;
    poolUsdc = poolUsdcKeypair.publicKey;
    ceilingReserveXnt = ceilingReserveXntKeypair.publicKey;

    // Create trader token accounts
    traderXnt = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      payer.payer,
      NATIVE_MINT,
      payer.publicKey
    ).then((account) => account.address);

    traderUsdc = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      payer.payer,
      usdcMint,
      payer.publicKey
    ).then((account) => account.address);

    // Mint USDC to trader (e6 decimals)
    await mintTo(
      provider.connection,
      payer.payer,
      usdcMint,
      traderUsdc,
      payer.publicKey,
      10_000_000 * 10 ** USDC_DECIMALS // 10M USDC
    );
    console.log(`✅ Minted 10M USDC (e6) to trader`);

    // Wrap SOL to wSOL for initialization
    const { Transaction: SolTransaction, SystemProgram } = await import("@solana/web3.js");
    const { createSyncNativeInstruction: syncNative } = await import("@solana/spl-token");
    const wrapTx = new SolTransaction().add(
      SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: traderXnt,
        lamports: INITIAL_XNT,
      }),
      syncNative(traderXnt)
    );
    await provider.sendAndConfirm(wrapTx);

    // Initialize pool
    await program.methods
      .initializePool(
        new anchor.BN(INITIAL_XNT.toString()),
        new anchor.BN(VIRTUAL_USDC.toString()),
        true, // price_floor_enabled
        new anchor.BN(PRICE_CEILING),
        new anchor.BN(PRICE_FLOOR)
      )
      .accounts({
        initializer: payer.publicKey,
        pool: poolPda,
        xntMint: NATIVE_MINT,
        usdcMint: usdcMint,
        poolXnt: poolXnt,
        poolUsdc: poolUsdc,
        initializerXnt: traderXnt,
        ceilingReservePda: ceilingReservePda,
        ceilingReserveXnt: ceilingReserveXnt,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([poolXntKeypair, poolUsdcKeypair, ceilingReserveXntKeypair])
      .rpc();

    console.log(`✅ Pool initialized with e6 USDC`);
    console.log(`   XNT Reserve: ${INITIAL_XNT / 10 ** XNT_DECIMALS}M (e9)`);
    console.log(`   USDC Reserve: ${VIRTUAL_USDC / 10 ** USDC_DECIMALS}M (e6)`);
    console.log(`   Initial Price: $1.00`);

    // Fund ceiling reserve (wrap SOL to wSOL)
    const poolBeforeFunding = await program.account.pool.fetch(poolPda);

    // Wrap more SOL for ceiling reserve funding
    const wrapReserveTx = new SolTransaction().add(
      SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: traderXnt,
        lamports: CEILING_RESERVE_XNT,
      }),
      syncNative(traderXnt)
    );
    await provider.sendAndConfirm(wrapReserveTx);

    await program.methods
      .fundCeilingReserve(new anchor.BN(CEILING_RESERVE_XNT.toString()))
      .accountsPartial({
        authority: payer.publicKey,
        pool: poolPda,
        authorityXnt: traderXnt,
        ceilingReserveXnt: poolBeforeFunding.ceilingReserveXnt,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    console.log(`✅ Funded ceiling reserve with ${CEILING_RESERVE_XNT / 10 ** XNT_DECIMALS}M wSOL\n`);
  });

  it("validates 1:1 exchange ratio with e6 USDC at $1.00 price", async () => {
    console.log("\n💱 Test: 1:1 Exchange Ratio (e6 USDC)\n");

    const poolBefore = await program.account.pool.fetch(poolPda);
    const usdcAmount = 1_000 * 10 ** USDC_DECIMALS; // 1,000 USDC (e6)

    // Buy XNT with USDC
    await program.methods
      .buy(new anchor.BN(usdcAmount))
      .accounts({
        pool: poolPda,
        poolXnt: poolXnt,
        poolUsdc: poolUsdc,
        ceilingReservePda: ceilingReservePda,
        ceilingReserveXnt: ceilingReserveXnt,
        xntMint: NATIVE_MINT,
        usdcMint: usdcMint,
        buyer: payer.publicKey,
        buyerXnt: traderXnt,
        buyerUsdc: traderUsdc,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([])
      .rpc();

    const poolAfter = await program.account.pool.fetch(poolPda);
    const traderXntAccount = await getAccount(provider.connection, traderXnt);

    // Calculate amounts (note: USDC reserve is stored normalized to e9 internally)
    const usdcSpentE9 = Number(poolAfter.usdcReserve) - Number(poolBefore.usdcReserve);
    const xntReceived = Number(poolBefore.xntReserve) - Number(poolAfter.xntReserve);

    console.log(`USDC spent (e9 normalized): ${usdcSpentE9 / 10 ** XNT_DECIMALS}`);
    console.log(`XNT received (e9): ${xntReceived / 10 ** XNT_DECIMALS}`);
    console.log(`Ratio: ${xntReceived / usdcSpentE9}`);

    // Should be approximately 1:1 ratio (both in e9)
    const ratio = xntReceived / usdcSpentE9;
    expect(ratio).to.be.closeTo(1.0, 0.01); // 1:1 ratio with small slippage tolerance
  });

  it("correctly normalizes e6 USDC to e9 internally", async () => {
    console.log("\n🔄 Test: E6 to E9 Normalization\n");

    const pool = await program.account.pool.fetch(poolPda);

    // USDC reserve is stored in e9 format (normalized from e6)
    const usdcReserveE9 = Number(pool.usdcReserve);
    console.log(`USDC Reserve (raw e9): ${usdcReserveE9}`);
    console.log(`USDC Reserve (formatted): ${usdcReserveE9 / 10 ** XNT_DECIMALS} USDC`);

    // Verify USDC is in e9 range (normalized)
    expect(usdcReserveE9).to.be.greaterThan(10 ** XNT_DECIMALS); // Should be in e9 range
  });

  it("validates price calculation with e6 USDC", async () => {
    console.log("\n💰 Test: Price Calculation (e6 USDC)\n");

    const pool = await program.account.pool.fetch(poolPda);

    // Both USDC and XNT reserves are in e9 (USDC is normalized)
    const usdcReserveE9 = Number(pool.usdcReserve);
    const xntReserveE9 = Number(pool.xntReserve);

    // Price = USDC / XNT (both in e9, so ratio is directly the price)
    const price = usdcReserveE9 / xntReserveE9;
    console.log(`USDC Reserve (e9): ${usdcReserveE9}`);
    console.log(`XNT Reserve (e9): ${xntReserveE9}`);
    console.log(`Price: $${price.toFixed(6)}`);

    // Price should be close to $1.00 (with some slippage from previous test)
    expect(price).to.be.closeTo(1.0, 0.1);
  });

  it("handles small trades with e6 precision (dust)", async () => {
    console.log("\n🔬 Test: Dust Amounts (e6 precision)\n");

    // Buy with minimum USDC amount (1 microUSDC = 0.000001 USDC)
    const usdcAmount = 1; // 1 unit = 0.000001 USDC in e6

    try {
      await program.methods
        .buy(new anchor.BN(usdcAmount))
        .accounts({
          pool: poolPda,
          poolXnt: poolXnt,
          poolUsdc: poolUsdc,
          ceilingReservePda: ceilingReservePda,
          ceilingReserveXnt: ceilingReserveXnt,
          xntMint: NATIVE_MINT,
          usdcMint: usdcMint,
          buyer: payer.publicKey,
          buyerXnt: traderXnt,
          buyerUsdc: traderUsdc,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([])
        .rpc();

      console.log(`✅ Successfully handled dust amount: 0.000001 USDC`);
    } catch (error) {
      console.log(`⚠️  Dust amount rejected (expected for very small amounts): ${error.message}`);
    }
  });

  it("validates constant product invariant with e6 USDC", async () => {
    console.log("\n📐 Test: Constant Product Invariant (e6 USDC)\n");

    const poolBefore = await program.account.pool.fetch(poolPda);
    const kBefore = Number(poolBefore.xntReserve) * Number(poolBefore.usdcReserve);

    // Do a trade
    const usdcAmount = 100 * 10 ** USDC_DECIMALS; // 100 USDC

    await program.methods
      .buy(new anchor.BN(usdcAmount))
      .accounts({
        pool: poolPda,
        poolXnt: poolXnt,
        poolUsdc: poolUsdc,
        ceilingReservePda: ceilingReservePda,
        ceilingReserveXnt: ceilingReserveXnt,
        xntMint: NATIVE_MINT,
        usdcMint: usdcMint,
        buyer: payer.publicKey,
        buyerXnt: traderXnt,
        buyerUsdc: traderUsdc,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([])
      .rpc();

    const poolAfter = await program.account.pool.fetch(poolPda);
    const kAfter = Number(poolAfter.xntReserve) * Number(poolAfter.usdcReserve);

    console.log(`K before: ${kBefore}`);
    console.log(`K after: ${kAfter}`);
    console.log(`K change: ${((kAfter - kBefore) / kBefore * 100).toFixed(6)}%`);

    // K should be approximately constant (within 0.01% for rounding)
    const kDiff = Math.abs(kAfter - kBefore);
    const tolerance = kBefore * 0.0001; // 0.01%
    expect(kDiff).to.be.lessThan(tolerance);
  });

  it("executes sell operation (XNT → USDC)", async () => {
    console.log("\n📉 Test: Sell XNT for USDC\n");

    const poolBefore = await program.account.pool.fetch(poolPda);
    const xntAmount = 1_000 * 10 ** XNT_DECIMALS; // 1,000 XNT

    // Sell XNT for USDC
    await program.methods
      .sell(new anchor.BN(xntAmount))
      .accounts({
        seller: payer.publicKey,
        pool: poolPda,
        xntMint: NATIVE_MINT,
        usdcMint: usdcMint,
        poolXnt: poolXnt,
        poolUsdc: poolUsdc,
        sellerXnt: traderXnt,
        sellerUsdc: traderUsdc,
        ceilingReservePda: ceilingReservePda,
        ceilingReserveXnt: ceilingReserveXnt,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([])
      .rpc();

    const poolAfter = await program.account.pool.fetch(poolPda);
    const traderUsdcAccount = await getAccount(provider.connection, traderUsdc);

    // Calculate amounts (USDC reserve is in e9 internally)
    const usdcReceivedE9 = Number(poolBefore.usdcReserve) - Number(poolAfter.usdcReserve);
    const xntSpent = Number(poolAfter.xntReserve) - Number(poolBefore.xntReserve);

    console.log(`XNT spent (e9): ${xntSpent / 10 ** XNT_DECIMALS}`);
    console.log(`USDC received (e9 normalized): ${usdcReceivedE9 / 10 ** XNT_DECIMALS}`);
    console.log(`Ratio: ${usdcReceivedE9 / xntSpent}`);

    // Should be approximately 1:1 ratio (both in e9)
    const ratio = usdcReceivedE9 / xntSpent;
    expect(ratio).to.be.closeTo(1.0, 0.01);

    // XNT reserve should increase
    expect(Number(poolAfter.xntReserve)).to.be.greaterThan(Number(poolBefore.xntReserve));

    // USDC reserve should decrease
    expect(Number(poolAfter.usdcReserve)).to.be.lessThan(Number(poolBefore.usdcReserve));
  });

  it("validates ceiling defense mechanism", async () => {
    console.log("\n🛡️ Test: Ceiling Defense (Price > $2.00)\n");

    // Buy a large amount to approach ceiling
    const largeBuy = 5_000_000 * 10 ** USDC_DECIMALS; // 5M USDC

    const poolBefore = await program.account.pool.fetch(poolPda);
    const ceilingReserveBefore = await getAccount(provider.connection, ceilingReserveXnt);

    await program.methods
      .buy(new anchor.BN(largeBuy))
      .accounts({
        pool: poolPda,
        poolXnt: poolXnt,
        poolUsdc: poolUsdc,
        ceilingReservePda: ceilingReservePda,
        ceilingReserveXnt: ceilingReserveXnt,
        xntMint: NATIVE_MINT,
        usdcMint: usdcMint,
        buyer: payer.publicKey,
        buyerXnt: traderXnt,
        buyerUsdc: traderUsdc,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([])
      .rpc();

    const poolAfter = await program.account.pool.fetch(poolPda);
    const ceilingReserveAfter = await getAccount(provider.connection, ceilingReserveXnt);

    // Calculate price (both reserves in e9)
    const price = (Number(poolAfter.usdcReserve) * 1_000_000) / Number(poolAfter.xntReserve);
    console.log(`Price after large buy: $${(price / 1e6).toFixed(6)}`);
    console.log(`Ceiling: $${(PRICE_CEILING / 1e6).toFixed(6)}`);

    // Price should not exceed ceiling
    expect(price).to.be.lessThanOrEqual(PRICE_CEILING * 1.01); // Allow 1% tolerance

    // If ceiling was triggered, reserve should be depleted
    if (price > PRICE_CEILING * 0.95) {
      console.log(`Ceiling reserve before: ${Number(ceilingReserveBefore.amount) / 1e9}`);
      console.log(`Ceiling reserve after: ${Number(ceilingReserveAfter.amount) / 1e9}`);
      expect(Number(ceilingReserveAfter.amount)).to.be.lessThanOrEqual(Number(ceilingReserveBefore.amount));
    }
  });

  it("validates multiple buy and sell operations", async () => {
    console.log("\n🔄 Test: Multiple Trades\n");

    let pool = await program.account.pool.fetch(poolPda);
    const initialPrice = (Number(pool.usdcReserve) * 1_000_000) / Number(pool.xntReserve);
    console.log(`Initial price: $${(initialPrice / 1e6).toFixed(6)}`);

    // Execute 3 buys and 3 sells
    for (let i = 0; i < 3; i++) {
      // Buy
      const buyAmount = 50_000 * 10 ** USDC_DECIMALS; // 50K USDC
      await program.methods
        .buy(new anchor.BN(buyAmount))
        .accounts({
          pool: poolPda,
          poolXnt: poolXnt,
          poolUsdc: poolUsdc,
          ceilingReservePda: ceilingReservePda,
          ceilingReserveXnt: ceilingReserveXnt,
          xntMint: NATIVE_MINT,
          usdcMint: usdcMint,
          buyer: payer.publicKey,
          buyerXnt: traderXnt,
          buyerUsdc: traderUsdc,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([])
        .rpc();

      pool = await program.account.pool.fetch(poolPda);
      const priceAfterBuy = (Number(pool.usdcReserve) * 1_000_000) / Number(pool.xntReserve);
      console.log(`After buy ${i + 1}: $${(priceAfterBuy / 1e6).toFixed(6)}`);

      // Wait 2 seconds for defense cooldown
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Sell
      const sellAmount = 30_000 * 10 ** XNT_DECIMALS; // 30K XNT
      await program.methods
        .sell(new anchor.BN(sellAmount))
        .accounts({
          seller: payer.publicKey,
          pool: poolPda,
          xntMint: NATIVE_MINT,
          usdcMint: usdcMint,
          poolXnt: poolXnt,
          poolUsdc: poolUsdc,
          sellerXnt: traderXnt,
          sellerUsdc: traderUsdc,
          ceilingReservePda: ceilingReservePda,
          ceilingReserveXnt: ceilingReserveXnt,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([])
        .rpc();

      pool = await program.account.pool.fetch(poolPda);
      const priceAfterSell = (Number(pool.usdcReserve) * 1_000_000) / Number(pool.xntReserve);
      console.log(`After sell ${i + 1}: $${(priceAfterSell / 1e6).toFixed(6)}`);

      // Wait 2 seconds for defense cooldown
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    const finalPrice = (Number(pool.usdcReserve) * 1_000_000) / Number(pool.xntReserve);
    console.log(`Final price: $${(finalPrice / 1e6).toFixed(6)}`);

    // Price should remain within corridor
    expect(finalPrice).to.be.lessThanOrEqual(PRICE_CEILING * 1.01);
    expect(finalPrice).to.be.greaterThanOrEqual(PRICE_FLOOR * 0.99);
  });

  it("validates withdraw_usdc_price_neutral with e6 USDC", async () => {
    console.log("\n💰 Testing WITHDRAW_USDC_PRICE_NEUTRAL with e6 USDC...\n");

    // First, do a buy to accumulate real USDC in the pool
    const buyAmount = 1_000_000; // 1M USDC in e6 format
    console.log(`Step 1: Buying XNT with ${buyAmount.toLocaleString()} USDC to accumulate real USDC...`);

    await program.methods
      .buy(new anchor.BN(buyAmount))
      .accounts({
        buyer: payer.publicKey,
        pool: poolPda,
        xntMint: NATIVE_MINT,
        usdcMint: usdcMint,
        poolXnt,
        poolUsdc,
        buyerXnt: traderXnt,
        buyerUsdc: traderUsdc,
        ceilingReservePda,
        ceilingReserveXnt,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([])
      .rpc();

    // Check real USDC balance before withdrawal
    const poolUsdcBefore = await provider.connection.getTokenAccountBalance(poolUsdc);
    const realUsdcBefore = Number(poolUsdcBefore.value.amount);
    const poolBefore = await program.account.pool.fetch(poolPda);
    const priceBefore = (Number(poolBefore.usdcReserve) * 1_000_000) / Number(poolBefore.xntReserve);

    console.log(`Real USDC in pool before: ${(realUsdcBefore / 1e6).toLocaleString()} USDC (e6)`);
    console.log(`Virtual USDC reserve: ${(Number(poolBefore.usdcReserve) / 1e9).toLocaleString()} USDC (e9 normalized)`);
    console.log(`Price before: $${(priceBefore / 1e6).toFixed(6)}`);

    // Withdraw 500K USDC (e6 format)
    const withdrawAmount = 500_000; // 500K USDC in e6 atomic units
    console.log(`\nStep 2: Withdrawing ${(withdrawAmount / 1e6).toLocaleString()} USDC (price neutral)...`);

    await program.methods
      .withdrawUsdcPriceNeutral(new anchor.BN(withdrawAmount))
      .accounts({
        authority: payer.publicKey,
        pool: poolPda,
        poolUsdc,
        authorityUsdc: traderUsdc,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([])
      .rpc();

    // Check balances after withdrawal
    const poolUsdcAfter = await provider.connection.getTokenAccountBalance(poolUsdc);
    const realUsdcAfter = Number(poolUsdcAfter.value.amount);
    const poolAfter = await program.account.pool.fetch(poolPda);
    const priceAfter = (Number(poolAfter.usdcReserve) * 1_000_000) / Number(poolAfter.xntReserve);

    console.log(`\nReal USDC in pool after: ${(realUsdcAfter / 1e6).toLocaleString()} USDC (e6)`);
    console.log(`Virtual USDC reserve: ${(Number(poolAfter.usdcReserve) / 1e9).toLocaleString()} USDC (e9 normalized)`);
    console.log(`Price after: $${(priceAfter / 1e6).toFixed(6)}`);

    // Assertions
    // 1. Real USDC should decrease by withdrawal amount (e6)
    expect(realUsdcAfter).to.equal(realUsdcBefore - withdrawAmount);

    // 2. Virtual USDC reserve should DECREASE by normalized amount (e6 → e9: multiply by 1000)
    const withdrawAmountNormalized = withdrawAmount * 1000;
    expect(Number(poolAfter.usdcReserve)).to.equal(Number(poolBefore.usdcReserve) - withdrawAmountNormalized);

    // 3. Price should remain unchanged
    const priceDiff = Math.abs(priceAfter - priceBefore) / priceBefore;
    expect(priceDiff).to.be.lessThan(0.0001); // Less than 0.01% change

    console.log(`✅ Withdrew ${(withdrawAmount / 1e6).toLocaleString()} USDC`);
    console.log(`✅ Real USDC decreased: ${(realUsdcBefore / 1e6).toLocaleString()} → ${(realUsdcAfter / 1e6).toLocaleString()}`);
    console.log(`✅ Virtual reserve decreased by: ${(withdrawAmountNormalized / 1e9).toLocaleString()} USDC`);
    console.log(`✅ Price maintained: $${(priceBefore / 1e6).toFixed(6)} → $${(priceAfter / 1e6).toFixed(6)}`);
  });

  it("validates deposit_xnt_price_neutral with e6 USDC", async () => {
    console.log("\n💰 Testing DEPOSIT_XNT_PRICE_NEUTRAL with e6 USDC...\n");

    const poolBefore = await program.account.pool.fetch(poolPda);
    const priceBefore = (Number(poolBefore.usdcReserve) * 1_000_000) / Number(poolBefore.xntReserve);

    console.log(`Before deposit:`);
    console.log(`  XNT Reserve: ${(Number(poolBefore.xntReserve) / 1e9).toLocaleString()} XNT`);
    console.log(`  USDC Reserve: ${(Number(poolBefore.usdcReserve) / 1e9).toLocaleString()} USDC (e9 normalized)`);
    console.log(`  Price: $${(priceBefore / 1e6).toFixed(6)}`);

    // Deposit 100K XNT (e9 format)
    const depositAmount = 100_000 * 1e9; // 100K XNT in e9 atomic units
    console.log(`\nDepositing ${(depositAmount / 1e9).toLocaleString()} XNT (price neutral)...`);

    await program.methods
      .depositXntPriceNeutral(new anchor.BN(depositAmount))
      .accounts({
        authority: payer.publicKey,
        pool: poolPda,
        poolXnt,
        authorityXnt: traderXnt,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([])
      .rpc();

    const poolAfter = await program.account.pool.fetch(poolPda);
    const priceAfter = (Number(poolAfter.usdcReserve) * 1_000_000) / Number(poolAfter.xntReserve);

    console.log(`\nAfter deposit:`);
    console.log(`  XNT Reserve: ${(Number(poolAfter.xntReserve) / 1e9).toLocaleString()} XNT`);
    console.log(`  USDC Reserve: ${(Number(poolAfter.usdcReserve) / 1e9).toLocaleString()} USDC (e9 normalized)`);
    console.log(`  Price: $${(priceAfter / 1e6).toFixed(6)}`);

    // Assertions
    // 1. XNT reserve should increase by deposit amount
    expect(Number(poolAfter.xntReserve)).to.equal(Number(poolBefore.xntReserve) + depositAmount);

    // 2. Price should remain approximately unchanged
    const priceDiff = Math.abs(priceAfter - priceBefore) / priceBefore;
    expect(priceDiff).to.be.lessThan(0.001); // Less than 0.1% change

    console.log(`✅ Deposited ${(depositAmount / 1e9).toLocaleString()} XNT`);
    console.log(`✅ XNT increased: ${(Number(poolBefore.xntReserve) / 1e9).toLocaleString()} → ${(Number(poolAfter.xntReserve) / 1e9).toLocaleString()}`);
    console.log(`✅ Price maintained: $${(priceBefore / 1e6).toFixed(6)} → $${(priceAfter / 1e6).toFixed(6)}`);
  });
});
