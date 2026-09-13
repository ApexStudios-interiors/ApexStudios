import { boolean, index, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { appRole } from "./enums";
import { tsz } from "./columns";

/** Mirrors migration 0003. */
export const orgs = pgTable("orgs", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  legalName: text("legal_name"),
  gstin: text("gstin"),
  pan: text("pan"),
  address: text("address"),
  logoR2Key: text("logo_r2_key"),
  /** Printed on the bill PDF (build/09-billing.md §4.6). */
  bankName: text("bank_name"),
  bankAccountNo: text("bank_account_no"),
  bankIfsc: text("bank_ifsc"),
  createdAt: tsz("created_at").notNull().defaultNow(),
});

export const profiles = pgTable(
  "profiles",
  {
    // References auth.users(id), which Drizzle does not model. The foreign key
    // lives in the migration; introspecting the auth schema here would drag in
    // tables the application must never touch.
    id: uuid("id").primaryKey(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id),
    fullName: text("full_name").notNull(),
    email: text("email"),
    phone: text("phone"),
    role: appRole("role").notNull().default("site"),
    isActive: boolean("is_active").notNull().default(true),
    lastSeenAt: tsz("last_seen_at"),
    createdAt: tsz("created_at").notNull().defaultNow(),
    updatedAt: tsz("updated_at").notNull().defaultNow(),
    deletedAt: tsz("deleted_at"),
  },
  (t) => [index("idx_profiles_org").on(t.orgId)]
);

export const clients = pgTable(
  "clients",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id),
    name: text("name").notNull(),
    contactPerson: text("contact_person"),
    email: text("email"),
    phone: text("phone"),
    gstin: text("gstin"),
    billingAddress: text("billing_address"),
    createdAt: tsz("created_at").notNull().defaultNow(),
    updatedAt: tsz("updated_at").notNull().defaultNow(),
    deletedAt: tsz("deleted_at"),
  },
  (t) => [index("idx_clients_org").on(t.orgId)]
);
