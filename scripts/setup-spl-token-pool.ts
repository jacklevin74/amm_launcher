/**
 * Setup Script for SPL Token Bonding Curve Pool
 * Creates XNT and USDC as SPL tokens and initializes the pool
 */

import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider, Wallet } from "@coral-xyz/anchor";
import { BondingCurve } from "../target/types/bonding_curve";
import { PublicKey, Keypair, LAMPORTS_PER_SOL, SystemProgram } from "@solana/web3.js";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import fs from "fs";

// Configuration
const CONFIG = {
  INITIAL_XNT: 10_000_000 * 1e6,        // 10M XNT (6 decimals)
  VIRTUAL_USDC: 10_000_000 * 1e6,       // 10M USDC (6 decimals)
  BOT_RESERVE_XNT: 10_000_000 * 1e6,    // 10M XNT for bot
  CEILING_RESERVE_XNT: 10_000_000 * 1e6, // 10M XNT for ceiling defense reserve
  PRICE_CEILING: 2_000_000,             // $2.00 price ceiling (6 decimals)
  PRICE_FLOOR: 1_000_000,               // $1.00 price floor (6 decimals)
  TRADER_USDC: 10_000_000 * 1e6,        // 10M USDC for trader
  TRADER_SOL: 10 * LAMPORTS_PER_SOL,    // 10 SOL for fees
  TRADER_WALLET_PATH: "/tmp/trader-wallet.json",
};

