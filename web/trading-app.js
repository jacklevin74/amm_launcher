// Trading App for XNT Bonding Curve
// Uses vanilla Solana Web3.js without Anchor

const { Connection, Keypair, PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL } = solanaWeb3;

// Configuration
const CONFIG = {
    RPC_URL: 'http://localhost:8899',
    POOL_ADDRESS: 'C9VdVhmEeyDhqeQYrqwGe3eS9YMighTHXuLyAdk227Hr', // Pool with floor and ceiling defense
    PROGRAM_ID: '2zKpM4k4kp7qRNvBVzkEAAt8DU8t1vpAfzsRagha4NNF',
    TOKEN_PROGRAM_ID: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    ASSOCIATED_TOKEN_PROGRAM_ID: 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
    CEILING_RESERVE_XNT: '4bvuXBmwTFWShM9pXgTDoaZfVjnYHqaR1GwTvKSnxGzc', // Ceiling reserve XNT account
    AIRDROP_AMOUNT: 100_000 * 1e6, // 100K USDC (6 decimals)
    POLL_INTERVAL: 2000, // Update UI every 2 seconds
};

// Global state
let connection = null;
let wallet = null;
let poolData = null;
let tradeHistory = [];
let totalUsdcSpent = 0;
let totalXntBought = 0;
let totalUsdcReceived = 0;
let totalXntSold = 0;
let priceUpdateInterval = null;
let swapDirection = 'buy'; // 'buy' (USDC→XNT) or 'sell' (XNT→USDC)
let paymentToken = 'USDC'; // 'USDC' or 'SOL' - which token to use for payment

// Initialize connection
async function init() {
    try {
        connection = new Connection(CONFIG.RPC_URL, 'confirmed');
        showStatus('Connected to Solana RPC', 'success');

        // Initial price update to get pool data first
        await updatePrice();

        // Try to load trader wallet from server first
        await loadTraderWalletFromServer();

        // Start price updates
        if (!priceUpdateInterval) {
            priceUpdateInterval = setInterval(updatePrice, CONFIG.POLL_INTERVAL);
        }
    } catch (error) {
        showStatus('Error connecting to RPC: ' + error.message, 'error');
    }
}

// Create new wallet
async function createWallet() {
    try {
        showStatus('Generating new wallet...', 'info');

        wallet = Keypair.generate();

        // Save to localStorage
        localStorage.setItem('trader_wallet', JSON.stringify(Array.from(wallet.secretKey)));

        // Request SOL airdrop for transaction fees
        showStatus('Requesting SOL airdrop for gas fees...', 'info');
        const airdropSignature = await connection.requestAirdrop(
            wallet.publicKey,
            2 * LAMPORTS_PER_SOL
        );
        await connection.confirmTransaction(airdropSignature);

        // Airdrop 1000 SOL for testing
        await airdropSOL();

        showStatus('Wallet created successfully!', 'success');
        updateWalletUI();
        await updateBalances();

    } catch (error) {
        showStatus('Error creating wallet: ' + error.message, 'error');
    }
}

// Load trader wallet from server
async function loadTraderWalletFromServer() {
    try {
        showStatus('Loading trader wallet...', 'info');
        const response = await fetch('http://localhost:3030/api/wallet');
        if (!response.ok) {
            throw new Error('Failed to load wallet from server');
        }

        const walletData = await response.json();
        const secretKey = new Uint8Array(walletData);
        wallet = Keypair.fromSecretKey(secretKey);

        // Save to localStorage for future use
        localStorage.setItem('trader_wallet', JSON.stringify(walletData));

        // Airdrop 1000 SOL for testing
        await airdropSOL();

        showStatus('Trader wallet loaded successfully! (1.1M USDC)', 'success');
        updateWalletUI();
        await updateBalances();
    } catch (error) {
        console.error('Error loading wallet from server:', error);
        showStatus('Could not load trader wallet from server', 'error');

        // Fallback to localStorage
        loadWalletFromStorage();
    }
}

// Load wallet from localStorage (fallback)
function loadWalletFromStorage() {
    try {
        const stored = localStorage.getItem('trader_wallet');
        if (stored) {
            const secretKey = new Uint8Array(JSON.parse(stored));
            wallet = Keypair.fromSecretKey(secretKey);
            showStatus('Loaded wallet from browser cache', 'success');
            updateWalletUI();
            updateBalances();
        }
    } catch (error) {
        console.error('Error loading wallet:', error);
    }
}

