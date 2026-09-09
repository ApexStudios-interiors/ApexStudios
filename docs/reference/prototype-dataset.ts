/**
 * FROZEN COPY — do not edit, do not import.
 *
 * This is `lib/data.ts` as it stood at tag `proto-v1`, the prototype's demo
 * dataset. Build 02 translates it into `supabase/seed.sql` with fixed UUIDs.
 * It is frozen separately so the seed can still be checked against it after
 * `lib/data.ts` is deleted in Build 04-09.
 *
 * Captured: 2026-09-09, from commit e52d6cc.
 * See docs/build/01-foundations.md §3.17.2.
 *
 * Contains demo data only. No real client names beyond the demo dataset.
 */

import { AppData } from "./types";

// Static seed / demo data, ported verbatim (values unchanged) from the
// original mockup. This is the single source of truth for the app's
// in-memory demo dataset.
export const seedData: AppData = {
  projects: [
    {
      id: "bhel",
      name: "BHEL Nagnar Club House",
      client: "T V Rao Housing Pvt Ltd",
      location: "Ghanpur, Hyderabad",
      start: "2026-08-24",
      status: "Active",
      modules: [
        {
          id: "pool",
          name: "Swimming Pool",
          allocated: 4500000,
          internal: 2584054,
          lead: "Suresh K",
          status: "In progress",
          packages: [
            { id: "p1", name: "Surface preparation and waterproofing", alloc: 560000, int: 319630, billedIn: "RA-002" },
            { id: "p2", name: "Pool tiling", alloc: 1175000, int: 679330 },
            { id: "p3", name: "Deck finishes", alloc: 315000, int: 182900 },
            { id: "p4", name: "Overflow channel and balance tank", alloc: 315000, int: 159380 },
            { id: "p5", name: "Filtration plant", alloc: 830000, int: 522560 },
            { id: "p6", name: "Pool plumbing", alloc: 410000, int: 222100 },
            { id: "p7", name: "Water treatment", alloc: 118000, int: 59220 },
            { id: "p8", name: "Pool electricals and lighting", alloc: 440000, int: 248220 },
            { id: "p9", name: "Pool accessories", alloc: 277000, int: 156831 },
            { id: "p10", name: "Testing, commissioning and handover", alloc: 60000, int: 33883 },
          ],
          tasks: [
            { t: "Surface prep and repairs", owner: "Suresh K", w: 1, d: 2, p: 100, pkg: "p1" },
            { t: "Waterproofing, 2 coats and ponding test", owner: "Sai Waterproofing", w: 2, d: 3, p: 100, pkg: "p1" },
            { t: "Overflow channel and balance tank", owner: "Suresh K", w: 3, d: 3, p: 0, pkg: "p4" },
            { t: "Pool plumbing rough-in", owner: "Laxmi Multi Services", w: 3, d: 3, p: 0, pkg: "p6" },
            { t: "Tile sample approval", owner: "Client", w: 4, d: 1, p: 0 },
            { t: "Pool tiling", owner: "Tiling gang A", w: 5, d: 5, p: 0, pkg: "p2" },
            { t: "Deck screed and anti-skid", owner: "Tiling gang B", w: 8, d: 3, p: 0, pkg: "p3" },
            { t: "Filtration plant order", owner: "Procurement", w: 3, d: 1, p: 0, pkg: "p5" },
            { t: "Plant room installation", owner: "OEM", w: 9, d: 3, p: 0, pkg: "p5" },
            { t: "Underwater lights and cabling", owner: "Laxmi Multi Services", w: 9, d: 3, p: 0, pkg: "p8" },
            { t: "Accessories and signage", owner: "Suresh K", w: 11, d: 2, p: 0, pkg: "p9" },
            { t: "Fill, commissioning, training", owner: "OEM", w: 12, d: 2, p: 0, pkg: "p10" },
            { t: "Handover", owner: "Client", w: 13, d: 1, p: 0 },
          ],
        },
        {
          id: "facade",
          name: "Facade and Windows",
          allocated: 7200000,
          internal: 4992470,
          lead: "Prakash R",
          status: "Not started",
          packages: [
            { id: "f1", name: "Surface preparation and plaster repairs", alloc: 189300, int: 142000 },
            { id: "f2", name: "Brick-tile cladding", alloc: 1981836, int: 1423220 },
            { id: "f3", name: "Exterior painting", alloc: 301035, int: 224175 },
            { id: "f4", name: "Facade lighting", alloc: 514700, int: 386000 },
            { id: "f5", name: "Balcony and parapet railings", alloc: 260100, int: 195075 },
            { id: "f6", name: "Entrance canopy and signage", alloc: 413300, int: 310000 },
            { id: "f7", name: "Scaffolding and cleaning", alloc: 696000, int: 522000 },
            { id: "f8", name: "Aluminium windows and ventilators", alloc: 2623729, int: 1625000 },
            { id: "f9", name: "Supervision", alloc: 220000, int: 165000 },
          ],
          tasks: [],
        },
        {
          id: "int",
          name: "Interiors",
          allocated: 18000000,
          internal: 12500000,
          lead: "To assign",
          status: "Design",
          packages: [
            { id: "i1", name: "Flooring", alloc: 3000000, int: 2500000 },
            { id: "i2", name: "Painting and finishes", alloc: 1100000, int: 900000 },
            { id: "i3", name: "False ceilings", alloc: 1400000, int: 1100000 },
            { id: "i4", name: "Toilets and wet areas", alloc: 2200000, int: 1800000 },
            { id: "i5", name: "Doors and hardware", alloc: 1300000, int: 1000000 },
            { id: "i6", name: "Fixed joinery and mirrors", alloc: 1500000, int: 1000000 },
            { id: "i7", name: "Feature walls and partitions", alloc: 1000000, int: 800000 },
            { id: "i8", name: "Light fittings and fans", alloc: 1200000, int: 900000 },
            { id: "i9", name: "Project overhead", alloc: 600000, int: 600000 },
            { id: "i10", name: "Function hall AV", alloc: 300000, int: 250000 },
            { id: "i11", name: "Blinds and curtains", alloc: 200000, int: 150000 },
            { id: "i12", name: "Loose furniture", alloc: 1000000, int: 800000 },
            { id: "i13", name: "Gym equipment", alloc: 500000, int: 450000 },
            { id: "i14", name: "Indoor games tables", alloc: 300000, int: 250000 },
          ],
          tasks: [],
        },
        {
          id: "ext",
          name: "External Development and Lift",
          allocated: 12800000,
          internal: 7965000,
          lead: "Prakash R",
          status: "Not started",
          packages: [
            { id: "e1", name: "External development", alloc: 8500000, int: 5465000 },
            { id: "e2", name: "Passenger lift", alloc: 3500000, int: 2500000 },
          ],
          tasks: [],
        },
        {
          id: "mep",
          name: "MEP",
          allocated: 13800000,
          internal: 8463365,
          lead: "Laxmi Multi Services",
          status: "Not started",
          packages: [
            { id: "m1", name: "Electrical distribution and wiring", alloc: 6850000, int: 4119450 },
            { id: "m2", name: "Air conditioning", alloc: 3100000, int: 1891215 },
            { id: "m3", name: "Ventilation and exhaust", alloc: 525000, int: 317600 },
            { id: "m4", name: "Water supply and plumbing", alloc: 1340000, int: 809600 },
            { id: "m5", name: "Drainage and rainwater", alloc: 900000, int: 542200 },
            { id: "m6", name: "ELV and CCTV", alloc: 635000, int: 383300 },
            { id: "m7", name: "Testing and commissioning", alloc: 650000, int: 400000 },
          ],
          tasks: [],
        },
        {
          id: "civ",
          name: "Plastering and Putty",
          allocated: 2500000,
          internal: 2000000,
          lead: "To assign",
          status: "Not started",
          packages: [
            { id: "c1", name: "Internal wall plastering", alloc: 1740000, int: 1392000 },
            { id: "c2", name: "Wall and ceiling putty", alloc: 760000, int: 608000 },
          ],
          tasks: [],
        },
      ],
    },
    {
      id: "arch",
      name: "BHEL Nagnar Entrance Arch",
      client: "T V Rao Housing Pvt Ltd",
      location: "Ghanpur, Hyderabad",
      start: null,
      status: "Quoted",
      modules: [
        {
          id: "a1",
          name: "Entrance Arch",
          allocated: 3700000,
          internal: 2660000,
          lead: "To assign",
          status: "Quoted",
          packages: [],
          tasks: [],
        },
      ],
    },
  ],
  requests: [
    { id: "SR-014", proj: "bhel", mod: "pool", pkg: "p2", item: "Pool-grade vitrified tile 300x300, anti-skid", qty: 1200, unit: "sft", rate: 165, by: "Ravi", need: "2026-10-05", status: "Pending", raised: "2026-09-06" },
    { id: "SR-013", proj: "bhel", mod: "pool", pkg: "p1", item: "Dr. Fixit Pidifin 2K, 20 kg kit", qty: 40, unit: "kit", rate: 4050, by: "Ravi", need: "2026-09-08", status: "Delivered", raised: "2026-09-02" },
    { id: "SR-012", proj: "bhel", mod: "pool", pkg: "p1", item: "Ultratech 53 grade cement, 50 kg", qty: 120, unit: "bag", rate: 395, by: "Ravi", need: "2026-08-27", status: "Delivered", raised: "2026-08-25", billedIn: "RA-001" },
    { id: "SR-011", proj: "bhel", mod: "pool", pkg: "p1", item: "Bonding agent, SBR latex 20 L", qty: 10, unit: "can", rate: 2100, by: "Ravi", need: "2026-08-29", status: "Delivered", raised: "2026-08-25", billedIn: "RA-001" },
    { id: "SR-010", proj: "bhel", mod: "pool", pkg: "p6", item: "uPVC pipe 63 mm SCH 80, 3 m", qty: 60, unit: "len", rate: 640, by: "Ravi", need: "2026-09-12", status: "Pending", raised: "2026-09-06" },
    { id: "SR-009", proj: "bhel", mod: "int", pkg: "i1", item: "Vitrified tile sample set", qty: 1, unit: "set", rate: 0, by: "Ravi", need: "2026-09-10", status: "Rejected", raised: "2026-09-01" },
  ],
  bills: [
    {
      id: "RA-001",
      proj: "bhel",
      date: "2026-08-30",
      status: "Paid",
      submitted: "2026-08-30",
      certified: "2026-09-02",
      paid: "2026-09-04",
      lines: [
        { type: "material", mod: "pool", pkg: "p1", desc: "SR-012 Ultratech 53 grade cement, 120 bag", cost: 47400, client: 83045, pct: 75 },
        { type: "material", mod: "pool", pkg: "p1", desc: "SR-011 Bonding agent, SBR latex, 10 can", cost: 21000, client: 36792, pct: 75 },
      ],
      recovery: 0,
      files: [{ n: "RA-001 Apex Studios Bill.pdf", s: "296 KB" }],
    },
    {
      id: "RA-002",
      proj: "bhel",
      date: "2026-09-05",
      status: "Submitted",
      submitted: "2026-09-05",
      lines: [
        { type: "milestone", mod: "pool", pkg: "p1", desc: "Surface preparation and waterproofing complete", cost: 319630, client: 560000, pct: 100 },
        { type: "material", mod: "pool", pkg: "p4", desc: "SR-013 Balance tank waterproofing, Pidifin 2K, 18 kit", cost: 64800, client: 112500, pct: 75 },
      ],
      recovery: 119837,
      files: [
        { n: "RA-002 Apex Studios Bill.pdf", s: "318 KB" },
        { n: "RA-002 Measurement sheet.xlsx", s: "44 KB" },
      ],
    },
    {
      id: "RA-003",
      proj: "bhel",
      date: "2026-09-06",
      status: "Submitted",
      submitted: "2026-09-06",
      lines: [
        { type: "material", mod: "facade", pkg: "f7", desc: "SR-014 Cup-lock scaffolding, 1,200 sqm", cost: 180000, client: 240000, pct: 75 },
      ],
      recovery: 0,
      files: [],
    },
  ],
  updates: [
    { id: "u4", proj: "bhel", mod: "pool", date: "2026-09-07", by: "Ravi", text: "Second coat of Pidifin on pool floor and walls done, 1,600 sft. Balance tank first coat started. Ponding test planned for Thursday.", men: 6, photos: 4 },
    { id: "u3", proj: "bhel", mod: "pool", date: "2026-09-06", by: "Ravi", text: "First coat waterproofing completed on main pool walls. Kids pool surface prep finished. Two honeycomb patches repaired near the deep end.", men: 7, photos: 6 },
    { id: "u2", proj: "bhel", mod: "pool", date: "2026-09-05", by: "Ravi", text: "Cement received, 120 bags. Surface grinding and cleaning complete on main pool. Started primer.", men: 5, photos: 3 },
    { id: "u1", proj: "bhel", mod: "facade", date: "2026-09-04", by: "Ravi", text: "Scaffolding vendor measured the north face. Plaster repair marking done with the architect.", men: 2, photos: 2 },
  ],
  approvals: [
    { id: "AP-004", proj: "bhel", mod: "pool", pkg: "p2", type: "Material sample", item: "Pool tile, ivory 300x300 anti-skid (Kajaria), coping in matching bullnose", by: "Suresh K", requested: "2026-09-05", need: "2026-09-14", status: "Pending", note: "Sample board at site office. Holds tiling start on W5.", photos: 3 },
    { id: "AP-003", proj: "bhel", mod: "pool", pkg: "p8", type: "Material", item: "Underwater lights: 9 nos IP68 LED, Astral in place of Pentair", by: "Suresh K", requested: "2026-09-04", need: "2026-09-20", status: "Pending", note: "Deviation from quoted make. Same lumen and warranty.", photos: 2 },
    { id: "AP-002", proj: "bhel", mod: "pool", pkg: "p1", type: "Material", item: "Waterproofing system: Dr. Fixit Pidifin 2K, two coats", by: "Suresh K", requested: "2026-08-26", need: "2026-08-30", status: "Approved", decided: "2026-08-28", note: "", photos: 1 },
    { id: "AP-001", proj: "bhel", mod: "facade", pkg: "f2", type: "Design", item: "Facade family: dark grey granite, brass jali, dark grey ACP band (Option B)", by: "John", requested: "2026-08-30", need: "2026-09-05", status: "Approved", decided: "2026-09-02", note: "", photos: 4 },
  ],
  team: [
    { n: "John Israel Voola", r: "admin", t: "Admin", e: "hello@beapex.in" },
    { n: "Suresh K", r: "admin", t: "Admin", e: "suresh@beapex.in" },
    { n: "Prakash R", r: "admin", t: "Admin", e: "prakash@beapex.in" },
    { n: "Ravi", r: "site", t: "Site Supervisor", e: "+91 98xxx xxxxx" },
    { n: "Meena D", r: "admin", t: "Admin", e: "meena@beapex.in" },
    { n: "T V Rao", r: "client", t: "Client", e: "T V Rao Housing Pvt Ltd" },
  ],
  inventory: [
    { id: "INV-01", proj: "bhel", name: "Ultratech 53 grade cement, 50 kg", category: "Cement & Aggregates", qty: 40, unit: "bag", reorderLevel: 50, unitCost: 395, location: "Site store" },
    { id: "INV-02", proj: "bhel", name: "Dr. Fixit Pidifin 2K, 20 kg kit", category: "Waterproofing", qty: 5, unit: "kit", reorderLevel: 10, unitCost: 4050, location: "Site store" },
    { id: "INV-03", proj: "bhel", name: "Pool-grade vitrified tile 300x300", category: "Tiling", qty: 0, unit: "sft", reorderLevel: 500, unitCost: 165, location: "Site store" },
    { id: "INV-04", proj: "bhel", name: "uPVC pipe 63 mm SCH 80, 3 m", category: "Plumbing", qty: 45, unit: "len", reorderLevel: 20, unitCost: 640, location: "Site store" },
    { id: "INV-05", proj: "bhel", name: "Bonding agent, SBR latex 20 L", category: "Waterproofing", qty: 3, unit: "can", reorderLevel: 5, unitCost: 2100, location: "Site store" },
    { id: "INV-06", proj: "bhel", name: "Cup-lock scaffolding", category: "Scaffolding", qty: 1100, unit: "sqm", reorderLevel: 500, unitCost: 150, location: "Facade yard" },
    { id: "INV-07", proj: "bhel", name: "Aluminium window profile", category: "Facade", qty: 0, unit: "rft", reorderLevel: 200, unitCost: 850, location: "Warehouse" },
    { id: "INV-08", proj: "bhel", name: "Tile adhesive, pool grade, 20 kg", category: "Tiling", qty: 60, unit: "bag", reorderLevel: 40, unitCost: 380, location: "Site store" },
  ],
};

export const FLOW = ["Pending", "Approved", "Ordered", "Delivered"] as const;
export const TODAY = new Date("2026-09-07");
export const GST = 18;
export const RET = 5;
export const MAS = 75;
export const L = 100000;
export const CR = 10000000;
