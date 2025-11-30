/**
 * Demo Trading Script
 * Shows how to use the trading interface programmatically
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

const poolAddress = new PublicKey("41BtpyzrYMGoM3ivFkw5ZiaEurSc4HBW1fdBKzQYuJ63");
const walletPath = process.env.ANCHOR_WALLET || process.env.HOME + "/.config/solana/id.json";
const rpcUrl = process.env.ANCHOR_PROVIDER_URL || "http://localhost:8899";

const TRADER_WALLET_PATH = "/tmp/trader-wallet.json";

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

    const airdropSig = await connection.requestAirdrop(
      traderKeypair.publicKey,
      2 * anchor.web3.LAMPORTS_PER_SOL
    );
    await connection.confirmTransaction(airdropSig);
    console.log("✅ Airdropped 2 SOL for transaction fees");
  }

  const pool = await program.account.pool.fetch(poolAddress);

  console.log("\n╔════════════════════════════════════════════════════════════╗");
  console.log("║              XNT TRADING DEMO                              ║");
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

  async function displayBalances() {
    const poolData = await program.account.pool.fetch(poolAddress);
    const price = poolData.usdcReserve.toNumber() / poolData.xntReserve.toNumber();

    const xntAccount = await getAccount(connection, traderXnt.address);
    const usdcAccount = await getAccount(connection, traderUsdc.address);

    const xntBalance = Number(xntAccount.amount);
    const usdcBalance = Number(usdcAccount.amount);

    console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("💹 Current Price: $" + price.toFixed(6));
    console.log("💼 USDC Balance:  $" + (usdcBalance / 1e6).toLocaleString());
    console.log("💼 XNT Balance:   " + (xntBalance / 1e6).toLocaleString() + " XNT");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

    return { price, xntBalance, usdcBalance, poolData };
  }

  // Show initial state
  const initial = await displayBalances();

  // Check if we need to airdrop USDC
  if (initial.usdcBalance === 0) {
    console.log("💰 Airdropping 100K USDC...");
    await mintTo(
      connection,
      mainWallet,
      pool.usdcMint,
      traderUsdc.address,
      mainWallet.publicKey,
      100_000 * 1e6
    );
    console.log("✅ Airdropped 100K USDC");
    await displayBalances();
  }

  console.log("\n🎮 To trade interactively, run:");
  console.log("   npx ts-node scripts/interactive-trader.ts --pool=" + poolAddress.toString());
  console.log("\n📖 Full documentation: web/TRADING.md\n");
  console.log("💡 The interactive trader provides:");
  console.log("   - Live price updates");
  console.log("   - Quote preview before trading");
  console.log("   - Balance tracking");
  console.log("   - P&L calculation");
  console.log("   - Simple commands: [b]uy, [s]ell, [a]irdrop, [r]efresh, [q]uit\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
