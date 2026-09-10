# Build 03 — Authentication, Session, RBAC & User Administration

> **This file is a prompt.** It replaces the prototype's sidebar role-switcher with real
> identity, and turns `01-hld.md` §7.1's permission matrix into code that runs on every request.
>
> **Depends on:** Build 02 (schema, `profiles`, `project_members`, helper functions).
> **Blocks:** Builds 04–09 — every feature guard, every role-shaped query.
> **Branch:** `build/03-auth-and-rbac`

---

## 0. Prerequisites — what a human must do outside the codebase

### 0.1 In the Supabase dashboard (both `apex-dev` and `apex-prod`)

- [ ] **Disable public sign-up.** Authentication → Providers → Email → turn off "Enable sign
      ups". This system is invitation-only (`01-hld.md` §6). Confirm by POSTing to `/auth/v1/signup`
      with the anon key and getting a refusal. Do this before anything else: an open signup
      endpoint on a project with real data is a live incident.
- [ ] **Register the custom access token hook.** Authentication → Hooks → Customize Access Token
      → select `public.custom_access_token_hook`. The function ships in a migration in this
      build; registering it is a dashboard action that migrations cannot perform, and it must be
      repeated for every environment including preview branches.
- [ ] **Set the access token TTL to 1800 seconds** (30 minutes). `01-hld.md` §6 makes this the
      mitigation for stale role claims after a demotion. A longer TTL widens the window in which
      a demoted user keeps their old permissions.
- [ ] **Enable MFA (TOTP)** and require it for `owner` and `admin` (`architecture.md` T12).
- [ ] **Set the password policy**: minimum 12 characters, leaked-password protection on.
- [ ] **Configure SMTP.** Authentication → Emails → SMTP Settings, pointed at the Resend/SES
      account from Build 01 §0.4. **Supabase's built-in SMTP is rate-limited to a few emails per
      hour and will silently drop client magic links.** Verify the sending domain's SPF and DKIM
      records resolve before testing.
- [ ] **Customise the email templates** — magic link and invite. Apex branding, plain language,
      a stated 10-minute expiry, and a "you didn't request this" line.
- [ ] **Set Site URL and Redirect URLs** for each environment: `http://localhost:3000`,
      the Vercel preview wildcard, and `https://app.beapex.in`. A missing redirect URL makes
      magic links land on an error page with no server-side log.

### 0.2 Decisions to close

- [ ] **Phone OTP: in or out for v1?** `01-hld.md` §6 offers clients "magic link **or** phone
      OTP". Phone OTP needs a paid SMS provider (MSG91 or Twilio), an Indian sender ID
      registration (DLT), and template approval — that is a multi-week regulatory process, not a
      configuration step. **Recommendation: ship v1 with magic link only**, and record phone OTP
      as deferred. If it is wanted, the DLT registration must start now. Record as **D15**.
- [ ] **D8 confirmed** — is there an `owner` role, and who is it? This build makes `setUserRole`
      and `deactivateUser` owner-only. If D8 is still `PENDING`, stop.
- [ ] **Impersonation ("preview as"): approved?** `01-hld.md` §3.1 specifies a read-only,
      audit-logged, banner-flagged admin capability to see what a client sees. It is a genuine
      operational need for a product built on differential visibility, and it is also an admin
      reading client-scoped data by design. Confirm it is wanted, and that it is **read-only** —
      an impersonating admin must not be able to certify a bill or decide an approval. Record as
      **D16**.

### 0.3 Data to collect

- [ ] **The real staff list**: full name, email, phone, role, and which projects each site
      supervisor is a member of. Needed for the first production invite round in Build 10.
- [ ] **The client contact**: T V Rao's email address, and confirmation he is expecting an
      invitation email. A magic link arriving unannounced from an unknown domain gets deleted.
- [ ] **A test mailbox** you control, for e2e tests. Do not use a real person's address in CI.

---

## 1. Objective

- Three real sign-in paths: staff email + password (+ TOTP for admin/owner), client magic link.
- A session available to every Server Component and Server Action, carrying `userId`, `role`,
  `orgId`, and a way to test project membership.
