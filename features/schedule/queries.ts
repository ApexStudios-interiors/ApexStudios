import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Session } from "@/lib/auth/session";
import { isLate, monthHeaders, todayIso, viewportWeeks, weekIndex, weightedProgress } from "./service";

/**
 * `tasks` carries no money (02-lld.md's own RLS comment: "unlike packages it
 * is readable by site and client alike"), so the TASK rows themselves need no
 * role ternary — nothing here a role must not see. But grouping them still
 * needs each package's and phase's id/name/seq_no, and `packages`/`phases`
 * are admin-only base tables (Build 04's own finding, repeated here): for
 * client and site this reads `v_package_site`/`v_phase_site` instead — found
 * live, not in review, when a client's Schedule page rendered a header and
 * nothing else. `v_package_site`/`v_phase_site` carry no money either way,
 * so the same view is correct for both non-admin roles; there is no
 * client-specific column difference to justify a third view. `canEdit` is
 * still computed by the PAGE from the session's effective role and passed to
 * `Gantt` as a prop — the component itself stays role-unaware (build/05's
 * own guardrail: "Do not put role checks inside Gantt.tsx").
 */

export type ScheduleTask = {
  id: string;
  name: string;
  ownerName: string | null;
  startDate: string;
  durationWeeks: number;
  endDate: string;
  progressPct: number;
  weekIndexStart: number;
  weekIndexEnd: number;
  late: boolean;
  note: string | null;
};

export type SchedulePhase = {
  id: string;
  seqNo: number;
  name: string;
  tasks: ScheduleTask[];
  progressPct: number;
};

export type PackageSchedule = {
  packageId: string;
  packageName: string;
  seqNo: number;
  projectStart: string | null;
  phases: SchedulePhase[];
  taskCount: number;
  progressPct: number;
  viewport: { from: number; to: number };
  monthHeaders: { label: string; span: number }[];
};

export type ProjectSchedule = {
  projectId: string;
  projectStart: string | null;
  packages: PackageSchedule[];
};

type TaskRow = {
  id: string;
  name: string;
  owner_profile_id: string | null;
  start_date: string;
  duration_weeks: number;
  end_date: string | null;
  progress_pct: number;
  phase_id: string;
  package_id: string;
  note: string | null;
};

type PackageIdRow = { id: string; name: string; seq_no: number };
type PhaseIdRow = { id: string; name: string; seq_no: number; package_id: string };

async function fetchPackagesForSchedule(isAdmin: boolean, projectId: string): Promise<PackageIdRow[]> {
  const supabase = await createClient();
  if (isAdmin) {
    const { data, error } = await supabase
      .from("packages")
      .select("id, seq_no, name")
      .eq("project_id", projectId)
      .is("deleted_at", null)
      .order("seq_no", { ascending: true });
    if (error) throw new Error(error.message);
    return data;
  }
  const { data, error } = await supabase
    .from("v_package_site")
    .select("id, seq_no, name")
    .eq("project_id", projectId)
    .order("seq_no", { ascending: true });
  if (error) throw new Error(error.message);
  return data.filter((p): p is PackageIdRow => p.id != null && p.name != null && p.seq_no != null);
}

async function fetchPhasesForSchedule(isAdmin: boolean, projectId: string): Promise<PhaseIdRow[]> {
  const supabase = await createClient();
  if (isAdmin) {
    const { data, error } = await supabase
      .from("phases")
      .select("id, seq_no, name, package_id")
      .eq("project_id", projectId)
      .is("deleted_at", null);
    if (error) throw new Error(error.message);
    return data;
  }
  const { data, error } = await supabase
    .from("v_phase_site")
    .select("id, seq_no, name, package_id")
    .eq("project_id", projectId);
  if (error) throw new Error(error.message);
  return data.filter(
    (p): p is PhaseIdRow => p.id != null && p.name != null && p.seq_no != null && p.package_id != null
  );
}

async function ownerNames(profileIds: (string | null)[]): Promise<Map<string, string>> {
  const ids = [...new Set(profileIds.filter((id): id is string => id != null))];
  if (ids.length === 0) return new Map();
  const supabase = await createClient();
  const { data, error } = await supabase.from("profiles").select("id, full_name").in("id", ids);
  if (error) throw new Error(error.message);
  return new Map(data.map((p) => [p.id, p.full_name]));
}

function toScheduleTask(
  row: TaskRow,
  projectStart: string,
  today: string,
  owners: Map<string, string>
): ScheduleTask {
  // end_date is a generated column and is never null for a real row; the
  // fallback only satisfies the nullable column type Postgres reports for
  // every generated column regardless of its NOT NULL-by-construction nature.
  const endDate = row.end_date ?? row.start_date;
  return {
    id: row.id,
    name: row.name,
    ownerName: row.owner_profile_id ? (owners.get(row.owner_profile_id) ?? null) : null,
    startDate: row.start_date,
    durationWeeks: row.duration_weeks,
    endDate,
    progressPct: row.progress_pct,
    weekIndexStart: weekIndex(row.start_date, projectStart),
    weekIndexEnd: weekIndex(endDate, projectStart),
    late: isLate({ endDate, progressPct: row.progress_pct }, today),
    note: row.note,
  };
}

