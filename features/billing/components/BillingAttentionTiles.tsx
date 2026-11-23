import Link from "next/link";
import type { BillingAttention } from "@/features/billing/queries";
import { Card } from "@/components/ui/Card";
import { formatINRCompact } from "@/lib/money";
import { plural } from "@/lib/plural";
import { todayIst } from "@/lib/dates";
import { daysAgoLabel, daysBetween } from "@/features/projects/portfolio";

/**
 * APX-48: the admin project dashboard's money-to-chase row — Billable Now,
 * Outstanding (certified, unpaid) and Awaiting certification — each a link to
 * Billing. ADMIN ONLY, and only while BILLING_ENABLED: the caller decides both
 * and never renders this for another role; the figures come from
 * `getBillingAttention`, which reads admin-only tables.
 *
 * Same look as `StatBar`'s tiles, but each tile is a link, which StatBar's
 * plain cards cannot be without restyling a shared primitive.
 */
export function BillingAttentionTiles({
  data,
  billingHref,
  today,
}: {
  data: BillingAttention;
  billingHref: string;
  /** `yyyy-MM-dd`, business timezone — for "certified N days ago". */
  today: string;
}) {
  const oldest =
    data.oldestCertifiedAt != null
      ? daysAgoLabel(daysBetween(todayIst(new Date(data.oldestCertifiedAt)), today))
      : null;
  const tiles = [
    {
      label: "Billable Now",
      value: formatINRCompact(data.billableNowValue),
      sub: data.billableNowCount
        ? `${plural(data.billableNowCount, "item")} ready to bill`
        : "Nothing to bill",
    },
    {
      label: "Outstanding",
      value: formatINRCompact(data.outstanding),
      sub: data.certifiedUnpaidCount
        ? `${plural(data.certifiedUnpaidCount, "certified bill")} unpaid${oldest ? ` · oldest ${oldest}` : ""}`
        : "No certified bill unpaid",
    },
    {
      label: "Awaiting Certification",
      value: formatINRCompact(data.awaitingCertificationValue),
      sub: data.awaitingCertificationCount
        ? `${plural(data.awaitingCertificationCount, "bill")} with the client`
        : "None submitted",
    },
  ];
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(min(170px,100%),1fr))] gap-4 mb-5">
      {tiles.map((t) => (
        <Link
          key={t.label}
          href={billingHref}
          className="block rounded-[10px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Card className="h-full px-[22px] py-[18px] hover:border-foreground transition-colors">
            <div className="text-[11.5px] font-semibold text-muted-foreground uppercase tracking-wide">
              {t.label}
            </div>
            <div className="text-[23px] font-bold tracking-tight mt-[7px] leading-tight">{t.value}</div>
            <div className="text-xs text-muted-foreground mt-1">{t.sub}</div>
          </Card>
        </Link>
      ))}
    </div>
  );
}
