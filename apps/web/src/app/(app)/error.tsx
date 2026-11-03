"use client";

import Link from "next/link";
import { Empty } from "@/components/ui";

/** A page threw. Say so plainly and offer a way on; the digest helps match server logs. */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="page">
      <Empty
        title="This page didn't load"
        action={
          <>
            <button type="button" className="btn btn-primary" onClick={reset}>
              Try again
            </button>
            <Link href="/" className="btn">
              Go to overview
            </Link>
          </>
        }
      >
        Something went wrong on our side. Your scans and flows are not affected.
        {error.digest && <span className="mt-2 block font-mono text-2xs">Ref {error.digest}</span>}
      </Empty>
    </div>
  );
}
