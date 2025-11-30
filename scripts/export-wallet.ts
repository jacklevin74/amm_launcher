/**
 * Export trader wallet for import into web interface
 */

import * as fs from "fs";
import * as anchor from "@coral-xyz/anchor";

const TRADER_WALLET_PATH = "/tmp/trader-wallet.json";

const walletData = JSON.parse(fs.readFileSync(TRADER_WALLET_PATH, "utf8"));
const keypair = anchor.web3.Keypair.fromSecretKey(new Uint8Array(walletData));

console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log("💼 TRADER WALLET EXPORT");
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log("\nPublic Key:", keypair.publicKey.toString());
console.log("\nTo import into web interface:");
console.log("1. Open http://localhost:3030/trading in your browser");
console.log("2. Open browser console (F12)");
console.log("3. Paste this command:\n");
console.log(`localStorage.setItem('trader_wallet', '${JSON.stringify(walletData)}');`);
console.log("\n4. Refresh the page");
console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
