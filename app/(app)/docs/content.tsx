import type { ReactNode } from "react";
import { Badge } from "@/components/ui/Badge";
import {
  ApprovalStatusBadge,
  BillStatusBadge,
  PhaseStatusBadge,
  StockLevelBadge,
  StockRequestStatusBadge,
} from "@/components/shared/StatusBadges";

/**
 * Everything the in-app Docs page says, in one place, so a wording change is
 * an edit here and nowhere else. Every fact is taken from the repository —
 * `docs/01-hld.md` (§3, §7.1, §8, §8.4, §10, §11), `docs/decisions.md` and the
 * code — and where the two disagree the code is what is written down here.
 * The status chains render the real badges from `components/shared/StatusBadges.tsx`.
 */

// ── Glossary ─────────────────────────────────────────────────────────────────

export type GlossaryEntry = { term: string; definition: string };
export type GlossaryGroup = { id: string; title: string; entries: GlossaryEntry[] };

export const GLOSSARY: GlossaryGroup[] = [
  {
    id: "glossary-projects",
    title: "Projects",
    entries: [
      {
        term: "Project",
        definition:
          "One client job at one location. It holds packages and moves through Planning, Active, On hold, Completed and Archived.",
      },
      {
        term: "Package",
        definition:
          "A slice of a project's work with its own budget, lead and schedule — for example one room or one trade. A package holds phases.",
      },
      {
        term: "Phase",
        definition:
          "A stage of a package that can be billed once it is done. Each phase carries a billing state: In progress, Billable, Billed or Paid.",
      },
      {
        term: "Task",
        definition:
          "A single piece of scheduled work inside a phase, with a start date, an end date and a progress %. It appears as a bar on the Schedule.",
      },
      {
        term: "Progress %",
        definition:
          "How complete something is. A task's progress is entered by hand; a phase, package and project roll it up automatically, with longer tasks counting for more.",
      },
      {
        term: "Late",
        definition:
          "A task whose end date has passed while its progress is still under 100%. The Schedule marks it with a dashed outline.",
      },
      {
        term: "Daily update",
        definition:
          "A dated note from the site for one package — what was done that day — with photos attached.",
      },
      {
        term: "Schedule",
        definition:
          "The timeline view of a project: one collapsible chart per package showing its tasks as bars, with today highlighted.",
      },
    ],
  },
  {
    id: "glossary-stock",
    title: "Stock & inventory",
    entries: [
      {
        term: "Stock request",
        definition:
          "A request to buy material for a package. It waits for an admin's decision, is then ordered, and is finally marked delivered when it reaches the site.",
      },
      {
        term: "Needed by",
        definition:
          "The date the material must be on site. A still-pending request's date turns red two working days before this date and stays red after it.",
      },
      {
        term: "Minimum stock",
        definition:
          "The stock level at which an item should be re-ordered (this column used to be called \"Reorder level\"). While the quantity on hand is above zero but below this number, the row shows a Low badge and the item counts in the Low Stock tile. Exactly at this level the item still counts as OK; at zero it is Critical, not Low.",
      },
      {
        term: "Inventory",
        definition:
          "What is physically on hand, per project, with an all-projects view under Inventory (ALL) in the sidebar. Quantities change only when a request is marked delivered.",
      },
      {
        term: "Committed",
        definition:
          "The money already spoken for in a package: quantity × rate of every stock request that is Approved, Ordered or Delivered. Visible to owner and admin only.",
      },
      {
        term: "Rate",
        definition:
          "The per-unit price on a stock request. Owner and admin always see and edit it. For Site Supervisors it depends on the project's Rate visibility setting on the project dashboard: Hidden (the default), Visible, not editable, or Visible and editable. Even when editable, a supervisor can type a rate but never read one back.",
      },
    ],
  },
  {
    id: "glossary-approvals",
    title: "Approvals",
    entries: [
      {
        term: "Approval",
        definition:
          "A request for the client to sign off on something before it is used — a Material Sample, a Drawing, a Make/Model, a Milestone, or Other.",
      },
      {
        term: "Sample photos",
        definition:
          "Pictures attached to an approval so the client can see what they are deciding on. They can be added only while the approval is still pending.",
      },
      {
        term: "Decide",
        definition:
          "The client's approve-or-reject on an approval. Only a Client can do this; a rejection needs a reason, and a decided approval is frozen.",
      },
    ],
  },
  {
    id: "glossary-billing",
    title: "Billing",
    entries: [
      {
        term: "RA bill",
        definition:
          "A Running Account bill: one of a series of interim invoices for a project, each charging for the work and material completed since the last one.",
      },
      {
        term: "Bill number",
        definition:
          "The bill's reference, in the form RA-<project code>-01, RA-<project code>-02 and so on, numbered in order per project.",
      },
      {
        term: "Billable Now",
        definition:
          "The list of things ready to go on the next bill: phases whose tasks are all complete, and material that has been delivered.",
      },
      {
        term: "Work value",
        definition: "The client value of the completed phases on this bill.",
      },
      {
        term: "Material value",
        definition:
          "The client value of material delivered to site, billed at the project's material-at-site percentage (75% by default) as an advance rather than a sale.",
      },
      {
        term: "MAS recovery",
        definition:
          "Material-at-site recovery: the material advance already billed earlier that is now part of a phase being billed in full. It is taken off so the client is not charged twice.",
      },
      {
        term: "Taxable value",
        definition: "Work value plus material value, minus MAS recovery. GST is worked out on this figure.",
      },
      {
        term: "GST",
        definition:
          "Goods and Services Tax, at the project's rate (18% by default), charged on the taxable value before retention is taken off.",
      },
      {
        term: "Retention",
        definition:
          "A percentage of the taxable value (5% by default) the client holds back from each bill. It reduces what is payable now; it does not reduce the GST.",
      },
      {
        term: "TDS",
        definition:
          "Tax Deducted at Source: the percentage of the taxable value the client withholds and pays to the tax authority on the contractor's behalf, shown on the bill for information.",
      },
      {
        term: "Advance recovery",
        definition:
          "The part of a mobilisation advance (money paid up front before work began) that is recovered on this bill.",
      },
      {
        term: "Net payable",
        definition: "What the client actually pays on this bill: invoice total minus retention, TDS and advance recovery.",
      },
      {
        term: "Certify",
        definition:
          "The client's sign-off on a submitted bill (the button reads Approve). Only a Client can do this; an admin never can.",
      },
      {
        term: "Payment Pending",
        definition:
          "How the app labels a bill whose status is certified: the client has approved it and payment has not yet been recorded in full.",
      },
      {
        term: "Payment",
        definition:
          "A record of money received against a certified bill. Several partial payments may be recorded; the bill becomes Paid when they add up to the net payable.",
      },
    ],
  },
  {
    id: "glossary-users",
    title: "Users & access",
    entries: [
      {
        term: "Owner",
        definition:
          "The one role above admin. Does everything an admin does, and alone may edit the project's billing constants and change or deactivate an admin.",
      },
      {
        term: "Admin",
        definition:
          "Apex Studios office staff. Sees everything, including internal cost and margin; creates projects and bills, approves stock requests, manages users.",
      },
      {
        term: "Site Supervisor",
        definition:
          "The on-site crew lead. Works with quantities, schedule, inventory and updates. Sees no money at all.",
      },
      {
        term: "Client",
        definition:
          "The property owner. Sees their own projects, contract value and bills — never internal cost or margin. The only role that can decide an approval or certify a bill.",
      },
      {
        term: "Username",
        definition:
          "What everyone signs in with, together with a password, on one login screen. A username like ravi signs in as ravi@beapex.in.",
      },
      {
        term: "Change my password",
        definition:
          "In the user menu at the bottom of the sidebar. You must type your current password, and the new one must be at least 12 characters. You stay signed in on this device; every other device is signed out. This is the only way to change your own password — the admin Reset password button deliberately cannot be aimed at yourself.",
      },
      {
        term: "Client login",
        definition:
          "A client's account, created per project from the project dashboard's Client access card. One client login can be given access to several projects.",
      },
      {
        term: "Preview as (impersonation)",
        definition:
          "An owner or admin viewing a project as a Site Supervisor or Client would, to check what they see. It is read-only, lasts 15 minutes, shows a banner the whole time, and is written to the audit log. The owner can also preview as Admin; an admin cannot. Previewing only changes what you SEE — every action still checks your real role.",
      },
    ],
  },
  {
    id: "glossary-system",
    title: "System",
    entries: [
      {
        term: "Background job",
        definition:
          "Work the app does on its own after you act — resizing a photo, rendering a bill PDF — or on a timer, such as the nightly backup check.",
      },
      {
        term: "Failed Jobs",
        definition:
          "The owner/admin page listing background jobs that gave up after five attempts, with the last error and a Retry button.",
      },
      {
        term: "Idempotency",
        definition:
          "A safety rule: if the same job or action is run twice by accident, the second run changes nothing extra — one photo gets one thumbnail, one bill gets one PDF.",
      },
      {
        term: "Notifications",
        definition:
          "The bell in the header. It lists open WORK across all your projects — pending requests, submitted bills, low stock, pending approvals, depending on your role. It is not an inbox: the count drops when the work is actually done (you approve the request, the client certifies the bill), not when you read the item. Opening one and seeing the number stay the same is expected.",
      },
      {
        term: "Audit log",
        definition:
          "A permanent record of who did what and when: status changes, password resets, preview sessions. It is never edited or deleted.",
      },
    ],
  },
];

