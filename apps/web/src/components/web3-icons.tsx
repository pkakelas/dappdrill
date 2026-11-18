import { type ChainInfo, type WalletProfileId } from "@dappdrill/core";
import { Network } from "lucide-react";
import { cx } from "@/components/ui";

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

export const WALLET_NAME: Record<WalletProfileId, string> = { metamask: "MetaMask", rabby: "Rabby", coinbase: "Coinbase Wallet" };
/** The wallets a form offers, in the order it lists them. */
export const WALLETS = (Object.entries(WALLET_NAME) as [WalletProfileId, string][]).map(([id, name]) => ({ id, name }));

/** A logo is decoration: its name is written beside it. */
export function WalletIcon({ wallet, className }: { wallet: WalletProfileId; className?: string }) {
  return <img src={`/icons/${wallet}.svg`} alt="" className={cx(LOGO, className)} />;
}

/** Testnets share their mainnet's logo. Chains we have no logo for get a plain one. */
export function ChainIcon({ chain, className }: { chain: Pick<ChainInfo, "id">; className?: string }) {
  const logo = CHAIN_LOGOS[chain.id];
  if (logo) return <img src={`/icons/${logo}.svg`} alt="" className={cx(LOGO, className)} />;
  return <Network className={cx(LOGO, "text-muted-foreground", className)} aria-hidden="true" />;
}
