"use client";

import { KNOWN_CHAINS, MAINNET_CHAIN_IDS, chainInfo, chainName, type WalletProfileId } from "@dappdrill/core";
import { ArrowRight, BadgeCheck, Ban, Bug, Check, CircleDollarSign, Clock, Coins, Globe, History, KeyRound, Link2, ListPlus, LogIn, MapPin, Network, NotebookPen, Plus, Route, ScanSearch, X, type LucideIcon } from "lucide-react";
import { startTransition, useActionState, useEffect, useRef, useState, useSyncExternalStore, type FormEvent, type ReactNode } from "react";
import { checkRpcAction, createAppAction } from "@/actions/apps";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldContent, FieldDescription, FieldLabel, FieldTitle } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group";
import { SitePreview, useSite } from "@/components/site-preview";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { ChainIcon, WalletIcon } from "@/components/web3-icons";
import type { ActionResult } from "@/lib/action-result";
import { looksLikeKey } from "@/lib/secrets";
import { cn } from "@/lib/utils";

const DEFAULT_WALLET: WalletProfileId = "metamask";
const DETECT = "detect";
const OTHER = "other";
const WALLETS: { id: WalletProfileId; name: string }[] = [
  { id: "metamask", name: "MetaMask" },
  { id: "rabby", name: "Rabby" },
  { id: "coinbase", name: "Coinbase Wallet" },
];
const CHAINS = KNOWN_CHAINS.filter((c) => c.id !== 31337 && c.forkable);
const MAINNETS = CHAINS.filter((c) => !c.testnet);
const TESTNETS = CHAINS.filter((c) => c.testnet);
const MAX_FLOWS = 3;
const FLOW_EXAMPLES = ["e.g. Swap ETH for USDC", "e.g. Add liquidity to a pool", "e.g. Claim rewards"];
const TINT = {
  sky: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
  violet: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
  pink: "bg-pink-500/10 text-pink-600 dark:text-pink-400",
  emerald: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  amber: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
};
/** `label` is the wording in the saved hints, and in the picker for the questions you unlock. */
const CORE_TIPS = [
  { id: "access", label: "How to get in", question: "How do we get in?", detail: "Sign-in or invite steps.", placeholder: "e.g. Sign in with the wallet", icon: LogIn, tint: TINT.violet },
  { id: "notes", label: "Hard to explore", question: "Additional notes", detail: "Anything that gets in the way of exploring.", placeholder: "e.g. A popup covers every page. Prices take a minute to load.", icon: NotebookPen, tint: TINT.amber },
] as const;
const MORE_TIPS = [
  { id: "success", label: "What success looks like", question: "How do you know it worked?", detail: "What users see after the main flows.", placeholder: "e.g. The swap shows up in History", icon: BadgeCheck, tint: TINT.emerald },
  { id: "tokens", label: "Tokens and amounts", question: "Which tokens and amounts?", detail: "What the tests should use.", placeholder: "e.g. USDC on Base, under 10 at a time", icon: CircleDollarSign, tint: TINT.sky },
  { id: "pages", label: "Hard-to-find pages", question: "Any pages that are hard to find?", detail: "Not in the menu, or only behind a link.", placeholder: "e.g. /vaults/new", icon: MapPin, tint: TINT.violet },
  { id: "changed", label: "What just changed", question: "What did you just change?", detail: "New or reworked parts of the app.", placeholder: "e.g. The new bridge page", icon: History, tint: TINT.amber },
  { id: "breaks", label: "What keeps breaking", question: "What keeps breaking?", detail: "Bugs that came back.", placeholder: "e.g. Approvals on Arbitrum", icon: Bug, tint: TINT.pink },
  { id: "avoid", label: "What to avoid", question: "What should we leave alone?", detail: "Pages or actions to skip.", placeholder: "e.g. The referral flow", icon: Ban, tint: TINT.pink },
] as const;
const TIPS = [...CORE_TIPS, ...MORE_TIPS];
type Tip = (typeof TIPS)[number];
type TipId = Tip["id"];
/** The flows and funds rows, plus every tip. */
const QUESTIONS = TIPS.length + 2;
// All answers together have to fit the 4,000 characters saved as hints.
const TIP_MAX = 350;
const NOTES_MAX = 600;

type RpcCheck = { status: "idle" | "checking" } | { status: "ok"; chainId: number } | { status: "bad"; error: string };

