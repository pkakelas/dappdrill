import { chainName, type WalletProfileId } from "@dappdrill/core";
import { BadgeCheck, MousePointerClick, ScanSearch, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { makeTestsAction } from "@/actions/tests";
import { SitePreview } from "@/components/site-preview";
import { SubmitButton } from "@/components/submit-button";
import { ChainIcon, WALLET_NAME, WalletIcon } from "@/components/web3-icons";
import { hostFromUrl } from "@/lib/format";
import type { SiteInfo } from "@/lib/site";
import { AddTestButton } from "./add-test";
import { Tile, type TINT } from "./tile";

function Step({ icon, tint, title, last, children }: { icon: LucideIcon; tint: keyof typeof TINT; title: string; last?: boolean; children: ReactNode }) {
  return (
    <li className="relative flex gap-3.5 pb-6 last:pb-0">
      {/* The thread from one step's tile to the next. */}
      {!last && <span aria-hidden="true" className="absolute top-11 bottom-2 left-[17.5px] w-px bg-border" />}
      <Tile icon={icon} tint={tint} />
      <div className="flex min-w-0 flex-col gap-0.5 pt-0.5">
        <p className="text-sm leading-snug font-medium">{title}</p>
        <p className="text-sm text-pretty text-muted-foreground">{children}</p>
      </div>
    </li>
  );
}

/**
 * An app with no tests yet: the site in our browser, what making its tests will do, and the two ways to start.
 * It has the shape of the band that shows while tests are made, so starting swaps one for the other in place.
 */
export function StartBand({ appId, url, site, wallet, chainId, live }: { appId: string; url: string; site: SiteInfo; wallet?: WalletProfileId; chainId?: number; live?: string }) {
  const chain = chainId === undefined ? undefined : chainName(chainId);
  const where = live ? `on ${live} for real, since it can't be forked` : chain ? `on a local ${chain} fork, never mainnet` : "on a local fork, never mainnet";
  return (
    <section aria-label="Make tests" className="grid gap-8 md:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] md:gap-12">
      <div className="aspect-[16/10] md:aspect-auto md:min-h-80">
        <SitePreview
          site={site}
          open
          toolbar={
            <>
              {wallet && <WalletIcon wallet={wallet} className="size-4" />}
              {chainId !== undefined && <ChainIcon chain={{ id: chainId }} className="size-4 rounded-full" />}
            </>
          }
        />
      </div>

      <div className="order-first flex flex-col gap-7 md:order-none md:py-2">
        <div className="flex flex-col gap-2">
          <p className="text-sm text-muted-foreground">No tests yet</p>
          <h2 className="text-2xl font-semibold tracking-tight text-balance">Make tests for {hostFromUrl(url)}</h2>
        </div>

        <ol className="flex flex-col">
          <Step icon={ScanSearch} tint="live" title="We look over the app">
            And list what users come here to do. Nothing is signed.
          </Step>
          <Step icon={MousePointerClick} tint="fork" title="We do each one, like a user">
            With a {wallet ? WALLET_NAME[wallet] : "test"} wallet {where}.
          </Step>
          <Step icon={BadgeCheck} tint="good" title="Each becomes a test you can read" last>
            Written as plain sentences, and kept once it goes the same way twice in a row.
          </Step>
        </ol>

        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <form action={makeTestsAction.bind(null, appId)}>
              <SubmitButton busy="Starting…">Make tests</SubmitButton>
            </form>
            <AddTestButton appId={appId} label="Add a test" />
          </div>
          <p className="text-xs text-pretty text-muted-foreground">Takes up to an hour. You can close the page while it runs.</p>
        </div>
      </div>
    </section>
  );
}
