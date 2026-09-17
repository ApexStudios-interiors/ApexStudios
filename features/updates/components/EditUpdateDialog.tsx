"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useApp } from "@/context/AppContext";
import { editDailyUpdate } from "@/features/updates/actions";
import { DialogShell, Field, textareaClass } from "@/components/ui/DialogShell";

/**
 * build/06-files-jobs-daily-updates.md §4.1: "the author, within 24 hours" —
 * enforced by `daily_updates`' own RLS policy, not re-implemented here. Body
 * text only; the date and package a diary entry is filed under don't get a
 * second chance to change, just a typo fix.
 */
export function EditUpdateDialog({ updateId, body: initialBody }: { updateId: string; body: string }) {
  const { closeDialog, toast } = useApp();
  const router = useRouter();
  const [body, setBody] = useState(initialBody);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSave() {
    setPending(true);
    setError(null);
    const result = await editDailyUpdate({ id: updateId, body });
    setPending(false);
    if (!result?.data) {
      setError(result?.serverError ?? "Could not save this update");
      return;
    }
    closeDialog();
    toast("Update saved");
    router.refresh();
  }

  return (
    <DialogShell
      title="Edit Update"
      okLabel={pending ? "Saving…" : "Save"}
      okPending={pending}
      onClose={closeDialog}
      onOk={onSave}
    >
      <Field label="Work Done" htmlFor="eu-body">
        <textarea
          id="eu-body"
          className={textareaClass}
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
      </Field>
      {error && <p className="text-[12.5px] text-destructive mt-2">{error}</p>}
    </DialogShell>
  );
}