// ── Who does what ───────────────────────────────────────────────────────────

export type RoleStory = { id: string; role: string; can: string[]; cannot: string[] };

export const ROLE_STORIES: RoleStory[] = [
  {
    id: "role-owner",
    role: "Owner",
    can: [
      "do everything an Admin can",
      "edit a project's billing constants (GST, retention, material-at-site and TDS percentages)",
      "change the role of, deactivate or reset the password of any user except myself — including an Admin or another Owner",
    ],
    cannot: [
      "decide an approval or certify a bill — those are the Client's acts",
      "act on my own account: change my own role, deactivate myself or reset my own password",
      "edit or delete an audit log entry or a stock movement",
    ],
  },
  {
    id: "role-admin",
    role: "Admin",
    can: [
      "see every project, including internal cost, committed spend and margin",
      "create and edit projects, packages, phases and tasks, and set task progress",
      "post daily updates",
      "raise stock requests, approve or reject them, mark them Ordered and mark them Delivered",
      "request an approval from the client and add sample photos while it is pending",
      "create a bill from Billable Now, submit it, and record payments once the client has certified it",
      "add staff users (Admin or Site Supervisor), create client logins per project and grant an existing client access to another project",
      "change the role of, deactivate or reset the password of a Site Supervisor or Client user",
      "preview a project as a Site Supervisor or Client",
      "see Failed Jobs and retry one",
    ],
    cannot: [
      "decide an approval or certify a bill — the Approve/Reject buttons are the Client's alone",
      "change the Owner's role or password, or another Admin's, or deactivate either",
      "change my own role or deactivate myself",
      "edit a bill after it has been submitted — a correction is a credit note or an adjustment on the next bill",
      "change anything while previewing as another role",
    ],
  },
  {
    id: "role-site",
    role: "Site Supervisor",
    can: [
      "see the dashboard, packages, schedule, daily updates, inventory and stock requests of my projects",
      "add tasks and update task progress",
      "post a daily update with photos",
      "raise a stock request, and mark an ordered request Delivered when it arrives",
      "request an approval and add sample photos while it is pending",
      "see the business-wide Inventory (ALL) view",
      "type a Rate on a new stock request, but only on a project where the owner/admin has set Rate visibility to editable",
    ],
    cannot: [
      "see any money: no budgets, no contract value, no rates on existing requests, no Value column, no bills",
      "approve or reject a stock request, or mark one Ordered",
      "see the Billing page or the Users page",
      "create or edit a project, package or phase",
    ],
  },
  {
    id: "role-client",
    role: "Client",
    can: [
      "see my own projects: dashboard, packages, schedule, daily updates, approvals and bills",
      "see the contract value and work progress of my projects",
      "approve or reject an approval (with a reason when rejecting)",
      "approve a submitted bill (this certifies it) or reject it back to draft with a reason",
      "open a bill's line items and GST breakdown and download its PDF",
      "see pending approvals and submitted bills in the notifications bell",
    ],
    cannot: [
      "see internal cost, margin, committed spend or rates — ever",
      "see inventory or stock requests",
      "post updates, add tasks or change progress",
      "create or edit anything on a project; the client's role is to review and sign off",
    ],
  },
];

