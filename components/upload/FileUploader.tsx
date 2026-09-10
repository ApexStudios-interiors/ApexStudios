"use client";

import { useRef, useState } from "react";
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
};

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
  const inFlight = useRef(0);
  const queue = useRef<UploadItem[]>([]);

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

  function handleFiles(fileList: FileList | null) {
    if (!fileList) return;
    const activeCount = items.filter((i) => i.status !== "error").length;
    const room = Math.max(0, maxFiles - activeCount);
    const files = Array.from(fileList).slice(0, room);

    const newItems: UploadItem[] = files.map((file) => {
      // Client-side validation mirrors constraints.ts for a fast error; the
      // server re-checks regardless (build's own "not a control" warning).
      if (file.size > maxBytes) {
        return {
          id: crypto.randomUUID(),
          file,
          progress: 0,
          status: "error",
          error: `File exceeds the ${Math.round(maxBytes / (1024 * 1024))} MB limit`,
        };
      }
      return { id: crypto.randomUUID(), file, progress: 0, status: "uploading" };
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

  const canAddMore = items.filter((i) => i.status !== "error").length < maxFiles;

  return (
    <div>
      {canAddMore && (
        <input
          type="file"
          accept={accept.join(",")}
          multiple
          className="text-[13px]"
          onChange={(e) => {
            handleFiles(e.target.files);
            e.target.value = ""; // lets the same file be re-picked after fixing it
          }}
        />
      )}
      {items.length > 0 && (
        <div className="flex gap-2 mt-2.5 flex-wrap">
          {items.map((item) => (
            <div
              key={item.id}
              className="relative w-24 h-[72px] rounded-md bg-muted border border-border overflow-hidden shrink-0"
              title={item.status === "error" ? item.error : item.file.name}
            >
              {item.status === "uploading" && (
                <div className="absolute inset-0 flex items-center justify-center text-[11px] text-muted-foreground tabular-nums">
                  {item.progress}%
                </div>
              )}
              {item.status === "done" && (
                <div className="absolute inset-0 flex items-center justify-center text-[11px] text-status-success font-semibold">
                  Done
                </div>
              )}
              {item.status === "error" && (
                <button
                  type="button"
                  onClick={() => retry(item.id)}
                  className="absolute inset-0 flex flex-col items-center justify-center gap-0.5 text-status-destructive text-[11px] font-medium underline"
                >
                  Retry
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
