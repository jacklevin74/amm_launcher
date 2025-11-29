/**
 * Create real SPL tokens for testing bonding curve
 */

import * as anchor from "@coral-xyz/anchor";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import fs from "fs";
import path from "path";

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const payer = provider.wallet as anchor.Wallet;

  console.log("\n🪙 Creating Real SPL Tokens...\n");

  // Create XNT token (6 decimals)
  console.log("Creating XNT token...");
  const xntMint = await createMint(
    provider.connection,
    payer.payer,
    payer.publicKey, // mint authority
    payer.publicKey, // freeze authority
    6 // decimals
  );
  console.log(`✅ XNT Mint: ${xntMint.toBase58()}`);

  // Create USDC token (6 decimals like real USDC)
  console.log("Creating USDC token...");
  const usdcMint = await createMint(
    provider.connection,
    payer.payer,
    payer.publicKey,
    payer.publicKey,
    6
  );
  console.log(`✅ USDC Mint: ${usdcMint.toBase58()}`);

  // Create token accounts for the authority
  const authorityXntAccount = await getOrCreateAssociatedTokenAccount(
    provider.connection,
    payer.payer,
    xntMint,
    payer.publicKey
  );
  console.log(`✅ Authority XNT Account: ${authorityXntAccount.address.toBase58()}`);

  const authorityUsdcAccount = await getOrCreateAssociatedTokenAccount(
    provider.connection,
    payer.payer,
    usdcMint,
    payer.publicKey
  );
  console.log(`✅ Authority USDC Account: ${authorityUsdcAccount.address.toBase58()}`);

  // Mint initial supply
  const INITIAL_XNT = 10_000_000_000_000; // 10M XNT
  const INITIAL_USDC = 10_000_000_000_000; // 10M USDC

  console.log("\n💰 Minting initial supply...");
  await mintTo(
    provider.connection,
    payer.payer,
    xntMint,
    authorityXntAccount.address,
    payer.publicKey,
    INITIAL_XNT
  );
  console.log(`✅ Minted ${INITIAL_XNT / 1e6} XNT`);

  await mintTo(
    provider.connection,
    payer.payer,
    usdcMint,
    authorityUsdcAccount.address,
    payer.publicKey,
    INITIAL_USDC
  );
  console.log(`✅ Minted ${INITIAL_USDC / 1e6} USDC`);

  // Save token addresses to file
  const tokenConfig = {
    xntMint: xntMint.toBase58(),
    usdcMint: usdcMint.toBase58(),
    authorityXnt: authorityXntAccount.address.toBase58(),
    authorityUsdc: authorityUsdcAccount.address.toBase58(),
    created: new Date().toISOString(),
  };

  const configPath = path.join(__dirname, "../.tokens.json");
  fs.writeFileSync(configPath, JSON.stringify(tokenConfig, null, 2));
  console.log(`\n✅ Token config saved to ${configPath}`);

  console.log("\n📊 Token Summary:");
  console.log(`   XNT Mint: ${xntMint.toBase58()}`);
  console.log(`   USDC Mint: ${usdcMint.toBase58()}`);
  console.log(`   Authority has: ${INITIAL_XNT / 1e6} XNT, ${INITIAL_USDC / 1e6} USDC`);
  console.log("\n✅ Real SPL tokens created successfully!\n");
}

main().catch(console.error);
