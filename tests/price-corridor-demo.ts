/**
 * Price Corridor Bot Demonstration
 *
 * Demonstrates how the bot defends the $1.00 - $2.00 price corridor
 * by automatically injecting/withdrawing XNT when price moves outside boundaries.
 *
 * Run: yarn test tests/price-corridor-demo.ts
 */

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

// Price corridor configuration (matching bot config)
const CORRIDOR = {
  FLOOR: 1.0,
  SOFT_LOW: 1.1,
  TARGET: 1.5,
  SOFT_HIGH: 1.9,
  CEILING: 2.0,
  GENTLE_PERCENT: 0.5,   // 50% move to target
  AGGRESSIVE_PERCENT: 1.0, // 100% move to target
};

describe("price-corridor-demo", () => {
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

  const INITIAL_XNT = 10_000_000_000_000; // 10M XNT at $1.00
  const VIRTUAL_USDC = 10_000_000_000_000; // 10M USDC (virtual)
  const BOT_RESERVE_XNT = 20_000_000_000_000; // 20M XNT for bot reserves

  // Statistics tracking
  let stats = {
    xntInjected: 0,
    xntWithdrawn: 0,
    interventions: 0,
    trades: 0,
  };

  // Helper: Format numbers
  function fmt(n: number): string {
    return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  // Helper: Calculate XNT delta to reach target price
  function calculateXntDelta(xntReserve: number, usdcReserve: number, targetPrice: number): number {
    // Target: target_price = usdc_reserve / new_xnt_reserve
    // Solve: new_xnt_reserve = usdc_reserve / target_price
    const targetXntReserve = usdcReserve / targetPrice;
    return targetXntReserve - xntReserve;
  }

  // Helper: Bot intervention logic (simulates what bot would do)
  async function checkAndIntervene(): Promise<void> {
    const pool = await program.account.pool.fetch(poolPda);
    const xntReserve = pool.xntReserve.toNumber();
    const usdcReserve = pool.usdcReserve.toNumber();
    const price = usdcReserve / xntReserve;

    console.log(`   💹 Current Price: $${price.toFixed(6)} | XNT: ${(xntReserve / 1e6).toFixed(2)}M | USDC: $${(usdcReserve / 1e6).toFixed(2)}M`);

    let interventionNeeded = false;
    let movePercent = 1.0;
    let reason = "";

    // Determine intervention
    if (price >= CORRIDOR.CEILING) {
      interventionNeeded = true;
      movePercent = CORRIDOR.AGGRESSIVE_PERCENT;
      reason = `🚨 CEILING BREACH ($${price.toFixed(2)} >= $${CORRIDOR.CEILING})`;
    } else if (price >= CORRIDOR.SOFT_HIGH) {
      interventionNeeded = true;
      movePercent = CORRIDOR.GENTLE_PERCENT;
      reason = `⚠️  SOFT HIGH BREACH ($${price.toFixed(2)} >= $${CORRIDOR.SOFT_HIGH})`;
    } else if (price <= CORRIDOR.FLOOR) {
      interventionNeeded = true;
      movePercent = CORRIDOR.AGGRESSIVE_PERCENT;
      reason = `🚨 FLOOR BREACH ($${price.toFixed(2)} <= $${CORRIDOR.FLOOR})`;
    } else if (price <= CORRIDOR.SOFT_LOW) {
      interventionNeeded = true;
      movePercent = CORRIDOR.GENTLE_PERCENT;
      reason = `⚠️  SOFT LOW BREACH ($${price.toFixed(2)} <= $${CORRIDOR.SOFT_LOW})`;
    }

    if (interventionNeeded) {
      const fullDelta = calculateXntDelta(xntReserve, usdcReserve, CORRIDOR.TARGET);
      const adjustedDelta = fullDelta * movePercent;

      console.log(`\n   ${"=".repeat(70)}`);
      console.log(`   ${reason}`);
      console.log(`   Current Price: $${price.toFixed(6)}`);
      console.log(`   Target Price:  $${CORRIDOR.TARGET.toFixed(2)}`);
      console.log(`   Full Delta:    ${(fullDelta / 1e6).toFixed(2)}M XNT`);
      console.log(`   Move:          ${(movePercent * 100).toFixed(0)}%`);
      console.log(`   Action Delta:  ${(adjustedDelta / 1e6).toFixed(2)}M XNT`);

      if (adjustedDelta > 0) {
        // Inject XNT (price too high)
        console.log(`   💉 INJECTING ${(adjustedDelta / 1e6).toFixed(2)}M XNT...`);

        await program.methods
          .depositXnt(new anchor.BN(Math.floor(adjustedDelta)))
          .accounts({
            authority: payer.publicKey,
            pool: poolPda,
            poolXnt,
            authorityXnt,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .rpc();

        stats.xntInjected += adjustedDelta;
        stats.interventions++;
      } else {
        // Withdraw XNT (price too low)
        const withdrawAmount = Math.abs(adjustedDelta);
        console.log(`   💊 WITHDRAWING ${(withdrawAmount / 1e6).toFixed(2)}M XNT...`);

        await program.methods
          .withdrawXnt(new anchor.BN(Math.floor(withdrawAmount)))
          .accounts({
            authority: payer.publicKey,
            pool: poolPda,
            poolXnt,
            authorityXnt,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .rpc();

        stats.xntWithdrawn += withdrawAmount;
        stats.interventions++;
      }

      // Show new price
      const poolAfter = await program.account.pool.fetch(poolPda);
      const priceAfter = poolAfter.usdcReserve.toNumber() / poolAfter.xntReserve.toNumber();
      const priceChange = ((priceAfter / price - 1) * 100).toFixed(2);

      console.log(`   ✅ New Price:     $${priceAfter.toFixed(6)}`);
      console.log(`   ✅ Price Change:  ${priceChange}%`);
      console.log(`   ${"=".repeat(70)}\n`);
    } else {
      console.log(`   ✅ Price within corridor - no intervention needed\n`);
    }
  }

  before("Setup environment", async () => {
    console.log("\n╔════════════════════════════════════════════════════════════╗");
    console.log("║        PRICE CORRIDOR BOT - LOCAL DEMONSTRATION           ║");
    console.log("╚════════════════════════════════════════════════════════════╝\n");

    console.log("🔧 Setting up test environment...\n");

    // Create mints
    xntMint = await createMint(provider.connection, payer.payer, payer.publicKey, null, 6);
    usdcMint = await createMint(provider.connection, payer.payer, payer.publicKey, null, 6);

    console.log(`✅ Created XNT mint: ${xntMint.toBase58()}`);
    console.log(`✅ Created USDC mint: ${usdcMint.toBase58()}`);

    // Create authority accounts (bot)
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

    // Mint XNT to authority (pool + bot reserves)
    await mintTo(
      provider.connection,
      payer.payer,
      xntMint,
      authorityXnt,
      payer.publicKey,
      INITIAL_XNT + BOT_RESERVE_XNT
    );

    // Create trader accounts
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
      100_000_000_000_000 // 100M USDC for trading
    );

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

  it("Initialize pool with 10M XNT at $1.00", async () => {
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
    const startingPrice = pool.usdcReserve.toNumber() / pool.xntReserve.toNumber();

    console.log("╔════════════════════════════════════════════════════════════╗");
    console.log("║                 INITIAL POOL STATE                        ║");
    console.log("╚════════════════════════════════════════════════════════════╝");
    console.log(`  XNT Reserve:   ${(pool.xntReserve.toNumber() / 1e6).toLocaleString()}M XNT`);
    console.log(`  USDC Reserve:  $${(pool.usdcReserve.toNumber() / 1e6).toLocaleString()}M (virtual)`);
    console.log(`  Starting Price: $${startingPrice.toFixed(2)}`);
    console.log(`  Bot Reserves:  ${(BOT_RESERVE_XNT / 1e6).toLocaleString()}M XNT\n`);

    console.log("╔════════════════════════════════════════════════════════════╗");
    console.log("║              PRICE CORRIDOR CONFIGURATION                 ║");
    console.log("╚════════════════════════════════════════════════════════════╝");
    console.log(`  💵 Price Floor:       $${CORRIDOR.FLOOR.toFixed(2)}`);
    console.log(`  📊 Soft Low:          $${CORRIDOR.SOFT_LOW.toFixed(2)}`);
    console.log(`  🎯 Target Price:      $${CORRIDOR.TARGET.toFixed(2)}`);
    console.log(`  📊 Soft High:         $${CORRIDOR.SOFT_HIGH.toFixed(2)}`);
    console.log(`  💵 Price Ceiling:     $${CORRIDOR.CEILING.toFixed(2)}`);
    console.log(`  🎯 Gentle Move:       ${(CORRIDOR.GENTLE_PERCENT * 100).toFixed(0)}% to target`);
    console.log(`  ⚡ Aggressive Move:   ${(CORRIDOR.AGGRESSIVE_PERCENT * 100).toFixed(0)}% to target\n`);

    assert.equal(startingPrice, 1.0, "Starting price should be $1.00");
  });

  it("Scenario 1: Buy pressure pushes price to soft high ($1.90) - Bot intervenes gently", async () => {
    console.log("╔════════════════════════════════════════════════════════════╗");
    console.log("║     SCENARIO 1: UPWARD PRESSURE - SOFT HIGH BREACH        ║");
    console.log("╚════════════════════════════════════════════════════════════╝\n");

    console.log("📈 Step 1: Market buys push price up...\n");

    // Execute multiple buys to push price toward $1.90
    let buyCount = 0;
    while (true) {
      const pool = await program.account.pool.fetch(poolPda);
      const price = pool.usdcReserve.toNumber() / pool.xntReserve.toNumber();

      if (price >= CORRIDOR.SOFT_HIGH) break;

      const buyAmount = new anchor.BN(500_000_000_000); // 500K USDC

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

      buyCount++;
      stats.trades++;

      if (buyCount % 3 === 0) {
        console.log(`   Trade ${buyCount}: Price now $${price.toFixed(6)}`);
      }

      if (buyCount >= 20) break; // Safety limit
    }

    console.log(`   ✅ Completed ${buyCount} buy orders\n`);

    console.log("🤖 Step 2: Bot detects soft high breach and intervenes...\n");
    await checkAndIntervene();

    // Verify price is back in corridor
    const pool = await program.account.pool.fetch(poolPda);
    const price = pool.usdcReserve.toNumber() / pool.xntReserve.toNumber();

    assert.isTrue(price < CORRIDOR.SOFT_HIGH, "Price should be below soft high after intervention");
    assert.isTrue(stats.xntInjected > 0, "Bot should have injected XNT");
  });

  it("Scenario 2: Continue buying to ceiling ($2.00) - Bot intervenes aggressively", async () => {
    console.log("╔════════════════════════════════════════════════════════════╗");
    console.log("║      SCENARIO 2: UPWARD PRESSURE - CEILING BREACH         ║");
    console.log("╚════════════════════════════════════════════════════════════╝\n");

    console.log("📈 Step 1: More buying pushes toward ceiling...\n");

    let buyCount = 0;
    while (true) {
      const pool = await program.account.pool.fetch(poolPda);
      const price = pool.usdcReserve.toNumber() / pool.xntReserve.toNumber();

      if (price >= CORRIDOR.CEILING) break;

      const buyAmount = new anchor.BN(800_000_000_000); // 800K USDC (larger buys)

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

      buyCount++;
      stats.trades++;

      if (buyCount % 2 === 0) {
        console.log(`   Trade ${buyCount}: Price now $${price.toFixed(6)}`);
      }

      if (buyCount >= 15) break; // Safety limit
    }

    console.log(`   ✅ Completed ${buyCount} buy orders\n`);

    console.log("🤖 Step 2: Bot detects ceiling breach and intervenes aggressively...\n");
    await checkAndIntervene();

    // Verify price is pulled back significantly
    const pool = await program.account.pool.fetch(poolPda);
    const price = pool.usdcReserve.toNumber() / pool.xntReserve.toNumber();

    assert.isTrue(price < CORRIDOR.CEILING, "Price should be below ceiling after intervention");
    assert.isTrue(price >= CORRIDOR.FLOOR, "Price should still be above floor");
  });

  it("Scenario 3: Sell pressure pushes toward floor - Bot withdraws XNT", async () => {
    console.log("╔════════════════════════════════════════════════════════════╗");
    console.log("║     SCENARIO 3: DOWNWARD PRESSURE - SOFT LOW BREACH       ║");
    console.log("╚════════════════════════════════════════════════════════════╝\n");

    console.log("📉 Step 1: Market sells push price down...\n");

    let sellCount = 0;
    while (true) {
      const pool = await program.account.pool.fetch(poolPda);
      const price = pool.usdcReserve.toNumber() / pool.xntReserve.toNumber();

      if (price <= CORRIDOR.SOFT_LOW) break;

      const sellAmount = new anchor.BN(1_000_000_000_000); // 1M XNT

      await program.methods
        .sell(sellAmount)
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

      sellCount++;
      stats.trades++;

      if (sellCount % 3 === 0) {
        console.log(`   Trade ${sellCount}: Price now $${price.toFixed(6)}`);
      }

      if (sellCount >= 20) break; // Safety limit
    }

    console.log(`   ✅ Completed ${sellCount} sell orders\n`);

    console.log("🤖 Step 2: Bot detects soft low breach and withdraws XNT...\n");
    await checkAndIntervene();

    // Verify price is back in corridor
    const pool = await program.account.pool.fetch(poolPda);
    const price = pool.usdcReserve.toNumber() / pool.xntReserve.toNumber();

    assert.isTrue(price > CORRIDOR.SOFT_LOW, "Price should be above soft low after intervention");
    assert.isTrue(stats.xntWithdrawn > 0, "Bot should have withdrawn XNT");
  });

  it("Final summary: Bot successfully defended price corridor", async () => {
    const pool = await program.account.pool.fetch(poolPda);
    const finalPrice = pool.usdcReserve.toNumber() / pool.xntReserve.toNumber();

    console.log("\n╔════════════════════════════════════════════════════════════╗");
    console.log("║                  DEMONSTRATION SUMMARY                    ║");
    console.log("╚════════════════════════════════════════════════════════════╝\n");

    console.log("📊 Bot Performance:");
    console.log(`  💉 XNT Injected:       ${(stats.xntInjected / 1e6).toLocaleString()}M XNT`);
    console.log(`  💊 XNT Withdrawn:      ${(stats.xntWithdrawn / 1e6).toLocaleString()}M XNT`);
    console.log(`  📊 Net XNT Position:   ${((stats.xntInjected - stats.xntWithdrawn) / 1e6).toLocaleString()}M XNT`);
    console.log(`  🔧 Interventions:      ${stats.interventions}`);
    console.log(`  📈 Market Trades:      ${stats.trades}\n`);

    console.log("💹 Final Pool State:");
    console.log(`  XNT Reserve:   ${(pool.xntReserve.toNumber() / 1e6).toLocaleString()}M XNT`);
    console.log(`  USDC Reserve:  $${(pool.usdcReserve.toNumber() / 1e6).toLocaleString()}M`);
    console.log(`  Final Price:   $${finalPrice.toFixed(6)}`);
    console.log(`  Price Status:  ${finalPrice >= CORRIDOR.FLOOR && finalPrice <= CORRIDOR.CEILING ? "✅ IN CORRIDOR" : "❌ OUT OF CORRIDOR"}\n`);

    console.log("🎯 Intervention Strategy Demonstrated:");
    console.log(`  ✅ Gentle intervention when price hits soft boundaries ($${CORRIDOR.SOFT_LOW}/$${CORRIDOR.SOFT_HIGH})`);
    console.log(`  ✅ Aggressive intervention when price hits hard boundaries ($${CORRIDOR.FLOOR}/$${CORRIDOR.CEILING})`);
    console.log(`  ✅ Inject XNT when price too high (increases supply, lowers price)`);
    console.log(`  ✅ Withdraw XNT when price too low (reduces supply, raises price)`);
    console.log(`  ✅ Target price: $${CORRIDOR.TARGET.toFixed(2)}\n`);

    console.log("🚀 Production Bot Commands:");
    console.log(`  Start bot:`);
    console.log(`    npx ts-node bots/price-corridor-bot.ts --pool-address ${poolPda.toBase58()}\n`);
    console.log(`  Test simulator:`);
    console.log(`    npx ts-node bots/test-corridor-bot.ts\n`);

    // Verify corridor was maintained
    assert.isTrue(
      finalPrice >= CORRIDOR.FLOOR && finalPrice <= CORRIDOR.CEILING,
      `Final price should be in corridor ($${CORRIDOR.FLOOR}-$${CORRIDOR.CEILING})`
    );
    assert.isTrue(stats.interventions > 0, "Bot should have intervened at least once");
  });
});
