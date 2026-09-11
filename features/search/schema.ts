import { z } from "zod";

/** build §2.7: "Minimum two characters." Enforced here so the action refuses
 *  the query before running seven `ilike` scans over it. */
export const searchAllSchema = z.object({
  query: z.string().trim().min(2, "Type at least 2 characters."),
});
