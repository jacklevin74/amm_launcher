import * as anchor from '@coral-xyz/anchor';
import { AnchorProvider, Program, Wallet } from '@coral-xyz/anchor';
import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, getOrCreateAssociatedTokenAccount } from '@solana/spl-token';
import fs from 'fs';

async function main() {
  const [amountStr, poolAddressStr] = process.argv.slice(2);

  if (!amountStr || !poolAddressStr) {
    console.log(JSON.stringify({ success: false, error: 'Usage: web-sell.ts <amount> <pool_address>' }));
    process.exit(1);
  }

  const amount = new anchor.BN(amountStr);
  const poolAddress = new PublicKey(poolAddressStr);
  const programId = new PublicKey('2zKpM4k4kp7qRNvBVzkEAAt8DU8t1vpAfzsRagha4NNF');

  const connection = new Connection('http://localhost:8899', 'confirmed');
  const walletPath = process.env.ANCHOR_WALLET || process.env.HOME + '/.config/solana/id.json';
  const mainWallet = Keypair.fromSecretKey(Buffer.from(JSON.parse(fs.readFileSync(walletPath, 'utf-8'))));

  // Use Anchor to fetch pool data
  const wallet = new Wallet(mainWallet);
  const provider = new AnchorProvider(connection, wallet, { commitment: 'confirmed' });
  anchor.setProvider(provider);
  const program = anchor.workspace.BondingCurve as Program;

  const pool = await program.account.pool.fetch(poolAddress);
  const xntMint = pool.xntMint;
  const usdcMint = pool.usdcMint;
  const poolXnt = pool.poolXnt;
  const poolUsdc = pool.poolUsdc;
  const ceilingReserveXnt = pool.ceilingReserveXnt;

  // Load trader
  const traderData = JSON.parse(fs.readFileSync('/tmp/trader-wallet.json', 'utf8'));
  const trader = Keypair.fromSecretKey(new Uint8Array(traderData));

  // Get token accounts
  const traderXnt = await getOrCreateAssociatedTokenAccount(connection, mainWallet, xntMint, trader.publicKey);
  const traderUsdc = await getOrCreateAssociatedTokenAccount(connection, mainWallet, usdcMint, trader.publicKey);

  // Build instruction data: discriminator (8 bytes) + amount (8 bytes)
  const discriminator = Buffer.from([51, 230, 133, 164, 1, 127, 131, 173]); // sell instruction discriminator
  const amountBuffer = Buffer.alloc(8);
  amountBuffer.writeBigUInt64LE(BigInt(amount.toString()), 0);
  const data = Buffer.concat([discriminator, amountBuffer]);

  // Build instruction
  const instruction = new TransactionInstruction({
    programId,
    keys: [
      { pubkey: trader.publicKey, isSigner: true, isWritable: true },
      { pubkey: poolAddress, isSigner: false, isWritable: true },
      { pubkey: poolXnt, isSigner: false, isWritable: true },
      { pubkey: poolUsdc, isSigner: false, isWritable: true },
      { pubkey: traderXnt.address, isSigner: false, isWritable: true },  // seller_xnt (source)
      { pubkey: traderUsdc.address, isSigner: false, isWritable: true }, // seller_usdc (destination)
      { pubkey: ceilingReserveXnt, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data,
  });

  // Send transaction
  const tx = new Transaction().add(instruction);
  const signature = await connection.sendTransaction(tx, [trader], { skipPreflight: false });
  await connection.confirmTransaction(signature, 'confirmed');

  console.log(JSON.stringify({ success: true, tx: signature }));
}

main().catch(e => {
  console.log(JSON.stringify({ success: false, error: e.message }));
  process.exit(1);
});
