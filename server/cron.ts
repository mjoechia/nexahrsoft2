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

function scheduleNextMonthlyPayrollRun(): void {
  // Compute 1st of next month at 01:00 SGT expressed as UTC.
  // new Date(year, month, day, hour) uses LOCAL server time (UTC on Railway) — not SGT.
  // We must calculate the UTC equivalent explicitly to avoid up to 8h drift.
  const sg = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Singapore" }));
  const year = sg.getFullYear();
  const month = sg.getMonth(); // 0-based current month in SGT

  // 01:00 SGT = (01 - 8) = -7 → Date.UTC normalises to previous day 17:00 UTC ✓
  const nextUTC = new Date(Date.UTC(
    month === 11 ? year + 1 : year,
    month === 11 ? 0 : month + 1,
    1,
    -7, // 01:00 SGT − 08:00 offset
    0, 0
  ));

  const delay = nextUTC.getTime() - Date.now();
  setTimeout(async () => {
    await autoGeneratePreviousMonthPayroll();
    scheduleNextMonthlyPayrollRun();
  }, delay);

  console.log(`[Cron] Next payroll auto-generation scheduled: ${nextUTC.toISOString()} (= 01:00 SGT)`);
}

// ---------------------------------------------------------------------------
// Monthly: clamp negative leave balances (all types) to 0 (1st at 00:05 SGT)
// ---------------------------------------------------------------------------
// Negatives accumulate from urgent MC beyond entitlement, legacy imported
// data, or admin balance edits. At the start of each month, any negative
// balance is reset to 0 so the next cycle starts fresh.
// This does NOT add new entitlement — that remains a manual admin action.

async function resetNegativeLeaveBalances(): Promise<void> {
  try {
    const cleared = await storage.clampNegativeLeaveBalances();
    console.log(JSON.stringify({
      job: "resetNegativeLeaveBalances",
      cleared,
      timestamp: new Date().toISOString(),
    }));
  } catch (error) {
    console.error(JSON.stringify({
      job: "resetNegativeLeaveBalances",
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
  setTimeout(async () => {
    await resetNegativeLeaveBalances();
    scheduleNextMonthlyMcResetRun();
  }, delay);

  console.log(`[Cron] Next negative leave-balance reset scheduled: ${nextUTC.toISOString()} (= 00:05 SGT)`);
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

  // --- Monthly: clamp negative leave balances (all types) to 0 ---
  // Runs on the 1st of each month at 00:05 SGT (before payroll, so payroll sees clean balances).
  scheduleNextMonthlyMcResetRun();
}
