use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

declare_id!("6BYYf2Mn2S33rqvbthZMMiJ5KF3NJABNpsboCmH7wXRT");

#[program]
pub mod bonding_curve {
    use super::*;

    /// Initialize a bonding curve pool with single-sided XNT liquidity
    /// Uses constant product formula: x * y = k
    /// Virtual USDC sets initial price without requiring real USDC deposit
    pub fn initialize_pool(
        ctx: Context<InitializePool>,
        xnt_amount: u64,
        virtual_usdc_amount: u64,
    ) -> Result<()> {
        let pool = &mut ctx.accounts.pool;

        // Transfer XNT tokens from initializer to pool (single-sided deposit)
        let cpi_accounts = Transfer {
            from: ctx.accounts.initializer_xnt.to_account_info(),
            to: ctx.accounts.pool_xnt.to_account_info(),
            authority: ctx.accounts.initializer.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        token::transfer(cpi_ctx, xnt_amount)?;

        // Initialize pool state with virtual USDC reserve
        pool.authority = ctx.accounts.initializer.key();
        pool.xnt_mint = ctx.accounts.xnt_mint.key();
        pool.usdc_mint = ctx.accounts.usdc_mint.key();
        pool.pool_xnt = ctx.accounts.pool_xnt.key();
        pool.pool_usdc = ctx.accounts.pool_usdc.key();
        pool.xnt_reserve = xnt_amount;
        pool.usdc_reserve = virtual_usdc_amount; // Virtual USDC for price bootstrapping
        pool.k = (xnt_amount as u128)
            .checked_mul(virtual_usdc_amount as u128)
            .ok_or(ErrorCode::MathOverflow)?;
        pool.trade_count = 0;
        pool.total_liquidity = 0;
        pool.is_graduated = false; // Trading enabled initially
        pool.bump = ctx.bumps.pool;

        msg!("Pool initialized with {} XNT (single-sided)", xnt_amount);
        msg!("Virtual USDC reserve: {} (for price calculation)", virtual_usdc_amount);
        msg!("Starting price: ${}", virtual_usdc_amount / xnt_amount);
        msg!("Constant k: {}", pool.k);

        Ok(())
    }

    /// Buy XNT with USDC using constant product formula
    /// Price increases as XNT is purchased
    pub fn buy(ctx: Context<Buy>, usdc_amount: u64) -> Result<()> {
        let pool = &mut ctx.accounts.pool;

        // Check if trading is locked (pool graduated)
        require!(!pool.is_graduated, ErrorCode::TradingLocked);

        // Calculate XNT output using constant product formula
        // k = x * y (constant)
        // new_usdc_reserve = usdc_reserve + usdc_amount
        // new_xnt_reserve = k / new_usdc_reserve
        // xnt_out = xnt_reserve - new_xnt_reserve

        let new_usdc_reserve = (pool.usdc_reserve as u128)
            .checked_add(usdc_amount as u128)
            .ok_or(ErrorCode::MathOverflow)?;

        let new_xnt_reserve = pool.k
            .checked_div(new_usdc_reserve)
            .ok_or(ErrorCode::MathOverflow)?;

        require!(
            new_xnt_reserve < pool.xnt_reserve as u128,
            ErrorCode::InsufficientLiquidity
        );

        let xnt_out = (pool.xnt_reserve as u128)
            .checked_sub(new_xnt_reserve)
            .ok_or(ErrorCode::MathOverflow)? as u64;

        require!(xnt_out > 0, ErrorCode::ZeroOutput);

        // Calculate effective price
        let price_before = pool.usdc_reserve / pool.xnt_reserve;
        let price_after = new_usdc_reserve as u64 / new_xnt_reserve as u64;
        let effective_price = usdc_amount / xnt_out;

        msg!("Trade #{}: Buying {} XNT for {} USDC", pool.trade_count + 1, xnt_out, usdc_amount);
        msg!("Price before: {}, effective: {}, after: {}", price_before, effective_price, price_after);

        // Transfer USDC from buyer to pool
        let cpi_accounts = Transfer {
            from: ctx.accounts.buyer_usdc.to_account_info(),
            to: ctx.accounts.pool_usdc.to_account_info(),
            authority: ctx.accounts.buyer.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        token::transfer(cpi_ctx, usdc_amount)?;

        // Transfer XNT from pool to buyer using PDA authority
        let seeds = &[
            b"pool",
            pool.xnt_mint.as_ref(),
            pool.usdc_mint.as_ref(),
            &[pool.bump],
        ];
        let signer = &[&seeds[..]];

        let cpi_accounts = Transfer {
            from: ctx.accounts.pool_xnt.to_account_info(),
            to: ctx.accounts.buyer_xnt.to_account_info(),
            authority: pool.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);
        token::transfer(cpi_ctx, xnt_out)?;

        // Update pool state
        pool.xnt_reserve = new_xnt_reserve as u64;
        pool.usdc_reserve = new_usdc_reserve as u64;
        pool.trade_count += 1;

        // Check if pool has reached graduation
        check_and_update_graduation(pool, &ctx.accounts.pool_xnt, &ctx.accounts.pool_usdc)?;

        Ok(())
    }

    /// Sell XNT for USDC using constant product formula
    /// Price decreases as XNT is sold
    pub fn sell(ctx: Context<Sell>, xnt_amount: u64) -> Result<()> {
        let pool = &mut ctx.accounts.pool;

        // Check if trading is locked (pool graduated)
        require!(!pool.is_graduated, ErrorCode::TradingLocked);

        // Calculate USDC output using constant product formula
        // k = x * y (constant)
        // new_xnt_reserve = xnt_reserve + xnt_amount
        // new_usdc_reserve = k / new_xnt_reserve
        // usdc_out = usdc_reserve - new_usdc_reserve

        let new_xnt_reserve = (pool.xnt_reserve as u128)
            .checked_add(xnt_amount as u128)
            .ok_or(ErrorCode::MathOverflow)?;

        let new_usdc_reserve = pool.k
            .checked_div(new_xnt_reserve)
            .ok_or(ErrorCode::MathOverflow)?;

        require!(
            new_usdc_reserve < pool.usdc_reserve as u128,
            ErrorCode::InsufficientLiquidity
        );

        let usdc_out = (pool.usdc_reserve as u128)
            .checked_sub(new_usdc_reserve)
            .ok_or(ErrorCode::MathOverflow)? as u64;

        require!(usdc_out > 0, ErrorCode::ZeroOutput);

        // Check that price won't drop below $1.00
        // Price = USDC / XNT, so for price >= 1.0, USDC >= XNT
        require!(
            new_usdc_reserve >= new_xnt_reserve,
            ErrorCode::PriceBelowMinimum
        );

        // Calculate effective price
        let price_before = pool.usdc_reserve / pool.xnt_reserve;
        let price_after = new_usdc_reserve as u64 / new_xnt_reserve as u64;
        let effective_price = usdc_out / xnt_amount;

        msg!("Trade #{}: Selling {} XNT for {} USDC", pool.trade_count + 1, xnt_amount, usdc_out);
        msg!("Price before: {}, effective: {}, after: {}", price_before, effective_price, price_after);
        msg!("Price remains above $1.00 minimum");

        // Transfer XNT from seller to pool
        let cpi_accounts = Transfer {
            from: ctx.accounts.seller_xnt.to_account_info(),
            to: ctx.accounts.pool_xnt.to_account_info(),
            authority: ctx.accounts.seller.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        token::transfer(cpi_ctx, xnt_amount)?;

        // Transfer USDC from pool to seller using PDA authority
        let seeds = &[
            b"pool",
            pool.xnt_mint.as_ref(),
            pool.usdc_mint.as_ref(),
            &[pool.bump],
        ];
        let signer = &[&seeds[..]];

        let cpi_accounts = Transfer {
            from: ctx.accounts.pool_usdc.to_account_info(),
            to: ctx.accounts.seller_usdc.to_account_info(),
            authority: pool.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);
        token::transfer(cpi_ctx, usdc_out)?;

        // Update pool state
        pool.xnt_reserve = new_xnt_reserve as u64;
        pool.usdc_reserve = new_usdc_reserve as u64;
        pool.trade_count += 1;

        // Check if pool has reached graduation
        check_and_update_graduation(pool, &ctx.accounts.pool_xnt, &ctx.accounts.pool_usdc)?;

        Ok(())
    }

    /// Deposit XNT to the pool (authority only)
    /// Increases XNT supply which DECREASES price (makes XNT cheaper)
    /// Does not require matching USDC deposit
    pub fn deposit_xnt(ctx: Context<DepositXnt>, xnt_amount: u64) -> Result<()> {
        let pool = &mut ctx.accounts.pool;

        require!(
            ctx.accounts.authority.key() == pool.authority,
            ErrorCode::Unauthorized
        );

        let new_xnt_reserve = (pool.xnt_reserve as u128)
            .checked_add(xnt_amount as u128)
            .ok_or(ErrorCode::MathOverflow)? as u64;

        // Check that price won't drop below $1.00
        // Price = USDC / XNT, so for price >= 1.0, USDC >= XNT
        require!(
            pool.usdc_reserve >= new_xnt_reserve,
            ErrorCode::PriceBelowMinimum
        );

        // USDC reserve stays the same, so price decreases
        // Update constant k with new reserves
        let new_k = (new_xnt_reserve as u128)
            .checked_mul(pool.usdc_reserve as u128)
            .ok_or(ErrorCode::MathOverflow)?;

        let price_before = pool.usdc_reserve / pool.xnt_reserve;
        let price_after = pool.usdc_reserve / new_xnt_reserve;

        msg!("Depositing {} XNT to pool", xnt_amount);
        msg!("Price decreases: {} -> {} (XNT becomes cheaper)", price_before, price_after);
        msg!("Price remains above $1.00 minimum");

        // Transfer XNT from authority to pool
        let cpi_accounts = Transfer {
            from: ctx.accounts.authority_xnt.to_account_info(),
            to: ctx.accounts.pool_xnt.to_account_info(),
            authority: ctx.accounts.authority.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        token::transfer(cpi_ctx, xnt_amount)?;

        // Update pool state
        pool.xnt_reserve = new_xnt_reserve;
        // usdc_reserve stays the same
        pool.k = new_k;

        Ok(())
    }

    /// Deposit XNT with proportional virtual USDC to maintain price
    /// This is PRICE-NEUTRAL - price stays exactly the same
    /// Authority only
    pub fn deposit_xnt_price_neutral(
        ctx: Context<DepositXnt>,
        xnt_amount: u64,
    ) -> Result<()> {
        let pool = &mut ctx.accounts.pool;

        require!(
            ctx.accounts.authority.key() == pool.authority,
            ErrorCode::Unauthorized
        );

        // Calculate proportional virtual USDC to maintain exact same price
        // Current price = usdc_reserve / xnt_reserve
        // To maintain price: new_usdc / new_xnt = usdc / xnt
        // Therefore: new_usdc = (usdc * new_xnt) / xnt
        // virtual_usdc_to_add = new_usdc - usdc = (usdc * xnt_amount) / xnt

        let virtual_usdc_to_add = (pool.usdc_reserve as u128)
            .checked_mul(xnt_amount as u128)
            .ok_or(ErrorCode::MathOverflow)?
            .checked_div(pool.xnt_reserve as u128)
            .ok_or(ErrorCode::MathOverflow)? as u64;

        let price_before = pool.usdc_reserve / pool.xnt_reserve;

        msg!("Depositing {} XNT + {} virtual USDC (price-neutral)", xnt_amount, virtual_usdc_to_add);
        msg!("Price maintained at ${}", price_before);

        // Transfer real XNT from authority to pool
        let cpi_accounts = Transfer {
            from: ctx.accounts.authority_xnt.to_account_info(),
            to: ctx.accounts.pool_xnt.to_account_info(),
            authority: ctx.accounts.authority.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        token::transfer(cpi_ctx, xnt_amount)?;

        // Update reserves proportionally
        let new_xnt_reserve = pool.xnt_reserve
            .checked_add(xnt_amount)
            .ok_or(ErrorCode::MathOverflow)?;
        let new_usdc_reserve = pool.usdc_reserve
            .checked_add(virtual_usdc_to_add)
            .ok_or(ErrorCode::MathOverflow)?;

        // Update constant k
        let new_k = (new_xnt_reserve as u128)
            .checked_mul(new_usdc_reserve as u128)
            .ok_or(ErrorCode::MathOverflow)?;

        pool.xnt_reserve = new_xnt_reserve;
        pool.usdc_reserve = new_usdc_reserve;
        pool.k = new_k;

        let price_after = pool.usdc_reserve / pool.xnt_reserve;
        msg!("Price after: ${} (unchanged)", price_after);

        Ok(())
    }

    /// Get the maximum XNT amount that can be sold without dropping below $1.00
    /// View function - does not modify state
    pub fn get_max_sellable_xnt(ctx: Context<ViewPool>) -> Result<u64> {
        let pool = &ctx.accounts.pool;

        // For price >= $1.00: USDC >= XNT
        // new_price = new_usdc / new_xnt >= 1.0
        // new_usdc / new_xnt >= 1.0
        // new_usdc >= new_xnt

        // Using constant product: k = xnt * usdc
        // new_usdc = k / new_xnt
        // k / new_xnt >= new_xnt
        // k >= new_xnt^2
        // new_xnt <= sqrt(k)

        let max_xnt_reserve = pool.k.integer_sqrt();
        let current_xnt_reserve = pool.xnt_reserve as u128;

        if max_xnt_reserve <= current_xnt_reserve {
            // Already at or below minimum, can't sell
            return Ok(0);
        }

        let max_sellable = (max_xnt_reserve - current_xnt_reserve) as u64;

        Ok(max_sellable)
    }

    /// Add liquidity to the pool (anyone can add proportional liquidity)
    /// Returns LP tokens based on share of pool
    pub fn add_liquidity(
        ctx: Context<AddLiquidity>,
        xnt_amount: u64,
        usdc_amount: u64,
        min_liquidity: u64,
    ) -> Result<()> {
        let pool = &mut ctx.accounts.pool;

        // Calculate expected ratio
        let expected_usdc = (xnt_amount as u128)
            .checked_mul(pool.usdc_reserve as u128)
            .ok_or(ErrorCode::MathOverflow)?
            .checked_div(pool.xnt_reserve as u128)
            .ok_or(ErrorCode::MathOverflow)? as u64;

        // Allow some slippage (1% tolerance)
        let slippage_tolerance = expected_usdc / 100;
        require!(
            usdc_amount >= expected_usdc.saturating_sub(slippage_tolerance)
                && usdc_amount <= expected_usdc.saturating_add(slippage_tolerance),
            ErrorCode::SlippageExceeded
        );

        // Calculate liquidity tokens to mint
        // liquidity = (xnt_amount / xnt_reserve) * total_liquidity
        let liquidity_minted = if pool.total_liquidity == 0 {
            // First liquidity provider gets sqrt(xnt * usdc)
            ((xnt_amount as u128)
                .checked_mul(usdc_amount as u128)
                .ok_or(ErrorCode::MathOverflow)?)
            .integer_sqrt() as u64
        } else {
            (xnt_amount as u128)
                .checked_mul(pool.total_liquidity as u128)
                .ok_or(ErrorCode::MathOverflow)?
                .checked_div(pool.xnt_reserve as u128)
                .ok_or(ErrorCode::MathOverflow)? as u64
        };

        require!(liquidity_minted >= min_liquidity, ErrorCode::InsufficientLiquidityMinted);

        msg!("Adding liquidity: {} XNT + {} USDC", xnt_amount, usdc_amount);
        msg!("Liquidity minted: {}", liquidity_minted);

        // Transfer XNT from LP to pool
        let cpi_accounts = Transfer {
            from: ctx.accounts.lp_xnt.to_account_info(),
            to: ctx.accounts.pool_xnt.to_account_info(),
            authority: ctx.accounts.lp_provider.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        token::transfer(cpi_ctx, xnt_amount)?;

        // Transfer USDC from LP to pool
        let cpi_accounts = Transfer {
            from: ctx.accounts.lp_usdc.to_account_info(),
            to: ctx.accounts.pool_usdc.to_account_info(),
            authority: ctx.accounts.lp_provider.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        token::transfer(cpi_ctx, usdc_amount)?;

        // Update pool state
        let new_xnt_reserve = (pool.xnt_reserve as u128)
            .checked_add(xnt_amount as u128)
            .ok_or(ErrorCode::MathOverflow)? as u64;
        let new_usdc_reserve = (pool.usdc_reserve as u128)
            .checked_add(usdc_amount as u128)
            .ok_or(ErrorCode::MathOverflow)? as u64;
        let new_k = (new_xnt_reserve as u128)
            .checked_mul(new_usdc_reserve as u128)
            .ok_or(ErrorCode::MathOverflow)?;

        pool.xnt_reserve = new_xnt_reserve;
        pool.usdc_reserve = new_usdc_reserve;
        pool.k = new_k;
        pool.total_liquidity = pool.total_liquidity
            .checked_add(liquidity_minted)
            .ok_or(ErrorCode::MathOverflow)?;

        // Update LP position
        let lp_position = &mut ctx.accounts.lp_position;
        if lp_position.pool == Pubkey::default() {
            // First time initialization
            lp_position.pool = pool.key();
            lp_position.owner = ctx.accounts.lp_provider.key();
            lp_position.liquidity = liquidity_minted;
            lp_position.bump = 0; // Will be set correctly by init_if_needed
        } else {
            lp_position.liquidity = lp_position.liquidity
                .checked_add(liquidity_minted)
                .ok_or(ErrorCode::MathOverflow)?;
        }

        Ok(())
    }
}

/// Check if pool has reached graduation (50/50 balance within 3% tolerance)
/// and update is_graduated flag if so
fn check_and_update_graduation(
    pool: &mut Pool,
    pool_xnt_account: &Account<TokenAccount>,
    pool_usdc_account: &Account<TokenAccount>,
) -> Result<()> {
    // Skip if already graduated
    if pool.is_graduated {
        return Ok(());
    }

    // Get real balances
    let real_xnt = pool_xnt_account.amount;
    let real_usdc = pool_usdc_account.amount;

    // Calculate current price
    let current_price = pool.usdc_reserve as f64 / pool.xnt_reserve as f64;

    // Calculate pool value distribution
    let xnt_value_in_usdc = (real_xnt as f64) * current_price;
    let total_pool_value = xnt_value_in_usdc + (real_usdc as f64);

    // Calculate USDC percentage
    let usdc_percentage = (real_usdc as f64 / total_pool_value) * 100.0;

    // Check if within 47-53% range (50% ± 3%)
    if usdc_percentage >= 47.0 && usdc_percentage <= 53.0 {
        pool.is_graduated = true;
        msg!("🎓 POOL GRADUATED! Trading locked.");
        msg!("Balance: {:.1}% USDC / {:.1}% XNT", usdc_percentage, 100.0 - usdc_percentage);
        msg!("Pool can now be migrated to DEX");
    }

    Ok(())
}

#[derive(Accounts)]
pub struct InitializePool<'info> {
    #[account(mut)]
    pub initializer: Signer<'info>,

    #[account(
        init,
        payer = initializer,
        space = 8 + Pool::INIT_SPACE,
        seeds = [b"pool", xnt_mint.key().as_ref(), usdc_mint.key().as_ref()],
        bump
    )]
    pub pool: Account<'info, Pool>,

    /// XNT token mint
    pub xnt_mint: Account<'info, token::Mint>,

    /// USDC token mint
    pub usdc_mint: Account<'info, token::Mint>,

    /// Pool's XNT token account
    #[account(
        init,
        payer = initializer,
        token::mint = xnt_mint,
        token::authority = pool,
    )]
    pub pool_xnt: Account<'info, TokenAccount>,

    /// Pool's USDC token account
    #[account(
        init,
        payer = initializer,
        token::mint = usdc_mint,
        token::authority = pool,
    )]
    pub pool_usdc: Account<'info, TokenAccount>,