/** Asks the server which chain the URL belongs to, once typing pauses. */
function useRpcCheck(url: string, enabled: boolean): RpcCheck {
  const [check, setCheck] = useState<RpcCheck>({ status: "idle" });
  useEffect(() => {
    if (!enabled || !url.trim()) {
      setCheck({ status: "idle" });
      return;
    }
    let stale = false;
    setCheck({ status: "checking" });
    const timer = setTimeout(async () => {
      const result = await checkRpcAction(url).catch(() => ({ chainId: undefined, error: "We couldn't check that URL." }));
      if (stale) return;
      setCheck(result.chainId === undefined ? { status: "bad", error: result.error ?? "" } : { status: "ok", chainId: result.chainId });
    }, 500);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [url, enabled]);
  return check;
}

const WIDE = "(min-width: 64rem)";
const MOTION = "duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none";
const HINT_FIELD = "bg-background transition-colors placeholder:text-muted-foreground/80 hover:border-foreground/25";

/** Side by side needs the lg breakpoint; below it the preview opens inside the card. */
function useWide(): boolean {
  return useSyncExternalStore(
    (change) => {
      const query = matchMedia(WIDE);
      query.addEventListener("change", change);
      return () => query.removeEventListener("change", change);
    },
    () => matchMedia(WIDE).matches,
    () => false,
  );
}

function chainNote({ name, other, testnet, live, forkable }: { name?: string; other: boolean; testnet: boolean; live: boolean; forkable: boolean }) {
  if (!name) return other ? "Paste the RPC your app uses and we'll work out the chain." : "We'll see which chain your app connects to.";
  if (live) return "Tests run on the real testnet with your key, not a fork.";
  if (!forkable) return `${name} can't be forked, so tests run on it directly. Add a private key below to send transactions.`;
  if (testnet && other) return `Tests run on a local fork of ${name}. If it can't be forked, or you want the real testnet, add a private key below.`;
  if (testnet) return `Tests run on a local fork of ${name}. Add a private key below to use the real testnet.`;
  return `Tests run on a local fork of ${name}, so no real funds are involved.`;
}

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
  children: ReactNode;
};

/** Label on the left, input on the right. When split, the input lines up with the browser above it. */
function HintRow({ icon: Icon, tint, title, detail, htmlFor, index, shown, split, children }: HintRowProps) {
  return (
    <div
      style={{ transitionDelay: shown ? `${150 + index * 80}ms` : undefined }}
      className={cn("grid gap-3 transition-[opacity,translate] sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] sm:gap-8", split && "lg:grid-cols-2", MOTION, !shown && "translate-y-6 opacity-0")}
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

/** The flows the developer wants tested, one per row. Enter moves on to the next row. */
function FlowList({ flows, onChange }: { flows: string[]; onChange: (flows: string[]) => void }) {
  const canAdd = flows.length < MAX_FLOWS;
  const add = () => onChange([...flows, ""]);
  return (
    <>
      {flows.map((flow, index) => (
        <div key={index} className="relative">
          <Input
            id={index === 0 ? "flow-0" : undefined}
            aria-label={`Flow ${index + 1}`}
            // Only the first row is there on load, so this never takes focus from the URL.
            autoFocus={index > 0}
            maxLength={200}
            placeholder={FLOW_EXAMPLES[index]}
            value={flow}
            onChange={(event) => onChange(flows.map((current, i) => (i === index ? event.target.value : current)))}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              if (canAdd && index === flows.length - 1 && flow.trim()) add();
            }}
            className={cn("h-11 px-3.5", flows.length > 1 && "pr-10", HINT_FIELD)}
          />
          {flows.length > 1 && <RemoveButton label={`Remove flow ${index + 1}`} onClick={() => onChange(flows.filter((_, i) => i !== index))} />}
        </div>
      ))}
      {flows.some((flow) => looksLikeKey(flow)) && <KeyWarning />}
      {canAdd && (
        <Button type="button" variant="ghost" size="sm" onClick={add} className="-ml-2 self-start text-muted-foreground">
          <Plus />
          Add another flow
        </Button>
      )}
    </>
  );
}

type TipRowProps = { tip: Tip; value: string; onChange: (value: string) => void; onRemove?: () => void; index: number; shown: boolean; split: boolean };

