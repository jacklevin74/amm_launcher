import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { BondingCurve } from "../target/types/bonding_curve";
import {
  TOKEN_PROGRAM_ID,
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getAccount,
} from "@solana/spl-token";
import { Keypair, Connection, LAMPORTS_PER_SOL, SystemProgram } from "@solana/web3.js";
import * as fs from "fs";

const VIRTUAL_USDC = 10_000_000_000_000;     // 10M virtual USDC
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
  const [solVaultPda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("sol_vault"), poolPda.toBuffer()],
    program.programId
  );

  console.log(`✅ SOL Vault PDA: ${solVaultPda.toString()}`);

  // Find ceiling reserve PDA
  const [ceilingReservePda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("ceiling_reserve"), poolPda.toBuffer()],
    program.programId
  );

  console.log(`✅ Ceiling Reserve PDA: ${ceilingReservePda.toString()}`);

  // Create authority's XNT account and mint 10M XNT
  const authorityXntAccount = await getOrCreateAssociatedTokenAccount(
    connection,
    walletKeypair,
    xntMint,
    walletKeypair.publicKey
  );

  console.log("\n💰 Minting 10M XNT for pool...");
  await mintTo(
    connection,
    walletKeypair,
    xntMint,
    authorityXntAccount.address,
    walletKeypair.publicKey,
    10_000_000_000_000  // 10M XNT
  );

  console.log(`✅ Minted 10M XNT`);

  console.log("\n📊 Initializing pool with 10M XNT...");
  const poolXntKeypair = Keypair.generate();
  const poolUsdcKeypair = Keypair.generate();
  const ceilingReserveXntKeypair = Keypair.generate();

  await program.methods
    .initializePool(
      new anchor.BN(10_000_000_000_000),   // 10M XNT
      new anchor.BN(VIRTUAL_USDC),         // virtual_usdc_amount
      true,                                 // price_floor_enabled
      new anchor.BN(2_000_000),            // price_ceiling ($2.00)
      new anchor.BN(1_000_000)             // price_floor ($1.00)
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

  console.log(`✅ Pool initialized with 10M XNT`);

  // Load trader wallet
  const traderWalletPath = "/tmp/trader-wallet.json";
  const traderKeypair = Keypair.fromSecretKey(
    Buffer.from(JSON.parse(fs.readFileSync(traderWalletPath, "utf-8")))
  );

  console.log(`\n👤 Trader Address: ${traderKeypair.publicKey.toString()}`);

  // Transfer 10M SOL to trader
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
    TRADER_USDC
  );

  const traderUsdcBalance = await getAccount(connection, traderUsdcAccount.address);
  console.log(`✅ Trader USDC Balance: ${(Number(traderUsdcBalance.amount) / 1e6).toLocaleString()} USDC`);

  // Transfer 10M SOL to vault (to back the XNT in the pool)
  console.log("\n💰 Transferring 10M SOL to vault...");
  const transferToVaultIx = SystemProgram.transfer({
    fromPubkey: walletKeypair.publicKey,
    toPubkey: solVaultPda,
    lamports: 10_000_000 * LAMPORTS_PER_SOL,
  });
  const vaultTx = new anchor.web3.Transaction().add(transferToVaultIx);
  await provider.sendAndConfirm(vaultTx);

  const vaultBalance = await connection.getBalance(solVaultPda);
  console.log(`✅ SOL Vault Balance: ${(vaultBalance / LAMPORTS_PER_SOL).toLocaleString()} SOL (backs 10M XNT in pool)`);

  // Mint and transfer 10M XNT to ceiling reserve
  console.log("\n🛡️ Funding ceiling reserve with 10M XNT...");
  await mintTo(
    connection,
    walletKeypair,
    xntMint,
    ceilingReserveXntKeypair.publicKey,
    walletKeypair.publicKey,
    10_000_000_000_000  // 10M XNT
  );

  const ceilingBalance = await getAccount(connection, ceilingReserveXntKeypair.publicKey);
  console.log(`✅ Ceiling Reserve: ${(Number(ceilingBalance.amount) / 1e6).toLocaleString()} XNT`);

  // Verify pool state
  const pool = await program.account.pool.fetch(poolPda);
  // Divide BN first before converting to Number to avoid overflow
  const usdcInTokens = pool.usdcReserve.div(new anchor.BN(1e6)).toNumber();
  const xntInTokens = pool.xntReserve.div(new anchor.BN(1e6)).toNumber();
  const price = usdcInTokens / xntInTokens;

  console.log("\n" + "=".repeat(60));
  console.log("🎉 INITIALIZATION COMPLETE!");
  console.log("=".repeat(60));
  console.log(`\n📊 Pool Address: ${poolPda.toString()}`);
  console.log(`💰 XNT Mint: ${xntMint.toString()}`);
  console.log(`💵 USDC Mint: ${usdcMint.toString()}`);
  console.log(`🔐 SOL Vault: ${solVaultPda.toString()} (${(vaultBalance / LAMPORTS_PER_SOL).toLocaleString()} SOL)`);
  console.log(`🛡️ Ceiling Reserve XNT: ${ceilingReserveXntKeypair.publicKey.toString()}`);
  console.log(`\n📈 Pool State:`);
  console.log(`   XNT Reserve: ${pool.xntReserve.div(new anchor.BN(1e6)).toNumber().toLocaleString()} XNT`);
  console.log(`   USDC Reserve (Virtual): ${pool.usdcReserve.div(new anchor.BN(1e6)).toNumber().toLocaleString()} USDC`);
  console.log(`   Price: $${price.toFixed(2)}`);
  console.log(`\n👤 Trader: ${traderKeypair.publicKey.toString()}`);
  console.log(`   SOL: ${(traderSolBalance / LAMPORTS_PER_SOL).toLocaleString()} SOL`);
  console.log(`   USDC: ${(Number(traderUsdcBalance.amount) / 1e6).toLocaleString()} USDC`);
  console.log(`\n🌐 Start web interface:`);
  console.log(`   cd web && node server.js`);
  console.log(`   Visit: http://localhost:3030/trading`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
