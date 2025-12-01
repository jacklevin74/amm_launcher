// SOL Wrapper App
const CONFIG = {
    RPC_URL: 'http://localhost:8899',
    POOL_ADDRESS: 'C9VdVhmEeyDhqeQYrqwGe3eS9YMighTHXuLyAdk227Hr',
    PROGRAM_ID: '2zKpM4k4kp7qRNvBVzkEAAt8DU8t1vpAfzsRagha4NNF'
};

let traderWallet = null;

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

    // Auto-load wallet
    await loadTraderWallet();
});

async function loadTraderWallet() {
    try {
        showStatus('Loading trader wallet...', 'info');

        const response = await fetch('/api/trader-wallet');
        const data = await response.json();

        if (!data.success) {
            throw new Error(data.error || 'Failed to load wallet');
        }

        traderWallet = data.address;
        console.log('Trader wallet loaded:', traderWallet);

        document.getElementById('walletAddress').textContent = traderWallet;
        document.getElementById('connectBtn').style.display = 'none';

        // Show panels
        document.getElementById('balancesPanel').style.display = 'block';
        document.getElementById('wrapPanel').style.display = 'block';

        // Load balances
        await loadBalances();

        showStatus('Wallet loaded successfully!', 'success');
        setTimeout(() => {
            document.getElementById('txStatusPanel').style.display = 'none';
        }, 3000);

    } catch (err) {
        console.error('Wallet loading error:', err);
        showStatus('Failed to load wallet: ' + err.message, 'error');
    }
}

async function loadBalances() {
    try {
        const response = await fetch('/api/trader-balances');
        const data = await response.json();

        if (data.success) {
            document.getElementById('solBalance').textContent = `${data.balances.sol.toFixed(4)} SOL`;
            document.getElementById('xntBalance').textContent = `${data.balances.xnt.toFixed(4)} XNT`;
        } else {
            console.error('Failed to load balances:', data.error);
            document.getElementById('solBalance').textContent = '- SOL';
            document.getElementById('xntBalance').textContent = '- XNT';
        }

    } catch (err) {
        console.error('Error loading balances:', err);
        document.getElementById('solBalance').textContent = '- SOL';
        document.getElementById('xntBalance').textContent = '- XNT';
    }
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

        // Call server API
        const response = await fetch('/api/wrap', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                amount: lamports,
                poolAddress: CONFIG.POOL_ADDRESS
            })
        });

        const data = await response.json();

        if (data.success) {
            showStatus(`✓ Wrapped ${solAmount} SOL → ${solAmount} XNT! TX: ${data.tx.substring(0, 8)}...`, 'success');

            // Reload balances
            await loadBalances();

            // Clear input
            document.getElementById('wrapAmount').value = '';
            document.getElementById('wrapReceive').textContent = '0 XNT';
        } else {
            throw new Error(data.error || 'Wrap transaction failed');
        }

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

        // Call server API
        const response = await fetch('/api/unwrap', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                amount: xntBaseUnits,
                poolAddress: CONFIG.POOL_ADDRESS
            })
        });

        const data = await response.json();

        if (data.success) {
            showStatus(`✓ Unwrapped ${xntAmount} XNT → ${xntAmount} SOL! TX: ${data.tx.substring(0, 8)}...`, 'success');

            // Reload balances
            await loadBalances();

            // Clear input
            document.getElementById('unwrapAmount').value = '';
            document.getElementById('unwrapReceive').textContent = '0 SOL';
        } else {
            throw new Error(data.error || 'Unwrap transaction failed');
        }

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