    /// Initializer's XNT token account (source for initial XNT)
    #[account(mut)]
    pub initializer_xnt: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Buy<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,

    #[account(
        mut,
        seeds = [b"pool", pool.xnt_mint.as_ref(), pool.usdc_mint.as_ref()],
        bump = pool.bump
    )]
    pub pool: Account<'info, Pool>,

    /// Pool's XNT token account
    #[account(
        mut,
        constraint = pool_xnt.key() == pool.pool_xnt
    )]
    pub pool_xnt: Account<'info, TokenAccount>,

    /// Pool's USDC token account
    #[account(
        mut,
        constraint = pool_usdc.key() == pool.pool_usdc
    )]
    pub pool_usdc: Account<'info, TokenAccount>,

    /// Buyer's USDC token account (source)
    #[account(mut)]
    pub buyer_usdc: Account<'info, TokenAccount>,

    /// Buyer's XNT token account (destination)
    #[account(mut)]
    pub buyer_xnt: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Sell<'info> {
    #[account(mut)]
    pub seller: Signer<'info>,

    #[account(
        mut,
        seeds = [b"pool", pool.xnt_mint.as_ref(), pool.usdc_mint.as_ref()],
        bump = pool.bump
    )]
    pub pool: Account<'info, Pool>,

    /// Pool's XNT token account
    #[account(
        mut,
        constraint = pool_xnt.key() == pool.pool_xnt
    )]
    pub pool_xnt: Account<'info, TokenAccount>,

    /// Pool's USDC token account
    #[account(
        mut,
        constraint = pool_usdc.key() == pool.pool_usdc
    )]
    pub pool_usdc: Account<'info, TokenAccount>,

    /// Seller's XNT token account (source)
    #[account(mut)]
    pub seller_xnt: Account<'info, TokenAccount>,

    /// Seller's USDC token account (destination)
    #[account(mut)]
    pub seller_usdc: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct DepositXnt<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [b"pool", pool.xnt_mint.as_ref(), pool.usdc_mint.as_ref()],
        bump = pool.bump,
        constraint = authority.key() == pool.authority
    )]
    pub pool: Account<'info, Pool>,

    /// Pool's XNT token account
    #[account(
        mut,
        constraint = pool_xnt.key() == pool.pool_xnt
    )]
    pub pool_xnt: Account<'info, TokenAccount>,

    /// Authority's XNT token account
    #[account(mut)]
    pub authority_xnt: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct AddLiquidity<'info> {
    #[account(mut)]
    pub lp_provider: Signer<'info>,

    #[account(
        mut,
        seeds = [b"pool", pool.xnt_mint.as_ref(), pool.usdc_mint.as_ref()],
        bump = pool.bump
    )]
    pub pool: Account<'info, Pool>,

    /// Pool's XNT token account
    #[account(
        mut,
        constraint = pool_xnt.key() == pool.pool_xnt
    )]
    pub pool_xnt: Account<'info, TokenAccount>,

    /// Pool's USDC token account
    #[account(
        mut,
        constraint = pool_usdc.key() == pool.pool_usdc
    )]
    pub pool_usdc: Account<'info, TokenAccount>,

    /// LP's XNT token account
    #[account(mut)]
    pub lp_xnt: Account<'info, TokenAccount>,

    /// LP's USDC token account
    #[account(mut)]
    pub lp_usdc: Account<'info, TokenAccount>,

    /// LP position account
    #[account(
        init_if_needed,
        payer = lp_provider,
        space = 8 + LpPosition::INIT_SPACE,
        seeds = [b"lp_position", pool.key().as_ref(), lp_provider.key().as_ref()],
        bump
    )]
    pub lp_position: Account<'info, LpPosition>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ViewPool<'info> {
    pub pool: Account<'info, Pool>,
}

