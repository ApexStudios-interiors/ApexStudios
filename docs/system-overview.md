# Apex Projects — System Overview

One page for the whole system. Diagrams first, prose only where a diagram can't say it.
Detail lives in `01-hld.md` (domain), `02-lld.md` (schema), `architecture.md` (operations).

---

## 1. What it is

Apex Studios is an interiors contractor. This platform is the single record of its jobs —
budgets, site work, materials, client sign-off, and RA billing.

**The one rule everything else serves:** only Admin sees the gap between what the client is
charged (`allocated`) and what the work costs (`internal`). Three roles, one dataset, three
different truths.

---

## 2. System context

```mermaid
flowchart TB
    Admin["👔 Admin<br/>Apex staff<br/><i>sees cost + margin</i>"]
    Site["🔨 Site Supervisor<br/>on site, mobile<br/><i>sees no money</i>"]
    Client["🏠 Client<br/>property owner<br/><i>sees contract value only</i>"]

    App(["<b>APEX PROJECTS</b><br/>Next.js on Vercel"])

    DB[("Supabase Postgres<br/>data + auth + RLS")]
    R2[("Cloudflare R2<br/>private bucket")]
    Jobs["Vercel Cron<br/>+ jobs table in Postgres"]

    Admin --> App
    Site --> App
    Client --> App

    App --> DB
    App --> R2
    Jobs --> App
    Jobs --> DB
    Jobs --> R2

    style App fill:#1f2937,color:#fff
    style DB fill:#e5e7eb
    style R2 fill:#e5e7eb
```

Accounting stays external — humans move exported XLSX to Tally/Zoho. No integration in v1.
No email in v1 either: notification is the in-app bell, read live from the database.

---

## 3. Domain hierarchy

```mermaid
flowchart LR
    O[Org<br/>Apex Studios] --> C[Client<br/>T V Rao Housing]
    C --> P[Project<br/>BHEL Nagnar Club House]
    P --> PK[Package<br/>Swimming Pool · Facade · MEP]
    PK --> PH[Phase<br/>own allocated + internal budget]
    PH --> T[Task<br/>dates + % complete]

    P --> SR[Stock Requests]
    P --> AP[Approvals]
    P --> DU[Daily Updates]
    P --> B[Bills]
    P --> INV[Inventory]

    style P fill:#1f2937,color:#fff
```

Money lives on **packages and phases**. Progress rolls **up** from tasks. Billing draws from
completed phases and delivered materials.

---

## 4. Data model

```mermaid
erDiagram
    ORGS ||--o{ CLIENTS : has
    CLIENTS ||--o{ PROJECTS : commissions
    PROJECTS ||--o{ PACKAGES : "broken into"
    PACKAGES ||--o{ PHASES : "broken into"
    PHASES ||--o{ TASKS : scheduled
    PROJECTS ||--o{ PROJECT_MEMBERS : "scopes access"
    PROFILES ||--o{ PROJECT_MEMBERS : "member of"

    PROJECTS ||--o{ STOCK_REQUESTS : raises
    STOCK_REQUESTS ||--o{ STOCK_REQUEST_EVENTS : "audited by"
    STOCK_REQUESTS ||--o| STOCK_MOVEMENTS : "on delivery"
    INVENTORY_ITEMS ||--o{ STOCK_MOVEMENTS : "ledger of"

    PROJECTS ||--o{ APPROVALS : "client signs off"
    PROJECTS ||--o{ DAILY_UPDATES : "site diary"
    PROJECTS ||--o{ BILLS : "RA billed"
    BILLS ||--o{ BILL_LINES : contains
    BILLS ||--o{ PAYMENTS : "settled by"
    BILLS ||--o{ BILL_EVENTS : "audited by"

    ATTACHMENTS }o--|| PROJECTS : "photos + PDFs"
```

Three tables are **append-only for every role including owner**: `audit_log`,
`stock_movements`, `bill_events`. History that can be edited is not evidence.

---

## 5. How a request is handled

