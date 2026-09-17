"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useApp } from "@/context/AppContext";
import { requestApproval, getPackageOptions, getPhaseOptions } from "@/features/approvals/actions";
import { APPROVAL_TYPES, type ApprovalType } from "@/features/approvals/schema";
import { approvalTypeLabel } from "@/features/approvals/service";
import { FileUploader } from "@/components/upload/FileUploader";
import { IMAGE_MIME, MAX_IMAGE_BYTES, MAX_PHOTOS_PER_ENTITY } from "@/lib/r2/constraints";
import { DialogShell, Field, inputClass, textareaClass } from "@/components/ui/DialogShell";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DatePicker } from "@/components/shared/DatePicker";

const selectTriggerClass = "w-full text-[13.5px] data-[size=default]:h-9";
const typeItems = APPROVAL_TYPES.map((t) => ({ value: t, label: approvalTypeLabel(t) }));

/**
 * build/08-approvals.md §2.4/§2.5. `approvalId` is generated once, up front
 * — same pattern as `PostUpdateDialog`'s `updateId` (Build 06): `FileUploader`
 * confirms sample photos against it before the real `approvals` row exists
 * (`rpc_create_approval`'s own `p_id` parameter, `schema.ts`'s comment), so
 * the id has to be chosen first and carried through both the uploads and
 * the create call.
 *
 * `supersedes`, when set (build §2.3's "Raise revised approval" action on a
 * rejected row), pre-fills package/phase/type/item from what it replaces and
 * passes its id through as `supersedesId`.
 */
export function NewApprovalDialog({
  projectId,
  moduleId,
  supersedes,
}: {
  projectId: string;
  moduleId?: string;
  supersedes?: { id: string; packageId: string; phaseId: string | null; type: string; item: string };
}) {
  const { closeDialog, toast } = useApp();
  const router = useRouter();

  const [approvalId] = useState(() => crypto.randomUUID());
  const [packages, setPackages] = useState<{ id: string; name: string }[] | null>(null);
  const [phases, setPhases] = useState<{ id: string; name: string }[] | null>(null);
  const [packageId, setPackageId] = useState(supersedes?.packageId ?? moduleId ?? "");
  const [phaseId, setPhaseId] = useState(supersedes?.phaseId ?? "");
  const [type, setType] = useState<ApprovalType>((supersedes?.type as ApprovalType) ?? APPROVAL_TYPES[0]);
  const [neededBy, setNeededBy] = useState("");
  const [item, setItem] = useState(supersedes?.item ?? "");
  const [note, setNote] = useState("");
  const [attachmentIds, setAttachmentIds] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getPackageOptions(projectId)
      .then((opts) => {
        setPackages(opts);
        setPackageId((current) => current || (opts[0]?.id ?? ""));
      })
      .catch(() => toast("Could not load packages."));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once for this dialog instance, matching PostUpdateDialog's own pattern
  }, [projectId]);

  useEffect(() => {
    if (!packageId) return;
    getPhaseOptions(packageId)
      .then(setPhases)
      .catch(() => toast("Could not load phases."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [packageId]);

  const packageItems = packages?.map((p) => ({ value: p.id, label: p.name })) ?? [];
  // A null-valued "None" item lets a chosen phase be cleared again, as the
  // native select's blank option did; it maps back to "" in onValueChange.
  const phaseItems: { value: string | null; label: string }[] = phases?.length
    ? [{ value: null, label: "None" }, ...phases.map((p) => ({ value: p.id, label: p.name }))]
    : [];

  async function onSubmit() {
    if (!item.trim()) {
      setError("Item is required");
      return;
    }
    if (!packageId) {
      setError("Please select a package");
      return;
    }
    setPending(true);
    setError(null);
    const result = await requestApproval({
      id: approvalId,
      projectId,
      packageId,
      phaseId: phaseId || undefined,
      type,
      item,
      note: note || undefined,
      neededBy: neededBy || undefined,
      attachmentIds,
      supersedesId: supersedes?.id,
    });
    setPending(false);
    if (!result?.data) {
      setError(result?.serverError ?? "Could not send this approval request");
      return;
    }
    closeDialog();
    router.push(`/projects/${projectId}/approvals`);
    router.refresh();
    toast(`Approval ${result.data.refNo} sent`);
  }

  return (
    <DialogShell
      title={supersedes ? "Raise Revised Approval" : "Request Approval"}
      description="Sent to the client for sign-off."
      okLabel={pending ? "Sending…" : "Send"}
      okPending={pending}
      onClose={closeDialog}
      onOk={onSubmit}
    >
      <div className="grid grid-cols-2 gap-3.5">
        <Field label="Package" htmlFor="na-package">
          {/* State keeps "" for "no package" (the schema's own shape); Base UI
              wants null, so map at the boundary in both directions. Until the
              options load there is no label to resolve, so show the
              placeholder rather than a pre-filled raw uuid. */}
          <Select
            items={packageItems}
            disabled={!packages}
            value={packages ? packageId || null : null}
            onValueChange={(v) => {
              setPackageId(v ?? "");
              setPhaseId("");
            }}
          >
            <SelectTrigger id="na-package" className={selectTriggerClass}>
              <SelectValue placeholder={packages ? "Select a package" : "Loading…"} />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {packageItems.map((p) => (
                  <SelectItem key={p.value} value={p.value}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
        <Field label="Phase" htmlFor="na-phase">
          <Select
            items={phaseItems}
            disabled={!phases?.length}
            value={phases?.length ? phaseId || null : null}
            onValueChange={(v) => setPhaseId(v ?? "")}
          >
            <SelectTrigger id="na-phase" className={selectTriggerClass}>
              <SelectValue
                placeholder={phases?.length ? "None" : packageId ? "Loading…" : "Select a package first"}
              />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {phaseItems.map((p) => (
                  <SelectItem key={p.value ?? "none"} value={p.value}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
        <Field label="Type" htmlFor="na-type">
          <Select
            items={typeItems}
            value={type}
            onValueChange={(v) => {
              if (v) setType(v);
            }}
          >
            <SelectTrigger id="na-type" className={selectTriggerClass}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {typeItems.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
        <Field label="Needed By" htmlFor="na-needed">
          <DatePicker id="na-needed" value={neededBy} onChange={setNeededBy} />
        </Field>
        <div className="col-span-2">
          <Field label="Item" htmlFor="na-item">
            <input
              id="na-item"
              className={inputClass}
              placeholder="Pool tile, ivory 300x300 anti-skid (Kajaria)"
              value={item}
              onChange={(e) => setItem(e.target.value)}
            />
          </Field>
        </div>
        <div className="col-span-2">
          <Field label="Note" htmlFor="na-note">
            <textarea
              id="na-note"
              className={textareaClass}
              placeholder="Optional"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>
        </div>
        <div className="col-span-2">
          <Field label="Sample Photos">
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
        </div>
        {error && <p className="col-span-2 text-[12.5px] text-destructive">{error}</p>}
      </div>
    </DialogShell>
  );
}
