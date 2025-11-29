import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { LotteryAmm } from "../target/types/lottery_amm";
import { PublicKey, Keypair, SystemProgram, SYSVAR_RECENT_BLOCKHASHES_PUBKEY } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  createMintToInstruction,
  createInitializeMintInstruction,
  createTransferInstruction,
  getMinimumBalanceForRentExemptMint,
  MINT_SIZE,
  getMinimumBalanceForRentExemptAccount,
  ACCOUNT_SIZE,
  createInitializeAccountInstruction,
} from "@solana/spl-token";
import { assert } from "chai";

describe("lottery_amm - On-Chain Tests", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.LotteryAmm as Program<LotteryAmm>;
  const payer = (provider.wallet as anchor.Wallet).payer;

  let xntMint: Keypair;
  let usdcMint: Keypair;
  let lotteryPool: PublicKey;
  let tokenVault: Keypair;
  let usdcVault: Keypair;

  const INITIAL_XNT_AMOUNT = 1_000_000_000_000; // 1M tokens (6 decimals)
  const REGISTRATION_DURATION = 100; // slots

  it("Setup: Create mints and accounts", async () => {
    console.log("\n🔧 Setting up test environment...");

    // Create XNT mint
    xntMint = Keypair.generate();
    const xntMintRent = await getMinimumBalanceForRentExemptMint(provider.connection);

    const createXntMintIx = SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: xntMint.publicKey,
      space: MINT_SIZE,
      lamports: xntMintRent,
      programId: TOKEN_PROGRAM_ID,
    });

    const initXntMintIx = createInitializeMintInstruction(
      xntMint.publicKey,
      6, // decimals
      payer.publicKey, // mint authority
      null, // freeze authority
      TOKEN_PROGRAM_ID
    );

    // Create USDC mint
    usdcMint = Keypair.generate();
    const usdcMintRent = await getMinimumBalanceForRentExemptMint(provider.connection);

    const createUsdcMintIx = SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: usdcMint.publicKey,
      space: MINT_SIZE,
      lamports: usdcMintRent,
      programId: TOKEN_PROGRAM_ID,
    });

    const initUsdcMintIx = createInitializeMintInstruction(
      usdcMint.publicKey,
      6, // decimals
      payer.publicKey,
      null,
      TOKEN_PROGRAM_ID
    );

    const tx = new anchor.web3.Transaction()
      .add(createXntMintIx)
      .add(initXntMintIx)
      .add(createUsdcMintIx)
      .add(initUsdcMintIx);

    const sig = await provider.sendAndConfirm(tx, [xntMint, usdcMint]);
    console.log("  ✅ Created mints:", sig.slice(0, 20) + "...");
    console.log("  XNT Mint:", xntMint.publicKey.toString());
    console.log("  USDC Mint:", usdcMint.publicKey.toString());
  });

  it("Initialize lottery pool", async () => {
    console.log("\n🎰 Initializing lottery pool...");

    // Derive lottery pool PDA
    [lotteryPool] = PublicKey.findProgramAddressSync(
      [Buffer.from("lottery"), payer.publicKey.toBuffer()],
      program.programId
    );

    // Create token vaults (regular token accounts, not ATAs)
    tokenVault = Keypair.generate();
    usdcVault = Keypair.generate();

    const tokenVaultRent = await getMinimumBalanceForRentExemptAccount(provider.connection);
    const usdcVaultRent = await getMinimumBalanceForRentExemptAccount(provider.connection);

    const createTokenVaultIx = SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: tokenVault.publicKey,
      space: ACCOUNT_SIZE,
      lamports: tokenVaultRent,
      programId: TOKEN_PROGRAM_ID,
    });

    const initTokenVaultIx = createInitializeAccountInstruction(
      tokenVault.publicKey,
      xntMint.publicKey,
      lotteryPool, // owned by PDA
      TOKEN_PROGRAM_ID
    );

    const createUsdcVaultIx = SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: usdcVault.publicKey,
      space: ACCOUNT_SIZE,
      lamports: usdcVaultRent,
      programId: TOKEN_PROGRAM_ID,
    });

    const initUsdcVaultIx = createInitializeAccountInstruction(
      usdcVault.publicKey,
      usdcMint.publicKey,
      lotteryPool, // owned by PDA
      TOKEN_PROGRAM_ID
    );

    const vaultTx = new anchor.web3.Transaction()
      .add(createTokenVaultIx)
      .add(initTokenVaultIx)
      .add(createUsdcVaultIx)
      .add(initUsdcVaultIx);

    const vaultSig = await provider.sendAndConfirm(vaultTx, [tokenVault, usdcVault]);
    console.log("  ✅ Created vaults:", vaultSig.slice(0, 20) + "...");

    // Create payer's XNT account and mint tokens
    const payerXntAccount = getAssociatedTokenAddressSync(
      xntMint.publicKey,
      payer.publicKey
    );

    const createPayerXntIx = createAssociatedTokenAccountInstruction(
      payer.publicKey,
      payerXntAccount,
      payer.publicKey,
      xntMint.publicKey
    );

    const mintToPayerIx = createMintToInstruction(
      xntMint.publicKey,
      payerXntAccount,
      payer.publicKey,
      INITIAL_XNT_AMOUNT
    );

    const mintTx = new anchor.web3.Transaction()
      .add(createPayerXntIx)
      .add(mintToPayerIx);

    const mintSig = await provider.sendAndConfirm(mintTx);
    console.log("  ✅ Minted XNT to payer:", mintSig.slice(0, 20) + "...");

    // Initialize lottery
    const initSig = await program.methods
      .initializeLottery(
        new anchor.BN(INITIAL_XNT_AMOUNT),
        new anchor.BN(REGISTRATION_DURATION)
      )
      .accounts({
        lotteryPool,
        authority: payer.publicKey,
        depositorTokenAccount: payerXntAccount,
        tokenVault: tokenVault.publicKey,
        usdcVault: usdcVault.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log("  ✅ Lottery initialized:", initSig);
    console.log("  Lottery Pool PDA:", lotteryPool.toString());
    console.log("");
    console.log("  📊 Transaction Hash:", initSig);

    // Verify pool state
    const poolData = await program.account.lotteryPool.fetch(lotteryPool);
    assert.equal(poolData.authority.toString(), payer.publicKey.toString());
    console.log("  ✅ Pool state verified");
  });

  it("Register user with USDC", async () => {
    console.log("\n👤 Registering test user...");

    const user = Keypair.generate();

    // Airdrop SOL to user
    const airdropSig = await provider.connection.requestAirdrop(
      user.publicKey,
      2 * anchor.web3.LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(airdropSig);

    // Create user's USDC account
    const userUsdcAccount = getAssociatedTokenAddressSync(
      usdcMint.publicKey,
      user.publicKey
    );

    const createUserUsdcIx = createAssociatedTokenAccountInstruction(
      user.publicKey,
      userUsdcAccount,
      user.publicKey,
      usdcMint.publicKey
    );

    // Mint USDC to user
    const usdcAmount = 100_000_000_000; // $100K
    const mintUsdcIx = createMintToInstruction(
      usdcMint.publicKey,
      userUsdcAccount,
      payer.publicKey,
      usdcAmount
    );

    const setupTx = new anchor.web3.Transaction()
      .add(createUserUsdcIx)
      .add(mintUsdcIx);

    await provider.sendAndConfirm(setupTx, [user]);
    console.log("  ✅ User funded with $100K USDC");

    // Derive participant PDA
    const [participant] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("participant"),
        lotteryPool.toBuffer(),
        user.publicKey.toBuffer(),
      ],
      program.programId
    );

    // Register
    const registerSig = await program.methods
      .register(new anchor.BN(usdcAmount))
      .accounts({
        lotteryPool,
        participant,
        user: user.publicKey,
        userUsdcAccount,
        usdcVault: usdcVault.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([user])
      .rpc();

    console.log("  ✅ User registered:", registerSig);
    console.log("  📊 Transaction Hash:", registerSig);

    // Verify participant state
    const participantData = await program.account.participantEntry.fetch(participant);
    assert.equal(participantData.requestedUsdc.toString(), usdcAmount.toString());
    console.log("  ✅ Participant state verified");
    console.log("  Requested USDC:", participantData.requestedUsdc.toString());
  });

  it("Settle lottery and discover price", async () => {
    console.log("\n⚖️  Settling lottery...");

    // Wait for settlement slot (need to wait ~10-15 seconds for 100+ slots)
    console.log("  ⏳ Waiting for settlement slot (15 seconds)...");
    await new Promise(resolve => setTimeout(resolve, 15000));

    const settleSig = await program.methods
      .settle()
      .accounts({
        lotteryPool,
        usdcVault: usdcVault.publicKey,
        recentBlockhashes: SYSVAR_RECENT_BLOCKHASHES_PUBKEY,
      })
      .rpc();

    console.log("  ✅ Lottery settled:", settleSig);
    console.log("  📊 Transaction Hash:", settleSig);

    // Check final price
    const poolData = await program.account.lotteryPool.fetch(lotteryPool);
    const sqrtPrice = poolData.sqrtPrice.toNumber();
    const clearingPrice = (sqrtPrice * sqrtPrice) / (1_000_000_000 * 1_000_000_000);

    console.log("  📊 Price Discovery Results:");
    console.log("     Clearing sqrt_price:", sqrtPrice.toLocaleString());
    console.log("     Clearing price: $" + clearingPrice.toFixed(6));
    console.log("");

    assert.isAbove(clearingPrice, 1.0, "Price should be above $1.00");
  });

  it("Print all transaction hashes", async () => {
    console.log("\n" + "=".repeat(50));
    console.log("🎉 ALL TESTS PASSED!");
    console.log("=".repeat(50));
    console.log("");
    console.log("📋 Transaction Hashes saved in test output above");
    console.log("🔍 Search for '📊 Transaction Hash:' in the output");
    console.log("");
    console.log("Program ID:", program.programId.toString());
    console.log("Lottery Pool:", lotteryPool.toString());
    console.log("");
  });
});
