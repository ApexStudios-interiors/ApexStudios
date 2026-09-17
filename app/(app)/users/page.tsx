import { requireRole } from "@/lib/auth/session";
import { listUsers } from "@/features/users/queries";
import { UserRoleSelect } from "@/features/users/components/UserRoleSelect";
import { initials } from "@/lib/logic";
import { OpenDialogButton } from "@/components/shared/OpenDialogButton";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/Icon";
import { Card } from "@/components/ui/Card";
import { TableWrap } from "@/components/ui/TableWrap";
import { td, th } from "@/components/ui/table";

/**
 * Server Component over real `profiles` rows (was AppContext mock data), so a
 * user created by Add User appears here after the dialog's router.refresh().
 * Guarded to owner/admin (CAN.viewUsers) on the server rather than by hiding
 * the sidebar link.
 *
 * Remove is kept in place but disabled: deactivation is owner-only and must
 * revoke sessions (build/03-auth-and-rbac.md §2.10's deactivateUser), which is
 * not built — the prototype's "Removed" toast against a real account would
 * claim something that did not happen.
 */
export default async function UsersPage() {
  await requireRole(["owner", "admin"]);
  const users = await listUsers();

  return (
    <div>
      <div className="flex items-start gap-4 flex-wrap mb-5">
        <div>
          <h1 className="text-[26px] font-bold tracking-tight">Users</h1>
          <p className="mt-1 text-muted-foreground text-[13.5px]">{users.length} users</p>
        </div>
        <div className="ml-auto flex gap-2">
          <OpenDialogButton dialog={{ kind: "inviteUser" }} variant="primary">
            <Icon name="plus" className="w-[15px] h-[15px]" />
            Add User
          </OpenDialogButton>
        </div>
      </div>
      <Card>
        <TableWrap>
          <thead>
            <tr>
              <th className={th}>Name</th>
              <th className={th}>Contact</th>
              <th className={th}>Role</th>
              <th className={th}></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td className={td}>
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-full bg-muted grid place-items-center text-xs font-semibold">
                      {initials(u.fullName)}
                    </div>
                    <span className="font-medium">{u.fullName}</span>
                  </div>
                </td>
                <td className={td + " text-muted-foreground"}>{u.contact ?? "—"}</td>
                <td className={td}>
                  <UserRoleSelect role={u.role} />
                </td>
                <td className={td} style={{ textAlign: "right" }}>
                  <Button variant="ghost" size="sm" disabled title="Removing a user is not available yet.">
                    Remove
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </Card>
    </div>
  );
}
