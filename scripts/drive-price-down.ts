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

  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║          DRIVING PRICE DOWN BELOW $2.00                   ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  // Load trader wallet
  const traderData = JSON.parse(fs.readFileSync('/tmp/trader-wallet.json', 'utf-8'));
  const traderKeypair = Keypair.fromSecretKey(new Uint8Array(traderData));

  let iteration = 0;
  const targetPrice = 2.0;
  const sellAmount = 50_000 * 1e6; // Sell 50K XNT at a time

  while (true) {
    iteration++;

    // Fetch current pool state
    const pool = await program.account.pool.fetch(poolAddress);
    const currentPrice = pool.usdcReserve.toNumber() / pool.xntReserve.toNumber();

    console.log(`\n📊 Iteration ${iteration}:`);
    console.log(`   Current Price: $${currentPrice.toFixed(6)}`);
    console.log(`   XNT Reserve: ${(pool.xntReserve.toNumber() / 1e6).toFixed(2)}M`);
    console.log(`   USDC Reserve: ${(pool.usdcReserve.toNumber() / 1e6).toFixed(2)}M`);

    // Check if we've reached target
    if (currentPrice <= targetPrice) {
      console.log(`\n✅ SUCCESS! Price is now $${currentPrice.toFixed(6)} (≤ $${targetPrice})`);
      console.log(`   Took ${iteration} sell iterations\n`);
      break;
    }

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

    // Check trader's XNT balance
    const xntBalance = await provider.connection.getTokenAccountBalance(traderXnt.address);
    const xntBalanceNumber = Number(xntBalance.value.amount);

    if (xntBalanceNumber < sellAmount) {
      console.log(`\n⚠️  Insufficient XNT balance: ${xntBalanceNumber / 1e6}M XNT`);
      console.log(`   Need ${sellAmount / 1e6}M XNT to continue selling`);
      console.log(`   Current price: $${currentPrice.toFixed(6)}\n`);
      break;
    }

    console.log(`   Selling ${sellAmount / 1e6}M XNT...`);

    try {
      // Execute sell
      const tx = await program.methods
        .sell(new anchor.BN(sellAmount))
        .accountsPartial({
          seller: traderKeypair.publicKey,
          pool: poolAddress,
          poolXnt: pool.poolXnt,
          poolUsdc: pool.poolUsdc,
          sellerUsdc: traderUsdc.address,
          sellerXnt: traderXnt.address,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([traderKeypair])
        .rpc();

      console.log(`   ✅ TX: ${tx.substring(0, 20)}...`);

      // Fetch updated state
      const poolAfter = await program.account.pool.fetch(poolAddress);
      const priceAfter = poolAfter.usdcReserve.toNumber() / poolAfter.xntReserve.toNumber();
      const priceDrop = ((currentPrice - priceAfter) / currentPrice) * 100;

      console.log(`   New Price: $${priceAfter.toFixed(6)} (↓${priceDrop.toFixed(2)}%)`);
    } catch (error) {
      console.error(`\n❌ Sell failed:`, error.message);
      break;
    }

    // Short delay between sells
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  // Final state
  const finalPool = await program.account.pool.fetch(poolAddress);
  const finalPrice = finalPool.usdcReserve.toNumber() / finalPool.xntReserve.toNumber();

  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║                    FINAL STATE                             ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');
  console.log(`   Final Price: $${finalPrice.toFixed(6)}`);
  console.log(`   XNT Reserve: ${(finalPool.xntReserve.toNumber() / 1e6).toFixed(2)}M`);
  console.log(`   USDC Reserve: ${(finalPool.usdcReserve.toNumber() / 1e6).toFixed(2)}M`);
  console.log(`   Total Iterations: ${iteration}\n`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('\n❌ Error:', error);
    process.exit(1);
  });
