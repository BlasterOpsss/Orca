import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { createKeyPairSignerFromBytes } from "@solana/kit";
import { launchToken, type Network } from "../src/launch";

const { values } = parseArgs({
  options: {
    keypair: { type: "string" }, // path to a Solana CLI keypair JSON file
    network: { type: "string", default: "devnet" },
    rpc: { type: "string" },
    decimals: { type: "string", default: "6" },
    supply: { type: "string", default: "1000000000" }, // whole tokens
    "liquidity-percent": { type: "string", default: "80" },
    price: { type: "string", default: "0.000001" }, // SOL per token
    "keep-mint-authority": { type: "boolean", default: false },
    yes: { type: "boolean", default: false }, // required for mainnet
  },
});

if (!values.keypair) {
  console.error("Usage: npm run launch -- --keypair ~/.config/solana/id.json [options]");
  console.error("Options: --network devnet|mainnet --rpc URL --decimals 6 --supply 1000000000");
  console.error("         --liquidity-percent 80 --price 0.000001 --keep-mint-authority --yes");
  process.exit(1);
}
if (values.network !== "devnet" && values.network !== "mainnet") {
  console.error("--network must be devnet or mainnet");
  process.exit(1);
}
if (values.network === "mainnet" && !values.yes) {
  console.error("Mainnet spends real SOL and cannot be undone. Re-run with --yes to confirm.");
  process.exit(1);
}

const payer = await createKeyPairSignerFromBytes(
  new Uint8Array(JSON.parse(readFileSync(values.keypair, "utf8"))),
);
console.log(`Launching from ${payer.address} on ${values.network}`);

const result = await launchToken(
  payer,
  {
    network: values.network as Network,
    rpcUrl: values.rpc,
    decimals: Number(values.decimals),
    supply: BigInt(values.supply!),
    liquidityPercent: Number(values["liquidity-percent"]),
    priceSol: Number(values.price),
    revokeMintAuthority: !values["keep-mint-authority"],
  },
  (m) => console.log(`• ${m}`),
);

console.log(JSON.stringify(result, null, 2));
