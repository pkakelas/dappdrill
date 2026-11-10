"use client";

import { ListChecks } from "lucide-react";
import { useState, useTransition } from "react";
import { keepCheckAction } from "@/actions/explore";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export interface KeepTarget {
  id: string;
  name: string;
  /** The steps' words; a test with none can't hold a check. */
  steps: string[];
}

/**
 * "Keep checking this": puts a check the pass made on a step of a test, where every run makes it
 * again. Opens as a popover under the button, with the test and the step to pick.
 */
export function KeepCheck({ passId, checkId, tests, suggested }: { passId: string; checkId: string; tests: KeepTarget[]; suggested?: string }) {
  const able = tests.filter((t) => t.steps.length > 0);
  const [open, setOpen] = useState(false);
  const [testId, setTestId] = useState(() => (able.find((t) => t.name === suggested) ?? able[0])?.id ?? "");
  const test = able.find((t) => t.id === testId) ?? able[0];
  const [step, setStep] = useState(() => (test?.steps.length ?? 1) - 1);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  if (!test) return null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="xs" className="text-muted-foreground">
          <ListChecks aria-hidden="true" />
          Keep checking this
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} className="w-[min(440px,calc(100vw-32px))] rounded-xl">
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const r = await keepCheckAction(passId, checkId, test.id, step);
              if (r.error) return setError(r.error);
              setOpen(false);
            });
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`keep-test-${checkId}`}>On the test</Label>
            <NativeSelect
              id={`keep-test-${checkId}`}
              className="w-full"
              value={test.id}
              disabled={pending}
              onChange={(e) => {
                const next = able.find((t) => t.id === e.target.value);
                setTestId(e.target.value);
                setStep((next?.steps.length ?? 1) - 1);
              }}
            >
              {able.map((t) => (
                <NativeSelectOption key={t.id} value={t.id}>
                  {t.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`keep-step-${checkId}`}>Right after</Label>
            <NativeSelect id={`keep-step-${checkId}`} className="w-full" value={step} disabled={pending} onChange={(e) => setStep(Number(e.target.value))}>
              {test.steps.map((s, i) => (
                <NativeSelectOption key={i} value={i}>
                  {i + 1}. {s}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
          {error ? <p className="text-sm text-bad">{error}</p> : <p className="text-sm text-muted-foreground">Every run of the test makes this check again there. If it doesn&apos;t hold, the test fails.</p>}
          <Button type="submit" size="sm" className="w-fit" disabled={pending}>
            {pending ? "Keeping…" : "Keep"}
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}
