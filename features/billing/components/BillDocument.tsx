import { Document, Page, View, Text, StyleSheet } from "@react-pdf/renderer";
import { formatINR } from "@/lib/money";
import { formatINRInWords } from "@/lib/money/words";

/**
 * build/09-billing.md §4.6. Layout is a placeholder shape, not a copy of a
 * real Apex bill — §0.2's own prerequisite ("a real past RA bill... to
 * reconcile the engine against") has not been supplied. It carries every
 * field the build requires and nothing it forbids: Apex's legal name,
 * GSTIN, PAN and address; the client's name, GSTIN and billing address;
 * bill number, date, period; line items; the full A-K breakdown with the
 * snapshotted rates as percentages; amount in words; bank details. NEVER
 * internal cost or margin — this component has no such prop to accidentally
 * render, the same "never fetch it in the first place" shape the rest of
 * this app's client-facing surfaces use.
 */

const styles = StyleSheet.create({
  page: { padding: 32, fontSize: 9, fontFamily: "Helvetica" },
  headerRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 16 },
  orgBlock: { maxWidth: "55%" },
  billBlock: { alignItems: "flex-end" },
  h1: { fontSize: 14, fontWeight: 700, marginBottom: 2 },
  small: { fontSize: 8, color: "#555" },
  section: { marginBottom: 12 },
  sectionTitle: {
    fontSize: 8,
    textTransform: "uppercase",
    color: "#555",
    marginBottom: 3,
    letterSpacing: 0.5,
  },
  table: { display: "flex", flexDirection: "column", borderWidth: 1, borderColor: "#ccc" },
  tr: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#ccc" },
  trLast: { flexDirection: "row" },
  thDesc: { flex: 3, padding: 4, fontWeight: 700, backgroundColor: "#f3f3f3" },
  thNum: { flex: 1, padding: 4, fontWeight: 700, backgroundColor: "#f3f3f3", textAlign: "right" },
  tdDesc: { flex: 3, padding: 4 },
  tdNum: { flex: 1, padding: 4, textAlign: "right" },
  summaryRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2 },
  summaryLabel: { color: "#333" },
  summaryBold: { fontWeight: 700 },
  divider: { borderBottomWidth: 1, borderBottomColor: "#333", marginVertical: 4 },
  words: { marginTop: 10, fontStyle: "italic" },
  footer: { marginTop: 20, flexDirection: "row", justifyContent: "space-between" },
});

export type BillPdfLine = { description: string; clientValue: number; pctBilled: number; amount: number };

export type BillPdfData = {
  refNo: string;
  billDate: string;
  periodFrom: string | null;
  periodTo: string | null;
  org: {
    legalName: string;
    gstin: string;
    pan: string;
    address: string;
    bankName: string;
    bankAccountNo: string;
    bankIfsc: string;
  };
  client: { name: string; gstin: string; billingAddress: string };
  lines: BillPdfLine[];
  workValue: number;
  materialValue: number;
  grossAmount: number;
  masRecoveryAmount: number;
  taxableAmount: number;
  gstAmount: number;
  gstRatePct: number;
  invoiceTotal: number;
  retentionAmount: number;
  retentionPct: number;
  tdsAmount: number;
  tdsPct: number;
  advanceRecovery: number;
  netPayable: number;
};

export function BillDocument({ data }: { data: BillPdfData }) {
  return (
    <Document title={`Bill ${data.refNo}`}>
      <Page size="A4" style={styles.page}>
        <View style={styles.headerRow}>
          <View style={styles.orgBlock}>
            <Text style={styles.h1}>{data.org.legalName}</Text>
            <Text style={styles.small}>{data.org.address}</Text>
            <Text style={styles.small}>
              GSTIN: {data.org.gstin} · PAN: {data.org.pan}
            </Text>
          </View>
          <View style={styles.billBlock}>
            <Text style={styles.h1}>RA Bill</Text>
            <Text style={styles.small}>{data.refNo}</Text>
            <Text style={styles.small}>Date: {data.billDate}</Text>
            {data.periodFrom && data.periodTo && (
              <Text style={styles.small}>
                Period: {data.periodFrom} to {data.periodTo}
              </Text>
            )}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Bill To</Text>
          <Text>{data.client.name}</Text>
          <Text style={styles.small}>{data.client.billingAddress}</Text>
          <Text style={styles.small}>GSTIN: {data.client.gstin}</Text>
        </View>

        <View style={styles.table}>
          <View style={styles.tr}>
            <Text style={styles.thDesc}>Description</Text>
            <Text style={styles.thNum}>Client Value</Text>
            <Text style={styles.thNum}>%</Text>
            <Text style={styles.thNum}>Amount</Text>
          </View>
          {data.lines.map((l, i) => (
            <View key={i} style={i === data.lines.length - 1 ? styles.trLast : styles.tr}>
              <Text style={styles.tdDesc}>{l.description}</Text>
              <Text style={styles.tdNum}>{formatINR(l.clientValue)}</Text>
              <Text style={styles.tdNum}>{l.pctBilled}%</Text>
              <Text style={styles.tdNum}>{formatINR(l.amount)}</Text>
            </View>
          ))}
        </View>

        <View style={{ marginTop: 14, width: "55%", marginLeft: "45%" }}>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Gross (Work + Material)</Text>
            <Text>{formatINR(data.grossAmount)}</Text>
          </View>
          {data.masRecoveryAmount > 0 && (
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Less material at site previously billed</Text>
              <Text>-{formatINR(data.masRecoveryAmount)}</Text>
            </View>
          )}
          <View style={styles.summaryRow}>
            <Text style={[styles.summaryLabel, styles.summaryBold]}>Taxable Value</Text>
            <Text style={styles.summaryBold}>{formatINR(data.taxableAmount)}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>GST @ {data.gstRatePct}%</Text>
            <Text>{formatINR(data.gstAmount)}</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.summaryRow}>
            <Text style={styles.summaryBold}>Invoice Total</Text>
            <Text style={styles.summaryBold}>{formatINR(data.invoiceTotal)}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Less Retention @ {data.retentionPct}%</Text>
            <Text>-{formatINR(data.retentionAmount)}</Text>
          </View>
          {data.tdsAmount > 0 && (
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Less TDS @ {data.tdsPct}% (informational)</Text>
              <Text>-{formatINR(data.tdsAmount)}</Text>
            </View>
          )}
          {data.advanceRecovery > 0 && (
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Less Mobilisation Advance Recovery</Text>
              <Text>-{formatINR(data.advanceRecovery)}</Text>
            </View>
          )}
          <View style={styles.divider} />
          <View style={styles.summaryRow}>
            <Text style={[styles.summaryLabel, styles.summaryBold]}>Net Payable</Text>
            <Text style={styles.summaryBold}>{formatINR(data.netPayable)}</Text>
          </View>
        </View>

        <Text style={styles.words}>{formatINRInWords(data.netPayable)}</Text>

        <View style={styles.footer}>
          <View>
            <Text style={styles.sectionTitle}>Bank Details</Text>
            <Text style={styles.small}>{data.org.bankName}</Text>
            <Text style={styles.small}>A/c No: {data.org.bankAccountNo}</Text>
            <Text style={styles.small}>IFSC: {data.org.bankIfsc}</Text>
          </View>
        </View>
      </Page>
    </Document>
  );
}
