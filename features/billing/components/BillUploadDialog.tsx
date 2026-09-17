"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useApp } from "@/context/AppContext";
import { uploadBillCopy } from "@/features/billing/actions";
import { FileUploader } from "@/components/upload/FileUploader";
import { DOC_MIME, IMAGE_MIME, MAX_DOC_BYTES, MAX_PHOTOS_PER_ENTITY } from "@/lib/r2/constraints";
import { DialogShell, Field } from "@/components/ui/DialogShell";

/** build/09-billing.md §4.5. A scanned physical invoice/challan the client
 *  sees before certifying — not the system-generated PDF (`bill.pdf` job),
 *  which is linked automatically once it renders. */
export function BillUploadDialog({ billId, projectId }: { billId: string; projectId: string }) {
  const { closeDialog, toast } = useApp();
  const router = useRouter();
  const [attachmentIds, setAttachmentIds] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit() {
    if (attachmentIds.length === 0) {
      setError("Add at least one file");
      return;
    }
    setPending(true);
    setError(null);
    const result = await uploadBillCopy({ billId, attachmentIds });
    setPending(false);
    if (!result?.data) {
      setError(result?.serverError ?? "Could not upload this file");
      return;
    }
    closeDialog();
    router.refresh();
    toast("Bill copy uploaded");
  }

  return (
    <DialogShell
      title="Upload Bill Copy"
      description="The client sees this file before approving."
      okLabel={pending ? "Uploading…" : "Upload"}
      okPending={pending}
      onClose={closeDialog}
      onOk={onSubmit}
    >
      <Field label="Bill PDF / image">
        <FileUploader
          projectId={projectId}
          entityType="bill"
          entityId={billId}
          accept={[...IMAGE_MIME, ...DOC_MIME]}
          maxFiles={MAX_PHOTOS_PER_ENTITY}
          maxBytes={MAX_DOC_BYTES}
          onChange={setAttachmentIds}
        />
      </Field>
      {error && <p className="text-[12.5px] text-destructive mt-2">{error}</p>}
    </DialogShell>
  );
}