```mermaid
sequenceDiagram
    participant B as Browser
    participant M as middleware
    participant S as Server Component / Action
    participant PG as Postgres

    B->>M: request + session cookie
    M->>M: refresh Supabase session, attach request_id
    M->>S: authenticated context

    alt READ
        S->>S: pick role-scoped query
        S->>PG: select via user's JWT
        PG->>PG: RLS filters rows
        PG->>PG: view omits cost columns for non-Admin
        PG-->>S: only permitted rows + columns
        S-->>B: rendered HTML
    else WRITE
        S->>S: guard (role + project membership)
        S->>S: zod parse
        S->>PG: rpc_* (security definer)
        PG->>PG: row lock → re-validate → mutate → audit_log
        PG-->>S: result or domain error
        S->>S: revalidateTag
        S-->>B: updated UI
    end
```

**Money and stock never move through application read-modify-write.** Every such mutation is
a Postgres function that takes a row lock and re-checks current state.

---

## 6. How permission is decided

```mermaid
flowchart TD
    Q[Request for data] --> L3{"<b>L3 App guard</b><br/>role allowed<br/>on this action?"}
    L3 -->|no| DENY[403 Forbidden]
    L3 -->|yes| L1{"<b>L1 RLS</b><br/>is_admin or<br/>is_member_of project?"}
    L1 -->|no| EMPTY[Zero rows]
    L1 -->|yes| L2{"<b>L2 Columns</b><br/>which role?"}

    L2 -->|Admin / Owner| FULL["Full table<br/>allocated + internal + margin"]
    L2 -->|Client| VC["v_*_client view<br/>contract value only"]
    L2 -->|Site| VS["v_*_site view<br/>no money columns at all"]

    style DENY fill:#fecaca
    style EMPTY fill:#fecaca
    style FULL fill:#bbf7d0
    style VC fill:#fef3c7
    style VS fill:#fef3c7
```

L2 is the unusual one and the reason the product works: for a non-Admin the cost column is
**not in the select list**. It isn't hidden in the UI — it never enters the response body, so
a React bug cannot leak it.

---

## 7. Stock request lifecycle

```mermaid
stateDiagram-v2
    [*] --> Pending: Admin/Site raises
    Pending --> Approved: Admin approves
    Pending --> Rejected: Admin rejects (reason required)
    Approved --> Ordered: Admin marks ordered
    Ordered --> Delivered: Admin or Site marks delivered
    Delivered --> [*]
    Rejected --> [*]

    note right of Approved
        counts toward
        package Committed
    end note
    note right of Delivered
        + stock_movement IN
        + inventory qty up
        + becomes Billable Now
    end note
```

Illegal jumps (Pending → Delivered) are rejected by the RPC, not just hidden in the UI.

---

## 8. Approval lifecycle

```mermaid
stateDiagram-v2
    [*] --> Pending: Admin/Site requests with photos
    Pending --> Approved: CLIENT approves
    Pending --> Rejected: CLIENT rejects (reason required)
    Approved --> [*]
    Rejected --> [*]
```

Only a Client can decide. Once decided, the record and its photos freeze — this is the
evidence trail for "you approved this finish". A rejected item is superseded by a new
approval, never reopened.

---

## 9. Bill lifecycle

```mermaid
stateDiagram-v2
    [*] --> Draft: Admin selects from Billable Now
    Draft --> Submitted: Admin submits (lines freeze, PDF)
    Draft --> Cancelled: Admin abandons (lines released)
    Submitted --> Certified: CLIENT approves
    Submitted --> Draft: CLIENT rejects (revision +1)
    Certified --> Paid: Admin records full payment
    Paid --> [*]
    Cancelled --> [*]
```

**Admin cannot certify. Client cannot create.** That separation is what gives the audit trail
its commercial meaning. Issued bills are immutable — corrections go on the next RA bill.

---

## 10. Billing arithmetic

```mermaid
flowchart TD
    A["<b>A</b> Work done this period<br/>completed phases × client value"] --> C
    B["<b>B</b> Material at site<br/>delivered × client value × 75%"] --> C
    C["<b>C</b> Gross = A + B"] --> E
    D["<b>D</b> less MAS recovery<br/>material already advanced,<br/>now inside a billed phase"] --> E
    E["<b>E</b> TAXABLE VALUE"] --> F
    E --> H
    E --> I
    F["<b>F</b> GST = E × 18%"] --> G
    G["<b>G</b> Invoice total = E + F"] --> K
    H["<b>H</b> less Retention 5% of E"] --> K
    I["<b>I</b> less TDS"] --> K
    J["<b>J</b> less Advance recovery"] --> K
    K["<b>K</b> NET PAYABLE"]

    style E fill:#1f2937,color:#fff
    style K fill:#bbf7d0
```

