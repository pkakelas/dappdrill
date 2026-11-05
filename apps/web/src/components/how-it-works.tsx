import { Compass, Link2, ListChecks, Play } from "lucide-react";
import { cn } from "@/lib/utils";

const STEPS = [
  { icon: Link2, tint: "bg-pink-500/10 text-pink-600 dark:text-pink-400", title: "Add your app", detail: "Its URL, wallet and chain" },
  { icon: Compass, tint: "bg-sky-500/10 text-sky-600 dark:text-sky-400", title: "We explore it", detail: "With a test wallet, like a real user" },
  { icon: ListChecks, tint: "bg-violet-500/10 text-violet-600 dark:text-violet-400", title: "You get tests", detail: "In plain English, yours to edit" },
  { icon: Play, tint: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400", title: "We run them", detail: "On local forks, never mainnet" },
];

/** The process in four numbered steps: a column on phones, a row from `sm` up. `centered` centres each step in its column of the row. */
export function HowItWorks({ centered, className }: { centered?: boolean; className?: string }) {
  return (
    <ol className={cn("grid gap-5 sm:grid-cols-4 sm:gap-4", className)}>
      {STEPS.map(({ icon: Icon, tint, title, detail }, index) => (
        <li
          key={title}
          className={cn(
            "relative flex gap-3 after:absolute after:top-11 after:-bottom-4 after:left-[18px] after:w-px after:bg-border last:after:hidden sm:flex-col sm:gap-2.5 sm:after:top-[18px] sm:after:right-[-0.5rem] sm:after:bottom-auto sm:after:left-11 sm:after:h-px sm:after:w-auto",
            // The line stops 26px short of this icon's centre and of the next one, a column plus the 1rem gap away.
            centered && "sm:items-center sm:text-center sm:text-balance sm:after:right-[calc(10px-50%)] sm:after:left-[calc(50%+26px)]",
          )}
        >
          <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg", tint)}>
            <Icon className="size-[18px]" />
          </span>
          <div>
            <p className="text-sm font-medium">
              {index + 1}. {title}
            </p>
            <p className="text-sm text-muted-foreground">{detail}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

/** Under the login and signup forms. Wider than the auth column, so it centres itself on the page. */
export function AuthHowItWorks() {
  return <HowItWorks centered className="relative left-1/2 mt-14 w-[calc(100vw-2rem)] max-w-sm -translate-x-1/2 sm:max-w-3xl" />;
}
