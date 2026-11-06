import { BOT_GUIDE_URL, describeBlock } from "@dappdrill/core";
import Link from "next/link";
import { exploreAction } from "@/actions/explore";
import { Button } from "@/components/ui/button";
import type { Pass } from "@/lib/explore";

/** Why a pass ended with no tests, and the way to try again. */
export function PassNotice({ pass, appId, suggested }: { pass: Pass; appId: string; suggested: number }) {
  const add = suggested > 0 ? "Add one of the suggested tests below, write one yourself" : "Write a test yourself";
  let title = "It didn't find a test that passes";
  let body: React.ReactNode = `${add}, or add a note in Settings about where to look and explore again.`;
  if (pass.blocked) {
    title = describeBlock(pass.blocked);
    body = (
      <>
        {/* With no provider it may be the app refusing this wallet, which a header won't fix. */}
        It stopped at <span className="font-mono text-xs break-all">{pass.blocked.url}</span>. {pass.blocked.provider ? "DappDrill doesn't solve CAPTCHAs: add" : `${pass.blocked.reason} If a bot check did this, add`} an allowlist header in{" "}
        <Link href={`/apps/${appId}/settings#access`} className="text-foreground underline underline-offset-4">
          Settings
        </Link>{" "}
        (
        <a href={BOT_GUIDE_URL} className="text-foreground underline underline-offset-4">
          how
        </a>
        ), then explore again.
      </>
    );
  } else if (pass.state?.stopped) {
    title = "It couldn't get into the app";
    body = pass.state.stopped;
  } else if (pass.status === "failed") {
    title = "Something went wrong exploring the app";
    body = pass.error ? `It stopped with: ${pass.error}` : "Explore again; if it keeps happening, add a note in Settings.";
  } else if (pass.status === "stopped") {
    title = "Stopped before any test passed";
    body = `${add}, or explore again when you're ready.`;
  }
  return (
    <section className="flex flex-col items-start gap-3 rounded-xl border bg-card p-6 shadow-xs">
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="max-w-prose text-sm leading-relaxed text-pretty text-muted-foreground">{body}</p>
      <form action={exploreAction.bind(null, appId)}>
        <Button type="submit" size="sm">
          Explore again
        </Button>
      </form>
    </section>
  );
}
