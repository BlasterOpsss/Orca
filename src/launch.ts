/**
 * Launchpad core. Runs unchanged in Node (CLI) and in the browser (wallet signer).
 *
 * Flow:
 *   1. Create an SPL mint, mint the full supply to the creator, drop the mint + freeze authority.
 *   2. Create an Orca Splash pool (token / wSOL) at the chosen starting price.
 *   3. Open a full-range position seeded with the share of supply set aside for liquidity.
 */
import {
  appendTransactionMessageInstructions,
  createSolanaRpc,
  createTransactionMessage,
  generateKeyPairSigner,
  getBase64EncodedWireTransaction,
  getSignatureFromTransaction,
  none,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type Address,
  type Instruction,
  type Rpc,
  type SolanaRpcApi,
  type TransactionSigner,
} from "@solana/kit";
import { getCreateAccountInstruction } from "@solana-program/system";
import {
  AuthorityType,
  TOKEN_PROGRAM_ADDRESS,
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstruction,
  getInitializeMint2Instruction,
  getMintSize,
  getMintToInstruction,
  getSetAuthorityInstruction,
} from "@solana-program/token";
import {
  createSplashPoolInstructions,
  openFullRangePositionInstructions,
} from "@orca-so/whirlpools";
import { fetchWhirlpool, WhirlpoolDeployment } from "@orca-so/whirlpools-client";

export type Network = "devnet" | "mainnet";
type PoolConfig = NonNullable<Parameters<typeof createSplashPoolInstructions>[3]>;
export type Deployment = PoolConfig["whirlpoolDeployment"];

export const WSOL_MINT = "So11111111111111111111111111111111111111112" as Address;

export const DEFAULT_RPC: Record<Network, string> = {
  devnet: "https://api.devnet.solana.com",
  mainnet: "https://api.mainnet-beta.solana.com",
};

export interface LaunchParams {
  network: Network;
  rpcUrl?: string;
  /** Token decimals, 0-9. */
  decimals: number;
  /** Total supply in whole tokens. */
  supply: bigint;
  /** Percent (1-100) of supply that goes into the Orca pool. The rest stays with the creator. */
  liquidityPercent: number;
  /** Starting price: SOL per 1 token. */
  priceSol: number;
  /** Remove mint authority after minting so supply is fixed. Default true. */
  revokeMintAuthority?: boolean;
  /** Slippage tolerance for the liquidity deposit, in basis points. Default 100. */
  slippageBps?: number;
  /** Orca deployment (program + config); needed for devnet. */
  whirlpoolDeployment?: Deployment;
}

export interface LaunchResult {
  mint: Address;
  pool: Address;
  positionMint: Address;
  tokensDeposited: string;
  solDeposited: string;
  signatures: { token: string; pool: string; position: string };
}

export type Progress = (message: string) => void;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const jsonSafe = (v: unknown) =>
  JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x));

async function sendAndConfirm(
  rpc: Rpc<SolanaRpcApi>,
  payer: TransactionSigner,
  instructions: Instruction[],
): Promise<string> {
  const { value: latestBlockhash } = await rpc
    .getLatestBlockhash({ commitment: "confirmed" })
    .send();

  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(payer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
    (m) => appendTransactionMessageInstructions(instructions, m),
  );

  // Signs with every signer embedded in the instructions (e.g. the new mint keypair) plus the payer.
  const signed = await signTransactionMessageWithSigners(message);
  const signature = getSignatureFromTransaction(signed);

  await rpc
    .sendTransaction(getBase64EncodedWireTransaction(signed), {
      encoding: "base64",
      preflightCommitment: "confirmed",
    })
    .send();

  for (let i = 0; i < 60; i++) {
    const { value } = await rpc.getSignatureStatuses([signature]).send();
    const status = value[0];
    if (status?.err) throw new Error(`Transaction ${signature} failed: ${jsonSafe(status.err)}`);
    if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") {
      return signature;
    }
    await sleep(1000);
  }
  throw new Error(`Timed out waiting for confirmation of ${signature}`);
}

function validate(p: LaunchParams) {
  if (!Number.isInteger(p.decimals) || p.decimals < 0 || p.decimals > 9)
    throw new Error("decimals must be an integer from 0 to 9");
  if (p.supply <= 0n) throw new Error("supply must be greater than 0");
  if (!Number.isInteger(p.liquidityPercent) || p.liquidityPercent < 1 || p.liquidityPercent > 100)
    throw new Error("liquidityPercent must be an integer from 1 to 100");
  if (!(p.priceSol > 0) || !Number.isFinite(p.priceSol))
    throw new Error("priceSol must be a positive number");
}

