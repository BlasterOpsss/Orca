import type { TransactionPartialSigner } from "@solana/kit";
import { launchToken, type Network } from "./launch";
import { connectWallet, listWallets } from "./wallet";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const networkSel = $<HTMLSelectElement>("network");
const walletSel = $<HTMLSelectElement>("wallet");
const connectBtn = $<HTMLButtonElement>("connect");
const accountEl = $("account");
const form = $<HTMLFormElement>("launch-form");
const summaryEl = $("summary");
const launchBtn = $<HTMLButtonElement>("launch");
const logCard = $("log-card");
const logEl = $("log");
const resultEl = $("result");

let signer: TransactionPartialSigner | null = null;

function fillWallets() {
  const wallets = listWallets();
  walletSel.replaceChildren(
    ...wallets.map((w, i) => new Option(w.name, String(i))),
  );
  if (wallets.length === 0) {
    walletSel.replaceChildren(new Option("No Solana wallet found", ""));
    connectBtn.disabled = true;
  }
}
fillWallets();
window.addEventListener("load", fillWallets); // some wallets register late

const explorer = (kind: "address" | "tx", value: string, net: Network) =>
  `https://explorer.solana.com/${kind}/${value}${net === "devnet" ? "?cluster=devnet" : ""}`;

function link(kind: "address" | "tx", value: string, net: Network): HTMLAnchorElement {
  const a = document.createElement("a");
  a.href = explorer(kind, value, net);
  a.target = "_blank";
  a.rel = "noreferrer";
  a.textContent = value;
  return a;
}

networkSel.addEventListener("change", () => {
  signer = null; // chain changed, reconnect
  form.hidden = true;
  accountEl.textContent = "";
  connectBtn.textContent = "Connect wallet";
});

connectBtn.addEventListener("click", async () => {
  try {
    const wallet = listWallets()[Number(walletSel.value)];
    if (!wallet) return;
    signer = await connectWallet(wallet, networkSel.value as Network);
    accountEl.textContent = `Connected: ${signer.address}`;
    connectBtn.textContent = "Reconnect";
    form.hidden = false;
    updateSummary();
  } catch (e) {
    accountEl.textContent = e instanceof Error ? e.message : String(e);
  }
});

function readForm() {
  const f = new FormData(form);
  const supply = BigInt(String(f.get("supply")).split(".")[0] || "0");
  const liquidity = Number(f.get("liquidity"));
  const price = Number(f.get("price"));
  return {
    decimals: Number(f.get("decimals")),
    supply,
    liquidity,
    price,
    revoke: f.get("revoke") === "on",
  };
}

function updateSummary() {
  const v = readForm();
  const lpTokens = (Number(v.supply) * v.liquidity) / 100;
  const sol = lpTokens * v.price;
  summaryEl.textContent =
    `You'll deposit about ${lpTokens.toLocaleString()} tokens and ${sol.toLocaleString(undefined, { maximumSignificantDigits: 6 })} SOL ` +
    `into the pool, plus network and pool-creation fees. FDV at launch ≈ ${(Number(v.supply) * v.price).toLocaleString(undefined, { maximumSignificantDigits: 6 })} SOL.`;
}
form.addEventListener("input", updateSummary);

form.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  if (!signer) return;
  const net = networkSel.value as Network;
  const v = readForm();

  if (net === "mainnet" && !confirm("This will spend real SOL on mainnet. Continue?")) return;

  launchBtn.disabled = true;
  logCard.hidden = false;
  logEl.replaceChildren();
  resultEl.replaceChildren();

  try {
    const res = await launchToken(
      signer,
      {
        network: net,
        decimals: v.decimals,
        supply: v.supply,
        liquidityPercent: v.liquidity,
        priceSol: v.price,
        revokeMintAuthority: v.revoke,
      },
      (m) => {
        const li = document.createElement("li");
        li.textContent = m;
        logEl.append(li);
      },
    );

    const rows: [string, HTMLElement | string][] = [
      ["Token mint", link("address", res.mint, net)],
      ["Orca pool", link("address", res.pool, net)],
      ["Position NFT", link("address", res.positionMint, net)],
      ["Deposited", `${res.tokensDeposited} raw tokens + ${res.solDeposited} SOL`],
    ];
    const dl = document.createElement("dl");
    for (const [k, val] of rows) {
      const dt = document.createElement("dt");
      dt.textContent = k;
      const dd = document.createElement("dd");
      dd.append(val);
      dl.append(dt, dd);
    }
    resultEl.append(dl);
  } catch (e) {
    const li = document.createElement("li");
    li.className = "error";
    li.textContent = e instanceof Error ? e.message : String(e);
    logEl.append(li);
  } finally {
    launchBtn.disabled = false;
  }
});
