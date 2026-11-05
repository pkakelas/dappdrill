import { Compass, Link2, ListChecks, Play } from "lucide-react";
import type { Metadata } from "next";
import { NewAppForm } from "@/components/new-app-form";

export const metadata: Metadata = { title: "New app" };

const STEPS = [
  { icon: Link2, tint: "bg-pink-500/10 text-pink-600 dark:text-pink-400", title: "Add your app", detail: "Its URL, wallet and chain" },
  { icon: Compass, tint: "bg-sky-500/10 text-sky-600 dark:text-sky-400", title: "We explore it", detail: "With a test wallet, like a real user" },
  { icon: ListChecks, tint: "bg-violet-500/10 text-violet-600 dark:text-violet-400", title: "You get tests", detail: "One per flow, yours to edit" },
  { icon: Play, tint: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400", title: "We run them", detail: "On local forks, never mainnet" },
];

export default function NewAppPage() {
  return (
    <div className="page pt-10 sm:pt-16">
      <div className="flex flex-col gap-8">
        <header className="mx-auto flex max-w-xl flex-col gap-2 text-center">
          <h1 className="text-3xl font-semibold tracking-tight">Add your dApp</h1>
          <p className="text-base text-balance text-muted-foreground">Paste its URL and DappDrill turns the main flows into tests.</p>
        </header>
        <NewAppForm>
          <ol className="grid gap-5 pt-2 sm:grid-cols-4 sm:gap-4">
            {STEPS.map(({ icon: Icon, tint, title, detail }, index) => (
              <li
                key={title}
                className="relative flex gap-3 after:absolute after:top-11 after:-bottom-4 after:left-[18px] after:w-px after:bg-border last:after:hidden sm:flex-col sm:gap-2.5 sm:after:top-[18px] sm:after:right-[-0.5rem] sm:after:bottom-auto sm:after:left-11 sm:after:h-px sm:after:w-auto"
              >
                <span className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${tint}`}>
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
        </NewAppForm>
      </div>
    </div>
  );
}
