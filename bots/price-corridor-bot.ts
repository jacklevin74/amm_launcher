/**
 * XNT Price Corridor Defense Bot
 *
 * Maintains XNT price within $1.00 - $2.00 corridor by:
 * - Injecting XNT when price goes too high (deposit_xnt)
 * - Withdrawing XNT when price goes too low (withdraw_xnt)
 *
 * Usage:
 *   npx ts-node bots/price-corridor-bot.ts [--pool-address <address>] [--interval <ms>]
 */

import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider, Wallet } from "@coral-xyz/anchor";
import { BondingCurve } from "../target/types/bonding_curve";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  getOrCreateAssociatedTokenAccount,
} from "@solana/spl-token";
import fs from "fs";

// ========== CONFIGURATION ==========
const CONFIG = {
  // Price corridor boundaries
  PRICE_CEILING: 2.0,          // Maximum price (hard ceiling)
  PRICE_FLOOR: 1.0,            // Minimum price (hard floor)
  AGGRESSIVE_TARGET: 1.96,     // Target 2% below ceiling for aggressive defense
  AGGRESSIVE_TARGET_FLOOR: 1.04, // Target 4% above floor for aggressive defense
  SOFT_HIGH: 2.0,              // Start intervention at ceiling only
  SOFT_LOW: 1.0,               // Start intervention at floor only

  // Intervention settings
  AGGRESSIVE_PERCENT: 1.0,     // Move 100% to target on ceiling/floor breach
  GENTLE_PERCENT: 0.5,         // Move 50% to target on soft boundary breach
  MAX_PRICE_CHANGE_PERCENT: 0.03, // Cap price change at 3% per intervention
  MIN_INTERVENTION_AMOUNT: 1000_000, // Minimum 1 XNT to prevent micro-interventions

  // Bot reserves (starting XNT balance for interventions)
  BOT_RESERVE_XNT: 100_000_000_000_000, // 100M XNT (10x more ammunition)

  // Monitoring
  POLL_INTERVAL_MS: 1500,      // Check price every 1.5 seconds (3x faster)

  // RPC
  RPC_URL: process.env.ANCHOR_PROVIDER_URL || "http://localhost:8899",
  WALLET_PATH: process.env.ANCHOR_WALLET || `${process.env.HOME}/.config/solana/id.json`,
};

// ========== TYPES ==========
interface BotState {
  xntInjected: number;
  xntWithdrawn: number;
  interventionCount: number;
  lastIntervention: Date | null;
  usdcCollected: number;
}

interface PoolState {
  xntReserve: number;
  usdcReserve: number;
  price: number;
  realXnt: number;
  realUsdc: number;
  tradeCount: number;
}

// ========== BOT CLASS ==========
class PriceCorridorBot {
  private program: Program<BondingCurve>;
  private provider: AnchorProvider;
  private authority: Keypair;
  private poolAddress: PublicKey;
  private state: BotState;
  private isRunning: boolean;
  private previousState: PoolState | null = null;

  // Pool accounts
  private poolXnt: PublicKey | null = null;
  private poolUsdc: PublicKey | null = null;
  private authorityXnt: PublicKey | null = null;
  private authorityUsdc: PublicKey | null = null;
  private xntMint: PublicKey | null = null;
  private usdcMint: PublicKey | null = null;

  constructor(poolAddress: string) {
    this.poolAddress = new PublicKey(poolAddress);
    this.isRunning = false;

    // Load wallet
    const walletKeypair = Keypair.fromSecretKey(
      Buffer.from(JSON.parse(fs.readFileSync(CONFIG.WALLET_PATH, "utf-8")))
    );
    this.authority = walletKeypair;

    // Setup provider and program
    const connection = new Connection(CONFIG.RPC_URL, "confirmed");
    const wallet = new Wallet(walletKeypair);
    this.provider = new AnchorProvider(connection, wallet, {
      commitment: "confirmed",
    });
    anchor.setProvider(this.provider);

    this.program = anchor.workspace.BondingCurve as Program<BondingCurve>;

    // Initialize bot state
    this.state = {
      xntInjected: 0,
      xntWithdrawn: 0,
      interventionCount: 0,
      lastIntervention: null,
      usdcCollected: 0,
    };
  }

