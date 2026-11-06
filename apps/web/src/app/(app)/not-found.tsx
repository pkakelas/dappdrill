import Link from "next/link";
import { PageMessage } from "@/components/page-message";
import { Button } from "@/components/ui/button";

/** A bad app, test or run id, or one in an organization this person isn't in. The header stays. */
export default function NotFound() {
  return (
    <PageMessage
      title="We couldn't find that"
      actions={
        <Button asChild>
          <Link href="/">Back to your apps</Link>
        </Button>
      }
    >
      It may have been deleted, or it belongs to an organization you&apos;re not in.
    </PageMessage>
  );
}
