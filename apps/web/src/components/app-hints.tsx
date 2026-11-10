"use client";

import { formatHints, HINT_LABELS, parseHints } from "@dappdrill/core";
import { BadgeCheck, Ban, Bug, CircleDollarSign, Coins, History, KeyRound, ListPlus, LogIn, MapPin, NotebookPen, Plus, Route, X, type LucideIcon } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { looksLikeKey } from "@/lib/secrets";
import { cn } from "@/lib/utils";

const MAX_TESTS = 3;
const TEST_EXAMPLES = ["e.g. Swap ETH for USDC", "e.g. Add liquidity to a pool", "e.g. Claim rewards"];
const TINT = {
  sky: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
  violet: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
  pink: "bg-pink-500/10 text-pink-600 dark:text-pink-400",
  emerald: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  amber: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
};
/** `label` is the wording in the saved hints, and in the picker for the questions you unlock. */
const CORE_TIPS = [
  { id: "access", label: HINT_LABELS.access, question: "How do we get in?", detail: "Sign-in or invite steps.", placeholder: "e.g. Sign in with the wallet", icon: LogIn, tint: TINT.violet },
  { id: "notes", label: HINT_LABELS.notes, question: "Additional notes", detail: "Anything that gets in the way of exploring.", placeholder: "e.g. A popup covers every page. Prices take a minute to load.", icon: NotebookPen, tint: TINT.amber },
] as const;
const MORE_TIPS = [
  { id: "success", label: HINT_LABELS.success, question: "How do you know it worked?", detail: "What users see when it went right.", placeholder: "e.g. The swap shows up in History", icon: BadgeCheck, tint: TINT.emerald },
  { id: "tokens", label: HINT_LABELS.tokens, question: "Which tokens and amounts?", detail: "What the tests should use.", placeholder: "e.g. USDC on Base, under 10 at a time", icon: CircleDollarSign, tint: TINT.sky },
  { id: "pages", label: HINT_LABELS.pages, question: "Any pages that are hard to find?", detail: "Not in the menu, or only behind a link.", placeholder: "e.g. /vaults/new", icon: MapPin, tint: TINT.violet },
  { id: "changed", label: HINT_LABELS.changed, question: "What did you just change?", detail: "New or reworked parts of the app.", placeholder: "e.g. The new bridge page", icon: History, tint: TINT.amber },
  { id: "breaks", label: HINT_LABELS.breaks, question: "What keeps breaking?", detail: "Bugs that came back.", placeholder: "e.g. Approvals on Arbitrum", icon: Bug, tint: TINT.pink },
  { id: "avoid", label: HINT_LABELS.avoid, question: "What should we leave alone?", detail: "Pages or actions to skip.", placeholder: "e.g. The referral page", icon: Ban, tint: TINT.pink },
] as const;
const TIPS = [...CORE_TIPS, ...MORE_TIPS];
type Tip = (typeof TIPS)[number];
type TipId = Tip["id"];
/** The tests and funds rows, plus every tip. */
const QUESTIONS = TIPS.length + 2;
// All answers together have to fit the 4,000 characters saved as hints.
const TIP_MAX = 350;
const NOTES_MAX = 600;
const MOTION = "duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none";
const HINT_FIELD = "bg-background transition-colors placeholder:text-muted-foreground/80 hover:border-foreground/25";

function KeyWarning() {
  return (
    <p role="alert" className="text-sm text-bad">
      That looks like a private key. This text isn&apos;t encrypted, so take it out.
    </p>
  );
}

type HintRowProps = {
  icon: LucideIcon;
  tint: string;
  title: string;
  detail: ReactNode;
  htmlFor?: string;
  index: number;
  shown: boolean;
  split: boolean;
  className?: string;
  children: ReactNode;
};

/** Label on the left, input on the right. When split, the input lines up with the browser above it. */
function HintRow({ icon: Icon, tint, title, detail, htmlFor, index, shown, split, className, children }: HintRowProps) {
  return (
    <div
      style={{ transitionDelay: shown ? `${150 + index * 80}ms` : undefined }}
      className={cn("grid gap-3 transition-[opacity,translate] sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] sm:gap-8", split && "lg:grid-cols-2", MOTION, !shown && "translate-y-6 opacity-0", className)}
    >
      <div className="flex gap-3">
        <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg", tint)}>
          <Icon className="size-[18px]" />
        </span>
        <div className="flex flex-col gap-0.5">
          {htmlFor ? <FieldLabel htmlFor={htmlFor}>{title}</FieldLabel> : <p className="text-sm leading-snug font-medium">{title}</p>}
          <div className="text-sm text-muted-foreground">{detail}</div>
        </div>
      </div>
      <div className="flex min-w-0 flex-col gap-3">{children}</div>
    </div>
  );
}

