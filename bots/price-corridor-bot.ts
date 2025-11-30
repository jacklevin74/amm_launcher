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
  PRICE_FLOOR: 1.0,           // Minimum price (hard floor)
  PRICE_CEILING: 2.0,          // Maximum price (hard ceiling)
  PRICE_TARGET: 1.5,           // Target price for interventions
  SOFT_LOW: 1.1,               // Soft lower boundary (gentle intervention)
  SOFT_HIGH: 1.9,              // Soft upper boundary (gentle intervention)

  // Intervention settings
  AGGRESSIVE_PERCENT: 1.0,     // Move 100% to target on ceiling/floor breach
  GENTLE_PERCENT: 0.5,         // Move 50% to target on soft boundary breach

  // Bot reserves (starting XNT balance for interventions)
  BOT_RESERVE_XNT: 10_000_000_000_000, // 10M XNT

  // Monitoring
  POLL_INTERVAL_MS: 5000,      // Check price every 5 seconds

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
}

// ========== BOT CLASS ==========
class PriceCorridorBot {
  private program: Program<BondingCurve>;
  private provider: AnchorProvider;
  private authority: Keypair;
  private poolAddress: PublicKey;
  private state: BotState;
  private isRunning: boolean;

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
    console.log("║              PRICE CORRIDOR CONFIGURATION                 ║");
    console.log("╚════════════════════════════════════════════════════════════╝");
    console.log(`  💵 Price Floor:       $${CONFIG.PRICE_FLOOR.toFixed(2)}`);
    console.log(`  📊 Soft Low:          $${CONFIG.SOFT_LOW.toFixed(2)}`);
    console.log(`  🎯 Target Price:      $${CONFIG.PRICE_TARGET.toFixed(2)}`);
    console.log(`  📊 Soft High:         $${CONFIG.SOFT_HIGH.toFixed(2)}`);
    console.log(`  💵 Price Ceiling:     $${CONFIG.PRICE_CEILING.toFixed(2)}`);
    console.log(`  ⏱️  Poll Interval:     ${CONFIG.POLL_INTERVAL_MS}ms`);
    console.log(`  🎯 Gentle Move:       ${(CONFIG.GENTLE_PERCENT * 100).toFixed(0)}% to target`);
    console.log(`  ⚡ Aggressive Move:   ${(CONFIG.AGGRESSIVE_PERCENT * 100).toFixed(0)}% to target`);
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
    console.log(`   Amount: ${(amount / 1e6).toLocaleString()} XNT`);

    try {
      await this.program.methods
        .depositXnt(new anchor.BN(Math.floor(amount)))
        .accounts({
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
      console.error(`   ❌ Injection failed:`, error);
      throw error;
    }
  }

  // Withdraw XNT from pool (raises price)
  async withdrawXnt(amount: number, reason: string): Promise<void> {
    console.log(`\n💊 WITHDRAWING XNT: ${reason}`);
    console.log(`   Amount: ${(amount / 1e6).toLocaleString()} XNT`);

    try {
      await this.program.methods
        .withdrawXnt(new anchor.BN(Math.floor(amount)))
        .accounts({
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

    // Log current status
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] Price: $${price.toFixed(6)} | XNT: ${(state.xntReserve / 1e6).toLocaleString()}M | USDC: $${(state.usdcReserve / 1e6).toLocaleString()}M`);

    // Determine intervention needed
    let interventionNeeded = false;
    let targetPrice = CONFIG.PRICE_TARGET;
    let movePercent = 1.0;
    let reason = "";

    if (price >= CONFIG.PRICE_CEILING) {
      // CRITICAL: Hit ceiling
      interventionNeeded = true;
      movePercent = CONFIG.AGGRESSIVE_PERCENT;
      reason = `🚨 CEILING BREACH ($${price.toFixed(2)} >= $${CONFIG.PRICE_CEILING})`;
    } else if (price >= CONFIG.SOFT_HIGH) {
      // WARNING: Approaching ceiling
      interventionNeeded = true;
      movePercent = CONFIG.GENTLE_PERCENT;
      reason = `⚠️  SOFT HIGH BREACH ($${price.toFixed(2)} >= $${CONFIG.SOFT_HIGH})`;
    } else if (price <= CONFIG.PRICE_FLOOR) {
      // CRITICAL: Hit floor
      interventionNeeded = true;
      movePercent = CONFIG.AGGRESSIVE_PERCENT;
      reason = `🚨 FLOOR BREACH ($${price.toFixed(2)} <= $${CONFIG.PRICE_FLOOR})`;
    } else if (price <= CONFIG.SOFT_LOW) {
      // WARNING: Approaching floor
      interventionNeeded = true;
      movePercent = CONFIG.GENTLE_PERCENT;
      reason = `⚠️  SOFT LOW BREACH ($${price.toFixed(2)} <= $${CONFIG.SOFT_LOW})`;
    }

    if (interventionNeeded) {
      // Calculate full delta to target, then apply move percentage
      const fullDelta = this.calculateXntDelta(state, targetPrice);
      const adjustedDelta = fullDelta * movePercent;

      console.log(`\n${"=".repeat(60)}`);
      console.log(reason);
      console.log(`   Current Price: $${price.toFixed(6)}`);
      console.log(`   Target Price:  $${targetPrice.toFixed(6)}`);
      console.log(`   Full Delta:    ${(fullDelta / 1e6).toLocaleString()} XNT`);
      console.log(`   Move:          ${(movePercent * 100).toFixed(0)}%`);
      console.log(`   Action Delta:  ${(adjustedDelta / 1e6).toLocaleString()} XNT`);

      if (adjustedDelta > 0) {
        // Need to inject XNT (price too high)
        await this.injectXnt(adjustedDelta, reason);
      } else {
        // Need to withdraw XNT (price too low)
        await this.withdrawXnt(Math.abs(adjustedDelta), reason);
      }

      // Show new price
      const newState = await this.getPoolState();
      console.log(`   New Price:     $${newState.price.toFixed(6)}`);
      console.log(`   Price Change:  ${((newState.price / price - 1) * 100).toFixed(2)}%`);
      console.log(`${"=".repeat(60)}\n`);
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
