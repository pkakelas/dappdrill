import { KNOWN_CHAINS } from "@dappdrill/core";

/** The chains a form offers by name: every one we know but a local node, which is given by its RPC URL. */
export const CHAINS = KNOWN_CHAINS.filter((c) => c.id !== 31337);

/** As a picker lists them. */
export const CHAIN_GROUPS = [
  { label: "Mainnets", chains: CHAINS.filter((c) => !c.testnet) },
  { label: "Testnets", chains: CHAINS.filter((c) => c.testnet) },
];
