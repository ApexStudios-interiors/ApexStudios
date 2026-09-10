"use client";

import { createContext, useContext } from "react";
import type { Session } from "@/lib/auth/session";

/**
 * Holds the Session fetched server-side (app/(app)/layout.tsx) and passed as
 * a prop — build/03-auth-and-rbac.md §2.8 step 1. Read-only: nothing here
 * lets a client component fabricate or change its own session. Changing role
 * happens by signing in as someone else, or via impersonation (D20), which is
 * itself a server-verified cookie, not client state.
 */
const SessionContext = createContext<Session | null>(null);

export function SessionProvider({ session, children }: { session: Session; children: React.ReactNode }) {
  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>;
}

/** Throws outside a SessionProvider — every (app) route has one, by construction. */
export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) throw new Error("useSession must be used within SessionProvider, under app/(app)/layout.tsx");
  return session;
}
