// Trading App for XNT Bonding Curve
// Uses vanilla Solana Web3.js without Anchor

const { Connection, Keypair, PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL } = solanaWeb3;

// Configuration
const CONFIG = {
    RPC_URL: 'http://localhost:8899',
    POOL_ADDRESS: 'FUMwcusvcbimeMUaQnyxDCA4wQhibxPwTFYiR9uTnYng', // Pool with 10M wSOL and 10M USDC (both 9 decimals) for 1:1 ratio
    PROGRAM_ID: '2zKpM4k4kp7qRNvBVzkEAAt8DU8t1vpAfzsRagha4NNF',
    TOKEN_PROGRAM_ID: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    ASSOCIATED_TOKEN_PROGRAM_ID: 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
    XNT_MINT: 'So11111111111111111111111111111111111111112', // Native SOL mint (wSOL)
    CEILING_RESERVE_XNT: 'GYd44Nu2cyg72W3hwSW5N9xPZwroNP4MCT8DqjmhnMgr', // Ceiling reserve wSOL account
    AIRDROP_AMOUNT: 100_000 * 1e9, // 100K USDC (9 decimals)
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

        // Calculate price: 1 wSOL = 1 USDC
        // Pool initialized with 10B USDC and 10M wSOL for 1:1 ratio
        const price = usdcReserve / xntReserve;

        // Update UI
        document.getElementById('currentPrice').textContent = '$' + price.toFixed(6);

        // Update XNT reserve display
        document.getElementById('poolXntReserve').textContent = (xntReserve / 1e9).toLocaleString(undefined, { maximumFractionDigits: 3 });

        // Fetch real USDC reserves from API (only show real USDC, not virtual)
        try {
            const realResponse = await fetch('http://localhost:3030/api/pool-real-reserves');
            const realData = await realResponse.json();
            if (realData && realData.realUsdc !== undefined) {
                const realUsdc = Number(realData.realUsdc) / 1e9;
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
            const ceilingReserveXnt = parseInt(ceilingReserveInfo.value.amount) / 1e9;
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
        document.getElementById('xntBalance').textContent = (xntBalance / 1e9).toLocaleString();
        document.getElementById('usdcBalance').textContent = (usdcBalance / 1e9).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2});
        document.getElementById('solBalance').textContent = (solBalance / 1e9).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2});

        // Update position summary (only if poolData is available)
        if (poolData && poolData.price) {
            const xntValueUSDC = (xntBalance / 1e9) * poolData.price;
            const solValueUSDC = (solBalance / 1e9) * poolData.price; // 1 SOL = 1 XNT = poolData.price USDC
            const usdcValue = usdcBalance / 1e9; // USDC is already in USDC
            const totalPortfolio = xntValueUSDC + solValueUSDC + usdcValue;

            document.getElementById('xntValueUSDC').textContent = '$' + xntValueUSDC.toLocaleString();
            document.getElementById('totalPortfolio').textContent = '$' + totalPortfolio.toLocaleString();

            // Calculate average entry price
            if (totalXntBought > 0) {
                const avgEntry = totalUsdcSpent / totalXntBought;
                document.getElementById('avgEntryPrice').textContent = '$' + avgEntry.toFixed(6);

                // Calculate P&L
                const currentValue = (xntBalance / 1e9) * poolData.price;
                const costBasis = (xntBalance / 1e9) * avgEntry;
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
            // Now with matching 9 decimals, calculation is simple
            const xntIn_scaled = amount; // XNT in tokens
            const xntReserve_s = poolData.xntReserve / 1e9; // XNT in tokens
            const usdcReserve_s = poolData.usdcReserve / 1e9; // USDC in tokens (now 9 decimals)

            const k_scaled = xntReserve_s * usdcReserve_s;
            const newXntReserve_s = xntReserve_s + xntIn_scaled;
            const newUsdcReserve_s = k_scaled / newXntReserve_s;
            const usdcOut_scaled = usdcReserve_s - newUsdcReserve_s;

            const effectivePrice = usdcOut_scaled / xntIn_scaled;
            const newPrice = newUsdcReserve_s / newXntReserve_s;
            const priceImpact = ((newPrice / poolData.price) - 1) * 100;

            document.getElementById('quoteReceive').textContent = usdcOut_scaled.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2});
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
            // Now with matching 9 decimals, calculation is simple
            const usdcIn_scaled = amount; // USDC in tokens
            const xntReserve_scaled = poolData.xntReserve / 1e9; // XNT in tokens
            const usdcReserve_scaled = poolData.usdcReserve / 1e9; // USDC in tokens (now 9 decimals)

            const k2_scaled = xntReserve_scaled * usdcReserve_scaled;
            const newUsdcReserve_scaled = usdcReserve_scaled + usdcIn_scaled;
            const newXntReserve_scaled = k2_scaled / newUsdcReserve_scaled;
            const xntOut_scaled = xntReserve_scaled - newXntReserve_scaled;

            const effectivePrice2 = usdcIn_scaled / xntOut_scaled;
            const newPrice2 = newUsdcReserve_scaled / newXntReserve_scaled;
            const priceImpact2 = ((newPrice2 / poolData.price) - 1) * 100;

            document.getElementById('quoteReceive').textContent = xntOut_scaled.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2});
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

    const amountWithDecimals = Math.floor(amount * 1e9);

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
    const amountWithDecimals = Math.floor(amount * 1e9);

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

