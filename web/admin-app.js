// Admin Panel Configuration
const CONFIG = {
    RPC_URL: 'http://localhost:8899',
    POOL_ADDRESS: 'Erv5YtP4vtBdJxG7Dh44vpjm5w5yJUmmyESpqzQwvFfc',
    API_BASE_URL: 'http://localhost:3030/api',
    POLL_INTERVAL: 3000, // Update UI every 3 seconds
};

// Load Solana Web3.js from CDN
const script = document.createElement('script');
script.src = 'https://cdn.jsdelivr.net/npm/@solana/web3.js@latest/lib/index.iife.min.js';
script.onload = initializeApp;
document.head.appendChild(script);

let connection;
let adminKeypair;
let poolData;

async function initializeApp() {
    console.log('Initializing admin panel...');
    connection = new solanaWeb3.Connection(CONFIG.RPC_URL, 'confirmed');

    // Load admin wallet (uses the main authority wallet)
    try {
        const response = await fetch('/api/admin-wallet');
        if (!response.ok) {
            throw new Error('Failed to load admin wallet');
        }
        const walletData = await response.json();
        adminKeypair = solanaWeb3.Keypair.fromSecretKey(new Uint8Array(walletData));

        document.getElementById('adminWallet').textContent = adminKeypair.publicKey.toString();

        await loadPoolData();
        await checkAuthorization();

        // Start polling for updates
        setInterval(updateStats, CONFIG.POLL_INTERVAL);
    } catch (error) {
        console.error('Failed to initialize:', error);
        showError('Failed to load admin wallet. Make sure the server is running.');
    }
}

async function loadPoolData() {
    try {
        const response = await fetch(`${CONFIG.API_BASE_URL}/pool-data`);
        if (!response.ok) {
            throw new Error('Failed to load pool data');
        }
        poolData = await response.json();

        document.getElementById('poolAuthority').textContent = poolData.authority;
    } catch (error) {
        console.error('Failed to load pool data:', error);
        showError('Failed to load pool data');
    }
}

async function checkAuthorization() {
    const isAuthorized = adminKeypair.publicKey.toString() === poolData.authority;

    const authStatusDiv = document.getElementById('authStatus');

    if (isAuthorized) {
        authStatusDiv.innerHTML = '<div class="alert alert-success">✅ You are authorized as pool authority</div>';
        document.getElementById('reservePanel').style.display = 'block';
        document.getElementById('actionsPanel').style.display = 'grid';
        await updateStats();
    } else {
        authStatusDiv.innerHTML = '<div class="alert alert-error">❌ You are not authorized. Only the pool authority can manage the reserve.</div>';
        document.getElementById('reservePanel').style.display = 'none';
        document.getElementById('actionsPanel').style.display = 'none';
    }
}

async function updateStats() {
    try {
        const response = await fetch(`${CONFIG.API_BASE_URL}/reserve-stats`);
        if (!response.ok) {
            throw new Error('Failed to load reserve stats');
        }
        const stats = await response.json();

        document.getElementById('reserveBalance').textContent = formatNumber(stats.reserveBalance) + ' XNT';
        document.getElementById('poolXntReserve').textContent = formatNumber(stats.poolXntReserve) + ' XNT';
        document.getElementById('currentPrice').textContent = '$' + stats.currentPrice.toFixed(6);
    } catch (error) {
        console.error('Failed to update stats:', error);
    }
}

async function depositToReserve() {
    const amount = parseFloat(document.getElementById('depositAmount').value);

    if (!amount || amount <= 0) {
        showError('Please enter a valid amount');
        return;
    }

    const depositBtn = document.getElementById('depositBtn');
    depositBtn.disabled = true;
    depositBtn.innerHTML = '<span class="spinner"></span>Processing...';

    clearStatus();

    try {
        const response = await fetch(`${CONFIG.API_BASE_URL}/deposit-reserve`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ amount: amount * 1e6 }) // Convert to lamports
        });

        const result = await response.json();

        if (result.success) {
            showSuccess(`✅ Successfully deposited ${formatNumber(amount)} XNT to reserve!<br>TX: <span class="tx-link">${result.tx.substring(0, 20)}...</span>`);
            document.getElementById('depositAmount').value = '';
            await updateStats();
        } else {
            showError('❌ Deposit failed: ' + result.error);
        }
    } catch (error) {
        console.error('Deposit error:', error);
        showError('❌ Deposit failed: ' + error.message);
    } finally {
        depositBtn.disabled = false;
        depositBtn.innerHTML = 'Deposit XNT';
    }
}

async function withdrawFromReserve() {
    const amount = parseFloat(document.getElementById('withdrawAmount').value);

    if (!amount || amount <= 0) {
        showError('Please enter a valid amount');
        return;
    }

    const withdrawBtn = document.getElementById('withdrawBtn');
    withdrawBtn.disabled = true;
    withdrawBtn.innerHTML = '<span class="spinner"></span>Processing...';

    clearStatus();

    try {
        const response = await fetch(`${CONFIG.API_BASE_URL}/withdraw-reserve`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ amount: amount * 1e6 }) // Convert to lamports
        });

        const result = await response.json();

        if (result.success) {
            showSuccess(`✅ Successfully withdrew ${formatNumber(amount)} XNT from reserve!<br>TX: <span class="tx-link">${result.tx.substring(0, 20)}...</span>`);
            document.getElementById('withdrawAmount').value = '';
            await updateStats();
        } else {
            showError('❌ Withdrawal failed: ' + result.error);
        }
    } catch (error) {
        console.error('Withdrawal error:', error);
        showError('❌ Withdrawal failed: ' + error.message);
    } finally {
        withdrawBtn.disabled = false;
        withdrawBtn.innerHTML = 'Withdraw XNT';
    }
}

function showSuccess(message) {
    const statusDiv = document.getElementById('txStatus');
    const panelDiv = document.getElementById('txStatusPanel');
    statusDiv.innerHTML = `<div class="alert alert-success">${message}</div>`;
    panelDiv.style.display = 'block';
}

function showError(message) {
    const statusDiv = document.getElementById('txStatus');
    const panelDiv = document.getElementById('txStatusPanel');
    statusDiv.innerHTML = `<div class="alert alert-error">${message}</div>`;
    panelDiv.style.display = 'block';
}

function clearStatus() {
    document.getElementById('txStatus').innerHTML = '';
    document.getElementById('txStatusPanel').style.display = 'none';
}

function formatNumber(num) {
    return (num / 1e6).toLocaleString('en-US', { maximumFractionDigits: 2 });
}
