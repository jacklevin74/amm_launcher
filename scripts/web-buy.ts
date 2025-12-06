import * as anchor from '@coral-xyz/anchor';
import { AnchorProvider, Program, Wallet } from '@coral-xyz/anchor';
import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction, SystemProgram, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, NATIVE_MINT, getOrCreateAssociatedTokenAccount, createSyncNativeInstruction, createCloseAccountInstruction } from '@solana/spl-token';
import fs from 'fs';

async function main() {
  const [amountStr, poolAddressStr, minXntOutStr] = process.argv.slice(2);

  if (!amountStr || !poolAddressStr) {
    console.log(JSON.stringify({ success: false, error: 'Usage: web-buy.ts <amount> <pool_address> [min_xnt_out]' }));
    process.exit(1);
  }

  const amount = new anchor.BN(amountStr);
  const poolAddress = new PublicKey(poolAddressStr);
  const minXntOut = minXntOutStr ? new anchor.BN(minXntOutStr) : new anchor.BN(0);
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

  // Derive ceiling reserve PDA
  const [ceilingReservePda] = PublicKey.findProgramAddressSync(
    [Buffer.from('ceiling_reserve'), poolAddress.toBuffer()],
    programId
  );

  // Build buy instruction data: discriminator (8 bytes) + usdc_amount (8 bytes) + min_xnt_out (8 bytes)
  const discriminator = Buffer.from([102, 6, 61, 18, 1, 218, 235, 234]); // buy instruction discriminator
  const amountBuffer = Buffer.alloc(8);
  amountBuffer.writeBigUInt64LE(BigInt(amount.toString()), 0);
  const minXntOutBuffer = Buffer.alloc(8);
  minXntOutBuffer.writeBigUInt64LE(BigInt(minXntOut.toString()), 0);
  const data = Buffer.concat([discriminator, amountBuffer, minXntOutBuffer]);

  // Build buy instruction
  const buyInstruction = new TransactionInstruction({
    programId,
    keys: [
      { pubkey: trader.publicKey, isSigner: true, isWritable: true },
      { pubkey: poolAddress, isSigner: false, isWritable: true },
      { pubkey: poolXnt, isSigner: false, isWritable: true },
      { pubkey: poolUsdc, isSigner: false, isWritable: true },
      { pubkey: traderUsdc.address, isSigner: false, isWritable: true },
      { pubkey: traderXnt.address, isSigner: false, isWritable: true },
      { pubkey: ceilingReservePda, isSigner: false, isWritable: false },
      { pubkey: ceilingReserveXnt, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data,
  });

  // Calculate expected XNT output to know how much wSOL we'll receive
  const k = pool.xntReserve.mul(pool.usdcReserve);
  const newUsdcReserve = pool.usdcReserve.add(amount);
  const newXntReserve = k.div(newUsdcReserve);
  const xntOut = pool.xntReserve.sub(newXntReserve);

  // Create transaction with buy + unwrap wSOL to SOL
  const tx = new Transaction();
  tx.add(buyInstruction);

  // Add unwrap instruction: close wSOL account to get SOL back
  tx.add(
    createCloseAccountInstruction(
      traderXnt.address,      // wSOL account to close
      trader.publicKey,       // destination for lamports (trader's SOL wallet)
      trader.publicKey,       // owner of the wSOL account
      [],                     // no multisig
      TOKEN_PROGRAM_ID
    )
  );

  const signature = await connection.sendTransaction(tx, [trader], { skipPreflight: false });
  await connection.confirmTransaction(signature, 'confirmed');

  console.log(JSON.stringify({ success: true, tx: signature }));
}

main().catch(e => {
  console.log(JSON.stringify({ success: false, error: e.message }));
  process.exit(1);
});
