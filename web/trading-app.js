// Trading App for XNT Bonding Curve
// Uses vanilla Solana Web3.js without Anchor

const { Connection, Keypair, PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL } = solanaWeb3;

// Configuration - will be loaded from server
let CONFIG = {
    RPC_URL: 'http://localhost:8899',
    POOL_ADDRESS: '',  // Will be loaded from config
    PROGRAM_ID: '2zKpM4k4kp7qRNvBVzkEAAt8DU8t1vpAfzsRagha4NNF',
    TOKEN_PROGRAM_ID: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    ASSOCIATED_TOKEN_PROGRAM_ID: 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
    XNT_MINT: 'So11111111111111111111111111111111111111112', // Native SOL mint (wSOL)
    CEILING_RESERVE_XNT: '', // Will be loaded from config
    AIRDROP_AMOUNT: 100_000 * 1e9, // 100K USDC (9 decimals)
    POLL_INTERVAL: 2000, // Update UI every 2 seconds
};

// Load config on page load
(async function loadConfig() {
    try {
        const response = await fetch('/api/config');
        if (!response.ok) throw new Error('Failed to load config');
        const config = await response.json();
        CONFIG.POOL_ADDRESS = config.poolAddress;
        CONFIG.RPC_URL = config.rpcUrl;
        CONFIG.PROGRAM_ID = config.programId;
        CONFIG.CEILING_RESERVE_XNT = config.ceilingReserveWSOL;
        console.log('✓ Loaded pool config:', config);
    } catch (error) {
        console.error('Failed to load config:', error);
        alert('Failed to load pool configuration. Please run the initialization script.');
    }
})();

// Global state
let connection = null;
let wallet = null;
let walletType = null; // 'phantom', 'backpack', 'x1', or 'local'
let walletAdapter = null; // For extension wallets
let poolData = null;
let tradeHistory = [];
let totalUsdcSpent = 0;
let totalXntBought = 0;
let totalUsdcReceived = 0;
let totalXntSold = 0;
let priceUpdateInterval = null;
let tradingMode = 'sell_usdc_for_sol'; // Trading mode: buy_usdc_with_sol, sell_usdc_for_sol (default to buying XNT)
let slippageTolerance = 0.5; // Default 0.5% slippage tolerance

// Initialize connection
async function init() {
    try {
        connection = new Connection(CONFIG.RPC_URL, 'confirmed');
        showStatus('Connected to Solana RPC', 'success');

        // Initial price update to get pool data first
        await updatePrice();

        // Check for saved wallet connection
        const savedWalletType = localStorage.getItem('walletType');
        if (savedWalletType && savedWalletType !== 'local') {
            // Try to reconnect to extension wallet
            await connectWallet(savedWalletType);
        } else if (savedWalletType === 'local') {
            // Try to load local wallet from storage
            loadWalletFromStorage();
        }

        // Start price updates
        if (!priceUpdateInterval) {
            priceUpdateInterval = setInterval(updatePrice, CONFIG.POLL_INTERVAL);
        }
    } catch (error) {
        showStatus('Error connecting to RPC: ' + error.message, 'error');
    }
}

// Wallet connection functions
async function connectPhantom() {
    await connectWallet('phantom');
}

async function connectBackpack() {
    await connectWallet('backpack');
}

async function connectX1() {
    await connectWallet('x1');
}

