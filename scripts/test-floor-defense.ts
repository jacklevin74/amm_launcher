import * as anchor from '@coral-xyz/anchor';
import { Program, AnchorProvider } from '@coral-xyz/anchor';
import { BondingCurve } from '../target/types/bonding_curve';
import { PublicKey, Keypair } from '@solana/web3.js';
import { getOrCreateAssociatedTokenAccount, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import fs from 'fs';

async function main() {
  const provider = AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.BondingCurve as Program<BondingCurve>;

  const poolAddress = new PublicKey('4aJAC7NjZw5qqoCxoMD6dEHMQw2yBoPwJcdBuBGBi5Fw');
  const pool = await program.account.pool.fetch(poolAddress);

  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║     TESTING AUTOMATIC FLOOR DEFENSE MECHANISM             ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  // Load trader wallet
  const traderData = JSON.parse(fs.readFileSync('/tmp/trader-wallet.json', 'utf-8'));
  const traderKeypair = Keypair.fromSecretKey(new Uint8Array(traderData));

  console.log('📊 Initial State:');
  console.log(`   Pool XNT Reserve: ${pool.xntReserve.toNumber() / 1e6}M XNT`);
  console.log(`   Pool USDC Reserve: ${pool.usdcReserve.toNumber() / 1e6}M USDC`);
  const initialPrice = pool.usdcReserve.toNumber() / pool.xntReserve.toNumber();
  console.log(`   Price: $${initialPrice}`);
  console.log(`   Price Floor: $${pool.priceFloor.toNumber() / 1e6}\n`);

  // Get ceiling reserve balance
  const ceilingReserveBalance = await provider.connection.getTokenAccountBalance(
    pool.ceilingReserveXnt
  );
  const initialReserveBalance = Number(ceilingReserveBalance.value.amount);
  console.log(`   Ceiling Reserve: ${initialReserveBalance / 1e6}M XNT\n`);

  // Get trader accounts
  const traderXnt = await getOrCreateAssociatedTokenAccount(
    provider.connection,
    (provider.wallet as any).payer,
    pool.xntMint,
    traderKeypair.publicKey
  );

  const traderUsdc = await getOrCreateAssociatedTokenAccount(
    provider.connection,
    (provider.wallet as any).payer,
    pool.usdcMint,
    traderKeypair.publicKey
  );

  // Derive ceiling reserve PDA
  const [ceilingReservePda] = PublicKey.findProgramAddressSync(
    [Buffer.from('ceiling_reserve'), poolAddress.toBuffer()],
    program.programId
  );

  // First, we need to buy some XNT to have balance to sell
  console.log('📍 Step 1: Buy XNT to prepare for sell test (1M USDC)');
  const buyAmount = 1_000_000 * 1e6;

  const buyTx = await program.methods
    .buy(new anchor.BN(buyAmount))
    .accountsPartial({
      buyer: traderKeypair.publicKey,
      pool: poolAddress,
      poolXnt: pool.poolXnt,
      poolUsdc: pool.poolUsdc,
      buyerUsdc: traderUsdc.address,
      buyerXnt: traderXnt.address,
      ceilingReservePda: ceilingReservePda,
      ceilingReserveXnt: pool.ceilingReserveXnt,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .signers([traderKeypair])
    .rpc();

  console.log(`   ✅ Buy TX: ${buyTx.substring(0, 20)}...`);

  let poolAfter = await program.account.pool.fetch(poolAddress);
  const priceAfterBuy = poolAfter.usdcReserve.toNumber() / poolAfter.xntReserve.toNumber();
  console.log(`   Price after buy: $${priceAfterBuy}`);

  // Check trader XNT balance
  const traderXntBalance = await provider.connection.getTokenAccountBalance(traderXnt.address);
  const xntBalance = Number(traderXntBalance.value.amount);
  console.log(`   Trader XNT balance: ${xntBalance / 1e6}M XNT\n`);

  // Test: Large sell that should trigger floor defense
  console.log('📍 Step 2: Large sell (90% of XNT) - Should trigger floor defense at $1.00');
  const sellAmount = Math.floor(xntBalance * 0.9);

  const sellTx = await program.methods
    .sell(new anchor.BN(sellAmount))
    .accountsPartial({
      seller: traderKeypair.publicKey,
      pool: poolAddress,
      poolXnt: pool.poolXnt,
      poolUsdc: pool.poolUsdc,
      sellerUsdc: traderUsdc.address,
      sellerXnt: traderXnt.address,
      ceilingReserveXnt: pool.ceilingReserveXnt,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .signers([traderKeypair])
    .rpc();

  console.log(`   ✅ Sell TX: ${sellTx.substring(0, 20)}...`);

  poolAfter = await program.account.pool.fetch(poolAddress);
  const priceAfter = poolAfter.usdcReserve.toNumber() / poolAfter.xntReserve.toNumber();
  console.log(`   Price after sell: $${priceAfter}`);
  console.log(`   XNT Reserve: ${poolAfter.xntReserve.toNumber() / 1e6}M\n`);

  // Check ceiling reserve - should have increased
  const reserveAfter = await provider.connection.getTokenAccountBalance(pool.ceilingReserveXnt);
  const reserveAfterBalance = Number(reserveAfter.value.amount);
  const deposited = (reserveAfterBalance - initialReserveBalance) / 1e6;
  console.log(`   Ceiling Reserve: ${reserveAfterBalance / 1e6}M XNT`);
  console.log(`   XNT Deposited: ${deposited}M XNT ${deposited > 0 ? '✅ FLOOR DEFENSE WORKED!' : '❌ No deposit'}\n`);

  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║                    TEST RESULTS                            ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');
  console.log(`   Price Floor Enforced: ${priceAfter >= 0.99 ? '✅ YES' : '❌ NO'}`);
  console.log(`   Final Price: $${priceAfter}`);
  console.log(`   XNT Deposited to Reserve: ${deposited}M XNT`);
  console.log(`   New Reserve Balance: ${reserveAfterBalance / 1e6}M XNT\n`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('\n❌ Error:', error);
    process.exit(1);
  });