**GST is charged on E, before retention is deducted.** Retention money is still part of the
value of the supply, so tax is payable on it even though the cash is withheld. The prototype
deducted retention first, which understated output tax — that's corrected here.

Rates are snapshotted onto each bill at creation, so a later project-level change never
restates an issued invoice.

---

## 11. What each role does

```mermaid
flowchart LR
    subgraph ADMIN["👔 Admin"]
        direction TB
        A1[Set up project<br/>+ packages + budgets] --> A2[Build schedule]
        A2 --> A3[Approve stock requests]
        A3 --> A4[Mark Ordered]
        A4 --> A5[Select Billable Now<br/>→ Create Bill]
        A5 --> A6[Submit bill]
        A6 --> A7[Record payment<br/>→ Paid]
    end

    subgraph SITE["🔨 Site Supervisor"]
        direction TB
        S1[Post daily update<br/>+ photos] --> S2[Raise stock request]
        S2 --> S3[Mark Delivered<br/>on arrival]
        S3 --> S4[Update task progress]
        S4 --> S5[Check inventory<br/>+ late tasks]
    end

    subgraph CLIENT["🏠 Client"]
        direction TB
        C1[Open bell:<br/>what needs me?] --> C2[Review sample<br/>+ photos]
        C2 --> C3[Approve / Reject]
        C1 --> C4[Open bill:<br/>GST breakdown]
        C4 --> C5[Certify bill]
    end
```

---

## 12. Progress and billability rollup

```mermaid
flowchart TD
    T["Task progress changes"] --> PH{"All tasks in<br/>phase at 100%?"}
    PH -->|yes| BILL["Phase → Billable"]
    PH -->|no| NA["Phase stays unresolved"]
    NT["Phase has no tasks"] --> MC["Admin: Mark Complete"] --> BILL

    T --> PKG["Package progress<br/>= duration-weighted mean<br/>of task %"]
    PKG --> PRJ["Project progress<br/>= allocated-weighted mean<br/>of package %"]

    BILL --> BN["Appears in<br/>Billable Now"]
    DEL["Stock request → Delivered"] --> BN

    style BN fill:#bbf7d0
```

A 3-week task counts 3× a 1-week task. A ₹40L package moves the project needle 20× more than
a ₹2L one.

---

## 13. File upload

```mermaid
sequenceDiagram
    participant B as Browser
    participant S as Server Action
    participant R2 as Cloudflare R2
    participant PG as Postgres

    B->>S: requestUploadUrl(entity, file meta)
    S->>S: auth + membership + MIME/size check
    S->>R2: presign PUT (5 min)
    S-->>B: { url, key }
    B->>R2: PUT file (never transits Vercel)
    R2-->>B: 200
    B->>S: confirmUpload(key)
    S->>R2: HeadObject — does it really exist?
    R2-->>S: size, etag
    S->>PG: insert attachments row
    S->>PG: enqueue thumbnail job (jobs table)
    S-->>B: attachmentId
```

The confirm step matters: without it, an abandoned upload leaves a database row pointing at
nothing. We only record what we can verify. Reads are presigned GET, 15-minute TTL, issued
after an access check. No public bucket, ever.

---

## 14. Background jobs

```mermaid
flowchart LR
    CRON["Vercel Cron<br/>UTC schedule"] --> R["/api/cron/{job}<br/>Bearer CRON_SECRET"]
    ACT["Server Action<br/>e.g. bill submitted"] -->|enqueue| J[("jobs table")]
    R -->|"rpc_claim_jobs<br/>FOR UPDATE SKIP LOCKED"| J
    J --> H["handler<br/>lib/jobs/handlers"]
    H --> OK{success?}
    OK -->|yes| S1["succeeded"]
    OK -->|"no, attempts &lt; max"| S2["pending<br/>backoff 1,2,4,8,16 min"]
    OK -->|"no, attempts = max"| S3["failed<br/>Admin ops page + Retry"]
    S2 -.retry.-> J
    REAP["hourly reaper"] -->|"lease expired"| S2

    style S3 fill:#fecaca
    style S1 fill:#bbf7d0
```

