import Link from "next/link";
import { Empty, Logo } from "@/components/ui";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center px-4 pt-16 pb-16 sm:pt-24">
      <Link href="/" className="mb-12 flex items-center gap-2.5 no-underline">
        <Logo />
        <span className="font-serif text-[22px] tracking-[-0.02em]">DappDrill</span>
      </Link>
      <Empty
        className="w-full max-w-[480px]"
        title="Nothing here"
        action={
          <Link href="/" className="btn btn-primary">
            Go to DappDrill
          </Link>
        }
      >
        The link may be old, or the page was archived or belongs to another team.
      </Empty>
    </div>
  );
}
