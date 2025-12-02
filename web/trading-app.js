// Trading App for XNT Bonding Curve
// Uses vanilla Solana Web3.js without Anchor

const { Connection, Keypair, PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL } = solanaWeb3;

// Configuration
const CONFIG = {
    RPC_URL: 'http://localhost:8899',
    POOL_ADDRESS: 'GoauTxG6k1YLoBh9xwJ5UWuiJtCnvRgYnovKfhjY6UAF', // Pool with 10M wSOL (XNT) and 10M virtual USDC
    PROGRAM_ID: '2zKpM4k4kp7qRNvBVzkEAAt8DU8t1vpAfzsRagha4NNF',
    TOKEN_PROGRAM_ID: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    ASSOCIATED_TOKEN_PROGRAM_ID: 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
    XNT_MINT: 'So11111111111111111111111111111111111111112', // Native SOL mint (wSOL)
    CEILING_RESERVE_XNT: 'Cp5AyZFLBb6r1UkJ1MjZr2YZBub65tsyZgLESsWuYuYz', // Ceiling reserve wSOL account
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
let tradingMode = 'sell_usdc_for_sol'; // Trading mode: buy_usdc_with_sol, sell_usdc_for_sol (default to buying XNT)

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
// Handle trading mode change
function handleTradingModeChange() {
    const select = document.getElementById('tradingModeSelect');
    tradingMode = select.value;
    console.log('Trading mode changed to:', tradingMode);

    updateTradingModeUI();
    updateQuote();
}

// Update UI based on trading mode
function updateTradingModeUI() {
    const inputToken = document.getElementById('inputToken');
    const outputToken = document.getElementById('outputToken');
    const modeDesc = document.getElementById('modeDescription');
    const swapBtnText = document.getElementById('swapBtnText');
    const priceRow = document.getElementById('priceRow');
    const impactRow = document.getElementById('impactRow');
    const newPriceRow = document.getElementById('newPriceRow');
    const quickAmounts = document.getElementById('quickAmounts');

    switch(tradingMode) {
        case 'buy_usdc_with_sol':
            inputToken.textContent = 'XNT';
            outputToken.textContent = 'USDC';
            modeDesc.textContent = 'Sell XNT on AMM pool';
            swapBtnText.textContent = 'SELL XNT FOR USDC';
            priceRow.style.display = 'flex';
            impactRow.style.display = 'flex';
            newPriceRow.style.display = 'flex';
            quickAmounts.innerHTML = '<button class="quick-amount-btn" onclick="setAmount(10)">10</button><button class="quick-amount-btn" onclick="setAmount(100)">100</button><button class="quick-amount-btn" onclick="setAmount(1000)">1K</button><button class="quick-amount-btn" onclick="setAmount(10000)">10K</button>';
            break;
        case 'sell_usdc_for_sol':
            inputToken.textContent = 'USDC';
            outputToken.textContent = 'XNT';
            modeDesc.textContent = 'Buy XNT on AMM pool';
            swapBtnText.textContent = 'BUY XNT WITH USDC';
            priceRow.style.display = 'flex';
            impactRow.style.display = 'flex';
            newPriceRow.style.display = 'flex';
            quickAmounts.innerHTML = '<button class="quick-amount-btn" onclick="setAmount(5000)">5K</button><button class="quick-amount-btn" onclick="setAmount(10000)">10K</button><button class="quick-amount-btn" onclick="setAmount(25000)">25K</button><button class="quick-amount-btn" onclick="setAmount(50000)">50K</button>';
            break;
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

        // Update XNT reserve display
        document.getElementById('poolXntReserve').textContent = (xntReserve / 1e6).toLocaleString(undefined, { maximumFractionDigits: 3 });

        // Fetch real USDC reserves from API (only show real USDC, not virtual)
        try {
            const realResponse = await fetch('http://localhost:3030/api/pool-real-reserves');
            const realData = await realResponse.json();
            if (realData && realData.realUsdc !== undefined) {
                const realUsdc = Number(realData.realUsdc) / 1e6;
                document.getElementById('poolRealUsdcReserve').textContent = realUsdc.toLocaleString(undefined, { maximumFractionDigits: 3 });
            } else {
                // Fallback: show 0 if API doesn't return real USDC
                document.getElementById('poolRealUsdcReserve').textContent = '0';
            }
        } catch (e) {
            console.error('Error fetching real reserves:', e);
            // Fallback: show 0 on error
            document.getElementById('poolRealUsdcReserve').textContent = '0';
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
    if (!wallet) {
        console.log('updateBalances: wallet not ready');
        return;
    }

    if (!poolData) {
        console.log('updateBalances: poolData not ready yet, will update when available');
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
        let usdcBalance = 0;
        let solBalance = 0;

        try {
            const xntAccountInfo = await connection.getTokenAccountBalance(userXntAccount);
            xntBalance = parseInt(xntAccountInfo.value.amount);
            console.log('updateBalances: XNT balance', xntBalance);
        } catch (e) {
            console.log('updateBalances: XNT account does not exist yet', e.message);
        }

        // Get USDC balance
        try {
            const usdcAccountInfo = await connection.getTokenAccountBalance(userUsdcAccount);
            usdcBalance = parseInt(usdcAccountInfo.value.amount);
            console.log('updateBalances: USDC balance', usdcBalance);
        } catch (e) {
            console.log('updateBalances: USDC account does not exist yet', e.message);
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
        document.getElementById('usdcBalance').textContent = (usdcBalance / 1e6).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2});
        document.getElementById('solBalance').textContent = (solBalance / 1e9).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2});

        // Update position summary (only if poolData is available)
        if (poolData && poolData.price) {
            const xntValueUSDC = (xntBalance / 1e6) * poolData.price;
            const solValueUSDC = (solBalance / 1e9) * poolData.price; // 1 SOL = 1 XNT = poolData.price USDC
            const usdcValue = usdcBalance / 1e6; // USDC is already in USDC
            const totalPortfolio = xntValueUSDC + solValueUSDC + usdcValue;

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
        }

    } catch (error) {
        console.error('Error updating balances:', error);
    }
}

