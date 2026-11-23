import Link from "next/link";
import type { ActionItemDTO } from "@/features/notifications/queries";
import { ageLabel } from "@/features/notifications/service";
import { Badge } from "@/components/ui/Badge";
import { Empty } from "@/components/ui/Empty";
import { TableWrap } from "@/components/ui/TableWrap";
import { sub, td, th, thNum, tdNum } from "@/components/ui/table";
import { dmy } from "@/lib/logic";

/**
 * The "Needs my action" list (APX-72, D68). A Server Component: rows arrive
 * as props from `getActionItems`, oldest first. Every row is a link to the
 * page where the action is taken; nothing here acts on its own.
 *
 * No amounts by construction — the view's titles carry none.
 */
export function ActionItemsTable({ items }: { items: ActionItemDTO[] }) {
  if (items.length === 0) {
    return <Empty>Nothing is waiting on you. New items appear here as soon as they need you.</Empty>;
  }

  return (
    <TableWrap>
      <thead>
        <tr>
          <th className={th}>Action</th>
          <th className={th}>Item</th>
          <th className={th}>Project</th>
          <th className={th}>Since</th>
          <th className={thNum}>Waiting</th>
        </tr>
      </thead>
      <tbody>
        {items.map((item) => (
          <tr key={`${item.kind}-${item.entityId}`} className="hover:bg-muted/60">
            <td className={`${td} whitespace-nowrap`}>
              <Badge variant="secondary">{item.action}</Badge>
            </td>
            <td className={td}>
              <Link
                href={item.href}
                className="font-medium text-foreground rounded-sm hover:underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                {item.title}
              </Link>
            </td>
            <td className={td}>
              {item.projectName ?? <span className="text-muted-foreground">Central store</span>}
            </td>
            <td className={`${td} whitespace-nowrap text-muted-foreground`}>
              {dmy(item.since.slice(0, 10))}
            </td>
            <td className={`${tdNum} whitespace-nowrap tabular-nums`}>
              <span className={item.ageDays >= 7 ? "font-semibold text-foreground" : "text-muted-foreground"}>
                {ageLabel(item.ageDays)}
              </span>
              {item.ageDays >= 7 && <span className={sub}>a week or more</span>}
            </td>
          </tr>
        ))}
      </tbody>
    </TableWrap>
  );
}