- The permission matrix from `01-hld.md` §7.1 expressed **once**, in code, driving the sidebar,
  the route guards and the action guards.
- Users administration: invite, change role, deactivate — with refresh-token revocation.
- The sidebar's role-switcher gone, replaced by real identity plus admin impersonation.

The UI keeps its current appearance. The user card at the bottom-left keeps its shape; its
"Switch role" menu becomes "Preview as" for admins and disappears for everyone else.

---

## 2. Steps

### 2.1 The custom access token hook

Migration: `public.custom_access_token_hook(event jsonb)` from `02-lld.md` §5.2, stamping
`app_metadata.app_role` and `app_metadata.org_id` into the JWT at issue time.

Grant it to `supabase_auth_admin` and revoke it from `authenticated` and `anon` — a hook that
users can call is a hook users can reason about.

Registering it is a dashboard action (§0.1). Add a startup assertion: a server-side check that
`auth.jwt() -> 'app_metadata' ->> 'app_role'` is populated for the current session, logged as a
warning if it is not. Because `auth_role()` falls back to a table read, a misregistered hook is
otherwise invisible — the system just gets slower and nobody finds out until the query plan
matters (`architecture.md` §8.4).

### 2.2 The two Supabase clients, never mixed

`architecture.md` §4.1 is precise about this. Implement exactly three modules:

| Module | Key | Runs as | Callable from |
|---|---|---|---|
| `lib/supabase/server.ts` | anon + user JWT from cookie | The signed-in user. **RLS applies.** | Server Components, Server Actions |
| `lib/supabase/client.ts` | anon | The signed-in user, in the browser | Client Components that need realtime or auth UI only |
| `lib/supabase/admin.ts` | `service_role` | Superuser. **RLS bypassed.** | `lib/jobs/handlers/**` and `lib/auth/admin.ts` — nothing else |

`admin.ts` starts with `import 'server-only'` and carries a comment explaining that importing it
into a request path is a full RLS bypass. The ESLint import restriction from Build 01 §3.11 is
the mechanical enforcement; verify it actually fires by trying to import it from a page and
confirming lint fails.

### 2.3 Middleware

`middleware.ts` at the repo root, per `architecture.md` §3:

1. Refresh the Supabase session on every request (`@supabase/ssr`'s
   `createServerClient` + `getUser()`; cookies must be written back to the response).
2. Generate a `request_id` (UUID) and attach it as a header, for log correlation and for the
   error id shown to users (`02-lld.md` §10).
3. Redirect unauthenticated requests to `/login`, except `/login`, `/client-login`,
   `/auth/callback`, `/api/health` and static assets.
4. Do **not** put authorisation logic here. Middleware runs on the edge with a partial view of
   the request and is the wrong place for role decisions. It answers "are you signed in", nothing
   more.

Matcher: exclude `_next/static`, `_next/image`, `favicon.ico`, and `/api/cron/*` (cron
authenticates with a Bearer secret, not a session).

### 2.4 The session accessor

`lib/auth/session.ts`:

```ts
import 'server-only';
import { cache } from 'react';

export type Session = {
  userId: string;
  orgId: string;
  role: 'owner' | 'admin' | 'site' | 'client';
  fullName: string;
  email: string | null;
  impersonating: { role: Role; projectId: string } | null;
};

export const getSession = cache(async (): Promise<Session | null> => { … });
export async function requireSession(): Promise<Session> { … }        // throws UNAUTHENTICATED
export async function requireRole(roles: Role[]): Promise<Session> { … } // throws FORBIDDEN
export async function requireProjectAccess(s: Session, projectId: string): Promise<void> { … }
```

Wrap in React's `cache()` so a layout and a page in the same render share one lookup rather than
issuing two round trips (`architecture.md` §7.4).

`requireProjectAccess` must ask the **database**, not a cached list: `owner`/`admin` pass
implicitly (`02-lld.md` §3.2); `site`/`client` require a `project_members` row. RLS will catch a
mistake here, but a clean 403 is a better user experience than an empty page.

### 2.5 RBAC as a single source of truth

`lib/rbac/` — the permission matrix expressed once and consumed by everything.

