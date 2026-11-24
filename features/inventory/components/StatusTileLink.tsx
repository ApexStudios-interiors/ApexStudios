import Link from "next/link";

/**
 * A stat tile's number as a link to the filtered list (APX-51: the Low Stock
 * and Critical tiles drill down to `?status=`). The visible text stays the
 * bare number the tile always showed; the link's accessible name says where it
 * goes. A dotted underline is the only visual change — enough to read as a
 * link without restyling `StatBar`.
 */
export function StatusTileLink({ href, count, label }: { href: string; count: number; label: string }) {
  return (
    <Link
      href={href}
      className="underline decoration-dotted decoration-2 underline-offset-4 hover:decoration-solid rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      aria-label={`${count} ${label} — show them`}
    >
      {count}
    </Link>
  );
}
