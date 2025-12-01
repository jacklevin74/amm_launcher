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

  const poolAddress = new PublicKey('67hc8FwCxnrkgrCdU6Rc8Xp8Jq2LU8FoDaJ2GH8dW6aw');

  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║     AGGRESSIVE FLOOR DEFENSE TEST - DRIVE PRICE < $1     ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  // Load trader wallet
  const traderData = JSON.parse(fs.readFileSync('/tmp/trader-wallet.json', 'utf-8'));
  const traderKeypair = Keypair.fromSecretKey(new Uint8Array(traderData));

  // Step 1: First buy a large amount of XNT (8M USDC)
  console.log('📍 Step 1: Buy large amount of XNT (8M USDC) to get inventory...');

  let pool = await program.account.pool.fetch(poolAddress);
  const initialReserveBalance = await provider.connection.getTokenAccountBalance(pool.ceilingReserveXnt);
  const initialReserve = Number(initialReserveBalance.value.amount);

  console.log(`   Initial Price: $${(pool.usdcReserve.toNumber() / pool.xntReserve.toNumber()).toFixed(6)}`);
  console.log(`   Initial Reserve: ${initialReserve / 1e6}M XNT\n`);

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

  const [ceilingReservePda] = PublicKey.findProgramAddressSync(
    [Buffer.from('ceiling_reserve'), poolAddress.toBuffer()],
    program.programId
  );

  const buyAmount = 8_000_000 * 1e6;

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

  pool = await program.account.pool.fetch(poolAddress);
  const priceAfterBuy = pool.usdcReserve.toNumber() / pool.xntReserve.toNumber();
  console.log(`   Price after buy: $${priceAfterBuy.toFixed(6)}`);

  const xntBalanceInfo = await provider.connection.getTokenAccountBalance(traderXnt.address);
  let xntBalance = Number(xntBalanceInfo.value.amount);
  console.log(`   Trader XNT balance: ${(xntBalance / 1e6).toFixed(2)}M XNT\n`);

  // Step 2: Iteratively sell XNT until price goes below $1.00
  console.log('📍 Step 2: Selling XNT iteratively until price < $1.00...\n');

  let iteration = 0;
  const targetPrice = 1.0;
  const sellAmount = 200_000 * 1e6; // Sell 200K XNT at a time

  while (true) {
    iteration++;

    pool = await program.account.pool.fetch(poolAddress);
    const currentPrice = pool.usdcReserve.toNumber() / pool.xntReserve.toNumber();

    console.log(`   Iteration ${iteration}:`);
    console.log(`   Price: $${currentPrice.toFixed(6)}, XNT Reserve: ${(pool.xntReserve.toNumber() / 1e6).toFixed(2)}M`);

    // Check ceiling reserve
    const reserveInfo = await provider.connection.getTokenAccountBalance(pool.ceilingReserveXnt);
    const currentReserve = Number(reserveInfo.value.amount);
    const deposited = (currentReserve - initialReserve) / 1e6;
    console.log(`   Ceiling Reserve: ${(currentReserve / 1e6).toFixed(2)}M XNT (${deposited > 0 ? `+${deposited.toFixed(2)}M deposited` : 'no change'})`);

    if (currentPrice <= targetPrice && deposited > 0) {
      console.log(`\n   ✅ SUCCESS! Floor defense triggered!`);
      console.log(`   Final Price: $${currentPrice.toFixed(6)}`);
      console.log(`   XNT Deposited to Reserve: ${deposited.toFixed(2)}M XNT`);
      break;
    }

    // Check if we have enough XNT to sell
    const balanceCheck = await provider.connection.getTokenAccountBalance(traderXnt.address);
    xntBalance = Number(balanceCheck.value.amount);

    if (xntBalance < sellAmount) {
      console.log(`\n   ⚠️  Insufficient XNT: ${(xntBalance / 1e6).toFixed(2)}M XNT`);
      console.log(`   Current price: $${currentPrice.toFixed(6)}`);
      console.log(`   XNT deposited so far: ${deposited.toFixed(2)}M`);
      break;
    }

    console.log(`   Selling ${sellAmount / 1e6}M XNT...`);

    try {
      const tx = await program.methods
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

      const poolAfter = await program.account.pool.fetch(poolAddress);
      const priceAfter = poolAfter.usdcReserve.toNumber() / poolAfter.xntReserve.toNumber();
      const priceDrop = ((currentPrice - priceAfter) / currentPrice) * 100;

      console.log(`   ✅ TX: ${tx.substring(0, 20)}...`);
      console.log(`   New Price: $${priceAfter.toFixed(6)} (↓${priceDrop.toFixed(2)}%)\n`);
    } catch (error: any) {
      console.error(`\n   ❌ Sell failed:`, error.message);
      break;
    }

    await new Promise(resolve => setTimeout(resolve, 500));
  }

  // Final state
  const finalPool = await program.account.pool.fetch(poolAddress);
  const finalPrice = finalPool.usdcReserve.toNumber() / finalPool.xntReserve.toNumber();
  const finalReserveInfo = await provider.connection.getTokenAccountBalance(pool.ceilingReserveXnt);
  const finalReserve = Number(finalReserveInfo.value.amount);
  const totalDeposited = (finalReserve - initialReserve) / 1e6;

  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║                    FINAL STATE                             ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');
  console.log(`   Final Price: $${finalPrice.toFixed(6)}`);
  console.log(`   XNT Reserve: ${(finalPool.xntReserve.toNumber() / 1e6).toFixed(2)}M`);
  console.log(`   USDC Reserve: ${(finalPool.usdcReserve.toNumber() / 1e6).toFixed(2)}M`);
  console.log(`   Ceiling Reserve: ${(finalReserve / 1e6).toFixed(2)}M XNT`);
  console.log(`   Total XNT Deposited: ${totalDeposited.toFixed(2)}M XNT`);
  console.log(`   Floor Defense ${totalDeposited > 0 ? '✅ WORKED' : '❌ DID NOT TRIGGER'}`);
  console.log(`   Total Iterations: ${iteration}\n`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('\n❌ Error:', error);
    process.exit(1);
  });