- `roles.ts` — the `Role` type, display labels (`Admin`, `Site Supervisor`, `Client`, `Owner`).
- `permissions.ts` — the capability table from `01-hld.md` §7.1 as data:
  ```ts
  export const CAN = {
    viewBilling:        ['owner', 'admin', 'client'],
    viewInventory:      ['owner', 'admin', 'site'],
    seeInternalCost:    ['owner', 'admin'],
    approveStockRequest:['owner', 'admin'],
    markDelivered:      ['owner', 'admin', 'site'],
    decideApproval:     ['client'],          // deliberately excludes admin
    certifyBill:        ['client'],          // deliberately excludes admin
    createBill:         ['owner', 'admin'],
    manageUsers:        ['owner'],
    …
  } as const satisfies Record<string, readonly Role[]>;
  export const can = (role: Role, cap: keyof typeof CAN) => CAN[cap].includes(role);
  ```
  Put a comment above `decideApproval` and `certifyBill`: *"Admin is excluded deliberately.
  `01-hld.md` §7.1 — an Admin self-certifying destroys the audit value of the whole chain. Do
  not add an Admin bypass, including for testing."*
- `nav.ts` — replaces the existing `lib/nav.ts`. Same `Section` union, same `sectionFromPath`,
  but the allowed-sections map is derived from `CAN` rather than duplicated, and it gains the
  `owner` role and the label/badge functions from `02-lld.md` §8.2 (`Billing` → `Bills` for a
  client, badge counts per role).

A test asserts `CAN` matches the matrix in `01-hld.md` §7.1 row for row. When the matrix changes,
the doc and the code change together or the test fails.

### 2.6 Action clients

`lib/safe-action.ts` — the guards from `02-lld.md` §7:

```ts
export const actionClient   = createSafeActionClient({ handleServerError: mapDomainError });
export const authedAction   = actionClient.use(requireSessionMiddleware);
export const adminAction    = authedAction.use(requireRoleMiddleware(['owner', 'admin']));
export const ownerAction    = authedAction.use(requireRoleMiddleware(['owner']));
export const clientAction   = authedAction.use(requireRoleMiddleware(['client']));
export const siteAction     = authedAction.use(requireRoleMiddleware(['owner','admin','site']));
```

Guarding is the default, not something to remember. `actionClient` itself should be used only by
the login actions; add a lint rule or a code comment making that explicit.

`mapDomainError` implements `02-lld.md` §10 in full: map Postgres `errcode`s and thrown
`ActionError`s onto the eight user-facing messages, attach the `request_id`, and send anything
unmapped to Sentry with a generic message. **Never** let a raw Postgres error string reach the
browser — they contain table and column names, and sometimes values.

If Build 01 found `next-safe-action` incompatible with Next.js 16, implement the same shape by
hand. The interface above is what Builds 04–09 will import; keep it stable either way.

### 2.7 Authentication routes and screens

Route group `app/(auth)/`, outside the app shell (no sidebar, no header):

- `login/page.tsx` — email + password for staff. TOTP challenge step when enrolled.
- `client-login/page.tsx` — email → magic link. Success state says "check your email", names
  the 10-minute expiry, and offers a resend with a 60-second cooldown.
- `auth/callback/route.ts` — exchanges the code for a session, then redirects by role:
  admin/owner/site → `/`, client → `/` (the portfolio page already role-shapes itself).
- `logout` — a POST action, not a link. A GET logout is CSRF-triggerable from an `<img>` tag.
- `auth/error/page.tsx` — expired or already-used link, with a path back.

Style them with the existing primitives in `components/ui/`. Monochrome, Inter, the same card
and button treatment as the dialogs. **Do not introduce a new visual language for auth** — it is
the first screen every user sees.

Rate-limit the magic link and password endpoints (`architecture.md` T14). A per-IP and per-email
throttle in the action is enough for v1; Vercel WAF rules come in Build 10.

### 2.8 Replace the role-switcher with real identity

This is the one visible change in this build, and it must be done carefully because
`context/AppContext.tsx` currently supplies `role` to roughly every component in the app.

