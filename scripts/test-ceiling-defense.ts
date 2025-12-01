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

  const poolAddress = new PublicKey('DftpSEe5zukxPJJ2S3rJh635YvizsbRskZYZEV3MvWkT');
  const pool = await program.account.pool.fetch(poolAddress);

  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║     TESTING AUTOMATIC PRICE STABILIZATION RESERVE         ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  // Load trader wallet
  const traderData = JSON.parse(fs.readFileSync('/tmp/trader-wallet.json', 'utf-8'));
  const traderKeypair = Keypair.fromSecretKey(new Uint8Array(traderData));

  console.log('📊 Initial State:');
  console.log(`   Pool XNT Reserve: ${pool.xntReserve.toNumber() / 1e6}M XNT`);
  console.log(`   Pool USDC Reserve: ${pool.usdcReserve.toNumber() / 1e6}M USDC`);
  const initialPrice = pool.usdcReserve.toNumber() / pool.xntReserve.toNumber();
  console.log(`   Price: $${initialPrice}`);
  console.log(`   Price Ceiling: $${pool.priceCeiling.toNumber() / 1e6}\n`);

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

  // Test 1: Small buy that doesn't trigger ceiling
  console.log('📍 Test 1: Small buy (100K USDC) - Should NOT trigger ceiling defense');
  const smallBuy = 100_000 * 1e6;

  const tx1 = await program.methods
    .buy(new anchor.BN(smallBuy))
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

  console.log(`   ✅ TX: ${tx1.substring(0, 20)}...`);

  let poolAfter = await program.account.pool.fetch(poolAddress);
  const priceAfter1 = poolAfter.usdcReserve.toNumber() / poolAfter.xntReserve.toNumber();
  console.log(`   Price after: $${priceAfter1}`);
  console.log(`   XNT Reserve: ${poolAfter.xntReserve.toNumber() / 1e6}M\n`);

  // Check ceiling reserve - should be unchanged
  const reserve1 = await provider.connection.getTokenAccountBalance(pool.ceilingReserveXnt);
  const reserve1Balance = Number(reserve1.value.amount);
  console.log(`   Ceiling Reserve: ${reserve1Balance / 1e6}M XNT (${reserve1Balance === initialReserveBalance ? 'UNCHANGED ✓' : 'CHANGED!'})\n`);

  // Test 2: Large buy that triggers ceiling defense
  console.log('📍 Test 2: Large buy (8M USDC) - Should trigger ceiling defense at $2.00');
  const largeBuy = 8_000_000 * 1e6;

  const tx2 = await program.methods
    .buy(new anchor.BN(largeBuy))
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

  console.log(`   ✅ TX: ${tx2.substring(0, 20)}...`);

  poolAfter = await program.account.pool.fetch(poolAddress);
  const priceAfter2 = poolAfter.usdcReserve.toNumber() / poolAfter.xntReserve.toNumber();
  console.log(`   Price after: $${priceAfter2}`);
  console.log(`   XNT Reserve: ${poolAfter.xntReserve.toNumber() / 1e6}M\n`);

  // Check ceiling reserve - should have decreased
  const reserve2 = await provider.connection.getTokenAccountBalance(pool.ceilingReserveXnt);
  const reserve2Balance = Number(reserve2.value.amount);
  const injected = (initialReserveBalance - reserve2Balance) / 1e6;
  console.log(`   Ceiling Reserve: ${reserve2Balance / 1e6}M XNT`);
  console.log(`   XNT Injected: ${injected}M XNT ${injected > 0 ? '✅ STABILIZATION WORKED!' : '❌ No injection'}\n`);

  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║                    TEST RESULTS                            ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');
  console.log(`   Price Cap Enforced: ${priceAfter2 <= 2.01 ? '✅ YES' : '❌ NO'}`);
  console.log(`   Final Price: $${priceAfter2}`);
  console.log(`   Reserve Used for Stabilization: ${injected}M XNT`);
  console.log(`   Remaining Reserve: ${reserve2Balance / 1e6}M XNT\n`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('\n❌ Error:', error);
    process.exit(1);
  });
