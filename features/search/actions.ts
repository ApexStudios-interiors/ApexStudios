"use server";

import "server-only";
import { authedAction } from "@/lib/safe-action";
import { searchAllSchema } from "./schema";
import { searchFor } from "./run";

/**
 * build/07-stock-inventory-notifications.md §2.7. Guard (authed), parse,
 * delegate — no business arithmetic here (AGENTS.md's own layering rule).
 * The rate limit and the search itself live in ./run.ts, shared with the
 * mobile API; the per-entity role scoping and the result caps live in
 * queries.ts/service.ts.
 */
export const searchAll = authedAction
  .inputSchema(searchAllSchema)
  .action(async ({ parsedInput, ctx }) => searchFor(ctx.session, parsedInput.query));
