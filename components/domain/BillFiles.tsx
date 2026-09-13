import { Icon } from "@/components/ui/Icon";

/** build/09-billing.md §4.5. Real presigned download links, replacing the
 *  mock's own `toast("Opening ...")` placeholder — the same real-link
 *  pattern `UpdateList.tsx`'s non-image attachments already use. */
export function BillFiles({ files }: { files: { id: string; name: string; url: string }[] }) {
  if (!files.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5 mt-1.5">
      {files.map((f) => (
        <a
          key={f.id}
          href={f.url}
          className="inline-flex items-center gap-1.5 px-2 py-0.5 border border-border rounded-full text-xs font-medium bg-muted/50 hover:border-ring whitespace-nowrap"
        >
          <Icon name="bill" className="w-3.5 h-3.5" />
          {f.name}
        </a>
      ))}
    </div>
  );
}
