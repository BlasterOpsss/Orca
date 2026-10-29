/** Wallet Standard bridge: turns any Solana browser wallet (Phantom, Solflare, Backpack…) into a Kit signer. */
import { getWallets } from "@wallet-standard/app";
import { StandardConnect, type StandardConnectFeature } from "@wallet-standard/features";
import type { Wallet } from "@wallet-standard/base";
import {
  SolanaSignTransaction,
  type SolanaSignTransactionFeature,
} from "@solana/wallet-standard-features";
import {
  address,
  getTransactionDecoder,
  getTransactionEncoder,
  type TransactionPartialSigner,
} from "@solana/kit";
import type { Network } from "./launch";

export function listWallets(): Wallet[] {
  return getWallets()
    .get()
    .filter((w) => StandardConnect in w.features && SolanaSignTransaction in w.features);
}

export async function connectWallet(
  wallet: Wallet,
  network: Network,
): Promise<TransactionPartialSigner> {
  const connect = (wallet.features[StandardConnect] as StandardConnectFeature[typeof StandardConnect])
    .connect;
  const { accounts } = await connect();
  const account = accounts[0];
  if (!account) throw new Error("Wallet returned no accounts");

  const sign = (
    wallet.features[SolanaSignTransaction] as SolanaSignTransactionFeature[typeof SolanaSignTransaction]
  ).signTransaction;
  const chain = network === "mainnet" ? "solana:mainnet" : "solana:devnet";
  const walletAddress = address(account.address);
  const encoder = getTransactionEncoder();
  const decoder = getTransactionDecoder();

  return {
    address: walletAddress,
    async signTransactions(transactions) {
      const out = [];
      for (const tx of transactions) {
        const [res] = await sign({
          account,
          chain,
          transaction: new Uint8Array(encoder.encode(tx)),
        });
        const signature = decoder.decode(res.signedTransaction).signatures[walletAddress];
        if (!signature) throw new Error("Wallet did not return a signature");
        out.push({ [walletAddress]: signature });
      }
      return out;
    },
  };
}
