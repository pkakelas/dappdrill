import { setShareAction } from "@/actions/results";
import { ActionButton, Popover } from "@/components/ui";
import { env } from "@/lib/env";
import { CopyButton } from "./copy-button";

export function ShareControl({ appId, shareToken, scanId }: { appId: string; shareToken: string | null; scanId?: string }) {
  if (!shareToken) {
    return (
      <ActionButton action={setShareAction} fields={{ appId, on: "1" }} className="btn-sm" pendingText="Sharing…">
        Share report
      </ActionButton>
    );
  }
  const url = `${env.appUrl}/share/${shareToken}${scanId ? `?scan=${scanId}` : ""}`;
  return (
    <Popover label="Share link" align="right" buttonClassName="btn btn-sm" panelClassName="flex w-[360px] flex-col gap-3" button="Shared · link">
      <p className="meta m-0">Anyone with this link can read this app&apos;s reports. They can&apos;t change anything.</p>
      <input readOnly value={url} className="field field-sm font-mono text-xs" aria-label="Share link" />
      <div className="flex gap-2">
        <CopyButton text={url} label="Copy link" />
        <ActionButton action={setShareAction} fields={{ appId, on: "0" }} className="btn-sm" confirm="Turn off?">
          Turn off
        </ActionButton>
      </div>
    </Popover>
  );
}
