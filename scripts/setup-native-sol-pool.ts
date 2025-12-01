/**
 * Setup Script for Native SOL Bonding Curve Pool
 *
 * This script:
 * 1. Creates a USDC mint (SPL token)
 * 2. Initializes a bonding curve pool with native SOL as XNT
 * 3. Funds the bot reserve PDA with SOL for price corridor defense
 * 4. Creates a trader wallet with USDC for testing
 *
 * Usage:
 *   ANCHOR_PROVIDER_URL=http://localhost:8899 \
 *   ANCHOR_WALLET=~/.config/solana/id.json \
 *   npx ts-node scripts/setup-native-sol-pool.ts
 */

import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider, Wallet } from "@coral-xyz/anchor";
import { BondingCurve } from "../target/types/bonding_curve";
import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import fs from "fs";

// Configuration
const CONFIG = {
  // Pool reserves
  INITIAL_XNT: 10_000_000 * LAMPORTS_PER_SOL,  // 10M XNT (native SOL on testnet) - funded to pool_xnt
  VIRTUAL_USDC: 10_000_000 * 1e6,              // 10M USDC (6 decimals) - virtual bootstrap

  // Bot reserve funding
  BOT_RESERVE_XNT: 10_000_000 * LAMPORTS_PER_SOL, // 10M XNT for bot interventions (1-2 USD corridor defense)

  // Trader wallet funding
  TRADER_USDC: 1_100_000 * 1e6,                // 1.1M USDC for trader
  TRADER_SOL: 10 * LAMPORTS_PER_SOL,           // 10 SOL for transaction fees

  // Paths
  TRADER_WALLET_PATH: "/tmp/trader-wallet.json",
};

