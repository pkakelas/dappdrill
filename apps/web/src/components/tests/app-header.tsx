import { chainName, shortAddress, type WalletProfileId } from "@dappdrill/core";
import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { ChainIcon, WALLET_NAME, WalletIcon } from "@/components/web3-icons";
import { hostFromUrl, plural } from "@/lib/format";
import { AppIcon } from "./app-icon";

/** How many chain icons the header shows side by side; the count beside them says the rest. */
const CHAIN_ICONS = 4;

/** The account with a key of its own that the tests use, or that pays for each new one. */
export interface TestAccount {
  kept: boolean;
  address: string;
  /** What it holds on the app's first chain ("0.42 ETH"), when the chain answered. */
  balance?: string;
}

const DOT = <span aria-hidden="true">·</span>;

/** The top of an app: what it is and where it runs in one line, and the one thing to do. */
export function AppHeader({
  appId,
  name,
  url,
  wallet,
  chains,
  chainUnseen,
  account,
  action,
}: {
  appId: string;
  name: string;
  url: string;
  wallet?: WalletProfileId;
  /** The chains the owner named or the app was seen to use, the first being the one the wallet starts on. */
  chains: number[];
  /** The app was explored and asked the wallet for no chain, so nothing is known yet. */
  chainUnseen?: boolean;
  account?: TestAccount;
  action?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-4 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 items-center gap-4">
        <AppIcon appId={appId} name={name} className="size-12 rounded-xl" />
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="truncate text-2xl font-semibold tracking-tight">{name}</h1>
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
            <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 hover:text-foreground">
              {hostFromUrl(url)}
              <ArrowUpRight aria-hidden="true" className="size-3.5 opacity-60" />
            </a>
            {wallet && (
              <>
                {DOT}
                <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                  <WalletIcon wallet={wallet} className="size-4" />
                  {WALLET_NAME[wallet]}
                </span>
              </>
            )}
            {chains.length > 0 && (
              <>
                {DOT}
                <span title={chains.length > 1 ? chains.map(chainName).join(", ") : undefined} className="inline-flex items-center gap-1.5 whitespace-nowrap">
                  <span className="flex gap-1">
                    {chains.slice(0, CHAIN_ICONS).map((id) => (
                      <ChainIcon key={id} chain={{ id }} className="size-4 rounded-full" />
                    ))}
                  </span>
                  {chains.length === 1 ? chainName(chains[0]!) : plural(chains.length, "chain")}
                </span>
              </>
            )}
            {chainUnseen && (
              <>
                {DOT}
                <Link
                  href={`/apps/${appId}/settings#chains`}
                  title="Your app hasn't asked the wallet for a chain yet, so the wallet starts on Ethereum. We add each chain as the app asks for it, or you can name them in Settings."
                  className="whitespace-nowrap hover:text-foreground hover:underline hover:underline-offset-4"
                >
                  No chain seen yet
                </Link>
              </>
            )}
            {account && (
              <>
                {DOT}
                <Link
                  href={`/apps/${appId}/settings#account`}
                  title={account.kept ? "The account every test signs with" : "The account that pays each test's new account"}
                  className="whitespace-nowrap hover:text-foreground hover:underline hover:underline-offset-4"
                >
                  {account.kept ? "Account" : "Paid from"} <span className="font-mono text-[13px]">{shortAddress(account.address)}</span>
                  {account.balance && <span className="tabular-nums">, {account.balance}</span>}
                </Link>
              </>
            )}
          </div>
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </header>
  );
}
