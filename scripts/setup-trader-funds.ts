import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { BondingCurve } from "../target/types/bonding_curve";
import {
  PublicKey,
  Keypair,
  LAMPORTS_PER_SOL,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  createMintToInstruction,
} from "@solana/spl-token";
import * as fs from "fs";

// Trader wallet address (trading wallet from UI)
const TRADER_WALLET = new PublicKey("6fsofBh5tsKb66MTcgeQPAbi32zWTvm6pQ2ENDuVxUBM");

// Load mint authority wallet (has permission to mint USDC)
const mintAuthorityKeypairData = JSON.parse(
  fs.readFileSync("/Users/yakovlevin/.config/solana/id.json", "utf-8")
);
const mintAuthorityKeypair = Keypair.fromSecretKey(new Uint8Array(mintAuthorityKeypairData));

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.BondingCurve as Program<BondingCurve>;
  const authority = provider.wallet.publicKey;

  console.log("Authority:", authority.toString());
  console.log("Trader:", TRADER_WALLET.toString());

  // Get pool address from command line or use default
  const poolAddress = process.argv[2] || "C9VdVhmEeyDhqeQYrqwGe3eS9YMighTHXuLyAdk227Hr";
  const pool = new PublicKey(poolAddress);

  // Fetch pool data
  const poolAccount = await program.account.pool.fetch(pool);
  const usdcMint = poolAccount.usdcMint;

  console.log("\n=== SETUP TRADER FUNDS ===");
  console.log("Pool:", poolAddress);
  console.log("USDC Mint:", usdcMint.toString());

  // 1. Transfer 10M SOL to trader
  console.log("\n1. Transferring 10,000,000 SOL to trader...");
  const solAmount = 10_000_000 * LAMPORTS_PER_SOL;

  const transferIx = SystemProgram.transfer({
    fromPubkey: authority,
    toPubkey: TRADER_WALLET,
    lamports: solAmount,
  });

  const transferTx = new Transaction().add(transferIx);
  const transferSig = await provider.sendAndConfirm(transferTx);
  console.log("✓ Transferred 10M SOL");
  console.log("  TX:", transferSig);

  // 2. Get or create trader's USDC account
  console.log("\n2. Setting up trader's USDC account...");
  const traderUsdc = await getAssociatedTokenAddress(
    usdcMint,
    TRADER_WALLET
  );

  const traderUsdcInfo = await provider.connection.getAccountInfo(traderUsdc);
  if (!traderUsdcInfo) {
    const createAtaIx = createAssociatedTokenAccountInstruction(
      authority,
      traderUsdc,
      TRADER_WALLET,
      usdcMint
    );
    const createAtaTx = new Transaction().add(createAtaIx);
    await provider.sendAndConfirm(createAtaTx);
    console.log("✓ Created trader USDC account:", traderUsdc.toString());
  } else {
    console.log("✓ Trader USDC account exists:", traderUsdc.toString());
  }

  // 3. Mint 30M USDC to trader
  console.log("\n3. Minting 30,000,000 USDC to trader...");
  const usdcAmount = 30_000_000 * 1e6; // 30M USDC with 6 decimals

  const mintToIx = createMintToInstruction(
    usdcMint,
    traderUsdc,
    mintAuthorityKeypair.publicKey,
    usdcAmount
  );

  const mintTx = new Transaction().add(mintToIx);
  mintTx.feePayer = authority;
  mintTx.recentBlockhash = (await provider.connection.getLatestBlockhash()).blockhash;
  mintTx.partialSign(mintAuthorityKeypair);
  const mintSig = await provider.sendAndConfirm(mintTx);
  console.log("✓ Minted 30M USDC");
  console.log("  TX:", mintSig);

  // 4. Check final balances
  console.log("\n=== FINAL BALANCES ===");
  const solBalance = await provider.connection.getBalance(TRADER_WALLET);
  console.log("Trader SOL:", (solBalance / LAMPORTS_PER_SOL).toLocaleString());

  const usdcBalance = await provider.connection.getTokenAccountBalance(traderUsdc);
  console.log("Trader USDC:", Number(usdcBalance.value.amount) / 1e6);

  console.log("\n✓ Setup complete!");
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
