# Solana Launchpad (Orca)

Mints an SPL token, creates an Orca **Splash pool** (token / SOL), and seeds it with full-range liquidity. Works from a CLI or a small web page with any Solana wallet.

## Run it

```bash
npm install
npm run typecheck        # fix any SDK signature drift first (see "Status")

# Web page
npm run dev              # http://localhost:5173, defaults to devnet

# CLI (devnet, needs devnet SOL: solana airdrop 2)
npm run launch -- --keypair ~/.config/solana/id.json \
  --supply 1000000000 --decimals 6 --liquidity-percent 80 --price 0.000001
```

CLI flags: `--network devnet|mainnet`, `--rpc URL`, `--keep-mint-authority`, `--yes` (required on mainnet).

## What happens on launch

1. **Token tx** – creates the mint, mints the full supply to you, removes mint authority (unless kept), sets no freeze authority.
2. **Pool tx** – `createSplashPoolInstructions` for token/wSOL at your start price.
3. **Liquidity tx** – `openFullRangePositionInstructions` deposits `supply × liquidity%` tokens plus the SOL the price implies. The position NFT lands in your wallet, so you can later harvest fees or withdraw.

The rest of the supply stays in your wallet.

## Layout

- `src/launch.ts` – core flow, shared by CLI and web
- `src/wallet.ts` – Wallet Standard → Kit signer
- `src/main.ts`, `index.html`, `src/style.css` – web page
- `scripts/launch.ts` – CLI

## Status: not yet compiled or run

This was written in a sandbox with no access to the npm registry, so dependencies were never installed, nothing was type-checked, and nothing was run on devnet. Dependencies are set to `latest`; pin them after your first successful install. Most likely things to need a tweak against the current SDK:

- Return field names from `openFullRangePositionInstructions` (`quote.tokenEstA` / `tokenEstB`, `positionMint`)
- Whether `createSplashPoolInstructions` expects mints in sorted order or sorts them itself
- Browser bundling of `@orca-so/whirlpools-core` (WASM); `vite.config.ts` has the usual plugins, but verify

## Before mainnet

- **No token metadata yet.** The token will show as "Unknown" in wallets. Add Metaplex Token Metadata (name, symbol, image) as a fourth step.
- Add a priority fee / compute budget for congested periods.
- A launchpad that charges a fee, or sells to others, can have securities and consumer-protection implications depending on jurisdiction; get advice before going live.
- Test the whole flow on devnet first.
