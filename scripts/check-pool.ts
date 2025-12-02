import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { BondingCurve } from "../target/types/bonding_curve";
import { Connection, Keypair } from "@solana/web3.js";
import * as fs from "fs";

async function main() {
  const connection = new Connection("http://localhost:8899", "confirmed");
  const walletPath = "/Users/yakovlevin/x1_cluster_keys/.config/solana/id.json";
  const walletKeypair = Keypair.fromSecretKey(
    Buffer.from(JSON.parse(fs.readFileSync(walletPath, "utf-8")))
  );
  const wallet = new anchor.Wallet(walletKeypair);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
  anchor.setProvider(provider);

  const program = anchor.workspace.BondingCurve as Program<BondingCurve>;

  const poolAddress = "GoauTxG6k1YLoBh9xwJ5UWuiJtCnvRgYnovKfhjY6UAF";
  const poolPda = new anchor.web3.PublicKey(poolAddress);

  const pool = await program.account.pool.fetch(poolPda);

  console.log("Pool ceiling_reserve_xnt:", pool.ceilingReserveXnt.toString());
  console.log("POOL_INFO ceiling reserve:", "5ipKrca4Byu7o71RmTJGCUxMcJqEcGnTcy22ByZyNfV");
  console.log("Match:", pool.ceilingReserveXnt.toString() === "5ipKrca4Byu7o71RmTJGCUxMcJqEcGnTcy22ByZyNfV");
}

main().catch(e => { console.error(e); process.exit(1); });
