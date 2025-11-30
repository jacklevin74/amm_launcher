import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { BondingCurve } from "../target/types/bonding_curve";
import { getAccount, getAssociatedTokenAddress } from "@solana/spl-token";
import * as fs from "fs";

(async () => {
  const connection = new anchor.web3.Connection('http://localhost:8899', 'confirmed');
  const walletData = JSON.parse(fs.readFileSync('/tmp/trader-wallet.json', 'utf8'));
  const traderKeypair = anchor.web3.Keypair.fromSecretKey(new Uint8Array(walletData));

  console.log('Trader Address:', traderKeypair.publicKey.toString());

  // Setup program
  const walletPath = process.env.ANCHOR_WALLET || process.env.HOME + "/.config/solana/id.json";
  const mainWallet = anchor.web3.Keypair.fromSecretKey(
    Buffer.from(JSON.parse(fs.readFileSync(walletPath, "utf-8")))
  );
  const wallet = new anchor.Wallet(mainWallet);
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  anchor.setProvider(provider);
  const program = anchor.workspace.BondingCurve as Program<BondingCurve>;

  const poolAddress = new anchor.web3.PublicKey('41BtpyzrYMGoM3ivFkw5ZiaEurSc4HBW1fdBKzQYuJ63');
  const pool = await program.account.pool.fetch(poolAddress);

  console.log('USDC Mint:', pool.usdcMint.toString());
  console.log('XNT Mint:', pool.xntMint.toString());

  // Get USDC token account
  const usdcAccount = await getAssociatedTokenAddress(
    pool.usdcMint,
    traderKeypair.publicKey
  );

  console.log('USDC Token Account:', usdcAccount.toString());

  try {
    const accountInfo = await getAccount(connection, usdcAccount);
    console.log('\n✅ USDC Balance:', Number(accountInfo.amount) / 1e6, 'USDC');
  } catch (e: any) {
    console.log('\n❌ Error:', e.message);
    console.log('Token account does not exist yet - needs to be created');
  }

  // Also check XNT balance
  const xntAccount = await getAssociatedTokenAddress(
    pool.xntMint,
    traderKeypair.publicKey
  );

  try {
    const accountInfo = await getAccount(connection, xntAccount);
    console.log('✅ XNT Balance:', Number(accountInfo.amount) / 1e6, 'XNT');
  } catch (e) {
    console.log('❌ XNT account does not exist yet');
  }
})();
