"use client";

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ALL_ROLES, ROLE_LABEL, type Role } from "@/lib/rbac/roles";

const ROLE_ITEMS = ALL_ROLES.map((r) => ({ value: r, label: ROLE_LABEL[r] }));

/**
 * The Users table's role column, on shadcn Select. Read-only for now: it shows
 * the real role, but changing it is build/03-auth-and-rbac.md §2.10's
 * `setUserRole` — owner-only, and required to revoke the user's sessions in
 * the same operation (a JWT keeps its old app_role until it expires). That
 * revocation is not built, and a dropdown that appears to change a role
 * without doing so would be worse than one that plainly cannot.
 */
export function UserRoleSelect({ role }: { role: Role }) {
  return (
    <Select items={ROLE_ITEMS} value={role} disabled>
      <SelectTrigger
        size="sm"
        className="min-w-36 text-[13px]"
        title="Changing a role is not available yet — it must also sign the user out everywhere."
        aria-label="Role"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {ROLE_ITEMS.map((r) => (
            <SelectItem key={r.value} value={r.value}>
              {r.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
