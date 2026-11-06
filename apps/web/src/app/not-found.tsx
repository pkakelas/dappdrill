import type { Metadata } from "next";
import Link from "next/link";
import { PageMessage } from "@/components/page-message";
import { Logo } from "@/components/ui";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Page not found" };

/** Any address that isn't a page. Pages inside the app have their own, under the header. */
export default function NotFound() {
  return (
    <>
      <header className="border-b">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2">
            <Logo size={18} />
            <span className="font-semibold">DappDrill</span>
          </Link>
        </div>
      </header>
      <main>
        <PageMessage
          title="Page not found"
          actions={
            <Button asChild>
              <Link href="/">Go to DappDrill</Link>
            </Button>
          }
        >
          There&apos;s nothing at this address. Check the link, or start from the home page.
        </PageMessage>
      </main>
    </>
  );
}
