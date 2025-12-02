import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { BondingCurve } from "../target/types/bonding_curve";
import {
  TOKEN_PROGRAM_ID,
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getAccount,
  transfer,
} from "@solana/spl-token";
import { Keypair, Connection, LAMPORTS_PER_SOL, SystemProgram } from "@solana/web3.js";
import * as fs from "fs";

const INITIAL_XNT = 10_000_000_000_000;      // 10M XNT (wrapped from SOL)
const VIRTUAL_USDC = 10_000_000_000_000;     // 10M virtual USDC
const CEILING_RESERVE_XNT = 10_000_000_000_000;  // 10M XNT for ceiling defense
const TRADER_USDC = 10_000_000_000_000;      // 10M USDC for trader

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

  console.log("📊 Creating mints...");
  const xntMint = await createMint(connection, walletKeypair, walletKeypair.publicKey, null, 6);
  const usdcMint = await createMint(connection, walletKeypair, walletKeypair.publicKey, null, 6);

  console.log(`✅ XNT Mint: ${xntMint.toString()}`);
  console.log(`✅ USDC Mint: ${usdcMint.toString()}`);

  const [poolPda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("pool"), xntMint.toBuffer(), usdcMint.toBuffer()],
    program.programId
  );

  console.log(`✅ Pool PDA: ${poolPda.toString()}`);

  // Find SOL vault PDA
  const [solVaultPda, solVaultBump] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("sol_vault"), poolPda.toBuffer()],
    program.programId
  );

  console.log(`✅ SOL Vault PDA: ${solVaultPda.toString()}`);

  // Find ceiling reserve PDA (authority)
  const [ceilingReservePda, ceilingReserveBump] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("ceiling_reserve"), poolPda.toBuffer()],
    program.programId
  );

  console.log(`✅ Ceiling Reserve PDA: ${ceilingReservePda.toString()}`);

  // Create a temporary XNT account and mint 1 XNT for initialization
  const tempXntAccount = await getOrCreateAssociatedTokenAccount(
    connection,
    walletKeypair,
    xntMint,
    walletKeypair.publicKey
  );

  // Mint 21M XNT to tempXntAccount (1M for init + 20M for wrapping)
  await mintTo(
    connection,
    walletKeypair,
    xntMint,
    tempXntAccount.address,
    walletKeypair.publicKey,
    21_000_000_000_000  // 21M XNT with 6 decimals
  );

  console.log(`✅ Minted 21M XNT to temp account`);

  console.log("\n📊 Initializing pool...");
  const poolXntKeypair = Keypair.generate();
  const poolUsdcKeypair = Keypair.generate();
  const ceilingReserveXntKeypair = Keypair.generate(); // Will be created by init

  await program.methods
    .initializePool(
      new anchor.BN(1_000_000),            // xnt_amount (1 XNT - will deposit more later)
      new anchor.BN(VIRTUAL_USDC),         // virtual_usdc_amount
      true,                                 // price_floor_enabled
      new anchor.BN(2_000_000),            // price_ceiling ($2.00 with 6 decimals)
      new anchor.BN(1_000_000)             // price_floor ($1.00 with 6 decimals)
    )
    .accounts({
      initializer: walletKeypair.publicKey,
      xntMint,
      usdcMint,
      poolXnt: poolXntKeypair.publicKey,
      poolUsdc: poolUsdcKeypair.publicKey,
      initializerXnt: tempXntAccount.address,
      ceilingReservePda: ceilingReservePda,
      ceilingReserveXnt: ceilingReserveXntKeypair.publicKey,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .signers([poolXntKeypair, poolUsdcKeypair, ceilingReserveXntKeypair])
    .rpc();

  console.log(`✅ Pool initialized with 1 XNT and ${(VIRTUAL_USDC / 1e6).toLocaleString()}M virtual USDC`);
  console.log(`✅ Ceiling Reserve XNT Token Account: ${ceilingReserveXntKeypair.publicKey.toString()}`);

  // Deposit the remaining 20M XNT (21M minted - 1M in pool) into pool for wrapping
  console.log("\n📊 Depositing 20M XNT into pool for wrapping...");
  await program.methods
    .depositXnt(new anchor.BN(20_000_000_000_000))  // 20M XNT
    .accounts({
      authority: walletKeypair.publicKey,
      pool: poolPda,
      poolXnt: poolXntKeypair.publicKey,
      authorityXnt: tempXntAccount.address,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .rpc();

  console.log(`✅ Deposited 20M XNT into pool (total 20.000001M XNT in pool)`);

  // Now wrap 20M SOL → XNT (this will transfer XNT from pool to user)
  console.log("\n💰 Wrapping 20M SOL → XNT (transfers from pool)...");
  const solToWrap = new anchor.BN("20000000000000000"); // 20M SOL in lamports

  await program.methods
    .wrapSol(solToWrap)
    .accounts({
      user: walletKeypair.publicKey,
      pool: poolPda,
      solVault: solVaultPda,
      poolXnt: poolXntKeypair.publicKey,
      userXnt: tempXntAccount.address,
      xntMint,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  console.log(`✅ Wrapped 20M SOL → received 20M XNT from pool`);

  // Check wrapped XNT balance
  const xntAccountInfo = await getAccount(connection, tempXntAccount.address);
  console.log(`   User XNT Balance: ${(Number(xntAccountInfo.amount) / 1e6).toLocaleString()}M XNT`);

  // Now deposit 10M XNT back into pool (for trading)
  console.log("\n📊 Depositing 10M XNT into pool for trading...");
  await program.methods
    .depositXnt(new anchor.BN(INITIAL_XNT))
    .accounts({
      authority: walletKeypair.publicKey,
      pool: poolPda,
      poolXnt: poolXntKeypair.publicKey,
      authorityXnt: tempXntAccount.address,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .rpc();

  console.log(`✅ Deposited 10M XNT into pool (total 10.000001M XNT in pool for trading)`);

  // Transfer 10M XNT to ceiling reserve using SPL transfer
  console.log("\n📊 Transferring 10M XNT to ceiling reserve...");
  await transfer(
    connection,
    walletKeypair,
    tempXntAccount.address,
    ceilingReserveXntKeypair.publicKey,
    walletKeypair.publicKey,
    CEILING_RESERVE_XNT
  );

  const ceilingReserveBalance = await getAccount(connection, ceilingReserveXntKeypair.publicKey);
  console.log(`✅ Transferred ${(Number(ceilingReserveBalance.amount) / 1e6).toLocaleString()}M XNT to ceiling reserve`);

  // Verify pool state
  const pool = await program.account.pool.fetch(poolPda);
  const price = pool.usdcReserve.toNumber() / pool.xntReserve.toNumber();

  console.log(`\n✅ Pool ready for trading!`);
  console.log(`   XNT Reserve: ${(pool.xntReserve.toNumber() / 1e6).toLocaleString()}M`);
  console.log(`   USDC Reserve (Virtual): $${(pool.usdcReserve.toNumber() / 1e6).toLocaleString()}M`);
  console.log(`   Price: $${price.toFixed(2)}`);
  console.log(`   SOL in Vault: ${(solToWrap.toNumber() / LAMPORTS_PER_SOL).toLocaleString()}M SOL`);
  console.log(`   Ceiling Reserve: ${(Number(ceilingReserveBalance.amount) / 1e6).toLocaleString()}M XNT`);

  // Load trader wallet
  console.log("\n💰 Setting up trader wallet...");
  const traderWalletPath = "/tmp/trader-wallet.json";
  const traderKeypair = Keypair.fromSecretKey(
    Buffer.from(JSON.parse(fs.readFileSync(traderWalletPath, "utf-8")))
  );

  console.log(`   Trader Address: ${traderKeypair.publicKey.toString()}`);

  // Fund trader with 10M SOL
  console.log("\n   Transferring 10M SOL to trader...");
  const traderSolBN = new anchor.BN("10000000000000000"); // 10M SOL in lamports
  const transferSolTx = await connection.requestAirdrop(
    traderKeypair.publicKey,
    traderSolBN.toNumber()
  );
  await connection.confirmTransaction(transferSolTx);
  console.log(`   ✅ Transferred 10M SOL`);

  // Create trader's USDC account and mint 10M USDC
  console.log("\n   Minting 10M USDC to trader...");
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
    TRADER_USDC
  );

  const traderUsdcBalance = await getAccount(connection, traderUsdcAccount.address);
  console.log(`   ✅ Minted ${(Number(traderUsdcBalance.amount) / 1e6).toLocaleString()}M USDC`);

  // Check trader SOL balance
  const traderSolBalance = await connection.getBalance(traderKeypair.publicKey);
  console.log(`   ✅ Trader SOL Balance: ${(traderSolBalance / LAMPORTS_PER_SOL).toLocaleString()}M SOL`);

  console.log("\n" + "=".repeat(60));
  console.log("🎉 INITIALIZATION COMPLETE!");
  console.log("=".repeat(60));
  console.log(`\n📊 Pool Address: ${poolPda.toString()}`);
  console.log(`💰 XNT Mint: ${xntMint.toString()}`);
  console.log(`💵 USDC Mint: ${usdcMint.toString()}`);
  console.log(`🔐 SOL Vault: ${solVaultPda.toString()}`);
  console.log(`🛡️ Ceiling Reserve PDA: ${ceilingReservePda.toString()}`);
  console.log(`🛡️ Ceiling Reserve XNT: ${ceilingReserveXntKeypair.publicKey.toString()}`);
  console.log(`\n👤 Trader Address: ${traderKeypair.publicKey.toString()}`);
  console.log(`   - SOL Balance: ${(traderSolBalance / LAMPORTS_PER_SOL).toLocaleString()}M SOL`);
  console.log(`   - USDC Balance: ${(Number(traderUsdcBalance.amount) / 1e6).toLocaleString()}M USDC`);
  console.log(`\n🌐 Start web interface:`);
  console.log(`   cd web && node server.js`);
  console.log(`   Visit: http://localhost:3030/trading`);
  console.log(`\n💾 Save these addresses for future use!`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
