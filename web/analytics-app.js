// Pool Analytics App
// Real-time display of pool reserves and statistics

const { Connection, PublicKey } = solanaWeb3;

// Configuration
const CONFIG = {
    RPC_URL: 'http://localhost:8899',
    POOL_ADDRESS: '41BtpyzrYMGoM3ivFkw5ZiaEurSc4HBW1fdBKzQYuJ63',
    POLL_INTERVAL: 2000, // Update every 2 seconds
};

// Global state
let connection = null;
let updateInterval = null;

// Initialize connection
async function init() {
    try {
        connection = new Connection(CONFIG.RPC_URL, 'confirmed');
        console.log('Connected to Solana RPC');

        // Start updates
        if (!updateInterval) {
            updateInterval = setInterval(updatePoolData, CONFIG.POLL_INTERVAL);
        }

        // Initial update
        await updatePoolData();
    } catch (error) {
        console.error('Error connecting to RPC:', error);
    }
}

// Read u64 from buffer
function readU64(data, offset) {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const low = view.getUint32(offset, true);
    const high = view.getUint32(offset + 4, true);
    return high * 0x100000000 + low;
}

// Update pool data
async function updatePoolData() {
    try {
        const poolAccountInfo = await connection.getAccountInfo(new PublicKey(CONFIG.POOL_ADDRESS));
        if (!poolAccountInfo) {
            console.error('Pool account not found');
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

        // Calculate price
        const price = usdcReserve / xntReserve;

        // Update UI
        updateDisplay(xntReserve, usdcReserve, price);

    } catch (error) {
        console.error('Error updating pool data:', error);
    }
}

// Update display
function updateDisplay(xntReserve, usdcReserve, price) {
    // Format numbers
    const xntFormatted = (xntReserve / 1e6).toLocaleString(undefined, { maximumFractionDigits: 2 });
    const usdcFormatted = (usdcReserve / 1e6).toLocaleString(undefined, { maximumFractionDigits: 2 });
    const priceFormatted = price.toFixed(6);

    // Update main stats
    document.getElementById('currentPrice').textContent = '$' + priceFormatted;
    document.getElementById('usdcReserve').textContent = '$' + usdcFormatted;
    document.getElementById('xntReserve').textContent = xntFormatted;

    // Calculate TVL (Total Value Locked)
    const xntValueUSDC = (xntReserve / 1e6) * price;
    const tvl = (usdcReserve / 1e6) + xntValueUSDC;
    document.getElementById('tvl').textContent = '$' + tvl.toLocaleString(undefined, { maximumFractionDigits: 2 });

    // Update bar chart
    const maxReserve = Math.max(usdcReserve / 1e6, (xntReserve / 1e6) * price);
    const usdcHeight = ((usdcReserve / 1e6) / maxReserve) * 100;
    const xntHeight = (((xntReserve / 1e6) * price) / maxReserve) * 100;

    document.getElementById('usdcBar').style.height = usdcHeight + '%';
    document.getElementById('xntBar').style.height = xntHeight + '%';
    document.getElementById('usdcBarValue').textContent = '$' + (usdcReserve / 1e6).toLocaleString(undefined, { maximumFractionDigits: 0 });
    document.getElementById('xntBarValue').textContent = (xntReserve / 1e6).toLocaleString(undefined, { maximumFractionDigits: 0 }) + ' XNT';

    // Calculate K constant
    const k = xntReserve * usdcReserve;
    const kFormatted = (k / 1e12).toLocaleString(undefined, { maximumFractionDigits: 0 });
    document.getElementById('kConstant').textContent = kFormatted + 'T';

    // Calculate price impact for 10K USDC buy
    const buyAmount = 10000 * 1e6;
    const newUsdcReserve = usdcReserve + buyAmount;
    const newXntReserve = k / newUsdcReserve;
    const newPrice = newUsdcReserve / newXntReserve;
    const priceImpact = ((newPrice / price) - 1) * 100;
    document.getElementById('priceImpact').textContent = (priceImpact >= 0 ? '+' : '') + priceImpact.toFixed(2) + '%';

    // Calculate distance to ceiling/floor
    const ceiling = 2.00;
    const floor = 1.00;
    const priceToCeiling = ((ceiling - price) / price) * 100;
    const priceToFloor = ((price - floor) / price) * 100;

    document.getElementById('priceToCeiling').textContent = (priceToCeiling >= 0 ? '+' : '') + priceToCeiling.toFixed(2) + '%';
    document.getElementById('priceToFloor').textContent = (priceToFloor >= 0 ? '+' : '') + priceToFloor.toFixed(2) + '%';

    // Update price status
    let priceStatus = '✅ Within Range';
    if (price >= 1.90) {
        priceStatus = '⚠️ Approaching Ceiling';
    } else if (price <= 1.10) {
        priceStatus = '⚠️ Approaching Floor';
    }
    document.getElementById('priceStatus').textContent = priceStatus;

    // Update timestamp
    const now = new Date();
    document.getElementById('updateTime').textContent = now.toLocaleTimeString();
}

// Initialize on load
window.addEventListener('load', init);