  // Initialize bot by fetching pool accounts
  async initialize(): Promise<void> {
    console.log("🤖 Initializing Price Corridor Bot...\n");
    console.log(`📍 Pool Address: ${this.poolAddress.toBase58()}`);
    console.log(`👤 Authority: ${this.authority.publicKey.toBase58()}`);
    console.log(`🌐 RPC: ${CONFIG.RPC_URL}\n`);

    try {
      // Fetch pool to get mint addresses
      const pool = await this.program.account.pool.fetch(this.poolAddress);

      this.xntMint = pool.xntMint;
      this.usdcMint = pool.usdcMint;
      this.poolXnt = pool.poolXnt;
      this.poolUsdc = pool.poolUsdc;

      console.log(`🪙  XNT Mint: ${this.xntMint.toBase58()}`);
      console.log(`💵 USDC Mint: ${this.usdcMint.toBase58()}\n`);

      // Get or create authority token accounts
      const authorityXntAccount = await getOrCreateAssociatedTokenAccount(
        this.provider.connection,
        this.authority,
        this.xntMint,
        this.authority.publicKey
      );
      this.authorityXnt = authorityXntAccount.address;

      const authorityUsdcAccount = await getOrCreateAssociatedTokenAccount(
        this.provider.connection,
        this.authority,
        this.usdcMint,
        this.authority.publicKey
      );
      this.authorityUsdc = authorityUsdcAccount.address;

      console.log(`✅ Bot initialized successfully!\n`);

      // Display configuration
      this.displayConfig();
    } catch (error) {
      console.error("❌ Failed to initialize bot:", error);
      throw error;
    }
  }

  // Display bot configuration
  private displayConfig(): void {
    console.log("╔════════════════════════════════════════════════════════════╗");
    console.log("║         PRICE CORRIDOR DEFENSE BOT (FLOOR + CEILING)     ║");
    console.log("╚════════════════════════════════════════════════════════════╝");
    console.log(`  💵 Price Ceiling:     $${CONFIG.PRICE_CEILING.toFixed(2)} (hard limit)`);
    console.log(`  🎯 Ceiling Target:    $${CONFIG.AGGRESSIVE_TARGET.toFixed(2)} (2% below ceiling)`);
    console.log(`  📊 Soft High:         $${CONFIG.SOFT_HIGH.toFixed(2)} (intervention starts)`);
    console.log(``);
    console.log(`  💰 Price Floor:       $${CONFIG.PRICE_FLOOR.toFixed(2)} (hard limit)`);
    console.log(`  🎯 Floor Target:      $${CONFIG.AGGRESSIVE_TARGET_FLOOR.toFixed(2)} (4% above floor)`);
    console.log(`  📊 Soft Low:          $${CONFIG.SOFT_LOW.toFixed(2)} (intervention starts)`);
    console.log(``);
    console.log(`  📉 Max Price Change:  ${(CONFIG.MAX_PRICE_CHANGE_PERCENT * 100).toFixed(0)}% per intervention`);
    console.log(`  💪 Bot Reserve:       ${(CONFIG.BOT_RESERVE_XNT / 1e12).toFixed(0)}M XNT`);
    console.log(`  ⏱️  Poll Interval:     ${CONFIG.POLL_INTERVAL_MS}ms`);
    console.log("");
  }

  // Get current pool state
  async getPoolState(): Promise<PoolState> {
    const pool = await this.program.account.pool.fetch(this.poolAddress);

    // Get real balances
    const poolXntBalance = await this.provider.connection.getTokenAccountBalance(
      this.poolXnt!
    );
    const poolUsdcBalance = await this.provider.connection.getTokenAccountBalance(
      this.poolUsdc!
    );

    const xntReserve = pool.xntReserve.toNumber();
    const usdcReserve = pool.usdcReserve.toNumber();
    const price = usdcReserve / xntReserve;

    return {
      xntReserve,
      usdcReserve,
      price,
      realXnt: parseInt(poolXntBalance.value.amount),
      realUsdc: parseInt(poolUsdcBalance.value.amount),
      tradeCount: pool.tradeCount.toNumber(),
    };
  }

  // Calculate how much XNT to inject/withdraw to reach target price
  calculateXntDelta(currentState: PoolState, targetPrice: number): number {
    // Current: price = usdc_reserve / xnt_reserve
    // Target:  target_price = usdc_reserve / new_xnt_reserve
    // Solve:   new_xnt_reserve = usdc_reserve / target_price
    // Delta:   delta = new_xnt_reserve - xnt_reserve

    const targetXntReserve = currentState.usdcReserve / targetPrice;
    const delta = targetXntReserve - currentState.xntReserve;

    return delta;
  }