// Update quote
function updateQuote() {
    const amountInput = document.getElementById('tradeAmount');
    const amount = parseFloat(amountInput.value);

    if (!amount || amount <= 0) {
        document.getElementById('quoteReceive').textContent = '0.0';
        return;
    }

    document.getElementById('quoteDisplay').style.display = 'block';

    switch(tradingMode) {
        case 'buy_usdc_with_sol':
            if (!poolData) {
                document.getElementById('quoteReceive').textContent = 'Loading...';
                return;
            }
            // Sell XNT for USDC on AMM
            const xntAmount = amount * 1e6;
            const k = poolData.xntReserve * poolData.usdcReserve;
            const newXntReserve = poolData.xntReserve + xntAmount;
            const newUsdcReserve = k / newXntReserve;
            const usdcOut = poolData.usdcReserve - newUsdcReserve;
            const effectivePrice = usdcOut / xntAmount;
            const newPrice = newUsdcReserve / newXntReserve;
            const priceImpact = ((newPrice / poolData.price) - 1) * 100;

            document.getElementById('quoteReceive').textContent = (usdcOut / 1e6).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2});
            document.getElementById('quotePrice').textContent = '$' + effectivePrice.toFixed(6);
            document.getElementById('quotePriceImpact').textContent = (priceImpact >= 0 ? '+' : '') + priceImpact.toFixed(2) + '%';
            document.getElementById('quoteNewPrice').textContent = '$' + newPrice.toFixed(6);
            break;

        case 'sell_usdc_for_sol':
            if (!poolData) {
                document.getElementById('quoteReceive').textContent = 'Loading...';
                return;
            }
            // Buy XNT with USDC on AMM
            const usdcAmount = amount * 1e6;
            const k2 = poolData.xntReserve * poolData.usdcReserve;
            const newUsdcReserve2 = poolData.usdcReserve + usdcAmount;
            const newXntReserve2 = k2 / newUsdcReserve2;
            const xntOut = poolData.xntReserve - newXntReserve2;
            const effectivePrice2 = usdcAmount / xntOut;
            const newPrice2 = newUsdcReserve2 / newXntReserve2;
            const priceImpact2 = ((newPrice2 / poolData.price) - 1) * 100;

            document.getElementById('quoteReceive').textContent = (xntOut / 1e6).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2});
            document.getElementById('quotePrice').textContent = '$' + effectivePrice2.toFixed(6);
            document.getElementById('quotePriceImpact').textContent = (priceImpact2 >= 0 ? '+' : '') + priceImpact2.toFixed(2) + '%';
            document.getElementById('quoteNewPrice').textContent = '$' + newPrice2.toFixed(6);
            break;
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

