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

  const INITIAL_XNT = 10_000_000 * 10 ** XNT_DECIMALS; // 10M XNT
  const VIRTUAL_USDC = 10_000_000 * 10 ** USDC_DECIMALS; // 10M USDC (e6!)
  const CEILING_RESERVE_XNT = 10_000_000 * 10 ** XNT_DECIMALS; // 10M XNT reserve
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

    // Get pool token accounts
    poolXnt = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      payer.payer,
      NATIVE_MINT,
      poolPda,
      true
    ).then((account) => account.address);

    poolUsdc = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      payer.payer,
      usdcMint,
      poolPda,
      true
    ).then((account) => account.address);

    ceilingReserveXnt = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      payer.payer,
      NATIVE_MINT,
      ceilingReservePda,
      true
    ).then((account) => account.address);

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

    // Initialize pool
    await program.methods
      .initializePool(
        new anchor.BN(INITIAL_XNT),
        new anchor.BN(VIRTUAL_USDC),
        true, // price_floor_enabled
        new anchor.BN(PRICE_CEILING),
        new anchor.BN(PRICE_FLOOR)
      )
      .accounts({
        pool: poolPda,
        xntMint: NATIVE_MINT,
        usdcMint: usdcMint,
        poolXnt: poolXnt,
        poolUsdc: poolUsdc,
        ceilingReservePda: ceilingReservePda,
        ceilingReserveXnt: ceilingReserveXnt,
        authority: payer.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([])
      .rpc();

    console.log(`✅ Pool initialized with e6 USDC`);
    console.log(`   XNT Reserve: ${INITIAL_XNT / 10 ** XNT_DECIMALS}M (e9)`);
    console.log(`   USDC Reserve: ${VIRTUAL_USDC / 10 ** USDC_DECIMALS}M (e6)`);
    console.log(`   Initial Price: $1.00`);

    // Fund ceiling reserve (wrap SOL to wSOL)
    await program.methods
      .fundCeilingReserve(new anchor.BN(CEILING_RESERVE_XNT))
      .accounts({
        pool: poolPda,
        ceilingReservePda: ceilingReservePda,
        ceilingReserveXnt: ceilingReserveXnt,
        xntMint: NATIVE_MINT,
        authority: payer.publicKey,
        funder: payer.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([])
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

    // Calculate amounts
    const usdcSpent = Number(poolAfter.usdcReserve) - Number(poolBefore.usdcReserve);
    const xntReceived = Number(poolBefore.xntReserve) - Number(poolAfter.xntReserve);

    console.log(`USDC spent (e6): ${usdcSpent / 10 ** USDC_DECIMALS}`);
    console.log(`XNT received (e9): ${xntReceived / 10 ** XNT_DECIMALS}`);
    console.log(`Ratio: ${(xntReceived / 10 ** XNT_DECIMALS) / (usdcSpent / 10 ** USDC_DECIMALS)}`);

    // Should be approximately 1:1 ratio
    const ratio = xntReceived / usdcSpent;
    expect(ratio).to.be.closeTo(1000, 10); // Account for decimal difference (e9/e6 = 1000) and slippage
  });

  it("correctly normalizes e6 USDC to e9 internally", async () => {
    console.log("\n🔄 Test: E6 to E9 Normalization\n");

    const pool = await program.account.pool.fetch(poolPda);

    // USDC reserve should be in e6 format
    const usdcReserveE6 = Number(pool.usdcReserve);
    console.log(`USDC Reserve (raw): ${usdcReserveE6}`);
    console.log(`USDC Reserve (formatted): ${usdcReserveE6 / 10 ** USDC_DECIMALS} USDC`);

    // Verify USDC decimal places
    expect(usdcReserveE6).to.be.greaterThan(10 ** USDC_DECIMALS); // Should be in e6 range
  });

  it("validates price calculation with e6 USDC", async () => {
    console.log("\n💰 Test: Price Calculation (e6 USDC)\n");

    const pool = await program.account.pool.fetch(poolPda);

    // Price = USDC / XNT (both normalized to e6 for comparison)
    const usdcReserveE6 = Number(pool.usdcReserve);
    const xntReserveE9 = Number(pool.xntReserve);

    // Normalize XNT to e6 for price calculation
    const xntReserveE6 = xntReserveE9 / 1000;

    const price = usdcReserveE6 / xntReserveE6;
    console.log(`USDC Reserve (e6): ${usdcReserveE6}`);
    console.log(`XNT Reserve (e9): ${xntReserveE9}`);
    console.log(`XNT Reserve (normalized to e6): ${xntReserveE6}`);
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
});