// Update wallet UI
function updateWalletUI() {
    if (!wallet) {
        document.getElementById('noWallet').style.display = 'block';
        document.getElementById('hasWallet').style.display = 'none';
        document.getElementById('swapBtn').disabled = true;
    } else {
        document.getElementById('noWallet').style.display = 'none';
        document.getElementById('hasWallet').style.display = 'block';
        document.getElementById('walletAddress').textContent = wallet.publicKey.toString();
        document.getElementById('swapBtn').disabled = false;
    }
}

// Handle payment token change
function handlePaymentTokenChange() {
    const select = document.getElementById('paymentTokenSelect');
    paymentToken = select.value;
    console.log('Payment token changed to:', paymentToken);

    // Update the input token display based on swap direction and payment token
    updateTokenDisplay();
    updateQuote();
}

// Update token display based on direction and payment method
function updateTokenDisplay() {
    if (swapDirection === 'buy') {
        // Buying XNT
        document.getElementById('inputToken').textContent = paymentToken;
        document.getElementById('outputToken').textContent = 'XNT';
    } else {
        // Selling XNT
        document.getElementById('inputToken').textContent = 'XNT';
        document.getElementById('outputToken').textContent = paymentToken;
    }
}

// Toggle swap direction
function toggleSwapDirection() {
    swapDirection = swapDirection === 'buy' ? 'sell' : 'buy';

    // Update UI elements
    updateTokenDisplay();

    if (swapDirection === 'buy') {
        document.querySelector('.swap-arrow').textContent = '↓';
    } else {
        document.querySelector('.swap-arrow').textContent = '↑';
    }

    // Refresh quote
    updateQuote();
}

// Airdrop USDC
async function airdropUSDC() {
    showStatus('⚠️ Airdrop is only available via CLI trader', 'info');
    showStatus('Run: npx ts-node scripts/interactive-trader.ts --pool=' + CONFIG.POOL_ADDRESS, 'info');
    showStatus('Then press [a] to airdrop USDC', 'info');
}

// Airdrop SOL for testing
async function airdropSOL() {
    try {
        console.log('Requesting 1000 SOL airdrop...');
        showStatus('Requesting 1000 SOL airdrop...', 'info');

        const airdropSignature = await connection.requestAirdrop(
            wallet.publicKey,
            1000 * LAMPORTS_PER_SOL
        );

        await connection.confirmTransaction(airdropSignature);
        console.log('✓ Airdropped 1000 SOL successfully');
        showStatus('✓ Airdropped 1000 SOL for testing', 'success');
    } catch (err) {
        console.error('Airdrop error:', err);
        // Don't fail the whole wallet loading process if airdrop fails
        showStatus('Airdrop failed (may already have SOL)', 'info');
    }
}