#[account]
#[derive(InitSpace)]
pub struct Pool {
    pub authority: Pubkey,
    pub xnt_mint: Pubkey,
    pub usdc_mint: Pubkey,
    pub pool_xnt: Pubkey,
    pub pool_usdc: Pubkey,
    pub xnt_reserve: u64,
    pub usdc_reserve: u64,
    pub k: u128,              // Constant product
    pub trade_count: u64,
    pub total_liquidity: u64, // Total LP tokens issued
    pub is_graduated: bool,   // Trading locked when pool reaches 50/50 balance
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct LpPosition {
    pub pool: Pubkey,
    pub owner: Pubkey,
    pub liquidity: u64,
    pub bump: u8,
}

trait IntegerSquareRoot {
    fn integer_sqrt(self) -> Self;
}

impl IntegerSquareRoot for u128 {
    fn integer_sqrt(self) -> Self {
        if self < 2 {
            return self;
        }
        let mut x = self;
        let mut y = (x + 1) / 2;
        while y < x {
            x = y;
            y = (x + self / x) / 2;
        }
        x
    }
}

#[error_code]
pub enum ErrorCode {
    #[msg("Math overflow")]
    MathOverflow,
    #[msg("Insufficient liquidity")]
    InsufficientLiquidity,
    #[msg("Zero output amount")]
    ZeroOutput,
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Slippage tolerance exceeded")]
    SlippageExceeded,
    #[msg("Insufficient liquidity minted")]
    InsufficientLiquidityMinted,
    #[msg("Price would drop below $1.00 minimum")]
    PriceBelowMinimum,
    #[msg("Trading locked: Pool has graduated (reached 50/50 balance)")]
    TradingLocked,
}
