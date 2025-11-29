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

describe("bonding-curve-to-dex", () => {
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
  let traderUsdc: anchor.web3.PublicKey;
  let traderXnt: anchor.web3.PublicKey;

  const INITIAL_XNT = 5_000_000_000_000; // 5M XNT (6 decimals) - single-sided liquidity
  const VIRTUAL_USDC = 5_000_000_000_000; // 5M USDC virtual reserve - maintains $1.00 price

  // Helper functions for table formatting
  function fmt(n: number): string {
    return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function printTableHeader() {
    console.log("╔═══════╦═══════════════╦══════════════════╦═══════════════╦═══════════════╦═══════════════╦═══════════════╦═══════════════╗");
    console.log("║ Trade ║   USDC In     ║    XNT Out       ║  Eff. Price   ║  New Price    ║  Real USDC    ║  XNT Reserve  ║  Bal. Diff %  ║");
    console.log("╠═══════╬═══════════════╬══════════════════╬═══════════════╬═══════════════╬═══════════════╬═══════════════╬═══════════════╣");
  }

  function printTableFooter() {
    console.log("╚═══════╩═══════════════╩══════════════════╩═══════════════╩═══════════════╩═══════════════╩═══════════════╩═══════════════╝");
  }

  function printTableRow(
    tradeNum: number,
    usdcIn: number,
    xntOut: number,
    effectivePrice: number,
    newPrice: number,
    realUsdc: number,
    xntReserve: number,
    balanceDiffPct: number
  ) {
    const tradeStr = String(tradeNum).padStart(5);
    const usdcInStr = ("$" + fmt(usdcIn / 1e6)).padStart(13);
    const xntOutStr = (fmt(xntOut / 1e6) + " XNT").padStart(16);
    const effPriceStr = ("$" + effectivePrice.toFixed(4)).padStart(13);
    const newPriceStr = ("$" + newPrice.toFixed(4)).padStart(13);
    const realUsdcStr = ("$" + fmt(realUsdc / 1e6)).padStart(13);
    const xntResStr = (fmt(xntReserve / 1e6) + "M").padStart(13);
    const balanceStr = (balanceDiffPct.toFixed(1) + "%").padStart(13);

    console.log(`║ ${tradeStr} ║ ${usdcInStr} ║ ${xntOutStr} ║ ${effPriceStr} ║ ${newPriceStr} ║ ${realUsdcStr} ║ ${xntResStr} ║ ${balanceStr} ║`);
  }

  before("Setup mints and accounts", async () => {
    console.log("\n🔧 Setting up test environment...\n");

    // Create mints
    xntMint = await createMint(provider.connection, payer.payer, payer.publicKey, null, 6);
    usdcMint = await createMint(provider.connection, payer.payer, payer.publicKey, null, 6);

    console.log(`✅ Created XNT mint: ${xntMint.toBase58()}`);
    console.log(`✅ Created USDC mint: ${usdcMint.toBase58()}`);

    // Create authority's XNT account
    const authorityXntAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      payer.payer,
      xntMint,
      payer.publicKey
    );
    authorityXnt = authorityXntAccount.address;
    await mintTo(provider.connection, payer.payer, xntMint, authorityXnt, payer.publicKey, INITIAL_XNT * 2);

    // Create trader accounts with lots of USDC for buying
    const traderUsdcAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      payer.payer,
      usdcMint,
      payer.publicKey
    );
    traderUsdc = traderUsdcAccount.address;
    await mintTo(provider.connection, payer.payer, usdcMint, traderUsdc, payer.publicKey, 10_000_000_000_000); // 10M USDC

    const traderXntAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      payer.payer,
      xntMint,
      payer.publicKey
    );
    traderXnt = traderXntAccount.address;

    // Derive pool PDA
    [poolPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("pool"), xntMint.toBuffer(), usdcMint.toBuffer()],
      program.programId
    );

    console.log(`✅ Pool PDA: ${poolPda.toBase58()}\n`);
  });

  it("Initialize pool with single-sided XNT liquidity", async () => {
    console.log("📊 Initializing bonding curve pool...\n");

    const poolXntKeypair = anchor.web3.Keypair.generate();
    const poolUsdcKeypair = anchor.web3.Keypair.generate();
    poolXnt = poolXntKeypair.publicKey;
    poolUsdc = poolUsdcKeypair.publicKey;

    await program.methods
      .initializePool(new anchor.BN(INITIAL_XNT), new anchor.BN(VIRTUAL_USDC))
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

    console.log(`╔════════════════════════════════════════════════════════════╗`);
    console.log(`║           INITIAL POOL STATE (SINGLE-SIDED)              ║`);
    console.log(`╚════════════════════════════════════════════════════════════╝`);
    console.log(`  Real XNT:     ${(parseInt(poolXntBalance.value.amount) / 1e6).toLocaleString()} XNT`);
    console.log(`  Real USDC:    $${(parseInt(poolUsdcBalance.value.amount) / 1e6).toLocaleString()}`);
    console.log(`  Virtual USDC: $${(pool.usdcReserve.toNumber() / 1e6).toLocaleString()}`);
    console.log(`  Price:        $${(pool.usdcReserve.toNumber() / pool.xntReserve.toNumber()).toFixed(6)}`);
    console.log(`  Constant k:   ${pool.k.toString()}\n`);
  });

  it("Buy XNT until pool reaches 50/50 balanced liquidity (graduation)", async () => {
    console.log("💰 Simulating market buying until 50/50 balanced pool (DEX graduation)...\n");

    const pool = await program.account.pool.fetch(poolPda);
    const startingXnt = pool.xntReserve.toNumber();

    console.log(`🎯 Graduation Target: Equal token balances`);
    console.log(`   - Real XNT amount ≈ Real USDC amount (within 5%)`);
    console.log(`   - Trading locks automatically when criteria met`);
    console.log(`   - Example: 2M XNT and 2M USDC (±5%)\n`);

    let buyCount = 0;
    let totalUsdcSpent = 0;
    let totalXntReceived = 0;

    // Smaller buy amounts to ensure at least 20 trades
    const buyAmount = 200_000_000_000; // 200k USDC per buy

    console.log(`\n╔════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════╗`);
    console.log(`║                                     BONDING CURVE TO DEX - GRADUATION TRADES                                              ║`);
    console.log(`╚════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════╝\n`);

    printTableHeader();

    while (true) {
      const poolBefore = await program.account.pool.fetch(poolPda);
      const poolXntBalance = await provider.connection.getTokenAccountBalance(poolXnt);
      const poolUsdcBalance = await provider.connection.getTokenAccountBalance(poolUsdc);

      const realXnt = parseInt(poolXntBalance.value.amount);
      const realUsdc = parseInt(poolUsdcBalance.value.amount);

      // Check if balances are equal within 5% tolerance
      const larger = Math.max(realXnt, realUsdc);
      const smaller = Math.min(realXnt, realUsdc);
      const balanceDiffPct = smaller > 0 ? ((larger - smaller) / larger) * 100 : 100;
      const balancesAreEqual = balanceDiffPct <= 5;

      // Get trader balance before trade
      const traderXntBefore = await provider.connection.getTokenAccountBalance(traderXnt);

      // Execute buy - will throw TradingLocked error when pool graduates
      try {
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
      } catch (err) {
        // Check if this is the TradingLocked error (pool graduated)
        if (err.toString().includes("TradingLocked") || err.toString().includes("6007")) {
          printTableFooter();
          console.log(`\n🎓 POOL GRADUATED! Trading automatically locked.\n`);

          // Fetch final balances
          const finalPoolXnt = await provider.connection.getTokenAccountBalance(poolXnt);
          const finalPoolUsdc = await provider.connection.getTokenAccountBalance(poolUsdc);
          const finalRealXnt = parseInt(finalPoolXnt.value.amount);
          const finalRealUsdc = parseInt(finalPoolUsdc.value.amount);
          const finalLarger = Math.max(finalRealXnt, finalRealUsdc);
          const finalSmaller = Math.min(finalRealXnt, finalRealUsdc);
          const finalBalanceDiff = ((finalLarger - finalSmaller) / finalLarger) * 100;

          console.log(`   ✅ Balances are equal: XNT ${(finalRealXnt / 1e6).toLocaleString()} ≈ USDC ${(finalRealUsdc / 1e6).toLocaleString()}`);
          console.log(`   ✅ Difference: ${finalBalanceDiff.toFixed(2)}% (≤5% tolerance)`);
          console.log(`   ✅ Total trades: ${buyCount}\n`);
          break;
        }
        // If it's a different error, rethrow it
        throw err;
      }

      buyCount++;
      totalUsdcSpent += buyAmount;

      const traderXntAfter = await provider.connection.getTokenAccountBalance(traderXnt);
      const xntReceived = parseInt(traderXntAfter.value.amount) - parseInt(traderXntBefore.value.amount);
      totalXntReceived += xntReceived;

      const poolAfter = await program.account.pool.fetch(poolPda);
      const poolUsdcAfter = await provider.connection.getTokenAccountBalance(poolUsdc);
      const realUsdcAfter = parseInt(poolUsdcAfter.value.amount);
      const priceAfter = poolAfter.usdcReserve.toNumber() / poolAfter.xntReserve.toNumber();

      // Recalculate balance equality after trade
      const poolXntAfter = await provider.connection.getTokenAccountBalance(poolXnt);
      const realXntAfter = parseInt(poolXntAfter.value.amount);

      const largerAfter = Math.max(realXntAfter, realUsdcAfter);
      const smallerAfter = Math.min(realXntAfter, realUsdcAfter);
      const balanceDiffPctAfter = smallerAfter > 0 ? ((largerAfter - smallerAfter) / largerAfter) * 100 : 100;

      // Calculate effective price for this trade
      const effectivePrice = buyAmount / xntReceived;

      // Print table row (using balance diff % instead of USDC %)
      printTableRow(
        buyCount,
        buyAmount,
        xntReceived,
        effectivePrice,
        priceAfter,
        realUsdcAfter,
        poolAfter.xntReserve.toNumber(),
        balanceDiffPctAfter
      );

      // Note: Graduation happens automatically in the contract when balances are equal
      // The next trade attempt will fail with TradingLocked error

      // Prevent infinite loop
      if (buyCount >= 100) {
        printTableFooter();
        console.log(`\n⚠️  Reached max buy limit (100 buys)\n`);
        console.log(`   Current balance: USDC ${usdcPctAfter.toFixed(1)}% / XNT ${(100-usdcPctAfter).toFixed(1)}%`);
        console.log(`   May need more buying to reach 50/50\n`);
        break;
      }
    }

    console.log(`\n╔════════════════════════════════════════════════════════════╗`);
    console.log(`║                   GRADUATION SUMMARY                      ║`);
    console.log(`╚════════════════════════════════════════════════════════════╝`);
    console.log(`  Total Trades:     ${buyCount}`);
    console.log(`  Total USDC Spent: $${(totalUsdcSpent / 1e6).toLocaleString()}`);
    console.log(`  Total XNT Bought: ${(totalXntReceived / 1e6).toLocaleString()} XNT`);
    console.log(`  Avg Price:        $${(totalUsdcSpent / totalXntReceived).toFixed(6)}\n`);

    // Verify that pool has graduated
    const finalPool = await program.account.pool.fetch(poolPda);
    assert.isTrue(finalPool.isGraduated, "Pool should be graduated after reaching equal balances");
  });

  it("Final pool state: Ready for DEX migration", async () => {
    const pool = await program.account.pool.fetch(poolPda);
    const poolXntBalance = await provider.connection.getTokenAccountBalance(poolXnt);
    const poolUsdcBalance = await provider.connection.getTokenAccountBalance(poolUsdc);

    const realXnt = parseInt(poolXntBalance.value.amount);
    const realUsdc = parseInt(poolUsdcBalance.value.amount);
    const virtualUsdc = pool.usdcReserve.toNumber();
    const currentPrice = virtualUsdc / pool.xntReserve.toNumber();

    // Calculate pool value
    const xntValueInUsdc = realXnt * currentPrice;
    const totalPoolValue = xntValueInUsdc + realUsdc;
    const usdcPercentage = (realUsdc / totalPoolValue) * 100;
    const xntPercentage = (xntValueInUsdc / totalPoolValue) * 100;

    console.log(`\n╔════════════════════════════════════════════════════════════╗`);
    console.log(`║          FINAL POOL STATE - READY FOR DEX                 ║`);
    console.log(`╚════════════════════════════════════════════════════════════╝\n`);

    console.log(`📊 Pool Reserves:`);
    console.log(`  Real XNT:          ${(realXnt / 1e6).toLocaleString()} XNT`);
    console.log(`  Real USDC:         $${(realUsdc / 1e6).toLocaleString()}`);
    console.log(`  Virtual USDC:      $${(virtualUsdc / 1e6).toLocaleString()}`);
    console.log(``);

    console.log(`💹 Pricing:`);
    console.log(`  Current Price:     $${currentPrice.toFixed(6)}`);
    console.log(`  Price Change:      +${((currentPrice - 1.0) * 100).toFixed(2)}% from $1.00`);
    console.log(``);

    console.log(`💧 Liquidity Analysis:`);
    console.log(`  XNT Value:         $${(xntValueInUsdc / 1e6).toFixed(2)} (${xntPercentage.toFixed(1)}%)`);
    console.log(`  USDC Value:        $${(realUsdc / 1e6).toFixed(2)} (${usdcPercentage.toFixed(1)}%)`);
    console.log(`  Total Pool Value:  $${(totalPoolValue / 1e6).toFixed(2)}`);
    console.log(``);

    console.log(`📈 Trading Stats:`);
    console.log(`  Total Trades:      ${pool.tradeCount.toString()}`);
    console.log(`  Constant k:        ${pool.k.toString()}`);
    console.log(``);

    // Check graduation criteria - now based on token amount equality
    const larger = Math.max(realXnt, realUsdc);
    const smaller = Math.min(realXnt, realUsdc);
    const balanceDiffPct = smaller > 0 ? ((larger - smaller) / larger) * 100 : 100;
    const virtualReplacementPct = (realUsdc / virtualUsdc) * 100;

    console.log(`🎓 Graduation Status:`);
    if (pool.isGraduated) {
      console.log(`   ✅ GRADUATED - Ready for DEX Migration!`);
      console.log(`   ✅ Token Balances Equal: XNT ${(realXnt / 1e6).toLocaleString()} ≈ USDC ${(realUsdc / 1e6).toLocaleString()}`);
      console.log(`   ✅ Balance Difference: ${balanceDiffPct.toFixed(2)}% (≤5% tolerance)`);
      console.log(`   ✅ Trades: ${pool.tradeCount.toString()}`);
      console.log(`   ✅ Virtual USDC replaced: ${virtualReplacementPct.toFixed(1)}%`);
    } else {
      console.log(`   ⚠️  NOT YET GRADUATED`);
      console.log(`   ❌ Token Balances: XNT ${(realXnt / 1e6).toLocaleString()} vs USDC ${(realUsdc / 1e6).toLocaleString()}`);
      console.log(`   ❌ Balance Difference: ${balanceDiffPct.toFixed(2)}% (need ≤5%)`);
      console.log(`   Trades: ${pool.tradeCount.toString()}`);
      console.log(`   Virtual USDC replaced: ${virtualReplacementPct.toFixed(1)}%`);
    }

    console.log(``);
    console.log(`🚀 Next Steps:`);
    console.log(`   1. Withdraw ${(realXnt / 1e6).toLocaleString()} XNT from bonding curve`);
    console.log(`   2. Withdraw $${(realUsdc / 1e6).toLocaleString()} USDC from bonding curve`);
    console.log(`   3. Create XNT/USDC pool on XDEX with these reserves`);
    console.log(`   4. Set initial price at $${currentPrice.toFixed(6)}`);
    console.log(``);

    // Verify graduation criteria
    assert.isTrue(pool.isGraduated, `Pool should be graduated (balances equal within 5%)`);
    assert.isTrue(balanceDiffPct <= 5, `Balance difference should be ≤5%, got ${balanceDiffPct.toFixed(2)}%`);
    assert.isTrue(currentPrice > 1.0, "Price should be above initial $1.00");
  });
});
