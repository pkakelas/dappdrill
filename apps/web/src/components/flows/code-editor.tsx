"use client";

import { Download } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { saveFlowAction, type ActionResult } from "@/actions/flows";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Feedback } from "./forms";

/** The flow as JSON: edit, save, download. */
export function CodeEditor({ flowId, json, fileName }: { flowId: string; json: string; fileName: string }) {
  const [text, setText] = useState(json);
  const [state, setState] = useState<ActionResult>(undefined);
  const [pending, start] = useTransition();
  const router = useRouter();
  const download = `data:application/json;charset=utf-8,${encodeURIComponent(text)}`;
  return (
    <div className="flex flex-col gap-3">
      <Textarea
        aria-label="Flow file"
        spellCheck={false}
        className="min-h-[480px] resize-y font-mono text-sm leading-relaxed"
        value={text}
        onChange={(e) => (setText(e.target.value), setState(undefined))}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          disabled={pending || text === json}
          onClick={() =>
            start(async () => {
              const res = await saveFlowAction(flowId, text);
              setState(res);
              if (!res?.error) router.refresh();
            })
          }
        >
          {pending ? "Saving…" : "Save"}
        </Button>
        <Button asChild variant="outline" size="sm">
          <a href={download} download={fileName}>
            <Download /> Download
          </a>
        </Button>
        {text !== json && (
          <Button type="button" variant="ghost" size="sm" onClick={() => (setText(json), setState(undefined))}>
            Revert
          </Button>
        )}
        <Feedback state={state} />
      </div>
    </div>
  );
}
