use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

declare_id!("2zKpM4k4kp7qRNvBVzkEAAt8DU8t1vpAfzsRagha4NNF");

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
        price_floor_enabled: bool,
        price_ceiling: u64, // Price ceiling in base units (e.g., 2000000 for $2.00 with 6 decimals)
        price_floor: u64,   // Price floor in base units (e.g., 1000000 for $1.00 with 6 decimals)
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
        pool.price_floor_enabled = price_floor_enabled; // Set price floor flag
        pool.bump = ctx.bumps.pool;
        pool.ceiling_reserve_xnt = ctx.accounts.ceiling_reserve_xnt.key();
        pool.price_ceiling = price_ceiling;
        pool.ceiling_reserve_bump = ctx.bumps.ceiling_reserve_pda;
        pool.price_floor = price_floor;
        pool.sol_vault_bump = ctx.bumps.sol_vault;

        msg!("Pool initialized with {} XNT (single-sided)", xnt_amount);
        msg!("Virtual USDC reserve: {} (for price calculation)", virtual_usdc_amount);
        msg!("Starting price: ${}", virtual_usdc_amount / xnt_amount);
        msg!("Price ceiling: ${}", price_ceiling as f64 / 1_000_000.0);
        msg!("Constant k: {}", pool.k);

        Ok(())
    }

    /// Buy XNT with USDC using constant product formula
    /// Price increases as XNT is purchased
    /// Automatically injects XNT from ceiling reserve if price approaches ceiling
    pub fn buy(ctx: Context<Buy>, usdc_amount: u64) -> Result<()> {
        let pool = &mut ctx.accounts.pool;

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

        // Calculate effective price (with proper decimal handling)
        let price_before = pool.usdc_reserve / pool.xnt_reserve;
        // Calculate price_after with 6 decimal precision: (usdc * 1e6) / xnt
        let price_after = ((new_usdc_reserve as u128)
            .checked_mul(1_000_000)
            .ok_or(ErrorCode::MathOverflow)?
            .checked_div(new_xnt_reserve)
            .ok_or(ErrorCode::MathOverflow)?) as u64;
        let effective_price = usdc_amount / xnt_out;

        msg!("Trade #{}: Buying {} XNT for {} USDC", pool.trade_count + 1, xnt_out, usdc_amount);
        msg!("Price before: {}, effective: {}, after: {}", price_before, effective_price, price_after);

        // AUTO-CEILING DEFENSE: If price would exceed ceiling, inject XNT from reserve
        let mut xnt_injected = 0u64;
        if price_after > pool.price_ceiling {
            msg!("⚠️ Price ceiling breach detected! Price would be ${}", price_after as f64 / 1_000_000.0);
            msg!("Ceiling: ${}", pool.price_ceiling as f64 / 1_000_000.0);

            // Calculate how much XNT to inject to bring price back to ceiling
            // Target: new_usdc / (new_xnt + injection) = price_ceiling
            // Solve for injection: injection = (new_usdc / price_ceiling) - new_xnt
            let target_xnt_reserve = (new_usdc_reserve as u128)
                .checked_mul(1_000_000)
                .ok_or(ErrorCode::MathOverflow)?
                .checked_div(pool.price_ceiling as u128)
                .ok_or(ErrorCode::MathOverflow)?;

            xnt_injected = (target_xnt_reserve
                .checked_sub(new_xnt_reserve)
                .ok_or(ErrorCode::MathOverflow)? as u64)
                .saturating_add(1_000_000); // Add 1 XNT buffer

            msg!("💉 Injecting {} XNT from ceiling reserve", xnt_injected);

            // Transfer XNT from ceiling reserve to pool using PDA authority
            let pool_key = pool.key();
            let reserve_seeds = &[
                b"ceiling_reserve",
                pool_key.as_ref(),
                &[pool.ceiling_reserve_bump],
            ];
            let reserve_signer = &[&reserve_seeds[..]];

            let cpi_accounts = Transfer {
                from: ctx.accounts.ceiling_reserve_xnt.to_account_info(),
                to: ctx.accounts.pool_xnt.to_account_info(),
                authority: ctx.accounts.ceiling_reserve_pda.to_account_info(),
            };
            let cpi_program = ctx.accounts.token_program.to_account_info();
            let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, reserve_signer);
            token::transfer(cpi_ctx, xnt_injected)?;

            // Recalculate new state after injection
            let final_xnt_reserve = new_xnt_reserve
                .checked_add(xnt_injected as u128)
                .ok_or(ErrorCode::MathOverflow)?;
            let final_price = new_usdc_reserve as u64 / final_xnt_reserve as u64;

            msg!("✅ Price defended: ${}", final_price as f64 / 1_000_000.0);
            msg!("New XNT reserve: {}", final_xnt_reserve);
        }

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

        // Update pool state (including any ceiling defense injection)
        let final_xnt_reserve = (new_xnt_reserve as u64)
            .checked_add(xnt_injected)
            .ok_or(ErrorCode::MathOverflow)?;

        pool.xnt_reserve = final_xnt_reserve;
        pool.usdc_reserve = new_usdc_reserve as u64;

        // Update k to reflect new reserves after ceiling defense
        pool.k = (final_xnt_reserve as u128)
            .checked_mul(new_usdc_reserve)
            .ok_or(ErrorCode::MathOverflow)?;

        pool.trade_count += 1;

        Ok(())
    }

    /// Sell XNT for USDC using constant product formula
    /// Price decreases as XNT is sold
    pub fn sell(ctx: Context<Sell>, xnt_amount: u64) -> Result<()> {
        let pool = &mut ctx.accounts.pool;

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

        // Calculate effective price (with proper decimal handling)
        let price_before = pool.usdc_reserve / pool.xnt_reserve;
        // Calculate price_after with 6 decimal precision: (usdc * 1e6) / xnt
        let price_after = ((new_usdc_reserve as u128)
            .checked_mul(1_000_000)
            .ok_or(ErrorCode::MathOverflow)?
            .checked_div(new_xnt_reserve)
            .ok_or(ErrorCode::MathOverflow)?) as u64;
        let effective_price = usdc_out / xnt_amount;

        msg!("Trade #{}: Selling {} XNT for {} USDC", pool.trade_count + 1, xnt_amount, usdc_out);
        msg!("Price before: {}, effective: {}, after: {}", price_before, effective_price, price_after);

        // AUTO-FLOOR DEFENSE: If price would fall below floor, remove XNT from pool and deposit to reserve
        let mut xnt_removed = 0u64;
        if price_after < pool.price_floor {
            msg!("⚠️ Price floor breach detected! Price would be ${}", price_after as f64 / 1_000_000.0);
            msg!("Floor: ${}", pool.price_floor as f64 / 1_000_000.0);

            // Calculate how much XNT to remove to bring price back to floor
            // Target: new_usdc / (new_xnt - removal) = price_floor
            // Solve for removal: removal = new_xnt - (new_usdc / price_floor)
            let target_xnt_reserve = (new_usdc_reserve as u128)
                .checked_mul(1_000_000)
                .ok_or(ErrorCode::MathOverflow)?
                .checked_div(pool.price_floor as u128)
                .ok_or(ErrorCode::MathOverflow)?;

            xnt_removed = (new_xnt_reserve
                .checked_sub(target_xnt_reserve)
                .ok_or(ErrorCode::MathOverflow)? as u64)
                .saturating_sub(1_000_000); // Subtract 1 XNT buffer to stay slightly above floor

            msg!("💉 Removing {} XNT from pool to ceiling reserve", xnt_removed);

            // Transfer XNT from pool to ceiling reserve using pool PDA authority
            let pool_seeds = &[
                b"pool",
                pool.xnt_mint.as_ref(),
                pool.usdc_mint.as_ref(),
                &[pool.bump],
            ];
            let pool_signer = &[&pool_seeds[..]];

            let cpi_accounts = Transfer {
                from: ctx.accounts.pool_xnt.to_account_info(),
                to: ctx.accounts.ceiling_reserve_xnt.to_account_info(),
                authority: pool.to_account_info(),
            };
            let cpi_program = ctx.accounts.token_program.to_account_info();
            let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, pool_signer);
            token::transfer(cpi_ctx, xnt_removed)?;

            // Recalculate new state after removal
            let final_xnt_reserve = new_xnt_reserve
                .checked_sub(xnt_removed as u128)
                .ok_or(ErrorCode::MathOverflow)?;
            let final_price = ((new_usdc_reserve as u128)
                .checked_mul(1_000_000)
                .ok_or(ErrorCode::MathOverflow)?
                .checked_div(final_xnt_reserve)
                .ok_or(ErrorCode::MathOverflow)?) as u64;

            msg!("✅ Price defended: ${}", final_price as f64 / 1_000_000.0);
            msg!("New XNT reserve: {}", final_xnt_reserve);
        }

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

        // Update pool state (accounting for XNT removal if floor defense triggered)
        let final_xnt_reserve = (new_xnt_reserve as u64)
            .checked_sub(xnt_removed)
            .ok_or(ErrorCode::MathOverflow)?;
        pool.xnt_reserve = final_xnt_reserve;
        pool.usdc_reserve = new_usdc_reserve as u64;
        pool.k = (final_xnt_reserve as u128).checked_mul(new_usdc_reserve).ok_or(ErrorCode::MathOverflow)?;
        pool.trade_count += 1;

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

        // Check that price won't drop below $1.00 (if floor enabled)
        // Price = USDC / XNT, so for price >= 1.0, USDC >= XNT
        if pool.price_floor_enabled {
            require!(
                pool.usdc_reserve >= new_xnt_reserve,
                ErrorCode::PriceBelowMinimum
            );
        }

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

    /// Fund the ceiling reserve with XNT (authority only)
    /// This XNT will be automatically injected when price approaches ceiling during buy trades
    pub fn fund_ceiling_reserve(
        ctx: Context<FundCeilingReserve>,
        xnt_amount: u64,
    ) -> Result<()> {
        let pool = &ctx.accounts.pool;

        require!(
            ctx.accounts.authority.key() == pool.authority,
            ErrorCode::Unauthorized
        );

        msg!("💰 Funding ceiling reserve with {} XNT", xnt_amount);

        // Transfer XNT from authority to ceiling reserve
        let cpi_accounts = Transfer {
            from: ctx.accounts.authority_xnt.to_account_info(),
            to: ctx.accounts.ceiling_reserve_xnt.to_account_info(),
            authority: ctx.accounts.authority.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        token::transfer(cpi_ctx, xnt_amount)?;

        msg!("✅ Ceiling reserve funded successfully");

        Ok(())
    }

    /// Withdraw XNT from the ceiling reserve (authority only)
    /// Allows authority to remove XNT from the reserve for rebalancing or emergency purposes
    pub fn withdraw_from_ceiling_reserve(
        ctx: Context<WithdrawFromCeilingReserve>,
        xnt_amount: u64,
    ) -> Result<()> {
        let pool = &ctx.accounts.pool;

        require!(
            ctx.accounts.authority.key() == pool.authority,
            ErrorCode::Unauthorized
        );

        msg!("💸 Withdrawing {} XNT from ceiling reserve", xnt_amount);

        // Transfer XNT from ceiling reserve to authority using PDA signer
        let pool_key = pool.key();
        let seeds = &[
            b"ceiling_reserve",
            pool_key.as_ref(),
            &[pool.ceiling_reserve_bump],
        ];
        let signer = &[&seeds[..]];

        let cpi_accounts = Transfer {
            from: ctx.accounts.ceiling_reserve_xnt.to_account_info(),
            to: ctx.accounts.authority_xnt.to_account_info(),
            authority: ctx.accounts.ceiling_reserve_pda.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);
        token::transfer(cpi_ctx, xnt_amount)?;

        msg!("✅ Withdrawal from ceiling reserve successful");

        Ok(())
    }

    /// Withdraw XNT from the pool (authority only)
    /// Decreases XNT supply which INCREASES price
    pub fn withdraw_xnt(ctx: Context<WithdrawXnt>, xnt_amount: u64) -> Result<()> {
        let pool = &mut ctx.accounts.pool;

        require!(
            ctx.accounts.authority.key() == pool.authority,
            ErrorCode::Unauthorized
        );

        require!(
            pool.xnt_reserve >= xnt_amount,
            ErrorCode::InsufficientLiquidity
        );

        let new_xnt_reserve = pool.xnt_reserve
            .checked_sub(xnt_amount)
            .ok_or(ErrorCode::MathOverflow)?;

        require!(new_xnt_reserve > 0, ErrorCode::InsufficientLiquidity);

        let new_k = (new_xnt_reserve as u128)
            .checked_mul(pool.usdc_reserve as u128)
            .ok_or(ErrorCode::MathOverflow)?;

        msg!("Withdrawing {} XNT from pool", xnt_amount);
        msg!("Price increases: {} -> {}",
            pool.usdc_reserve / pool.xnt_reserve,
            pool.usdc_reserve / new_xnt_reserve);

        // Transfer XNT from pool to authority using PDA authority
        let seeds = &[
            b"pool",
            pool.xnt_mint.as_ref(),
            pool.usdc_mint.as_ref(),
            &[pool.bump],
        ];
        let signer = &[&seeds[..]];

        let cpi_accounts = Transfer {
            from: ctx.accounts.pool_xnt.to_account_info(),
            to: ctx.accounts.authority_xnt.to_account_info(),
            authority: pool.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);
        token::transfer(cpi_ctx, xnt_amount)?;

        pool.xnt_reserve = new_xnt_reserve;
        pool.k = new_k;

        Ok(())
    }

    /// Withdraw XNT and proportional virtual USDC (price-neutral withdrawal)
    /// Keeps price unchanged while reducing pool size
    pub fn withdraw_xnt_price_neutral(
        ctx: Context<WithdrawXnt>,
        xnt_amount: u64,
    ) -> Result<()> {
        let pool = &mut ctx.accounts.pool;

        require!(
            ctx.accounts.authority.key() == pool.authority,
            ErrorCode::Unauthorized
        );

        require!(
            pool.xnt_reserve >= xnt_amount,
            ErrorCode::InsufficientLiquidity
        );

        // Calculate proportional virtual USDC to remove to maintain price
        // virtual_usdc_to_remove = (usdc_reserve × xnt_amount) / xnt_reserve
        let virtual_usdc_to_remove = (pool.usdc_reserve as u128)
            .checked_mul(xnt_amount as u128)
            .ok_or(ErrorCode::MathOverflow)?
            .checked_div(pool.xnt_reserve as u128)
            .ok_or(ErrorCode::MathOverflow)? as u64;

        let new_xnt_reserve = pool.xnt_reserve
            .checked_sub(xnt_amount)
            .ok_or(ErrorCode::MathOverflow)?;
        let new_usdc_reserve = pool.usdc_reserve
            .checked_sub(virtual_usdc_to_remove)
            .ok_or(ErrorCode::MathOverflow)?;

        require!(new_xnt_reserve > 0, ErrorCode::InsufficientLiquidity);
        require!(new_usdc_reserve > 0, ErrorCode::InsufficientLiquidity);

        let new_k = (new_xnt_reserve as u128)
            .checked_mul(new_usdc_reserve as u128)
            .ok_or(ErrorCode::MathOverflow)?;

        let price_before = pool.usdc_reserve / pool.xnt_reserve;
        let price_after = new_usdc_reserve / new_xnt_reserve;

        msg!("Withdrawing {} XNT + {} virtual USDC (price-neutral)", xnt_amount, virtual_usdc_to_remove);
        msg!("Price maintained at ${}", price_before);

        // Transfer XNT from pool to authority using PDA authority
        let seeds = &[
            b"pool",
            pool.xnt_mint.as_ref(),
            pool.usdc_mint.as_ref(),
            &[pool.bump],
        ];
        let signer = &[&seeds[..]];

        let cpi_accounts = Transfer {
            from: ctx.accounts.pool_xnt.to_account_info(),
            to: ctx.accounts.authority_xnt.to_account_info(),
            authority: pool.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);
        token::transfer(cpi_ctx, xnt_amount)?;

        pool.xnt_reserve = new_xnt_reserve;
        pool.usdc_reserve = new_usdc_reserve;
        pool.k = new_k;

        msg!("Price after: ${} (unchanged)", price_after);

        Ok(())
    }

    /// Withdraw USDC profits from pool (authority only)
    /// Withdraws REAL USDC without changing virtual reserves or pricing
    pub fn withdraw_usdc(ctx: Context<WithdrawUsdc>, usdc_amount: u64) -> Result<()> {
        let pool = &mut ctx.accounts.pool;

        require!(
            ctx.accounts.authority.key() == pool.authority,
            ErrorCode::Unauthorized
        );

        // Check REAL USDC balance (not virtual reserve)
        let real_usdc = ctx.accounts.pool_usdc.amount;
        require!(real_usdc >= usdc_amount, ErrorCode::InsufficientLiquidity);

        msg!("Withdrawing {} USDC from pool", usdc_amount);

        // Transfer USDC from pool to authority
        let seeds = &[
            b"pool",
            pool.xnt_mint.as_ref(),
            pool.usdc_mint.as_ref(),
            &[pool.bump],
        ];
        let signer = &[&seeds[..]];

        let cpi_accounts = Transfer {
            from: ctx.accounts.pool_usdc.to_account_info(),
            to: ctx.accounts.authority_usdc.to_account_info(),
            authority: pool.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            cpi_accounts,
            signer
        );
        token::transfer(cpi_ctx, usdc_amount)?;

        // DO NOT update pool.usdc_reserve - keep virtual for pricing

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

    /// Wrap native SOL into XNT tokens
    /// User sends SOL, receives XNT at 1:1 ratio (1 SOL = 1 XNT)
    pub fn wrap_sol(ctx: Context<WrapSol>, sol_amount: u64) -> Result<()> {
        let pool = &ctx.accounts.pool;

        msg!("Wrapping {} SOL into XNT", sol_amount as f64 / 1_000_000_000.0);

        // Transfer SOL from user to SOL vault (PDA)
        let ix = anchor_lang::solana_program::system_instruction::transfer(
            &ctx.accounts.user.key(),
            &ctx.accounts.sol_vault.key(),
            sol_amount,
        );
        anchor_lang::solana_program::program::invoke(
            &ix,
            &[
                ctx.accounts.user.to_account_info(),
                ctx.accounts.sol_vault.to_account_info(),
            ],
        )?;

        // Calculate XNT to mint (1:1 ratio with SOL)
        // 1 SOL (9 decimals) = 1 XNT (6 decimals)
        // So: xnt_amount = sol_amount / 1000 (convert 9 decimals to 6 decimals)
        let xnt_amount = sol_amount
            .checked_div(1_000)
            .ok_or(ErrorCode::MathOverflow)?;

        msg!("Minting {} XNT", xnt_amount as f64 / 1_000_000.0);

        // Transfer XNT from pool to user using PDA authority
        let seeds = &[
            b"pool",
            pool.xnt_mint.as_ref(),
            pool.usdc_mint.as_ref(),
            &[pool.bump],
        ];
        let signer = &[&seeds[..]];

        let cpi_accounts = Transfer {
            from: ctx.accounts.pool_xnt.to_account_info(),
            to: ctx.accounts.user_xnt.to_account_info(),
            authority: pool.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);
        token::transfer(cpi_ctx, xnt_amount)?;

        msg!("✅ Wrapped {} SOL into {} XNT", sol_amount as f64 / 1_000_000_000.0, xnt_amount as f64 / 1_000_000.0);

        Ok(())
    }

    /// Unwrap XNT tokens back to native SOL
    /// User sends XNT, receives SOL at 1:1 ratio (1 XNT = 1 SOL)
    pub fn unwrap_sol(ctx: Context<UnwrapSol>, xnt_amount: u64) -> Result<()> {
        let pool = &ctx.accounts.pool;

        msg!("Unwrapping {} XNT into SOL", xnt_amount as f64 / 1_000_000.0);

        // Transfer XNT from user to pool
        let cpi_accounts = Transfer {
            from: ctx.accounts.user_xnt.to_account_info(),
            to: ctx.accounts.pool_xnt.to_account_info(),
            authority: ctx.accounts.user.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        token::transfer(cpi_ctx, xnt_amount)?;

        // Calculate SOL to return (1:1 ratio with XNT)
        // 1 XNT (6 decimals) = 1 SOL (9 decimals)
        // So: sol_amount = xnt_amount * 1000 (convert 6 decimals to 9 decimals)
        let sol_amount = xnt_amount
            .checked_mul(1_000)
            .ok_or(ErrorCode::MathOverflow)?;

        msg!("Returning {} SOL", sol_amount as f64 / 1_000_000_000.0);

        // Transfer SOL from vault to user
        **ctx.accounts.sol_vault.to_account_info().try_borrow_mut_lamports()? -= sol_amount;
        **ctx.accounts.user.to_account_info().try_borrow_mut_lamports()? += sol_amount;

        msg!("✅ Unwrapped {} XNT into {} SOL", xnt_amount as f64 / 1_000_000.0, sol_amount as f64 / 1_000_000_000.0);

        Ok(())
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

// Graduation logic REMOVED for price corridor bot strategy
// The is_graduated field is kept in Pool struct to maintain compatibility
// but is no longer used. Continuous trading is now enabled with price management
// through withdraw_xnt and deposit_xnt instructions.

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

    /// Ceiling reserve PDA (authority for ceiling_reserve_xnt)
    #[account(
        seeds = [b"ceiling_reserve", pool.key().as_ref()],
        bump
    )]
    /// CHECK: PDA used as authority for ceiling reserve token account
    pub ceiling_reserve_pda: AccountInfo<'info>,

    /// Ceiling reserve XNT token account (PDA-owned)
    #[account(
        init,
        payer = initializer,
        token::mint = xnt_mint,
        token::authority = ceiling_reserve_pda,
    )]
    pub ceiling_reserve_xnt: Account<'info, TokenAccount>,

    /// SOL vault PDA (for wrapping/unwrapping SOL)
    #[account(
        seeds = [b"sol_vault", pool.key().as_ref()],
        bump
    )]
    /// CHECK: PDA vault for holding native SOL
    pub sol_vault: AccountInfo<'info>,

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

    /// Ceiling reserve PDA (authority for ceiling_reserve_xnt)
    #[account(
        seeds = [b"ceiling_reserve", pool.key().as_ref()],
        bump = pool.ceiling_reserve_bump
    )]
    /// CHECK: PDA used as authority for ceiling reserve token account
    pub ceiling_reserve_pda: AccountInfo<'info>,

    /// Ceiling reserve XNT token account
    #[account(
        mut,
        constraint = ceiling_reserve_xnt.key() == pool.ceiling_reserve_xnt
    )]
    pub ceiling_reserve_xnt: Account<'info, TokenAccount>,

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

    /// Ceiling reserve XNT account (for floor defense)
    #[account(
        mut,
        constraint = ceiling_reserve_xnt.key() == pool.ceiling_reserve_xnt
    )]
    pub ceiling_reserve_xnt: Account<'info, TokenAccount>,

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
pub struct FundCeilingReserve<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        seeds = [b"pool", pool.xnt_mint.as_ref(), pool.usdc_mint.as_ref()],
        bump = pool.bump,
    )]
    pub pool: Account<'info, Pool>,

    /// Authority's XNT token account (source)
    #[account(mut)]
    pub authority_xnt: Account<'info, TokenAccount>,

    /// Ceiling reserve XNT token account (destination)
    #[account(
        mut,
        constraint = ceiling_reserve_xnt.key() == pool.ceiling_reserve_xnt
    )]
    pub ceiling_reserve_xnt: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct WithdrawFromCeilingReserve<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        seeds = [b"pool", pool.xnt_mint.as_ref(), pool.usdc_mint.as_ref()],
        bump = pool.bump,
    )]
    pub pool: Account<'info, Pool>,

    /// Ceiling reserve PDA (authority for ceiling reserve XNT account)
    #[account(
        seeds = [b"ceiling_reserve", pool.key().as_ref()],
        bump = pool.ceiling_reserve_bump,
    )]
    /// CHECK: PDA signer for ceiling reserve
    pub ceiling_reserve_pda: UncheckedAccount<'info>,

    /// Ceiling reserve XNT token account (source)
    #[account(
        mut,
        constraint = ceiling_reserve_xnt.key() == pool.ceiling_reserve_xnt
    )]
    pub ceiling_reserve_xnt: Account<'info, TokenAccount>,

    /// Authority's XNT token account (destination)
    #[account(mut)]
    pub authority_xnt: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct WithdrawXnt<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [b"pool", pool.xnt_mint.as_ref(), pool.usdc_mint.as_ref()],
        bump = pool.bump,
        constraint = authority.key() == pool.authority @ ErrorCode::Unauthorized
    )]
    pub pool: Account<'info, Pool>,

    #[account(
        mut,
        constraint = pool_xnt.key() == pool.pool_xnt
    )]
    pub pool_xnt: Account<'info, TokenAccount>,

    #[account(mut)]
    pub authority_xnt: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct WithdrawUsdc<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [b"pool", pool.xnt_mint.as_ref(), pool.usdc_mint.as_ref()],
        bump = pool.bump,
        constraint = authority.key() == pool.authority @ ErrorCode::Unauthorized
    )]
    pub pool: Account<'info, Pool>,

    #[account(
        mut,
        constraint = pool_usdc.key() == pool.pool_usdc
    )]
    pub pool_usdc: Account<'info, TokenAccount>,

    #[account(mut)]
    pub authority_usdc: Account<'info, TokenAccount>,

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
pub struct WrapSol<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        seeds = [b"pool", pool.xnt_mint.as_ref(), pool.usdc_mint.as_ref()],
        bump = pool.bump
    )]
    pub pool: Account<'info, Pool>,

    /// SOL vault PDA (holds wrapped SOL)
    #[account(
        mut,
        seeds = [b"sol_vault", pool.key().as_ref()],
        bump = pool.sol_vault_bump
    )]
    /// CHECK: PDA vault for holding native SOL
    pub sol_vault: AccountInfo<'info>,

    /// Pool's XNT token account
    #[account(
        mut,
        constraint = pool_xnt.key() == pool.pool_xnt
    )]
    pub pool_xnt: Account<'info, TokenAccount>,

    /// User's XNT token account (destination)
    #[account(mut)]
    pub user_xnt: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UnwrapSol<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        seeds = [b"pool", pool.xnt_mint.as_ref(), pool.usdc_mint.as_ref()],
        bump = pool.bump
    )]
    pub pool: Account<'info, Pool>,

    /// SOL vault PDA (holds wrapped SOL)
    #[account(
        mut,
        seeds = [b"sol_vault", pool.key().as_ref()],
        bump = pool.sol_vault_bump
    )]
    /// CHECK: PDA vault for holding native SOL
    pub sol_vault: AccountInfo<'info>,

    /// Pool's XNT token account
    #[account(
        mut,
        constraint = pool_xnt.key() == pool.pool_xnt
    )]
    pub pool_xnt: Account<'info, TokenAccount>,

    /// User's XNT token account (source)
    #[account(mut)]
    pub user_xnt: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
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
    pub is_graduated: bool,   // DEPRECATED: Kept for compatibility, not used in price corridor strategy
    pub price_floor_enabled: bool, // Enable/disable $1.00 price floor protection
    pub bump: u8,
    pub ceiling_reserve_xnt: Pubkey, // PDA-owned XNT reserve for automatic ceiling defense
    pub price_ceiling: u64,   // Price threshold in USDC per XNT (e.g., 2000000 for $2.00)
    pub ceiling_reserve_bump: u8, // Bump for ceiling reserve PDA
    pub price_floor: u64,     // Price floor in USDC per XNT (e.g., 1000000 for $1.00)
    pub sol_vault_bump: u8,   // Bump for SOL vault PDA
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
