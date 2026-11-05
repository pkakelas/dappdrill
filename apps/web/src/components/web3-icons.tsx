import type { ChainInfo, WalletProfileId } from "@dappdrill/core";
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

export function WalletIcon({ wallet }: { wallet: WalletProfileId }) {
  return <img src={`/icons/${wallet}.svg`} alt="" className={LOGO} />;
}

/** Testnets share their mainnet's logo. Chains we have no logo for get a plain one. */
export function ChainIcon({ chain }: { chain: Pick<ChainInfo, "id"> }) {
  const logo = CHAIN_LOGOS[chain.id];
  return logo ? <img src={`/icons/${logo}.svg`} alt="" className={LOGO} /> : <Network className={`${LOGO} text-muted-foreground`} />;
}
