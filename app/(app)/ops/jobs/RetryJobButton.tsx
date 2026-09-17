"use client";

import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { retryJob } from "@/features/ops/actions";
import { Button } from "@/components/ui/button";
import { useApp } from "@/context/AppContext";

export function RetryJobButton({ id }: { id: string }) {
  const router = useRouter();
  const { toast } = useApp();
  const action = useAction(retryJob, {
    onSuccess: () => {
      toast("Job queued for retry");
      router.refresh();
    },
    onError: ({ error }) => toast(error.serverError ?? "Could not retry this job"),
  });

  return (
    <Button variant="ghost" size="sm" onClick={() => action.execute({ id })} disabled={action.isPending}>
      {action.isPending ? "Retrying…" : "Retry"}
    </Button>
  );
}
