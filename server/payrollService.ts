import { storage } from "./storage";
import { db } from "./db";
import { payrollRecords } from "@shared/schema";

// ---------------------------------------------------------------------------
// Helpers (mirrored from routes.ts — kept here so the service is self-contained)
// ---------------------------------------------------------------------------

function parseNumericOrNull(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return value;
  const parsed = parseFloat(value);
  return isNaN(parsed) ? null : parsed;
}

function roundToDollars(value: number): number {
  return Math.round(value * 100) / 100;
}

function toNumericString(value: number): string {
  return value.toFixed(2);
}

// ---------------------------------------------------------------------------
// Public service function
// ---------------------------------------------------------------------------

export interface GeneratePayrollOptions {
  suppressAllOT?: boolean;
  employeeIds?: string[];
  importedBy?: string;
}

export interface GeneratePayrollResult {
  generated: number;
  skipped: { id?: string; employeeCode: string; employeeName: string; reason: string }[];
  period: string;
  alreadyExisted?: boolean;
}

export async function generatePayrollForPeriod(
  year: number,
  month: number,
  options: GeneratePayrollOptions = {}
): Promise<GeneratePayrollResult> {
  const {
    calculateCPF,
    calculateAge,
    calculateSPRYears,
    splitHours,
    calculatePayFromHours,
    monthlyToHourlyRate,
    dailyToHourlyRate,
  } = await import("./cpf-calculator");

  const { suppressAllOT, employeeIds, importedBy = "system" } = options;

  // Get all approved employees (or specific ones if specified)
  const allUsers = await storage.getAllUsers();
  const employees = allUsers.filter((u) => {
    if (u.isArchived) return false;
    if (!u.isApproved) return false;
    if (employeeIds && !employeeIds.includes(u.id)) return false;

    // For admin/viewonly_admin users, only include if they have payroll settings configured
    if (u.role === "admin" || u.role === "viewonly_admin") {
      const hasPayrollSettings =
        (u.basicMonthlySalary && parseFloat(u.basicMonthlySalary) > 0) ||
        (u.hourlyRate && parseFloat(u.hourlyRate) > 0) ||
        (u.dailyRate && parseFloat(u.dailyRate) > 0);
      return hasPayrollSettings;
    }

    return true;
  });

  if (employees.length === 0) {
    throw new Error("No eligible employees found");
  }

  // Get company settings for work hour configuration
  const settings = await storage.getCompanySettings();
  const regularHoursPerDay = settings?.regularHoursPerDay || 8;
  const regularDaysPerWeek = settings?.regularDaysPerWeek || 5;

  // Define the pay period
  const periodStart = `${year}-${String(month).padStart(2, "0")}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const periodEnd = `${year}-${String(month).padStart(2, "0")}-${lastDay}`;
  const payPeriod = `${new Date(year, month - 1).toLocaleString("default", { month: "short" }).toUpperCase()} ${year}`;

  // Check for existing payroll records for this period to prevent duplicates
  const existingRecords = await storage.getPayrollRecords(year, month);
  if (existingRecords.length > 0) {
    console.log(
      JSON.stringify({
        job: "generatePayroll",
        period: `${month}/${year}`,
        status: "skipped",
        reason: "already_exists",
        existingCount: existingRecords.length,
        importedBy,
        timestamp: new Date().toISOString(),
      })
    );
    return { generated: 0, skipped: [], period: payPeriod, alreadyExisted: true };
  }

  // Get attendance records for the period
  const attendanceData = await storage.getAllUsersAttendanceByDateRange(periodStart, periodEnd);

  // Get attendance adjustments for the period (leave/OT overrides)
  const adjustmentsData = await storage.getAttendanceAdjustmentsByDateRange(periodStart, periodEnd);

  // Build a map of adjustments by `${userId}-${date}` for quick lookup
  const adjustmentsMap = new Map<string, (typeof adjustmentsData)[0]>();
  for (const adj of adjustmentsData) {
    adjustmentsMap.set(`${adj.userId}-${adj.date}`, adj);
  }

  // Get payroll adjustments for the period (including suppress_ot15 and suppress_ot20)
  const payrollAdjustmentsData = await storage.getPayrollAdjustmentsByPeriod(year, month);

  // Build sets of employee IDs that have suppress_ot15 and suppress_ot20 adjustments
  const suppressOt15Employees = new Set<string>();
  const suppressOt20Employees = new Set<string>();
  for (const adj of payrollAdjustmentsData) {
    if (adj.adjustmentType === "suppress_ot15" && adj.status === "approved") {
      suppressOt15Employees.add(adj.userId);
    }
    if (adj.adjustmentType === "suppress_ot20" && adj.status === "approved") {
      suppressOt20Employees.add(adj.userId);
    }
  }

  const generatedRecords: any[] = [];
  const skippedEmployees: { id?: string; employeeCode: string; employeeName: string; reason: string }[] = [];

  for (const employee of employees) {
    // Get this employee's attendance for the month
    const empAttendance = attendanceData.filter((a) => a.userId === employee.id);

    let totalHoursWorked = 0;
    let totalOtHoursFromAdjustments = 0;
    let daysWorked = 0;
    const uniqueDays = new Set<string>();
    const processedDates = new Set<string>();

    for (const record of empAttendance) {
      const dateKey = record.date;
      const adjustmentKey = `${employee.id}-${dateKey}`;
      const adjustment = adjustmentsMap.get(adjustmentKey);

      if (adjustment) {
        if (!processedDates.has(dateKey)) {
          processedDates.add(dateKey);
          uniqueDays.add(dateKey);

          if (adjustment.adjustmentType === "leave") {
            totalHoursWorked += 9;
          } else if (adjustment.adjustmentType === "hours") {
            const adjRegular = adjustment.regularHours ?? 0;
            const adjOt = adjustment.otHours ?? 0;
            totalHoursWorked += adjRegular;
            totalOtHoursFromAdjustments += adjOt;
          }
        }
      } else {
        if (record.clockInTime && record.clockOutTime) {
          const clockIn = new Date(record.clockInTime);
          const clockOut = new Date(record.clockOutTime);
          const hoursWorked = (clockOut.getTime() - clockIn.getTime()) / (1000 * 60 * 60);
          totalHoursWorked += Math.round(hoursWorked * 4) / 4;
          uniqueDays.add(record.date);
        }
      }
    }

    // Also process adjustments for dates with no attendance records (pure leave days)
    for (const adj of adjustmentsData) {
      if (adj.userId !== employee.id) continue;
      if (processedDates.has(adj.date)) continue;

      processedDates.add(adj.date);
      uniqueDays.add(adj.date);

      if (adj.adjustmentType === "leave") {
        totalHoursWorked += 9;
      } else if (adj.adjustmentType === "hours") {
        const adjRegular = adj.regularHours ?? 0;
        const adjOt = adj.otHours ?? 0;
        totalHoursWorked += adjRegular;
        totalOtHoursFromAdjustments += adjOt;
      }
    }

    daysWorked = uniqueDays.size;

    const empDaysPerWeek = employee.regularDaysPerWeek ?? regularDaysPerWeek;
    const empHoursPerDay = employee.regularHoursPerDay ?? regularHoursPerDay;
    const isExecutive = empDaysPerWeek === 0;

    const empHourlyRate = parseNumericOrNull(employee.hourlyRate);
    const empBasicMonthlySalary = parseNumericOrNull(employee.basicMonthlySalary);
    const empDailyRate = parseNumericOrNull(employee.dailyRate);

    let hourlyRate = empHourlyRate ?? 0;
    let payType = employee.payType || "hourly";

    if (empBasicMonthlySalary !== null && empBasicMonthlySalary > 0) {
      payType = "monthly";
      if (isExecutive) {
        hourlyRate = 0;
      } else {
        hourlyRate = monthlyToHourlyRate(empBasicMonthlySalary, empHoursPerDay, empDaysPerWeek);
      }
    } else if (empDailyRate !== null && empDailyRate > 0) {
      payType = "daily";
      hourlyRate = dailyToHourlyRate(empDailyRate, empHoursPerDay);
    }

    if (!isExecutive && (!hourlyRate || hourlyRate === 0)) {
      skippedEmployees.push({
        id: employee.id,
        employeeCode: employee.employeeCode || "N/A",
        employeeName: employee.name,
        reason: "No pay rate configured (hourly/daily/monthly salary)",
      });
      continue;
    }

    if (isExecutive && (empBasicMonthlySalary === null || empBasicMonthlySalary <= 0)) {
      skippedEmployees.push({
        id: employee.id,
        employeeCode: employee.employeeCode || "N/A",
        employeeName: employee.name,
        reason: "Executive employee has no basic monthly salary configured",
      });
      continue;
    }

    const { regularHours, overtimeHours: calculatedOtHours } = splitHours(
      totalHoursWorked,
      regularHoursPerDay,
      daysWorked
    );
    const overtimeHours = calculatedOtHours + totalOtHoursFromAdjustments;

    const otMultiplier = settings?.otMultiplier15 || 1.5;

    let calculatedBasicPay: number;
    let otAmount: number;
    const configuredMonthlySalary = empBasicMonthlySalary ?? 0;

    if (payType === "monthly" || isExecutive) {
      calculatedBasicPay = configuredMonthlySalary;
      if (!isExecutive && overtimeHours > 0 && hourlyRate > 0) {
        otAmount = roundToDollars(overtimeHours * hourlyRate * otMultiplier);
      } else {
        otAmount = 0;
      }
    } else {
      const { regularPay, overtimePay } = calculatePayFromHours(
        regularHours,
        overtimeHours,
        hourlyRate,
        otMultiplier
      );
      calculatedBasicPay = regularPay;
      otAmount = overtimePay;
    }

    let finalOt15Amount = otAmount;
    let finalOt20Amount = 0;
    let finalOtHours = overtimeHours;
    let finalOt15Hours = overtimeHours;
    let finalOt20Hours = 0;

    const shouldSuppressOt15 = suppressAllOT || suppressOt15Employees.has(employee.id);
    const shouldSuppressOt20 = suppressAllOT || suppressOt20Employees.has(employee.id);

    if (shouldSuppressOt15) {
      finalOt15Amount = 0;
      finalOt15Hours = 0;
      if (shouldSuppressOt20) {
        finalOtHours = 0;
      }
    }
    if (shouldSuppressOt20) {
      finalOt20Amount = 0;
      finalOt20Hours = 0;
    }

    const finalOtAmount = finalOt15Amount + finalOt20Amount;

    const mobileAllowance = parseFloat(employee.defaultMobileAllowance || "0");
    const transportAllowance = parseFloat(employee.defaultTransportAllowance || "0");
    const mealAllowance = parseFloat(employee.defaultMealAllowance || "0");
    const shiftAllowance = parseFloat(employee.defaultShiftAllowance || "0");
    const otherAllowance = parseFloat(employee.defaultOtherAllowance || "0");
    const otherAllowance1 = parseFloat(employee.defaultOtherAllowance1 || "0");
    const otherAllowance2 = parseFloat(employee.defaultOtherAllowance2 || "0");
    const houseRentalAllowance = parseFloat(employee.defaultHouseRentalAllowance || "0");
    const loanDeduction = 0;
    const totalAllowances =
      mobileAllowance + transportAllowance + mealAllowance + shiftAllowance
      + otherAllowance + otherAllowance1 + otherAllowance2 + houseRentalAllowance;

    const grossWages = calculatedBasicPay + finalOtAmount + totalAllowances;

    const residencyStatus = employee.residencyStatus as "SC" | "SPR" | "FOREIGNER" | null;

    let cpfResult: ReturnType<typeof calculateCPF>;

    if (residencyStatus === "SC" || residencyStatus === "SPR") {
      const wageMonth = `${year}-${String(month).padStart(2, "0")}`;
      const wageMonthEndDate = new Date(year, month, 0);
      const age = employee.birthDate ? calculateAge(employee.birthDate, wageMonthEndDate) : 45;

      let sprYears: number | undefined;
      if (residencyStatus === "SPR" && employee.sprStartDate) {
        sprYears = calculateSPRYears(employee.sprStartDate, wageMonthEndDate);
      }

      cpfResult = calculateCPF(grossWages, age, residencyStatus, sprYears, 0, wageMonth);
    } else {
      cpfResult = {
        grossWages,
        cpfWages: 0,
        employeeCPF: 0,
        employerCPF: 0,
        totalCPF: 0,
        netPay: grossWages,
        isEligible: false,
        reason:
          residencyStatus === "FOREIGNER"
            ? "Foreigners are not eligible for CPF"
            : "Residency status not configured",
      };
    }

    const { calculateSHG } = await import("./shg-calculator");
    const shgResult = calculateSHG(
      employee.ethnicity,
      employee.religion,
      residencyStatus,
      grossWages,
      employee.shgOptOut || false
    );
    const shgCdac = shgResult.fund === "CDAC" ? shgResult.contribution : 0;
    const shgSinda = shgResult.fund === "SINDA" ? shgResult.contribution : 0;
    const shgMbmf = shgResult.fund === "MBMF" ? shgResult.contribution : 0;
    const shgEcf = shgResult.fund === "ECF" ? shgResult.contribution : 0;
    const totalShg = shgCdac + shgSinda + shgMbmf + shgEcf;

    const nett = cpfResult.netPay - loanDeduction - totalShg;

    const record = {
      userId: employee.id,
      payPeriod,
      payPeriodYear: year,
      payPeriodMonth: month,
      employeeCode: employee.employeeCode || "",
      employeeName: employee.name,
      deptCode: null,
      deptName: employee.department || null,
      secCode: null,
      secName: employee.section || null,
      catCode: null,
      catName: null,
      nric: employee.nricFin || null,
      joinDate: employee.joinDate || null,
      basicHoursWorked: regularHours,
      otHoursWorked: finalOtHours,
      ot15Hours: finalOt15Hours,
      ot20Hours: finalOt20Hours,
      totSalary: toNumericString(calculatedBasicPay),
      basicSalary: toNumericString(configuredMonthlySalary),
      monthlyVariablesComponent: toNumericString(0),
      flat: toNumericString(0),
      ot10: toNumericString(0),
      ot15: toNumericString(finalOt15Amount),
      ot20: toNumericString(finalOt20Amount),
      ot30: toNumericString(0),
      shiftAllowance: toNumericString(shiftAllowance),
      totRestPhAmount: toNumericString(0),
      mobileAllowance: toNumericString(mobileAllowance),
      transportAllowance: toNumericString(transportAllowance),
      annualLeaveEncashment: toNumericString(0),
      serviceCallAllowances: toNumericString(0),
      otherAllowance: toNumericString(otherAllowance),
      otherAllowance1: toNumericString(otherAllowance1),
      otherAllowance2: toNumericString(otherAllowance2),
      houseRentalAllowances: toNumericString(houseRentalAllowance),
      loanRepaymentTotal: toNumericString(loanDeduction),
      loanRepaymentDetails: loanDeduction > 0 ? `Recurring loan deduction: $${loanDeduction.toFixed(2)}` : null,
      noPayDay: toNumericString(0),
      cc: toNumericString(0),
      cdac: toNumericString(shgCdac),
      ecf: toNumericString(shgEcf),
      mbmf: toNumericString(shgMbmf),
      sinda: toNumericString(shgSinda),
      advance: toNumericString(0),
      bonus: toNumericString(0),
      grossWages: toNumericString(grossWages),
      cpfWages: toNumericString(cpfResult.cpfWages),
      sdf: toNumericString(0),
      fwl: toNumericString(0),
      employerCpf: toNumericString(cpfResult.employerCPF),
      employeeCpf: toNumericString(-cpfResult.employeeCPF),
      totalCpf: toNumericString(cpfResult.totalCPF),
      originalEmployerCpf: toNumericString(cpfResult.employerCPF),
      originalEmployeeCpf: toNumericString(-cpfResult.employeeCPF),
      cpfOverridden: false,
      total: toNumericString(grossWages),
      nett: toNumericString(nett),
      payMode: "BANK",
      chequeNo: null,
      importedBy,
    };

    generatedRecords.push(record);
  }

  let insertedCount = 0;
  if (generatedRecords.length > 0) {
    // UPSERT: each row inserts or silently skips if the unique constraint fires
    // (race-safe — no full-batch rollback if another process beat us)
    const inserted = await db
      .insert(payrollRecords)
      .values(generatedRecords)
      .onConflictDoNothing()
      .returning({ id: payrollRecords.id });
    insertedCount = inserted.length;
  }

  console.log(
    JSON.stringify({
      job: "generatePayroll",
      period: `${month}/${year}`,
      generated: insertedCount,
      skipped: skippedEmployees.length,
      importedBy,
      timestamp: new Date().toISOString(),
    })
  );

  return {
    generated: insertedCount,
    skipped: skippedEmployees,
    period: payPeriod,
  };
}
