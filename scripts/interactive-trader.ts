/**
 * Interactive Trading CLI
 * Simple command-line interface for trading XNT
 */

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { BondingCurve } from "../target/types/bonding_curve";
import {
  TOKEN_PROGRAM_ID,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getAccount,
} from "@solana/spl-token";
import { Keypair, Connection, PublicKey } from "@solana/web3.js";
import * as fs from "fs";
import * as readline from "readline";

// Get pool address from command line
const args = process.argv.slice(2);
const poolAddressArg = args.find(arg => arg.startsWith('--pool='));
if (!poolAddressArg) {
  console.error("Usage: npx ts-node scripts/interactive-trader.ts --pool=<POOL_ADDRESS>");
  process.exit(1);
}
const poolAddress = new PublicKey(poolAddressArg.split('=')[1]);

const walletPath = process.env.ANCHOR_WALLET || process.env.HOME + "/.config/solana/id.json";
const rpcUrl = process.env.ANCHOR_PROVIDER_URL || "http://localhost:8899";

// Trader wallet (separate from main wallet)
const TRADER_WALLET_PATH = "/tmp/trader-wallet.json";

// Create readline interface
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(query: string): Promise<string> {
  return new Promise(resolve => {
    rl.question(query, resolve);
  });
}

async function main() {
  const connection = new Connection(rpcUrl, "confirmed");
  const mainWallet = Keypair.fromSecretKey(
    Buffer.from(JSON.parse(fs.readFileSync(walletPath, "utf-8")))
  );

  const wallet = new anchor.Wallet(mainWallet);
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  anchor.setProvider(provider);

  const program = anchor.workspace.BondingCurve as Program<BondingCurve>;

  // Load or create trader wallet
  let traderKeypair: Keypair;
  if (fs.existsSync(TRADER_WALLET_PATH)) {
    traderKeypair = Keypair.fromSecretKey(
      Buffer.from(JSON.parse(fs.readFileSync(TRADER_WALLET_PATH, "utf-8")))
    );
    console.log("\n✅ Loaded existing trader wallet");
  } else {
    traderKeypair = Keypair.generate();
    fs.writeFileSync(TRADER_WALLET_PATH, JSON.stringify(Array.from(traderKeypair.secretKey)));
    console.log("\n✅ Created new trader wallet");

    // Airdrop SOL for gas
    const airdropSig = await connection.requestAirdrop(
      traderKeypair.publicKey,
      2 * anchor.web3.LAMPORTS_PER_SOL
    );
    await connection.confirmTransaction(airdropSig);
    console.log("✅ Airdropped 2 SOL for transaction fees");
  }

  // Fetch pool info
  const pool = await program.account.pool.fetch(poolAddress);
  console.log("\n╔════════════════════════════════════════════════════════════╗");
  console.log("║              XNT INTERACTIVE TRADING TERMINAL              ║");
  console.log("╚════════════════════════════════════════════════════════════╝\n");

  console.log("📍 Pool Address:", poolAddress.toString());
  console.log("👛 Trader Wallet:", traderKeypair.publicKey.toString());
  console.log("");

  // Get trader token accounts
  const traderXnt = await getOrCreateAssociatedTokenAccount(
    connection,
    mainWallet,
    pool.xntMint,
    traderKeypair.publicKey
  );

  const traderUsdc = await getOrCreateAssociatedTokenAccount(
    connection,
    mainWallet,
    pool.usdcMint,
    traderKeypair.publicKey
  );

  // Helper function to display balances and price
  async function displayStatus() {
    const poolData = await program.account.pool.fetch(poolAddress);
    const price = poolData.usdcReserve.toNumber() / poolData.xntReserve.toNumber();

    const xntAccount = await getAccount(connection, traderXnt.address);
    const usdcAccount = await getAccount(connection, traderUsdc.address);

    const xntBalance = Number(xntAccount.amount);
    const usdcBalance = Number(usdcAccount.amount);

    console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("💹 MARKET DATA");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log(`  Current XNT Price:  $${price.toFixed(6)}`);
    console.log(`  Pool XNT Reserve:   ${(poolData.xntReserve.toNumber() / 1e6).toLocaleString()} XNT`);
    console.log(`  Pool USDC Reserve:  $${(poolData.usdcReserve.toNumber() / 1e6).toLocaleString()}`);
    console.log("");
    console.log("💼 YOUR BALANCES");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log(`  USDC Balance:       $${(usdcBalance / 1e6).toLocaleString()}`);
    console.log(`  XNT Balance:        ${(xntBalance / 1e6).toLocaleString()} XNT`);
    console.log(`  XNT Value:          $${((xntBalance / 1e6) * price).toLocaleString()}`);
    console.log(`  Total Portfolio:    $${((usdcBalance / 1e6) + ((xntBalance / 1e6) * price)).toLocaleString()}`);
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

    return { price, xntBalance, usdcBalance, poolData };
  }

  // Helper function to calculate quote
  function calculateBuyQuote(usdcAmount: number, poolData: any) {
    const k = poolData.xntReserve.toNumber() * poolData.usdcReserve.toNumber();
    const newUsdcReserve = poolData.usdcReserve.toNumber() + usdcAmount;
    const newXntReserve = k / newUsdcReserve;
    const xntOut = poolData.xntReserve.toNumber() - newXntReserve;
    const effectivePrice = usdcAmount / xntOut;
    const newPrice = newUsdcReserve / newXntReserve;
    const currentPrice = poolData.usdcReserve.toNumber() / poolData.xntReserve.toNumber();
    const priceImpact = ((newPrice / currentPrice) - 1) * 100;

    return { xntOut, effectivePrice, newPrice, priceImpact };
  }

  function calculateSellQuote(xntAmount: number, poolData: any) {
    const k = poolData.xntReserve.toNumber() * poolData.usdcReserve.toNumber();
    const newXntReserve = poolData.xntReserve.toNumber() + xntAmount;
    const newUsdcReserve = k / newXntReserve;
    const usdcOut = poolData.usdcReserve.toNumber() - newUsdcReserve;
    const effectivePrice = usdcOut / xntAmount;
    const newPrice = newUsdcReserve / newXntReserve;
    const currentPrice = poolData.usdcReserve.toNumber() / poolData.xntReserve.toNumber();
    const priceImpact = ((newPrice / currentPrice) - 1) * 100;

    return { usdcOut, effectivePrice, newPrice, priceImpact };
  }

  // Main menu loop
  while (true) {
    const status = await displayStatus();

    console.log("COMMANDS:");
    console.log("  [b] Buy XNT       [s] Sell XNT      [a] Airdrop USDC");
    console.log("  [r] Refresh       [q] Quit");
    console.log("");

    const command = (await question("Enter command: ")).toLowerCase().trim();

    if (command === 'q') {
      console.log("\n👋 Goodbye!\n");
      rl.close();
      process.exit(0);
    }

    if (command === 'r') {
      continue;
    }

    if (command === 'a') {
      const amount = await question("Enter USDC amount to airdrop (e.g., 100000): ");
      const amountNum = parseFloat(amount);

      if (isNaN(amountNum) || amountNum <= 0) {
        console.log("❌ Invalid amount");
        continue;
      }

      console.log(`\n💰 Airdropping ${(amountNum / 1000).toFixed(0)}K USDC...`);

      try {
        await mintTo(
          connection,
          mainWallet,
          pool.usdcMint,
          traderUsdc.address,
          mainWallet.publicKey,
          amountNum * 1e6
        );

        console.log("✅ Airdrop successful!\n");
      } catch (error) {
        console.error("❌ Airdrop failed:", error.message);
      }

      continue;
    }

    if (command === 'b') {
      const amount = await question("Enter USDC amount to spend (e.g., 10000): ");
      const amountNum = parseFloat(amount);

      if (isNaN(amountNum) || amountNum <= 0) {
        console.log("❌ Invalid amount");
        continue;
      }

      const amountWithDecimals = amountNum * 1e6;

      if (amountWithDecimals > status.usdcBalance) {
        console.log("❌ Insufficient USDC balance");
        continue;
      }

      // Show quote
      const quote = calculateBuyQuote(amountWithDecimals, status.poolData);
      console.log("\n📊 QUOTE:");
      console.log(`  You Pay:        $${(amountNum / 1000).toFixed(1)}K USDC`);
      console.log(`  You Receive:    ${(quote.xntOut / 1e6).toFixed(2)} XNT`);
      console.log(`  Effective Price: $${quote.effectivePrice.toFixed(6)}`);
      console.log(`  Price Impact:   ${quote.priceImpact >= 0 ? '+' : ''}${quote.priceImpact.toFixed(2)}%`);
      console.log(`  New Pool Price: $${quote.newPrice.toFixed(6)}`);
      console.log("");

      const confirm = await question("Execute trade? (y/n): ");
      if (confirm.toLowerCase() !== 'y') {
        console.log("❌ Trade cancelled");
        continue;
      }

      try {
        console.log("\n🔄 Executing BUY...");

        const tx = await program.methods
          .buy(new anchor.BN(amountWithDecimals))
          .accountsPartial({
            buyer: traderKeypair.publicKey,
            pool: poolAddress,
            poolXnt: pool.poolXnt,
            poolUsdc: pool.poolUsdc,
            buyerUsdc: traderUsdc.address,
            buyerXnt: traderXnt.address,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([traderKeypair])
          .rpc();

        console.log("✅ BUY successful!");
        console.log("📝 Transaction:", tx);

      } catch (error) {
        console.error("❌ Trade failed:", error.message);
      }

      continue;
    }

    if (command === 's') {
      const amount = await question("Enter XNT amount to sell (e.g., 1000): ");
      const amountNum = parseFloat(amount);

      if (isNaN(amountNum) || amountNum <= 0) {
        console.log("❌ Invalid amount");
        continue;
      }

      const amountWithDecimals = amountNum * 1e6;

      if (amountWithDecimals > status.xntBalance) {
        console.log("❌ Insufficient XNT balance");
        continue;
      }

      // Show quote
      const quote = calculateSellQuote(amountWithDecimals, status.poolData);
      console.log("\n📊 QUOTE:");
      console.log(`  You Pay:        ${(amountNum / 1000).toFixed(1)}K XNT`);
      console.log(`  You Receive:    $${(quote.usdcOut / 1e6).toFixed(2)}`);
      console.log(`  Effective Price: $${quote.effectivePrice.toFixed(6)}`);
      console.log(`  Price Impact:   ${quote.priceImpact >= 0 ? '+' : ''}${quote.priceImpact.toFixed(2)}%`);
      console.log(`  New Pool Price: $${quote.newPrice.toFixed(6)}`);
      console.log("");

      const confirm = await question("Execute trade? (y/n): ");
      if (confirm.toLowerCase() !== 'y') {
        console.log("❌ Trade cancelled");
        continue;
      }

      try {
        console.log("\n🔄 Executing SELL...");

        const tx = await program.methods
          .sell(new anchor.BN(amountWithDecimals))
          .accountsPartial({
            seller: traderKeypair.publicKey,
            pool: poolAddress,
            poolXnt: pool.poolXnt,
            poolUsdc: pool.poolUsdc,
            sellerXnt: traderXnt.address,
            sellerUsdc: traderUsdc.address,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([traderKeypair])
          .rpc();

        console.log("✅ SELL successful!");
        console.log("📝 Transaction:", tx);

      } catch (error) {
        console.error("❌ Trade failed:", error.message);
      }

      continue;
    }

    console.log("❌ Invalid command\n");
  }
}

main().catch((err) => {
  console.error(err);
  rl.close();
  process.exit(1);
});