// Update current price
async function updatePrice() {
    try {
        const poolAccountInfo = await connection.getAccountInfo(new PublicKey(CONFIG.POOL_ADDRESS));
        if (!poolAccountInfo) {
            return;
        }

        // Parse pool data using correct Anchor layout
        const data = poolAccountInfo.data;

        // Anchor discriminator is 8 bytes
        // Pool struct layout after discriminator:
        // authority: Pubkey (32 bytes) - offset 8
        // xnt_mint: Pubkey (32 bytes) - offset 40
        // usdc_mint: Pubkey (32 bytes) - offset 72
        // pool_xnt: Pubkey (32 bytes) - offset 104
        // pool_usdc: Pubkey (32 bytes) - offset 136
        // xnt_reserve: u64 (8 bytes) - offset 168
        // usdc_reserve: u64 (8 bytes) - offset 176

        const xntReserve = readU64(data, 168);
        const usdcReserve = readU64(data, 176);

        const price = usdcReserve / xntReserve;

        // Update UI
        document.getElementById('currentPrice').textContent = '$' + price.toFixed(6);

        // Update virtual pool reserves display
        document.getElementById('poolUsdcReserve').textContent = (usdcReserve / 1e6).toLocaleString(undefined, { maximumFractionDigits: 3 });
        document.getElementById('poolXntReserve').textContent = (xntReserve / 1e6).toLocaleString(undefined, { maximumFractionDigits: 3 });

        // Fetch real reserves from API
        try {
            const realResponse = await fetch('http://localhost:3030/api/pool-real-reserves');
            const realData = await realResponse.json();
            if (realData && realData.realUsdc) {
                const realUsdc = Number(realData.realUsdc) / 1e6;
                const virtualUsdc = (usdcReserve / 1e6) - realUsdc;
                document.getElementById('poolRealUsdcReserve').textContent = realUsdc.toLocaleString(undefined, { maximumFractionDigits: 3 });
                document.getElementById('poolVirtualUsdc').textContent = virtualUsdc.toLocaleString(undefined, { maximumFractionDigits: 3 });
            }
        } catch (e) {
            console.error('Error fetching real reserves:', e);
        }

        // Fetch ceiling reserve XNT balance
        try {
            const ceilingReserveInfo = await connection.getTokenAccountBalance(new PublicKey(CONFIG.CEILING_RESERVE_XNT));
            const ceilingReserveXnt = parseInt(ceilingReserveInfo.value.amount) / 1e6;
            document.getElementById('ceilingReserveXnt').textContent = ceilingReserveXnt.toLocaleString(undefined, { maximumFractionDigits: 3 });
        } catch (e) {
            console.error('Error fetching ceiling reserve:', e);
        }

        // Store pool data for quotes
        poolData = {
            xntReserve,
            usdcReserve,
            price,
        };

        // Update quote if amount is entered
        updateQuote();

    } catch (error) {
        console.error('Error updating price:', error);
    }
}

// Helper: Get Associated Token Address
async function getAssociatedTokenAddress(mint, owner) {
    const [address] = await PublicKey.findProgramAddress(
        [
            owner.toBuffer(),
            new PublicKey(CONFIG.TOKEN_PROGRAM_ID).toBuffer(),
            mint.toBuffer(),
        ],
        new PublicKey(CONFIG.ASSOCIATED_TOKEN_PROGRAM_ID)
    );
    return address;
}

// Update balances
async function updateBalances() {
    if (!wallet || !poolData) {
        console.log('updateBalances: wallet or poolData not ready', { wallet: !!wallet, poolData: !!poolData });
        return;
    }

    try {
        const poolAccountInfo = await connection.getAccountInfo(new PublicKey(CONFIG.POOL_ADDRESS));
        if (!poolAccountInfo) {
            console.log('updateBalances: pool account not found');
            return;
        }

        const data = poolAccountInfo.data;
        const xntMint = new PublicKey(data.slice(40, 72));
        const usdcMint = new PublicKey(data.slice(72, 104));

        console.log('updateBalances: mints', { xntMint: xntMint.toString(), usdcMint: usdcMint.toString() });

        // Get token accounts
        const userXntAccount = await getAssociatedTokenAddress(xntMint, wallet.publicKey);
        const userUsdcAccount = await getAssociatedTokenAddress(usdcMint, wallet.publicKey);

        console.log('updateBalances: user token accounts', {
            userXntAccount: userXntAccount.toString(),
            userUsdcAccount: userUsdcAccount.toString()
        });

        // Get balances
        let xntBalance = 0;
        let solBalance = 0;

        try {
            const xntAccountInfo = await connection.getTokenAccountBalance(userXntAccount);
            xntBalance = parseInt(xntAccountInfo.value.amount);
            console.log('updateBalances: XNT balance', xntBalance);
        } catch (e) {
            console.log('updateBalances: XNT account does not exist yet', e.message);
        }

        // Get SOL balance
        try {
            solBalance = await connection.getBalance(wallet.publicKey);
            console.log('updateBalances: SOL balance', solBalance);
        } catch (e) {
            console.log('updateBalances: Error getting SOL balance', e.message);
        }

        // Update UI
        document.getElementById('xntBalance').textContent = (xntBalance / 1e6).toLocaleString();
        document.getElementById('solBalance').textContent = (solBalance / 1e9).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2});

        // Update position summary
        const xntValueUSDC = (xntBalance / 1e6) * poolData.price;
        const solValueUSDC = (solBalance / 1e9) * poolData.price; // 1 SOL = 1 XNT = poolData.price USDC
        const totalPortfolio = xntValueUSDC + solValueUSDC;

        document.getElementById('xntValueUSDC').textContent = '$' + xntValueUSDC.toLocaleString();
        document.getElementById('totalPortfolio').textContent = '$' + totalPortfolio.toLocaleString();

        // Calculate average entry price
        if (totalXntBought > 0) {
            const avgEntry = totalUsdcSpent / totalXntBought;
            document.getElementById('avgEntryPrice').textContent = '$' + avgEntry.toFixed(6);

            // Calculate P&L
            const currentValue = (xntBalance / 1e6) * poolData.price;
            const costBasis = (xntBalance / 1e6) * avgEntry;
            const pnl = currentValue - costBasis;
            const pnlPercent = costBasis > 0 ? (pnl / costBasis * 100) : 0;

            const pnlElement = document.getElementById('pnl');
            pnlElement.textContent = '$' + pnl.toFixed(2) + ' (' + (pnl >= 0 ? '+' : '') + pnlPercent.toFixed(2) + '%)';
            pnlElement.className = 'position-value ' + (pnl >= 0 ? 'positive' : 'negative');
        }

    } catch (error) {
        console.error('Error updating balances:', error);
    }
}

