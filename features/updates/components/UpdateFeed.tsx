"use client";

import { useState } from "react";
import { useAction } from "next-safe-action/hooks";
import type { UpdateDTO, UpdatesPage } from "@/features/updates/queries";
import { loadMoreUpdates } from "@/features/updates/actions";
import { UpdateList } from "@/features/updates/components/UpdateList";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

/**
 * Daily Updates' timeline with a "Load more" that APPENDS (APX-51). It used to
 * be a link to `?cursor=…`, which replaced the list with the next page — the
 * updates you had just read vanished, and Back was the only way to them.
 *
 * The first page still comes from the Server Component (so a refresh after
 * posting or editing shows the newest updates); only the pages loaded after it
 * live here. The parent keys this component on the package filter, so
 * changing the filter starts again from the first page.
 */
export function UpdateFeed({
  projectId,
  packageId,
  initial,
}: {
  projectId: string;
  packageId?: string;
  initial: UpdatesPage;
}) {
  const [more, setMore] = useState<UpdateDTO[]>([]);
  /** `undefined` = still on the server page's own cursor. */
  const [cursor, setCursor] = useState<string | null | undefined>(undefined);
  const nextCursor = cursor === undefined ? initial.nextCursor : cursor;

  const load = useAction(loadMoreUpdates, {
    onSuccess: ({ data }) => {
      if (!data) return;
      setMore((prev) => [...prev, ...data.items]);
      setCursor(data.nextCursor);
    },
  });

  const seen = new Set(initial.items.map((u) => u.id));
  const updates = [...initial.items, ...more.filter((u) => !seen.has(u.id))];

  return (
    <>
      <Card>
        <UpdateList updates={updates} />
      </Card>

      <div className="mt-3 flex flex-col items-center gap-2" aria-live="polite">
        {load.result.serverError && (
          <p role="alert" className="text-[13px] text-status-destructive">
            Couldn’t load more updates. {load.result.serverError}
          </p>
        )}
        {nextCursor ? (
          <Button
            variant="default"
            size="sm"
            disabled={load.isExecuting}
            onClick={() => load.execute({ projectId, packageId, cursor: nextCursor })}
          >
            {load.isExecuting && <Spinner data-icon="inline-start" />}
            {load.isExecuting ? "Loading…" : "Load more"}
          </Button>
        ) : (
          more.length > 0 && <p className="text-[13px] text-muted-foreground">That’s every update.</p>
        )}
      </div>
    </>
  );
}
