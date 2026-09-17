import { requireRole } from "@/lib/auth/session";
import { countActiveOwners, listUsers } from "@/features/users/queries";
import { UserRoleSelect } from "@/features/users/components/UserRoleSelect";
import { DeactivateUserButton } from "@/features/users/components/DeactivateUserButton";
import { ResetPasswordButton } from "@/features/users/components/ResetPasswordButton";
import { activeChangeRefusal, passwordResetRefusal, roleControlRefusal } from "@/features/users/service";
import { initials } from "@/lib/logic";
import { parsePageRequest } from "@/lib/pagination";
import { OpenDialogButton } from "@/components/shared/OpenDialogButton";
import { TablePagination } from "@/components/shared/TablePagination";
import { Badge } from "@/components/ui/Badge";
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
 * Every per-row control is offered where the rule allows it and disabled, with
 * the reason as its title, where it does not — the role select
 * (roleControlRefusal), Deactivate/Reactivate (activeChangeRefusal) and Reset
 * password (passwordResetRefusal, D52). Deciding it here is a courtesy: the
 * server action re-checks the same function, and the database checks it again
 * inside the statement that performs the change.
 */
export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; pageSize?: string }>;
}) {
  const session = await requireRole(["owner", "admin"]);
  // The REAL role, as the actions use: a preview never changes who may do what.
  const actor = { userId: session.userId, role: session.role };
  const [users, activeOwners] = await Promise.all([
    listUsers(parsePageRequest(await searchParams)),
    countActiveOwners(),
  ]);

  return (
    <div>
      <div className="flex items-start gap-4 flex-wrap mb-5">
        <div>
          <h1 className="text-[26px] font-bold tracking-tight">Users</h1>
          <p className="mt-1 text-muted-foreground text-[13.5px]">{users.total} users</p>
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
            {users.rows.map((u) => {
              // listUsers returns live rows only, so deletedAt is null here.
              const target = { ...u, deletedAt: null };
              return (
                <tr key={u.id}>
                  <td className={td}>
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-full bg-muted grid place-items-center text-xs font-semibold">
                        {initials(u.fullName)}
                      </div>
                      <span className="font-medium">{u.fullName}</span>
                      {!u.isActive && <Badge variant="secondary">Deactivated</Badge>}
                    </div>
                  </td>
                  <td className={td + " text-muted-foreground"}>{u.contact ?? "—"}</td>
                  <td className={td}>
                    <UserRoleSelect
                      userId={u.id}
                      fullName={u.fullName}
                      role={u.role}
                      refusal={roleControlRefusal(actor, target, { activeOwners })}
                    />
                  </td>
                  <td className={td} style={{ textAlign: "right" }}>
                    <div className="flex justify-end gap-1">
                      <ResetPasswordButton
                        userId={u.id}
                        fullName={u.fullName}
                        refusal={passwordResetRefusal(actor, target)}
                      />
                      <DeactivateUserButton
                        userId={u.id}
                        fullName={u.fullName}
                        isActive={u.isActive}
                        refusal={activeChangeRefusal(actor, target, !u.isActive, { activeOwners })}
                      />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </TableWrap>
        <TablePagination page={users.page} pageSize={users.pageSize} total={users.total} />
      </Card>
    </div>
  );
}