Do it in this order, so nothing breaks in between:

1. Add `components/auth/SessionProvider.tsx` — a client context holding the `Session` fetched
   server-side in `app/layout.tsx` and passed as a prop. Export `useSession()`.
2. Change `AppContext`'s `role` to be **initialised from and locked to** the session value.
   Keep the `role` field on the context so no component's imports change yet.
3. Update `components/layout/Sidebar.tsx`: the user card shows the real name, initials from
   `full_name` (`02-lld.md` §3.1 — derived, never stored), and the real role label. The
   "Switch role" menu becomes:
   - **owner/admin:** "Preview as → Client / Site Supervisor" (§2.9), plus "Sign out"
   - **site/client:** "Sign out" only
4. Update `app/projects/[projectId]/layout.tsx`. It currently redirects client-side when the
   role cannot see a section. Keep that as UX, and **add a server-side assertion** in the layout:
   `requireProjectAccess(session, projectId)`. Hiding a nav item is UX; the layout guard and RLS
   are the security (`02-lld.md` §8.2).
5. Once Build 09 is done and no component reads `role` from `AppContext`, delete the field.
   Not before.

### 2.9 Impersonation — "preview as"

Only if D16 is approved.

- An owner/admin action `startPreview({ role, projectId })` sets a signed, short-lived
  (15-minute) httpOnly cookie holding the previewed role and project.
- `getSession()` reads it and returns `impersonating: { role, projectId }` while keeping the real
  `userId`. **Queries use the previewed role for shaping; every write path checks the real
  session and refuses.** An impersonating admin gets a read-only application.
- A persistent banner across the top: *"Previewing as Client — T V Rao. Exit preview."*
  It must be visually unmissable and it must not be dismissible.
- `fn_audit(entity_type='session', action='impersonate')` on start and on stop.
- Preview never grants access the real user lacks: an admin can preview a client's view of a
  project, not another org.

Test it: an impersonating admin attempting `decideApproval` or `transitionBill(→certified)`
must get `FORBIDDEN`, from the RPC, not from the UI.

### 2.10 User administration

`features/users/`:

| Action | Guard | Behaviour |
|---|---|---|
| `inviteUser` | admin | Create the `auth.users` record via the admin API, insert the `profiles` row in the same logical operation, send the invite email, add `project_members` rows for the selected projects |
| `setUserRole` | **owner** | Update `profiles.role`, then **`auth.admin.signOut(userId, 'global')`** |
| `deactivateUser` | **owner** | `is_active = false`, global sign-out, soft-delete. Never hard-delete — the audit trail references the profile |
| `addProjectMember` / `removeProjectMember` | admin | Membership management |

**`setUserRole` without the token revocation is a security bug.** A JWT holds `app_role` until it
expires; a demoted admin keeps admin permissions for up to 30 minutes otherwise
(`01-hld.md` §6, `architecture.md` T4). Write the revocation and the test in the same commit.
If the sign-out call fails, the action must fail — do not update the role and swallow the error,
because that is the worst of both outcomes.

`inviteUser` is two writes across two systems (GoTrue and Postgres) and cannot be one
transaction. Make it recoverable: create the auth user first, then the profile; if the profile
insert fails, delete the auth user before returning the error. Add a reconciliation query to the
Build 10 ops page listing `auth.users` rows with no `profiles` row.

Wire `app/users/page.tsx` and `InviteUserDialog.tsx` to these actions. The existing table keeps
its shape. The role dropdown becomes a real action with a confirmation step — changing someone's
role signs them out, and the person doing it should know that.

### 2.11 The 403 and 404 surfaces

Add `app/(app)/forbidden.tsx` and per-segment `error.tsx`. A user who lands on a page their role
cannot see gets a plain, calm explanation and a link home — not a stack trace, and not a blank
page. Include the `request_id` in small print so a support conversation can find the log line.

---

## 3. Tests

### 3.1 pgTAP

- The hook function is owned correctly and is not executable by `authenticated`.
- `auth_role()` returns the right value from a JWT claim, **and** falls back correctly when the
  claim is absent (simulate a missing hook).