// ── How things flow ─────────────────────────────────────────────────────────

export type ChainStep = { badge: ReactNode; who: string };
export type Flow = {
  id: string;
  title: string;
  purpose: string;
  chain: ChainStep[];
  /** Alternative exits from the chain (rejected, cancelled). */
  exits?: ChainStep[];
  steps: string[];
  notes?: string[];
};

export const FLOWS: Flow[] = [
  {
    id: "flow-stock",
    title: "Stock request",
    purpose: "Getting material bought and onto site, with an admin's sign-off before anything is ordered.",
    chain: [
      { badge: <StockRequestStatusBadge status="pending" />, who: "Site Supervisor or admin raises it" },
      { badge: <StockRequestStatusBadge status="approved" />, who: "Owner/admin approves" },
      { badge: <StockRequestStatusBadge status="ordered" />, who: "Owner/admin marks Ordered" },
      { badge: <StockRequestStatusBadge status="delivered" />, who: "Site Supervisor or admin marks Delivered" },
    ],
    exits: [{ badge: <StockRequestStatusBadge status="rejected" />, who: "Owner/admin rejects a pending request, with a reason" }],
    steps: [
      "Open the project's Stock Requests page and click + New Request. Pick the package, material, quantity, unit and Needed By date. Phase is optional — leave it as None, and if the package has no phases the field simply reads \"No phases in this package\". If an identical order (same material, quantity and Needed By) has already been delivered, the form warns: \"This order has already been delivered with the mentioned quantity and deadline date.\"",
      "An owner or admin opens the pending request and clicks Approve or Reject. Rejecting requires a reason. Approving adds the request's value to the package's Committed figure.",
      "Once the material is ordered, the owner/admin clicks Mark Ordered.",
      "When it arrives, the Site Supervisor (or admin) clicks Mark Delivered. Inventory goes up by that quantity and the material appears in Billable Now.",
    ],
    notes: [
      "Red deadline: a pending request's Needed By date turns red from two working days before the date and stays red once the date has passed. Working days are Monday to Friday; there is no holiday calendar, so a public holiday still counts as a working day. Approved, ordered, delivered and rejected requests never show red.",
      "A request cannot skip a step: Pending cannot go straight to Delivered, and a delivered or rejected request cannot be changed.",
    ],
  },
  {
    id: "flow-approval",
    title: "Approval",
    purpose: "Getting the client's recorded sign-off on a sample, drawing, make/model or milestone before it is used.",
    chain: [
      { badge: <ApprovalStatusBadge status="pending" />, who: "Site Supervisor or admin requests it" },
      { badge: <ApprovalStatusBadge status="approved" />, who: "Client approves" },
    ],
    exits: [{ badge: <ApprovalStatusBadge status="rejected" />, who: "Client rejects, with a reason" }],
    steps: [
      "On the project's Approvals page click + Request Approval. Choose the type, the package, add a note and the sample photos.",
      "While it is pending, anyone on the staff side can click Add photos to attach more.",
      "The client sees it in their bell and on the Approvals page, reviews the photos and clicks Approve or Reject (a reason is required to reject).",
      "Once decided the approval and its photos are frozen. A rejected approval is not reopened — raise a new one.",
    ],
  },
  {
    id: "flow-update",
    title: "Daily update",
    purpose: "A dated record of what happened on site, visible to the office and the client.",
    chain: [{ badge: <Badge variant="secondary">Posted</Badge>, who: "Site Supervisor or admin" }],
    steps: [
      "On the project's Daily Updates page click + Post Update. Pick the package, write what was done, and attach photos.",
      "Post it. The update appears at the top of the timeline immediately.",
      "Photo thumbnails are made by a background job, so they show within about five minutes; the full-size photo is available at once.",
    ],
  },
  {
    id: "flow-billing",
    title: "Billing",
    purpose: "Raising an RA bill for finished work and delivered material, getting the client to certify it, and recording the money as it comes in.",
    chain: [
      { badge: <BillStatusBadge status="draft" />, who: "Owner/admin creates it from Billable Now" },
      { badge: <BillStatusBadge status="submitted" />, who: "Owner/admin submits" },
      { badge: <BillStatusBadge status="certified" />, who: "Client approves (certifies) — status certified, shown as Payment Pending" },
      { badge: <BillStatusBadge status="paid" />, who: "Automatic once recorded payments cover the net payable" },
    ],
    exits: [
      { badge: <BillStatusBadge status="cancelled" />, who: "A draft can be abandoned; its lines return to Billable Now. There is no Cancel button on the Billing page yet" },
      { badge: <BillStatusBadge status="draft" />, who: "Client rejects a submitted bill with a reason; it returns to draft with a new revision number" },
    ],
    steps: [
      "On the project's Billing page tick the items in Billable Now and click + Create Bill. The bill is a Draft with the project's GST, retention and material-at-site rates copied onto it.",
      "Click Submit. The bill is locked from here on and a PDF is rendered in the background. If the client rejects it, fix the draft and submit again — a fresh PDF is rendered for the new revision.",
      "The client opens Bills, views the bill and clicks Approve. The status becomes certified, which the app labels Payment Pending.",
      "As money arrives, the owner/admin clicks Record Payment and enters the amount, date, mode and reference. Partial payments are fine; the moment they add up to the net payable the bill turns Paid on its own, and its phases are marked Paid too.",
    ],
    notes: [
      "The phases on a bill move with it: Billable → Billed when the bill is created, and → Paid when it is paid.",
    ],
  },
  {
    id: "flow-users",
    title: "Users",
    purpose: "Giving people a login, keeping their access right, and taking it away when they leave.",
    chain: [
      { badge: <Badge variant="default">Active</Badge>, who: "Created by owner/admin" },
      { badge: <Badge variant="secondary">Deactivated</Badge>, who: "Owner/admin deactivates; reactivating is one click" },
    ],
    steps: [
      "Staff: on the Users page click Add User, enter a username, name and role (Admin or Site Supervisor). The username and a generated password are shown once, each with a Copy button — share them now, because the password cannot be viewed again.",
      "Clients: on the project's dashboard, use the Client access card. Create client login makes a new client account for this project (credentials shown once, as above); Add existing client gives a client who already has a login access to this project.",
      "Reset password: on the Users page click Reset password next to the user. A new password is shown once, and the user is signed out everywhere. An owner may reset anyone but themselves; an admin may reset only Site Supervisors and Clients — never the owner, another admin or themselves.",
      "Change your OWN password from the user menu at the bottom of the sidebar (Change my password). It asks for your current password first, needs at least 12 characters, and signs you out of every other device while keeping you signed in here. Nobody — not even the owner — can reset their own password from the Users page, so this is the route.",
      "Change role, deactivate or reactivate from the same row. The same who-may-act-on-whom rule applies: an admin may act on Site Supervisors and Clients only, the owner on anyone but themselves, and nobody on themselves. Deactivating signs the person out and blocks their login until it is reversed; nothing is deleted.",
    ],
  },
  {
    id: "flow-jobs",
    title: "Background jobs",
    purpose: "The work the app does on its own — after an action or on a timer — and where to look when one of them fails.",
    chain: [
      { badge: <Badge variant="secondary">Pending</Badge>, who: "Queued by an action or a timer" },
      { badge: <Badge variant="default">Running</Badge>, who: "Picked up by the next drain (every 5 minutes)" },
      { badge: <Badge variant="success">Succeeded</Badge>, who: "Done" },
    ],
    exits: [{ badge: <Badge variant="destructive">Failed</Badge>, who: "After 5 attempts — lands on the Failed Jobs page" }],
    steps: [
      "Nothing to do for a normal job: uploading a photo queues a thumbnail, submitting a bill queues its PDF, and the queue is drained every five minutes.",
      "If a job errors it is retried with a growing delay, up to five attempts in all. After the fifth failure it stops and appears on Failed Jobs (owner/admin, under Studio) with its last error.",
      "Fix the cause if there is one, then click Retry on the row. The job is queued again from the start.",
    ],
  },
];

