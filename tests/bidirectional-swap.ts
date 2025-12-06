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

describe("Bidirectional Swap", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.BondingCurve as Program<BondingCurve>;
  const payer = provider.wallet as anchor.Wallet;

  let xntMint: anchor.web3.PublicKey;
  let usdcMint: anchor.web3.PublicKey;
  let poolPda: anchor.web3.PublicKey;
  let poolXnt: anchor.web3.PublicKey;
  let poolUsdc: anchor.web3.PublicKey;
  let traderXnt: anchor.web3.PublicKey;
  let traderUsdc: anchor.web3.PublicKey;
  let ceilingReservePda: anchor.web3.PublicKey;
  let ceilingReserveXnt: anchor.web3.PublicKey;

  const INITIAL_XNT = 1_000_000_000_000; // 1M XNT (6 decimals)
  const VIRTUAL_USDC = 1_000_000_000_000; // 1M USDC (6 decimals)
  const PRICE_CEILING = 2_000_000; // $2.00 (6 decimals)
  const PRICE_FLOOR = 1_000_000; // $1.00 (6 decimals)

  before("Setup pool and accounts", async () => {
    console.log("\n🔧 Setting up bidirectional swap test environment...\n");

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

    // Create trader's token accounts
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

    // Mint initial XNT to trader
    await mintTo(
      provider.connection,
      payer.payer,
      xntMint,
      traderXnt,
      payer.publicKey,
      INITIAL_XNT
    );
    console.log(`✅ Minted ${INITIAL_XNT / 1e6} XNT to trader`);

    // Mint USDC to trader for buying
    const TRADER_USDC = 2_000_000_000_000; // 2M USDC
    await mintTo(
      provider.connection,
      payer.payer,
      usdcMint,
      traderUsdc,
      payer.publicKey,
      TRADER_USDC
    );
    console.log(`✅ Minted ${TRADER_USDC / 1e6} USDC to trader`);

    // Derive PDAs
    [poolPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("pool"), xntMint.toBuffer(), usdcMint.toBuffer()],
      program.programId
    );
    console.log(`📍 Pool PDA: ${poolPda.toBase58()}`);

    [ceilingReservePda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("ceiling_reserve"), poolPda.toBuffer()],
      program.programId
    );
    console.log(`📍 Ceiling Reserve PDA: ${ceilingReservePda.toBase58()}`);

    // Initialize pool
    console.log("\n💧 Initializing pool...\n");

    const poolXntKeypair = anchor.web3.Keypair.generate();
    const poolUsdcKeypair = anchor.web3.Keypair.generate();
    const ceilingReserveXntKeypair = anchor.web3.Keypair.generate();

    poolXnt = poolXntKeypair.publicKey;
    poolUsdc = poolUsdcKeypair.publicKey;
    ceilingReserveXnt = ceilingReserveXntKeypair.publicKey;

    const tx = await program.methods
      .initializePool(
        new anchor.BN(INITIAL_XNT),
        new anchor.BN(VIRTUAL_USDC),
        true, // price floor enabled
        new anchor.BN(PRICE_CEILING),
        new anchor.BN(PRICE_FLOOR)
      )
      .accounts({
        initializer: payer.publicKey,
        pool: poolPda,
        xntMint: xntMint,
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

    console.log(`✅ Pool initialized. TX: ${tx}`);

    const pool = await program.account.pool.fetch(poolPda);
    console.log(`   XNT Reserve: ${pool.xntReserve.toNumber() / 1e6}`);
    console.log(`   USDC Reserve (virtual): ${pool.usdcReserve.toNumber() / 1e6}`);
    console.log(`   Initial Price: $${(pool.usdcReserve.toNumber() / pool.xntReserve.toNumber()).toFixed(6)}`);
  });

  it("Executes BUY trade (USDC → XNT)", async () => {
    console.log("\n📈 Executing BUY: 100K USDC → XNT...\n");

    const usdcAmount = 100_000_000_000; // 100K USDC (6 decimals)

    // Get balances before
    const traderXntBefore = (
      await provider.connection.getTokenAccountBalance(traderXnt)
    ).value.amount;
    const traderUsdcBefore = (
      await provider.connection.getTokenAccountBalance(traderUsdc)
    ).value.amount;

    const poolBefore = await program.account.pool.fetch(poolPda);
    const priceBefore = poolBefore.usdcReserve.toNumber() / poolBefore.xntReserve.toNumber();

    console.log(`   Price Before: $${priceBefore.toFixed(6)}`);

    // Execute buy
    const tx = await program.methods
      .buy(new anchor.BN(usdcAmount))
      .accounts({
        buyer: payer.publicKey,
        pool: poolPda,
        xntMint: xntMint,
        usdcMint: usdcMint,
        poolXnt: poolXnt,
        poolUsdc: poolUsdc,
        buyerXnt: traderXnt,
        buyerUsdc: traderUsdc,
        ceilingReservePda: ceilingReservePda,
        ceilingReserveXnt: ceilingReserveXnt,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    console.log(`✅ BUY executed. TX: ${tx}`);

    // Get balances after
    const traderXntAfter = (
      await provider.connection.getTokenAccountBalance(traderXnt)
    ).value.amount;
    const traderUsdcAfter = (
      await provider.connection.getTokenAccountBalance(traderUsdc)
    ).value.amount;

    const poolAfter = await program.account.pool.fetch(poolPda);
    const priceAfter = poolAfter.usdcReserve.toNumber() / poolAfter.xntReserve.toNumber();

    const xntReceived = parseInt(traderXntAfter) - parseInt(traderXntBefore);
    const usdcSpent = parseInt(traderUsdcBefore) - parseInt(traderUsdcAfter);

    console.log(`   XNT Received: ${xntReceived / 1e6}`);
    console.log(`   USDC Spent: ${usdcSpent / 1e6}`);
    console.log(`   Price After: $${priceAfter.toFixed(6)}`);
    console.log(`   Price Impact: +${((priceAfter / priceBefore - 1) * 100).toFixed(2)}%`);

    assert.equal(usdcSpent, usdcAmount, "Should spend correct USDC amount");
    assert.isTrue(xntReceived > 0, "Should receive XNT");
    assert.isTrue(priceAfter > priceBefore, "Price should increase after buy");
  });

  it("Executes SELL trade (XNT → USDC)", async () => {
    console.log("\n📉 Executing SELL: 50K XNT → USDC...\n");

    const xntAmount = 50_000_000_000; // 50K XNT (6 decimals)

    // Get balances before
    const traderXntBefore = (
      await provider.connection.getTokenAccountBalance(traderXnt)
    ).value.amount;
    const traderUsdcBefore = (
      await provider.connection.getTokenAccountBalance(traderUsdc)
    ).value.amount;

    const poolBefore = await program.account.pool.fetch(poolPda);
    const priceBefore = poolBefore.usdcReserve.toNumber() / poolBefore.xntReserve.toNumber();

    console.log(`   Price Before: $${priceBefore.toFixed(6)}`);

    // Execute sell
    const tx = await program.methods
      .sell(new anchor.BN(xntAmount))
      .accounts({
        seller: payer.publicKey,
        pool: poolPda,
        xntMint: xntMint,
        usdcMint: usdcMint,
        poolXnt: poolXnt,
        poolUsdc: poolUsdc,
        sellerXnt: traderXnt,
        sellerUsdc: traderUsdc,
        ceilingReservePda: ceilingReservePda,
        ceilingReserveXnt: ceilingReserveXnt,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    console.log(`✅ SELL executed. TX: ${tx}`);

    // Get balances after
    const traderXntAfter = (
      await provider.connection.getTokenAccountBalance(traderXnt)
    ).value.amount;
    const traderUsdcAfter = (
      await provider.connection.getTokenAccountBalance(traderUsdc)
    ).value.amount;

    const poolAfter = await program.account.pool.fetch(poolPda);
    const priceAfter = poolAfter.usdcReserve.toNumber() / poolAfter.xntReserve.toNumber();

    const xntSpent = parseInt(traderXntBefore) - parseInt(traderXntAfter);
    const usdcReceived = parseInt(traderUsdcAfter) - parseInt(traderUsdcBefore);

    console.log(`   XNT Spent: ${xntSpent / 1e6}`);
    console.log(`   USDC Received: ${usdcReceived / 1e6}`);
    console.log(`   Price After: $${priceAfter.toFixed(6)}`);
    console.log(`   Price Impact: ${((priceAfter / priceBefore - 1) * 100).toFixed(2)}%`);

    assert.equal(xntSpent, xntAmount, "Should spend correct XNT amount");
    assert.isTrue(usdcReceived > 0, "Should receive USDC");
    assert.isTrue(priceAfter < priceBefore, "Price should decrease after sell");
  });

  it("Executes multiple alternating BUY and SELL trades", async () => {
    console.log("\n🔄 Executing alternating BUY/SELL trades...\n");

    const poolInitial = await program.account.pool.fetch(poolPda);
    const initialPrice = poolInitial.usdcReserve.toNumber() / poolInitial.xntReserve.toNumber();
    console.log(`   Starting Price: $${initialPrice.toFixed(6)}`);

    // Execute 3 buys and 3 sells
    for (let i = 0; i < 3; i++) {
      // BUY
      const buyAmount = 50_000_000_000; // 50K USDC
      await program.methods
        .buy(new anchor.BN(buyAmount))
        .accounts({
          buyer: payer.publicKey,
          pool: poolPda,
          xntMint: xntMint,
          usdcMint: usdcMint,
          poolXnt: poolXnt,
          poolUsdc: poolUsdc,
          buyerXnt: traderXnt,
          buyerUsdc: traderUsdc,
          ceilingReservePda: ceilingReservePda,
          ceilingReserveXnt: ceilingReserveXnt,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();

      const poolAfterBuy = await program.account.pool.fetch(poolPda);
      const priceAfterBuy = poolAfterBuy.usdcReserve.toNumber() / poolAfterBuy.xntReserve.toNumber();
      console.log(`   Round ${i + 1} - After BUY: $${priceAfterBuy.toFixed(6)}`);

      // SELL
      const sellAmount = 30_000_000_000; // 30K XNT
      await program.methods
        .sell(new anchor.BN(sellAmount))
        .accounts({
          seller: payer.publicKey,
          pool: poolPda,
          xntMint: xntMint,
          usdcMint: usdcMint,
          poolXnt: poolXnt,
          poolUsdc: poolUsdc,
          sellerXnt: traderXnt,
          sellerUsdc: traderUsdc,
          ceilingReservePda: ceilingReservePda,
          ceilingReserveXnt: ceilingReserveXnt,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();

      const poolAfterSell = await program.account.pool.fetch(poolPda);
      const priceAfterSell = poolAfterSell.usdcReserve.toNumber() / poolAfterSell.xntReserve.toNumber();
      console.log(`   Round ${i + 1} - After SELL: $${priceAfterSell.toFixed(6)}`);

      // Add delay to respect defense cooldown (2 seconds)
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    const poolFinal = await program.account.pool.fetch(poolPda);
    const finalPrice = poolFinal.usdcReserve.toNumber() / poolFinal.xntReserve.toNumber();
    console.log(`   Final Price: $${finalPrice.toFixed(6)}`);
    console.log(`   Total Price Change: ${((finalPrice / initialPrice - 1) * 100).toFixed(2)}%`);

    assert.isTrue(finalPrice > 0, "Price should remain positive");
  });
});