// Execute swap (routes based on mode)
async function executeSwap() {
    switch(tradingMode) {
        case 'buy_usdc_with_sol':
            await executeSellSOLForUSDC();
            break;
        case 'sell_usdc_for_sol':
            await executeBuySOLWithUSDC();
            break;
    }
}

// Execute wrap (SOL→XNT)
async function executeWrap() {
    if (!wallet) {
        showStatus('Please wait for wallet to load', 'error');
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

        // Simply wrap SOL to XNT (1:1)
        showStatus(`Wrapping ${solAmount} SOL to XNT...`, 'info');
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

        if (wrapResult.success) {
            showStatus(`✅ Wrapped ${solAmount} SOL → ${solAmount} XNT! TX: ${wrapResult.tx.substring(0, 20)}...`, 'success');
            await updatePrice();
            await updateBalances();
        } else {
            throw new Error('Wrap failed: ' + wrapResult.error);
        }
    } catch (error) {
        showStatus('❌ Error: ' + error.message, 'error');
    } finally {
        document.getElementById('swapBtn').disabled = false;
    }
}

// Execute unwrap (XNT→SOL)
async function executeUnwrap() {
    if (!wallet) {
        showStatus('Please wait for wallet to load', 'error');
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

        // Simply unwrap XNT to SOL (1:1)
        showStatus(`Unwrapping ${xntAmount} XNT to SOL...`, 'info');
        const amountWithDecimals = Math.floor(xntAmount * 1e6); // XNT base units

        const unwrapResponse = await fetch('/api/unwrap', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                amount: amountWithDecimals,
                poolAddress: CONFIG.POOL_ADDRESS
            })
        });

        const unwrapResult = await unwrapResponse.json();

        if (unwrapResult.success) {
            showStatus(`✅ Unwrapped ${xntAmount} XNT → ${xntAmount} SOL! TX: ${unwrapResult.tx.substring(0, 20)}...`, 'success');
            await updatePrice();
            await updateBalances();
        } else {
            throw new Error('Unwrap failed: ' + unwrapResult.error);
        }
    } catch (error) {
        showStatus('❌ Error: ' + error.message, 'error');
    } finally {
        document.getElementById('swapBtn').disabled = false;
    }
}

// Execute: Sell XNT for USDC (internally: wrap SOL → XNT, then sell XNT for USDC)
async function executeSellSOLForUSDC() {
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

        // Step 1: Wrap SOL → XNT (automatic - convert user's SOL to XNT)
        showStatus(`Selling ${solAmount} SOL for USDC...`, 'info');
        addLog(`[1/2] Wrapping ${solAmount} SOL → XNT...`, 'info');
        const lamports = Math.floor(solAmount * 1e9);
        const wrapResponse = await fetch('/api/wrap', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ amount: lamports, poolAddress: CONFIG.POOL_ADDRESS })
        });
        const wrapResult = await wrapResponse.json();
        if (!wrapResult.success) throw new Error('Wrap failed: ' + wrapResult.error);
        addLog(`✓ Wrapped ${solAmount} SOL → ${solAmount} XNT. TX: ${wrapResult.tx.substring(0, 20)}...`, 'success');

        // Step 2: Sell XNT for USDC on AMM
        addLog(`[2/2] Selling ${solAmount} XNT for USDC on AMM...`, 'info');
        const xntWithDecimals = Math.floor(solAmount * 1e6);
        const sellResponse = await fetch('/api/sell', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ amount: xntWithDecimals })
        });
        const sellResult = await sellResponse.json();
        if (!sellResult.success) throw new Error('Sell failed: ' + sellResult.error);

        addLog(`✓ Sold XNT for USDC. TX: ${sellResult.tx.substring(0, 20)}...`, 'success');
        showStatus(`✅ Received USDC for ${solAmount} SOL!`, 'success');
        await updatePrice();
        await updateBalances();
    } catch (error) {
        showStatus('❌ Error: ' + error.message, 'error');
    } finally {
        document.getElementById('swapBtn').disabled = false;
    }
}

