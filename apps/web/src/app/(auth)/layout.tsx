import Link from "next/link";
import { Logo } from "@/components/ui";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center px-4 pt-16 pb-16 sm:pt-24">
      <Link href="/" className="mb-12 flex items-center gap-2.5 no-underline">
        <Logo />
        <span className="font-serif text-[22px] tracking-[-0.02em]">DappDrill</span>
      </Link>
      <div className="w-full max-w-[400px]">{children}</div>
    </div>
  );
}