async function connectWallet(type) {
    try {
        showStatus(`Connecting to ${type} wallet...`, 'info');

        let provider;
        switch(type) {
            case 'phantom':
                provider = window.phantom?.solana;
                if (!provider?.isPhantom) {
                    showStatus('Phantom wallet not found. Please install from phantom.app', 'error');
                    window.open('https://phantom.app/', '_blank');
                    return;
                }
                break;
            case 'backpack':
                provider = window.backpack;
                if (!provider) {
                    showStatus('Backpack wallet not found. Please install from backpack.app', 'error');
                    window.open('https://backpack.app/', '_blank');
                    return;
                }
                break;
            case 'x1':
                provider = window.xnft?.solana || window.x1;
                if (!provider) {
                    showStatus('X1 wallet not found. Please install the X1 Wallet extension', 'error');
                    return;
                }
                break;
            default:
                showStatus('Unknown wallet type', 'error');
                return;
        }

        // Connect to wallet
        const resp = await provider.connect();
        walletAdapter = provider;
        walletType = type;

        // Create a wallet-like object with publicKey
        wallet = {
            publicKey: resp.publicKey || provider.publicKey,
            signTransaction: async (tx) => await provider.signTransaction(tx),
            signAllTransactions: async (txs) => await provider.signAllTransactions(txs),
        };

        // Save wallet type to localStorage
        localStorage.setItem('walletType', type);

        showStatus(`Connected to ${type} wallet!`, 'success');
        updateWalletUI();
        await updateBalances();

        // Listen for account changes
        provider.on?.('accountChanged', (publicKey) => {
            if (publicKey) {
                wallet.publicKey = publicKey;
                updateWalletUI();
                updateBalances();
            } else {
                disconnectWallet();
            }
        });

        // Listen for disconnect
        provider.on?.('disconnect', () => {
            disconnectWallet();
        });

    } catch (error) {
        showStatus('Error connecting wallet: ' + error.message, 'error');
        console.error('Wallet connection error:', error);
    }
}

async function disconnectWallet() {
    try {
        if (walletAdapter && walletType !== 'local') {
            await walletAdapter.disconnect?.();
        }

        wallet = null;
        walletType = null;
        walletAdapter = null;
        localStorage.removeItem('walletType');

        updateWalletUI();
        showStatus('Wallet disconnected', 'info');
    } catch (error) {
        console.error('Error disconnecting wallet:', error);
        // Force disconnect even if there's an error
        wallet = null;
        walletType = null;
        walletAdapter = null;
        localStorage.removeItem('walletType');
        updateWalletUI();
    }
}

// Create new wallet (local keypair)
async function createWallet() {
    try {
        showStatus('Generating local wallet...', 'info');

        wallet = Keypair.generate();
        walletType = 'local';

        // Save to localStorage
        localStorage.setItem('trader_wallet', JSON.stringify(Array.from(wallet.secretKey)));
        localStorage.setItem('walletType', 'local');

        // Request SOL airdrop for transaction fees
        showStatus('Requesting SOL airdrop for gas fees...', 'info');
        const airdropSignature = await connection.requestAirdrop(
            wallet.publicKey,
            2 * LAMPORTS_PER_SOL
        );
        await connection.confirmTransaction(airdropSignature);

        // Airdrop 1000 SOL for testing
        await airdropSOL();

        showStatus('Local wallet created successfully!', 'success');
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
            walletType = 'local';
            showStatus('Loaded local wallet from browser cache', 'success');
            updateWalletUI();
            updateBalances();
        }
    } catch (error) {
        console.error('Error loading wallet:', error);
    }
}

// Modal functions
function openWalletModal() {
    document.getElementById('walletModal').classList.add('active');
}

function closeWalletModal() {
    document.getElementById('walletModal').classList.remove('active');
}

function closeWalletModalOnOverlay(event) {
    if (event.target.id === 'walletModal') {
        closeWalletModal();
    }
}

// Connect wallet and close modal
async function connectPhantomAndClose() {
    closeWalletModal();
    await connectPhantom();
}

async function connectBackpackAndClose() {
    closeWalletModal();
    await connectBackpack();
}

async function connectX1AndClose() {
    closeWalletModal();
    await connectX1();
}

async function createWalletAndClose() {
    closeWalletModal();
    await createWallet();
}

