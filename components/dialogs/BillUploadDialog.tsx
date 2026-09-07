"use client";

import { useState } from "react";
import { useApp } from "@/context/AppContext";
import { DialogShell, Field } from "@/components/ui/DialogShell";

export function BillUploadDialog({ billId }: { billId: string }) {
  const { data, closeDialog, uploadBillFiles, toast } = useApp();
  const b = data.bills.find((x) => x.id === billId);
  const [files, setFiles] = useState<File[]>([]);

  if (!b) return null;

  return (
    <DialogShell
      title="Upload Bill Copy"
      description={`${b.id} · the client sees this file before approving.`}
      okLabel="Upload"
      onClose={closeDialog}
      onOk={() => {
        uploadBillFiles(
          billId,
          files.map((f) => ({ n: f.name, s: Math.max(1, Math.round(f.size / 1024)) + " KB" }))
        );
        closeDialog();
        toast("Bill copy uploaded");
      }}
    >
      <Field label="Bill PDF / image">
        <input
          type="file"
          accept="application/pdf,image/*"
          multiple
          className="px-1.5 py-1.5"
          onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
        />
      </Field>
    </DialogShell>
  );
}
