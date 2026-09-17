"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useApp } from "@/context/AppContext";
import { addSamplePhotos } from "@/features/approvals/actions";
import { FileUploader } from "@/components/upload/FileUploader";
import { IMAGE_MIME, MAX_IMAGE_BYTES, MAX_PHOTOS_PER_ENTITY } from "@/lib/r2/constraints";
import { DialogShell, Field } from "@/components/ui/DialogShell";

/**
 * build/08-approvals.md §2.5 step 5: "On `addSamplePhotos`, hidden once
 * decided." `ApprovalTable` already disables the button that opens this once
 * `canAddPhotos` is false — this dialog's own submit is a second, real check
 * (`addSamplePhotos`'s own guard, plus the RLS freeze underneath it), not
 * just the button being absent.
 */
export function ApprovalPhotosDialog({
  approvalId,
  projectId,
  item,
}: {
  approvalId: string;
  projectId: string;
  item: string;
}) {
  const { closeDialog, toast } = useApp();
  const router = useRouter();
  const [attachmentIds, setAttachmentIds] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit() {
    if (attachmentIds.length === 0) {
      setError("Add at least one photo");
      return;
    }
    setPending(true);
    setError(null);
    const result = await addSamplePhotos({ approvalId, attachmentIds });
    setPending(false);
    if (!result?.data) {
      setError(result?.serverError ?? "Could not add these photos");
      return;
    }
    closeDialog();
    router.refresh();
    toast("Photos added");
  }

  return (
    <DialogShell
      title="Add Sample Photos"
      description={item}
      okLabel={pending ? "Uploading…" : "Upload"}
      okPending={pending}
      onClose={closeDialog}
      onOk={onSubmit}
    >
      <Field label="Photos">
        <FileUploader
          projectId={projectId}
          entityType="approval"
          entityId={approvalId}
          accept={IMAGE_MIME}
          maxFiles={MAX_PHOTOS_PER_ENTITY}
          maxBytes={MAX_IMAGE_BYTES}
          onChange={setAttachmentIds}
        />
      </Field>
      {error && <p className="text-[12.5px] text-destructive mt-2">{error}</p>}
    </DialogShell>
  );
}