// Update wallet UI
function updateWalletUI() {
    const walletNameMap = {
        'phantom': 'Phantom',
        'backpack': 'Backpack',
        'x1': 'X1',
        'local': 'Local'
    };

    if (!wallet) {
        // Show connect button
        document.getElementById('connectWalletBtn').style.display = 'block';
        document.getElementById('walletConnectedDisplay').style.display = 'none';

        // Show "no wallet" message in panel
        document.getElementById('noWallet').style.display = 'block';
        document.getElementById('hasWallet').style.display = 'none';
        document.getElementById('swapBtn').disabled = true;
    } else {
        // Hide connect button, show wallet info
        document.getElementById('connectWalletBtn').style.display = 'none';
        document.getElementById('walletConnectedDisplay').style.display = 'flex';

        const name = walletNameMap[walletType] || 'Wallet';
        const address = wallet.publicKey.toString();
        const shortAddress = address.slice(0, 4) + '...' + address.slice(-4);

        // Update header wallet display
        document.getElementById('headerWalletType').textContent = name;
        document.getElementById('headerWalletAddress').textContent = shortAddress;

        // Show balance/position panel
        document.getElementById('noWallet').style.display = 'none';
        document.getElementById('hasWallet').style.display = 'block';
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
        // IMPORTANT: Real USDC in token account is e6 (6 decimals)
        try {
            const realResponse = await fetch('http://localhost:3030/api/pool-real-reserves');
            const realData = await realResponse.json();
            if (realData && realData.realUsdc !== undefined) {
                const realUsdc = Number(realData.realUsdc) / 1e6; // e6 USDC format
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

        // Fetch ceiling reserve XNT balance from pool struct (not hardcoded)
        try {
            // Get ceiling reserve address from pool data
            const ceilingReserveXnt = new PublicKey(data.slice(219, 251)); // ceiling_reserve_xnt at offset 219
            const ceilingReserveInfo = await connection.getTokenAccountBalance(ceilingReserveXnt);
            const ceilingReserveBalance = parseInt(ceilingReserveInfo.value.amount) / 1e9;
            document.getElementById('ceilingReserveXnt').textContent = ceilingReserveBalance.toLocaleString(undefined, { maximumFractionDigits: 3 });
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
        // IMPORTANT: USDC balance is e6 (6 decimals), SOL is e9 (9 decimals)
        document.getElementById('usdcBalance').textContent = (usdcBalance / 1e6).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2});
        document.getElementById('solBalance').textContent = (solBalance / 1e9).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2});

        // Update position summary (only if poolData is available)
        if (poolData && poolData.price) {
            const xntValueUSDC = (xntBalance / 1e9) * poolData.price;
            const solValueUSDC = (solBalance / 1e9) * poolData.price; // 1 SOL = 1 XNT = poolData.price USDC
            const usdcValue = usdcBalance / 1e6; // IMPORTANT: USDC is e6 (6 decimals)
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

            // Calculate minimum output with slippage tolerance
            const minUsdcOut = usdcOut_scaled * (1 - slippageTolerance / 100);

            document.getElementById('quoteReceive').textContent = usdcOut_scaled.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2});
            document.getElementById('quotePrice').textContent = '$' + effectivePrice.toFixed(6);
            document.getElementById('quotePriceImpact').textContent = (priceImpact >= 0 ? '+' : '') + priceImpact.toFixed(2) + '%';
            document.getElementById('quoteNewPrice').textContent = '$' + newPrice.toFixed(6);
            document.getElementById('quoteMinOutput').textContent = minUsdcOut.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2}) + ' USDC';
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

            // Calculate minimum output with slippage tolerance
            const minXntOut = xntOut_scaled * (1 - slippageTolerance / 100);

            document.getElementById('quoteReceive').textContent = xntOut_scaled.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2});
            document.getElementById('quotePrice').textContent = '$' + effectivePrice2.toFixed(6);
            document.getElementById('quotePriceImpact').textContent = (priceImpact2 >= 0 ? '+' : '') + priceImpact2.toFixed(2) + '%';
            document.getElementById('quoteNewPrice').textContent = '$' + newPrice2.toFixed(6);
            document.getElementById('quoteMinOutput').textContent = minXntOut.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2}) + ' XNT';
            break;
    }
}

// Set amount
function setAmount(amount) {
    document.getElementById('tradeAmount').value = amount;
    updateQuote();
}

