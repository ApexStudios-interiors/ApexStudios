"use client";

import { useState } from "react";
import type { UpdateDTO } from "@/features/updates/queries";
import { dmy } from "@/lib/logic";
import { Badge } from "@/components/ui/Badge";
import { DialogShell } from "@/components/ui/DialogShell";
import { useApp } from "@/context/AppContext";

/**
 * build/06-files-jobs-daily-updates.md §4.2. Real data, real thumbnails —
 * the prototype's grey placeholder boxes (one per `photos` count) are now
 * `<img>` tags against a presigned thumbnail URL, with a lightbox for the
 * full-size view (built from `DialogShell`, per the build file's own
 * instruction). `next/image` cannot optimise a private presigned URL, and a
 * cached optimised copy of one that has since expired is worse than an
 * unoptimised `<img>` — build §2.4's own warning.
 */
export function UpdateList({ updates }: { updates: UpdateDTO[] }) {
  const { openDialog } = useApp();
  const [lightbox, setLightbox] = useState<{ url: string; alt: string } | null>(null);

  if (updates.length === 0) {
    return <div className="px-5 py-8 text-center text-muted-foreground text-[13.5px]">No updates yet.</div>;
  }

  return (
    <div className="flex flex-col px-5 pt-1 pb-2">
      {updates.map((u) => (
        <div
          key={u.id}
          className="relative pl-[26px] pb-[22px] pt-1 border-l-2 border-border ml-1.5 last:pb-1.5 before:content-[''] before:absolute before:-left-[7px] before:top-2 before:w-3 before:h-3 before:rounded-full before:bg-primary before:border-2 before:border-card"
        >
          <div className="flex items-center gap-2.5 mb-1.5 flex-wrap">
            <span className="font-bold text-[13.5px] tabular-nums">{dmy(u.updateDate)}</span>
            {u.packageName && (
              <Badge variant="outline">
                {u.packageSeqNo != null ? String(u.packageSeqNo).padStart(2, "0") + " " : ""}
                {u.packageName}
              </Badge>
            )}
            <span className="text-muted-foreground text-sm">{u.authorName}</span>
            {u.canEdit && (
              <button
                type="button"
                className="text-muted-foreground text-xs underline ml-auto"
                onClick={() => openDialog({ kind: "editUpdate", updateId: u.id, body: u.body })}
              >
                Edit
              </button>
            )}
          </div>
          <div className="text-[13.5px] max-w-[70ch] whitespace-pre-line">{u.body}</div>
          {u.attachments.length > 0 && (
            <div className="flex gap-2 mt-2.5 flex-wrap">
              {u.attachments.map((a) =>
                a.isImage && a.thumbUrl ? (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => setLightbox({ url: a.downloadUrl, alt: "Update photo" })}
                    className="w-24 h-[72px] rounded-md overflow-hidden border border-border shrink-0"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- a presigned R2 URL, not an optimisable next/image source (build §2.4) */}
                    <img src={a.thumbUrl} alt="" className="w-full h-full object-cover" />
                  </button>
                ) : (
                  <a
                    key={a.id}
                    href={a.downloadUrl}
                    className="w-24 h-[72px] rounded-md bg-muted border border-border shrink-0 flex items-center justify-center text-[11px] text-muted-foreground underline"
                  >
                    File
                  </a>
                )
              )}
            </div>
          )}
        </div>
      ))}

      {lightbox && (
        <DialogShell
          title="Photo"
          okLabel="Close"
          onOk={() => setLightbox(null)}
          onClose={() => setLightbox(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- see the grid's own comment above */}
          <img src={lightbox.url} alt={lightbox.alt} className="max-w-full max-h-[70vh] mx-auto rounded-md" />
        </DialogShell>
      )}
    </div>
  );
}
