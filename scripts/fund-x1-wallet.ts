import * as anchor from "@coral-xyz/anchor";
import { mintTo, getOrCreateAssociatedTokenAccount } from "@solana/spl-token";
import * as fs from "fs";

async function main() {
  const connection = new anchor.web3.Connection("http://localhost:8899", "confirmed");
  const walletPath = process.env.ANCHOR_WALLET || process.env.HOME + "/.config/solana/id.json";
  const authority = anchor.web3.Keypair.fromSecretKey(Buffer.from(JSON.parse(fs.readFileSync(walletPath, "utf-8"))));
  
  const userPubkey = new anchor.web3.PublicKey("aVuLr2twoecnZGWqHFVtRtPM6W5iwSPfHRr9cpp9mMf");
  const usdcMint = new anchor.web3.PublicKey("HzsMZzBdBHBvyTMuiiCAchfWNFsh8i3XJwDpDtLKqB81");
  
  console.log("Funding wallet:", userPubkey.toString());
  console.log("USDC Mint:", usdcMint.toString());
  
  // Create ATA for user
  const userUsdc = await getOrCreateAssociatedTokenAccount(connection, authority, usdcMint, userPubkey);
  console.log("User USDC ATA:", userUsdc.address.toString());
  
  // Mint 100K USDC (6 decimals)
  const amount = 100_000 * 1_000_000;
  await mintTo(connection, authority, usdcMint, userUsdc.address, authority, amount);
  
  console.log("Minted 100,000 USDC.X");
  
  // Check balance
  const balance = await connection.getTokenAccountBalance(userUsdc.address);
  console.log("USDC.X Balance:", balance.value.uiAmount);
}

main().catch(console.error);