/** What runs when. Times are IST. Sources: `vercel.json`, `.github/workflows/*.yml`,
 *  `app/api/cron/[job]/route.ts`. */
export const JOB_SCHEDULE: { job: string; when: string; what: string }[] = [
  { job: "Thumbnail", when: "After each photo upload", what: "Resizes the photo to 400px for the timeline and approvals list." },
  { job: "Bill PDF", when: "After each bill submission", what: "Renders the RA bill PDF and attaches it to the bill." },
  { job: "Queue drain", when: "Every 5 minutes", what: "Runs whatever is waiting in the queue (the two jobs above)." },
  { job: "Queue reap", when: "Every hour", what: "Re-queues a job that stalled part-way through." },
  { job: "Nightly backup", when: "01:00 daily", what: "Copies the database to backup storage." },
  { job: "Inventory reconcile", when: "02:00 daily", what: "Recomputes every item's quantity on hand from its stock movements and flags any drift." },
  { job: "Backup verify", when: "02:30 daily", what: "Checks that last night's backup file really exists; fails loudly if not." },
  { job: "Weekly maintenance", when: "02:30 every Monday", what: "Deletes uploaded files that no record points to (older than 24 hours) and archives projects completed more than 12 months ago." },
];

// ── Where to find things ────────────────────────────────────────────────────

