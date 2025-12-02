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

// Pool info
const POOL_ADDRESS = "AhM1YRfKCqjg7HbFa7M1VswSVcHimMH77Lxd4vVVjf12";
const XNT_MINT = "52ZJdni3ELFffL2vBPZWn5zBqDJwbZjFSiwkcBqn8koV";
const USDC_MINT = "H6wEyzNP8YomgcNmy3vcaVFGwn6p1a2WUYm1xMJYtKHE";
const CEILING_RESERVE_XNT = "2Fmkvxb1NuFHmXzA3WHCCQX4eeGz6ZsKFoJWFawqQfcE";

interface Balances {
  sol: number;
  xnt: number;
  usdc: number;
}

async function getTraderBalances(
  connection: Connection,
  trader: Keypair,
  xntMint: anchor.web3.PublicKey,
  usdcMint: anchor.web3.PublicKey
): Promise<Balances> {
  const solBalance = await connection.getBalance(trader.publicKey);

  // Get XNT balance
  const [traderXnt] = anchor.web3.PublicKey.findProgramAddressSync(
    [
      trader.publicKey.toBuffer(),
      TOKEN_PROGRAM_ID.toBuffer(),
      xntMint.toBuffer(),
    ],
    new anchor.web3.PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL")
  );

  let xntBalance = 0;
  try {
    const xntAccount = await getAccount(connection, traderXnt);
    xntBalance = Number(xntAccount.amount);
  } catch (e) {
    // Account doesn't exist yet
  }

  // Get USDC balance
  const [traderUsdc] = anchor.web3.PublicKey.findProgramAddressSync(
    [
      trader.publicKey.toBuffer(),
      TOKEN_PROGRAM_ID.toBuffer(),
      usdcMint.toBuffer(),
    ],
    new anchor.web3.PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL")
  );

  let usdcBalance = 0;
  try {
    const usdcAccount = await getAccount(connection, traderUsdc);
    usdcBalance = Number(usdcAccount.amount);
  } catch (e) {
    // Account doesn't exist yet
  }

  return {
    sol: solBalance / LAMPORTS_PER_SOL,
    xnt: xntBalance / 1e6,
    usdc: usdcBalance / 1e6,
  };
}

function printBalances(label: string, balances: Balances) {
  console.log(`${label}:`);
  console.log(`  SOL:  ${balances.sol.toFixed(2)}`);
  console.log(`  XNT:  ${balances.xnt.toFixed(2)}`);
  console.log(`  USDC: ${balances.usdc.toFixed(2)}`);
}

function printChange(before: Balances, after: Balances) {
  const solChange = after.sol - before.sol;
  const xntChange = after.xnt - before.xnt;
  const usdcChange = after.usdc - before.usdc;

  console.log(`Changes:`);
  console.log(`  SOL:  ${solChange >= 0 ? '+' : ''}${solChange.toFixed(2)}`);
  console.log(`  XNT:  ${xntChange >= 0 ? '+' : ''}${xntChange.toFixed(2)}`);
  console.log(`  USDC: ${usdcChange >= 0 ? '+' : ''}${usdcChange.toFixed(2)}`);
}

