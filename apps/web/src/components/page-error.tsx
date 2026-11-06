"use client";

import { useEffect } from "react";
import { PageMessage } from "@/components/page-message";
import { Button } from "@/components/ui/button";

/** What a page shows when it, or an action on it, threw. Next passes these to every error.tsx. */
export function PageError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <PageMessage
      title="Something went wrong"
      actions={
        <>
          <Button type="button" onClick={reset}>
            Try again
          </Button>
          <Button asChild variant="outline">
            {/* A full load, not a client navigation: whatever broke is thrown away. */}
            <a href="/">Back to your apps</a>
          </Button>
        </>
      }
    >
      That&apos;s on our side, not something you did. Nothing was lost.{error.digest && ` If it keeps happening, tell us this code: ${error.digest}.`}
    </PageMessage>
  );
}