function buildPackageSchedule(
  pkg: { id: string; name: string; seq_no: number },
  phaseRows: { id: string; name: string; seq_no: number }[],
  taskRows: TaskRow[],
  projectStart: string,
  today: string,
  owners: Map<string, string>
): PackageSchedule {
  const tasksByPhase = new Map<string, TaskRow[]>();
  for (const t of taskRows) {
    const list = tasksByPhase.get(t.phase_id) ?? [];
    list.push(t);
    tasksByPhase.set(t.phase_id, list);
  }

  const phases: SchedulePhase[] = phaseRows
    .map((ph) => {
      const rows = tasksByPhase.get(ph.id) ?? [];
      const tasks = rows
        .map((r) => toScheduleTask(r, projectStart, today, owners))
        .sort((a, b) => a.weekIndexStart - b.weekIndexStart);
      return {
        id: ph.id,
        seqNo: ph.seq_no,
        name: ph.name,
        tasks,
        progressPct: weightedProgress(tasks),
      };
    })
    .filter((ph) => ph.tasks.length > 0)
    .sort((a, b) => a.seqNo - b.seqNo);

  const allTasks = phases.flatMap((ph) => ph.tasks);
  const window = viewportWeeks(
    projectStart,
    allTasks.map((t) => ({ startDate: t.startDate, endDate: t.endDate })),
    today
  );

  return {
    packageId: pkg.id,
    packageName: pkg.name,
    seqNo: pkg.seq_no,
    projectStart,
    phases,
    taskCount: allTasks.length,
    progressPct: weightedProgress(allTasks),
    viewport: window,
    monthHeaders: monthHeaders(projectStart, window.from, window.to),
  };
}

export async function getScheduleForProject(session: Session, projectId: string): Promise<ProjectSchedule> {
  const effectiveRole = session.impersonating?.role ?? session.role;
  const isAdmin = effectiveRole === "owner" || effectiveRole === "admin";
  const supabase = await createClient();

  const { data: project, error: projErr } = await supabase
    .from("projects")
    .select("id, start_date")
    .eq("id", projectId)
    .is("deleted_at", null)
    .maybeSingle();
  if (projErr) throw new Error(projErr.message);
  const projectStart = project?.start_date ?? null;

  const packages = await fetchPackagesForSchedule(isAdmin, projectId);
  const phases = await fetchPhasesForSchedule(isAdmin, projectId);

  const { data: taskRows, error: taskErr } = await supabase
    .from("tasks")
    .select(
      "id, name, owner_profile_id, start_date, duration_weeks, end_date, progress_pct, phase_id, package_id, note"
    )
    .eq("project_id", projectId)
    .is("deleted_at", null);
  if (taskErr) throw new Error(taskErr.message);

  const owners = await ownerNames(taskRows.map((t) => t.owner_profile_id));
  const today = todayIso();
  const phasesByPackage = new Map<string, { id: string; name: string; seq_no: number }[]>();
  for (const ph of phases) {
    if (!ph.package_id) continue;
    const list = phasesByPackage.get(ph.package_id) ?? [];
    list.push({ id: ph.id, name: ph.name, seq_no: ph.seq_no });
    phasesByPackage.set(ph.package_id, list);
  }
  const tasksByPackage = new Map<string, TaskRow[]>();
  for (const t of taskRows) {
    const list = tasksByPackage.get(t.package_id) ?? [];
    list.push(t);
    tasksByPackage.set(t.package_id, list);
  }

  const packageSchedules = projectStart
    ? packages.map((pkg) =>
        buildPackageSchedule(
          pkg,
          phasesByPackage.get(pkg.id) ?? [],
          tasksByPackage.get(pkg.id) ?? [],
          projectStart,
          today,
          owners
        )
      )
    : [];

  return { projectId, projectStart, packages: packageSchedules };
}

export async function getScheduleForPackage(
  session: Session,
  projectId: string,
  packageId: string
): Promise<PackageSchedule | null> {
  const effectiveRole = session.impersonating?.role ?? session.role;
  const isAdmin = effectiveRole === "owner" || effectiveRole === "admin";
  const supabase = await createClient();

  const { data: project, error: projErr } = await supabase
    .from("projects")
    .select("start_date")
    .eq("id", projectId)
    .is("deleted_at", null)
    .maybeSingle();
  if (projErr) throw new Error(projErr.message);
  if (!project?.start_date) return null;

  const packages = await fetchPackagesForSchedule(isAdmin, projectId);
  const pkg = packages.find((p) => p.id === packageId);
  if (!pkg) return null;

  const phases = (await fetchPhasesForSchedule(isAdmin, projectId)).filter(
    (ph) => ph.package_id === packageId
  );

  const { data: taskRows, error: taskErr } = await supabase
    .from("tasks")
    .select(
      "id, name, owner_profile_id, start_date, duration_weeks, end_date, progress_pct, phase_id, package_id, note"
    )
    .eq("package_id", packageId)
    .is("deleted_at", null);
  if (taskErr) throw new Error(taskErr.message);

  const owners = await ownerNames(taskRows.map((t) => t.owner_profile_id));
  return buildPackageSchedule(pkg, phases, taskRows, project.start_date, todayIso(), owners);
}
