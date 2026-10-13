export const th =
  "text-left font-semibold text-[11.5px] uppercase tracking-wide text-muted-foreground px-3 py-2.5 border-b border-border whitespace-nowrap h-10";
export const thNum = th + " text-right";
export const td = "px-3 py-3 border-b border-border align-middle";
export const tdNum = td + " text-right";
export const trClick = "cursor-pointer hover:bg-muted/60";
export const trTotal = "font-bold bg-muted/50";
export const sub = "block text-xs text-muted-foreground font-normal mt-0.5";

/**
 * A row's sequence number, in a column of its own.
 *
 * Not a span inside the name cell: a name that wraps then puts its first line
 * after the number and its second hard against the cell edge, aligned with
 * neither. A cell cannot wrap underneath its neighbour.
 *
 * `w-px` with `text-right` makes the column only as wide as its digits and
 * keeps the right edge straight. `tabular-nums` keeps 01 and 11 the same
 * width. `align-top` overrides the shared `align-middle` on both cells, so on
 * a two-line name the number sits beside the FIRST line, where the eye starts,
 * rather than floating against the middle of the block.
 *
 * A table that adds this column must also widen the first cell of any totals
 * row — `colSpan={2}` — or every figure below lands one column left of its
 * heading.
 */
export const thSeq = th + " w-px pr-0 text-right";
export const tdSeq = td + " w-px pr-0 text-right align-top tabular-nums text-muted-foreground";
/** The cell beside `tdSeq`, top-aligned to match it. */
export const tdTop = td + " align-top";
