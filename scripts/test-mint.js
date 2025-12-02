const { Connection, Keypair, LAMPORTS_PER_SOL } = require("@solana/web3.js");
const { createMint } = require("@solana/spl-token");
const fs = require("fs");

async function main() {
  const walletPath = process.env.HOME + "/.config/solana/id.json";
  const payer = Keypair.fromSecretKey(
    Buffer.from(JSON.parse(fs.readFileSync(walletPath, "utf-8")))
  );

  const connection = new Connection("http://localhost:8899", "confirmed");
  
  console.log("Payer:", payer.publicKey.toString());
  const balance = await connection.getBalance(payer.publicKey);
  console.log("Balance:", balance / LAMPORTS_PER_SOL, "SOL");

  console.log("\nCreating mint...");
  const mint = await createMint(
    connection,
    payer,
    payer.publicKey,
    null,
    6
  );
  
  console.log("✅ Mint created:", mint.toString());
}

main().catch(e => {
  console.error("Error:", e.message);
  if (e.logs) {
    console.log("Logs:", e.logs);
  }
  process.exit(1);
});
