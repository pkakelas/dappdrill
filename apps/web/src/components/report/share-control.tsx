import { setShareAction } from "@/actions/results";
import { env } from "@/lib/env";
import { CopyButton } from "./copy-button";

export function ShareControl({ appId, shareToken, scanId }: { appId: string; shareToken: string | null; scanId?: string }) {
  if (!shareToken) {
    return (
      <form action={setShareAction}>
        <input type="hidden" name="appId" value={appId} />
        <input type="hidden" name="on" value="1" />
        <button type="submit" className="btn btn-sm">
          Share report
        </button>
      </form>
    );
  }
  const url = `${env.appUrl}/share/${shareToken}${scanId ? `?scan=${scanId}` : ""}`;
  return (
    <details className="relative">
      <summary className="btn btn-sm">Shared · link</summary>
      <div className="absolute right-0 z-20 mt-2 flex w-[min(360px,calc(100vw-32px))] flex-col gap-3 rounded-xl border border-line bg-card p-4 shadow-[0_8px_24px_rgba(23,24,28,0.1)]">
        <p className="m-0 text-[13px] text-muted">Anyone with this link can read this app&apos;s reports. They can&apos;t change anything.</p>
        <input readOnly value={url} className="field font-mono text-xs" aria-label="Share link" />
        <div className="flex gap-2">
          <CopyButton text={url} label="Copy link" />
          <form action={setShareAction}>
            <input type="hidden" name="appId" value={appId} />
            <input type="hidden" name="on" value="0" />
            <button type="submit" className="btn btn-sm">
              Turn off
            </button>
          </form>
        </div>
      </div>
    </details>
  );
}