// Update quote
function updateQuote() {
    const amountInput = document.getElementById('tradeAmount');
    const amount = parseFloat(amountInput.value);

    if (!amount || amount <= 0 || !poolData) {
        document.getElementById('quoteDisplay').style.display = 'none';
        return;
    }

    const amountWithDecimals = amount * 1e6; // Convert to base units
    const currentPrice = poolData.price;
    const k = poolData.xntReserve * poolData.usdcReserve;

    if (swapDirection === 'buy') {
        // Buy: user pays USDC, gets XNT
        const newUsdcReserve = poolData.usdcReserve + amountWithDecimals;
        const newXntReserve = k / newUsdcReserve;
        const xntOut = poolData.xntReserve - newXntReserve;
        const effectivePrice = amountWithDecimals / xntOut;
        const newPrice = newUsdcReserve / newXntReserve;
        const priceImpact = ((newPrice / currentPrice) - 1) * 100;

        // Update quote display
        document.getElementById('quoteDisplay').style.display = 'block';
        document.getElementById('quotePay').textContent = (amount / 1000).toFixed(1) + 'K USDC';
        document.getElementById('quoteReceive').textContent = (xntOut / 1e6).toFixed(2) + ' XNT';
        document.getElementById('quotePrice').textContent = '$' + effectivePrice.toFixed(6);
        document.getElementById('quotePriceImpact').textContent = (priceImpact >= 0 ? '+' : '') + priceImpact.toFixed(2) + '%';
        document.getElementById('quoteNewPrice').textContent = '$' + newPrice.toFixed(6);
    } else {
        // Sell: user pays XNT, gets USDC
        const newXntReserve = poolData.xntReserve + amountWithDecimals;
        const newUsdcReserve = k / newXntReserve;
        const usdcOut = poolData.usdcReserve - newUsdcReserve;
        const effectivePrice = usdcOut / amountWithDecimals;
        const newPrice = newUsdcReserve / newXntReserve;
        const priceImpact = ((newPrice / currentPrice) - 1) * 100;

        // Update quote display
        document.getElementById('quoteDisplay').style.display = 'block';
        document.getElementById('quotePay').textContent = (amount / 1000).toFixed(1) + 'K XNT';
        document.getElementById('quoteReceive').textContent = (usdcOut / 1e6).toFixed(2) + ' USDC';
        document.getElementById('quotePrice').textContent = '$' + effectivePrice.toFixed(6);
        document.getElementById('quotePriceImpact').textContent = (priceImpact >= 0 ? '+' : '') + priceImpact.toFixed(2) + '%';
        document.getElementById('quoteNewPrice').textContent = '$' + newPrice.toFixed(6);
    }
}

// Set amount
function setAmount(amount) {
    document.getElementById('tradeAmount').value = amount;
    updateQuote();
}

