import { Bug, Compass, ListChecks } from "lucide-react";
import { Tile } from "@/components/tests/tile";
import { cn } from "@/lib/utils";

// The same three steps the app's page counts off while its first tests are generated (`makeStages` in tests/working.tsx).
const STEPS = [
  { icon: Compass, tint: "live", title: "Explore your app", detail: "Like a real user, with a test wallet" },
  { icon: ListChecks, tint: "violet", title: "Generate tests", detail: "One for each thing users do there" },
  { icon: Bug, tint: "pink", title: "Review", detail: "The bugs we found, and our questions" },
] as const;

/** The process in three numbered steps: a column on phones, a row from `sm` up. `centered` centres each step in its column of the row. */
export function HowItWorks({ centered, className }: { centered?: boolean; className?: string }) {
  return (
    <ol className={cn("grid gap-5 sm:grid-cols-3 sm:gap-4", className)}>
      {STEPS.map(({ icon, tint, title, detail }, index) => (
        <li
          key={title}
          className={cn(
            "relative flex gap-3 after:absolute after:top-11 after:-bottom-4 after:left-[18px] after:w-px after:bg-border last:after:hidden sm:flex-col sm:gap-2.5 sm:after:top-[18px] sm:after:right-[-0.5rem] sm:after:bottom-auto sm:after:left-11 sm:after:h-px sm:after:w-auto",
            // The line stops 26px short of this icon's centre and of the next one, a column plus the 1rem gap away.
            centered && "sm:items-center sm:text-center sm:text-balance sm:after:right-[calc(10px-50%)] sm:after:left-[calc(50%+26px)]",
          )}
        >
          <Tile icon={icon} tint={tint} />
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
  return <HowItWorks centered className="relative left-1/2 mt-14 w-[calc(100vw-2rem)] max-w-sm -translate-x-1/2 sm:max-w-2xl" />;
}
