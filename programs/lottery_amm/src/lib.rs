use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

declare_id!("C8x5EWRYp1QMESFn3pPeNVEfCD6ecE4iziUbqjw6RNrG");

// Constants for bonding curve math
const PRECISION: u128 = 1_000_000_000; // 1e9
const INITIAL_PRICE: u128 = 1_000_000_000; // Starting price: $1.00

#[program]
pub mod lottery_amm {
    use super::*;

    /// Initialize a new lottery pool
    /// Pool starts at $1.00 and price adjusts based on demand
    pub fn initialize_lottery(
        ctx: Context<InitializeLottery>,
        initial_token_amount: u64,
        registration_duration_slots: u64,
    ) -> Result<()> {
        let pool = &mut ctx.accounts.lottery_pool;
        let clock = Clock::get()?;

        // Simple open-ended bonding curve
        // Total XNT available = initial_token_amount
        // Starting price = $1.00
        // Final price = total_usdc_collected / total_xnt_sold
        pool.liquidity = initial_token_amount as u128; // Store total XNT available
        pool.sqrt_price = INITIAL_PRICE; // Start at $1.00
        pool.token_vault = ctx.accounts.token_vault.key();
        pool.usdc_vault = ctx.accounts.usdc_vault.key();
        pool.authority = ctx.accounts.authority.key();

        // Registration period
        pool.registration_start_slot = clock.slot;
        pool.registration_end_slot = clock.slot + registration_duration_slots;
        pool.settlement_slot = pool.registration_end_slot + 100; // +100 slots for settlement
        pool.status = LotteryStatus::Registration;
        pool.total_participants = 0;
        pool.total_allocated_usdc = 0;
        pool.settlement_blockhash = [0u8; 32];

        // Transfer initial tokens to vault
        let cpi_accounts = Transfer {
            from: ctx.accounts.depositor_token_account.to_account_info(),
            to: ctx.accounts.token_vault.to_account_info(),
            authority: ctx.accounts.authority.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        token::transfer(cpi_ctx, initial_token_amount)?;

        msg!("Lottery pool initialized!");
        msg!("  Token amount: {}", initial_token_amount);
        msg!("  Registration ends at slot: {}", pool.registration_end_slot);
        msg!("  Settlement slot: {}", pool.settlement_slot);

        Ok(())
    }

    /// Register for the lottery
    pub fn register(ctx: Context<Register>, usdc_amount: u64) -> Result<()> {
        let pool = &mut ctx.accounts.lottery_pool;
        let participant = &mut ctx.accounts.participant;
        let clock = Clock::get()?;

        // Check registration is open
        require!(
            pool.status == LotteryStatus::Registration,
            ErrorCode::RegistrationNotOpen
        );
        require!(
            clock.slot >= pool.registration_start_slot && clock.slot <= pool.registration_end_slot,
            ErrorCode::RegistrationPeriodEnded
        );
        require!(usdc_amount > 0, ErrorCode::InvalidAmount);

        // Initialize participant entry
        participant.user = ctx.accounts.user.key();
        participant.requested_usdc = usdc_amount;
        participant.escrowed_usdc = usdc_amount;
        participant.lottery_number = 0;
        participant.allocated_usdc = 0;
        participant.tokens_received = 0;
        participant.claimed = false;
        participant.registration_slot = clock.slot;

        // Transfer USDC to escrow
        let cpi_accounts = Transfer {
            from: ctx.accounts.user_usdc_account.to_account_info(),
            to: ctx.accounts.usdc_vault.to_account_info(),
            authority: ctx.accounts.user.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        token::transfer(cpi_ctx, usdc_amount)?;

        pool.total_participants += 1;

        msg!("User registered!");
        msg!("  User: {}", ctx.accounts.user.key());
        msg!("  Amount: {} USDC", usdc_amount);
        msg!("  Total participants: {}", pool.total_participants);

        Ok(())
    }

    /// Settle the lottery (can be called by anyone after settlement slot)
    /// This calculates the clearing price based on total demand
    pub fn settle(ctx: Context<Settle>) -> Result<()> {
        let pool = &mut ctx.accounts.lottery_pool;
        let clock = Clock::get()?;

        // Check we're past settlement slot
        require!(
            clock.slot >= pool.settlement_slot,
            ErrorCode::SettlementSlotNotReached
        );
        require!(
            pool.status == LotteryStatus::Registration,
            ErrorCode::AlreadySettled
        );

        // Get the blockhash from the settlement slot
        // In practice, you'd use get_block_hash or recent_blockhashes
        // For this implementation, we'll use the current slot's recent blockhash
        let recent_blockhashes = ctx.accounts.recent_blockhashes.to_account_info();
        let blockhash_data = recent_blockhashes.try_borrow_data()?;

        // Use the first 32 bytes as our settlement hash
        if blockhash_data.len() >= 32 {
            pool.settlement_blockhash.copy_from_slice(&blockhash_data[0..32]);
        }

        // PRICE DISCOVERY: Calculate average price based on total USDC collected
        let total_usdc_collected = ctx.accounts.usdc_vault.amount as u128;
        let total_xnt_available = pool.liquidity; // Total XNT in pool

        if total_usdc_collected > 0 && total_xnt_available > 0 {
            // Simple average price: total_usdc / total_xnt
            // Price is stored as value with PRECISION decimals
            let clearing_price = (total_usdc_collected * PRECISION) / total_xnt_available;

            // Store price (we use sqrt_price field for backward compatibility)
            pool.sqrt_price = clearing_price;

            msg!("📊 Price Discovery Complete!");
            msg!("  Total USDC collected: {} (${})", total_usdc_collected, total_usdc_collected / 1_000_000);
            msg!("  Total XNT available: {}", total_xnt_available);
            msg!("  Clearing price: ${}.{:06}",
                clearing_price / PRECISION,
                clearing_price % PRECISION / 1_000
            );
            msg!("  Everyone pays the same price - fair distribution!");
        } else {
            msg!("⚠️  No USDC collected - pool remains at initial price $1.00");
        }

        pool.status = LotteryStatus::Settled;

        msg!("Lottery settled!");
        msg!("  Settlement slot: {}", clock.slot);
        msg!("  Total participants: {}", pool.total_participants);

        Ok(())
    }

    /// Claim allocation (each user calls this)
    /// Price is already discovered at settlement time - everyone pays the same clearing price
    pub fn claim(ctx: Context<Claim>) -> Result<()> {
        let pool = &mut ctx.accounts.lottery_pool;
        let participant = &mut ctx.accounts.participant;

        // Check lottery is settled
        require!(
            pool.status == LotteryStatus::Settled || pool.status == LotteryStatus::Completed,
            ErrorCode::LotteryNotSettled
        );
        require!(!participant.claimed, ErrorCode::AlreadyClaimed);

        // Generate lottery number for this user (for future use/display)
        let lottery_number = generate_lottery_number(
            &pool.settlement_blockhash,
            &participant.user,
        );
        participant.lottery_number = lottery_number;

        // Get current pool state (after price discovery)
        let clearing_sqrt_price = pool.sqrt_price;
        let current_token_reserve = ctx.accounts.token_vault.amount as u128;

        // Calculate tokens this user receives based on their USDC at clearing price
        // Price = P, User pays U USDC, they should receive U/P tokens
        // But we use concentrated liquidity math for precision

        let user_usdc = participant.escrowed_usdc as u128;

        // Calculate USDC reserve change for this user's amount
        let usdc_delta = user_usdc;

        // Calculate token output using concentrated liquidity formula
        // When adding USDC ∆y, tokens out ∆x = L * (1/sqrt(P) - 1/sqrt(P'))
        // But price is fixed, so we use: tokens = usdc / price

        let clearing_price = (clearing_sqrt_price * clearing_sqrt_price) / (PRECISION * PRECISION);
        let tokens_out = if clearing_price > 0 {
            (usdc_delta * PRECISION * PRECISION) / clearing_price
        } else {
            0
        };

        // Cap by available tokens
        let tokens_to_send = tokens_out.min(current_token_reserve) as u64;

        participant.allocated_usdc = user_usdc as u64;
        participant.tokens_received = tokens_to_send;
        pool.total_allocated_usdc += user_usdc as u64;

        if tokens_to_send > 0 {
            // Transfer tokens to user
            let seeds = &[
                b"lottery".as_ref(),
                pool.authority.as_ref(),
                &[ctx.bumps.lottery_pool],
            ];
            let signer = &[&seeds[..]];

            let cpi_accounts = Transfer {
                from: ctx.accounts.token_vault.to_account_info(),
                to: ctx.accounts.user_token_account.to_account_info(),
                authority: pool.to_account_info(),
            };
            let cpi_program = ctx.accounts.token_program.to_account_info();
            let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);
            token::transfer(cpi_ctx, tokens_to_send)?;

            msg!("✅ User claimed tokens!");
            msg!("  Lottery number: {}", lottery_number);
            msg!("  Paid USDC: {} (${})", user_usdc, user_usdc / 1_000_000);
            msg!("  Clearing price: ${}.{:09}", clearing_price / 1_000_000_000, clearing_price % 1_000_000_000);
            msg!("  Tokens received: {}", tokens_to_send);
        } else {
            msg!("⚠️  No tokens available (pool exhausted)");
        }

        participant.claimed = true;

        // Check if all tokens distributed
        if ctx.accounts.token_vault.amount == 0 {
            pool.status = LotteryStatus::Completed;
        }

        Ok(())
    }

    /// Get pool info (view function)
    pub fn get_pool_info(ctx: Context<GetPoolInfo>) -> Result<()> {
        let pool = &ctx.accounts.lottery_pool;

        let token_reserve = calculate_token_reserve(pool.liquidity, pool.sqrt_price);
        let usdc_reserve = calculate_usdc_reserve(pool.liquidity, pool.sqrt_price);
        let price = (pool.sqrt_price * pool.sqrt_price) / (PRECISION * PRECISION);

        msg!("Pool Info:");
        msg!("  Status: {:?}", pool.status);
        msg!("  Current price: {}", price);
        msg!("  Token reserve: {}", token_reserve);
        msg!("  USDC reserve: {}", usdc_reserve);
        msg!("  Participants: {}", pool.total_participants);
        msg!("  Registration ends: slot {}", pool.registration_end_slot);
        msg!("  Settlement slot: {}", pool.settlement_slot);

        Ok(())
    }
}

// Helper functions
fn calculate_token_reserve(liquidity: u128, sqrt_price: u128) -> u128 {
    let numerator = SQRT_PRICE_MAX - sqrt_price;
    let denominator = (sqrt_price * SQRT_PRICE_MAX) / PRECISION;
    (liquidity * numerator) / denominator
}

fn calculate_usdc_reserve(liquidity: u128, sqrt_price: u128) -> u128 {
    let numerator = sqrt_price - SQRT_PRICE_MIN;
    (liquidity * numerator) / SQRT_PRICE_MIN
}

fn generate_lottery_number(blockhash: &[u8; 32], user_pubkey: &Pubkey) -> u64 {
    // Simple but effective: XOR blockhash bytes with pubkey bytes
    // This creates unpredictable randomness since blockhash is unknown during registration
    let pubkey_bytes = user_pubkey.as_ref();
    let mut result_bytes = [0u8; 8];

    for i in 0..8 {
        result_bytes[i] = blockhash[i]
            ^ blockhash[i + 8]
            ^ blockhash[i + 16]
            ^ blockhash[i + 24]
            ^ pubkey_bytes[i]
            ^ pubkey_bytes[i + 8]
            ^ pubkey_bytes[i + 16]
            ^ pubkey_bytes[i + 24];
    }

    u64::from_le_bytes(result_bytes)
}

#[derive(Accounts)]
pub struct InitializeLottery<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + LotteryPool::INIT_SPACE,
        seeds = [b"lottery", authority.key().as_ref()],
        bump
    )]
    pub lottery_pool: Account<'info, LotteryPool>,

    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(mut)]
    pub depositor_token_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub token_vault: Account<'info, TokenAccount>,

    #[account(mut)]
    pub usdc_vault: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Register<'info> {
    #[account(
        mut,
        seeds = [b"lottery", lottery_pool.authority.as_ref()],
        bump
    )]
    pub lottery_pool: Account<'info, LotteryPool>,

    #[account(
        init,
        payer = user,
        space = 8 + ParticipantEntry::INIT_SPACE,
        seeds = [b"participant", lottery_pool.key().as_ref(), user.key().as_ref()],
        bump
    )]
    pub participant: Account<'info, ParticipantEntry>,

    #[account(mut)]
    pub user: Signer<'info>,

    #[account(mut)]
    pub user_usdc_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub usdc_vault: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Settle<'info> {
    #[account(
        mut,
        seeds = [b"lottery", lottery_pool.authority.as_ref()],
        bump
    )]
    pub lottery_pool: Account<'info, LotteryPool>,

    #[account(mut)]
    pub usdc_vault: Account<'info, TokenAccount>,

    /// CHECK: Recent blockhashes sysvar
    pub recent_blockhashes: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct Claim<'info> {
    #[account(
        mut,
        seeds = [b"lottery", lottery_pool.authority.as_ref()],
        bump
    )]
    pub lottery_pool: Account<'info, LotteryPool>,

    #[account(
        mut,
        seeds = [b"participant", lottery_pool.key().as_ref(), user.key().as_ref()],
        bump
    )]
    pub participant: Account<'info, ParticipantEntry>,

    #[account(mut)]
    pub user: Signer<'info>,

    #[account(mut)]
    pub user_token_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub user_usdc_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub token_vault: Account<'info, TokenAccount>,

    #[account(mut)]
    pub usdc_vault: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct GetPoolInfo<'info> {
    pub lottery_pool: Account<'info, LotteryPool>,
}

