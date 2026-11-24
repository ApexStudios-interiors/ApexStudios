"use client";

import { useRef, useState } from "react";
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
 *
 * APX-46. Each photo becomes an attachment of the approval the moment it
 * finishes uploading, so the client could see photos an admin then abandoned.
 * Now:
 *   * Cancel (or Escape, or the backdrop) deletes every photo this dialog
 *     uploaded, and any still in flight as soon as it lands — the uploader's
 *     `discardOnUnmount`, answered "yes" unless Upload succeeded;
 *   * Upload is disabled while a photo is still uploading (`onBusyChange`),
 *     so nothing half-sent is left out;
 *   * the uploader offers only the slots the approval has left
 *     (MAX_PHOTOS_PER_ENTITY minus the photos already on it).
 */
export function ApprovalPhotosDialog({
  approvalId,
  projectId,
  item,
  existingPhotos = 0,
}: {
  approvalId: string;
  projectId: string;
  item: string;
  existingPhotos?: number;
}) {
  const { closeDialog, toast } = useApp();
  const router = useRouter();
  const [attachmentIds, setAttachmentIds] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set only once addSamplePhotos has succeeded: everything else that closes
  // this dialog is a cancel, and a cancel leaves nothing attached.
  const saved = useRef(false);
  const room = Math.max(0, MAX_PHOTOS_PER_ENTITY - existingPhotos);

  async function onSubmit() {
    if (uploading) {
      setError("Wait for the photos to finish uploading");
      return;
    }
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
    saved.current = true;
    closeDialog();
    router.refresh();
    toast("Photos added");
  }

  return (
    <DialogShell
      title="Add Sample Photos"
      description={item}
      okLabel={pending ? "Saving…" : uploading ? "Uploading…" : "Upload"}
      okPending={pending}
      dirty={attachmentIds.length > 0}
      okDisabled={uploading || room === 0}
      onClose={closeDialog}
      onOk={onSubmit}
    >
      <Field label="Photos">
        {room === 0 ? (
          <p className="text-[13px] text-muted-foreground">
            This approval already has {MAX_PHOTOS_PER_ENTITY} photos, the most it can hold.
          </p>
        ) : (
          <FileUploader
            projectId={projectId}
            entityType="approval"
            entityId={approvalId}
            accept={IMAGE_MIME}
            maxFiles={room}
            maxBytes={MAX_IMAGE_BYTES}
            onChange={setAttachmentIds}
            onBusyChange={setUploading}
            discardOnUnmount={() => !saved.current}
          />
        )}
      </Field>
      {error && <p className="text-[12.5px] text-destructive mt-2">{error}</p>}
    </DialogShell>
  );
}
