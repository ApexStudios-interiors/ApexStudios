"use client";

import { InfoIcon } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * The info affordance beside the Inventory table's "Minimum Stock" header —
 * the column's old "Reorder Level" wording said nothing to a storekeeper
 * about what the number does. The one interactive leaf in an otherwise
 * server-rendered table, which is why it is its own `"use client"` file.
 *
 * The wording describes the real rule, not a plausible one:
 * `inventoryStatus()` (features/inventory/service.ts) and the
 * `stock_status`/`low_count` expressions it mirrors
 * (`rpc_inventory_stats`, `v_inventory_status`) treat qty = 0 as Critical
 * before anything else, Low only for 0 < qty < reorder_level, and the
 * boundary itself (qty = reorder_level) as OK.
 */
export function MinimumStockInfo() {
  return (
    <Tooltip>
      <TooltipTrigger
        aria-label="What is minimum stock?"
        className="ml-1 inline-flex align-middle rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <InfoIcon className="w-3.5 h-3.5" aria-hidden="true" />
      </TooltipTrigger>
      <TooltipContent className="max-w-[260px] text-left font-normal normal-case tracking-normal">
        The stock level at which this item should be re-ordered. While the quantity on hand is above zero but
        below this number, the row shows a Low badge and the item is counted in the Low Stock tile above.
        Exactly at this level the item still counts as OK; at zero it is Critical, not Low.
      </TooltipContent>
    </Tooltip>
  );
}