async function main() {
  console.log("\n╔════════════════════════════════════════════════════════════╗");
  console.log("║     SPL TOKEN BONDING CURVE POOL - SETUP SCRIPT           ║");
  console.log("╚════════════════════════════════════════════════════════════╝\n");

  const provider = AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.BondingCurve as Program<BondingCurve>;
  const payer = provider.wallet as Wallet;

  console.log(`👤 Authority: ${payer.publicKey.toBase58()}`);
  console.log(`🌐 RPC: ${provider.connection.rpcEndpoint}\n`);

  // Step 1: Create XNT mint
  console.log("📍 Step 1: Creating XNT mint...");
  const xntMint = await createMint(
    provider.connection,
    payer.payer,
    payer.publicKey,
    null,
    6 // 6 decimals for XNT
  );
  console.log(`✅ XNT Mint: ${xntMint.toBase58()}\n`);

  // Step 2: Create USDC mint
  console.log("📍 Step 2: Creating USDC mint...");
  const usdcMint = await createMint(
    provider.connection,
    payer.payer,
    payer.publicKey,
    null,
    6 // 6 decimals for USDC
  );
  console.log(`✅ USDC Mint: ${usdcMint.toBase58()}\n`);

  // Step 3: Derive pool PDA
  console.log("📍 Step 3: Deriving pool PDA...");
  const [poolPda, poolBump] = PublicKey.findProgramAddressSync(
    [Buffer.from("pool"), xntMint.toBuffer(), usdcMint.toBuffer()],
    program.programId
  );
  console.log(`✅ Pool PDA: ${poolPda.toBase58()}`);
  console.log(`   Bump: ${poolBump}\n`);

  // Step 4: Generate keypairs for pool token accounts (Anchor will create them)
  console.log("📍 Step 4: Generating pool XNT token account keypair...");
  const poolXntKeypair = Keypair.generate();
  console.log(`✅ Pool XNT: ${poolXntKeypair.publicKey.toBase58()}\n`);

  // Step 5: Generate keypair for pool USDC token account
  console.log("📍 Step 5: Generating pool USDC token account keypair...");
  const poolUsdcKeypair = Keypair.generate();
  console.log(`✅ Pool USDC: ${poolUsdcKeypair.publicKey.toBase58()}\n`);

  // Step 5a: Derive ceiling reserve PDA
  console.log("📍 Step 5a: Deriving ceiling reserve PDA...");
  const [ceilingReservePda, ceilingReserveBump] = PublicKey.findProgramAddressSync(
    [Buffer.from("ceiling_reserve"), poolPda.toBuffer()],
    program.programId
  );
  console.log(`✅ Ceiling Reserve PDA: ${ceilingReservePda.toBase58()}`);
  console.log(`   Bump: ${ceilingReserveBump}\n`);

  // Step 5b: Generate keypair for ceiling reserve XNT token account
  console.log("📍 Step 5b: Generating ceiling reserve XNT token account keypair...");
  const ceilingReserveXntKeypair = Keypair.generate();
  console.log(`✅ Ceiling Reserve XNT: ${ceilingReserveXntKeypair.publicKey.toBase58()}\n`);

  // Step 6: Create authority XNT account and mint XNT
  console.log("📍 Step 6: Minting XNT to authority...");
  const authorityXntAccount = await getOrCreateAssociatedTokenAccount(
    provider.connection,
    payer.payer,
    xntMint,
    payer.publicKey
  );

  // Mint enough XNT for pool initialization + bot reserve + ceiling reserve
  const totalXntNeeded = CONFIG.INITIAL_XNT + CONFIG.BOT_RESERVE_XNT + CONFIG.CEILING_RESERVE_XNT;
  await mintTo(
    provider.connection,
    payer.payer,
    xntMint,
    authorityXntAccount.address,
    payer.publicKey,
    totalXntNeeded
  );
  console.log(`✅ Minted ${totalXntNeeded / 1e6} XNT to authority`);
  console.log(`   - Pool: ${CONFIG.INITIAL_XNT / 1e6}M XNT`);
  console.log(`   - Bot Reserve: ${CONFIG.BOT_RESERVE_XNT / 1e6}M XNT`);
  console.log(`   - Ceiling Reserve: ${CONFIG.CEILING_RESERVE_XNT / 1e6}M XNT\n`);

  // Step 7: Initialize pool
  console.log("📍 Step 7: Initializing bonding curve pool...");
  console.log(`   Initial XNT Reserve: ${CONFIG.INITIAL_XNT / 1e6}M XNT`);
  console.log(`   Virtual USDC Reserve: ${CONFIG.VIRTUAL_USDC / 1e6}M USDC`);
  console.log(`   Starting Price: $${CONFIG.VIRTUAL_USDC / CONFIG.INITIAL_XNT}`);
  console.log(`   Price Ceiling: $${CONFIG.PRICE_CEILING / 1e6}\n`);

  const tx = await program.methods
    .initializePool(
      new anchor.BN(CONFIG.INITIAL_XNT),
      new anchor.BN(CONFIG.VIRTUAL_USDC),
      true, // Enable price floor
      new anchor.BN(CONFIG.PRICE_CEILING), // Price ceiling
      new anchor.BN(CONFIG.PRICE_FLOOR)    // Price floor
    )
    .accountsPartial({
      initializer: payer.publicKey,
      pool: poolPda,
      xntMint: xntMint,
      usdcMint: usdcMint,
      poolXnt: poolXntKeypair.publicKey,
      poolUsdc: poolUsdcKeypair.publicKey,
      initializerXnt: authorityXntAccount.address,
      ceilingReservePda: ceilingReservePda,
      ceilingReserveXnt: ceilingReserveXntKeypair.publicKey,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .signers([poolXntKeypair, poolUsdcKeypair, ceilingReserveXntKeypair])
    .rpc();

  console.log(`✅ Pool initialized! Tx: ${tx}\n`);

  // Step 8: Verify pool state
  console.log("📍 Step 8: Verifying pool state...");
  const pool = await program.account.pool.fetch(poolPda);
  console.log("📊 Pool State:");
  console.log(`   XNT Reserve: ${pool.xntReserve.toNumber() / 1e6}M XNT`);
  console.log(`   USDC Reserve: ${pool.usdcReserve.toNumber() / 1e6}M USDC (virtual)`);
  const price = pool.usdcReserve.toNumber() / pool.xntReserve.toNumber();
  console.log(`   Price: $${price}`);
  console.log(`   Price Ceiling: $${pool.priceCeiling.toNumber() / 1e6}`);
  console.log(`   K: ${pool.k.toString()}\n`);

  // Step 8a: Fund ceiling reserve with XNT
  console.log("📍 Step 8a: Funding ceiling reserve with XNT...");
  console.log(`   Funding ${CONFIG.CEILING_RESERVE_XNT / 1e6}M XNT for automatic ceiling defense\n`);

  const fundTx = await program.methods
    .fundCeilingReserve(new anchor.BN(CONFIG.CEILING_RESERVE_XNT))
    .accountsPartial({
      authority: payer.publicKey,
      pool: poolPda,
      authorityXnt: authorityXntAccount.address,
      ceilingReserveXnt: ceilingReserveXntKeypair.publicKey,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .rpc();

  console.log(`✅ Ceiling reserve funded! Tx: ${fundTx}`);

  // Verify ceiling reserve balance
  const ceilingReserveBalance = await provider.connection.getTokenAccountBalance(
    ceilingReserveXntKeypair.publicKey
  );
  console.log(`   Ceiling Reserve Balance: ${Number(ceilingReserveBalance.value.amount) / 1e6}M XNT\n`);

  // Step 9: Create and fund trader wallet
  console.log("📍 Step 9: Creating trader wallet...");
  let traderKeypair: Keypair;

  if (fs.existsSync(CONFIG.TRADER_WALLET_PATH)) {
    const traderData = JSON.parse(fs.readFileSync(CONFIG.TRADER_WALLET_PATH, "utf-8"));
    traderKeypair = Keypair.fromSecretKey(new Uint8Array(traderData));
    console.log(`✅ Loaded existing trader: ${traderKeypair.publicKey.toBase58()}`);
  } else {
    traderKeypair = Keypair.generate();
    fs.writeFileSync(
      CONFIG.TRADER_WALLET_PATH,
      JSON.stringify(Array.from(traderKeypair.secretKey))
    );
    console.log(`✅ Created new trader: ${traderKeypair.publicKey.toBase58()}`);
  }

  // Fund trader with SOL for fees
  console.log("\n📍 Step 10: Funding trader with SOL...");
  const airdropSig = await provider.connection.requestAirdrop(
    traderKeypair.publicKey,
    CONFIG.TRADER_SOL
  );
  await provider.connection.confirmTransaction(airdropSig);
  console.log(`✅ Airdropped ${CONFIG.TRADER_SOL / LAMPORTS_PER_SOL} SOL to trader\n`);

  // Step 11: Create trader USDC account and mint USDC
  console.log("📍 Step 11: Minting USDC to trader...");
  const traderUsdcAccount = await getOrCreateAssociatedTokenAccount(
    provider.connection,
    payer.payer,
    usdcMint,
    traderKeypair.publicKey
  );

  await mintTo(
    provider.connection,
    payer.payer,
    usdcMint,
    traderUsdcAccount.address,
    payer.publicKey,
    CONFIG.TRADER_USDC
  );
  console.log(`✅ Minted ${CONFIG.TRADER_USDC / 1e6} USDC to trader\n`);

  // Summary
  console.log("╔════════════════════════════════════════════════════════════╗");
  console.log("║                    SETUP COMPLETE                          ║");
  console.log("╚════════════════════════════════════════════════════════════╝\n");
  console.log("📋 Pool Information:");
  console.log(`   Pool Address: ${poolPda.toBase58()}`);
  console.log(`   XNT Mint: ${xntMint.toBase58()}`);
  console.log(`   USDC Mint: ${usdcMint.toBase58()}`);
  console.log(`   Pool XNT Account: ${poolXntKeypair.publicKey.toBase58()}`);
  console.log(`   Pool USDC Account: ${poolUsdcKeypair.publicKey.toBase58()}`);
  console.log(`   Starting Price: $${price}`);
  console.log(`   Price Ceiling: $${CONFIG.PRICE_CEILING / 1e6}\n`);
  console.log("🛡️ Ceiling Defense:");
  console.log(`   Ceiling Reserve PDA: ${ceilingReservePda.toBase58()}`);
  console.log(`   Ceiling Reserve XNT: ${ceilingReserveXntKeypair.publicKey.toBase58()}`);
  console.log(`   Reserve Balance: ${CONFIG.CEILING_RESERVE_XNT / 1e6}M XNT`);
  console.log(`   ⚡ Auto-injection enabled when price > $${CONFIG.PRICE_CEILING / 1e6}\n`);
  console.log("👤 Trader Information:");
  console.log(`   Address: ${traderKeypair.publicKey.toBase58()}`);
  console.log(`   SOL Balance: ${CONFIG.TRADER_SOL / LAMPORTS_PER_SOL} SOL`);
  console.log(`   USDC Balance: ${CONFIG.TRADER_USDC / 1e6}M USDC`);
  console.log(`   Wallet saved to: ${CONFIG.TRADER_WALLET_PATH}\n`);
  console.log("✅ Ready to trade with automatic ceiling defense!\n");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n❌ Error:", error);
    process.exit(1);
  });
