// SOL Wrapper App
const PROGRAM_ID = '2zKpM4k4kp7qRNvBVzkEAAt8DU8t1vpAfzsRagha4NNF';

let connection;
let provider;
let program;
let wallet;

// Initialize on load
window.addEventListener('load', async () => {
    console.log('SOL Wrapper UI loading...');

    // Setup input listeners for live calculation
    document.getElementById('wrapAmount').addEventListener('input', (e) => {
        const amount = parseFloat(e.target.value) || 0;
        document.getElementById('wrapReceive').textContent = `${amount.toFixed(2)} XNT`;
    });

    document.getElementById('unwrapAmount').addEventListener('input', (e) => {
        const amount = parseFloat(e.target.value) || 0;
        document.getElementById('unwrapReceive').textContent = `${amount.toFixed(2)} SOL`;
    });

    // Check if Phantom is installed
    if (window.solana?.isPhantom) {
        console.log('Phantom detected');
        // Auto-connect if previously connected
        if (window.solana.isConnected) {
            await connectWallet();
        }
    } else {
        showStatus('Please install Phantom wallet', 'error');
    }
});

async function connectWallet() {
    try {
        showStatus('Connecting to Phantom...', 'info');

        const resp = await window.solana.connect();
        wallet = window.solana;

        console.log('Connected:', resp.publicKey.toString());
        document.getElementById('walletAddress').textContent = resp.publicKey.toString();
        document.getElementById('connectBtn').textContent = 'Connected ✓';
        document.getElementById('connectBtn').disabled = true;

        // Initialize Anchor
        connection = new solanaWeb3.Connection('http://localhost:8899', 'confirmed');
        provider = {
            connection,
            publicKey: resp.publicKey,
            signTransaction: wallet.signTransaction.bind(wallet),
            signAllTransactions: wallet.signAllTransactions.bind(wallet),
        };

        // Fetch IDL
        const idl = await fetch('/idl/bonding_curve.json').then(r => r.json());
        program = new anchor.Program(idl, PROGRAM_ID, { connection });

        // Show panels
        document.getElementById('balancesPanel').style.display = 'block';
        document.getElementById('wrapPanel').style.display = 'block';

        // Load balances
        await loadBalances();

        showStatus('Wallet connected successfully!', 'success');
        setTimeout(() => {
            document.getElementById('txStatusPanel').style.display = 'none';
        }, 3000);

    } catch (err) {
        console.error('Connection error:', err);
        showStatus('Failed to connect wallet: ' + err.message, 'error');
    }
}

async function loadBalances() {
    try {
        // Get SOL balance
        const solBalance = await connection.getBalance(provider.publicKey);
        document.getElementById('solBalance').textContent = (solBalance / 1e9).toFixed(4) + ' SOL';

        // Get XNT balance
        // First, get the pool to find XNT mint
        const poolAddress = await getPoolAddress();
        if (!poolAddress) {
            document.getElementById('xntBalance').textContent = '0 XNT';
            return;
        }

        const poolData = await program.account.pool.fetch(poolAddress);
        const xntMint = poolData.xntMint;

        // Get user's XNT token account
        const userXnt = await getAssociatedTokenAddress(xntMint, provider.publicKey);

        try {
            const tokenAccount = await connection.getTokenAccountBalance(userXnt);
            const xntAmount = tokenAccount.value.uiAmount || 0;
            document.getElementById('xntBalance').textContent = xntAmount.toFixed(4) + ' XNT';
        } catch (e) {
            // Account doesn't exist yet
            document.getElementById('xntBalance').textContent = '0 XNT';
        }

    } catch (err) {
        console.error('Error loading balances:', err);
    }
}

async function getPoolAddress() {
    try {
        // Try to fetch from config API
        const config = await fetch('/api/config').then(r => r.json());
        return new solanaWeb3.PublicKey(config.poolAddress);
    } catch (e) {
        console.error('Could not fetch pool address:', e);
        return null;
    }
}

async function getAssociatedTokenAddress(mint, owner) {
    const [address] = await solanaWeb3.PublicKey.findProgramAddress(
        [
            owner.toBuffer(),
            new solanaWeb3.PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA').toBuffer(),
            mint.toBuffer(),
        ],
        new solanaWeb3.PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL')
    );
    return address;
}