// Set slippage tolerance
function setSlippage(percentage) {
    slippageTolerance = percentage;
    document.getElementById('customSlippage').value = percentage;

    // Update button highlights
    ['0.5', '1', '2'].forEach(val => {
        const btn = document.getElementById(`slippage-${val}`);
        if (btn) {
            if (parseFloat(val) === percentage) {
                btn.style.background = 'rgba(91, 158, 255, 0.15)';
                btn.style.borderColor = 'rgba(91, 158, 255, 0.3)';
                btn.style.color = '#5b9eff';
            } else {
                btn.style.background = 'transparent';
                btn.style.borderColor = 'rgba(139, 146, 168, 0.2)';
                btn.style.color = '#8b92a8';
            }
        }
    });

    // Update quote to reflect new slippage
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

    // Convert to atomic units: USDC is e6 (6 decimals)
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

    // Amount is in XNT (wSOL): e9 (9 decimals)
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

        // Calculate minimum USDC output with slippage protection
        const xntIn_scaled = solAmount;
        const xntReserve_s = poolData.xntReserve / 1e9;
        const usdcReserve_s = poolData.usdcReserve / 1e9;
        const k_scaled = xntReserve_s * usdcReserve_s;
        const newXntReserve_s = xntReserve_s + xntIn_scaled;
        const newUsdcReserve_s = k_scaled / newXntReserve_s;
        const usdcOut_scaled = usdcReserve_s - newUsdcReserve_s;
        const minUsdcOut = usdcOut_scaled * (1 - slippageTolerance / 100);
        const minUsdcOutWithDecimals = Math.floor(minUsdcOut * 1e6);
        const xntWithDecimals = Math.floor(solAmount * 1e9);

        // For extension wallets, use direct transaction building
        if (walletType !== 'local') {
            showStatus(`Preparing sell transaction (slippage: ${slippageTolerance}%)...`, 'info');
            addLog(`Selling ${solAmount} wSOL for USDC (min output: ${minUsdcOut.toFixed(2)} USDC)...`, 'info');

            // Get pool data
            const poolAddress = new PublicKey(CONFIG.POOL_ADDRESS);
            const programId = new PublicKey(CONFIG.PROGRAM_ID);
            const poolAccountInfo = await connection.getAccountInfo(poolAddress);
            const poolData_raw = poolAccountInfo.data;

            const xntMint = new PublicKey(poolData_raw.slice(40, 72));
            const usdcMint = new PublicKey(poolData_raw.slice(72, 104));
            const poolXnt = new PublicKey(poolData_raw.slice(104, 136));
            const poolUsdc = new PublicKey(poolData_raw.slice(136, 168));
            const ceilingReserveXnt = new PublicKey(poolData_raw.slice(219, 251));

            // Get user token accounts
            const userXnt = await getAssociatedTokenAddress(xntMint, wallet.publicKey);
            const userUsdc = await getAssociatedTokenAddress(usdcMint, wallet.publicKey);

            // Build sell instruction
            const discriminator = Buffer.from([51, 230, 133, 164, 1, 127, 131, 173]);
            const amountBuffer = Buffer.alloc(8);
            amountBuffer.writeBigUInt64LE(BigInt(xntWithDecimals), 0);
            const minUsdcOutBuffer = Buffer.alloc(8);
            minUsdcOutBuffer.writeBigUInt64LE(BigInt(minUsdcOutWithDecimals), 0);
            const data = Buffer.concat([discriminator, amountBuffer, minUsdcOutBuffer]);

            const sellIx = new solanaWeb3.TransactionInstruction({
                programId,
                keys: [
                    { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
                    { pubkey: poolAddress, isSigner: false, isWritable: true },
                    { pubkey: poolXnt, isSigner: false, isWritable: true },
                    { pubkey: poolUsdc, isSigner: false, isWritable: true },
                    { pubkey: userXnt, isSigner: false, isWritable: true },
                    { pubkey: userUsdc, isSigner: false, isWritable: true },
                    { pubkey: ceilingReserveXnt, isSigner: false, isWritable: true },
                    { pubkey: new PublicKey(CONFIG.TOKEN_PROGRAM_ID), isSigner: false, isWritable: false },
                ],
                data,
            });

            const tx = new solanaWeb3.Transaction().add(sellIx);
            const signature = await signAndSendTransaction(tx);

            addLog(`✓ Sell successful! TX: ${signature.substring(0, 20)}...`, 'success');
            showStatus(`✅ Trade successful! View on explorer: https://explorer.solana.com/tx/${signature}?cluster=custom&customUrl=http://localhost:8899`, 'success');
        } else {
            // Local wallet: use API endpoint
            showStatus(`Selling ${solAmount} wSOL for USDC (slippage: ${slippageTolerance}%)...`, 'info');
            addLog(`Selling ${solAmount} wSOL for USDC (min output: ${minUsdcOut.toFixed(2)} USDC)...`, 'info');
            const sellResponse = await fetch('/api/sell', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    amount: xntWithDecimals,
                    minUsdcOut: minUsdcOutWithDecimals
                })
            });
            const sellResult = await sellResponse.json();
            if (!sellResult.success) throw new Error('Sell failed: ' + sellResult.error);

            addLog(`✓ Sold ${solAmount} wSOL for USDC! TX: ${sellResult.tx.substring(0, 20)}...`, 'success');
            showStatus(`✅ Trade successful!`, 'success');
        }

        await updatePrice();
        await updateBalances();
    } catch (error) {
        showStatus('❌ Error: ' + error.message, 'error');
        console.error('Sell error:', error);
    } finally {
        document.getElementById('swapBtn').disabled = false;
    }
}

