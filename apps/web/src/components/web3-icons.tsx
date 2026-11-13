import { chainName, type ChainInfo, type WalletProfileId } from "@dappdrill/core";
import { Network } from "lucide-react";

// Logos in public/icons come from web3icons (MIT).
const LOGO = "size-[18px] shrink-0";

const CHAIN_LOGOS: Record<number, string> = {
  1: "ethereum",
  8453: "base",
  42161: "arbitrum",
  10: "optimism",
  137: "polygon",
  56: "bnb",
  11155111: "ethereum",
  84532: "base",
  421614: "arbitrum",
  11155420: "optimism",
};

const WALLET_NAME: Record<WalletProfileId, string> = { metamask: "MetaMask", rabby: "Rabby", coinbase: "Coinbase Wallet" };

/** `labelled` is for a logo with no name beside it: it then carries the name itself. */
export function WalletIcon({ wallet, labelled }: { wallet: WalletProfileId; labelled?: boolean }) {
  const name = labelled ? WALLET_NAME[wallet] : undefined;
  return <img src={`/icons/${wallet}.svg`} alt={name ?? ""} title={name} className={LOGO} />;
}

/** Testnets share their mainnet's logo. Chains we have no logo for get a plain one. */
export function ChainIcon({ chain, labelled }: { chain: Pick<ChainInfo, "id">; labelled?: boolean }) {
  const logo = CHAIN_LOGOS[chain.id];
  const name = labelled ? chainName(chain.id) : undefined;
  if (logo) return <img src={`/icons/${logo}.svg`} alt={name ?? ""} title={name} className={LOGO} />;
  return (
    <span role={name ? "img" : undefined} aria-label={name} title={name} className="inline-flex">
      <Network className={`${LOGO} text-muted-foreground`} aria-hidden="true" />
    </span>
  );
}