async function wrapSol() {
    try {
        const amountInput = document.getElementById('wrapAmount').value;
        if (!amountInput || parseFloat(amountInput) <= 0) {
            showStatus('Please enter a valid amount', 'error');
            return;
        }

        const solAmount = parseFloat(amountInput);
        const lamports = Math.floor(solAmount * 1e9);

        showStatus('Wrapping SOL...', 'info');
        document.getElementById('wrapBtn').disabled = true;

        // Get pool address
        const poolAddress = await getPoolAddress();
        if (!poolAddress) {
            throw new Error('Pool not found');
        }

        const poolData = await program.account.pool.fetch(poolAddress);
        const xntMint = poolData.xntMint;

        // Derive accounts
        const [solVault] = await solanaWeb3.PublicKey.findProgramAddress(
            [Buffer.from('sol_vault'), poolAddress.toBuffer()],
            program.programId
        );

        const poolXnt = poolData.poolXnt;
        const userXnt = await getAssociatedTokenAddress(xntMint, provider.publicKey);

        // Check if user XNT account exists, create if not
        const accountInfo = await connection.getAccountInfo(userXnt);
        let preInstructions = [];

        if (!accountInfo) {
            console.log('Creating user XNT token account...');
            const createAtaIx = new solanaWeb3.TransactionInstruction({
                keys: [
                    { pubkey: provider.publicKey, isSigner: true, isWritable: true },
                    { pubkey: userXnt, isSigner: false, isWritable: true },
                    { pubkey: provider.publicKey, isSigner: false, isWritable: false },
                    { pubkey: xntMint, isSigner: false, isWritable: false },
                    { pubkey: solanaWeb3.SystemProgram.programId, isSigner: false, isWritable: false },
                    { pubkey: new solanaWeb3.PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'), isSigner: false, isWritable: false },
                ],
                programId: new solanaWeb3.PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'),
                data: Buffer.from([]),
            });
            preInstructions.push(createAtaIx);
        }

        // Build wrap transaction
        const tx = await program.methods
            .wrapSol(new anchor.BN(lamports))
            .accounts({
                user: provider.publicKey,
                pool: poolAddress,
                solVault: solVault,
                poolXnt: poolXnt,
                userXnt: userXnt,
                tokenProgram: new solanaWeb3.PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),
                systemProgram: solanaWeb3.SystemProgram.programId,
            })
            .preInstructions(preInstructions)
            .transaction();

        tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
        tx.feePayer = provider.publicKey;

        // Sign and send
        const signed = await wallet.signTransaction(tx);
        const txid = await connection.sendRawTransaction(signed.serialize());

        showStatus(`Transaction sent: ${txid.substring(0, 8)}...`, 'info');

        // Wait for confirmation
        await connection.confirmTransaction(txid, 'confirmed');

        showStatus(`✓ Wrapped ${solAmount} SOL → ${solAmount} XNT!`, 'success');

        // Reload balances
        await loadBalances();

        // Clear input
        document.getElementById('wrapAmount').value = '';
        document.getElementById('wrapReceive').textContent = '0 XNT';

    } catch (err) {
        console.error('Wrap error:', err);
        showStatus('Wrap failed: ' + err.message, 'error');
    } finally {
        document.getElementById('wrapBtn').disabled = false;
    }
}

async function unwrapSol() {
    try {
        const amountInput = document.getElementById('unwrapAmount').value;
        if (!amountInput || parseFloat(amountInput) <= 0) {
            showStatus('Please enter a valid amount', 'error');
            return;
        }

        const xntAmount = parseFloat(amountInput);
        const xntBaseUnits = Math.floor(xntAmount * 1e6); // 6 decimals

        showStatus('Unwrapping XNT...', 'info');
        document.getElementById('unwrapBtn').disabled = true;

        // Get pool address
        const poolAddress = await getPoolAddress();
        if (!poolAddress) {
            throw new Error('Pool not found');
        }

        const poolData = await program.account.pool.fetch(poolAddress);
        const xntMint = poolData.xntMint;

        // Derive accounts
        const [solVault] = await solanaWeb3.PublicKey.findProgramAddress(
            [Buffer.from('sol_vault'), poolAddress.toBuffer()],
            program.programId
        );

        const poolXnt = poolData.poolXnt;
        const userXnt = await getAssociatedTokenAddress(xntMint, provider.publicKey);

        // Build unwrap transaction
        const tx = await program.methods
            .unwrapSol(new anchor.BN(xntBaseUnits))
            .accounts({
                user: provider.publicKey,
                pool: poolAddress,
                solVault: solVault,
                poolXnt: poolXnt,
                userXnt: userXnt,
                tokenProgram: new solanaWeb3.PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),
            })
            .transaction();

        tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
        tx.feePayer = provider.publicKey;

        // Sign and send
        const signed = await wallet.signTransaction(tx);
        const txid = await connection.sendRawTransaction(signed.serialize());

        showStatus(`Transaction sent: ${txid.substring(0, 8)}...`, 'info');

        // Wait for confirmation
        await connection.confirmTransaction(txid, 'confirmed');

        showStatus(`✓ Unwrapped ${xntAmount} XNT → ${xntAmount} SOL!`, 'success');

        // Reload balances
        await loadBalances();

        // Clear input
        document.getElementById('unwrapAmount').value = '';
        document.getElementById('unwrapReceive').textContent = '0 SOL';

    } catch (err) {
        console.error('Unwrap error:', err);
        showStatus('Unwrap failed: ' + err.message, 'error');
    } finally {
        document.getElementById('unwrapBtn').disabled = false;
    }
}

function showStatus(message, type) {
    const panel = document.getElementById('txStatusPanel');
    const status = document.getElementById('txStatus');

    panel.style.display = 'block';

    let className = 'alert-success';
    if (type === 'error') className = 'alert-error';
    else if (type === 'info') className = '';

    status.innerHTML = `<div class="alert ${className}">${message}</div>`;
}