// Execute: Buy XNT with USDC (internally: buy XNT with USDC, then unwrap XNT → SOL)
async function executeBuySOLWithUSDC() {
    if (!wallet || !poolData) {
        showStatus('Please wait for wallet and price data to load', 'error');
        return;
    }

    const amountInput = document.getElementById('tradeAmount');
    const usdcAmount = parseFloat(amountInput.value);

    if (!usdcAmount || usdcAmount <= 0) {
        showStatus('Please enter a valid amount', 'error');
        return;
    }

    try {
        document.getElementById('swapBtn').disabled = true;

        // Step 1: Buy XNT with USDC on AMM
        showStatus(`Buying SOL with ${usdcAmount} USDC...`, 'info');
        addLog(`[1/2] Buying XNT with ${usdcAmount} USDC on AMM...`, 'info');
        const usdcWithDecimals = Math.floor(usdcAmount * 1e6);
        const buyResponse = await fetch('/api/buy', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ amount: usdcWithDecimals })
        });
        const buyResult = await buyResponse.json();
        if (!buyResult.success) throw new Error('Buy failed: ' + buyResult.error);

        // Calculate how much XNT we got (from the quote)
        const k = poolData.xntReserve * poolData.usdcReserve;
        const newUsdcReserve = poolData.usdcReserve + usdcWithDecimals;
        const newXntReserve = k / newUsdcReserve;
        const xntReceived = Math.floor(poolData.xntReserve - newXntReserve);
        addLog(`✓ Bought ${(xntReceived / 1e6).toFixed(2)} XNT. TX: ${buyResult.tx.substring(0, 20)}...`, 'success');

        // Step 2: Unwrap XNT → SOL (automatic - user gets native SOL)
        addLog(`[2/2] Unwrapping ${(xntReceived / 1e6).toFixed(2)} XNT → SOL (depositing to wallet)...`, 'info');
        const unwrapResponse = await fetch('/api/unwrap', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ amount: xntReceived, poolAddress: CONFIG.POOL_ADDRESS })
        });
        const unwrapResult = await unwrapResponse.json();
        if (!unwrapResult.success) throw new Error('Unwrap failed: ' + unwrapResult.error);
        addLog(`✓ Unwrapped ${(xntReceived / 1e6).toFixed(2)} XNT → ${(xntReceived / 1e6).toFixed(2)} SOL. TX: ${unwrapResult.tx.substring(0, 20)}...`, 'success');

        showStatus(`✅ Received ${(xntReceived / 1e6).toFixed(2)} SOL for ${usdcAmount} USDC!`, 'success');
        await updatePrice();
        await updateBalances();
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

    // Also add to transaction log
    addLog(message, type);
}

function addLog(message, type = 'info') {
    const logDiv = document.getElementById('transactionLog');
    if (!logDiv) return;

    const timestamp = new Date().toLocaleTimeString();
    const logEntry = document.createElement('div');

    let borderColor = '#6ab';
    let bgColor = 'rgba(102, 170, 187, 0.05)';
    let textColor = '#6ab';

    if (type === 'error') {
        borderColor = '#c96';
        bgColor = 'rgba(204, 153, 102, 0.05)';
        textColor = '#c96';
    } else if (type === 'success') {
        borderColor = '#6ab';
        bgColor = 'rgba(102, 170, 187, 0.08)';
        textColor = '#6ab';
    } else if (type === 'info') {
        borderColor = '#8bc';
        bgColor = 'rgba(136, 187, 204, 0.05)';
        textColor = '#8bc';
    }

    logEntry.style.cssText = `
        padding: 8px;
        margin: 5px 0;
        border-left: 2px solid ${borderColor};
        background: ${bgColor};
        color: ${textColor};
        font-size: 0.85em;
    `;

    logEntry.innerHTML = `<span style="color: #888;">[${timestamp}]</span> ${message}`;

    // Add to top of log
    if (logDiv.children.length > 0 && logDiv.children[0].textContent.includes('Transaction log will appear here')) {
        logDiv.innerHTML = '';
    }

    logDiv.insertBefore(logEntry, logDiv.firstChild);

    // Keep only last 50 entries
    while (logDiv.children.length > 50) {
        logDiv.removeChild(logDiv.lastChild);
    }
}

function clearLog() {
    const logDiv = document.getElementById('transactionLog');
    if (!logDiv) return;

    logDiv.innerHTML = `<div style="color: #8bc; padding: 10px; border-left: 2px solid #6ab; background: rgba(102, 170, 187, 0.05); margin: 5px 0;">
        Transaction log cleared.
    </div>`;
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
