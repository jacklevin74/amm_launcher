#!/usr/bin/env node
/**
 * Script to systematically update all test files to work with new program changes:
 * - Add xntMint and usdcMint to all buy/sell calls
 * - Fix account naming (trader → buyer/seller)
 * - Add ceiling reserve accounts where needed
 */

const fs = require('fs');
const path = require('path');

const testsDir = path.join(__dirname, '../tests');

// Patterns to fix
const fixes = [
  {
    name: 'Fix buy accounts - add mint accounts before poolXnt',
    pattern: /(\s+buyer: .+,\n\s+pool: .+,\n)(\s+poolXnt:)/g,
    replacement: '$1      xntMint: xntMint,\n      usdcMint: usdcMint,\n$2'
  },
  {
    name: 'Fix sell accounts - add mint accounts before poolXnt',
    pattern: /(\s+seller: .+,\n\s+pool: .+,\n)(\s+poolXnt:)/g,
    replacement: '$1      xntMint: xntMint,\n      usdcMint: usdcMint,\n$2'
  },
  {
    name: 'Add ceiling reserve to buy accounts (if not present)',
    pattern: /(buyerUsdc:.+,\n)(\s+tokenProgram: TOKEN_PROGRAM_ID,)/g,
    replacement: '$1      ceilingReservePda,\n      ceilingReserveXnt,\n$2'
  }
];

// Test files to update (excluding already fixed ones)
const filesToFix = [
  'e6-usdc-integration.ts',
  'e6-usdc-simulation.test.ts',
  'price-calc-test.ts',
  'live-trading-sim.ts',
  'bonding-curve-sim.ts',
  'bonding-curve-real-tokens.ts',
  'bonding-curve-to-dex.ts',
  'bonding-curve-deposits.ts',
  'bonding-curve-withdrawals.ts',
  'price-corridor-demo.ts'
];

console.log('🔧 Starting test file fixes...\n');

filesToFix.forEach(filename => {
  const filepath = path.join(testsDir, filename);

  if (!fs.existsSync(filepath)) {
    console.log(`⚠️  Skipping ${filename} (not found)`);
    return;
  }

  console.log(`📝 Processing ${filename}...`);
  let content = fs.readFileSync(filepath, 'utf8');
  let changed = false;

  fixes.forEach(fix => {
    const before = content;
    content = content.replace(fix.pattern, fix.replacement);
    if (content !== before) {
      console.log(`  ✓ ${fix.name}`);
      changed = true;
    }
  });

  if (changed) {
    // Backup original
    fs.writeFileSync(filepath + '.backup', fs.readFileSync(filepath));
    // Write fixed version
    fs.writeFileSync(filepath, content);
    console.log(`  ✅ Updated ${filename}\n`);
  } else {
    console.log(`  ℹ️  No changes needed for ${filename}\n`);
  }
});

console.log('✨ Test fixes complete!');
