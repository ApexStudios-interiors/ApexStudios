"use client";

import { useState } from "react";
import { useApp } from "@/context/AppContext";
import { DialogShell, Field } from "@/components/ui/DialogShell";

export function ApprovalPhotosDialog({ approvalId }: { approvalId: string }) {
  const { data, closeDialog, addApprovalPhotos, toast } = useApp();
  const a = data.approvals.find((x) => x.id === approvalId);
  const [count, setCount] = useState(0);

  if (!a) return null;

  return (
    <DialogShell
      title="Add Sample Photos"
      description={a.item}
      okLabel="Upload"
      onClose={closeDialog}
      onOk={() => {
        addApprovalPhotos(approvalId, count);
        closeDialog();
        toast("Photos added");
      }}
    >
      <Field label="Photos">
        <input
          type="file"
          accept="image/*"
          multiple
          className="px-1.5 py-1.5"
          onChange={(e) => setCount(e.target.files?.length ?? 0)}
        />
      </Field>
    </DialogShell>
  );
}