- `is_member_of()` is true for an admin with no `project_members` row, true for a site user with
  one, false for a site user without one.

### 3.2 Integration (Vitest, real Supabase sessions)

| ID | Assertion |
|---|---|
| T-15 | Changing a user's role revokes refresh tokens; the old access token no longer grants the old role |
| — | `inviteUser` failing at the profile insert leaves no orphan `auth.users` row |
| — | `setUserRole` called by an `admin` (not `owner`) is refused |
| — | Public sign-up is refused by the hosted project |
| — | An expired magic link produces the error page, not a session |
| — | An impersonating admin is refused on every write path |
| — | Rate limiting: the 11th magic-link request in a minute for one address is refused |

### 3.3 Playwright

Three login journeys, one per role, saved as storage-state fixtures that every later e2e test
reuses. Assert after each login:
- **admin** sees Billing, Inventory, Stock Requests, Users in the sidebar
- **site** sees Inventory and Stock Requests, **not** Billing, **not** Users
- **client** sees Bills and Approvals, **not** Inventory, **not** Stock Requests, **not** Users

Then assert the negative directly, not just visually: a client navigating to
`/projects/{id}/stock` by URL gets the forbidden surface. Hidden nav is not access control, and
the test should prove the difference.

---

## 4. Verification — exit criteria

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm test:rls && pnpm test:e2e && pnpm build
```

Manual:
- [ ] Sign in as each of the three seeded users against local Supabase. The sidebar, header and
      available routes match `01-hld.md` §7.1 exactly.
- [ ] A client magic link arrives in the real test mailbox within 30 seconds and signs in.
- [ ] Demote an admin to site in one browser; within one page navigation the second browser's
      session is signed out. Not after 30 minutes — immediately.
- [ ] `POST /auth/v1/signup` against the hosted project is refused.
- [ ] Importing `lib/supabase/admin` from a page fails `pnpm lint`.
- [ ] The impersonation banner is visible, and every write is refused while it is up.
- [ ] Screenshot diff against `proto-v1`: the only intended differences are the sidebar user
      card and the new auth screens.
- [ ] `docs/progress-tracker.md` updated; D15 and D16 recorded.

---

## 5. Guardrails — do not

- **Do not add an Admin bypass** for `decideApproval` or `certifyBill`, in the RPC, the action,
  or a test helper. If a test needs a certified bill, it signs in as the client fixture.
- **Do not put role checks in `middleware.ts`.** Authentication there, authorisation in the
  action and in the database.
- **Do not use the `service_role` key** anywhere reachable from a request path, including "just
  to make the invite work".
- **Do not store the role in `localStorage`**, a client cookie you write yourself, or React state
  that survives a sign-out. The JWT is the only source (`AGENTS.md`: localStorage is for the
  theme preference and nothing else).
- **Do not delete `AppContext`'s `role` field yet.** Build 09 does that.
- **Do not ship phone OTP** unless D15 says yes and the DLT registration is complete.
- **Do not let a raw Postgres error reach the browser.**

---

## 6. Deliverables

- [ ] `custom_access_token_hook` migration + dashboard registration in all environments
- [ ] `lib/supabase/{server,client,admin}.ts` with the import restriction proven to fire
- [ ] `middleware.ts` — session refresh, request id, unauthenticated redirect only
- [ ] `lib/auth/session.ts` — `getSession`, `requireSession`, `requireRole`, `requireProjectAccess`
- [ ] `lib/rbac/{roles,permissions,nav}.ts`, with the test tying `CAN` to `01-hld.md` §7.1
- [ ] `lib/safe-action.ts` — five guarded clients + full `02-lld.md` §10 error mapping
- [ ] `(auth)` route group: staff login, TOTP, client magic link, callback, error, logout
- [ ] `SessionProvider`; sidebar user card on real identity; server-side project access assertion
- [ ] Impersonation with banner, audit entries and read-only enforcement (if D16 approved)
- [ ] `features/users/` — invite, set role (with revocation), deactivate, membership
- [ ] Forbidden and error surfaces carrying the request id
- [ ] Tests: pgTAP, T-15 + six integration assertions, three Playwright login journeys with
      saved storage state