async function main() {
  console.log("\n" + "=".repeat(80));
  console.log("WALLET BALANCE TRACKING TEST");
  console.log("=".repeat(80) + "\n");

  const walletPath = process.env.ANCHOR_WALLET || process.env.HOME + "/.config/solana/id.json";
  const walletKeypair = Keypair.fromSecretKey(
    Buffer.from(JSON.parse(fs.readFileSync(walletPath, "utf-8")))
  );

  const connection = new Connection(process.env.ANCHOR_PROVIDER_URL || "http://localhost:8899", "confirmed");
  const wallet = new anchor.Wallet(walletKeypair);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
  anchor.setProvider(provider);

  const program = anchor.workspace.BondingCurve as Program<BondingCurve>;

  const traderWalletPath = "/tmp/trader-wallet.json";
  const traderKeypair = Keypair.fromSecretKey(
    Buffer.from(JSON.parse(fs.readFileSync(traderWalletPath, "utf-8")))
  );

  const poolPda = new anchor.web3.PublicKey(POOL_ADDRESS);
  const xntMint = new anchor.web3.PublicKey(XNT_MINT);
  const usdcMint = new anchor.web3.PublicKey(USDC_MINT);

  // Get pool state
  const poolBefore = await program.account.pool.fetch(poolPda);
  const poolData = poolBefore as any;
  const poolXnt = poolData.poolXnt;
  const poolUsdc = poolData.poolUsdc;

  // Get pool token balances
  const poolXntAccount = await getAccount(connection, poolXnt);
  const poolUsdcAccount = await getAccount(connection, poolUsdc);

  console.log("📊 POOL STATE:");
  console.log(`  XNT Reserve (logical): ${(poolBefore.xntReserve.toNumber() / 1e6).toFixed(2)} XNT`);
  console.log(`  USDC Reserve (logical): ${(poolBefore.usdcReserve.toNumber() / 1e6).toFixed(2)} USDC`);
  console.log(`  XNT Balance (actual): ${(Number(poolXntAccount.amount) / 1e6).toFixed(2)} XNT`);
  console.log(`  USDC Balance (actual): ${(Number(poolUsdcAccount.amount) / 1e6).toFixed(2)} USDC`);
  console.log();

  // Find PDAs
  const [ceilingReservePda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("ceiling_reserve"), poolPda.toBuffer()],
    program.programId
  );

  const [solVaultPda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("sol_vault"), poolPda.toBuffer()],
    program.programId
  );

  // Get trader token accounts
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

  // ========================================
  // INITIAL BALANCES
  // ========================================
  const initial = await getTraderBalances(connection, traderKeypair, xntMint, usdcMint);
  printBalances("📋 INITIAL TRADER BALANCES", initial);
  console.log();

  // ========================================
  // TEST: BUY XNT WITH USDC
  // ========================================
  const usdcAmount = 1000_000_000; // 1,000 USDC

  console.log("🔵 TEST: BUY XNT WITH USDC");
  console.log("-".repeat(80));
  console.log(`Spending: ${(usdcAmount / 1e6).toLocaleString()} USDC`);
  console.log();

  const beforeBuy = await getTraderBalances(connection, traderKeypair, xntMint, usdcMint);

  try {
    const buyTx = await program.methods
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

    await connection.confirmTransaction(buyTx, "confirmed");
    console.log(`✅ Buy TX: ${buyTx.substring(0, 20)}...`);
  } catch (error: any) {
    console.log("❌ Buy failed:", error.message);
  }

  const afterBuy = await getTraderBalances(connection, traderKeypair, xntMint, usdcMint);
  console.log();
  printBalances("After BUY", afterBuy);
  printChange(beforeBuy, afterBuy);
  console.log();

  // ========================================
  // VERIFY: USDC was taken, XNT was received
  // ========================================
  console.log("✓ Verification:");
  console.log(`  USDC decreased: ${beforeBuy.usdc - afterBuy.usdc} USDC`);
  console.log(`  XNT increased: ${afterBuy.xnt - beforeBuy.xnt} XNT`);
  console.log();

  // ========================================
  // TEST: SELL XNT FOR USDC
  // ========================================
  console.log("🟠 TEST: SELL XNT FOR USDC");
  console.log("-".repeat(80));

  const xntToSell = Math.floor((afterBuy.xnt - beforeBuy.xnt) * 1e6); // Sell what we just bought
  console.log(`Selling: ${(xntToSell / 1e6).toFixed(2)} XNT`);
  console.log();

  const beforeSell = await getTraderBalances(connection, traderKeypair, xntMint, usdcMint);

  try {
    const sellTx = await program.methods
      .sell(new anchor.BN(xntToSell))
      .accountsPartial({
        seller: traderKeypair.publicKey,
        pool: poolPda,
        poolXnt: poolXnt,
        poolUsdc: poolUsdc,
        sellerXnt: traderXntAccount.address,
        sellerUsdc: traderUsdcAccount.address,
        ceilingReserveXnt: new anchor.web3.PublicKey(CEILING_RESERVE_XNT),
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([traderKeypair])
      .rpc();

    await connection.confirmTransaction(sellTx, "confirmed");
    console.log(`✅ Sell TX: ${sellTx.substring(0, 20)}...`);
  } catch (error: any) {
    console.log("❌ Sell failed:", error.message);
    if (error.logs) {
      console.log("\nLogs:");
      error.logs.forEach((log: string) => console.log("  " + log));
    }
  }

  const afterSell = await getTraderBalances(connection, traderKeypair, xntMint, usdcMint);
  console.log();
  printBalances("After SELL", afterSell);
  printChange(beforeSell, afterSell);
  console.log();

  // ========================================
  // VERIFY: XNT was taken, USDC was received
  // ========================================
  console.log("✓ Verification:");
  console.log(`  XNT decreased: ${beforeSell.xnt - afterSell.xnt} XNT`);
  console.log(`  USDC increased: ${afterSell.usdc - beforeSell.usdc} USDC`);
  console.log();

  // ========================================
  // FINAL SUMMARY
  // ========================================
  console.log("=".repeat(80));
  console.log("📊 FINAL SUMMARY");
  console.log("=".repeat(80));
  printBalances("Initial Balances", initial);
  console.log();
  printBalances("Final Balances", afterSell);
  console.log();
  printChange(initial, afterSell);
  console.log();
  console.log("=".repeat(80) + "\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