function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button type="button" variant="ghost" size="icon" aria-label={label} onClick={onClick} className="absolute top-1/2 right-1.5 size-8 -translate-y-1/2 text-muted-foreground">
      <X />
    </Button>
  );
}

/** What the developer wants tested, one per row. Enter moves on to the next row. */
function TestList({ tests, onChange }: { tests: string[]; onChange: (tests: string[]) => void }) {
  const canAdd = tests.length < MAX_TESTS;
  const add = () => onChange([...tests, ""]);
  const onLoad = useRef(tests.length);
  return (
    <>
      {tests.map((test, index) => (
        <div key={index} className="relative">
          <Input
            id={index === 0 ? "test-0" : undefined}
            aria-label={`Test ${index + 1}`}
            // Only rows added by hand: saved ones shouldn't scroll the page on load, or take focus from the URL.
            autoFocus={index >= onLoad.current}
            maxLength={200}
            placeholder={TEST_EXAMPLES[index]}
            value={test}
            onChange={(event) => onChange(tests.map((current, i) => (i === index ? event.target.value : current)))}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              if (canAdd && index === tests.length - 1 && test.trim()) add();
            }}
            className={cn("h-11 px-3.5", tests.length > 1 && "pr-10", HINT_FIELD)}
          />
          {tests.length > 1 && <RemoveButton label={`Remove test ${index + 1}`} onClick={() => onChange(tests.filter((_, i) => i !== index))} />}
        </div>
      ))}
      {tests.some((test) => looksLikeKey(test)) && <KeyWarning />}
      {canAdd && (
        <Button type="button" variant="ghost" size="sm" onClick={add} className="-ml-2 self-start text-muted-foreground">
          <Plus />
          Add another
        </Button>
      )}
    </>
  );
}

type TipRowProps = { tip: Tip; value: string; onChange: (value: string) => void; onRemove?: () => void; focus?: boolean; index: number; shown: boolean; split: boolean; className?: string };

/** One question. Those unlocked from the picker can be taken away again. */
function TipRow({ tip, value, onChange, onRemove, focus, ...row }: TipRowProps) {
  const field = { id: `tip-${tip.id}`, placeholder: tip.placeholder, value };
  return (
    <HintRow icon={tip.icon} tint={tip.tint} title={tip.question} detail={tip.detail} htmlFor={field.id} {...row}>
      {tip.id === "notes" ? (
        <Textarea {...field} rows={2} maxLength={Math.max(NOTES_MAX, value.length)} onChange={(event) => onChange(event.target.value)} className={cn("min-h-20 resize-none px-3.5 py-3", HINT_FIELD)} />
      ) : (
        <div className="relative">
          <Input {...field} autoFocus={focus} maxLength={TIP_MAX} onChange={(event) => onChange(event.target.value)} className={cn("h-11 px-3.5", onRemove && "pr-10", HINT_FIELD)} />
          {onRemove && <RemoveButton label={`Remove ${tip.question}`} onClick={onRemove} />}
        </div>
      )}
      {looksLikeKey(value) && <KeyWarning />}
    </HintRow>
  );
}

/** The answers to the questions, from the saved hints when there are any. */
export function useHints(saved?: { hints: string; funding: string }) {
  const [start] = useState(() => parseHints(saved?.hints ?? ""));
  const [tests, setTests] = useState(start.tests.length ? start.tests : [""]);
  const [funding, setFunding] = useState(saved?.funding ?? "");
  const [tips, setTips] = useState(() => Object.fromEntries(TIPS.map((tip) => [tip.id, start.tips[tip.id] ?? ""])) as Record<TipId, string>);
  const [unlocked, setUnlocked] = useState<TipId[]>(() => MORE_TIPS.filter((tip) => start.tips[tip.id]).map((tip) => tip.id));
  const filledTips = TIPS.filter((tip) => tips[tip.id].trim());
  const filledTests = tests.filter((test) => test.trim());
  const text = formatHints({ tests, tips });
  return {
    tests,
    setTests,
    funding,
    setFunding,
    tips,
    setTip: (id: TipId, value: string) => setTips((current) => ({ ...current, [id]: value })),
    unlocked,
    setUnlocked,
    text,
    /** Tips and tests count one each; funds are counted by the rows, which know about the key. */
    answered: filledTips.length + (filledTests.length ? 1 : 0),
    started: Boolean(funding.trim() || text || unlocked.length),
  };
}

