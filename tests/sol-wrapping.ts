import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { BondingCurve } from "../target/types/bonding_curve";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { assert } from "chai";

describe("SOL Wrapping", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.BondingCurve as Program<BondingCurve>;
  const payer = provider.wallet as anchor.Wallet;

  let xntMint: anchor.web3.PublicKey;
  let usdcMint: anchor.web3.PublicKey;
  let poolPda: anchor.web3.PublicKey;
  let poolXnt: anchor.web3.PublicKey;
  let poolUsdc: anchor.web3.PublicKey;
  let initializerXnt: anchor.web3.PublicKey;
  let userXnt: anchor.web3.PublicKey;
  let ceilingReservePda: anchor.web3.PublicKey;
  let ceilingReserveXnt: anchor.web3.PublicKey;
  let solVaultPda: anchor.web3.PublicKey;

  const INITIAL_XNT = 1_000_000_000_000; // 1M XNT (6 decimals)
  const VIRTUAL_USDC = 1_000_000_000_000; // 1M USDC (6 decimals)
  const PRICE_CEILING = 2_000_000; // $2.00 (6 decimals)
  const PRICE_FLOOR = 1_000_000; // $1.00 (6 decimals)

  before("Setup mints and accounts", async () => {
    console.log("\n🔧 Setting up SOL wrapping test environment...\n");

    // Create XNT mint (6 decimals)
    xntMint = await createMint(
      provider.connection,
      payer.payer,
      payer.publicKey,
      null,
      6
    );
    console.log(`✅ Created XNT mint: ${xntMint.toBase58()}`);

    // Create USDC mint (6 decimals)
    usdcMint = await createMint(
      provider.connection,
      payer.payer,
      payer.publicKey,
      null,
      6
    );
    console.log(`✅ Created USDC mint: ${usdcMint.toBase58()}`);

    // Create initializer's XNT account and mint initial supply
    const initializerXntAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      payer.payer,
      xntMint,
      payer.publicKey
    );
    initializerXnt = initializerXntAccount.address;

    await mintTo(
      provider.connection,
      payer.payer,
      xntMint,
      initializerXnt,
      payer.publicKey,
      INITIAL_XNT
    );
    console.log(`✅ Minted ${INITIAL_XNT / 1e6} XNT to initializer`);

    // Create user's XNT account
    const userXntAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      payer.payer,
      xntMint,
      payer.publicKey
    );
    userXnt = userXntAccount.address;

    // Derive PDAs
    [poolPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("pool"), xntMint.toBuffer(), usdcMint.toBuffer()],
      program.programId
    );
    console.log(`📍 Pool PDA: ${poolPda.toBase58()}`);

    [ceilingReservePda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("ceiling_reserve"), poolPda.toBuffer()],
      program.programId
    );
    console.log(`📍 Ceiling Reserve PDA: ${ceilingReservePda.toBase58()}`);

    [solVaultPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("sol_vault"), poolPda.toBuffer()],
      program.programId
    );
    console.log(`📍 SOL Vault PDA: ${solVaultPda.toBase58()}`);
  });

  it("Initializes pool with SOL vault", async () => {
    console.log("\n💧 Initializing pool with SOL vault...\n");

    // Generate keypairs for pool token accounts
    const poolXntKeypair = anchor.web3.Keypair.generate();
    const poolUsdcKeypair = anchor.web3.Keypair.generate();
    const ceilingReserveXntKeypair = anchor.web3.Keypair.generate();

    poolXnt = poolXntKeypair.publicKey;
    poolUsdc = poolUsdcKeypair.publicKey;
    ceilingReserveXnt = ceilingReserveXntKeypair.publicKey;

    const tx = await program.methods
      .initializePool(
        new anchor.BN(INITIAL_XNT),
        new anchor.BN(VIRTUAL_USDC),
        true, // price floor enabled
        new anchor.BN(PRICE_CEILING),
        new anchor.BN(PRICE_FLOOR)
      )
      .accounts({
        initializer: payer.publicKey,
        pool: poolPda,
        xntMint: xntMint,
        usdcMint: usdcMint,
        poolXnt: poolXnt,
        poolUsdc: poolUsdc,
        initializerXnt: initializerXnt,
        ceilingReservePda: ceilingReservePda,
        ceilingReserveXnt: ceilingReserveXnt,
        solVault: solVaultPda,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([poolXntKeypair, poolUsdcKeypair, ceilingReserveXntKeypair])
      .rpc();

    console.log(`✅ Pool initialized. TX: ${tx}`);

    const pool = await program.account.pool.fetch(poolPda);
    console.log(`   XNT Reserve: ${pool.xntReserve.toNumber() / 1e6}`);
    console.log(`   USDC Reserve (virtual): ${pool.usdcReserve.toNumber() / 1e6}`);
    console.log(`   Price: $${(pool.usdcReserve.toNumber() / pool.xntReserve.toNumber()).toFixed(2)}`);
    console.log(`   SOL Vault Bump: ${pool.solVaultBump}`);
  });

  it("Wraps SOL into XNT", async () => {
    console.log("\n🔄 Wrapping 1 SOL into XNT...\n");

    const solAmount = 1_000_000_000; // 1 SOL (9 decimals)
    const expectedXnt = solAmount / 1000; // 1 XNT (6 decimals) = 1 SOL

    const userXntBefore = (
      await provider.connection.getTokenAccountBalance(userXnt)
    ).value.amount;

    const solBalanceBefore = await provider.connection.getBalance(payer.publicKey);

    const tx = await program.methods
      .wrapSol(new anchor.BN(solAmount))
      .accounts({
        user: payer.publicKey,
        pool: poolPda,
        solVault: solVaultPda,
        poolXnt: poolXnt,
        userXnt: userXnt,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    console.log(`✅ Wrapped SOL. TX: ${tx}`);

    const userXntAfter = (
      await provider.connection.getTokenAccountBalance(userXnt)
    ).value.amount;

    const solBalanceAfter = await provider.connection.getBalance(payer.publicKey);

    const xntReceived = parseInt(userXntAfter) - parseInt(userXntBefore);
    console.log(`   XNT Received: ${xntReceived / 1e6}`);
    console.log(`   SOL Spent: ${(solBalanceBefore - solBalanceAfter) / 1e9}`);

    assert.equal(xntReceived, expectedXnt, "Should receive correct amount of XNT");
  });

  it("Unwraps XNT back to SOL", async () => {
    console.log("\n🔄 Unwrapping 0.5 XNT back to SOL...\n");

    const xntAmount = 500_000; // 0.5 XNT (6 decimals)
    const expectedSol = xntAmount * 1000; // 0.5 SOL (9 decimals)

    const userXntBefore = (
      await provider.connection.getTokenAccountBalance(userXnt)
    ).value.amount;

    const solBalanceBefore = await provider.connection.getBalance(payer.publicKey);

    const tx = await program.methods
      .unwrapSol(new anchor.BN(xntAmount))
      .accounts({
        user: payer.publicKey,
        pool: poolPda,
        solVault: solVaultPda,
        poolXnt: poolXnt,
        userXnt: userXnt,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    console.log(`✅ Unwrapped XNT. TX: ${tx}`);

    const userXntAfter = (
      await provider.connection.getTokenAccountBalance(userXnt)
    ).value.amount;

    const solBalanceAfter = await provider.connection.getBalance(payer.publicKey);

    const xntSpent = parseInt(userXntBefore) - parseInt(userXntAfter);
    const solReceived = solBalanceAfter - solBalanceBefore;

    console.log(`   XNT Spent: ${xntSpent / 1e6}`);
    console.log(`   SOL Received: ${solReceived / 1e9}`);

    assert.equal(xntSpent, xntAmount, "Should spend correct amount of XNT");
    // Note: SOL received will be slightly less due to transaction fees
  });
});
