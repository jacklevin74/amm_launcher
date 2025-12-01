import * as anchor from '@coral-xyz/anchor';
import { Program, AnchorProvider } from '@coral-xyz/anchor';
import { BondingCurve } from '../target/types/bonding_curve';
import { PublicKey, Keypair } from '@solana/web3.js';
import { getOrCreateAssociatedTokenAccount, getAccount, TOKEN_PROGRAM_ID, transfer } from '@solana/spl-token';
import fs from 'fs';

async function main() {
  const provider = AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.BondingCurve as Program<BondingCurve>;

  const poolAddress = new PublicKey('Erv5YtP4vtBdJxG7Dh44vpjm5w5yJUmmyESpqzQwvFfc');
  const pool = await program.account.pool.fetch(poolAddress);

  // Check if trader wallet exists
  if (!fs.existsSync('/tmp/trader-wallet.json')) {
    console.log('❌ Trader wallet not found at /tmp/trader-wallet.json');
    process.exit(1);
  }

  const traderData = JSON.parse(fs.readFileSync('/tmp/trader-wallet.json', 'utf-8'));
  const traderKeypair = Keypair.fromSecretKey(new Uint8Array(traderData));

  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║              FUND TRADER WITH 50M USDC                     ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');
  console.log(`Trader Address: ${traderKeypair.publicKey.toString()}`);

  // Get or create trader USDC account
  const traderUsdc = await getOrCreateAssociatedTokenAccount(
    provider.connection,
    (provider.wallet as any).payer,
    pool.usdcMint,
    traderKeypair.publicKey
  );

  // Check current balance
  const currentBalance = await getAccount(provider.connection, traderUsdc.address);
  const currentUsdcFormatted = Number(currentBalance.amount) / 1e6;
  console.log(`Current USDC Balance: ${currentUsdcFormatted.toFixed(2)} USDC\n`);

  // Get authority USDC account
  const authorityUsdc = await getOrCreateAssociatedTokenAccount(
    provider.connection,
    (provider.wallet as any).payer,
    pool.usdcMint,
    (provider.wallet as any).payer.publicKey
  );

  const targetBalance = 50_000_000 * 1e6; // 50M USDC
  const amountNeeded = targetBalance - Number(currentBalance.amount);

  if (amountNeeded <= 0) {
    console.log('✅ Trader already has 50M+ USDC');
    return;
  }

  console.log(`Transferring ${(amountNeeded / 1e6).toFixed(2)} USDC to trader...`);

  // Transfer USDC from authority to trader
  const tx = await transfer(
    provider.connection,
    (provider.wallet as any).payer,
    authorityUsdc.address,
    traderUsdc.address,
    (provider.wallet as any).payer,
    amountNeeded
  );

  console.log(`✅ Transfer complete: ${tx.substring(0, 20)}...`);

  const finalBalance = await getAccount(provider.connection, traderUsdc.address);
  const finalUsdcFormatted = Number(finalBalance.amount) / 1e6;
  console.log(`\n✅ Final USDC Balance: ${finalUsdcFormatted.toFixed(2)} USDC\n`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('\n❌ Error:', error);
    process.exit(1);
  });
