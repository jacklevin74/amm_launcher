import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { BondingCurve } from "../target/types/bonding_curve";
import {
  TOKEN_PROGRAM_ID,
  NATIVE_MINT,
  getOrCreateAssociatedTokenAccount,
  getAccount,
  syncNative,
} from "@solana/spl-token";
import { Keypair, Connection, LAMPORTS_PER_SOL, SystemProgram } from "@solana/web3.js";
import * as fs from "fs";

async function main() {
  console.log("\n" + "=".repeat(80));
  console.log("SIMPLE TEST: Buy wSOL (XNT) with USDC");
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

  // Read pool info from file
  const poolInfo = fs.readFileSync("POOL_INFO.txt", "utf-8");
  const poolAddress = poolInfo.match(/Pool: (\w+)/)?.[1];
  const usdcMintStr = poolInfo.match(/USDC Mint: (\w+)/)?.[1];
  const ceilingReserveStr = poolInfo.match(/Ceiling Reserve wSOL: (\w+)/)?.[1];

  if (!poolAddress || !usdcMintStr || !ceilingReserveStr) {
    throw new Error("Could not parse POOL_INFO.txt");
  }

  const poolPda = new anchor.web3.PublicKey(poolAddress);
  const usdcMint = new anchor.web3.PublicKey(usdcMintStr);
  const ceilingReserveXnt = new anchor.web3.PublicKey(ceilingReserveStr);

  console.log(`📊 Pool: ${poolAddress}`);
  console.log(`💰 XNT Mint: ${NATIVE_MINT.toString()} (Native wSOL)`);
  console.log(`💵 USDC Mint: ${usdcMintStr}\n`);

  // Load trader
  const traderWalletPath = "/tmp/trader-wallet.json";
  const traderKeypair = Keypair.fromSecretKey(
    Buffer.from(JSON.parse(fs.readFileSync(traderWalletPath, "utf-8")))
  );

  // Get pool state
  const poolBefore = await program.account.pool.fetch(poolPda);
  const poolData = poolBefore as any;
  const poolXnt = poolData.poolXnt;
  const poolUsdc = poolData.poolUsdc;

  console.log("📋 INITIAL POOL STATE:");
  console.log(`  wSOL Reserve: ${(poolBefore.xntReserve.toNumber() / 1e9).toLocaleString()} wSOL`);
  console.log(`  USDC Reserve: ${(poolBefore.usdcReserve.toNumber() / 1e6).toLocaleString()} USDC`);
  console.log(`  Price: $${(poolBefore.usdcReserve.toNumber() / poolBefore.xntReserve.toNumber()).toFixed(6)}\n`);

  // Get trader balances
  const traderSolBefore = await connection.getBalance(traderKeypair.publicKey);

  const traderXntAccount = await getOrCreateAssociatedTokenAccount(
    connection,
    traderKeypair,
    NATIVE_MINT,
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

  console.log("👤 TRADER INITIAL BALANCES:");
  console.log(`  SOL: ${(traderSolBefore / LAMPORTS_PER_SOL).toFixed(2)}`);
  console.log(`  wSOL: ${(Number(traderXntBefore.amount) / 1e9).toFixed(2)}`);
  console.log(`  USDC: ${(Number(traderUsdcBefore.amount) / 1e6).toLocaleString()}\n`);

  // TEST: Buy 1000 USDC worth of wSOL
  const usdcAmount = 1000_000_000; // 1,000 USDC (6 decimals)

  console.log("🔵 TEST: BUY wSOL (XNT) WITH USDC");
  console.log("-".repeat(80));
  console.log(`Spending: ${(usdcAmount / 1e6).toLocaleString()} USDC\n`);

  // Find ceiling reserve PDA
  const [ceilingReservePda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("ceiling_reserve"), poolPda.toBuffer()],
    program.programId
  );

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
        ceilingReserveXnt: ceilingReserveXnt,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([traderKeypair])
      .rpc();

    await connection.confirmTransaction(buyTx, "confirmed");
    console.log(`✅ Buy TX: ${buyTx.substring(0, 20)}...\n`);

    // Get updated balances
    const traderSolAfter = await connection.getBalance(traderKeypair.publicKey);
    const traderXntAfter = await getAccount(connection, traderXntAccount.address);
    const traderUsdcAfter = await getAccount(connection, traderUsdcAccount.address);

    const poolAfter = await program.account.pool.fetch(poolPda);

    console.log("📊 AFTER BUY:");
    console.log(`  SOL: ${(traderSolAfter / LAMPORTS_PER_SOL).toFixed(2)} (gas fees)`);
    console.log(`  wSOL: ${(Number(traderXntAfter.amount) / 1e9).toFixed(2)} (+${((Number(traderXntAfter.amount) - Number(traderXntBefore.amount)) / 1e9).toFixed(2)})`);
    console.log(`  USDC: ${(Number(traderUsdcAfter.amount) / 1e6).toLocaleString()} (-${((Number(traderUsdcBefore.amount) - Number(traderUsdcAfter.amount)) / 1e6).toLocaleString()})\n`);

    console.log("📊 POOL AFTER:");
    console.log(`  wSOL Reserve: ${(poolAfter.xntReserve.toNumber() / 1e9).toLocaleString()} wSOL`);
    console.log(`  USDC Reserve: ${(poolAfter.usdcReserve.toNumber() / 1e6).toLocaleString()} USDC`);
    console.log(`  Price: $${(poolAfter.usdcReserve.toNumber() / poolAfter.xntReserve.toNumber()).toFixed(6)}\n`);

    console.log("=".repeat(80));
    console.log("✅ TEST PASSED!");
    console.log("=".repeat(80));
    console.log("\n💡 Note: Trader received wSOL (wrapped SOL) directly");
    console.log("   No custom wrap/unwrap needed - this is standard Solana wSOL!");
    console.log("   User can unwrap to native SOL using any Solana wallet\n");

  } catch (error: any) {
    console.error("❌ TEST FAILED");
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
