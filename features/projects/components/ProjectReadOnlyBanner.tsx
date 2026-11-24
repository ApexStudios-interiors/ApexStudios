import {
  PROJECT_ARCHIVED_COPY,
  PROJECT_COMPLETED_COPY,
  type ProjectStatus,
} from "@/features/projects/service";

/**
 * APX-41: a finished project says so on every page under it, in plain sight
 * (D62) — the buttons it disables carry the same sentence as their title.
 * Nothing for any other status.
 */
export function ProjectReadOnlyBanner({ status }: { status: ProjectStatus | null }) {
  if (status !== "archived" && status !== "completed") return null;
  return (
    <div
      role="status"
      className="mb-4 rounded-[10px] border border-border bg-muted/50 px-4 py-2.5 text-[13px] text-foreground"
    >
      <span className="font-semibold">{status === "archived" ? "Archived." : "Completed."}</span>{" "}
      {status === "archived"
        ? `${PROJECT_ARCHIVED_COPY} Billing and payments still work. An admin can reopen it from the dashboard.`
        : `${PROJECT_COMPLETED_COPY} Billing, payments, deliveries and approvals carry on.`}
    </div>
  );
}
