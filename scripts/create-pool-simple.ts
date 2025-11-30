import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { BondingCurve } from "../target/types/bonding_curve";
import {
  TOKEN_PROGRAM_ID,
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import { Keypair, Connection } from "@solana/web3.js";
import * as fs from "fs";

const INITIAL_XNT = 10_000_000_000_000;      // 10M XNT
const VIRTUAL_USDC = 10_000_000_000_000;     // 10M USDC
const BOT_RESERVE_XNT = 20_000_000_000_000;  // 20M XNT

async function main() {
  const walletPath = process.env.ANCHOR_WALLET || process.env.HOME + "/.config/solana/id.json";
  const walletKeypair = Keypair.fromSecretKey(
    Buffer.from(JSON.parse(fs.readFileSync(walletPath, "utf-8")))
  );

  const connection = new Connection(process.env.ANCHOR_PROVIDER_URL || "http://localhost:8899", "confirmed");
  const wallet = new anchor.Wallet(walletKeypair);
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  anchor.setProvider(provider);

  const program = anchor.workspace.BondingCurve as Program<BondingCurve>;

  console.log("📊 Creating mints...");
  const xntMint = await createMint(connection, walletKeypair, walletKeypair.publicKey, null, 6);
  const usdcMint = await createMint(connection, walletKeypair, walletKeypair.publicKey, null, 6);

  console.log(`✅ XNT Mint: ${xntMint.toString()}`);
  console.log(`✅ USDC Mint: ${usdcMint.toString()}`);

  const [poolPda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("pool"), xntMint.toBuffer(), usdcMint.toBuffer()],
    program.programId
  );

  console.log(`✅ Pool PDA: ${poolPda.toString()}`);

  const authorityXntAccount = await getOrCreateAssociatedTokenAccount(
    connection,
    walletKeypair,
    xntMint,
    walletKeypair.publicKey
  );

  console.log("\n💰 Minting tokens...");
  await mintTo(
    connection,
    walletKeypair,
    xntMint,
    authorityXntAccount.address,
    walletKeypair.publicKey,
    INITIAL_XNT + BOT_RESERVE_XNT
  );
  console.log(`✅ Minted 30M XNT (10M pool + 20M bot reserves)`);

  console.log("\n📊 Initializing pool...");
  const poolXntKeypair = Keypair.generate();
  const poolUsdcKeypair = Keypair.generate();

  await program.methods
    .initializePool(new anchor.BN(INITIAL_XNT), new anchor.BN(VIRTUAL_USDC))
    .accounts({
      initializer: walletKeypair.publicKey,
      pool: poolPda,
      xntMint,
      usdcMint,
      poolXnt: poolXntKeypair.publicKey,
      poolUsdc: poolUsdcKeypair.publicKey,
      initializerXnt: authorityXntAccount.address,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .signers([poolXntKeypair, poolUsdcKeypair])
    .rpc();

  const pool = await program.account.pool.fetch(poolPda);
  const price = pool.usdcReserve.toNumber() / pool.xntReserve.toNumber();

  console.log(`✅ Pool initialized!`);
  console.log(`   XNT Reserve: ${(pool.xntReserve.toNumber() / 1e6).toLocaleString()}M`);
  console.log(`   USDC Reserve: $${(pool.usdcReserve.toNumber() / 1e6).toLocaleString()}M`);
  console.log(`   Price: $${price.toFixed(2)}`);
  console.log("");
  console.log("🤖 Start bot with:");
  console.log(`   ANCHOR_PROVIDER_URL=http://localhost:8899 ANCHOR_WALLET=${walletPath} npx ts-node bots/price-corridor-bot.ts --pool-address ${poolPda.toString()}`);
  console.log("");
  console.log(`POOL_ADDRESS=${poolPda.toString()}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
