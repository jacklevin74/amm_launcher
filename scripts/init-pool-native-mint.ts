import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { BondingCurve } from "../target/types/bonding_curve";
import {
  TOKEN_PROGRAM_ID,
  NATIVE_MINT,
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getAccount,
  createSyncNativeInstruction,
} from "@solana/spl-token";
import { Keypair, Connection, LAMPORTS_PER_SOL, SystemProgram } from "@solana/web3.js";
import * as fs from "fs";

const VIRTUAL_USDC_STR = "10000000000000000"; // 10M virtual USDC (9 decimals) = 10,000,000 * 1e9
const TRADER_USDC_STR = "10000000000000000";  // 10M USDC for trader (9 decimals)
const INITIAL_XNT_STR = "10000000000000000";  // 10M XNT/wSOL (9 decimals) = 10,000,000 * 1e9
const INITIAL_XNT = 10_000_000 * LAMPORTS_PER_SOL;  // 10M SOL in lamports for wrapping

async function main() {
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

  console.log("📊 Using native SOL mint for XNT (wSOL)...");
  const xntMint = NATIVE_MINT;  // So11111111111111111111111111111111111111112

  console.log("📊 Creating USDC mint with 9 decimals (matching wSOL)...");
  const usdcMint = await createMint(connection, walletKeypair, walletKeypair.publicKey, null, 9);

  console.log(`✅ XNT Mint (Native wSOL): ${xntMint.toString()}`);
  console.log(`✅ USDC Mint: ${usdcMint.toString()}`);

  const [poolPda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("pool"), xntMint.toBuffer(), usdcMint.toBuffer()],
    program.programId
  );

  console.log(`✅ Pool PDA: ${poolPda.toString()}`);

  // Find ceiling reserve PDA
  const [ceilingReservePda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("ceiling_reserve"), poolPda.toBuffer()],
    program.programId
  );

  console.log(`✅ Ceiling Reserve PDA: ${ceilingReservePda.toString()}`);

  console.log("\n💰 Creating and wrapping 10M SOL into wSOL for pool initialization...");

  // Create authority's wSOL account - this sends a transaction
  const authorityXntAccount = await getOrCreateAssociatedTokenAccount(
    connection,
    walletKeypair,
    NATIVE_MINT,
    walletKeypair.publicKey
  );

  // Now wrap SOL by transferring to the account and syncing
  const wrapIx = SystemProgram.transfer({
    fromPubkey: walletKeypair.publicKey,
    toPubkey: authorityXntAccount.address,
    lamports: INITIAL_XNT,  // 10M SOL
  });
  const syncIx = createSyncNativeInstruction(authorityXntAccount.address);

  const wrapTx = new anchor.web3.Transaction().add(wrapIx, syncIx);
  await provider.sendAndConfirm(wrapTx);

  const authorityBalance = await getAccount(connection, authorityXntAccount.address);
  console.log(`✅ Wrapped ${(Number(authorityBalance.amount) / 1e9).toLocaleString()} wSOL`);

  console.log("\n📊 Initializing pool with 10M wSOL (XNT)...");
  const poolXntKeypair = Keypair.generate();
  const poolUsdcKeypair = Keypair.generate();
  const ceilingReserveXntKeypair = Keypair.generate();

  await program.methods
    .initializePool(
      new anchor.BN(INITIAL_XNT_STR),       // 10M XNT/wSOL (9 decimals)
      new anchor.BN(VIRTUAL_USDC_STR),      // virtual_usdc_amount (10B USDC in atomic units)
      true,                                 // price_floor_enabled
      new anchor.BN(2_000_000),             // price_ceiling ($2.00)
      new anchor.BN(1_000_000)              // price_floor ($1.00)
    )
    .accountsPartial({
      initializer: walletKeypair.publicKey,
      xntMint,
      usdcMint,
      poolXnt: poolXntKeypair.publicKey,
      poolUsdc: poolUsdcKeypair.publicKey,
      initializerXnt: authorityXntAccount.address,
      ceilingReserveXnt: ceilingReserveXntKeypair.publicKey,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .signers([poolXntKeypair, poolUsdcKeypair, ceilingReserveXntKeypair])
    .rpc();

  console.log(`✅ Pool initialized with 10M wSOL (XNT)`);

  // Load trader wallet
  const traderWalletPath = "/tmp/trader-wallet.json";
  const traderKeypair = Keypair.fromSecretKey(
    Buffer.from(JSON.parse(fs.readFileSync(traderWalletPath, "utf-8")))
  );

  console.log(`\n👤 Trader Address: ${traderKeypair.publicKey.toString()}`);

  // Transfer 10M SOL to trader (they can wrap it themselves if needed)
  console.log("\n💰 Transferring 10M SOL to trader...");
  const transferIx = SystemProgram.transfer({
    fromPubkey: walletKeypair.publicKey,
    toPubkey: traderKeypair.publicKey,
    lamports: 10_000_000 * LAMPORTS_PER_SOL,
  });
  const transferTx = new anchor.web3.Transaction().add(transferIx);
  await provider.sendAndConfirm(transferTx);

  const traderSolBalance = await connection.getBalance(traderKeypair.publicKey);
  console.log(`✅ Trader SOL Balance: ${(traderSolBalance / LAMPORTS_PER_SOL).toLocaleString()} SOL`);

  // Mint 10M USDC to trader
  console.log("\n💵 Minting 10M USDC to trader...");
  const traderUsdcAccount = await getOrCreateAssociatedTokenAccount(
    connection,
    walletKeypair,
    usdcMint,
    traderKeypair.publicKey
  );

  await mintTo(
    connection,
    walletKeypair,
    usdcMint,
    traderUsdcAccount.address,
    walletKeypair.publicKey,
    BigInt(TRADER_USDC_STR)
  );

  const traderUsdcBalance = await getAccount(connection, traderUsdcAccount.address);
  console.log(`✅ Trader USDC Balance: ${(Number(traderUsdcBalance.amount) / 1e9).toLocaleString()} USDC`);

  // Fund ceiling reserve with 10M wSOL
  console.log("\n🛡️ Funding ceiling reserve with 10M wSOL...");

  // Create wSOL account for ceiling reserve
  const ceilingReserveWSOL = await getOrCreateAssociatedTokenAccount(
    connection,
    walletKeypair,
    NATIVE_MINT,
    ceilingReserveXntKeypair.publicKey
  );

  // Wrap 10M SOL for ceiling reserve
  const wrapReserveIx = SystemProgram.transfer({
    fromPubkey: walletKeypair.publicKey,
    toPubkey: ceilingReserveWSOL.address,
    lamports: INITIAL_XNT,  // 10M SOL
  });
  const wrapReserveTx = new anchor.web3.Transaction().add(wrapReserveIx);
  const syncReserveIx = createSyncNativeInstruction(ceilingReserveWSOL.address);
  wrapReserveTx.add(syncReserveIx);
  await provider.sendAndConfirm(wrapReserveTx);

  const ceilingBalance = await getAccount(connection, ceilingReserveWSOL.address);
  console.log(`✅ Ceiling Reserve: ${(Number(ceilingBalance.amount) / 1e9).toLocaleString()} wSOL (XNT)`);

  // Verify pool state
  const pool = await program.account.pool.fetch(poolPda);
  const priceNum = Number(pool.usdcReserve.toString()) / Number(pool.xntReserve.toString());

  console.log("\n" + "=".repeat(60));
  console.log("🎉 INITIALIZATION COMPLETE!");
  console.log("=".repeat(60));
  console.log(`\n📊 Pool Address: ${poolPda.toString()}`);
  console.log(`💰 XNT Mint (Native wSOL): ${xntMint.toString()}`);
  console.log(`💵 USDC Mint: ${usdcMint.toString()}`);
  console.log(`🛡️ Ceiling Reserve wSOL: ${ceilingReserveWSOL.address.toString()}`);
  console.log(`\n📈 Pool State:`);
  console.log(`   XNT/wSOL Reserve: ${(Number(pool.xntReserve.toString()) / 1e9).toLocaleString()} wSOL`);
  console.log(`   USDC Reserve (Virtual): ${(Number(pool.usdcReserve.toString()) / 1e9).toLocaleString()} USDC`);
  console.log(`   Price: $${priceNum.toFixed(6)}`);
  console.log(`\n👤 Trader: ${traderKeypair.publicKey.toString()}`);
  console.log(`   SOL: ${(traderSolBalance / LAMPORTS_PER_SOL).toLocaleString()} SOL`);
  console.log(`   USDC: ${(Number(traderUsdcBalance.amount) / 1e9).toLocaleString()} USDC`);
  console.log(`\n💡 Note: XNT is now wSOL (native wrapped SOL)`);
  console.log(`   Users can wrap/unwrap SOL ↔ wSOL using standard Solana wallets`);
  console.log(`   No custom wrap/unwrap functions needed!`);
  console.log(`\n🌐 Start web interface:`);
  console.log(`   cd web && node server.js`);
  console.log(`   Visit: http://localhost:3030/trading`);

  // Save pool info to file
  const poolInfo = `Pool: ${poolPda.toString()}
XNT Mint (Native wSOL): ${xntMint.toString()}
USDC Mint: ${usdcMint.toString()}
Ceiling Reserve wSOL: ${ceilingReserveWSOL.address.toString()}
`;

  fs.writeFileSync("POOL_INFO.txt", poolInfo);
  console.log("\n📝 Pool info saved to POOL_INFO.txt");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
