import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { BondingCurve } from "../target/types/bonding_curve";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { assert } from "chai";

describe("bonding-curve-amm", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.BondingCurve as Program<BondingCurve>;
  const payer = provider.wallet as anchor.Wallet;

  let xntMint: anchor.web3.PublicKey;
  let usdcMint: anchor.web3.PublicKey;
  let poolPda: anchor.web3.PublicKey;
  let poolXnt: anchor.web3.PublicKey;
  let poolUsdc: anchor.web3.PublicKey;
  let initializerXnt: anchor.web3.PublicKey;
  let buyerXnt: anchor.web3.PublicKey;
  let buyerUsdc: anchor.web3.PublicKey;

  const INITIAL_XNT = 1_000_000_000_000; // 1M XNT (6 decimals)
  const VIRTUAL_USDC = 1_000_000_000_000; // 1M USDC (6 decimals) - virtual bootstrap
  const USDC_PER_TRADE = 10_000_000_000; // 10k USDC (6 decimals)
  const NUM_TRADES = 50;

  before("Setup mints and accounts", async () => {
    console.log("\n🔧 Setting up test environment...\n");

    // Create XNT mint (6 decimals)
    xntMint = await createMint(
      provider.connection,
      payer.payer,
      payer.publicKey,
      null,
      6
    );
    console.log(`✅ Created XNT mint: ${xntMint.toBase58()}`);

    // Create USDC mint (6 decimals)
    usdcMint = await createMint(
      provider.connection,
      payer.payer,
      payer.publicKey,
      null,
      6
    );
    console.log(`✅ Created USDC mint: ${usdcMint.toBase58()}`);

    // Create initializer's XNT account and mint initial supply
    const initializerXntAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      payer.payer,
      xntMint,
      payer.publicKey
    );
    initializerXnt = initializerXntAccount.address;

    await mintTo(
      provider.connection,
      payer.payer,
      xntMint,
      initializerXnt,
      payer.publicKey,
      INITIAL_XNT
    );
    console.log(`✅ Minted ${INITIAL_XNT / 1e6} XNT to initializer`);

    // Create buyer's accounts
    const buyerXntAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      payer.payer,
      xntMint,
      payer.publicKey
    );
    buyerXnt = buyerXntAccount.address;

    const buyerUsdcAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      payer.payer,
      usdcMint,
      payer.publicKey
    );
    buyerUsdc = buyerUsdcAccount.address;

    // Mint USDC to buyer for purchases
    const totalUsdcNeeded = USDC_PER_TRADE * NUM_TRADES;
    await mintTo(
      provider.connection,
      payer.payer,
      usdcMint,
      buyerUsdc,
      payer.publicKey,
      totalUsdcNeeded
    );
    console.log(`✅ Minted ${totalUsdcNeeded / 1e6} USDC to buyer for ${NUM_TRADES} trades`);

    // Derive pool PDA
    [poolPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("pool"), xntMint.toBuffer(), usdcMint.toBuffer()],
      program.programId
    );
    console.log(`✅ Pool PDA: ${poolPda.toBase58()}\n`);
  });

  it("Initialize bonding curve pool", async () => {
    console.log("📊 Initializing bonding curve pool...\n");

    // Generate keypairs for pool token accounts
    const poolXntKeypair = anchor.web3.Keypair.generate();
    const poolUsdcKeypair = anchor.web3.Keypair.generate();
    poolXnt = poolXntKeypair.publicKey;
    poolUsdc = poolUsdcKeypair.publicKey;

    const tx = await program.methods
      .initializePool(
        new anchor.BN(INITIAL_XNT),
        new anchor.BN(VIRTUAL_USDC)
      )
      .accounts({
        initializer: payer.publicKey,
        pool: poolPda,
        xntMint,
        usdcMint,
        poolXnt,
        poolUsdc,
        initializerXnt,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([poolXntKeypair, poolUsdcKeypair])
      .rpc();

    console.log(`✅ Pool initialized! Tx: ${tx}`);

    // Fetch and verify pool state
    const pool = await program.account.pool.fetch(poolPda);
    console.log(`\n📊 Pool State:`);
    console.log(`   XNT Reserve: ${pool.xntReserve.toNumber() / 1e6} XNT`);
    console.log(`   USDC Reserve: ${pool.usdcReserve.toNumber() / 1e6} USDC (virtual)`);
    console.log(`   Starting Price: $${pool.usdcReserve.toNumber() / pool.xntReserve.toNumber()}`);
    console.log(`   Constant k: ${pool.k.toString()}`);
    console.log(`   Trade Count: ${pool.tradeCount.toNumber()}\n`);

    assert.equal(pool.xntReserve.toNumber(), INITIAL_XNT);
    assert.equal(pool.usdcReserve.toNumber(), VIRTUAL_USDC);
  });

  it(`Execute ${NUM_TRADES} buy orders (${USDC_PER_TRADE / 1e6} USDC each)`, async () => {
    console.log(`\n╔═══════╦═══════════════╦═══════════════╦═══════════════╦═══════════════╦═══════════════╗`);
    console.log(`║ Trade ║  USDC Paid    ║  XNT Received ║  Price/XNT    ║  New Price    ║ Total USDC    ║`);
    console.log(`╠═══════╬═══════════════╬═══════════════╬═══════════════╬═══════════════╬═══════════════╣`);

    const startingPool = await program.account.pool.fetch(poolPda);
    const startingPrice = startingPool.usdcReserve.toNumber() / startingPool.xntReserve.toNumber();

    let totalXntReceived = 0;
    let totalUsdcSpent = 0;

    for (let i = 1; i <= NUM_TRADES; i++) {
      const poolBefore = await program.account.pool.fetch(poolPda);
      const buyerXntBefore = await provider.connection.getTokenAccountBalance(buyerXnt);

      await program.methods
        .buy(new anchor.BN(USDC_PER_TRADE))
        .accounts({
          buyer: payer.publicKey,
          pool: poolPda,
          poolXnt,
          poolUsdc,
          buyerUsdc,
          buyerXnt,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();

      const poolAfter = await program.account.pool.fetch(poolPda);
      const buyerXntAfter = await provider.connection.getTokenAccountBalance(buyerXnt);

      const xntReceived = parseInt(buyerXntAfter.value.amount) - parseInt(buyerXntBefore.value.amount);
      const priceBefore = poolBefore.usdcReserve.toNumber() / poolBefore.xntReserve.toNumber();
      const priceAfter = poolAfter.usdcReserve.toNumber() / poolAfter.xntReserve.toNumber();
      const effectivePrice = USDC_PER_TRADE / xntReceived;
      const totalUsdc = poolAfter.usdcReserve.toNumber() - VIRTUAL_USDC;

      totalXntReceived += xntReceived;
      totalUsdcSpent += USDC_PER_TRADE;

      // Print formatted row
      const tradeStr = String(i).padStart(5);
      const usdcPaidStr = ("$" + (USDC_PER_TRADE / 1e6).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })).padStart(13);
      const xntRecStr = (xntReceived / 1e6).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).padStart(13);
      const priceStr = ("$" + effectivePrice.toFixed(4)).padStart(13);
      const newPriceStr = ("$" + priceAfter.toFixed(4)).padStart(13);
      const totalUsdcStr = ("$" + (totalUsdc / 1e6).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })).padStart(13);

      console.log(`║ ${tradeStr} ║ ${usdcPaidStr} ║ ${xntRecStr} ║ ${priceStr} ║ ${newPriceStr} ║ ${totalUsdcStr} ║`);
    }

    console.log(`╚═══════╩═══════════════╩═══════════════╩═══════════════╩═══════════════╩═══════════════╝`);

    // Final summary
    const finalPool = await program.account.pool.fetch(poolPda);
    const finalPrice = finalPool.usdcReserve.toNumber() / finalPool.xntReserve.toNumber();
    const priceIncrease = ((finalPrice / startingPrice - 1) * 100);
    const xntSold = INITIAL_XNT - finalPool.xntReserve.toNumber();
    const pctSold = (xntSold / INITIAL_XNT) * 100;

    console.log(`\n╔════════════════════════════════════════════════════════════════════════════════════════╗`);
    console.log(`║                                   FINAL SUMMARY                                       ║`);
    console.log(`╚════════════════════════════════════════════════════════════════════════════════════════╝\n`);

    console.log(`  📈 Total Trades Executed: ${finalPool.tradeCount.toNumber()}`);
    console.log(`  💰 Total USDC Spent: $${(totalUsdcSpent / 1e6).toLocaleString()}`);
    console.log(`  🪙  Total XNT Purchased: ${(totalXntReceived / 1e6).toLocaleString()} (${pctSold.toFixed(1)}%)`);
    console.log(`  💎 XNT Remaining in Pool: ${(finalPool.xntReserve.toNumber() / 1e6).toLocaleString()}`);
    console.log(`  📊 Starting Price: $${startingPrice.toFixed(6)}`);
    console.log(`  📊 Final Price: $${finalPrice.toFixed(6)}`);
    console.log(`  📈 Price Increase: ${priceIncrease > 0 ? '+' : ''}${priceIncrease.toFixed(2)}%`);
    console.log(`  💵 USDC Reserve: $${(finalPool.usdcReserve.toNumber() / 1e6).toLocaleString()}`);
    console.log(`  🎯 Constant k maintained: ${finalPool.k.toString()}\n`);

    assert.equal(finalPool.tradeCount.toNumber(), NUM_TRADES);
    assert.isTrue(priceIncrease > 0, "Price should increase with buy pressure");
  });
});
