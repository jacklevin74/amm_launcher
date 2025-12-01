import * as anchor from '@coral-xyz/anchor';
import { AnchorProvider } from '@coral-xyz/anchor';

async function main() {
  const provider = AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.BondingCurve;

  const poolAddress = new anchor.web3.PublicKey('DftpSEe5zukxPJJ2S3rJh635YvizsbRskZYZEV3MvWkT');
  const pool = await program.account.pool.fetch(poolAddress);

  console.log('\n📊 Pool State:');
  console.log('   XNT Reserve:', pool.xntReserve.toNumber() / 1e6, 'M XNT');
  console.log('   USDC Reserve:', pool.usdcReserve.toNumber() / 1e6, 'M USDC (virtual)');
  console.log('   Price: $' + (pool.usdcReserve.toNumber() / pool.xntReserve.toNumber()));
  console.log('   Price Ceiling: $' + (pool.priceCeiling.toNumber() / 1e6));
  console.log('   Ceiling Reserve XNT:', pool.ceilingReserveXnt.toBase58());
  console.log('');
}

main().then(() => process.exit(0)).catch(err => {
  console.error(err);
  process.exit(1);
});
