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

describe("bonding-curve-deposits", () => {
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
  let traderXnt: anchor.web3.PublicKey;
  let traderUsdc: anchor.web3.PublicKey;
  let lp2Xnt: anchor.web3.PublicKey;
  let lp2Usdc: anchor.web3.PublicKey;

  const INITIAL_XNT = 5_000_000_000_000; // 5M XNT (6 decimals) - single-sided liquidity
  const VIRTUAL_USDC = 5_000_000_000_000; // 5M USDC virtual reserve (6 decimals) - maintains $1.00 price

  before("Setup mints and accounts", async () => {
    console.log("\n🔧 Setting up test environment...\n");

    // Create mints
    xntMint = await createMint(provider.connection, payer.payer, payer.publicKey, null, 6);
    usdcMint = await createMint(provider.connection, payer.payer, payer.publicKey, null, 6);

    console.log(`✅ Created XNT mint: ${xntMint.toBase58()}`);
    console.log(`✅ Created USDC mint: ${usdcMint.toBase58()}`);

    // Create authority's XNT and USDC accounts and mint tokens
    const authorityXntAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      payer.payer,
      xntMint,
      payer.publicKey
    );
    authorityXnt = authorityXntAccount.address;
    await mintTo(provider.connection, payer.payer, xntMint, authorityXnt, payer.publicKey, INITIAL_XNT * 2); // 10M total (5M for pool, 5M for deposits)

    // Create trader accounts
    const traderXntAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      payer.payer,
      xntMint,
      payer.publicKey
    );
    traderXnt = traderXntAccount.address;

    const traderUsdcAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      payer.payer,
      usdcMint,
      payer.publicKey
    );
    traderUsdc = traderUsdcAccount.address;
    await mintTo(provider.connection, payer.payer, usdcMint, traderUsdc, payer.publicKey, 5_000_000_000_000); // 5M USDC for trading

    // Create LP2 accounts
    const lp2XntAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      payer.payer,
      xntMint,
      payer.publicKey
    );
    lp2Xnt = lp2XntAccount.address;
    await mintTo(provider.connection, payer.payer, xntMint, lp2Xnt, payer.publicKey, 2_500_000_000_000); // 2.5M XNT for LP

    const lp2UsdcAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      payer.payer,
      usdcMint,
      payer.publicKey
    );
    lp2Usdc = lp2UsdcAccount.address;
    await mintTo(provider.connection, payer.payer, usdcMint, lp2Usdc, payer.publicKey, 2_500_000_000_000); // 2.5M USDC for LP

    // Derive pool PDA
    [poolPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("pool"), xntMint.toBuffer(), usdcMint.toBuffer()],
      program.programId
    );

    console.log(`✅ Pool PDA: ${poolPda.toBase58()}\n`);
  });

  it("Initialize pool", async () => {
    console.log("📊 Initializing bonding curve pool...\n");

    const poolXntKeypair = anchor.web3.Keypair.generate();
    const poolUsdcKeypair = anchor.web3.Keypair.generate();
    poolXnt = poolXntKeypair.publicKey;
    poolUsdc = poolUsdcKeypair.publicKey;

    await program.methods
      .initializePool(new anchor.BN(INITIAL_XNT), new anchor.BN(VIRTUAL_USDC), false)
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
    const poolXntBalance = await provider.connection.getTokenAccountBalance(poolXnt);
    const poolUsdcBalance = await provider.connection.getTokenAccountBalance(poolUsdc);

    console.log(`✅ Pool initialized (single-sided liquidity):`);
    console.log(`   Real XNT: ${parseInt(poolXntBalance.value.amount) / 1e6} XNT`);
    console.log(`   Real USDC: $${parseInt(poolUsdcBalance.value.amount) / 1e6}`);
    console.log(`   Virtual USDC: $${pool.usdcReserve.toNumber() / 1e6}`);
    console.log(`   Starting price: $${(pool.usdcReserve.toNumber() / pool.xntReserve.toNumber()).toFixed(2)}\n`);

    assert.equal(pool.xntReserve.toNumber(), INITIAL_XNT, "XNT reserve should match");
    assert.equal(pool.usdcReserve.toNumber(), VIRTUAL_USDC, "Virtual USDC reserve should match");
    assert.equal(parseInt(poolXntBalance.value.amount), INITIAL_XNT, "Real XNT should be deposited");
    assert.equal(parseInt(poolUsdcBalance.value.amount), 0, "Real USDC should be 0 (single-sided)");
  });

  it("Test SELL: Sell XNT for USDC (price decreases)", async () => {
    console.log("💸 Testing SELL function...\n");

    // First, do enough BUYs to add real USDC to the pool
    console.log("  Step 1: Buying XNT with USDC to add more liquidity...");
    const buyAmount = 500_000_000_000; // 500k USDC (10% of pool)
    await program.methods
      .buy(new anchor.BN(buyAmount))
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

    // Check pool's actual USDC balance
    const poolUsdcBalance = await provider.connection.getTokenAccountBalance(poolUsdc);
    console.log(`  Pool now has ${parseInt(poolUsdcBalance.value.amount) / 1e6} real USDC`);

    const poolBefore = await program.account.pool.fetch(poolPda);
    const priceBefore = poolBefore.usdcReserve.toNumber() / poolBefore.xntReserve.toNumber();
    const traderXntBefore = await provider.connection.getTokenAccountBalance(traderXnt);

    console.log(`  Step 2: Selling XNT back to pool...`);
    console.log(`  Before sell: Price = $${priceBefore.toFixed(4)}, Trader has ${parseInt(traderXntBefore.value.amount) / 1e6} XNT`);

    // Sell a small amount (only what pool can afford to buy back)
    const sellAmount = Math.floor(parseInt(traderXntBefore.value.amount) * 0.05); // 5%
    await program.methods
      .sell(new anchor.BN(sellAmount))
      .accounts({
        seller: payer.publicKey,
        pool: poolPda,
        poolXnt,
        poolUsdc,
        sellerXnt: traderXnt,
        sellerUsdc: traderUsdc,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    const poolAfter = await program.account.pool.fetch(poolPda);
    const priceAfter = poolAfter.usdcReserve.toNumber() / poolAfter.xntReserve.toNumber();

    console.log(`  After sell:  Price = $${priceAfter.toFixed(4)}`);
    console.log(`  ✅ Price decreased by ${((priceBefore - priceAfter) / priceBefore * 100).toFixed(2)}%\n`);

    assert.isTrue(priceAfter < priceBefore, "Price should decrease after SELL");
    assert.equal(poolAfter.tradeCount.toNumber(), 2); // 1 buy + 1 sell
  });

  it("Test DEPOSIT_XNT: Authority deposits XNT (price stays >= $1.00)", async () => {
    console.log("📥 Testing DEPOSIT_XNT function with minimum price...\n");

    const poolBefore = await program.account.pool.fetch(poolPda);
    const priceBefore = poolBefore.usdcReserve.toNumber() / poolBefore.xntReserve.toNumber();

    // Calculate max deposit to keep price >= $1.00
    // For price >= 1.0: USDC >= XNT, so: USDC >= (XNT + deposit)
    // Therefore: deposit <= USDC - XNT
    const maxDeposit = poolBefore.usdcReserve.toNumber() - poolBefore.xntReserve.toNumber();

    console.log(`  Before: XNT = ${poolBefore.xntReserve.toNumber() / 1e6}, USDC = ${poolBefore.usdcReserve.toNumber() / 1e6}, Price = $${priceBefore.toFixed(4)}`);
    console.log(`  Max deposit to maintain $1.00 floor: ${maxDeposit / 1e6} XNT`);

    if (maxDeposit <= 0) {
      console.log(`  ⚠️  Price already below $1.00 - cannot deposit more XNT`);
      console.log(`  ✅ Minimum price constraint working correctly!\n`);

      // Try to deposit anyway to verify it fails
      try {
        await program.methods
          .depositXnt(new anchor.BN(1000))
          .accounts({
            authority: payer.publicKey,
            pool: poolPda,
            poolXnt,
            authorityXnt,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .rpc();
        assert.fail("Should have failed with price below minimum");
      } catch (err) {
        console.log(`  ✅ Correctly rejected deposit that would violate $1.00 minimum\n`);
        assert.include(err.toString(), "PriceBelowMinimum");
      }
    } else {
      // Deposit 50% of max to keep safe margin above $1.00
      const depositAmount = Math.floor(maxDeposit * 0.5);
      console.log(`  Depositing ${depositAmount / 1e6} XNT (50% of max)`);

      await program.methods
        .depositXnt(new anchor.BN(depositAmount))
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

      console.log(`  After:  XNT = ${poolAfter.xntReserve.toNumber() / 1e6}, Price = $${priceAfter.toFixed(4)}`);
      console.log(`  ✅ Added ${depositAmount / 1e6} XNT, price decreased by ${((priceBefore - priceAfter) / priceBefore * 100).toFixed(2)}%`);
      console.log(`  ✅ Price remains above $1.00 minimum!\n`);

      assert.isTrue(priceAfter >= 1.0, "Price should stay at or above $1.00");
      assert.isTrue(priceAfter < priceBefore, "Price should decrease when adding XNT");
    }
  });

  it("Test DEPOSIT_XNT_PRICE_NEUTRAL: Deposit XNT without affecting price", async () => {
    console.log("💎 Testing DEPOSIT_XNT_PRICE_NEUTRAL function...\n");

    const poolBefore = await program.account.pool.fetch(poolPda);
    const priceBefore = poolBefore.usdcReserve.toNumber() / poolBefore.xntReserve.toNumber();

    // Deposit a significant amount of XNT
    const depositAmount = 1_000_000_000_000; // 1M XNT

    console.log(`  Before: XNT = ${poolBefore.xntReserve.toNumber() / 1e6} XNT, USDC = ${poolBefore.usdcReserve.toNumber() / 1e6} USDC`);
    console.log(`  Price before: $${priceBefore.toFixed(6)}`);
    console.log(`  Depositing ${depositAmount / 1e6} XNT (price-neutral deposit)`);

    await program.methods
      .depositXntPriceNeutral(new anchor.BN(depositAmount))
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

    // Calculate how much virtual USDC was added
    const virtualUsdcAdded = poolAfter.usdcReserve.toNumber() - poolBefore.usdcReserve.toNumber();

    console.log(`  After:  XNT = ${poolAfter.xntReserve.toNumber() / 1e6} XNT, USDC = ${poolAfter.usdcReserve.toNumber() / 1e6} USDC`);
    console.log(`  Price after: $${priceAfter.toFixed(6)}`);
    console.log(`  Virtual USDC added: ${virtualUsdcAdded / 1e6} USDC`);
    console.log(`  ✅ Added ${depositAmount / 1e6} XNT + ${virtualUsdcAdded / 1e6} virtual USDC`);
    console.log(`  ✅ Price unchanged: $${priceBefore.toFixed(6)} → $${priceAfter.toFixed(6)}\n`);

    // Verify XNT was added
    assert.equal(poolAfter.xntReserve.toNumber(), poolBefore.xntReserve.toNumber() + depositAmount, "XNT should increase by deposit amount");

    // Verify price stayed the same (allow tiny rounding error)
    assert.approximately(priceAfter, priceBefore, 0.000001, "Price should remain exactly the same");

    // Verify virtual USDC was added proportionally
    const expectedVirtualUsdc = Math.floor((poolBefore.usdcReserve.toNumber() * depositAmount) / poolBefore.xntReserve.toNumber());
    assert.approximately(virtualUsdcAdded, expectedVirtualUsdc, 1, "Virtual USDC should be proportional");
  });

  it("Test ADD_LIQUIDITY: Anyone can add proportional liquidity", async () => {
    console.log("💰 Testing ADD_LIQUIDITY function...\n");

    const poolBefore = await program.account.pool.fetch(poolPda);
    const priceBefore = poolBefore.usdcReserve.toNumber() / poolBefore.xntReserve.toNumber();

    // Calculate proportional amounts (1% of pool)
    const xntAmount = poolBefore.xntReserve.toNumber() / 100;
    const usdcAmount = poolBefore.usdcReserve.toNumber() / 100;

    console.log(`  Pool: ${poolBefore.xntReserve.toNumber() / 1e6} XNT, ${poolBefore.usdcReserve.toNumber() / 1e6} USDC`);
    console.log(`  Adding: ${xntAmount / 1e6} XNT, ${usdcAmount / 1e6} USDC (1% of pool)`);

    const [lpPositionPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("lp_position"), poolPda.toBuffer(), payer.publicKey.toBuffer()],
      program.programId
    );

    await program.methods
      .addLiquidity(
        new anchor.BN(xntAmount),
        new anchor.BN(usdcAmount),
        new anchor.BN(1) // min liquidity
      )
      .accounts({
        lpProvider: payer.publicKey,
        pool: poolPda,
        poolXnt,
        poolUsdc,
        lpXnt: lp2Xnt,
        lpUsdc: lp2Usdc,
        lpPosition: lpPositionPda,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    const poolAfter = await program.account.pool.fetch(poolPda);
    const priceAfter = poolAfter.usdcReserve.toNumber() / poolAfter.xntReserve.toNumber();
    const lpPosition = await program.account.lpPosition.fetch(lpPositionPda);

    console.log(`  Pool after: ${poolAfter.xntReserve.toNumber() / 1e6} XNT, ${poolAfter.usdcReserve.toNumber() / 1e6} USDC`);
    console.log(`  LP Position: ${lpPosition.liquidity.toString()} liquidity tokens`);
    console.log(`  ✅ Liquidity added, price maintained at $${priceAfter.toFixed(4)}\n`);

    // Allow for small rounding errors
    const xntDiff = Math.abs(poolAfter.xntReserve.toNumber() - (poolBefore.xntReserve.toNumber() + xntAmount));
    const usdcDiff = Math.abs(poolAfter.usdcReserve.toNumber() - (poolBefore.usdcReserve.toNumber() + usdcAmount));
    assert.isTrue(xntDiff < 10, "XNT should increase by liquidity amount");
    assert.isTrue(usdcDiff < 10, "USDC should increase by liquidity amount");
    assert.approximately(priceAfter, priceBefore, 0.001, "Price should remain the same");
    assert.isTrue(lpPosition.liquidity.toNumber() > 0, "LP should receive liquidity tokens");
  });

  it("Final pool state summary", async () => {
    const pool = await program.account.pool.fetch(poolPda);
    const currentPrice = pool.usdcReserve.toNumber() / pool.xntReserve.toNumber();

    console.log("\n╔════════════════════════════════════════════════════════════╗");
    console.log("║              FINAL POOL STATE SUMMARY                     ║");
    console.log("╚════════════════════════════════════════════════════════════╝\n");
    console.log(`  📊 XNT Reserve: ${(pool.xntReserve.toNumber() / 1e6).toLocaleString()} XNT`);
    console.log(`  💵 USDC Reserve: $${(pool.usdcReserve.toNumber() / 1e6).toLocaleString()}`);
    console.log(`  💹 Current Price: $${currentPrice.toFixed(6)}`);
    console.log(`  📈 Total Trades: ${pool.tradeCount.toNumber()}`);
    console.log(`  💧 Total Liquidity: ${pool.totalLiquidity.toString()}`);
    console.log(`  🎯 Constant k: ${pool.k.toString()}`);
    console.log("\n  ✅ All 4 deposit methods tested successfully!");
    console.log("     1. sell() - Sell XNT for USDC");
    console.log("     2. deposit_xnt() - Add XNT (price decreases, $1.00 floor)");
    console.log("     3. deposit_xnt_price_neutral() - Add XNT (price stays same)");
    console.log("     4. add_liquidity() - Add XNT+USDC (price stays same)\n");
  });
});
