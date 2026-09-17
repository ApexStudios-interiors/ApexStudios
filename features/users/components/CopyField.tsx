"use client";

import { useEffect, useState } from "react";
import { CheckIcon, CopyIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { inputClass } from "@/components/ui/DialogShell";

/**
 * A read-only value with an explicit Copy button beside it — the owner asked
 * for a clear button, not click-the-text. The value is selectable by hand as a
 * fallback for browsers that refuse the Clipboard API (non-secure origins).
 */
export function CopyField({ id, value, label }: { id: string; value: string; label: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  useEffect(() => {
    if (state === "idle") return;
    const t = setTimeout(() => setState("idle"), 2000);
    return () => clearTimeout(t);
  }, [state]);

  return (
    <div className="flex gap-2">
      <input
        id={id}
        readOnly
        value={value}
        onFocus={(e) => e.currentTarget.select()}
        className={`${inputClass} font-mono tracking-wide`}
      />
      <Button
        type="button"
        variant="default"
        className="shrink-0"
        aria-label={`Copy ${label}`}
        onClick={() => {
          navigator.clipboard.writeText(value).then(
            () => setState("copied"),
            () => setState("failed")
          );
        }}
      >
        {state === "copied" ? <CheckIcon className="size-4" /> : <CopyIcon className="size-4" />}
        {state === "copied" ? "Copied" : state === "failed" ? "Select & copy" : "Copy"}
      </Button>
    </div>
  );
}
