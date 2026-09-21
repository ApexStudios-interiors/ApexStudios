"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { useApp } from "@/context/AppContext";
import { setProjectRateVisibility } from "@/features/projects/actions";
import {
  RATE_VISIBILITY_LABEL,
  RATE_VISIBILITY_MODES,
  type RateVisibility,
} from "@/features/projects/service";
import { Card, CardHeader } from "@/components/ui/Card";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";

/**
 * D55 — the one control for the per-project exception to "Site Supervisors see
 * no money". It follows `ClientAccessCard`: a small card on the project
 * dashboard that the page renders for owner/admin only. There is no
 * edit-project dialog and no project settings page to put it in.
 *
 * Changing it here changes what the New Stock Request form offers a site
 * supervisor for THIS project, and nothing else — no list, view or existing
 * row starts showing a rate because of it.
 */
export function RateVisibilityCard({ projectId, value }: { projectId: string; value: RateVisibility }) {
  const { toast } = useApp();
  const router = useRouter();
  // Optimistic local value so the trigger updates on click rather than after
  // the round trip; the server's own value arrives with router.refresh().
  const [mode, setMode] = useState<RateVisibility>(value);
  const save = useAction(setProjectRateVisibility, {
    onSuccess: () => {
      toast("Rate visibility updated");
      router.refresh();
    },
    onError: () => {
      setMode(value);
      toast("Could not update rate visibility.");
    },
  });

  const items = RATE_VISIBILITY_MODES.map((m) => ({ value: m, label: RATE_VISIBILITY_LABEL[m] }));

  return (
    <Card className="mt-5">
      <CardHeader>
        <h3>Rate visibility</h3>
      </CardHeader>
      <div className="px-5 py-4 flex items-center gap-4 flex-wrap">
        <p className="text-[13.5px] text-muted-foreground max-w-prose">
          Whether a site supervisor sees the per-unit Rate field when raising a stock request for this
          project. Hidden by default. Admins always see and edit Rate.
        </p>
        <div className="ml-auto">
          <Select
            items={items}
            value={mode}
            disabled={save.isPending}
            onValueChange={(next: string | null) => {
              const picked = RATE_VISIBILITY_MODES.find((m) => m === next);
              if (!picked || picked === mode) return;
              setMode(picked);
              save.execute({ id: projectId, rateVisibility: picked });
            }}
          >
            <SelectTrigger aria-label="Rate visibility" className="h-9 min-w-56 text-[13px]">
              <SelectValue />
              {save.isPending && <Spinner className="text-muted-foreground" />}
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {items.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
      </div>
    </Card>
  );
}
