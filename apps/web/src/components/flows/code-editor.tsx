"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { saveFlowAction, type ActionResult } from "@/actions/flows";
import { FormMessage } from "@/components/ui";

/** The flow as JSON: edit, save, download. */
export function CodeEditor({ flowId, json, fileName }: { flowId: string; json: string; fileName: string }) {
  const [text, setText] = useState(json);
  const [state, setState] = useState<ActionResult>(undefined);
  const [pending, start] = useTransition();
  const router = useRouter();
  const download = `data:application/json;charset=utf-8,${encodeURIComponent(text)}`;
  return (
    <div className="flex flex-col gap-3">
      <label htmlFor="flow-json" className="label">
        Flow file
      </label>
      <textarea
        id="flow-json"
        spellCheck={false}
        className="field min-h-[480px] resize-y font-mono text-meta leading-relaxed"
        value={text}
        onChange={(e) => (setText(e.target.value), setState(undefined))}
      />
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="btn btn-sm btn-primary"
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
        </button>
        <a className="btn btn-sm" href={download} download={fileName}>
          Download
        </a>
        {text !== json && (
          <button type="button" className="btn btn-sm" onClick={() => (setText(json), setState(undefined))}>
            Revert
          </button>
        )}
        <FormMessage state={state} />
      </div>
    </div>
  );
}
