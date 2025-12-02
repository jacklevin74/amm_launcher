import * as anchor from '@coral-xyz/anchor';
import { AnchorProvider, Program, Wallet } from '@coral-xyz/anchor';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, getOrCreateAssociatedTokenAccount } from '@solana/spl-token';
import fs from 'fs';

async function main() {
  const [amountStr, poolAddressStr] = process.argv.slice(2);

  if (!amountStr || !poolAddressStr) {
    console.log(JSON.stringify({ success: false, error: 'Usage: withdraw-usdc.ts <amount> <pool_address>' }));
    process.exit(1);
  }

  const amount = new anchor.BN(amountStr);
  const poolAddress = new PublicKey(poolAddressStr);

  const connection = new Connection('http://localhost:8899', 'confirmed');
  const walletPath = process.env.ANCHOR_WALLET || process.env.HOME + '/.config/solana/id.json';
  const mainWallet = Keypair.fromSecretKey(Buffer.from(JSON.parse(fs.readFileSync(walletPath, 'utf-8'))));

  // Use Anchor to fetch pool data
  const wallet = new Wallet(mainWallet);
  const provider = new AnchorProvider(connection, wallet, { commitment: 'confirmed' });
  anchor.setProvider(provider);
  const program = anchor.workspace.BondingCurve as Program;

  const pool = await program.account.pool.fetch(poolAddress);
  const usdcMint = pool.usdcMint;
  const poolUsdc = pool.poolUsdc;

  // Get or create authority USDC account
  const authorityUsdc = await getOrCreateAssociatedTokenAccount(connection, mainWallet, usdcMint, mainWallet.publicKey);

  // Get current pool state
  const realUsdcBefore = await connection.getTokenAccountBalance(poolUsdc);
  const virtualUsdcBefore = pool.usdcReserve;
  const xntReserveBefore = pool.xntReserve;
  const priceBefore = Number(virtualUsdcBefore.toString()) / Number(xntReserveBefore.toString());

  console.error(`📊 Before withdrawal:`);
  console.error(`   Real USDC: ${Number(realUsdcBefore.value.amount) / 1e9} USDC`);
  console.error(`   Virtual USDC: ${Number(virtualUsdcBefore.toString()) / 1e9} USDC`);
  console.error(`   XNT Reserve: ${Number(xntReserveBefore.toString()) / 1e9} wSOL`);
  console.error(`   Price: $${priceBefore.toFixed(6)}`);
  console.error(`💰 Withdrawing ${Number(amount.toString()) / 1e9} USDC...`);

  // Call withdraw_usdc_price_neutral instruction
  const tx = await program.methods
    .withdrawUsdcPriceNeutral(amount)
    .accountsPartial({
      authority: mainWallet.publicKey,
      pool: poolAddress,
      poolUsdc: poolUsdc,
      authorityUsdc: authorityUsdc.address,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .rpc();

  await connection.confirmTransaction(tx, 'confirmed');

  // Get updated pool state
  const poolAfter = await program.account.pool.fetch(poolAddress);
  const realUsdcAfter = await connection.getTokenAccountBalance(poolUsdc);
  const virtualUsdcAfter = poolAfter.usdcReserve;
  const xntReserveAfter = poolAfter.xntReserve;
  const priceAfter = Number(virtualUsdcAfter.toString()) / Number(xntReserveAfter.toString());

  console.error(`\n📊 After withdrawal:`);
  console.error(`   Real USDC: ${Number(realUsdcAfter.value.amount) / 1e9} USDC (${((Number(realUsdcAfter.value.amount) - Number(realUsdcBefore.value.amount)) / 1e9).toFixed(2)})`);
  console.error(`   Virtual USDC: ${Number(virtualUsdcAfter.toString()) / 1e9} USDC (unchanged)`);
  console.error(`   XNT Reserve: ${Number(xntReserveAfter.toString()) / 1e9} wSOL (unchanged)`);
  console.error(`   Price: $${priceAfter.toFixed(6)} (unchanged)`);
  console.error(`   Virtual gap: ${(Number(virtualUsdcAfter.toString()) - Number(realUsdcAfter.value.amount)) / 1e9} USDC`);

  console.log(JSON.stringify({
    success: true,
    tx,
    withdrawn: Number(amount.toString()) / 1e9,
    realUsdcBefore: Number(realUsdcBefore.value.amount) / 1e9,
    realUsdcAfter: Number(realUsdcAfter.value.amount) / 1e9,
    virtualUsdc: Number(virtualUsdcAfter.toString()) / 1e9,
    priceBefore: priceBefore,
    priceAfter: priceAfter,
    priceUnchanged: Math.abs(priceAfter - priceBefore) < 0.000001
  }));
}

main().catch(e => {
  console.log(JSON.stringify({ success: false, error: e.message }));
  process.exit(1);
});
