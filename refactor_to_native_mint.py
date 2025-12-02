#!/usr/bin/env python3
"""
Refactor bonding_curve program to use native SOL mint instead of custom XNT with wrap/unwrap.

This script:
1. Removes wrap_sol and unwrap_sol functions
2. Removes WrapSol and UnwrapSol context structs
3. Removes sol_vault PDA references
4. Removes sol_vault_bump from Pool struct
5. Updates comments to reflect wSOL (9 decimals) instead of custom XNT (6 decimals)
"""

import re

def refactor_lib_rs(content):
    """Apply all refactoring transformations to lib.rs content"""

    # 1. Remove wrap_sol function (lines ~728-785)
    content = re.sub(
        r'    /// Wrap native SOL into XNT tokens.*?^    \}',
        '',
        content,
        flags=re.DOTALL | re.MULTILINE
    )

    # 2. Remove unwrap_sol function (lines ~787-845)
    content = re.sub(
        r'    /// Unwrap XNT tokens back to native SOL.*?^    \}',
        '',
        content,
        flags=re.DOTALL | re.MULTILINE
    )

    # 3. Remove WrapSol context struct
    content = re.sub(
        r'#\[derive\(Accounts\)\]\npub struct WrapSol<.*?^}',
        '',
        content,
        flags=re.DOTALL | re.MULTILINE
    )

    # 4. Remove UnwrapSol context struct
    content = re.sub(
        r'#\[derive\(Accounts\)\]\npub struct UnwrapSol<.*?^}',
        '',
        content,
        flags=re.DOTALL | re.MULTILINE
    )

    # 5. Remove sol_vault from InitializePool struct
    content = re.sub(
        r'    /// SOL vault PDA.*?\n    pub sol_vault: AccountInfo<\'info>,\n',
        '',
        content,
        flags=re.DOTALL
    )

    # 6. Remove sol_vault_bump from Pool struct
    content = re.sub(
        r'    pub sol_vault_bump: u8,.*?\n',
        '',
        content
    )

    # 7. Remove sol_vault_bump assignment in initialize_pool
    content = re.sub(
        r'        pool\.sol_vault_bump = ctx\.bumps\.sol_vault;\n',
        '',
        content
    )

    # 8. Update comment about XNT decimals (6 -> 9)
    content = content.replace('XNT (6 decimals)', 'XNT/wSOL (9 decimals)')

    # 9. Add note that XNT is now using native SOL mint
    header_comment = '''/// Bonding Curve AMM for XNT/USDC
/// XNT uses Solana's native mint (So11111111111111111111111111111111111111112)
/// This means XNT is wSOL - wrapped SOL with 9 decimals
/// Users can wrap/unwrap SOL <-> wSOL using standard Solana wallet features

'''

    # Insert after imports
    content = content.replace(
        'declare_id!("2zKpM4k4kp7qRNvBVzkEAAt8DU8t1vpAfzsRagha4NNF");',
        header_comment + 'declare_id!("2zKpM4k4kp7qRNvBVzkEAAt8DU8t1vpAfzsRagha4NNF");'
    )

    return content

def main():
    lib_rs_path = 'programs/bonding_curve/src/lib.rs'

    print(f"Reading {lib_rs_path}...")
    with open(lib_rs_path, 'r') as f:
        content = f.read()

    print("Original file size:", len(content), "bytes")
    print("Original line count:", content.count('\n'))

    print("\nApplying refactoring transformations...")
    refactored = refactor_lib_rs(content)

    print("Refactored file size:", len(refactored), "bytes")
    print("Refactored line count:", refactored.count('\n'))
    print("Lines removed:", content.count('\n') - refactored.count('\n'))

    # Write to new file
    output_path = 'programs/bonding_curve/src/lib.rs.refactored'
    print(f"\nWriting refactored code to {output_path}...")
    with open(output_path, 'w') as f:
        f.write(refactored)

    print("✅ Refactoring complete!")
    print("\nNext steps:")
    print("1. Review the refactored file: programs/bonding_curve/src/lib.rs.refactored")
    print("2. If it looks good, replace the original: mv programs/bonding_curve/src/lib.rs.refactored programs/bonding_curve/src/lib.rs")
    print("3. Run: anchor build")
    print("4. Update initialization and test scripts")

if __name__ == '__main__':
    main()
