"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { format, parse } from "date-fns";
import { CalendarIcon } from "lucide-react";
import { useApp } from "@/context/AppContext";
import { postDailyUpdate, getPackageOptions } from "@/features/updates/actions";
import { FileUploader } from "@/components/upload/FileUploader";
import { IMAGE_MIME, MAX_IMAGE_BYTES, MAX_PHOTOS_PER_ENTITY } from "@/lib/r2/constraints";
import { DialogShell, Field, inputClass, textareaClass } from "@/components/ui/DialogShell";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";

/** The stored value is the same `yyyy-MM-dd` string `<input type="date">`
 *  produced, so `postDailyUpdate` and its zod schema see no change at all —
 *  only the surface the supervisor touches does. Both helpers work in local
 *  time on purpose: `toISOString()` on a calendar-picked local midnight would
 *  shift the day across the UTC boundary. */
const ISO_DATE = "yyyy-MM-dd";
/** dd/MM/yyyy — how a date is written on an Indian site record. */
const DISPLAY_DATE = "dd/MM/yyyy";

function isoToDate(value: string): Date | undefined {
  if (!value) return undefined;
  const parsed = parse(value, ISO_DATE, new Date());
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function dateToIso(date: Date): string {
  return format(date, ISO_DATE);
}

/** Today in the supervisor's own calendar. This used to be
 *  `toISOString().slice(0, 10)` (UTC), which before 05:30 IST is still
 *  yesterday — and the picker, which reads local dates, would then show
 *  yesterday as selected. Nothing server-side compares against "today";
 *  `postDailyUpdate` only checks `z.iso.date()`. */
function todayIso(): string {
  return dateToIso(new Date());
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
  const [dateOpen, setDateOpen] = useState(false);

  /** `items` is what lets `<SelectValue>` render the chosen package's NAME in
   *  the closed trigger; without it Base UI falls back to stringifying the
   *  value, which here would print a raw UUID. */
  const packageItems = useMemo(
    () => (packages ?? []).map((p) => ({ value: p.id, label: p.name })),
    [packages]
  );
  const selectedDate = isoToDate(updateDate);

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
          <Popover open={dateOpen} onOpenChange={setDateOpen}>
            <PopoverTrigger
              id="pu-date"
              className={`${inputClass} flex items-center gap-2 text-left data-[empty=true]:text-muted-foreground`}
              data-empty={!selectedDate}
            >
              <CalendarIcon className="size-4 shrink-0 text-muted-foreground" />
              {selectedDate ? format(selectedDate, DISPLAY_DATE) : "Pick a date"}
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                required
                selected={selectedDate}
                defaultMonth={selectedDate}
                onSelect={(date) => {
                  setUpdateDate(dateToIso(date));
                  setDateOpen(false);
                }}
              />
            </PopoverContent>
          </Popover>
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