| Job | When | Why it matters |
|---|---|---|
| `backup.nightly` | 01:00 IST | **Only recovery point. Failure is P1.** |
| `inventory.reconcile` | 02:00 IST | Cache vs `stock_movements` ledger drift |
| `jobs.drain` | every minute | Picks up queued thumbnails and bill PDFs |
| `jobs.reap` | hourly | Requeues jobs whose worker timed out |
| `attachment.orphan_sweep` · `project.archive` | weekly | Housekeeping |

State lives in Postgres, not the scheduler — a missed tick delays work, never loses it.
Per-minute cron requires Vercel Pro.

---

## 15. Deployment

```mermaid
flowchart TB
    subgraph DEV["Local"]
        D1["next dev + hosted apex-dev<br/>no Docker (D14), seed.sql"]
    end
    subgraph PR["Per pull request"]
        P1["Vercel preview"]
        P2["Supabase branch<br/>ephemeral, migrated, seeded"]
        P1 --- P2
    end
    subgraph PROD["Production · Mumbai bom1"]
        V["Vercel Pro"]
        SB[("Supabase Pro<br/>ap-south-1")]
        R["R2 apex-prod"]
        BK["R2 apex-backups<br/>nightly pg_dump"]
        V --- SB
        V --- R
        SB -.nightly.-> BK
    end

    DEV --> PR --> PROD
```

Vercel and Supabase are co-located — cross-region round trips would dominate P95. There is no
long-lived staging tier; preview branches give migration safety with nothing to maintain.

---

## 16. CI/CD

```mermaid
flowchart LR
    A[push] --> B[typecheck]
    B --> C[lint + secret scan]
    C --> D[unit tests<br/>billing 100% branch]
    D --> E["<b>RLS tests</b><br/>pgTAP, every role<br/>BLOCKING"]
    E --> F[integration<br/>RPC concurrency]
    F --> G[build]
    G --> H[deploy preview]
    H --> I[Playwright<br/>3 role journeys]
    I --> J{merge to main}
    J --> K[deploy prod]
    K --> L[smoke /api/health]

    style E fill:#fecaca
```

Code rolls back instantly via Vercel. **Schema does not roll back** — migrations are
forward-only and must stay compatible with the previous code version, which is why every
breaking change goes expand → migrate → contract.

---

## 17. Failure behaviour

```mermaid
flowchart TD
    F{What broke?} --> PG[Postgres] --> TOTAL["🔴 Total outage"]
    F --> VC[Vercel] --> TOTAL
    F --> R2X[R2] --> P1["🟡 Uploads/downloads fail<br/>rest of app fine"]
    F --> CR["Vercel Cron"] --> P2["🟡 PDFs + thumbnails delayed<br/>work stays queued in Postgres<br/><b>nothing lost</b>"]

    style TOTAL fill:#fecaca
```

Only Postgres and Vercel are single points of failure. Job state lives in the `jobs` table,
not in the scheduler, so a missed cron tick delays work rather than losing it — the next tick
drains the backlog. Notifications are computed live from a database view, so there is no
notification pipeline that can go stale.

---

## 18. Concurrency guards

| Race | Guard |
|---|---|
| Two supervisors mark one request Delivered | `SELECT … FOR UPDATE` + status re-check in the RPC |
| Two Admins create bills at once | Row lock on `projects` serialises `next_bill_seq` — gapless numbers |
| Same phase billed twice | Unique index on `bill_lines(source_type, source_id)` |
| Double-click submit | Client idempotency key on `createBill` / `recordPayment` |
| Two Admins edit one package | Optimistic `updated_at` check → "changed by someone else" |
| Inventory cache drifts from ledger | Nightly reconcile recomputes from `stock_movements`, alerts on delta |

---

## 19. Where to go next

| Question | File |
|---|---|
| What are the business rules? | `01-hld.md` |
| What's the exact schema / policy / RPC? | `02-lld.md` |
| How do I deploy, monitor, restore? | `architecture.md` |
| What are the coding rules? | `../AGENTS.md` |
| What's still undecided? | `01-hld.md` §18 and `architecture.md` §16 |