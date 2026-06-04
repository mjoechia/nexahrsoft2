import { storage } from "./storage";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

// Get today's date as YYYY-MM-DD in Singapore timezone (Railway server runs UTC)
function todayYMD(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Singapore" });
}

// Railway runs in UTC; use Singapore time for month-boundary calculations
function getSingaporeNow(): Date {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Singapore" }));
}

// ---------------------------------------------------------------------------
// Auto-archive past resignations (daily)
// ---------------------------------------------------------------------------

async function autoArchivePastResignations(): Promise<void> {
  try {
    const today = todayYMD();
    const allUsers = await storage.getAllUsers();

    const toArchive = allUsers.filter(
      (u) => !u.isArchived && u.resignDate && u.resignDate <= today
    );

    if (toArchive.length === 0) return;

    await storage.archiveUsers(toArchive.map((u) => u.id));
    console.log(
      `[Cron] Auto-archived ${toArchive.length} user(s) with past resign dates: ` +
        toArchive.map((u) => `${u.name} (${u.resignDate})`).join(", ")
    );
  } catch (error) {
    console.error("[Cron] Auto-archive past resignations error:", error);
  }
}

// ---------------------------------------------------------------------------
// Auto-generate previous month's payroll (monthly, runs on 1st at 01:00 SGT)
// ---------------------------------------------------------------------------

async function autoGeneratePreviousMonthPayroll(): Promise<void> {
  try {
    const { generatePayrollForPeriod } = await import("./payrollService");

    const sgNow = getSingaporeNow();
    // getMonth() is 0-based → previous calendar month
    const year  = sgNow.getMonth() === 0 ? sgNow.getFullYear() - 1 : sgNow.getFullYear();
    const month = sgNow.getMonth() === 0 ? 12 : sgNow.getMonth();

    const existing = await storage.getPayrollRecords(year, month);
    if (existing.length > 0) {
      console.log(`[Cron] Payroll ${month}/${year} already exists (${existing.length} records) — skipping`);
      return;
    }

    const result = await generatePayrollForPeriod(year, month, { suppressAllOT: true, importedBy: "system-cron" });

    console.log(
      JSON.stringify({
        job: "autoGeneratePayroll",
        period: `${month}/${year}`,
        generated: result.generated,
        skipped: result.skipped.length,
        timestamp: new Date().toISOString(),
      })
    );
  } catch (error) {
    console.error(JSON.stringify({
      job: "autoGeneratePayroll",
      error: (error as Error).message,
      stack: (error as Error).stack,
      timestamp: new Date().toISOString(),
    }));
  }
}

// Node.js setTimeout overflows and fires immediately when delay > 2^31-1 ms (~24.8 days).
// Cap each wake-up at 24h and re-evaluate — safe for any month gap.
const MAX_TIMEOUT_MS = 24 * 60 * 60 * 1000;

function scheduleNextMonthlyPayrollRun(): void {
  const sg = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Singapore" }));
  const year = sg.getFullYear();
  const month = sg.getMonth();

  // 01:00 SGT = (01 - 8) = -7 → Date.UTC normalises to previous day 17:00 UTC ✓
  const nextUTC = new Date(Date.UTC(
    month === 11 ? year + 1 : year,
    month === 11 ? 0 : month + 1,
    1,
    -7, 0, 0
  ));

  const delay = nextUTC.getTime() - Date.now();
  if (delay > MAX_TIMEOUT_MS) {
    // Too far away — sleep 24h then re-evaluate so we never overflow setTimeout.
    setTimeout(scheduleNextMonthlyPayrollRun, MAX_TIMEOUT_MS);
    return;
  }

  console.log(`[Cron] Next payroll auto-generation scheduled: ${nextUTC.toISOString()} (= 01:00 SGT)`);
  setTimeout(async () => {
    await autoGeneratePreviousMonthPayroll();
    scheduleNextMonthlyPayrollRun();
  }, Math.max(0, delay));
}

// ---------------------------------------------------------------------------
// Monthly: clamp then accrue (1st at 00:05 SGT) — idempotent via leave_accrual_runs
// ---------------------------------------------------------------------------
// 1. Clamp: any negatives reset to 0 — fresh start each month.
// 2. Accrue: strategy dispatcher adds per-(user × active type) based on accrualStrategy.
// Order rationale: clamp-then-accrue means -2 + 1 = 1 (employee gets exactly the
// configured increment) rather than -2 + 1 = -1 → 0 (which would silently grant 2 days).
// The leave_accrual_runs table prevents double-application within the same month
// even if the server restarts or someone triggers manually.

export async function monthlyLeaveJob(triggeredBy: string): Promise<void> {
  try {
    const sgNow = getSingaporeNow();
    const year = sgNow.getFullYear();
    const month = sgNow.getMonth() + 1;

    const run = await storage.startAccrualRun(year, month, triggeredBy);
    if (!run) {
      console.log(JSON.stringify({
        job: "monthlyLeaveJob",
        skipped: true,
        reason: "already accrued",
        year, month,
        timestamp: new Date().toISOString(),
      }));
      return;
    }

    try {
      const cleared = await storage.clampNegativeLeaveBalances();
      const touched = await storage.runMonthlyLeaveAccrual(year, run.id, sgNow);
      await storage.completeAccrualRun(run.id, touched);
      console.log(JSON.stringify({
        job: "monthlyLeaveJob",
        triggeredBy,
        year, month,
        negativesCleared: cleared,
        rowsTouched: touched,
        timestamp: new Date().toISOString(),
      }));
    } catch (innerErr) {
      await storage.failAccrualRun(run.id, (innerErr as Error).message);
      throw innerErr;
    }
  } catch (error) {
    console.error(JSON.stringify({
      job: "monthlyLeaveJob",
      error: (error as Error).message,
      timestamp: new Date().toISOString(),
    }));
  }
}

function scheduleNextMonthlyMcResetRun(): void {
  const sg = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Singapore" }));
  const year = sg.getFullYear();
  const month = sg.getMonth();

  // 00:05 SGT on the 1st of next month = (00:05 - 08:00) = previous day 16:05 UTC
  const nextUTC = new Date(Date.UTC(
    month === 11 ? year + 1 : year,
    month === 11 ? 0 : month + 1,
    1,
    -8, 5, 0
  ));

  const delay = nextUTC.getTime() - Date.now();
  if (delay > MAX_TIMEOUT_MS) {
    setTimeout(scheduleNextMonthlyMcResetRun, MAX_TIMEOUT_MS);
    return;
  }

  console.log(`[Cron] Next monthly leave job scheduled: ${nextUTC.toISOString()} (= 00:05 SGT)`);
  setTimeout(async () => {
    await monthlyLeaveJob("cron");
    scheduleNextMonthlyMcResetRun();
  }, Math.max(0, delay));
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function startCronJobs(): Promise<void> {
  // --- Daily: auto-archive past resignations ---
  autoArchivePastResignations();
  setInterval(autoArchivePastResignations, 24 * 60 * 60 * 1000);
  console.log("[Cron] Auto-archive past resignations: scheduled (runs every 24h)");

  // --- Monthly: auto-generate previous month payroll ---
  // Runs on the 1st of each month at 01:00 SGT only.
  // Not run on startup to avoid conflicting with manual admin deletions/regenerations.
  scheduleNextMonthlyPayrollRun();

  // --- Monthly: accrue leave for all active types, then clamp negatives ---
  // Runs on the 1st of each month at 00:05 SGT (before payroll, so payroll sees clean balances).
  // Idempotent via leave_accrual_runs table — safe against double-trigger.
  scheduleNextMonthlyMcResetRun();
}