#[account]
#[derive(InitSpace)]
pub struct LotteryPool {
    // AMM state
    pub liquidity: u128,
    pub sqrt_price: u128,
    pub token_vault: Pubkey,
    pub usdc_vault: Pubkey,
    pub authority: Pubkey,

    // Lottery state
    pub registration_start_slot: u64,
    pub registration_end_slot: u64,
    pub settlement_slot: u64,
    pub total_participants: u32,
    pub total_allocated_usdc: u64,
    pub status: LotteryStatus,
    pub settlement_blockhash: [u8; 32],
}

#[account]
#[derive(InitSpace)]
pub struct ParticipantEntry {
    pub user: Pubkey,
    pub requested_usdc: u64,
    pub escrowed_usdc: u64,
    pub lottery_number: u64,
    pub allocated_usdc: u64,
    pub tokens_received: u64,
    pub claimed: bool,
    pub registration_slot: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum LotteryStatus {
    Registration,
    Settled,
    Completed,
}

impl std::fmt::Debug for LotteryStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            LotteryStatus::Registration => write!(f, "Registration"),
            LotteryStatus::Settled => write!(f, "Settled"),
            LotteryStatus::Completed => write!(f, "Completed"),
        }
    }
}

#[error_code]
pub enum ErrorCode {
    #[msg("Registration period has not opened yet or has ended")]
    RegistrationNotOpen,
    #[msg("Registration period has ended")]
    RegistrationPeriodEnded,
    #[msg("Invalid amount")]
    InvalidAmount,
    #[msg("Settlement slot has not been reached yet")]
    SettlementSlotNotReached,
    #[msg("Lottery has already been settled")]
    AlreadySettled,
    #[msg("Lottery has not been settled yet")]
    LotteryNotSettled,
    #[msg("User has already claimed their allocation")]
    AlreadyClaimed,
    #[msg("Maximum price of $2.00 has been reached")]
    MaxPriceReached,
}