// Execute wrap (SOL→XNT) - NOT NEEDED: XNT is native wSOL
async function executeWrap() {
    showStatus('ℹ️ Wrap not needed - XNT is native wSOL (wrapped SOL). You can wrap SOL to wSOL using any Solana wallet (Phantom, Solflare, etc.)', 'info');
}

// Execute unwrap (XNT→SOL) - NOT NEEDED: XNT is native wSOL
async function executeUnwrap() {
    showStatus('ℹ️ Unwrap not needed - XNT is native wSOL (wrapped SOL). You can unwrap wSOL to SOL using any Solana wallet (Phantom, Solflare, etc.)', 'info');
}

// Execute: Sell XNT (wSOL) for USDC
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

        // Sell wSOL (XNT) for USDC on AMM
        showStatus(`Selling ${solAmount} wSOL for USDC...`, 'info');
        const xntWithDecimals = Math.floor(solAmount * 1e9);
        const sellResponse = await fetch('/api/sell', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ amount: xntWithDecimals })
        });
        const sellResult = await sellResponse.json();
        if (!sellResult.success) throw new Error('Sell failed: ' + sellResult.error);

        showStatus(`✅ Sold ${solAmount} wSOL for USDC! TX: ${sellResult.tx.substring(0, 20)}...`, 'success');
        await updatePrice();
        await updateBalances();
    } catch (error) {
        showStatus('❌ Error: ' + error.message, 'error');
    } finally {
        document.getElementById('swapBtn').disabled = false;
    }
}

// Execute: Buy XNT (wSOL) with USDC - No unwrap needed, XNT is native wSOL
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

        // Buy XNT (wSOL) with USDC on AMM
        showStatus(`Buying wSOL with ${usdcAmount} USDC...`, 'info');
        addLog(`Buying XNT (wSOL) with ${usdcAmount} USDC on AMM...`, 'info');
        const usdcWithDecimals = Math.floor(usdcAmount * 1e9);
        const buyResponse = await fetch('/api/buy', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ amount: usdcWithDecimals })
        });
        const buyResult = await buyResponse.json();
        if (!buyResult.success) throw new Error('Buy failed: ' + buyResult.error);

        // Calculate how much XNT (wSOL) we got (from the quote)
        const k = poolData.xntReserve * poolData.usdcReserve;
        const newUsdcReserve = poolData.usdcReserve + usdcWithDecimals;
        const newXntReserve = k / newUsdcReserve;
        const xntReceived = Math.floor(poolData.xntReserve - newXntReserve);
        addLog(`✓ Bought ${(xntReceived / 1e9).toFixed(2)} wSOL (XNT). TX: ${buyResult.tx.substring(0, 20)}...`, 'success');

        showStatus(`✅ Received ${(xntReceived / 1e9).toFixed(2)} wSOL for ${usdcAmount} USDC! (You can unwrap wSOL to SOL in any wallet)`, 'success');
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