export async function launchToken(
  payer: TransactionSigner,
  params: LaunchParams,
  onProgress: Progress = () => {},
): Promise<LaunchResult> {
  validate(params);
  const rpc = createSolanaRpc(params.rpcUrl ?? DEFAULT_RPC[params.network]);
  const deployment =
    params.whirlpoolDeployment ??
    (params.network === "devnet" ? WhirlpoolDeployment.devnet : WhirlpoolDeployment.mainnet);

  // ---- 1. Token ---------------------------------------------------------
  onProgress("Creating token and minting supply…");
  const mint = await generateKeyPairSigner();
  const [payerAta] = await findAssociatedTokenPda({
    owner: payer.address,
    mint: mint.address,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
  });
  const space = getMintSize();
  const rent = await rpc.getMinimumBalanceForRentExemption(BigInt(space)).send();
  const rawSupply = params.supply * 10n ** BigInt(params.decimals);

  const tokenIxs: Instruction[] = [
    getCreateAccountInstruction({
      payer,
      newAccount: mint,
      lamports: rent,
      space,
      programAddress: TOKEN_PROGRAM_ADDRESS,
    }),
    getInitializeMint2Instruction({
      mint: mint.address,
      decimals: params.decimals,
      mintAuthority: payer.address,
      freezeAuthority: null, // never keep a freeze authority on a launch
    }),
    getCreateAssociatedTokenIdempotentInstruction({
      payer,
      ata: payerAta,
      owner: payer.address,
      mint: mint.address,
    }),
    getMintToInstruction({
      mint: mint.address,
      token: payerAta,
      mintAuthority: payer,
      amount: rawSupply,
    }),
  ];
  if (params.revokeMintAuthority ?? true) {
    tokenIxs.push(
      getSetAuthorityInstruction({
        owned: mint.address,
        owner: payer,
        authorityType: AuthorityType.MintTokens,
        newAuthority: none(),
      }),
    );
  }
  const tokenSig = await sendAndConfirm(rpc, payer, tokenIxs);
  onProgress(`Token created: ${mint.address}`);

  // ---- 2. Orca Splash pool ---------------------------------------------
  onProgress("Creating Orca Splash pool…");
  const { instructions: poolIxs, poolAddress } = await createSplashPoolInstructions(
    rpc,
    mint.address,
    WSOL_MINT,
    { initialPrice: params.priceSol, funder: payer, whirlpoolDeployment: deployment },
  );
  const poolSig = await sendAndConfirm(rpc, payer, poolIxs);
  onProgress(`Pool created: ${poolAddress}`);

  // ---- 3. Seed liquidity ------------------------------------------------
  onProgress("Seeding full-range liquidity…");
  const pool = await fetchWhirlpool(rpc, poolAddress);
  // Orca orders the pair by mint bytes, so find which side our token landed on.
  const tokenIsA = pool.data.tokenMintA === mint.address;
  const tokenAmount = (rawSupply * BigInt(params.liquidityPercent)) / 100n;
  // SOL the pool will want at its actual on-chain price, plus a 5% cushion.
  const sqrt = pool.data.sqrtPrice;
  const priceX128 = sqrt * sqrt; // (B per A, raw units) * 2^128
  const Q128 = 1n << 128n;
  const solNeeded = tokenIsA
    ? (tokenAmount * priceX128 + Q128 - 1n) / Q128
    : (tokenAmount * Q128 + priceX128 - 1n) / priceX128;
  const solMax = (solNeeded * 105n) / 100n + 1n;
  const param = tokenIsA
    ? { tokenMaxA: tokenAmount, tokenMaxB: solMax }
    : { tokenMaxA: solMax, tokenMaxB: tokenAmount };

  const { instructions: positionIxs, positionMint } = await openFullRangePositionInstructions(
    rpc,
    poolAddress,
    param,
    {
      slippageToleranceBps: params.slippageBps ?? 100,
      funder: payer,
      whirlpoolDeployment: deployment,
    },
  );
  const positionSig = await sendAndConfirm(rpc, payer, positionIxs);
  onProgress("Liquidity added. Launch complete.");

  const solEstimate = Number(solNeeded) / 1e9;

  return {
    mint: mint.address,
    pool: poolAddress,
    positionMint,
    tokensDeposited: tokenAmount.toString(),
    solDeposited: `~${solEstimate}`,
    signatures: { token: tokenSig, pool: poolSig, position: positionSig },
  };
}
