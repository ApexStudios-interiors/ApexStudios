"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useApp } from "@/context/AppContext";
import { postDailyUpdate, getPackageOptions } from "@/features/updates/actions";
import { FileUploader } from "@/components/upload/FileUploader";
import { IMAGE_MIME, MAX_IMAGE_BYTES, MAX_PHOTOS_PER_ENTITY } from "@/lib/r2/constraints";
import { DialogShell, Field, inputClass, textareaClass } from "@/components/ui/DialogShell";

/** UTC-anchored, like every other date-only field in this app (Build 05's
 *  own established pattern) — never `new Date().toLocaleDateString()`. */
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * build/06-files-jobs-daily-updates.md §4.2. `updateId` is generated once,
 * up front, and stays fixed for the dialog's lifetime — `FileUploader`
 * confirms photos against it before the real `daily_updates` row exists
 * (schema.ts's own comment explains why), and `postDailyUpdate` inserts the
 * row with this exact id so the two line up.
 */
export function PostUpdateDialog({ projectId, moduleId }: { projectId: string; moduleId?: string }) {
  const { closeDialog, toast } = useApp();
  const router = useRouter();

  const [updateId] = useState(() => crypto.randomUUID());
  const [packages, setPackages] = useState<{ id: string; name: string }[] | null>(null);
  const [packageId, setPackageId] = useState(moduleId ?? "");
  const [updateDate, setUpdateDate] = useState(todayIso());
  const [body, setBody] = useState("");
  const [attachmentIds, setAttachmentIds] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getPackageOptions(projectId)
      .then((opts) => {
        setPackages(opts);
        setPackageId((current) => current || (opts[0]?.id ?? ""));
      })
      .catch(() => toast("Could not load packages."));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once for this dialog instance, matching the established AddTaskDialog pattern
  }, [projectId]);

  async function onSubmit() {
    if (!body.trim()) {
      setError("Please describe what happened today");
      return;
    }
    if (!packageId) {
      setError("Please select a package");
      return;
    }
    setPending(true);
    setError(null);
    const result = await postDailyUpdate({
      id: updateId,
      projectId,
      packageId,
      updateDate,
      body,
      attachmentIds,
    });
    setPending(false);
    if (!result?.data) {
      setError(result?.serverError ?? "Could not post this update");
      return;
    }
    closeDialog();
    router.push(`/projects/${projectId}/updates`);
    router.refresh();
    toast("Update posted");
  }

  return (
    <DialogShell
      title="Post Daily Update"
      okLabel={pending ? "Posting…" : "Post"}
      okDisabled={pending}
      onClose={closeDialog}
      onOk={onSubmit}
    >
      <div className="grid grid-cols-2 gap-3.5">
        <Field label="Package" htmlFor="pu-package">
          <select
            id="pu-package"
            className={inputClass}
            disabled={!packages}
            value={packageId}
            onChange={(e) => setPackageId(e.target.value)}
          >
            <option value="">{packages ? "Select a package" : "Loading…"}</option>
            {packages?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Date" htmlFor="pu-date">
          <input
            id="pu-date"
            type="date"
            className={inputClass}
            value={updateDate}
            onChange={(e) => setUpdateDate(e.target.value)}
          />
        </Field>
        <div className="col-span-2">
          <Field label="Work Done" htmlFor="pu-body">
            <textarea
              id="pu-body"
              className={textareaClass}
              placeholder="What was completed today, what is planned tomorrow, anything blocking"
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </Field>
        </div>
        <div className="col-span-2">
          <Field label="Photos">
            <FileUploader
              projectId={projectId}
              entityType="daily_update"
              entityId={updateId}
              accept={IMAGE_MIME}
              maxFiles={MAX_PHOTOS_PER_ENTITY}
              maxBytes={MAX_IMAGE_BYTES}
              onChange={setAttachmentIds}
            />
          </Field>
        </div>
        {error && <p className="col-span-2 text-[12.5px] text-destructive">{error}</p>}
      </div>
    </DialogShell>
  );
}
