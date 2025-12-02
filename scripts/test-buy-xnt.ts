import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { BondingCurve } from "../target/types/bonding_curve";
import {
  TOKEN_PROGRAM_ID,
  getOrCreateAssociatedTokenAccount,
  getAccount,
} from "@solana/spl-token";
import { Keypair, Connection, LAMPORTS_PER_SOL } from "@solana/web3.js";
import * as fs from "fs";

// Pool info from POOL_INFO.txt
const POOL_ADDRESS = "FkvMh8xyZDBsQ4hZpnykzxf5AV8Mg8mSqi5tFM5oVhPt";
const XNT_MINT = "47DvjLuqDZKBn6cLXJLHA6WfYLGwt56ikm6sE5yJTP98";
const USDC_MINT = "E2jiFRBb85HVf3ssA9PkVvprr9CoqPChUGahXNof21m8";
const CEILING_RESERVE_XNT = "9h9zWJ1AYsh99ybMaC4MgEigCuXDKjK6HR4gjCmh8P3X";

async function main() {
  console.log("\n" + "=".repeat(80));
  console.log("TEST: BUY XNT WITH USDC");
  console.log("=".repeat(80) + "\n");

  // Setup
  const walletPath = process.env.ANCHOR_WALLET || process.env.HOME + "/.config/solana/id.json";
  const walletKeypair = Keypair.fromSecretKey(
    Buffer.from(JSON.parse(fs.readFileSync(walletPath, "utf-8")))
  );

  const connection = new Connection(process.env.ANCHOR_PROVIDER_URL || "http://localhost:8899", "confirmed");
  const wallet = new anchor.Wallet(walletKeypair);
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  anchor.setProvider(provider);

  const program = anchor.workspace.BondingCurve as Program<BondingCurve>;

  // Load trader wallet
  const traderWalletPath = "/tmp/trader-wallet.json";
  const traderKeypair = Keypair.fromSecretKey(
    Buffer.from(JSON.parse(fs.readFileSync(traderWalletPath, "utf-8")))
  );

  console.log("📋 TEST CONFIGURATION");
  console.log("-".repeat(80));
  console.log(`Pool Address: ${POOL_ADDRESS}`);
  console.log(`XNT Mint: ${XNT_MINT}`);
  console.log(`USDC Mint: ${USDC_MINT}`);
  console.log(`Trader: ${traderKeypair.publicKey.toString()}`);
  console.log("");

  // Get pool PDA
  const poolPda = new anchor.web3.PublicKey(POOL_ADDRESS);
  const xntMint = new anchor.web3.PublicKey(XNT_MINT);
  const usdcMint = new anchor.web3.PublicKey(USDC_MINT);

  // Fetch initial pool state
  console.log("📊 INITIAL POOL STATE");
  console.log("-".repeat(80));
  const poolBefore = await program.account.pool.fetch(poolPda);
  const priceBefore = poolBefore.usdcReserve.toNumber() / poolBefore.xntReserve.toNumber();

  console.log(`XNT Reserve: ${(poolBefore.xntReserve.toNumber() / 1e6).toLocaleString()} XNT`);
  console.log(`USDC Reserve: ${(poolBefore.usdcReserve.toNumber() / 1e6).toLocaleString()} USDC`);
  console.log(`Price: $${priceBefore.toFixed(6)} per XNT`);
  console.log(`Constant k: ${poolBefore.k.toString()}`);
  console.log("");

  // Get pool token accounts
  const poolData = poolBefore as any;
  const poolXnt = poolData.poolXnt;
  const poolUsdc = poolData.poolUsdc;

  // Get trader token accounts
  console.log("👤 TRADER INITIAL BALANCES");
  console.log("-".repeat(80));

  const traderXntAccount = await getOrCreateAssociatedTokenAccount(
    connection,
    traderKeypair,
    xntMint,
    traderKeypair.publicKey
  );

  const traderUsdcAccount = await getOrCreateAssociatedTokenAccount(
    connection,
    traderKeypair,
    usdcMint,
    traderKeypair.publicKey
  );

  const traderXntBefore = await getAccount(connection, traderXntAccount.address);
  const traderUsdcBefore = await getAccount(connection, traderUsdcAccount.address);
  const traderSolBefore = await connection.getBalance(traderKeypair.publicKey);

  console.log(`SOL Balance: ${(traderSolBefore / LAMPORTS_PER_SOL).toLocaleString()} SOL`);
  console.log(`XNT Balance: ${(Number(traderXntBefore.amount) / 1e6).toLocaleString()} XNT`);
  console.log(`USDC Balance: ${(Number(traderUsdcBefore.amount) / 1e6).toLocaleString()} USDC`);
  console.log("");

  // Test: Buy XNT with USDC
  const usdcAmount = 5000_000_000; // 5,000 USDC with 6 decimals

  console.log("🔄 EXECUTING TRADE: BUY XNT WITH USDC");
  console.log("-".repeat(80));
  console.log(`Amount to spend: ${(usdcAmount / 1e6).toLocaleString()} USDC`);
  console.log("");

  // Calculate expected XNT output using constant product formula
  // x * y = k
  // (x - dx) * (y + dy) = k
  // dy = y - k / (x - dx)
  const xntReserve = poolBefore.xntReserve.toNumber();
  const usdcReserve = poolBefore.usdcReserve.toNumber();
  const k = poolBefore.k;

  // Use BN for large number calculations
  const newUsdcReserveBN = new anchor.BN(usdcReserve).add(new anchor.BN(usdcAmount));
  const newXntReserveBN = k.div(newUsdcReserveBN);
  const expectedXntOutBN = poolBefore.xntReserve.sub(newXntReserveBN);

  const newUsdcReserve = newUsdcReserveBN.toNumber();
  const newXntReserve = newXntReserveBN.toNumber();
  const expectedXntOut = expectedXntOutBN.toNumber();

  console.log("📈 EXPECTED TRADE CALCULATION");
  console.log("-".repeat(80));
  console.log(`Current XNT Reserve: ${(xntReserve / 1e6).toLocaleString()} XNT`);
  console.log(`Current USDC Reserve: ${(usdcReserve / 1e6).toLocaleString()} USDC`);
  console.log(`Adding USDC: ${(usdcAmount / 1e6).toLocaleString()} USDC`);
  console.log(`New USDC Reserve: ${(newUsdcReserve / 1e6).toLocaleString()} USDC`);
  console.log(`New XNT Reserve: ${(newXntReserve / 1e6).toLocaleString()} XNT`);
  console.log(`Expected XNT Out: ${(expectedXntOut / 1e6).toLocaleString()} XNT`);
  console.log(`New Price: $${(newUsdcReserve / newXntReserve).toFixed(6)} per XNT`);
  console.log("");

  console.log("📤 SENDING TRANSACTION...");
  console.log("-".repeat(80));

  // Find ceiling reserve PDA
  const [ceilingReservePda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("ceiling_reserve"), poolPda.toBuffer()],
    program.programId
  );

  try {
    const tx = await program.methods
      .buy(new anchor.BN(usdcAmount))
      .accountsPartial({
        buyer: traderKeypair.publicKey,
        pool: poolPda,
        poolXnt: poolXnt,
        poolUsdc: poolUsdc,
        buyerUsdc: traderUsdcAccount.address,
        buyerXnt: traderXntAccount.address,
        ceilingReservePda: ceilingReservePda,
        ceilingReserveXnt: new anchor.web3.PublicKey(CEILING_RESERVE_XNT),
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([traderKeypair])
      .rpc();

    console.log(`✅ Transaction successful!`);
    console.log(`TX Signature: ${tx}`);
    console.log(`Explorer: https://explorer.solana.com/tx/${tx}?cluster=custom&customUrl=http://localhost:8899`);
    console.log("");

    // Wait for confirmation
    await connection.confirmTransaction(tx, "confirmed");

    // Fetch updated state
    console.log("📊 FINAL POOL STATE");
    console.log("-".repeat(80));
    const poolAfter = await program.account.pool.fetch(poolPda);
    const priceAfter = poolAfter.usdcReserve.toNumber() / poolAfter.xntReserve.toNumber();

    console.log(`XNT Reserve: ${(poolAfter.xntReserve.toNumber() / 1e6).toLocaleString()} XNT`);
    console.log(`USDC Reserve: ${(poolAfter.usdcReserve.toNumber() / 1e6).toLocaleString()} USDC`);
    console.log(`Price: $${priceAfter.toFixed(6)} per XNT`);
    console.log(`Constant k: ${poolAfter.k.toString()}`);
    console.log("");

    // Fetch updated trader balances
    console.log("👤 TRADER FINAL BALANCES");
    console.log("-".repeat(80));

    const traderXntAfter = await getAccount(connection, traderXntAccount.address);
    const traderUsdcAfter = await getAccount(connection, traderUsdcAccount.address);
    const traderSolAfter = await connection.getBalance(traderKeypair.publicKey);

    console.log(`SOL Balance: ${(traderSolAfter / LAMPORTS_PER_SOL).toLocaleString()} SOL`);
    console.log(`XNT Balance: ${(Number(traderXntAfter.amount) / 1e6).toLocaleString()} XNT`);
    console.log(`USDC Balance: ${(Number(traderUsdcAfter.amount) / 1e6).toLocaleString()} USDC`);
    console.log("");

    // Calculate changes
    console.log("📈 TRADE SUMMARY");
    console.log("-".repeat(80));

    const xntReceived = Number(traderXntAfter.amount) - Number(traderXntBefore.amount);
    const usdcSpent = Number(traderUsdcBefore.amount) - Number(traderUsdcAfter.amount);
    const solSpent = traderSolBefore - traderSolAfter;
    const effectivePrice = usdcSpent / xntReceived;

    console.log(`USDC Spent: ${(usdcSpent / 1e6).toLocaleString()} USDC`);
    console.log(`XNT Received: ${(xntReceived / 1e6).toLocaleString()} XNT`);
    console.log(`Effective Price: $${effectivePrice.toFixed(6)} per XNT`);
    console.log(`SOL Spent (gas): ${(solSpent / LAMPORTS_PER_SOL).toFixed(9)} SOL`);
    console.log("");

    console.log("🔍 PRICE IMPACT ANALYSIS");
    console.log("-".repeat(80));
    const priceChange = ((priceAfter - priceBefore) / priceBefore) * 100;
    const priceImpact = ((effectivePrice - priceBefore) / priceBefore) * 100;

    console.log(`Price Before: $${priceBefore.toFixed(6)}`);
    console.log(`Price After: $${priceAfter.toFixed(6)}`);
    console.log(`Price Change: ${priceChange >= 0 ? '+' : ''}${priceChange.toFixed(4)}%`);
    console.log(`Effective Price: $${effectivePrice.toFixed(6)}`);
    console.log(`Price Impact: ${priceImpact >= 0 ? '+' : ''}${priceImpact.toFixed(4)}%`);
    console.log("");

    console.log("✅ TEST COMPLETED SUCCESSFULLY");
    console.log("=".repeat(80) + "\n");

  } catch (error: any) {
    console.error("❌ TRANSACTION FAILED");
    console.error("-".repeat(80));
    console.error(`Error: ${error.message}`);

    if (error.logs) {
      console.error("\n📋 TRANSACTION LOGS:");
      console.error("-".repeat(80));
      error.logs.forEach((log: string) => console.error(log));
    }

    console.error("\n" + "=".repeat(80) + "\n");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
