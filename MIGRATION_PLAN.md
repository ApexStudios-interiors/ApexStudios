# Migration Plan — Components → Modules

Executes the gap identified in `MODULARIZATION_REPORT.md` §2–§5: move every feature-specific
component out of the flat `components/domain/` and `components/dialogs/` directories into the
`features/<domain>/components/` subfolder AGENTS.md's own repository layout already documents as
the target, and collect the genuinely cross-module pieces into a new `components/shared/`.

This is a pure structural move — file relocation plus import-path fixes. No component's behavior,
props, or exports change. Done on branch `refactor/modularize-components`, one PR.

## Steps

1. **Create target directories**: `features/<domain>/components/` for each of the 9 single-owner
   modules that currently have UI in `components/domain` or `components/dialogs`
   (approvals, billing, packages, schedule, stock, inventory, updates, projects, auth), plus
   `components/shared/`.
2. **`git mv` every file** per the mapping table in `MODULARIZATION_REPORT.md` §2, so history
   follows each file to its new home instead of showing as delete+add.
3. **Move `lib/pdf/BillDocument.tsx`** → `features/billing/components/BillDocument.tsx` (billing
   RA-bill layout; `lib/jobs/handlers/bill.pdf.ts` stays where it is — the `service_role` job
   handler carve-out is a real constraint, not a naming accident).
4. **Rewrite every import** of the old paths (`@/components/domain/*`, `@/components/dialogs/*`,
   `@/features/billing/components/BillDocument`) across `app/`, `features/`, `components/`, and `context/` to point at
   the new location.
5. **Update `eslint.config.mjs`**:
   - Extend the "components take props, no data layer" rule's `files` glob to also cover
     `features/*/components/**`, so a moved dialog is still blocked from importing its own
     module's `queries.ts` at runtime (type-only imports still allowed, same as today).
   - Update the two path literals in the `toLocaleString` exemption list
     (`components/domain/ReqTable.tsx`, `components/domain/InventoryTable.tsx`) to their new paths
     under `features/stock/components/` and `features/inventory/components/`.
   - Add a rule that fails the build if a new file ever lands directly in `components/domain/**`
     or `components/dialogs/**` again, so the structure can't silently regress.
6. **Delete the now-empty** `components/domain/` and `components/dialogs/` directories.
7. **Verify**: `pnpm typecheck && pnpm lint && pnpm test && pnpm build` — no test content changes,
   this only proves the move didn't break an import or a coverage path.
8. **Leave alone** (per the report, tracked by the existing build sequence, not by this refactor):
   `context/AppContext.tsx`, `hooks/useLegacyModule.ts`, `hooks/useProject.ts`,
   `StatusBadges.tsx`'s per-module split (moved whole into `components/shared/` for now, split
   later if wanted).

## Status — done on `refactor/modularize-components`

- [x] Step 1 — `features/{approvals,billing,packages,schedule,stock,inventory,updates,projects,auth}/components/`
      and `components/shared/` created
- [x] Step 2 — all 33 dialogs/domain files moved via `git mv` (history preserved; `git status`
      shows them as renames, not delete+add)
- [x] Step 3 — `lib/pdf/BillDocument.tsx` → `features/billing/components/BillDocument.tsx`;
      `lib/pdf/` removed (was otherwise empty)
- [x] Step 4 — every `@/components/domain/*`, `@/components/dialogs/*`, `@/features/billing/components/BillDocument`
      import rewritten across `app/`, `features/`, `components/`, `e2e/`; `DialogHost.tsx`'s
      relative sibling imports (`./AddProjectDialog` etc.) converted to their new
      module-qualified `@/features/<domain>/components/...` paths
- [x] Step 5 — `eslint.config.mjs`: the components-take-props rule now also covers
      `features/*/components/**`; the `toLocaleString` exemption paths updated to
      `features/stock/components/ReqTable.tsx` / `features/inventory/components/InventoryTable.tsx`;
      new rule fails the build if any file lands in `components/domain/**` or
      `components/dialogs/**` again
- [x] Step 6 — `components/domain/`, `components/dialogs/` deleted (both empty after the moves)
- [x] Step 7 — verification: `pnpm typecheck` (clean), `pnpm lint` (clean, 0 warnings),
      `pnpm test` (230/230 passing), `pnpm build` (compiles, all 26 routes generated),
      `pnpm format:check` (clean)
- [x] Step 8 — `context/AppContext.tsx`, `hooks/useLegacyModule.ts`, `hooks/useProject.ts` left
      untouched; `StatusBadges.tsx` moved whole into `components/shared/` (not split per-module)

`AGENTS.md`'s repository-layout section was also updated to describe the structure as it now is
(`features/<domain>/components/` as real content, `components/shared/` in place of the old
`domain/`/`dialogs/`), plus a new layering-rule bullet stating the ownership rule explicitly.