export const WHERE: { item: string; roles: string; what: string }[] = [
  { item: "All Projects", roles: "Everyone", what: "The portfolio: one card per project you can see. The button at the top of the sidebar opens a list to jump between projects." },
  { item: "Inventory (ALL)", roles: "Owner, Admin, Site", what: "Every project's stock in one table, with a project filter." },
  { item: "Dashboard", roles: "Everyone", what: "A project's stats, its packages, and cards for pending approvals, pending requests and the latest updates. Owner/admin also find the Client access and Rate visibility cards here." },
  { item: "Packages", roles: "Everyone", what: "The project's packages; expand in the sidebar to jump to one. A package page has its budget and phases, schedule, updates, stock requests and (owner/admin) billing." },
  { item: "Schedule", roles: "Everyone", what: "The Gantt chart per package; click a task bar to edit progress and dates (clients see a read-only summary)." },
  { item: "Daily Updates", roles: "Everyone", what: "The site timeline with photos; + Post Update for staff." },
  { item: "Inventory", roles: "Owner, Admin, Site", what: "This project's stock on hand, minimum stock levels and Low/Critical status." },
  { item: "Stock Requests", roles: "Owner, Admin, Site", what: "Raise and progress material requests. The sidebar badge counts pending ones." },
  { item: "Approvals", roles: "Everyone", what: "Client sign-offs on samples and drawings. The sidebar badge (clients only) counts those awaiting a decision." },
  { item: "Billing / Bills", roles: "Owner, Admin, Client", what: "Billable Now and the RA bills (owner/admin); the bills to approve and pay (client, where the badge counts submitted bills)." },
  { item: "Users", roles: "Owner, Admin", what: "Add staff, change roles, reset passwords, deactivate and reactivate." },
  { item: "Failed Jobs", roles: "Owner, Admin", what: "Background jobs that gave up, with their last error and a Retry button." },
  { item: "Docs", roles: "Everyone", what: "This page." },
  { item: "Bell (header)", roles: "Everyone", what: "Open items across all your projects, scoped to your role. Each entry links to the page it concerns." },
  { item: "Sun/moon (header)", roles: "Everyone", what: "Switch between light and dark themes." },
  { item: "Your name (bottom of sidebar)", roles: "Everyone", what: "Sign out; owner/admin inside a project can also Preview as Site Supervisor or Client." },
];

