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
  const poolAddress = new anchor.web3.PublicKey('D8S95JozUw7vYvYgvuEuP4svGYZmtMBhUXVAQftszGzn');

  // Read pool data directly without using anchor decode
  const poolAccountInfo = await connection.getAccountInfo(poolAddress);
  if (!poolAccountInfo) throw new Error('Pool not found');

  const poolData = poolAccountInfo.data;
  const poolXnt = new anchor.web3.PublicKey(poolData.slice(104, 136));
  const poolUsdc = new anchor.web3.PublicKey(poolData.slice(136, 168));

  const poolXntAccount = await getAccount(connection, poolXnt);
  const poolUsdcAccount = await getAccount(connection, poolUsdc);

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
        const poolAddress = 'D8S95JozUw7vYvYgvuEuP4svGYZmtMBhUXVAQftszGzn';

        const cmd = `cd /Users/yakovlevin/dev/lottery_amm && ANCHOR_PROVIDER_URL=http://localhost:8899 ANCHOR_WALLET=~/.config/solana/id.json npx ts-node --transpile-only scripts/web-buy.ts ${amount} ${poolAddress}`;

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

  // API endpoint to get admin wallet
  if (parsedUrl.pathname === '/api/admin-wallet') {
    const walletPath = process.env.ANCHOR_WALLET || process.env.HOME + '/.config/solana/id.json';
    fs.readFile(walletPath, 'utf8', (err, data) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Admin wallet not found' }));
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

  // API endpoint to get pool data
  if (parsedUrl.pathname === '/api/pool-data') {
    const cmd = `cd /Users/yakovlevin/dev/lottery_amm && ANCHOR_PROVIDER_URL=http://localhost:8899 ANCHOR_WALLET=~/.config/solana/id.json npx ts-node --transpile-only -e "
const anchor = require('@coral-xyz/anchor');
const fs = require('fs');

(async () => {
  const connection = new anchor.web3.Connection('http://localhost:8899', 'confirmed');
  const walletPath = process.env.ANCHOR_WALLET || process.env.HOME + '/.config/solana/id.json';
  const mainWallet = anchor.web3.Keypair.fromSecretKey(Buffer.from(JSON.parse(fs.readFileSync(walletPath, 'utf-8'))));
  const wallet = new anchor.Wallet(mainWallet);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: 'confirmed' });
  anchor.setProvider(provider);
  const program = anchor.workspace.BondingCurve;

  const poolAddress = new anchor.web3.PublicKey('D8S95JozUw7vYvYgvuEuP4svGYZmtMBhUXVAQftszGzn');
  const pool = await program.account.pool.fetch(poolAddress);

  console.log(JSON.stringify({
    authority: pool.authority.toString(),
    ceilingReserveXnt: pool.ceilingReserveXnt.toString()
  }));
})().catch(e => console.log(JSON.stringify({ error: e.message })));
"`;

    exec(cmd, (error, stdout, stderr) => {
      if (error) {
        res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ error: stderr || error.message }));
        return;
      }

      const result = JSON.parse(stdout.trim().split('\\n').pop());
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify(result));
    });
    return;
  }

  // API endpoint to get reserve stats
  if (parsedUrl.pathname === '/api/reserve-stats') {
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

  const poolAddress = new anchor.web3.PublicKey('D8S95JozUw7vYvYgvuEuP4svGYZmtMBhUXVAQftszGzn');
  const pool = await program.account.pool.fetch(poolAddress);

  const reserveInfo = await connection.getTokenAccountBalance(pool.ceilingReserveXnt);
  const currentPrice = pool.usdcReserve.toNumber() / pool.xntReserve.toNumber();

  console.log(JSON.stringify({
    reserveBalance: reserveInfo.value.amount,
    poolXntReserve: pool.xntReserve.toString(),
    currentPrice: currentPrice
  }));
})().catch(e => console.log(JSON.stringify({ error: e.message })));
"`;

    exec(cmd, (error, stdout, stderr) => {
      if (error) {
        res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ error: stderr || error.message }));
        return;
      }

      const result = JSON.parse(stdout.trim().split('\\n').pop());
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify(result));
    });
    return;
  }

  // API endpoint to deposit to reserve
  if (parsedUrl.pathname === '/api/deposit-reserve' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        const { amount } = JSON.parse(body);
        const poolAddress = 'D8S95JozUw7vYvYgvuEuP4svGYZmtMBhUXVAQftszGzn';

        const cmd = `cd /Users/yakovlevin/dev/lottery_amm && ANCHOR_PROVIDER_URL=http://localhost:8899 ANCHOR_WALLET=~/.config/solana/id.json npx ts-node --transpile-only -e "
const anchor = require('@coral-xyz/anchor');
const { TOKEN_PROGRAM_ID, getOrCreateAssociatedTokenAccount } = require('@solana/spl-token');
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

  const authorityXnt = await getOrCreateAssociatedTokenAccount(connection, mainWallet, pool.xntMint, mainWallet.publicKey);

  const tx = await program.methods
    .fundCeilingReserve(new anchor.BN(${amount}))
    .accountsPartial({
      authority: mainWallet.publicKey,
      pool: poolAddress,
      authorityXnt: authorityXnt.address,
      ceilingReserveXnt: pool.ceilingReserveXnt,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .rpc();

  console.log(JSON.stringify({ success: true, tx }));
})().catch(e => console.log(JSON.stringify({ success: false, error: e.message })));
"`;

        exec(cmd, (error, stdout, stderr) => {
          try {
            // Try to parse the last line of stdout as JSON
            const lines = stdout.trim().split('\n');
            const lastLine = lines[lines.length - 1];
            const result = JSON.parse(lastLine);

            res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
            res.end(JSON.stringify(result));
          } catch (parseError) {
            // If parsing fails, return the error with details
            res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
            res.end(JSON.stringify({
              success: false,
              error: 'Transaction failed - see details',
              details: stdout || stderr || (error ? error.message : 'Unknown error')
            }));
          }
        });
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ success: false, error: e.message }));
      }
    });
    return;
  }

  // API endpoint to withdraw from reserve
  if (parsedUrl.pathname === '/api/withdraw-reserve' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        const { amount } = JSON.parse(body);
        const poolAddress = 'D8S95JozUw7vYvYgvuEuP4svGYZmtMBhUXVAQftszGzn';

        const cmd = `cd /Users/yakovlevin/dev/lottery_amm && ANCHOR_PROVIDER_URL=http://localhost:8899 ANCHOR_WALLET=~/.config/solana/id.json npx ts-node --transpile-only -e "
const anchor = require('@coral-xyz/anchor');
const { TOKEN_PROGRAM_ID, getOrCreateAssociatedTokenAccount } = require('@solana/spl-token');
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

  const [ceilingReservePda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from('ceiling_reserve'), poolAddress.toBuffer()],
    program.programId
  );

  const authorityXnt = await getOrCreateAssociatedTokenAccount(connection, mainWallet, pool.xntMint, mainWallet.publicKey);

  const tx = await program.methods
    .withdrawFromCeilingReserve(new anchor.BN(${amount}))
    .accountsPartial({
      authority: mainWallet.publicKey,
      pool: poolAddress,
      ceilingReservePda: ceilingReservePda,
      ceilingReserveXnt: pool.ceilingReserveXnt,
      authorityXnt: authorityXnt.address,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .rpc();

  console.log(JSON.stringify({ success: true, tx }));
})().catch(e => console.log(JSON.stringify({ success: false, error: e.message })));
"`;

        exec(cmd, (error, stdout, stderr) => {
          try {
            // Try to parse the last line of stdout as JSON
            const lines = stdout.trim().split('\n');
            const lastLine = lines[lines.length - 1];
            const result = JSON.parse(lastLine);

            res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
            res.end(JSON.stringify(result));
          } catch (parseError) {
            // If parsing fails, return the error with details
            res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
            res.end(JSON.stringify({
              success: false,
              error: 'Transaction failed - see details',
              details: stdout || stderr || (error ? error.message : 'Unknown error')
            }));
          }
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
        const poolAddress = 'D8S95JozUw7vYvYgvuEuP4svGYZmtMBhUXVAQftszGzn';

        const cmd = `cd /Users/yakovlevin/dev/lottery_amm && ANCHOR_PROVIDER_URL=http://localhost:8899 ANCHOR_WALLET=~/.config/solana/id.json npx ts-node --transpile-only scripts/web-sell.ts ${amount} ${poolAddress}`;

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

  // API endpoint to get trader wallet address
  if (parsedUrl.pathname === '/api/trader-wallet') {
    const cmd = `cd /Users/yakovlevin/dev/lottery_amm && node -e "const fs = require('fs'); const data = JSON.parse(fs.readFileSync('/tmp/trader-wallet.json', 'utf8')); const { Keypair } = require('@solana/web3.js'); const kp = Keypair.fromSecretKey(new Uint8Array(data)); console.log(JSON.stringify({ success: true, address: kp.publicKey.toString() }));"`;

    exec(cmd, (error, stdout, stderr) => {
      if (error) {
        res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ success: false, error: stderr || error.message }));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(stdout.trim());
    });
    return;
  }

  // API endpoint to get trader balances
  if (parsedUrl.pathname === '/api/trader-balances') {
    const cmd = `cd /Users/yakovlevin/dev/lottery_amm && ANCHOR_PROVIDER_URL=http://localhost:8899 ANCHOR_WALLET=~/.config/solana/id.json npx ts-node --transpile-only -e "
const anchor = require('@coral-xyz/anchor');
const { getAccount } = require('@solana/spl-token');
const fs = require('fs');

(async () => {
  const connection = new anchor.web3.Connection('http://localhost:8899', 'confirmed');
  const traderData = JSON.parse(fs.readFileSync('/tmp/trader-wallet.json', 'utf8'));
  const trader = anchor.web3.Keypair.fromSecretKey(new Uint8Array(traderData));

  // Get SOL balance
  const solBalance = await connection.getBalance(trader.publicKey);

  // Get pool to find XNT mint
  const walletPath = process.env.ANCHOR_WALLET || process.env.HOME + '/.config/solana/id.json';
  const mainWallet = anchor.web3.Keypair.fromSecretKey(Buffer.from(JSON.parse(fs.readFileSync(walletPath, 'utf-8'))));
  const wallet = new anchor.Wallet(mainWallet);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: 'confirmed' });
  anchor.setProvider(provider);
  const program = anchor.workspace.BondingCurve;

  const poolAddress = new anchor.web3.PublicKey('D8S95JozUw7vYvYgvuEuP4svGYZmtMBhUXVAQftszGzn');
  const pool = await program.account.pool.fetch(poolAddress);
  const xntMint = pool.xntMint;

  // Get trader XNT ATA
  const [traderXnt] = anchor.web3.PublicKey.findProgramAddressSync(
    [
      trader.publicKey.toBuffer(),
      new anchor.web3.PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA').toBuffer(),
      xntMint.toBuffer(),
    ],
    new anchor.web3.PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL')
  );

  let xntBalance = 0;
  try {
    const xntAccount = await getAccount(connection, traderXnt);
    xntBalance = Number(xntAccount.amount) / 1e6;
  } catch (e) {
    // Account doesn't exist yet
  }

  console.log(JSON.stringify({
    success: true,
    balances: {
      sol: solBalance / 1e9,
      xnt: xntBalance
    }
  }));
})().catch(e => console.log(JSON.stringify({ success: false, error: e.message })));
"`;

    exec(cmd, (error, stdout, stderr) => {
      if (error) {
        res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ success: false, error: stderr || error.message }));
        return;
      }

      const result = JSON.parse(stdout.trim().split('\\n').pop());
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify(result));
    });
    return;
  }

  // API endpoint to wrap SOL
  if (parsedUrl.pathname === '/api/wrap' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        const { amount, poolAddress } = JSON.parse(body);

        const cmd = `cd /Users/yakovlevin/dev/lottery_amm && ANCHOR_PROVIDER_URL=http://localhost:8899 ANCHOR_WALLET=~/.config/solana/id.json npx ts-node --transpile-only -e "
const anchor = require('@coral-xyz/anchor');
const { TOKEN_PROGRAM_ID, getOrCreateAssociatedTokenAccount } = require('@solana/spl-token');
const { Connection, Keypair, PublicKey, Transaction, TransactionInstruction, SystemProgram } = require('@solana/web3.js');
const fs = require('fs');

(async () => {
  const connection = new Connection('http://localhost:8899', 'confirmed');
  const traderData = JSON.parse(fs.readFileSync('/tmp/trader-wallet.json', 'utf8'));
  const trader = Keypair.fromSecretKey(new Uint8Array(traderData));

  const walletPath = process.env.ANCHOR_WALLET || process.env.HOME + '/.config/solana/id.json';
  const mainWallet = Keypair.fromSecretKey(Buffer.from(JSON.parse(fs.readFileSync(walletPath, 'utf-8'))));
  const wallet = new anchor.Wallet(mainWallet);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: 'confirmed' });
  anchor.setProvider(provider);
  const program = anchor.workspace.BondingCurve;

  const poolPubkey = new PublicKey('${poolAddress}');
  const pool = await program.account.pool.fetch(poolPubkey);
  const xntMint = pool.xntMint;

  const traderXnt = await getOrCreateAssociatedTokenAccount(connection, mainWallet, xntMint, trader.publicKey);

  const tx = await program.methods
    .wrapSol(new anchor.BN(${amount}))
    .accountsPartial({
      user: trader.publicKey,
      pool: poolPubkey,
      poolXnt: pool.poolXnt,
      userXnt: traderXnt.address,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .signers([trader])
    .rpc();

  console.log(JSON.stringify({ success: true, tx }));
})().catch(e => console.log(JSON.stringify({ success: false, error: e.message })));
"`;

        exec(cmd, (error, stdout, stderr) => {
          try {
            // Try to parse the last line of stdout as JSON
            const lines = stdout.trim().split('\n');
            const lastLine = lines[lines.length - 1];
            const result = JSON.parse(lastLine);

            res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
            res.end(JSON.stringify(result));
          } catch (parseError) {
            // If parsing fails, return the error with details
            res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
            res.end(JSON.stringify({
              success: false,
              error: 'Transaction failed - see details',
              details: stdout || stderr || (error ? error.message : 'Unknown error')
            }));
          }
        });
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ success: false, error: e.message }));
      }
    });
    return;
  }

  // API endpoint to unwrap SOL (no longer needed - XNT is now native wSOL)
  if (parsedUrl.pathname === '/api/unwrap' && req.method === 'POST') {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    });
    res.end(JSON.stringify({
      success: false,
      error: 'Unwrap not needed - XNT is now native wSOL (wrapped SOL)',
      message: 'XNT tokens are standard wSOL. You can unwrap wSOL to SOL using any Solana wallet.'
    }));
    return;
  }

  // Serve IDL file
  if (parsedUrl.pathname === '/idl/bonding_curve.json') {
    const idlPath = path.join(__dirname, '../target/idl/bonding_curve.json');
    fs.readFile(idlPath, 'utf8', (err, data) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'IDL not found' }));
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

  // Strip query string from URL
  let filePath = parsedUrl.pathname;
  if (filePath === '/' || filePath === '/trading') {
    filePath = '/trading.html';
  } else if (filePath === '/admin') {
    filePath = '/admin.html';
  } else if (filePath === '/wrap') {
    filePath = '/wrap.html';
  } else if (filePath === '/c64/trading') {
    filePath = '/c64/trading.html';
  } else if (filePath === '/c64/admin') {
    filePath = '/c64/admin.html';
  }
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
  console.log('💡 Current Pool Address: D8S95JozUw7vYvYgvuEuP4svGYZmtMBhUXVAQftszGzn');
  console.log('');
  console.log('Press Ctrl+C to stop the server\n');
});