/** One question. Those unlocked from the picker can be taken away again, and take focus when they appear. */
function TipRow({ tip, value, onChange, onRemove, ...row }: TipRowProps) {
  const field = { id: `tip-${tip.id}`, placeholder: tip.placeholder, value };
  return (
    <HintRow icon={tip.icon} tint={tip.tint} title={tip.question} detail={tip.detail} htmlFor={field.id} {...row}>
      {tip.id === "notes" ? (
        <Textarea {...field} rows={2} maxLength={NOTES_MAX} onChange={(event) => onChange(event.target.value)} className={cn("min-h-20 resize-none px-3.5 py-3", HINT_FIELD)} />
      ) : (
        <div className="relative">
          <Input {...field} autoFocus={Boolean(onRemove)} maxLength={TIP_MAX} onChange={(event) => onChange(event.target.value)} className={cn("h-11 px-3.5", onRemove && "pr-10", HINT_FIELD)} />
          {onRemove && <RemoveButton label={`Remove ${tip.question}`} onClick={onRemove} />}
        </div>
      )}
      {looksLikeKey(value) && <KeyWarning />}
    </HintRow>
  );
}

export function NewAppForm({ children }: { children: ReactNode }) {
  const [state, act, pending] = useActionState<ActionResult, FormData>(createAppAction, undefined);
  const [url, setUrl] = useState("");
  const [wallet, setWallet] = useState<WalletProfileId>(DEFAULT_WALLET);
  const [chainId, setChainId] = useState(DETECT);
  const [rpcUrl, setRpcUrl] = useState("");
  const [ticked, setTicked] = useState(false);
  const [funding, setFunding] = useState("");
  const [liveKey, setLiveKey] = useState("");
  const [flows, setFlows] = useState([""]);
  const [tips, setTips] = useState(() => Object.fromEntries(TIPS.map((tip) => [tip.id, ""])) as Record<TipId, string>);
  const [unlocked, setUnlocked] = useState<TipId[]>([]);
  const rpcInput = useRef<HTMLInputElement>(null);
  const focusRpc = useRef(false);
  const { site, open, looking, missed } = useSite(url);
  const wide = useWide();

  const other = chainId === OTHER;
  const rpc = useRpcCheck(rpcUrl, other);
  const picked = CHAINS.find((c) => String(c.id) === chainId);
  const resolvedId = picked?.id ?? (rpc.status === "ok" ? rpc.chainId : undefined);
  const known = resolvedId === undefined ? undefined : chainInfo(resolvedId);
  // Only a chain we can't place needs the user's word that it's a testnet.
  const askTestnet = resolvedId !== undefined && !known && !MAINNET_CHAIN_IDS.has(resolvedId);
  const testnet = Boolean(known?.testnet || (askTestnet && ticked));
  const live = testnet && Boolean(liveKey.trim());
  const name = resolvedId === undefined ? undefined : chainName(resolvedId);
  const rpcError = rpc.status === "bad" ? rpc.error : other && rpc.status === "idle" && state?.inline ? "Add the chain's RPC URL." : undefined;
  const customized = wallet !== DEFAULT_WALLET || chainId !== DETECT;
  const filledTips = TIPS.filter((tip) => tips[tip.id].trim());
  const filledFlows = flows.map((flow) => flow.trim()).filter(Boolean);
  const hintText = [...(filledFlows.length ? ["Flows to test:", ...filledFlows.map((flow) => `- ${flow}`)] : []), ...filledTips.map((tip) => `${tip.label}: ${tips[tip.id].trim()}`)].join("\n");
  // Hints already typed stay in view if the URL then changes, since they still get submitted.
  const hints = open || Boolean(funding.trim() || liveKey.trim() || filledTips.length || filledFlows.length || unlocked.length);
  const answered = filledTips.length + (filledFlows.length ? 1 : 0) + (funding.trim() || liveKey.trim() ? 1 : 0);
  const locked = MORE_TIPS.filter((tip) => !unlocked.includes(tip.id));
  const setTip = (id: TipId, value: string) => setTips((current) => ({ ...current, [id]: value }));

  // Not action={act}: React resets a form after its action runs, and on an error that puts the chain back on Detect.
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(() => act(data));
  }

  const preview = site && (
    <SitePreview
      site={site}
      open={open}
      toolbar={
        <>
          {resolvedId !== undefined && (
            <span key={resolvedId} className="flex animate-in duration-300 zoom-in-50">
              <ChainIcon chain={{ id: resolvedId }} />
            </span>
          )}
          <span key={wallet} className="flex animate-in duration-300 zoom-in-50">
            <WalletIcon wallet={wallet} />
          </span>
        </>
      }
    />
  );

  return (
    <form onSubmit={submit} aria-busy={pending} className="mx-auto flex w-full max-w-xl flex-col gap-8 lg:max-w-none">
      <input type="hidden" name="customized" value={customized ? "1" : ""} readOnly />
      <input type="hidden" name="hints" value={hintText} readOnly />
      {picked && <input type="hidden" name="chain" value={picked.id} readOnly />}

      <div className="grid gap-8 lg:grid-cols-2">
        <div className={cn("min-w-0 transition-transform", MOTION, !open && "lg:translate-x-[calc(50%+1rem)]")}>
          <Card className="h-full gap-0 py-0">
            <CardContent className="flex flex-col gap-5 p-6">
              <Field>
                <FieldLabel htmlFor="url">App URL</FieldLabel>
                <InputGroup className="h-11">
                  <InputGroupAddon>
                    <Globe />
                  </InputGroupAddon>
                  <InputGroupInput
                    id="url"
                    name="url"
                    required
                    autoFocus
                    autoComplete="url"
                    inputMode="url"
                    spellCheck={false}
                    placeholder="app.example.com"
                    value={url}
                    onChange={(event) => setUrl(event.target.value)}
                    className="text-base md:text-base"
                  />
                  {(looking || open) && (
                    <InputGroupAddon align="inline-end">{looking ? <Spinner /> : <Check className="animate-in duration-300 zoom-in-50" />}</InputGroupAddon>
                  )}
                </InputGroup>
                {missed && <FieldDescription className="animate-in duration-200 fade-in-0">We couldn&apos;t reach this site from here. You can still add it.</FieldDescription>}
              </Field>

              {!wide && (
                <div className={cn("-mt-5 grid transition-[grid-template-rows]", MOTION, open ? "grid-rows-[1fr]" : "grid-rows-[0fr]")}>
                  <div className="min-h-0 overflow-hidden">
                    <div className="pt-5">{preview}</div>
                  </div>
                </div>
              )}

              <div className="grid gap-5 sm:grid-cols-2 sm:gap-3">
                <Field>
                  <FieldLabel htmlFor="wallet">Wallet</FieldLabel>
                  <Select name="wallet" value={wallet} onValueChange={(value) => setWallet(value as WalletProfileId)}>
                    <SelectTrigger id="wallet" className="w-full data-[size=default]:h-11">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent position="popper">
                      <SelectGroup>
                        <SelectLabel className="max-w-60">Your app sees this one first. You can test others later.</SelectLabel>
                        {WALLETS.map((option) => (
                          <SelectItem key={option.id} value={option.id}>
                            <WalletIcon wallet={option.id} />
                            {option.name}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>

                <Field>
                  <FieldLabel htmlFor="chain">Chain</FieldLabel>
                  <Select
                    value={chainId}
                    onValueChange={(value) => {
                      focusRpc.current = value === OTHER;
                      setChainId(value);
                    }}
                  >
                    <SelectTrigger id="chain" className="w-full data-[size=default]:h-11">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent
                      position="popper"
                      onCloseAutoFocus={(event) => {
                        if (!focusRpc.current) return;
                        focusRpc.current = false;
                        event.preventDefault();
                        rpcInput.current?.focus();
                      }}
                    >
                      <SelectItem value={DETECT}>
                        <ScanSearch className="size-[18px]" />
                        Detect automatically
                      </SelectItem>
                      {[
                        { label: "Mainnets", chains: MAINNETS },
                        { label: "Testnets", chains: TESTNETS },
                      ].map((group) => (
                        <SelectGroup key={group.label}>
                          <SelectLabel>{group.label}</SelectLabel>
                          {group.chains.map((option) => (
                            <SelectItem key={option.id} value={String(option.id)}>
                              <ChainIcon chain={option} />
                              {option.name}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      ))}
                      <SelectSeparator />
                      <SelectItem value={OTHER}>
                        <Network className="size-[18px]" />
                        Other chain
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
              </div>

              {other && (
                <div className="flex animate-in flex-col gap-3 duration-200 fade-in-0 slide-in-from-top-1">
                  <InputGroup>
                    <InputGroupAddon>
                      <Link2 />
                    </InputGroupAddon>
                    <InputGroupInput
                      ref={rpcInput}
                      id="rpcUrl"
                      name="rpcUrl"
                      aria-label="RPC URL"
                      aria-invalid={Boolean(rpcError)}
                      inputMode="url"
                      autoComplete="off"
                      spellCheck={false}
                      placeholder="https://rpc.example.org"
                      value={rpcUrl}
                      onChange={(event) => setRpcUrl(event.target.value)}
                    />
                    {rpc.status === "checking" && (
                      <InputGroupAddon align="inline-end">
                        <Spinner />
                      </InputGroupAddon>
                    )}
                    {rpc.status === "ok" && (
                      <InputGroupAddon align="inline-end">
                        <InputGroupText className="animate-in whitespace-nowrap duration-200 fade-in-0">
                          <Check />
                          {name}
                        </InputGroupText>
                      </InputGroupAddon>
                    )}
                  </InputGroup>
                  {askTestnet && (
                    <FieldLabel htmlFor="testnet" className="animate-in duration-200 fade-in-0 slide-in-from-top-1">
                      <Field orientation="horizontal" className="p-3!">
                        <Checkbox id="testnet" name="testnet" value="1" checked={ticked} onCheckedChange={(value) => setTicked(value === true)} />
                        <FieldContent>
                          <FieldTitle>This is a testnet</FieldTitle>
                          <FieldDescription>Lets you add a private key below.</FieldDescription>
                        </FieldContent>
                      </Field>
                    </FieldLabel>
                  )}
                </div>
              )}

              {rpcError ? (
                <p role="alert" className="text-sm text-bad">
                  {rpcError}
                </p>
              ) : (
                <FieldDescription>{chainNote({ name, other, testnet, live, forkable: known?.forkable ?? true })}</FieldDescription>
              )}
            </CardContent>
          </Card>
        </div>

        {wide && (
          <div className="relative min-w-0">
            <div className="absolute inset-0">{preview}</div>
          </div>
        )}
      </div>

      <div className={cn("mx-auto flex w-full flex-col gap-8 transition-[max-width]", MOTION, open ? "lg:max-w-full" : "lg:max-w-[calc(50%-1rem)]")}>
        <div inert={!hints} className={cn("grid transition-[grid-template-rows,margin]", MOTION, hints ? "grid-rows-[1fr]" : "-mb-8 grid-rows-[0fr]")}>
          <div className="-mx-1 min-h-0 overflow-hidden px-1 pb-1">
            <div className="flex flex-col gap-7 pt-2">
              <HintRow icon={Route} tint={TINT.sky} title="Which flows should we test?" detail="What users do in your app. We'll start with these." htmlFor="flow-0" index={0} shown={hints} split={open}>
                <FlowList flows={flows} onChange={setFlows} />
              </HintRow>
              <HintRow
                icon={Coins}
                tint={TINT.emerald}
                title="How do we get test funds?"
                detail="We'll look for a way ourselves, but a hint helps."
                htmlFor="funding"
                index={1}
                shown={hints}
                split={open}
              >
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
                {testnet && (
                  <Field className="animate-in gap-2 duration-200 fade-in-0 slide-in-from-top-1">
                    <FieldLabel htmlFor="liveKey">Private key with test tokens</FieldLabel>
                    <InputGroup className="h-11">
                      <InputGroupAddon>
                        <KeyRound />
                      </InputGroupAddon>
                      <InputGroupInput
                        id="liveKey"
                        name="liveKey"
                        type="password"
                        autoComplete="off"
                        spellCheck={false}
                        placeholder="0x…"
                        value={liveKey}
                        onChange={(event) => setLiveKey(event.target.value)}
                        className="font-mono"
                      />
                    </InputGroup>
                    <FieldDescription>With a key, tests run on the real testnet from this account. Use one that only holds test funds. Saved encrypted and never shown again.</FieldDescription>
                  </Field>
                )}
              </HintRow>
              {CORE_TIPS.map((tip, index) => (
                <TipRow key={tip.id} tip={tip} value={tips[tip.id]} onChange={(value) => setTip(tip.id, value)} index={index + 2} shown={hints} split={open} />
              ))}
              {unlocked.map((id) => {
                const tip = TIPS.find((t) => t.id === id)!;
                const remove = () => {
                  setTip(id, "");
                  setUnlocked((current) => current.filter((other) => other !== id));
                };
                return (
                  <div key={id} className="animate-in duration-300 fade-in-0 slide-in-from-top-2 motion-reduce:animate-none">
                    <TipRow tip={tip} value={tips[id]} onChange={(value) => setTip(id, value)} onRemove={remove} index={0} shown={hints} split={open} />
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
                  shown={hints}
                  split={open}
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
          </div>
        </div>

        <div className="flex flex-col gap-3">
          {state?.error && !state.inline && (
            <p role="alert" className="text-sm text-bad">
              {state.error}
            </p>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <Clock className="size-3.5" />
              First tests ready in 5–7 minutes
            </p>
            <Button type="submit" size="lg" disabled={pending} className="group max-sm:w-full">
              {pending ? (
                <>
                  <Spinner />
                  Opening app…
                </>
              ) : (
                <>
                  Generate tests
                  <ArrowRight className="transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" />
                </>
              )}
            </Button>
          </div>
        </div>

        {children}
      </div>
    </form>
  );
}