/** The example status chain for phases and stock levels, shown in the glossary
 *  so the badges a reader meets elsewhere are explained once. */
export const LEGEND: { label: string; badges: ReactNode; meaning: string }[] = [
  {
    label: "Phase billing",
    badges: (
      <>
        <PhaseStatusBadge status="Pending" /> <PhaseStatusBadge status="Billable" /> <PhaseStatusBadge status="Billed" />{" "}
        <PhaseStatusBadge status="Paid" />
      </>
    ),
    meaning:
      "In progress until every task is at 100% (or the phase is marked complete by hand); Billable once it is; Billed when put on a bill; Paid when that bill is paid.",
  },
  {
    label: "Stock level",
    badges: (
      <>
        <StockLevelBadge status="ok" /> <StockLevelBadge status="low" /> <StockLevelBadge status="critical" />
      </>
    ),
    meaning: "OK at or above minimum stock; Low when above zero but below it; Critical at zero.",
  },
  {
    label: "Project",
    badges: (
      <>
        <Badge variant="secondary">Planning</Badge> <Badge variant="default">Active</Badge>{" "}
        <Badge variant="secondary">On hold</Badge> <Badge variant="secondary">Completed</Badge>{" "}
        <Badge variant="secondary">Archived</Badge>
      </>
    ),
    meaning: "Set by owner/admin. Archived happens automatically 12 months after completion.",
  },
];
