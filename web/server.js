#!/usr/bin/env node
/**
 * Trading Terminal Web Server
 * Serves the trading interface and provides API endpoints for trading
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn, exec } = require('child_process');
const url = require('url');

const PORT = 3030;
const API_PORT = 3031;

// Serve static files and API endpoints
const staticServer = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);

  // API endpoint to get trader wallet
  if (parsedUrl.pathname === '/api/wallet') {
    const walletPath = '/tmp/trader-wallet.json';
    fs.readFile(walletPath, 'utf8', (err, data) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Wallet not found' }));
        return;
      }
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      });
      res.end(data);
    });
    return;
  }

  // API endpoint to get real pool reserves
  if (parsedUrl.pathname === '/api/pool-real-reserves') {
    const cmd = `cd /Users/yakovlevin/dev/lottery_amm && ANCHOR_PROVIDER_URL=http://localhost:8899 ANCHOR_WALLET=~/.config/solana/id.json npx ts-node --transpile-only -e "
const anchor = require('@coral-xyz/anchor');
const { getAccount } = require('@solana/spl-token');
const fs = require('fs');

(async () => {
  const connection = new anchor.web3.Connection('http://localhost:8899', 'confirmed');
  const walletPath = process.env.ANCHOR_WALLET || process.env.HOME + '/.config/solana/id.json';
  const mainWallet = anchor.web3.Keypair.fromSecretKey(Buffer.from(JSON.parse(fs.readFileSync(walletPath, 'utf-8'))));
  const wallet = new anchor.Wallet(mainWallet);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: 'confirmed' });
  anchor.setProvider(provider);
  const program = anchor.workspace.BondingCurve;

  const poolAddress = new anchor.web3.PublicKey('DftpSEe5zukxPJJ2S3rJh635YvizsbRskZYZEV3MvWkT');
  const pool = await program.account.pool.fetch(poolAddress);

  const poolXntAccount = await getAccount(connection, pool.poolXnt);
  const poolUsdcAccount = await getAccount(connection, pool.poolUsdc);

  console.log(JSON.stringify({
    realXnt: poolXntAccount.amount.toString(),
    realUsdc: poolUsdcAccount.amount.toString()
  }));
})().catch(e => console.log(JSON.stringify({ error: e.message })));
"`;

    exec(cmd, (error, stdout, stderr) => {
      if (error) {
        res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ error: stderr || error.message }));
        return;
      }

      const result = JSON.parse(stdout.trim().split('\n').pop());
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify(result));
    });
    return;
  }

  // API endpoint to execute buy
  if (parsedUrl.pathname === '/api/buy' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        const { amount } = JSON.parse(body);
        const poolAddress = 'DftpSEe5zukxPJJ2S3rJh635YvizsbRskZYZEV3MvWkT';

        const cmd = `cd /Users/yakovlevin/dev/lottery_amm && ANCHOR_PROVIDER_URL=http://localhost:8899 ANCHOR_WALLET=~/.config/solana/id.json npx ts-node --transpile-only -e "
const anchor = require('@coral-xyz/anchor');
const { TOKEN_PROGRAM_ID } = require('@solana/spl-token');
const fs = require('fs');

(async () => {
  const connection = new anchor.web3.Connection('http://localhost:8899', 'confirmed');
  const walletPath = process.env.ANCHOR_WALLET || process.env.HOME + '/.config/solana/id.json';
  const mainWallet = anchor.web3.Keypair.fromSecretKey(Buffer.from(JSON.parse(fs.readFileSync(walletPath, 'utf-8'))));
  const wallet = new anchor.Wallet(mainWallet);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: 'confirmed' });
  anchor.setProvider(provider);
  const program = anchor.workspace.BondingCurve;

  const poolAddress = new anchor.web3.PublicKey('${poolAddress}');
  const pool = await program.account.pool.fetch(poolAddress);

  const traderWalletData = JSON.parse(fs.readFileSync('/tmp/trader-wallet.json', 'utf8'));
  const traderKeypair = anchor.web3.Keypair.fromSecretKey(new Uint8Array(traderWalletData));

  const { getOrCreateAssociatedTokenAccount } = require('@solana/spl-token');
  const traderXnt = await getOrCreateAssociatedTokenAccount(connection, mainWallet, pool.xntMint, traderKeypair.publicKey);
  const traderUsdc = await getOrCreateAssociatedTokenAccount(connection, mainWallet, pool.usdcMint, traderKeypair.publicKey);

  // Derive ceiling reserve PDA
  const [ceilingReservePda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from('ceiling_reserve'), poolAddress.toBuffer()],
    program.programId
  );

  const tx = await program.methods
    .buy(new anchor.BN(${amount}))
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

  console.log(JSON.stringify({ success: true, tx }));
})().catch(e => console.log(JSON.stringify({ success: false, error: e.message })));
"`;

        exec(cmd, (error, stdout, stderr) => {
          if (error) {
            res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
            res.end(JSON.stringify({ success: false, error: stderr || error.message }));
            return;
          }

          const result = JSON.parse(stdout.trim().split('\n').pop());
          res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify(result));
        });
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ success: false, error: e.message }));
      }
    });
    return;
  }

  // API endpoint to execute sell
  if (parsedUrl.pathname === '/api/sell' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        const { amount } = JSON.parse(body);
        const poolAddress = 'DftpSEe5zukxPJJ2S3rJh635YvizsbRskZYZEV3MvWkT';

        const cmd = `cd /Users/yakovlevin/dev/lottery_amm && ANCHOR_PROVIDER_URL=http://localhost:8899 ANCHOR_WALLET=~/.config/solana/id.json npx ts-node --transpile-only -e "
const anchor = require('@coral-xyz/anchor');
const { TOKEN_PROGRAM_ID } = require('@solana/spl-token');
const fs = require('fs');

(async () => {
  const connection = new anchor.web3.Connection('http://localhost:8899', 'confirmed');
  const walletPath = process.env.ANCHOR_WALLET || process.env.HOME + '/.config/solana/id.json';
  const mainWallet = anchor.web3.Keypair.fromSecretKey(Buffer.from(JSON.parse(fs.readFileSync(walletPath, 'utf-8'))));
  const wallet = new anchor.Wallet(mainWallet);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: 'confirmed' });
  anchor.setProvider(provider);
  const program = anchor.workspace.BondingCurve;

  const poolAddress = new anchor.web3.PublicKey('${poolAddress}');
  const pool = await program.account.pool.fetch(poolAddress);

  const traderWalletData = JSON.parse(fs.readFileSync('/tmp/trader-wallet.json', 'utf8'));
  const traderKeypair = anchor.web3.Keypair.fromSecretKey(new Uint8Array(traderWalletData));

  const { getOrCreateAssociatedTokenAccount } = require('@solana/spl-token');
  const traderXnt = await getOrCreateAssociatedTokenAccount(connection, mainWallet, pool.xntMint, traderKeypair.publicKey);
  const traderUsdc = await getOrCreateAssociatedTokenAccount(connection, mainWallet, pool.usdcMint, traderKeypair.publicKey);

  const tx = await program.methods
    .sell(new anchor.BN(${amount}))
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

  console.log(JSON.stringify({ success: true, tx }));
})().catch(e => console.log(JSON.stringify({ success: false, error: e.message })));
"`;

        exec(cmd, (error, stdout, stderr) => {
          if (error) {
            res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
            res.end(JSON.stringify({ success: false, error: stderr || error.message }));
            return;
          }

          const result = JSON.parse(stdout.trim().split('\n').pop());
          res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify(result));
        });
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ success: false, error: e.message }));
      }
    });
    return;
  }

  let filePath = req.url === '/' || req.url === '/trading' ? '/trading.html' : req.url;
  const fullPath = path.join(__dirname, filePath);

  fs.readFile(fullPath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Not Found');
      return;
    }

    const ext = path.extname(fullPath);
    const contentTypes = {
      '.html': 'text/html',
      '.js': 'application/javascript',
      '.css': 'text/css',
      '.json': 'application/json',
    };

    res.writeHead(200, {
      'Content-Type': contentTypes[ext] || 'text/plain',
      'Cache-Control': 'no-cache'
    });
    res.end(data);
  });
});

staticServer.listen(PORT, () => {
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║         XNT TRADING TERMINAL - WEB INTERFACE              ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');
  console.log('🌐 Trading Interface: http://localhost:' + PORT + '/trading');
  console.log('📊 Pool Manager:      http://localhost:' + PORT + '/');
  console.log('');
  console.log('📋 Instructions:');
  console.log('  1. Make sure your local validator is running');
  console.log('  2. Ensure a pool is initialized (see test scripts)');
  console.log('  3. Open http://localhost:' + PORT + '/trading in your browser');
  console.log('  4. Create a wallet and start trading!');
  console.log('');
  console.log('💡 Current Pool Address: DftpSEe5zukxPJJ2S3rJh635YvizsbRskZYZEV3MvWkT');
  console.log('');
  console.log('Press Ctrl+C to stop the server\n');
});
