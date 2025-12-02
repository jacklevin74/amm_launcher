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

async function main() {
  console.log("\n" + "=".repeat(80));
  console.log("ROUNDTRIP TEST: BUY (USDC → XNT → SOL) then SELL (SOL → XNT → USDC)");
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

  // Find PDAs
  const [ceilingReservePda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("ceiling_reserve"), poolPda.toBuffer()],
    program.programId
  );

  const [solVaultPda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("sol_vault"), poolPda.toBuffer()],
    program.programId
  );

  // Get pool state
  const poolBefore = await program.account.pool.fetch(poolPda);
  const poolData = poolBefore as any;
  const poolXnt = poolData.poolXnt;
  const poolUsdc = poolData.poolUsdc;

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

  console.log("📋 INITIAL STATE");
  console.log("-".repeat(80));

  const initialSol = await connection.getBalance(traderKeypair.publicKey);
  const initialXnt = await getAccount(connection, traderXntAccount.address);
  const initialUsdc = await getAccount(connection, traderUsdcAccount.address);

  console.log(`Pool XNT:     ${(poolBefore.xntReserve.toNumber() / 1e6).toLocaleString()} XNT`);
  console.log(`Pool USDC:    ${(poolBefore.usdcReserve.toNumber() / 1e6).toLocaleString()} USDC`);
  console.log(`Pool Price:   $${(poolBefore.usdcReserve.toNumber() / poolBefore.xntReserve.toNumber()).toFixed(6)}`);
  console.log();
  console.log(`Trader SOL:   ${(initialSol / LAMPORTS_PER_SOL).toFixed(2)} SOL`);
  console.log(`Trader XNT:   ${(Number(initialXnt.amount) / 1e6).toFixed(2)} XNT`);
  console.log(`Trader USDC:  ${(Number(initialUsdc.amount) / 1e6).toLocaleString()} USDC`);
  console.log();

  // ========================================
  // TEST 1: BUY (USDC → XNT → SOL)
  // ========================================
  const usdcToBuy = 5000_000_000; // 5,000 USDC

  console.log("🔵 TEST 1: BUY (USDC → XNT → SOL)");
  console.log("-".repeat(80));
  console.log(`Spending: 5,000 USDC`);
  console.log();

  console.log("[1/2] Buying XNT with USDC...");
  const buyTx = await program.methods
    .buy(new anchor.BN(usdcToBuy))
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
  console.log(`✓ Buy TX: ${buyTx.substring(0, 20)}...`);

  const afterBuyXnt = await getAccount(connection, traderXntAccount.address);
  const xntReceived = Number(afterBuyXnt.amount) - Number(initialXnt.amount);
  console.log(`✓ Received: ${(xntReceived / 1e6).toFixed(2)} XNT`);
  console.log();

  console.log("[2/2] Unwrapping XNT → SOL...");
  const unwrapTx = await program.methods
    .unwrapSol(new anchor.BN(xntReceived))
    .accountsPartial({
      user: traderKeypair.publicKey,
      pool: poolPda,
      solVault: solVaultPda,
      poolXnt: poolXnt,
      userXnt: traderXntAccount.address,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .signers([traderKeypair])
    .rpc();

  await connection.confirmTransaction(unwrapTx, "confirmed");
  console.log(`✓ Unwrap TX: ${unwrapTx.substring(0, 20)}...`);

  const afterUnwrapSol = await connection.getBalance(traderKeypair.publicKey);
  const afterUnwrapXnt = await getAccount(connection, traderXntAccount.address);
  const afterUnwrapUsdc = await getAccount(connection, traderUsdcAccount.address);

  console.log();
  console.log("📊 AFTER BUY:");
  console.log(`  SOL:  ${(afterUnwrapSol / LAMPORTS_PER_SOL).toFixed(2)} (${((afterUnwrapSol - initialSol) / LAMPORTS_PER_SOL) >= 0 ? '+' : ''}${((afterUnwrapSol - initialSol) / LAMPORTS_PER_SOL).toFixed(2)})`);
  console.log(`  XNT:  ${(Number(afterUnwrapXnt.amount) / 1e6).toFixed(2)} (should be 0)`);
  console.log(`  USDC: ${(Number(afterUnwrapUsdc.amount) / 1e6).toLocaleString()} (-5,000)`);
  console.log();

  // ========================================
  // TEST 2: SELL (SOL → XNT → USDC)
  // ========================================
  const solToSell = (xntReceived / 1e6) * 1e9; // Same amount of SOL as XNT we got

  console.log("🟠 TEST 2: SELL (SOL → XNT → USDC)");
  console.log("-".repeat(80));
  console.log(`Selling: ${(solToSell / 1e9).toFixed(2)} SOL`);
  console.log();

  console.log("[1/2] Wrapping SOL → XNT...");
  const wrapTx = await program.methods
    .wrapSol(new anchor.BN(Math.floor(solToSell)))
    .accountsPartial({
      user: traderKeypair.publicKey,
      pool: poolPda,
      solVault: solVaultPda,
      poolXnt: poolXnt,
      userXnt: traderXntAccount.address,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .signers([traderKeypair])
    .rpc();

  await connection.confirmTransaction(wrapTx, "confirmed");
  console.log(`✓ Wrap TX: ${wrapTx.substring(0, 20)}...`);

  const afterWrapXnt = await getAccount(connection, traderXntAccount.address);
  console.log(`✓ Wrapped: ${(Number(afterWrapXnt.amount) / 1e6).toFixed(2)} XNT`);
  console.log();

  console.log("[2/2] Selling XNT for USDC...");
  const sellTx = await program.methods
    .sell(new anchor.BN(Number(afterWrapXnt.amount)))
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
  console.log(`✓ Sell TX: ${sellTx.substring(0, 20)}...`);

  const finalSol = await connection.getBalance(traderKeypair.publicKey);
  const finalXnt = await getAccount(connection, traderXntAccount.address);
  const finalUsdc = await getAccount(connection, traderUsdcAccount.address);

  console.log();
  console.log("📊 AFTER SELL:");
  console.log(`  SOL:  ${(finalSol / LAMPORTS_PER_SOL).toFixed(2)} (${((finalSol - afterUnwrapSol) / LAMPORTS_PER_SOL) >= 0 ? '+' : ''}${((finalSol - afterUnwrapSol) / LAMPORTS_PER_SOL).toFixed(2)})`);
  console.log(`  XNT:  ${(Number(finalXnt.amount) / 1e6).toFixed(2)} (should be 0)`);
  console.log(`  USDC: ${(Number(finalUsdc.amount) / 1e6).toLocaleString()} (${((Number(finalUsdc.amount) - Number(afterUnwrapUsdc.amount)) / 1e6) >= 0 ? '+' : ''}${((Number(finalUsdc.amount) - Number(afterUnwrapUsdc.amount)) / 1e6).toLocaleString()})`);
  console.log();

  // ========================================
  // SUMMARY
  // ========================================
  console.log("=" .repeat(80));
  console.log("📈 ROUNDTRIP SUMMARY");
  console.log("=".repeat(80));

  const solChange = (finalSol - initialSol) / LAMPORTS_PER_SOL;
  const usdcChange = (Number(finalUsdc.amount) - Number(initialUsdc.amount)) / 1e6;
  const xntChange = Number(finalXnt.amount) - Number(initialXnt.amount);

  console.log(`Initial:  ${(initialSol / LAMPORTS_PER_SOL).toFixed(2)} SOL, ${(Number(initialUsdc.amount) / 1e6).toLocaleString()} USDC`);
  console.log(`Final:    ${(finalSol / LAMPORTS_PER_SOL).toFixed(2)} SOL, ${(Number(finalUsdc.amount) / 1e6).toLocaleString()} USDC`);
  console.log();
  console.log(`Net Change:`);
  console.log(`  SOL:  ${solChange >= 0 ? '+' : ''}${solChange.toFixed(4)} SOL (gas fees)`);
  console.log(`  USDC: ${usdcChange >= 0 ? '+' : ''}${usdcChange.toFixed(2)} USDC (slippage)`);
  console.log(`  XNT:  ${xntChange} (should be 0 - no XNT left in wallet)`);
  console.log();

  if (xntChange === 0) {
    console.log("✅ SUCCESS: All XNT properly unwrapped!");
  } else {
    console.log(`⚠️  WARNING: ${xntChange / 1e6} XNT remaining in wallet`);
  }

  console.log("=".repeat(80) + "\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
