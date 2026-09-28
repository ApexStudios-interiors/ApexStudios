"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ChangeMyPasswordDialog } from "./ChangeMyPasswordDialog";

/**
 * Sits on the signed-in user's OWN row on the Users page, where "Change my
 * password" now lives (D64). It replaced the item in the sidebar user menu,
 * which was removed so that everything to do with passwords is in one place —
 * and that place is a page only owner and admin can open.
 *
 * It is deliberately NOT the Reset button beside it. Reset generates a
 * password, shows it once and ends every session; run against yourself that
 * signs you out on the spot and hands you a random string to type back in.
 * This asks for your current password, lets you choose the new one, and keeps
 * you signed in here while ending your other sessions. `passwordResetRefusal`
 * still returns "self" for the Reset path, unchanged.
 *
 * Site and client users have no self-service route at all by design: they are
 * not on this page, and ask an owner or admin (D64).
 */
export function ChangeMyPasswordButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        Change my password
      </Button>
      {open && <ChangeMyPasswordDialog onClose={() => setOpen(false)} />}
    </>
  );
}
