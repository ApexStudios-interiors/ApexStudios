"use client";

import { useEffect, useRef, useState } from "react";
import { confirmUpload, requestUploadUrl } from "@/features/attachments/actions";
import type { AllowedMime } from "@/lib/r2/constraints";

/**
 * build/06-files-jobs-daily-updates.md §2.3. Used by `PostUpdateDialog`
 * (this build) and, later, `NewApprovalDialog`/`ApprovalPhotosDialog`
 * (Build 08) and `BillUploadDialog` (Build 09).
 *
 * Per file: request URL -> PUT with progress -> confirm. Uploads run in
 * parallel, capped at three. A failed PUT retries on that file only — the
 * rest of the form still submits, because a supervisor on site with two bars
 * of signal must be able to post the text of an update even when one photo
 * fails (architecture.md §8.4).
 *
 * The surface is a drop zone: drag files onto it, or click/press it to open
 * the picker. The bare `<input type="file">` it replaces gave no preview, so
 * a supervisor could not tell which of five near-identical site photos had
 * attached. Each file now shows its own thumbnail, name, size, progress and
 * a remove control. Hand-rolled on the repo's own primitives — AGENTS.md
 * rules out adding a component library for this.
 */

const MAX_CONCURRENT = 3;

type UploadStatus = "uploading" | "done" | "error";

type UploadItem = {
  /** Client-local id — never the server's attachment id, which only exists
   *  once `status` is "done". */
  id: string;
  file: File;
  progress: number;
  status: UploadStatus;
  attachmentId?: string;
  error?: string;
  /** Object URL for an image preview; undefined for a PDF. Revoked on
   *  removal and on unmount — an un-revoked one leaks the whole file until
   *  the tab closes, and a site phone posting a day of photos will feel it. */
  previewUrl?: string;
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function putWithProgress(url: string, file: File, onProgress: (pct: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", file.type);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`Upload failed (HTTP ${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error("Network error during upload"));
    xhr.send(file);
  });
}