// Execute buy
async function executeBuy() {
    if (!wallet || !poolData) {
        showStatus('Please wait for wallet and price data to load', 'error');
        return;
    }

    const amountInput = document.getElementById('tradeAmount');
    const amount = parseFloat(amountInput.value);

    if (!amount || amount <= 0) {
        showStatus('Please enter a valid amount', 'error');
        return;
    }

    const amountWithDecimals = Math.floor(amount * 1e6);

    try {
        document.getElementById('swapBtn').disabled = true;
        showStatus('🔄 Executing BUY trade...', 'info');

        const response = await fetch('http://localhost:3030/api/buy', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ amount: amountWithDecimals })
        });

        const result = await response.json();

        if (result.success) {
            showStatus('✅ BUY successful! TX: ' + result.tx.substring(0, 20) + '...', 'success');
            await updatePrice();
            await updateBalances();
        } else {
            showStatus('❌ Trade failed: ' + result.error, 'error');
        }
    } catch (error) {
        showStatus('❌ Error: ' + error.message, 'error');
    } finally {
        document.getElementById('swapBtn').disabled = false;
    }
}

// Execute sell
async function executeSell() {
    if (!wallet || !poolData) {
        showStatus('Please wait for wallet and price data to load', 'error');
        return;
    }

    const amountInput = document.getElementById('tradeAmount');
    const amount = parseFloat(amountInput.value);

    if (!amount || amount <= 0) {
        showStatus('Please enter a valid amount', 'error');
        return;
    }

    // Amount is directly in XNT (user input)
    const amountWithDecimals = Math.floor(amount * 1e6);

    try {
        document.getElementById('swapBtn').disabled = true;
        showStatus('🔄 Executing SELL trade...', 'info');

        const response = await fetch('http://localhost:3030/api/sell', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ amount: amountWithDecimals })
        });

        const result = await response.json();

        if (result.success) {
            showStatus('✅ SELL successful! TX: ' + result.tx.substring(0, 20) + '...', 'success');
            await updatePrice();
            await updateBalances();
        } else {
            showStatus('❌ Trade failed: ' + result.error, 'error');
        }
    } catch (error) {
        showStatus('❌ Error: ' + error.message, 'error');
    } finally {
        document.getElementById('swapBtn').disabled = false;
    }
}

// Execute swap (routes to buy or sell based on direction)
async function executeSwap() {
    if (paymentToken === 'SOL') {
        // Using SOL: need to wrap/unwrap
        if (swapDirection === 'buy') {
            await executeSOLBuy();
        } else {
            await executeSOLSell();
        }
    } else {
        // Using USDC: direct trading
        if (swapDirection === 'buy') {
            await executeBuy();
        } else {
            await executeSell();
        }
    }
}

// Execute buy using SOL (wrap SOL→XNT first, then buy with XNT)
async function executeSOLBuy() {
    if (!wallet || !poolData) {
        showStatus('Please wait for wallet and price data to load', 'error');
        return;
    }

    const amountInput = document.getElementById('tradeAmount');
    const solAmount = parseFloat(amountInput.value);

    if (!solAmount || solAmount <= 0) {
        showStatus('Please enter a valid amount', 'error');
        return;
    }

    try {
        document.getElementById('swapBtn').disabled = true;

        // Step 1: Wrap SOL to XNT
        showStatus(`Step 1/2: Wrapping ${solAmount} SOL to XNT...`, 'info');
        const lamports = Math.floor(solAmount * 1e9);

        const wrapResponse = await fetch('/api/wrap', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                amount: lamports,
                poolAddress: CONFIG.POOL_ADDRESS
            })
        });

        const wrapResult = await wrapResponse.json();

        if (!wrapResult.success) {
            throw new Error('Wrap failed: ' + wrapResult.error);
        }

        showStatus(`✅ Wrapped ${solAmount} SOL to XNT! TX: ${wrapResult.tx.substring(0, 20)}...`, 'success');

        // Step 2: Buy with the wrapped XNT (converted to USDC value)
        showStatus(`Step 2/2: Buying XNT with wrapped amount...`, 'info');

        // Since 1 SOL = 1 XNT, we now buy using that XNT value in USDC terms
        const usdcAmount = solAmount * 1000; // Treat as K USDC
        const amountWithDecimals = Math.floor(usdcAmount * 1e6);

        const buyResponse = await fetch('/api/buy', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ amount: amountWithDecimals })
        });

        const buyResult = await buyResponse.json();

        if (buyResult.success) {
            showStatus(`✅ BUY successful! Total: Wrapped ${solAmount} SOL + Bought XNT. TX: ${buyResult.tx.substring(0, 20)}...`, 'success');
            await updatePrice();
            await updateBalances();
        } else {
            showStatus('❌ Buy failed: ' + buyResult.error, 'error');
        }
    } catch (error) {
        showStatus('❌ Error: ' + error.message, 'error');
    } finally {
        document.getElementById('swapBtn').disabled = false;
    }
}

