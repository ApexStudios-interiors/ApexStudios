"use client";

import { useApp } from "@/context/AppContext";
import { initials } from "@/lib/logic";
import { Role } from "@/lib/types";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Card } from "@/components/ui/Card";
import { TableWrap } from "@/components/ui/TableWrap";
import { td, th } from "@/components/ui/table";

const ROLE_LABEL: Record<Role, string> = { admin: "Admin", site: "Site Supervisor", client: "Client" };

export default function UsersPage() {
  const { data, openDialog, updateTeamRole, toast } = useApp();

  return (
    <div>
      <div className="flex items-start gap-4 flex-wrap mb-5">
        <div>
          <h1 className="text-[26px] font-bold tracking-tight">Users</h1>
          <p className="mt-1 text-muted-foreground text-[13.5px]">{data.team.length} users</p>
        </div>
        <div className="ml-auto flex gap-2">
          <Button variant="primary" onClick={() => openDialog({ kind: "inviteUser" })}>
            <Icon name="plus" className="w-[15px] h-[15px]" />
            Invite User
          </Button>
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
            {data.team.map((u, i) => (
              <tr key={i}>
                <td className={td}>
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-full bg-muted grid place-items-center text-xs font-semibold">
                      {initials(u.n)}
                    </div>
                    <span className="font-medium">{u.n}</span>
                  </div>
                </td>
                <td className={td + " text-muted-foreground"}>{u.e}</td>
                <td className={td}>
                  <select
                    value={u.r}
                    onChange={(e) => {
                      const v = e.target.value as Role;
                      updateTeamRole(i, v, ROLE_LABEL[v]);
                      toast("Role updated");
                    }}
                    className="h-8 border border-input rounded-lg bg-background px-2 text-[13px]"
                  >
                    <option value="admin">Admin</option>
                    <option value="site">Site Supervisor</option>
                    <option value="client">Client</option>
                  </select>
                </td>
                <td className={td} style={{ textAlign: "right" }}>
                  <Button variant="ghost" size="sm" onClick={() => toast("Removed")}>
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
