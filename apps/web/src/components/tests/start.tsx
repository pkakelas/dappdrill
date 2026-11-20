import { chainName, type WalletProfileId } from "@dappdrill/core";
import { makeTestsAction } from "@/actions/tests";
import { SitePreview } from "@/components/site-preview";
import { SubmitButton } from "@/components/submit-button";
import { ChainIcon, WALLET_NAME, WalletIcon } from "@/components/web3-icons";
import { hostFromUrl } from "@/lib/format";
import type { SiteInfo } from "@/lib/site";
import { AddTest } from "./add-test";
import { Stages } from "./stages";

/**
 * An app with no tests yet: the three steps ahead, the site in our browser, and the two ways to start. It has
 * the shape of what shows while tests are generated, so starting swaps one for the other in place.
 */
export function Start({ appId, url, site, wallet, chainId, canMake }: { appId: string; url: string; site: SiteInfo; wallet?: WalletProfileId; chainId?: number; canMake: boolean }) {
  return (
    <section aria-label="Generate tests" className="flex flex-col gap-8">
      <Stages
        stages={[
          { title: "Explore your app", state: "next", detail: "We find what users come here to do. Nothing is signed." },
          { title: "Generate tests", state: "next", detail: "One for each thing a user can do, kept once it goes the same way twice." },
          { title: "Review", state: "next", detail: "The bugs we found, and anything we need from you." },
        ]}
      />
      <div className="grid gap-8 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] md:gap-10">
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

        <div className="order-first flex min-w-0 flex-col gap-5 md:order-none md:py-2">
          <h2 className="text-2xl font-semibold tracking-tight text-balance">Generate tests for {hostFromUrl(url)}</h2>
          <p className="text-sm text-pretty text-muted-foreground">
            We open your app with a {wallet ? WALLET_NAME[wallet] : "test"} wallet{chainId === undefined ? "" : ` on ${chainName(chainId)}`}, do what a user would, and write each as a test you can read and run.
          </p>
          {canMake && (
            <div className="flex flex-col gap-2">
              <form action={makeTestsAction.bind(null, appId)}>
                <SubmitButton busy="Starting…">Generate tests</SubmitButton>
              </form>
              <p className="text-xs text-pretty text-muted-foreground">Takes up to an hour. You can close the page while it runs.</p>
            </div>
          )}
          <div className="border-t pt-3">
            <div className="-mx-2">
              <AddTest appId={appId} label="Or describe one test yourself" />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
