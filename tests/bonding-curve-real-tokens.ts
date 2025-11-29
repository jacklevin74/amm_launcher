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

describe("bonding-curve-real-tokens", () => {
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
  let trader1Xnt: anchor.web3.PublicKey;
  let trader1Usdc: anchor.web3.PublicKey;
  let trader2Xnt: anchor.web3.PublicKey;
  let trader2Usdc: anchor.web3.PublicKey;

  const POOL_XNT = 1_000_000_000_000; // 1M XNT for pool
  const POOL_USDC = 1_000_000_000_000; // 1M USDC real reserves

  before("Create real SPL tokens and setup", async () => {
    console.log("\n🔧 Creating real SPL tokens...\n");

    // Create XNT mint (6 decimals)
    xntMint = await createMint(
      provider.connection,
      payer.payer,
      payer.publicKey,
      payer.publicKey,
      6
    );
    console.log(`✅ Created XNT mint: ${xntMint.toBase58()}`);

    // Create USDC mint (6 decimals)
    usdcMint = await createMint(
      provider.connection,
      payer.payer,
      payer.publicKey,
      payer.publicKey,
      6
    );
    console.log(`✅ Created USDC mint: ${usdcMint.toBase58()}`);

    // Get authority accounts
    const authXntAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      payer.payer,
      xntMint,
      payer.publicKey
    );
    authorityXnt = authXntAccount.address;

    const authUsdcAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      payer.payer,
      usdcMint,
      payer.publicKey
    );
    authorityUsdc = authUsdcAccount.address;

    // Mint initial supply to authority
    await mintTo(
      provider.connection,
      payer.payer,
      xntMint,
      authorityXnt,
      payer.publicKey,
      10_000_000_000_000 // 10M XNT
    );
    await mintTo(
      provider.connection,
      payer.payer,
      usdcMint,
      authorityUsdc,
      payer.publicKey,
      10_000_000_000_000 // 10M USDC
    );

    // Create trader 1 accounts
    const trader1XntAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      payer.payer,
      xntMint,
      payer.publicKey
    );
    trader1Xnt = trader1XntAccount.address;

    const trader1UsdcAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      payer.payer,
      usdcMint,
      payer.publicKey
    );
    trader1Usdc = trader1UsdcAccount.address;

    // Mint USDC to trader1 for buying
    await mintTo(
      provider.connection,
      payer.payer,
      usdcMint,
      trader1Usdc,
      payer.publicKey,
      2_000_000_000_000 // 2M USDC
    );

    // Create trader 2 accounts
    const trader2XntAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      payer.payer,
      xntMint,
      payer.publicKey
    );
    trader2Xnt = trader2XntAccount.address;

    const trader2UsdcAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      payer.payer,
      usdcMint,
      payer.publicKey
    );
    trader2Usdc = trader2UsdcAccount.address;

    // Mint USDC to trader2
    await mintTo(
      provider.connection,
      payer.payer,
      usdcMint,
      trader2Usdc,
      payer.publicKey,
      1_000_000_000_000 // 1M USDC
    );

    // Derive pool PDA
    [poolPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("pool"), xntMint.toBuffer(), usdcMint.toBuffer()],
      program.programId
    );

    console.log(`✅ Pool PDA: ${poolPda.toBase58()}\n`);
  });

  it("Initialize pool with real tokens", async () => {
    console.log("📊 Initializing pool with real XNT...\n");

    const poolXntKeypair = anchor.web3.Keypair.generate();
    const poolUsdcKeypair = anchor.web3.Keypair.generate();
    poolXnt = poolXntKeypair.publicKey;
    poolUsdc = poolUsdcKeypair.publicKey;

    await program.methods
      .initializePool(new anchor.BN(POOL_XNT), new anchor.BN(POOL_USDC))
      .accounts({
        initializer: payer.publicKey,
        pool: poolPda,
        xntMint,
        usdcMint,
        poolXnt,
        poolUsdc,
        initializerXnt: authorityXnt,
        initializerUsdc: authorityUsdc,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([poolXntKeypair, poolUsdcKeypair])
      .rpc();

    const pool = await program.account.pool.fetch(poolPda);
    const poolXntBalance = await provider.connection.getTokenAccountBalance(poolXnt);
    const poolUsdcBalance = await provider.connection.getTokenAccountBalance(poolUsdc);

    console.log(`✅ Pool initialized!`);
    console.log(`   Real XNT in pool: ${parseInt(poolXntBalance.value.amount) / 1e6}`);
    console.log(`   Real USDC in pool: ${parseInt(poolUsdcBalance.value.amount) / 1e6}`);
    console.log(`   Starting price: $${(pool.usdcReserve.toNumber() / pool.xntReserve.toNumber()).toFixed(2)}\n`);

    assert.equal(parseInt(poolXntBalance.value.amount), POOL_XNT);
    assert.equal(parseInt(poolUsdcBalance.value.amount), POOL_USDC);
  });

  it("BUY: Multiple traders buy XNT", async () => {
    console.log("💰 Testing BUY with real USDC...\n");

    // Trader 1 buys 100k USDC worth
    const buy1Amount = 100_000_000_000;
    await program.methods
      .buy(new anchor.BN(buy1Amount))
      .accounts({
        buyer: payer.publicKey,
        pool: poolPda,
        poolXnt,
        poolUsdc,
        buyerUsdc: trader1Usdc,
        buyerXnt: trader1Xnt,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    const pool1 = await program.account.pool.fetch(poolPda);
    const trader1XntBal = await provider.connection.getTokenAccountBalance(trader1Xnt);
    const poolUsdcBal1 = await provider.connection.getTokenAccountBalance(poolUsdc);

    console.log(`  Trader 1 bought ${parseInt(trader1XntBal.value.amount) / 1e6} XNT for $${buy1Amount / 1e6}`);
    console.log(`  Pool now has $${parseInt(poolUsdcBal1.value.amount) / 1e6} real USDC`);
    console.log(`  New price: $${(pool1.usdcReserve.toNumber() / pool1.xntReserve.toNumber()).toFixed(4)}`);

    // Trader 2 buys 200k USDC worth
    const buy2Amount = 200_000_000_000;
    await program.methods
      .buy(new anchor.BN(buy2Amount))
      .accounts({
        buyer: payer.publicKey,
        pool: poolPda,
        poolXnt,
        poolUsdc,
        buyerUsdc: trader2Usdc,
        buyerXnt: trader2Xnt,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    const pool2 = await program.account.pool.fetch(poolPda);
    const trader2XntBal = await provider.connection.getTokenAccountBalance(trader2Xnt);
    const poolUsdcBal2 = await provider.connection.getTokenAccountBalance(poolUsdc);

    console.log(`  Trader 2 bought ${parseInt(trader2XntBal.value.amount) / 1e6} XNT for $${buy2Amount / 1e6}`);
    console.log(`  Pool now has $${parseInt(poolUsdcBal2.value.amount) / 1e6} real USDC`);
    console.log(`  New price: $${(pool2.usdcReserve.toNumber() / pool2.xntReserve.toNumber()).toFixed(4)}\n`);

    assert.equal(parseInt(poolUsdcBal2.value.amount), buy1Amount + buy2Amount);
  });

  it("SELL: Trader sells XNT back for USDC", async () => {
    console.log("💸 Testing SELL with real tokens...\n");

    const poolBefore = await program.account.pool.fetch(poolPda);
    const priceBefore = poolBefore.usdcReserve.toNumber() / poolBefore.xntReserve.toNumber();

    const trader1XntBefore = await provider.connection.getTokenAccountBalance(trader1Xnt);
    const trader1UsdcBefore = await provider.connection.getTokenAccountBalance(trader1Usdc);
    const poolUsdcBefore = await provider.connection.getTokenAccountBalance(poolUsdc);

    // Trader 1 sells 10% of their XNT (small amount to ensure pool can afford it)
    // Pool has real USDC but virtual reserve is much larger
    const sellAmount = Math.floor(parseInt(trader1XntBefore.value.amount) * 0.10);

    console.log(`  Trader 1 selling ${sellAmount / 1e6} XNT...`);
    console.log(`  Price before: $${priceBefore.toFixed(4)}`);
    console.log(`  Pool has $${parseInt(poolUsdcBefore.value.amount) / 1e6} real USDC available`);
    console.log(`  Pool virtual USDC reserve: $${poolBefore.usdcReserve.toNumber() / 1e6}`);

    await program.methods
      .sell(new anchor.BN(sellAmount))
      .accounts({
        seller: payer.publicKey,
        pool: poolPda,
        poolXnt,
        poolUsdc,
        sellerXnt: trader1Xnt,
        sellerUsdc: trader1Usdc,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    const poolAfter = await program.account.pool.fetch(poolPda);
    const priceAfter = poolAfter.usdcReserve.toNumber() / poolAfter.xntReserve.toNumber();

    const trader1XntAfter = await provider.connection.getTokenAccountBalance(trader1Xnt);
    const trader1UsdcAfter = await provider.connection.getTokenAccountBalance(trader1Usdc);
    const poolUsdcAfter = await provider.connection.getTokenAccountBalance(poolUsdc);

    const usdcReceived = parseInt(trader1UsdcAfter.value.amount) - parseInt(trader1UsdcBefore.value.amount);

    console.log(`  Trader 1 received $${usdcReceived / 1e6} USDC`);
    console.log(`  Price after: $${priceAfter.toFixed(4)}`);
    console.log(`  Price decreased by ${((priceBefore - priceAfter) / priceBefore * 100).toFixed(2)}%`);
    console.log(`  Pool now has $${parseInt(poolUsdcAfter.value.amount) / 1e6} USDC\n`);

    assert.isTrue(priceAfter < priceBefore, "Price should decrease after SELL");
    assert.isTrue(usdcReceived > 0, "Trader should receive USDC");
  });

  it("DEPOSIT_XNT: Authority adds more XNT", async () => {
    console.log("📥 Testing DEPOSIT_XNT with real tokens...\n");

    const poolBefore = await program.account.pool.fetch(poolPda);
    const priceBefore = poolBefore.usdcReserve.toNumber() / poolBefore.xntReserve.toNumber();
    const depositAmount = 500_000_000_000; // 500k XNT

    console.log(`  Depositing ${depositAmount / 1e6} XNT to pool (without USDC)...`);
    console.log(`  Price before: $${priceBefore.toFixed(4)}`);
    console.log(`  This will DECREASE price (make XNT cheaper)`);

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
    const poolXntAfter = await provider.connection.getTokenAccountBalance(poolXnt);

    console.log(`  Pool XNT: ${parseInt(poolXntAfter.value.amount) / 1e6}`);
    console.log(`  Price after: $${priceAfter.toFixed(4)}`);
    console.log(`  Price decreased by ${((priceBefore - priceAfter) / priceBefore * 100).toFixed(2)}% (XNT became cheaper)`);
    console.log(`  ✅ XNT supply increased, price decreased!\n`);

    assert.isTrue(priceAfter < priceBefore, "Price should decrease when adding XNT without USDC");
  });

  it("ADD_LIQUIDITY: New LP adds proportional liquidity", async () => {
    console.log("💧 Testing ADD_LIQUIDITY with real tokens...\n");

    const poolBefore = await program.account.pool.fetch(poolPda);
    const priceBefore = poolBefore.usdcReserve.toNumber() / poolBefore.xntReserve.toNumber();

    // Mint tokens to LP
    const lpXnt = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      payer.payer,
      xntMint,
      payer.publicKey
    );
    const lpUsdc = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      payer.payer,
      usdcMint,
      payer.publicKey
    );

    const xntAmount = 100_000_000_000; // 100k XNT
    const usdcAmount = Math.floor(xntAmount * priceBefore); // Proportional USDC

    await mintTo(provider.connection, payer.payer, xntMint, lpXnt.address, payer.publicKey, xntAmount);
    await mintTo(provider.connection, payer.payer, usdcMint, lpUsdc.address, payer.publicKey, usdcAmount);

    console.log(`  Adding ${xntAmount / 1e6} XNT + $${usdcAmount / 1e6} USDC...`);

    const [lpPositionPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("lp_position"), poolPda.toBuffer(), payer.publicKey.toBuffer()],
      program.programId
    );

    await program.methods
      .addLiquidity(
        new anchor.BN(xntAmount),
        new anchor.BN(usdcAmount),
        new anchor.BN(1)
      )
      .accounts({
        lpProvider: payer.publicKey,
        pool: poolPda,
        poolXnt,
        poolUsdc,
        lpXnt: lpXnt.address,
        lpUsdc: lpUsdc.address,
        lpPosition: lpPositionPda,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    const poolAfter = await program.account.pool.fetch(poolPda);
    const priceAfter = poolAfter.usdcReserve.toNumber() / poolAfter.xntReserve.toNumber();
    const lpPosition = await program.account.lpPosition.fetch(lpPositionPda);

    console.log(`  LP received ${lpPosition.liquidity.toString()} liquidity tokens`);
    console.log(`  Price: $${priceAfter.toFixed(4)}`);
    console.log(`  ✅ Liquidity added!\n`);

    assert.approximately(priceAfter, priceBefore, 0.01, "Price should stay the same");
    assert.isTrue(lpPosition.liquidity.toNumber() > 0, "LP should receive tokens");
  });

  it("Final Summary", async () => {
    const pool = await program.account.pool.fetch(poolPda);
    const poolXntBal = await provider.connection.getTokenAccountBalance(poolXnt);
    const poolUsdcBal = await provider.connection.getTokenAccountBalance(poolUsdc);
    const currentPrice = pool.usdcReserve.toNumber() / pool.xntReserve.toNumber();

    console.log("\n╔══════════════════════════════════════════════════════════════╗");
    console.log("║           BONDING CURVE - REAL TOKENS TEST COMPLETE         ║");
    console.log("╚══════════════════════════════════════════════════════════════╝\n");
    console.log(`  📊 Real XNT in Pool: ${parseInt(poolXntBal.value.amount) / 1e6} XNT`);
    console.log(`  💵 Real USDC in Pool: $${parseInt(poolUsdcBal.value.amount) / 1e6}`);
    console.log(`  🔢 Virtual USDC Reserve: $${pool.usdcReserve.toNumber() / 1e6}`);
    console.log(`  💹 Current Price: $${currentPrice.toFixed(6)}`);
    console.log(`  📈 Total Trades: ${pool.tradeCount.toNumber()}`);
    console.log(`  💧 Total LP Tokens: ${pool.totalLiquidity.toString()}`);
    console.log("\n  ✅ All deposit methods tested with REAL SPL tokens!\n");
  });
});