async function main() {
  console.log("\n╔════════════════════════════════════════════════════════════╗");
  console.log("║     NATIVE SOL BONDING CURVE POOL - SETUP SCRIPT          ║");
  console.log("╚════════════════════════════════════════════════════════════╝\n");

  // Setup provider
  const provider = AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.BondingCurve as Program<BondingCurve>;
  const payer = provider.wallet as Wallet;

  console.log(`👤 Authority: ${payer.publicKey.toBase58()}`);
  console.log(`🌐 RPC: ${provider.connection.rpcEndpoint}\n`);

  // Step 1: Create USDC mint
  console.log("📍 Step 1: Creating USDC mint...");
  const usdcMint = await createMint(
    provider.connection,
    payer.payer,
    payer.publicKey,
    null,
    6 // USDC has 6 decimals
  );
  console.log(`✅ USDC Mint: ${usdcMint.toBase58()}\n`);

  // Step 2: Derive pool PDA (now only uses usdc_mint, not xnt_mint)
  console.log("📍 Step 2: Deriving pool PDA...");
  const [poolPda, poolBump] = PublicKey.findProgramAddressSync(
    [Buffer.from("pool"), usdcMint.toBuffer()],
    program.programId
  );
  console.log(`✅ Pool PDA: ${poolPda.toBase58()}`);
  console.log(`   Bump: ${poolBump}\n`);

  // Step 3: Derive pool_xnt PDA (holds actual SOL)
  console.log("📍 Step 3: Deriving pool_xnt PDA...");
  const [poolXntPda, poolXntBump] = PublicKey.findProgramAddressSync(
    [Buffer.from("pool_xnt"), poolPda.toBuffer()],
    program.programId
  );
  console.log(`✅ Pool XNT PDA: ${poolXntPda.toBase58()}`);
  console.log(`   Bump: ${poolXntBump}\n`);

  // Step 4: Derive bot reserve PDA
  console.log("📍 Step 4: Deriving bot reserve PDA...");
  const [botReservePda, botReserveBump] = PublicKey.findProgramAddressSync(
    [Buffer.from("bot_reserve"), poolPda.toBuffer()],
    program.programId
  );
  console.log(`✅ Bot Reserve PDA: ${botReservePda.toBase58()}`);
  console.log(`   Bump: ${botReserveBump}\n`);

  // Step 5: Create pool USDC token account
  console.log("📍 Step 5: Creating pool USDC token account...");
  const poolUsdcKeypair = Keypair.generate();
  const poolUsdc = poolUsdcKeypair.publicKey;
  console.log(`✅ Pool USDC: ${poolUsdc.toBase58()}\n`);

  // Step 6: Initialize pool
  console.log("📍 Step 6: Initializing bonding curve pool...");
  console.log(`   Initial XNT Reserve: ${CONFIG.INITIAL_XNT / LAMPORTS_PER_SOL} XNT`);
  console.log(`   Virtual USDC Reserve: ${CONFIG.VIRTUAL_USDC / 1e6} USDC`);
  console.log(`   Starting Price: $${CONFIG.VIRTUAL_USDC / CONFIG.INITIAL_XNT}`);

  const initTx = await program.methods
    .initializePool(
      new anchor.BN("10000000000000000"), // 10M XNT in lamports (10^16)
      new anchor.BN("10000000000000"),    // 10M USDC in base units (10^13)
      true // price_floor_enabled
    )
    .accountsPartial({
      authority: payer.publicKey,
      pool: poolPda,
      usdcMint: usdcMint,
      poolXnt: poolXntPda,
      poolUsdc: poolUsdc,
      botReserve: botReservePda,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .signers([poolUsdcKeypair])
    .rpc();

  console.log(`✅ Pool initialized! Tx: ${initTx}\n`);

  // Fetch and display pool state
  const pool = await program.account.pool.fetch(poolPda);
  console.log("📊 Pool State:");
  console.log(`   XNT Reserve: ${pool.solReserve.div(new anchor.BN(LAMPORTS_PER_SOL)).toString()} XNT`);
  console.log(`   USDC Reserve: ${pool.usdcReserve.div(new anchor.BN(1e6)).toString()} USDC (virtual)`);
  const price = pool.usdcReserve.mul(new anchor.BN(1e9)).div(pool.solReserve).toNumber() / 1e9;
  console.log(`   Price: $${price}`);
  console.log(`   Constant k: ${pool.k.toString()}`);
  console.log(`   Bot Reserve: ${pool.botReserve.toBase58()}\n`);

  // Step 7: Fund bot reserve with XNT
  console.log("📍 Step 7: Funding bot reserve...");
  console.log(`   Funding amount: ${CONFIG.BOT_RESERVE_XNT / LAMPORTS_PER_SOL} XNT`);

  const fundTx = await program.methods
    .fundBotReserve(new anchor.BN("10000000000000000")) // 10M XNT in lamports
    .accountsPartial({
      authority: payer.publicKey,
      pool: poolPda,
      botReserve: botReservePda,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .rpc();

  console.log(`✅ Bot reserve funded! Tx: ${fundTx}`);

  // Verify bot reserve balance
  const botReserveBalance = await provider.connection.getBalance(botReservePda);
  console.log(`   Bot Reserve Balance: ${botReserveBalance / LAMPORTS_PER_SOL} XNT\n`);

  // Step 8: Create trader wallet
  console.log("📍 Step 8: Creating trader wallet...");
  let traderKeypair: Keypair;

  if (fs.existsSync(CONFIG.TRADER_WALLET_PATH)) {
    console.log(`   Loading existing trader wallet from ${CONFIG.TRADER_WALLET_PATH}`);
    const walletData = JSON.parse(fs.readFileSync(CONFIG.TRADER_WALLET_PATH, "utf-8"));
    traderKeypair = Keypair.fromSecretKey(new Uint8Array(walletData));
  } else {
    console.log(`   Generating new trader wallet...`);
    traderKeypair = Keypair.generate();
    fs.writeFileSync(
      CONFIG.TRADER_WALLET_PATH,
      JSON.stringify(Array.from(traderKeypair.secretKey))
    );
    console.log(`   Saved to ${CONFIG.TRADER_WALLET_PATH}`);
  }

  console.log(`✅ Trader Wallet: ${traderKeypair.publicKey.toBase58()}`);

  // Fund trader with SOL for transaction fees
  console.log(`   Requesting ${CONFIG.TRADER_SOL / LAMPORTS_PER_SOL} SOL airdrop for transaction fees...`);
  const airdropSig = await provider.connection.requestAirdrop(
    traderKeypair.publicKey,
    CONFIG.TRADER_SOL
  );
  await provider.connection.confirmTransaction(airdropSig);
  console.log(`   ✅ Airdrop confirmed`);

  // Create trader USDC account and mint USDC
  console.log(`   Creating trader USDC account...`);
  const traderUsdcAccount = await getOrCreateAssociatedTokenAccount(
    provider.connection,
    payer.payer,
    usdcMint,
    traderKeypair.publicKey
  );

  console.log(`   Minting ${CONFIG.TRADER_USDC / 1e6} USDC to trader...`);
  await mintTo(
    provider.connection,
    payer.payer,
    usdcMint,
    traderUsdcAccount.address,
    payer.publicKey,
    CONFIG.TRADER_USDC
  );
  console.log(`✅ Trader funded with USDC\n`);

  // Final summary
  console.log("╔════════════════════════════════════════════════════════════╗");
  console.log("║                    SETUP COMPLETE!                        ║");
  console.log("╚════════════════════════════════════════════════════════════╝\n");
  console.log("📋 Summary:");
  console.log(`   USDC Mint:       ${usdcMint.toBase58()}`);
  console.log(`   Pool Address:    ${poolPda.toBase58()}`);
  console.log(`   Bot Reserve:     ${botReservePda.toBase58()}`);
  console.log(`   Trader Wallet:   ${traderKeypair.publicKey.toBase58()}`);
  console.log(``);
  console.log("📊 Pool Configuration:");
  console.log(`   XNT Reserve:     ${CONFIG.INITIAL_XNT / LAMPORTS_PER_SOL} XNT (native SOL)`);
  console.log(`   USDC Reserve:    ${CONFIG.VIRTUAL_USDC / 1e6} USDC (virtual)`);
  console.log(`   Starting Price:  $${CONFIG.VIRTUAL_USDC / CONFIG.INITIAL_XNT}`);
  console.log(`   Bot Reserve:     ${CONFIG.BOT_RESERVE_XNT / LAMPORTS_PER_SOL} XNT`);
  console.log(``);
  console.log("🚀 Next Steps:");
  console.log(`   1. Start price corridor bot:`);
  console.log(`      npx ts-node bots/price-corridor-bot.ts --pool-address ${poolPda.toBase58()}`);
  console.log(``);
  console.log(`   2. Test trading via web interface:`);
  console.log(`      node web/server.js`);
  console.log(`      Open http://localhost:3030/trading`);
  console.log(``);
  console.log(`   3. Or use CLI trader:`);
  console.log(`      npx ts-node scripts/interactive-trader.ts --pool=${poolPda.toBase58()}`);
  console.log("");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n❌ Error:", error);
    process.exit(1);
  });