// Execute sell using SOL (sell XNT first, then unwrap to SOL)
async function executeSOLSell() {
    if (!wallet || !poolData) {
        showStatus('Please wait for wallet and price data to load', 'error');
        return;
    }

    const amountInput = document.getElementById('tradeAmount');
    const xntAmount = parseFloat(amountInput.value);

    if (!xntAmount || xntAmount <= 0) {
        showStatus('Please enter a valid amount', 'error');
        return;
    }

    try {
        document.getElementById('swapBtn').disabled = true;

        // Step 1: Sell XNT for USDC
        showStatus(`Step 1/2: Selling ${xntAmount}K XNT...`, 'info');
        const amountWithDecimals = Math.floor(xntAmount * 1e3 * 1e6); // K XNT to base units

        const sellResponse = await fetch('/api/sell', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ amount: amountWithDecimals })
        });

        const sellResult = await sellResponse.json();

        if (!sellResult.success) {
            throw new Error('Sell failed: ' + sellResult.error);
        }

        showStatus(`✅ Sold ${xntAmount}K XNT! TX: ${sellResult.tx.substring(0, 20)}...`, 'success');

        // Step 2: Unwrap XNT to SOL (amount to unwrap)
        showStatus(`Step 2/2: Unwrapping XNT to SOL...`, 'info');

        // Unwrap equivalent amount (user wants SOL back)
        const unwrapAmount = Math.floor(xntAmount * 1e3 * 1e6); // Same amount in XNT base units

        const unwrapResponse = await fetch('/api/unwrap', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                amount: unwrapAmount,
                poolAddress: CONFIG.POOL_ADDRESS
            })
        });

        const unwrapResult = await unwrapResponse.json();

        if (unwrapResult.success) {
            showStatus(`✅ SELL successful! Sold XNT + Unwrapped to SOL. TX: ${unwrapResult.tx.substring(0, 20)}...`, 'success');
            await updatePrice();
            await updateBalances();
        } else {
            showStatus('❌ Unwrap failed: ' + unwrapResult.error, 'error');
        }
    } catch (error) {
        showStatus('❌ Error: ' + error.message, 'error');
    } finally {
        document.getElementById('swapBtn').disabled = false;
    }
}

// Reset trading area
function resetTrading() {
    // Clear the trade amount input
    document.getElementById('tradeAmount').value = '';

    // Hide the quote display
    document.getElementById('quoteDisplay').style.display = 'none';

    // Reset to buy direction
    swapDirection = 'buy';
    document.getElementById('inputToken').textContent = 'USDC';
    document.getElementById('outputToken').textContent = 'XNT';
    document.querySelector('.swap-arrow').textContent = '↓';

    showStatus('Trading area cleared', 'info');
}

// Helper functions
function showStatus(message, type = 'info') {
    const statusDiv = document.getElementById('statusMessages');
    const statusElement = document.createElement('div');
    statusElement.className = 'status ' + type;
    statusElement.textContent = message;
    statusDiv.appendChild(statusElement);

    // Remove after 5 seconds
    setTimeout(() => {
        statusElement.remove();
    }, 5000);

    console.log('[' + type.toUpperCase() + ']', message);
}

function readU64(data, offset) {
    // Browser-compatible U64 reading using DataView
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const low = view.getUint32(offset, true);
    const high = view.getUint32(offset + 4, true);
    return high * 0x100000000 + low;
}

// Initialize on load
window.addEventListener('load', init);

// Expose functions to global scope
window.createWallet = createWallet;
window.airdropUSDC = airdropUSDC;
window.setAmount = setAmount;
window.updateQuote = updateQuote;
window.executeBuy = executeBuy;
window.executeSell = executeSell;
window.executeSwap = executeSwap;
window.toggleSwapDirection = toggleSwapDirection;
window.resetTrading = resetTrading;