// Helper: Sign and send transaction
async function signAndSendTransaction(transaction) {
    if (walletType === 'local') {
        // Local wallet: sign and send using connection
        const signature = await connection.sendTransaction(transaction, [wallet], { skipPreflight: false });
        await connection.confirmTransaction(signature, 'confirmed');
        return signature;
    } else {
        // Extension wallet: use wallet adapter
        const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
        transaction.recentBlockhash = blockhash;
        transaction.feePayer = wallet.publicKey;

        // Sign transaction
        const signed = await wallet.signTransaction(transaction);

        // Send raw transaction
        const signature = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: false });
        await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed');
        return signature;
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

        // Calculate minimum XNT output with slippage protection
        const usdcIn_scaled = usdcAmount;
        const xntReserve_scaled = poolData.xntReserve / 1e9;
        const usdcReserve_scaled = poolData.usdcReserve / 1e9;
        const k2_scaled = xntReserve_scaled * usdcReserve_scaled;
        const newUsdcReserve_scaled = usdcReserve_scaled + usdcIn_scaled;
        const newXntReserve_scaled = k2_scaled / newUsdcReserve_scaled;
        const xntOut_scaled = xntReserve_scaled - newXntReserve_scaled;
        const minXntOut = xntOut_scaled * (1 - slippageTolerance / 100);
        const minXntOutWithDecimals = Math.floor(minXntOut * 1e9);

        // For extension wallets, use direct transaction building
        if (walletType !== 'local') {
            showStatus(`Preparing buy transaction (slippage: ${slippageTolerance}%)...`, 'info');
            addLog(`Buying XNT (wSOL) with ${usdcAmount} USDC (min output: ${minXntOut.toFixed(2)} XNT)...`, 'info');

            // Build transaction using the program
            const usdcWithDecimals = Math.floor(usdcAmount * 1e6);

            // Get pool data
            const poolAddress = new PublicKey(CONFIG.POOL_ADDRESS);
            const programId = new PublicKey(CONFIG.PROGRAM_ID);
            const poolAccountInfo = await connection.getAccountInfo(poolAddress);
            const poolData_raw = poolAccountInfo.data;

            const xntMint = new PublicKey(poolData_raw.slice(40, 72));
            const usdcMint = new PublicKey(poolData_raw.slice(72, 104));
            const poolXnt = new PublicKey(poolData_raw.slice(104, 136));
            const poolUsdc = new PublicKey(poolData_raw.slice(136, 168));
            const ceilingReserveXnt = new PublicKey(poolData_raw.slice(219, 251));

            // Get user token accounts
            const userXnt = await getAssociatedTokenAddress(xntMint, wallet.publicKey);
            const userUsdc = await getAssociatedTokenAddress(usdcMint, wallet.publicKey);

            // Derive ceiling reserve PDA
            const [ceilingReservePda] = await PublicKey.findProgramAddress(
                [Buffer.from('ceiling_reserve'), poolAddress.toBuffer()],
                programId
            );

            // Build buy instruction
            const discriminator = Buffer.from([102, 6, 61, 18, 1, 218, 235, 234]);
            const amountBuffer = Buffer.alloc(8);
            amountBuffer.writeBigUInt64LE(BigInt(usdcWithDecimals), 0);
            const minXntOutBuffer = Buffer.alloc(8);
            minXntOutBuffer.writeBigUInt64LE(BigInt(minXntOutWithDecimals), 0);
            const data = Buffer.concat([discriminator, amountBuffer, minXntOutBuffer]);

            const buyIx = new solanaWeb3.TransactionInstruction({
                programId,
                keys: [
                    { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
                    { pubkey: poolAddress, isSigner: false, isWritable: true },
                    { pubkey: poolXnt, isSigner: false, isWritable: true },
                    { pubkey: poolUsdc, isSigner: false, isWritable: true },
                    { pubkey: userUsdc, isSigner: false, isWritable: true },
                    { pubkey: userXnt, isSigner: false, isWritable: true },
                    { pubkey: ceilingReservePda, isSigner: false, isWritable: false },
                    { pubkey: ceilingReserveXnt, isSigner: false, isWritable: true },
                    { pubkey: new PublicKey(CONFIG.TOKEN_PROGRAM_ID), isSigner: false, isWritable: false },
                ],
                data,
            });

            const tx = new solanaWeb3.Transaction().add(buyIx);
            const signature = await signAndSendTransaction(tx);

            addLog(`✓ Buy successful! TX: ${signature.substring(0, 20)}...`, 'success');
            showStatus(`✅ Trade successful! View on explorer: https://explorer.solana.com/tx/${signature}?cluster=custom&customUrl=http://localhost:8899`, 'success');
        } else {
            // Local wallet: use API endpoint
            showStatus(`Buying wSOL with ${usdcAmount} USDC (slippage: ${slippageTolerance}%)...`, 'info');
            addLog(`Buying XNT (wSOL) with ${usdcAmount} USDC on AMM (min output: ${minXntOut.toFixed(2)} XNT)...`, 'info');
            const usdcWithDecimals = Math.floor(usdcAmount * 1e6);
            const buyResponse = await fetch('/api/buy', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    amount: usdcWithDecimals,
                    minXntOut: minXntOutWithDecimals
                })
            });
            const buyResult = await buyResponse.json();
            if (!buyResult.success) throw new Error('Buy failed: ' + buyResult.error);

            addLog(`✓ Bought wSOL (XNT). TX: ${buyResult.tx.substring(0, 20)}...`, 'success');
            showStatus(`✅ Trade successful!`, 'success');
        }

        await updatePrice();
        await updateBalances();
    } catch (error) {
        showStatus('❌ Error: ' + error.message, 'error');
        console.error('Buy error:', error);
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

// Toggle ceiling reserve section
function toggleCeilingReserve() {
    const content = document.getElementById('ceilingReserveContent');
    const triangle = document.getElementById('ceilingReserveTriangle');

    if (content.classList.contains('open')) {
        content.classList.remove('open');
        triangle.classList.remove('open');
        triangle.textContent = '▶';
    } else {
        content.classList.add('open');
        triangle.classList.add('open');
        triangle.textContent = '▼';
    }
}

// Expose functions to global scope
window.toggleCeilingReserve = toggleCeilingReserve;
window.openWalletModal = openWalletModal;
window.closeWalletModal = closeWalletModal;
window.closeWalletModalOnOverlay = closeWalletModalOnOverlay;
window.connectPhantomAndClose = connectPhantomAndClose;
window.connectBackpackAndClose = connectBackpackAndClose;
window.connectX1AndClose = connectX1AndClose;
window.createWalletAndClose = createWalletAndClose;
window.createWallet = createWallet;
window.connectPhantom = connectPhantom;
window.connectBackpack = connectBackpack;
window.connectX1 = connectX1;
window.disconnectWallet = disconnectWallet;
window.airdropUSDC = airdropUSDC;
window.setAmount = setAmount;
window.setSlippage = setSlippage;
window.updateQuote = updateQuote;
window.executeBuy = executeBuy;
window.executeSell = executeSell;
window.executeSwap = executeSwap;
window.toggleSwapDirection = toggleSwapDirection;
window.resetTrading = resetTrading;
window.handleTradingModeChange = handleTradingModeChange;
window.clearLog = clearLog;
