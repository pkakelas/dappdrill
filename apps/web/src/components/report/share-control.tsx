import { Link2 } from "lucide-react";
import { setShareAction } from "@/actions/results";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { env } from "@/lib/env";
import { CopyButton } from "./copy-button";

export function ShareControl({ appId, shareToken, scanId }: { appId: string; shareToken: string | null; scanId?: string }) {
  if (!shareToken) {
    return (
      <form action={setShareAction}>
        <input type="hidden" name="appId" value={appId} />
        <input type="hidden" name="on" value="1" />
        <Button type="submit" variant="outline" size="sm">
          Share report
        </Button>
      </form>
    );
  }
  const url = `${env.appUrl}/share/${shareToken}${scanId ? `?scan=${scanId}` : ""}`;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          <Link2 /> Shared
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="flex w-80 flex-col gap-3">
        <p className="text-sm text-muted-foreground">Anyone with this link can read this app&apos;s reports. They can&apos;t change anything.</p>
        <Input readOnly value={url} className="font-mono text-xs" aria-label="Share link" />
        <div className="flex gap-2">
          <CopyButton text={url} label="Copy link" />
          <form action={setShareAction}>
            <input type="hidden" name="appId" value={appId} />
            <input type="hidden" name="on" value="0" />
            <Button type="submit" variant="ghost" size="sm">
              Turn off
            </Button>
          </form>
        </div>
      </PopoverContent>
    </Popover>
  );
}
