"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useApp } from "@/context/AppContext";
import { postDailyUpdate, getPackageOptions } from "@/features/updates/actions";
import { FileUploader } from "@/components/upload/FileUploader";
import { IMAGE_MIME, MAX_IMAGE_BYTES, MAX_PHOTOS_PER_ENTITY } from "@/lib/r2/constraints";
import { DialogShell, Field, textareaClass } from "@/components/ui/DialogShell";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DatePicker } from "@/components/shared/DatePicker";
import { todayIst } from "@/lib/dates";

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
  // Today on site, i.e. in Asia/Kolkata — right for the supervisor in India
  // whatever timezone the device or the server is set to.
  const [updateDate, setUpdateDate] = useState(todayIst());
  const [body, setBody] = useState("");
  const [attachmentIds, setAttachmentIds] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** `items` is what lets `<SelectValue>` render the chosen package's NAME in
   *  the closed trigger; without it Base UI falls back to stringifying the
   *  value, which here would print a raw UUID. */
  const packageItems = useMemo(
    () => (packages ?? []).map((p) => ({ value: p.id, label: p.name })),
    [packages]
  );

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
      okPending={pending}
      onClose={closeDialog}
      onOk={onSubmit}
    >
      <div className="grid grid-cols-2 gap-3.5">
        <Field label="Package" htmlFor="pu-package">
          {/* Base UI's "no selection" is `null`, not `""` — this dialog keeps
              `""` as its own empty state (the `!packageId` guard in onSubmit
              relies on it) and translates at the boundary. There is no null
              item: the old `value=""` option was only ever a placeholder,
              never a valid choice, so the user cannot select "nothing". */}
          <Select
            items={packageItems}
            disabled={!packages}
            // `packageId` can already be a UUID (from `moduleId`) before the
            // options load; with no items to resolve it against, the trigger
            // would print that UUID. Show the placeholder until they arrive.
            value={packages ? packageId || null : null}
            onValueChange={(value) => setPackageId(value ?? "")}
          >
            <SelectTrigger id="pu-package" className="h-9 w-full text-[13.5px]">
              <SelectValue placeholder={packages ? "Select a package" : "Loading…"} />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {packageItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
        <Field label="Date" htmlFor="pu-date">
          <DatePicker id="pu-date" value={updateDate} onChange={setUpdateDate} required />
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
