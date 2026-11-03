import Link from "next/link";
import { Logo } from "@/components/common";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center bg-muted/40 px-4 py-16 sm:py-24">
      <Link href="/" className="mb-8 flex items-center gap-2">
        <Logo />
        <span className="font-semibold">DappDrill</span>
      </Link>
      <div className="w-full max-w-sm">{children}</div>
    </div>
  );
}
