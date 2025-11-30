/**
 * Interactive Trading Client for XNT/USDC Pool
 *
 * Allows you to buy and sell XNT to test the price corridor bot
 */

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { BondingCurve } from "../target/types/bonding_curve";
import {
  TOKEN_PROGRAM_ID,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import { Keypair, Connection, PublicKey } from "@solana/web3.js";
import * as fs from "fs";
import * as readline from "readline";

// Parse command line args
const args = process.argv.slice(2);
const poolAddressArg = args.find(arg => arg.startsWith('--pool='));
const actionArg = args.find(arg => arg.startsWith('--action='));
const amountArg = args.find(arg => arg.startsWith('--amount='));

if (!poolAddressArg) {
  console.error("Usage: npx ts-node scripts/trade-client.ts --pool=<POOL_ADDRESS> [--action=buy|sell] [--amount=<AMOUNT>]");
  process.exit(1);
}

const poolAddress = new PublicKey(poolAddressArg.split('=')[1]);
const action = actionArg?.split('=')[1];
const amount = amountArg ? parseFloat(amountArg.split('=')[1]) : null;

const walletPath = process.env.ANCHOR_WALLET || process.env.HOME + "/.config/solana/id.json";
const rpcUrl = process.env.ANCHOR_PROVIDER_URL || "http://localhost:8899";

async function main() {
  const walletKeypair = Keypair.fromSecretKey(
    Buffer.from(JSON.parse(fs.readFileSync(walletPath, "utf-8")))
  );

  const connection = new Connection(rpcUrl, "confirmed");
  const wallet = new anchor.Wallet(walletKeypair);
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  anchor.setProvider(provider);

  const program = anchor.workspace.BondingCurve as Program<BondingCurve>;

  console.log("\n╔════════════════════════════════════════════════════════════╗");
  console.log("║              XNT/USDC TRADING CLIENT                      ║");
  console.log("╚════════════════════════════════════════════════════════════╝\n");

  // Fetch pool info
  const pool = await program.account.pool.fetch(poolAddress);
  const price = pool.usdcReserve.toNumber() / pool.xntReserve.toNumber();

  console.log("📍 Pool:", poolAddress.toString());
  console.log("💹 Current Price: $" + price.toFixed(6));
  console.log("📊 XNT Reserve:", (pool.xntReserve.toNumber() / 1e6).toLocaleString() + "M");
  console.log("💵 USDC Reserve: $" + (pool.usdcReserve.toNumber() / 1e6).toLocaleString() + "M");
  console.log("👤 Wallet:", walletKeypair.publicKey.toString());
  console.log("");

  // Get or create token accounts
  const traderXnt = await getOrCreateAssociatedTokenAccount(
    connection,
    walletKeypair,
    pool.xntMint,
    walletKeypair.publicKey
  );

  const traderUsdc = await getOrCreateAssociatedTokenAccount(
    connection,
    walletKeypair,
    pool.usdcMint,
    walletKeypair.publicKey
  );

  // Check balances
  const xntBalance = await connection.getTokenAccountBalance(traderXnt.address);
  const usdcBalance = await connection.getTokenAccountBalance(traderUsdc.address);

  console.log("💰 Your Balances:");
  console.log("   XNT:  " + (parseInt(xntBalance.value.amount) / 1e6).toLocaleString() + " XNT");
  console.log("   USDC: $" + (parseInt(usdcBalance.value.amount) / 1e6).toLocaleString());
  console.log("");

  // Fund wallet if needed
  const needsXnt = parseInt(xntBalance.value.amount) === 0;
  const needsUsdc = parseInt(usdcBalance.value.amount) === 0;

  if (needsXnt || needsUsdc) {
    console.log("🔧 Funding your wallet...");

    if (needsUsdc) {
      await mintTo(
        connection,
        walletKeypair,
        pool.usdcMint,
        traderUsdc.address,
        walletKeypair.publicKey,
        10_000_000_000_000 // 10M USDC
      );
      console.log("   ✅ Minted 10M USDC");
    }

    if (needsXnt) {
      await mintTo(
        connection,
        walletKeypair,
        pool.xntMint,
        traderXnt.address,
        walletKeypair.publicKey,
        5_000_000_000_000 // 5M XNT
      );
      console.log("   ✅ Minted 5M XNT");
    }
    console.log("");
  }

  // If action specified, execute it
  if (action && amount) {
    await executeTrade(
      program,
      action,
      amount,
      poolAddress,
      pool.poolXnt,
      pool.poolUsdc,
      traderXnt.address,
      traderUsdc.address,
      walletKeypair
    );
    return;
  }

  // Interactive mode
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  console.log("╔════════════════════════════════════════════════════════════╗");
  console.log("║                    TRADING OPTIONS                        ║");
  console.log("╚════════════════════════════════════════════════════════════╝");
  console.log("");
  console.log("Commands:");
  console.log("  buy <amount>     - Buy XNT with USDC (e.g., 'buy 100000')");
  console.log("  sell <amount>    - Sell XNT for USDC (e.g., 'sell 50000')");
  console.log("  price            - Show current price");
  console.log("  balance          - Show your balances");
  console.log("  exit             - Exit the client");
  console.log("");
  console.log("💡 Tip: Amounts are in base units (1M = 1,000,000)");
  console.log("");

  const promptUser = () => {
    rl.question('> ', async (input) => {
      const parts = input.trim().split(' ');
      const command = parts[0].toLowerCase();
      const amountStr = parts[1];

      try {
        if (command === 'exit' || command === 'quit') {
          console.log("\n👋 Goodbye!");
          rl.close();
          process.exit(0);
        } else if (command === 'price') {
          const pool = await program.account.pool.fetch(poolAddress);
          const price = pool.usdcReserve.toNumber() / pool.xntReserve.toNumber();
          console.log(`\n💹 Current Price: $${price.toFixed(6)}\n`);
          promptUser();
        } else if (command === 'balance') {
          const xntBal = await connection.getTokenAccountBalance(traderXnt.address);
          const usdcBal = await connection.getTokenAccountBalance(traderUsdc.address);
          console.log("\n💰 Your Balances:");
          console.log(`   XNT:  ${(parseInt(xntBal.value.amount) / 1e6).toLocaleString()} XNT`);
          console.log(`   USDC: $${(parseInt(usdcBal.value.amount) / 1e6).toLocaleString()}\n`);
          promptUser();
        } else if (command === 'buy' || command === 'sell') {
          if (!amountStr) {
            console.log("❌ Please specify amount (e.g., 'buy 100000')\n");
            promptUser();
            return;
          }

          const tradeAmount = parseFloat(amountStr);
          await executeTrade(
            program,
            command,
            tradeAmount,
            poolAddress,
            pool.poolXnt,
            pool.poolUsdc,
            traderXnt.address,
            traderUsdc.address,
            walletKeypair
          );
          promptUser();
        } else {
          console.log("❌ Unknown command. Type 'exit' to quit.\n");
          promptUser();
        }
      } catch (error) {
        console.error("❌ Error:", error.message);
        console.log("");
        promptUser();
      }
    });
  };

  promptUser();
}

async function executeTrade(
  program: Program<BondingCurve>,
  action: string,
  amount: number,
  poolAddress: PublicKey,
  poolXnt: PublicKey,
  poolUsdc: PublicKey,
  traderXnt: PublicKey,
  traderUsdc: PublicKey,
  walletKeypair: Keypair
): Promise<void> {
  const poolBefore = await program.account.pool.fetch(poolAddress);
  const priceBefore = poolBefore.usdcReserve.toNumber() / poolBefore.xntReserve.toNumber();

  console.log("\n" + "=".repeat(60));

  if (action === 'buy') {
    console.log(`💸 BUYING XNT with ${(amount / 1e6).toLocaleString()}M USDC...`);

    await program.methods
      .buy(new anchor.BN(amount))
      .accountsPartial({
        buyer: walletKeypair.publicKey,
        pool: poolAddress,
        poolXnt,
        poolUsdc,
        buyerUsdc: traderUsdc,
        buyerXnt: traderXnt,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    console.log("   ✅ Buy successful!");
  } else if (action === 'sell') {
    console.log(`💸 SELLING ${(amount / 1e6).toLocaleString()}M XNT...`);

    await program.methods
      .sell(new anchor.BN(amount))
      .accountsPartial({
        seller: walletKeypair.publicKey,
        pool: poolAddress,
        poolXnt,
        poolUsdc,
        sellerXnt: traderXnt,
        sellerUsdc: traderUsdc,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    console.log("   ✅ Sell successful!");
  }

  const poolAfter = await program.account.pool.fetch(poolAddress);
  const priceAfter = poolAfter.usdcReserve.toNumber() / poolAfter.xntReserve.toNumber();
  const priceChange = ((priceAfter / priceBefore - 1) * 100);

  console.log(`   Price Before: $${priceBefore.toFixed(6)}`);
  console.log(`   Price After:  $${priceAfter.toFixed(6)}`);
  console.log(`   Change:       ${priceChange > 0 ? '+' : ''}${priceChange.toFixed(2)}%`);
  console.log("=".repeat(60) + "\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