type HintRowsProps = {
  hints: ReturnType<typeof useHints>;
  /** Shown under the funds question, for testnets. */
  keyField?: ReactNode;
  hasKey?: boolean;
  /** Off when the form asks about funds elsewhere, as it must for a chain that can't be forked. */
  fundsRow?: boolean;
  shown?: boolean;
  split?: boolean;
  rowClassName?: string;
  className?: string;
};

/** Every question, posted as `hints` and `funding`. */
export function HintRows({ hints, keyField, hasKey, fundsRow = true, shown = true, split = false, rowClassName, className }: HintRowsProps) {
  const { tests, setTests, funding, setFunding, tips, setTip, unlocked, setUnlocked } = hints;
  const row = { shown, split, className: rowClassName };
  const answered = hints.answered + (funding.trim() || hasKey ? 1 : 0);
  const locked = MORE_TIPS.filter((tip) => !unlocked.includes(tip.id));
  const onLoad = useRef(unlocked);
  return (
    <div className={cn("flex flex-col gap-7", className)}>
      <input type="hidden" name="hints" value={hints.text} readOnly />
      <HintRow icon={Route} tint={TINT.sky} title="What should we test?" detail="What users do in your app. We'll start with these." htmlFor="test-0" index={0} {...row}>
        <TestList tests={tests} onChange={setTests} />
      </HintRow>
      {fundsRow && (
      <HintRow icon={Coins} tint={TINT.emerald} title="How do we get test funds?" detail="We'll look for a way ourselves, but a hint helps." htmlFor="funding" index={1} {...row}>
        <Textarea
          id="funding"
          name="funding"
          rows={2}
          maxLength={1000}
          placeholder="e.g. Needs test USDC. The Faucet page mints 1,000 at a time."
          value={funding}
          onChange={(event) => setFunding(event.target.value)}
          className={cn("min-h-20 resize-none px-3.5 py-3", HINT_FIELD)}
        />
        {looksLikeKey(funding) && <KeyWarning />}
        {keyField}
      </HintRow>
      )}
      {CORE_TIPS.map((tip, index) => (
        <TipRow key={tip.id} tip={tip} value={tips[tip.id]} onChange={(value) => setTip(tip.id, value)} index={index + 2} {...row} />
      ))}
      {unlocked.map((id) => {
        const tip = TIPS.find((t) => t.id === id)!;
        const remove = () => {
          setTip(id, "");
          setUnlocked((current) => current.filter((other) => other !== id));
        };
        return (
          <div key={id} className="animate-in duration-300 fade-in-0 slide-in-from-top-2 motion-reduce:animate-none">
            <TipRow tip={tip} value={tips[id]} onChange={(value) => setTip(id, value)} onRemove={remove} focus={!onLoad.current.includes(id)} index={0} {...row} />
          </div>
        );
      })}
      {locked.length > 0 && (
        <HintRow
          icon={ListPlus}
          tint="bg-muted text-muted-foreground"
          title="The more you answer now, the less you do later"
          detail={
            <div className="flex items-center gap-2.5 pt-1">
              <Progress value={(answered / QUESTIONS) * 100} aria-label="Questions answered" className="h-1 w-24" />
              {answered} of {QUESTIONS} answered
            </div>
          }
          index={CORE_TIPS.length + 2}
          {...row}
        >
          <div className="flex flex-wrap gap-2">
            {locked.map((tip) => (
              <Button key={tip.id} type="button" variant="outline" size="sm" onClick={() => setUnlocked((current) => [...current, tip.id])} className="rounded-full font-normal">
                <Plus />
                {tip.label}
              </Button>
            ))}
          </div>
        </HintRow>
      )}
    </div>
  );
}

/** The key that takes a testnet off its fork. `saved` is the account of the one already stored. */
export function LiveKeyField({ value, onChange, saved }: { value: string; onChange: (value: string) => void; saved?: string | null }) {
  return (
    <Field className="animate-in gap-2 duration-200 fade-in-0 slide-in-from-top-1">
      <FieldLabel htmlFor="liveKey">Private key with test tokens</FieldLabel>
      <InputGroup className="h-11">
        <InputGroupAddon>
          <KeyRound />
        </InputGroupAddon>
        <InputGroupInput id="liveKey" name="liveKey" type="password" autoComplete="off" spellCheck={false} placeholder="0x…" value={value} onChange={(event) => onChange(event.target.value)} className="font-mono" />
      </InputGroup>
      <FieldDescription>
        {saved ? `Saved for ${saved}. Paste a new one to replace it.` : "With a key, tests run on the real testnet from this account. Use one that only holds test funds. Saved encrypted and never shown again."}
      </FieldDescription>
    </Field>
  );
}