  // Inject XNT into pool (lowers price)
  async injectXnt(amount: number, reason: string): Promise<void> {
    console.log(`\n💉 INJECTING XNT: ${reason}`);

    // Check available balance
    const balance = await this.provider.connection.getTokenAccountBalance(this.authorityXnt!);
    const available = parseInt(balance.value.amount);

    if (amount > available) {
      console.log(`   ⚠️  Requested: ${(amount / 1e6).toLocaleString()}M XNT`);
      console.log(`   ⚠️  Available: ${(available / 1e6).toLocaleString()}M XNT`);
      console.log(`   📉 Using available amount instead`);
      amount = available * 0.9; // Use 90% of available to leave buffer
    }

    console.log(`   Amount: ${(amount / 1e6).toLocaleString()} XNT`);

    try {
      await this.program.methods
        .depositXnt(new anchor.BN(Math.floor(amount)))
        .accountsPartial({
          authority: this.authority.publicKey,
          pool: this.poolAddress,
          poolXnt: this.poolXnt!,
          authorityXnt: this.authorityXnt!,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();

      this.state.xntInjected += amount;
      this.state.interventionCount++;
      this.state.lastIntervention = new Date();

      console.log(`   ✅ Injection successful`);
    } catch (error) {
      console.error(`   ❌ Injection failed:`, error.message);
      // Continue monitoring even if intervention fails
    }
  }

  // Withdraw XNT from pool (raises price)
  async withdrawXnt(amount: number, reason: string): Promise<void> {
    console.log(`\n💊 WITHDRAWING XNT: ${reason}`);
    console.log(`   Amount: ${(amount / 1e6).toLocaleString()} XNT`);

    try {
      await this.program.methods
        .withdrawXnt(new anchor.BN(Math.floor(amount)))
        .accountsPartial({
          authority: this.authority.publicKey,
          pool: this.poolAddress,
          poolXnt: this.poolXnt!,
          authorityXnt: this.authorityXnt!,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();

      this.state.xntWithdrawn += amount;
      this.state.interventionCount++;
      this.state.lastIntervention = new Date();

      console.log(`   ✅ Withdrawal successful`);
    } catch (error) {
      console.error(`   ❌ Withdrawal failed:`, error);
      throw error;
    }
  }

  // Main intervention logic
  async checkAndIntervene(): Promise<void> {
    const state = await this.getPoolState();
    const price = state.price;

    // Detect regular trades by comparing with previous state
    if (this.previousState !== null && state.tradeCount > this.previousState.tradeCount) {
      // A trade occurred - determine if it was BUY or SELL
      const xntDelta = state.xntReserve - this.previousState.xntReserve;
      const usdcDelta = state.realUsdc - this.previousState.realUsdc;
      const timestamp = new Date().toISOString();

      if (xntDelta < 0 && usdcDelta > 0) {
        // BUY: Trader bought XNT (XNT decreased, USDC increased)
        const xntAmount = -xntDelta;
        const usdcAmount = usdcDelta;
        const priceChange = ((price / this.previousState.price - 1) * 100);

        // Cyan for BUY trades
        console.log(`\x1b[36m[${timestamp}] BUY  | Price: $${price.toFixed(6)} | XNT: ${(state.xntReserve / 1e6).toLocaleString()} | USDC: $${(state.realUsdc / 1e6).toLocaleString()} | Trade ${(xntAmount / 1e6).toFixed(2)} XNT for $${(usdcAmount / 1e6).toFixed(2)} (${priceChange.toFixed(2)}%)\x1b[0m`);
      } else if (xntDelta > 0 && usdcDelta < 0) {
        // SELL: Trader sold XNT (XNT increased, USDC decreased)
        const xntAmount = xntDelta;
        const usdcAmount = -usdcDelta;
        const priceChange = ((price / this.previousState.price - 1) * 100);

        // Red for SELL trades
        console.log(`\x1b[31m[${timestamp}] SELL | Price: $${price.toFixed(6)} | XNT: ${(state.xntReserve / 1e6).toLocaleString()} | USDC: $${(state.realUsdc / 1e6).toLocaleString()} | Trade ${(xntAmount / 1e6).toFixed(2)} XNT for $${(usdcAmount / 1e6).toFixed(2)} (${priceChange.toFixed(2)}%)\x1b[0m`);
      }
    }

    // Update previous state for next iteration
    this.previousState = state;

    // Log current status with action type
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] WATCH | Price: $${price.toFixed(6)} | XNT: ${(state.xntReserve / 1e6).toLocaleString()} | USDC: $${(state.realUsdc / 1e6).toLocaleString()}`);

    // Determine intervention needed
    let interventionNeeded = false;
    let targetPrice = 0;
    let movePercent = 1.0;
    let reason = "";

    if (price >= CONFIG.PRICE_CEILING) {
      // CRITICAL: Hit ceiling - aggressively push 2% below ceiling
      interventionNeeded = true;
      targetPrice = CONFIG.AGGRESSIVE_TARGET; // Target 2% below ceiling ($1.96)
      movePercent = CONFIG.GENTLE_PERCENT; // Use gentle 50% to avoid huge swings
      reason = `🚨 CEILING BREACH ($${price.toFixed(2)} >= $${CONFIG.PRICE_CEILING}) - Target $${CONFIG.AGGRESSIVE_TARGET}`;
    } else if (price >= CONFIG.SOFT_HIGH) {
      // WARNING: Approaching ceiling - gentle intervention
      interventionNeeded = true;
      targetPrice = CONFIG.SOFT_HIGH; // Target soft high ($2.00)
      movePercent = CONFIG.GENTLE_PERCENT;
      reason = `⚠️  APPROACHING CEILING ($${price.toFixed(2)} >= $${CONFIG.SOFT_HIGH})`;
    } else if (price <= CONFIG.PRICE_FLOOR) {
      // CRITICAL: Hit floor - aggressively push 4% above floor
      interventionNeeded = true;
      targetPrice = CONFIG.AGGRESSIVE_TARGET_FLOOR; // Target 4% above floor ($1.04)
      movePercent = CONFIG.GENTLE_PERCENT; // Use gentle 50% to avoid huge swings
      reason = `🚨 FLOOR BREACH ($${price.toFixed(2)} <= $${CONFIG.PRICE_FLOOR}) - Target $${CONFIG.AGGRESSIVE_TARGET_FLOOR}`;
    } else if (price <= CONFIG.SOFT_LOW) {
      // WARNING: Approaching floor - gentle intervention
      interventionNeeded = true;
      targetPrice = CONFIG.SOFT_LOW; // Target soft low ($1.00)
      movePercent = CONFIG.GENTLE_PERCENT;
      reason = `⚠️  APPROACHING FLOOR ($${price.toFixed(2)} <= $${CONFIG.SOFT_LOW})`;
    }

    if (interventionNeeded) {
      // Calculate full delta to target, then apply move percentage
      const fullDelta = this.calculateXntDelta(state, targetPrice);
      const adjustedDelta = fullDelta * movePercent;

      // Calculate maximum delta that would cause exactly MAX_PRICE_CHANGE_PERCENT price change
      // For price decrease (inject XNT): max_delta = X * change / (1 - change)
      // For price increase (withdraw XNT): max_delta = X * change / (1 + change)
      let maxDelta: number;
      if (adjustedDelta > 0) {
        // Injecting XNT (price will decrease)
        maxDelta = state.xntReserve * CONFIG.MAX_PRICE_CHANGE_PERCENT / (1 - CONFIG.MAX_PRICE_CHANGE_PERCENT);
      } else {
        // Withdrawing XNT (price will increase)
        maxDelta = state.xntReserve * CONFIG.MAX_PRICE_CHANGE_PERCENT / (1 + CONFIG.MAX_PRICE_CHANGE_PERCENT);
      }

      // Cap the intervention at max delta to limit price change to 3%
      const cappedDelta = Math.sign(adjustedDelta) * Math.min(Math.abs(adjustedDelta), maxDelta);
      const wasCapped = Math.abs(cappedDelta) < Math.abs(adjustedDelta);

      // Skip if intervention is too small (prevents micro-interventions)
      if (Math.abs(cappedDelta) < CONFIG.MIN_INTERVENTION_AMOUNT) {
        console.log(`\n✅ Price stable at $${price.toFixed(6)} (delta ${(cappedDelta / 1e6).toFixed(3)}M XNT < minimum ${(CONFIG.MIN_INTERVENTION_AMOUNT / 1e6).toFixed(0)}M XNT)\n`);
        return;
      }

      // Execute intervention and log in single colored line
      const timestampAction = new Date().toISOString();

      if (cappedDelta > 0) {
        // Inject XNT (B.BUY) - adds XNT to push price down
        await this.injectXnt(cappedDelta, reason);
        const newState = await this.getPoolState();
        const actualPriceChange = ((newState.price / price - 1) * 100);

        // Green for successful intervention (ceiling defense)
        console.log(`\x1b[32m[${timestampAction}] DEPOSIT | Price: $${newState.price.toFixed(6)} | XNT: ${(newState.xntReserve / 1e6).toLocaleString()} | USDC: $${(newState.realUsdc / 1e6).toLocaleString()} | Bot +${(cappedDelta / 1e6).toFixed(2)} XNT (${actualPriceChange.toFixed(2)}%)\x1b[0m`);
      } else {
        // Withdraw XNT (B.SELL) - removes XNT to push price up
        await this.withdrawXnt(-cappedDelta, reason);
        const newState = await this.getPoolState();
        const actualPriceChange = ((newState.price / price - 1) * 100);

        // Yellow for successful intervention (floor defense)
        console.log(`\x1b[33m[${timestampAction}] REMOVE | Price: $${newState.price.toFixed(6)} | XNT: ${(newState.xntReserve / 1e6).toLocaleString()} | USDC: $${(newState.realUsdc / 1e6).toLocaleString()} | Bot -${(-cappedDelta / 1e6).toFixed(2)} XNT (${actualPriceChange.toFixed(2)}%)\x1b[0m`);
      }
    }
  }

  // Display bot statistics
  displayStats(): void {
    console.log("\n╔════════════════════════════════════════════════════════════╗");
    console.log("║                    BOT STATISTICS                         ║");
    console.log("╚════════════════════════════════════════════════════════════╝");
    console.log(`  💉 XNT Injected:       ${(this.state.xntInjected / 1e6).toLocaleString()} XNT`);
    console.log(`  💊 XNT Withdrawn:      ${(this.state.xntWithdrawn / 1e6).toLocaleString()} XNT`);
    console.log(`  📊 Net XNT Position:   ${((this.state.xntInjected - this.state.xntWithdrawn) / 1e6).toLocaleString()} XNT`);
    console.log(`  🔧 Interventions:      ${this.state.interventionCount}`);
    console.log(`  ⏰ Last Intervention:  ${this.state.lastIntervention?.toLocaleString() || "Never"}`);
    console.log("");
  }

  // Start monitoring loop
  async start(): Promise<void> {
    this.isRunning = true;
    console.log("🚀 Starting price corridor monitoring...\n");

    while (this.isRunning) {
      try {
        await this.checkAndIntervene();
      } catch (error) {
        console.error("❌ Error in monitoring loop:", error);
      }

      // Wait before next check
      await new Promise((resolve) => setTimeout(resolve, CONFIG.POLL_INTERVAL_MS));
    }
  }

  // Stop bot
  stop(): void {
    console.log("\n🛑 Stopping bot...");
    this.isRunning = false;
    this.displayStats();
  }
}

// ========== MAIN ==========
async function main() {
  console.log("\n╔════════════════════════════════════════════════════════════╗");
  console.log("║          XNT PRICE CORRIDOR DEFENSE BOT v1.0             ║");
  console.log("╚════════════════════════════════════════════════════════════╝\n");

  // Parse command line arguments
  const args = process.argv.slice(2);
  let poolAddress: string | null = null;
  let pollInterval = CONFIG.POLL_INTERVAL_MS;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--pool-address" && args[i + 1]) {
      poolAddress = args[i + 1];
      i++;
    } else if (args[i] === "--interval" && args[i + 1]) {
      pollInterval = parseInt(args[i + 1]);
      CONFIG.POLL_INTERVAL_MS = pollInterval;
      i++;
    } else if (args[i] === "--help") {
      console.log("Usage: npx ts-node bots/price-corridor-bot.ts [options]\n");
      console.log("Options:");
      console.log("  --pool-address <address>   Pool PDA address to monitor");
      console.log("  --interval <ms>            Poll interval in milliseconds (default: 5000)");
      console.log("  --help                     Show this help message");
      console.log("");
      process.exit(0);
    }
  }

  if (!poolAddress) {
    console.error("❌ Error: --pool-address is required\n");
    console.log("Usage: npx ts-node bots/price-corridor-bot.ts --pool-address <address>\n");
    process.exit(1);
  }

  // Create and initialize bot
  const bot = new PriceCorridorBot(poolAddress);
  await bot.initialize();

  // Handle graceful shutdown
  process.on("SIGINT", () => {
    bot.stop();
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    bot.stop();
    process.exit(0);
  });

  // Start bot
  await bot.start();
}

// Run
main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
