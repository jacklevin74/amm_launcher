import * as anchor from '@coral-xyz/anchor';
import { AnchorProvider, Program, Wallet } from '@coral-xyz/anchor';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import fs from 'fs';

async function main() {
  const [amountStr, poolAddressStr] = process.argv.slice(2);

  if (!amountStr || !poolAddressStr) {
    console.log(JSON.stringify({ success: false, error: 'Usage: add-virtual-usdc.ts <amount> <pool_address>' }));
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
  const xntReserveBefore = pool.xntReserve;
  const virtualUsdcBefore = pool.usdcReserve;
  const priceBefore = Number(virtualUsdcBefore.toString()) / Number(xntReserveBefore.toString());

  console.error(`📊 Before adding virtual USDC:`);
  console.error(`   Virtual USDC: ${Number(virtualUsdcBefore.toString()) / 1e9} USDC`);
  console.error(`   XNT Reserve: ${Number(xntReserveBefore.toString()) / 1e9} wSOL`);
  console.error(`   Price: $${priceBefore.toFixed(6)}`);
  console.error(`💰 Adding ${Number(amount.toString()) / 1e9} virtual USDC...`);

  // Call add_virtual_usdc instruction
  const tx = await program.methods
    .addVirtualUsdc(amount)
    .accountsPartial({
      authority: mainWallet.publicKey,
      pool: poolAddress,
    })
    .rpc();

  await connection.confirmTransaction(tx, 'confirmed');

  // Get updated pool state
  const poolAfter = await program.account.pool.fetch(poolAddress);
  const virtualUsdcAfter = poolAfter.usdcReserve;
  const xntReserveAfter = poolAfter.xntReserve;
  const priceAfter = Number(virtualUsdcAfter.toString()) / Number(xntReserveAfter.toString());

  console.error(`\n📊 After adding virtual USDC:`);
  console.error(`   Virtual USDC: ${Number(virtualUsdcAfter.toString()) / 1e9} USDC (+${((Number(virtualUsdcAfter.toString()) - Number(virtualUsdcBefore.toString())) / 1e9).toFixed(2)})`);
  console.error(`   XNT Reserve: ${Number(xntReserveAfter.toString()) / 1e9} wSOL (unchanged)`);
  console.error(`   Price: $${priceAfter.toFixed(6)} (increased from $${priceBefore.toFixed(6)})`);

  console.log(JSON.stringify({
    success: true,
    tx,
    added: Number(amount.toString()) / 1e9,
    virtualUsdcBefore: Number(virtualUsdcBefore.toString()) / 1e9,
    virtualUsdcAfter: Number(virtualUsdcAfter.toString()) / 1e9,
    priceBefore: priceBefore,
    priceAfter: priceAfter,
    priceChange: ((priceAfter - priceBefore) / priceBefore * 100).toFixed(2) + '%'
  }));
}

main().catch(e => {
  console.log(JSON.stringify({ success: false, error: e.message }));
  process.exit(1);
});
