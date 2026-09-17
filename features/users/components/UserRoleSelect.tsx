"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ROLE_LABEL, type Role } from "@/lib/rbac/roles";
import { setUserRole } from "@/features/users/actions";
import { ASSIGNABLE_ROLES, type AssignableRole, type UserAdminRefusal } from "@/features/users/service";
import { USER_ADMIN_REFUSAL_TITLE } from "./refusal-copy";

/**
 * The Users table's role column. The picked role is confirmed before anything
 * happens, because a role change also signs the user out everywhere: the JWT
 * carries their old role until it expires, and RLS believes the claim, so the
 * only way a demotion takes effect now rather than in half an hour is to end
 * the session that holds it.
 *
 * `value` stays the server's role until the page re-renders with the new one,
 * so a cancelled or failed change never leaves the row showing something the
 * database does not say. Whether the control is enabled comes from the same
 * rule the server enforces (roleControlRefusal); disabling it is a courtesy —
 * setUserRole, rpc_set_user_role and the trigger on `profiles` each check
 * again.
 */
export function UserRoleSelect({
  userId,
  fullName,
  role,
  refusal,
}: {
  userId: string;
  fullName: string;
  role: Role;
  refusal: UserAdminRefusal | null;
}) {
  const router = useRouter();
  const [picked, setPicked] = useState<AssignableRole | null>(null);

  const change = useAction(setUserRole, {
    onSuccess: () => {
      setPicked(null);
      router.refresh();
    },
  });

  // The owner role is never assignable (D8), so it appears only when it is the
  // role this user already has — without it in `items`, Base UI's closed
  // trigger would have no label to show for them.
  const items = (ASSIGNABLE_ROLES as readonly Role[]).includes(role)
    ? ASSIGNABLE_ROLES.map((r) => ({ value: r, label: ROLE_LABEL[r] }))
    : [
        { value: role, label: ROLE_LABEL[role] },
        ...ASSIGNABLE_ROLES.map((r) => ({ value: r, label: ROLE_LABEL[r] })),
      ];

  return (
    <>
      <Select
        items={items}
        value={role}
        disabled={refusal !== null}
        onValueChange={(next) => {
          if (next !== role) setPicked(next as AssignableRole);
        }}
      >
        <SelectTrigger
          size="sm"
          className="min-w-36 text-[13px]"
          title={refusal ? USER_ADMIN_REFUSAL_TITLE[refusal] : undefined}
          aria-label="Role"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {items.map((r) => (
              <SelectItem key={r.value} value={r.value} disabled={r.value === role}>
                {r.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>

      <Dialog
        open={picked !== null}
        onOpenChange={(open) => {
          if (!open && !change.isPending) {
            setPicked(null);
            change.reset();
          }
        }}
      >
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>
              Make {fullName} {picked ? ROLE_LABEL[picked] : ""}?
            </DialogTitle>
            <DialogDescription>
              {fullName} is signed out everywhere and must sign in again. They lose whatever their current
              role could see and get what a {picked ? ROLE_LABEL[picked] : "new"} can see instead.
            </DialogDescription>
          </DialogHeader>
          {change.result.serverError && (
            <p className="text-[12.5px] text-destructive">{change.result.serverError}</p>
          )}
          <DialogFooter>
            <DialogClose render={<Button variant="default" disabled={change.isPending} />}>
              Cancel
            </DialogClose>
            <Button
              variant="primary"
              disabled={change.isPending}
              onClick={() => {
                if (picked) change.execute({ userId, role: picked });
              }}
            >
              {change.isPending ? "Changing…" : "Change role"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