export function FileUploader({
  projectId,
  entityType,
  entityId,
  accept,
  maxFiles,
  maxBytes,
  onChange,
}: {
  projectId: string;
  entityType: "approval" | "daily_update" | "bill" | "stock_request" | "project";
  entityId: string;
  accept: readonly AllowedMime[];
  maxFiles: number;
  maxBytes: number;
  /** Called with every currently-confirmed attachment id, in order, whenever
   *  the set changes. */
  onChange: (attachmentIds: string[]) => void;
}) {
  const [items, setItems] = useState<UploadItem[]>([]);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const inFlight = useRef(0);
  const queue = useRef<UploadItem[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  // Unmount only — the dialog closing must not leave every previewed photo
  // held in memory. Reads the current items through the state setter so the
  // effect needs no dependency on `items` and therefore runs exactly once.
  useEffect(() => {
    return () => {
      setItems((current) => {
        current.forEach((i) => i.previewUrl && URL.revokeObjectURL(i.previewUrl));
        return current;
      });
    };
  }, []);

  function notifyChange(list: UploadItem[]) {
    const ids = list
      .filter(
        (i): i is UploadItem & { attachmentId: string } => i.status === "done" && i.attachmentId != null
      )
      .map((i) => i.attachmentId);
    onChange(ids);
  }

  // Pulls and uploads one item, then pulls the next itself when it finishes —
  // a single self-recursive function rather than two functions calling each
  // other, so there is no forward reference for React's hooks/refs lint (or
  // the underlying temporal-dead-zone problem it is guarding against) to
  // trip over. `pump` below just kicks off up to MAX_CONCURRENT of these.
  async function processNext(): Promise<void> {
    if (inFlight.current >= MAX_CONCURRENT) return;
    const item = queue.current.shift();
    if (!item) return;
    inFlight.current++;

    try {
      // File.type is an unvalidated browser-reported string, not the narrow
      // allowlist union — the real check is server-side (requestUploadUrl's
      // own isAllowedMime call and the zod schema both reject anything not
      // actually allowed; this cast only satisfies the client-side type).
      const mimeType = item.file.type as AllowedMime;

      const requested = await requestUploadUrl({
        projectId,
        entityType,
        entityId,
        fileName: item.file.name,
        mimeType,
        sizeBytes: item.file.size,
      });
      if (!requested?.data) throw new Error(requested?.serverError ?? "Could not start the upload");
      const { url, key } = requested.data;

      await putWithProgress(url, item.file, (pct) => {
        setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, progress: pct } : i)));
      });

      const confirmed = await confirmUpload({
        key,
        projectId,
        entityType,
        entityId,
        fileName: item.file.name,
        mimeType,
        sizeBytes: item.file.size,
      });
      if (!confirmed?.data) throw new Error(confirmed?.serverError ?? "Could not confirm the upload");

      setItems((prev) => {
        const next = prev.map((i) =>
          i.id === item.id
            ? { ...i, status: "done" as const, attachmentId: confirmed.data.id, progress: 100 }
            : i
        );
        notifyChange(next);
        return next;
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Upload failed";
      setItems((prev) =>
        prev.map((i) => (i.id === item.id ? { ...i, status: "error" as const, error: message } : i))
      );
    } finally {
      inFlight.current--;
      void processNext(); // pull whatever is queued next, if anything
    }
  }

  function pump() {
    for (let i = inFlight.current; i < MAX_CONCURRENT; i++) {
      void processNext();
    }
  }

  /** Takes an already-materialised array, not the live `FileList`: reading a
   *  file input's `files` and then clearing its `value` are two steps, and a
   *  `FileList` is a live view that empties the moment `value` is reset. The
   *  caller copies first, resets, then hands the copy here — so the reset can
   *  never be skipped by anything that happens while the files are processed. */
  function handleFiles(selected: File[]) {
    const activeCount = items.filter((i) => i.status !== "error").length;
    const room = Math.max(0, maxFiles - activeCount);
    const files = selected.slice(0, room);

    const newItems: UploadItem[] = files.map((file) => {
      const previewUrl = file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined;
      // Client-side validation mirrors constraints.ts for a fast error; the
      // server re-checks regardless (build's own "not a control" warning).
      if (file.size > maxBytes) {
        return {
          id: crypto.randomUUID(),
          file,
          progress: 0,
          status: "error",
          error: `File exceeds the ${Math.round(maxBytes / (1024 * 1024))} MB limit`,
          previewUrl,
        };
      }
      return { id: crypto.randomUUID(), file, progress: 0, status: "uploading", previewUrl };
    });

    setItems((prev) => [...prev, ...newItems]);
    queue.current.push(...newItems.filter((i) => i.status === "uploading"));
    pump();
  }

  function retry(id: string) {
    setItems((prev) => {
      const target = prev.find((i) => i.id === id);
      if (!target) return prev;
      const retried: UploadItem = { ...target, status: "uploading", progress: 0, error: undefined };
      queue.current.push(retried);
      pump();
      return prev.map((i) => (i.id === id ? retried : i));
    });
  }

  /** Drops the file from this form. An already-confirmed attachment is left
   *  on the server and simply stops being referenced — `attachment.orphan_sweep`
   *  (weekly.maintenance) is what collects those, exactly as it does for a
   *  dialog the user cancels. */
  function remove(id: string) {
    // Belt and braces for the re-pick: the picker only fires `change` when the
    // chosen file differs from what the input already holds, so an input left
    // naming the file being removed would swallow the next selection of that
    // same file. The change handler already clears it, but this makes the
    // invariant "after a removal the input names nothing" hold unconditionally
    // — including for a removal that follows a drop, which never touches the
    // input at all.
    if (inputRef.current) inputRef.current.value = "";
    setItems((prev) => {
      const target = prev.find((i) => i.id === id);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      const next = prev.filter((i) => i.id !== id);
      notifyChange(next);
      return next;
    });
  }

  const activeCount = items.filter((i) => i.status !== "error").length;
  const canAddMore = activeCount < maxFiles;
  const acceptsOnlyImages = accept.every((m) => m.startsWith("image/"));
  const noun = acceptsOnlyImages ? "photos" : "files";

  return (
    <div>
      {canAddMore && (
        // A button, not a div with a click handler: it is focusable and
        // Enter/Space-activated for free, which a supervisor tabbing through
        // the form on a laptop needs. The input stays hidden and is driven
        // from here, so there is one control rather than two.
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setIsDraggingOver(true);
          }}
          onDragLeave={() => setIsDraggingOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDraggingOver(false);
            handleFiles(Array.from(e.dataTransfer.files));
          }}
          className={`w-full rounded-md border border-dashed px-4 py-5 text-center transition-colors ${
            isDraggingOver ? "border-border-strong bg-accent" : "border-border hover:bg-accent"
          }`}
        >
          <span className="block text-[13px] text-foreground">
            Drop {noun} here, or <span className="underline">browse</span>
          </span>
          <span className="mt-1 block text-[11.5px] text-muted-foreground">
            {acceptsOnlyImages ? "JPEG, PNG or WebP" : "JPEG, PNG, WebP or PDF"} · up to{" "}
            {Math.round(maxBytes / (1024 * 1024))} MB each · {maxFiles - activeCount} of {maxFiles} remaining
          </span>
        </button>
      )}
      <input
        ref={inputRef}
        type="file"
        accept={accept.join(",")}
        multiple
        hidden
        onChange={(e) => {
          // Copy, THEN clear, THEN process. Chrome and Safari fire no `change`
          // when the picked file is identical to the one the input already
          // holds, so the reset is what lets the same photo be chosen again
          // after it was removed. Doing it before `handleFiles` means nothing
          // that runs while the selection is processed can leave a stale
          // filename on the input and silence the next pick.
          const selected = Array.from(e.target.files ?? []);
          e.target.value = "";
          handleFiles(selected);
        }}
      />
      {items.length > 0 && (
        <ul className="mt-2.5 flex flex-wrap gap-2">
          {items.map((item) => (
            <li
              key={item.id}
              className="relative w-24 shrink-0"
              title={item.status === "error" ? item.error : item.file.name}
            >
              <div className="relative h-[72px] overflow-hidden rounded-md border border-border bg-muted">
                {item.previewUrl ? (
                  /* A blob: URL from this session, not a remote asset — next/image
                     cannot optimise it and would only add a loader round trip. */
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.previewUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  <span className="absolute inset-0 flex items-center justify-center text-[11px] font-medium text-muted-foreground">
                    PDF
                  </span>
                )}

                {item.status === "uploading" && (
                  <div className="absolute inset-0 flex items-end bg-background/70">
                    <div className="w-full px-1.5 pb-1.5">
                      <div className="h-1 w-full overflow-hidden rounded-full bg-border">
                        <div
                          className="h-full bg-foreground transition-[width]"
                          style={{ width: `${item.progress}%` }}
                        />
                      </div>
                      <span className="mt-1 block text-center text-[10.5px] tabular-nums text-muted-foreground">
                        {item.progress}%
                      </span>
                    </div>
                  </div>
                )}

                {item.status === "error" && (
                  <button
                    type="button"
                    onClick={() => retry(item.id)}
                    className="absolute inset-0 flex items-center justify-center bg-background/80 text-[11px] font-medium text-status-destructive underline"
                  >
                    Retry
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => remove(item.id)}
                  aria-label={`Remove ${item.file.name}`}
                  className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full border border-border bg-background text-[13px] leading-none text-muted-foreground hover:text-foreground"
                >
                  ×
                </button>
              </div>
              <span className="mt-1 block truncate text-[11px] text-muted-foreground">{item.file.name}</span>
              <span className="block text-[10.5px] tabular-nums text-muted-foreground">
                {item.status === "done" ? "Attached" : formatBytes(item.file.size)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
