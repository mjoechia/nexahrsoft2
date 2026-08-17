import { db } from "../server/db";
import { payrollRecords, payrollAdjustments } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import * as fs from "fs";
import * as path from "path";

interface CSVPayrollRow {
  no: number;
  employeeName: string;
  basicSalary: number;
  ot15: number;
  shift: number;
  hotlineAllowance: number;
  mobile: number;
  transport: number;
  otherAllowance: number;
  gross: number;
  houseRental: number;
  mbmf: number;
  sindaCdac: number;
  employeeCpf: number;
  advance: number;
  al: number;
  loan: number;
  nettPay: number;
  remarks: string;
  sdl: number;
}

interface PayrollDiff {
  employeeName: string;
  csvNo?: number;
  fieldDiffs: {
    fieldName: string;
    csvValue: number;
    dbValue: number;
    delta: number;
  }[];
  status: "matched" | "missing_in_db" | "error";
  errorMsg?: string;
}

// Clean currency string: " US$\t1,000.00 " → 1000.00, "$-" → 0
function cleanMoney(value: string | number | null | undefined): number {
  if (!value && value !== 0) return 0;
  if (typeof value === "number") return Math.round(value * 100) / 100;

  const str = String(value).trim();
  if (str === "$-" || str === "-" || str === "" || str === "N/A") return 0;

  // Remove US$, tabs, commas, parentheses for negative
  let cleaned = str.replace(/US\$|\t|,/g, "").trim();
  const isNegative = cleaned.startsWith("(") && cleaned.endsWith(")");
  if (isNegative) cleaned = cleaned.slice(1, -1);

  let num = parseFloat(cleaned);
  if (isNaN(num)) num = 0;
  return isNegative ? -num : num;
}

// Parse CSV with proper handling of quoted values and tabs
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current);
  return result.map((v) => v.trim());
}

async function readAndParseCSV(filePath: string): Promise<CSVPayrollRow[]> {
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n");
  const rows: CSVPayrollRow[] = [];

  // Skip first 3 header lines, find data rows
  for (let i = 3; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const parts = parseCSVLine(line);
    if (parts.length < 20) continue;

    // Skip total row (row 46 in the file = "TOTAL")
    if (parts[1]?.toUpperCase() === "TOTAL") continue;

    // Extract values
    const no = parseInt(parts[0], 10);
    if (isNaN(no)) continue;

    const employeeName = parts[1]?.trim() || "";
    if (!employeeName) continue;

    rows.push({
      no,
      employeeName,
      basicSalary: cleanMoney(parts[2]),
      ot15: cleanMoney(parts[3]),
      shift: cleanMoney(parts[4]),
      hotlineAllowance: cleanMoney(parts[5]),
      mobile: cleanMoney(parts[6]),
      transport: cleanMoney(parts[7]),
      otherAllowance: cleanMoney(parts[8]),
      gross: cleanMoney(parts[9]),
      houseRental: cleanMoney(parts[10]),
      mbmf: cleanMoney(parts[11]),
      sindaCdac: cleanMoney(parts[12]),
      employeeCpf: cleanMoney(parts[13]),
      advance: cleanMoney(parts[14]),
      al: cleanMoney(parts[15]),
      loan: cleanMoney(parts[16]),
      nettPay: cleanMoney(parts[17]),
      remarks: parts[18]?.trim() || "",
      sdl: cleanMoney(parts[19]),
    });
  }

  return rows;
}

function roundTo2Decimals(num: number): number {
  return Math.round(num * 100) / 100;
}

function tolerance(a: number, b: number): boolean {
  return Math.abs(roundTo2Decimals(a) - roundTo2Decimals(b)) <= 0.01;
}

async function comparePayrolls() {
  console.log("🔍 Starting July 2026 Payroll Comparison...\n");

  const csvPath = path.join("/Users/jc/Desktop/JC Projects/NexaHRSoft2/jc", "Payroll_2026_Jul-Table 1.csv");

  if (!fs.existsSync(csvPath)) {
    console.error(`❌ CSV file not found: ${csvPath}`);
    process.exit(1);
  }

  // Parse CSV
  console.log(`📄 Reading CSV from: ${csvPath}`);
  const csvRows = await readAndParseCSV(csvPath);
  console.log(`✅ Parsed ${csvRows.length} employee rows from CSV\n`);

  // Query database
  console.log("🔗 Querying database for July 2026 payroll records...");
  const dbRecords = await db
    .select()
    .from(payrollRecords)
    .where(and(
      eq(payrollRecords.payPeriodYear, 2026),
      eq(payrollRecords.payPeriodMonth, 7)
    ));

  console.log(`✅ Found ${dbRecords.length} payroll records in database\n`);

  const diffs: PayrollDiff[] = [];
  const matchedDbEmployees = new Set<string>();

  // Compare each CSV row
  for (const csvRow of csvRows) {
    const dbRecord = dbRecords.find(
      (r) => r.employeeName.toLowerCase().trim() === csvRow.employeeName.toLowerCase().trim()
    );

    if (!dbRecord) {
      diffs.push({
        employeeName: csvRow.employeeName,
        csvNo: csvRow.no,
        fieldDiffs: [],
        status: "missing_in_db",
        errorMsg: `No payroll record found in database for ${csvRow.employeeName}`,
      });
      continue;
    }

    matchedDbEmployees.add(dbRecord.id);
    const fieldDiffs: PayrollDiff["fieldDiffs"] = [];

    // Map CSV columns to DB fields and compare
    const comparisons = [
      { name: "basicSalary", csv: csvRow.basicSalary, db: parseFloat(dbRecord.basicSalary) },
      { name: "ot15", csv: csvRow.ot15, db: parseFloat(dbRecord.ot15) },
      { name: "shiftAllowance", csv: csvRow.shift, db: parseFloat(dbRecord.shiftAllowance) },
      { name: "mobileAllowance", csv: csvRow.mobile, db: parseFloat(dbRecord.mobileAllowance) },
      { name: "transportAllowance", csv: csvRow.transport, db: parseFloat(dbRecord.transportAllowance) },
      { name: "grossWages", csv: csvRow.gross, db: parseFloat(dbRecord.grossWages) },
      { name: "houseRentalAllowances", csv: csvRow.houseRental, db: parseFloat(dbRecord.houseRentalAllowances) },
      { name: "mbmf", csv: csvRow.mbmf, db: parseFloat(dbRecord.mbmf) },
      { name: "sinda+cdac", csv: csvRow.sindaCdac, db: parseFloat(dbRecord.sinda) + parseFloat(dbRecord.cdac) },
      { name: "employeeCpf", csv: csvRow.employeeCpf, db: parseFloat(dbRecord.employeeCpf) },
      { name: "advance", csv: csvRow.advance, db: parseFloat(dbRecord.advance) },
      { name: "loanRepaymentTotal", csv: csvRow.loan, db: parseFloat(dbRecord.loanRepaymentTotal) },
      { name: "nett", csv: csvRow.nettPay, db: parseFloat(dbRecord.nett) },
      { name: "sdf (SDL)", csv: csvRow.sdl, db: parseFloat(dbRecord.sdf) },
      // Hotline + Other Allowance combined
      {
        name: "otherAllowance (hotline+other)",
        csv: csvRow.hotlineAllowance + csvRow.otherAllowance,
        db: parseFloat(dbRecord.otherAllowance1) + parseFloat(dbRecord.otherAllowance2) + parseFloat(dbRecord.otherAllowance),
      },
    ];

    for (const comp of comparisons) {
      const csvVal = roundTo2Decimals(comp.csv);
      const dbVal = roundTo2Decimals(comp.db);

      if (!tolerance(csvVal, dbVal)) {
        fieldDiffs.push({
          fieldName: comp.name,
          csvValue: csvVal,
          dbValue: dbVal,
          delta: roundTo2Decimals(csvVal - dbVal),
        });
      }
    }

    // Check A/L adjustment if needed
    if (csvRow.al !== 0) {
      const alAdjustments = await db
        .select()
        .from(payrollAdjustments)
        .where(and(
          eq(payrollAdjustments.userId, dbRecord.userId || ""),
          eq(payrollAdjustments.payPeriodYear, 2026),
          eq(payrollAdjustments.payPeriodMonth, 7),
        ));

      const alAmount = alAdjustments
        .filter((adj) => adj.adjustmentType === "al_days")
        .reduce((sum, adj) => sum + parseFloat(adj.amount || "0"), 0);

      if (!tolerance(csvRow.al, alAmount)) {
        fieldDiffs.push({
          fieldName: "A/L (payroll adjustment)",
          csvValue: csvRow.al,
          dbValue: alAmount,
          delta: csvRow.al - alAmount,
        });
      }
    }

    if (fieldDiffs.length > 0) {
      diffs.push({
        employeeName: csvRow.employeeName,
        csvNo: csvRow.no,
        fieldDiffs,
        status: "matched",
      });
    }
  }

  // Find DB records with no CSV counterpart
  for (const dbRecord of dbRecords) {
    if (!matchedDbEmployees.has(dbRecord.id)) {
      diffs.push({
        employeeName: dbRecord.employeeName,
        fieldDiffs: [],
        status: "missing_in_db",
        errorMsg: `Database record exists but no matching employee in CSV`,
      });
    }
  }

  // Generate report
  console.log("\n" + "=".repeat(80));
  console.log("PAYROLL COMPARISON REPORT - JULY 2026");
  console.log("=".repeat(80) + "\n");

  const missingInDb = diffs.filter((d) => d.status === "missing_in_db");
  const withDiffs = diffs.filter((d) => d.status === "matched" && d.fieldDiffs.length > 0);

  if (withDiffs.length === 0 && missingInDb.length === 0) {
    console.log("✅ ALL RECORDS MATCH! No discrepancies found.\n");
  } else {
    if (withDiffs.length > 0) {
      console.log(`⚠️  MISMATCHES FOUND (${withDiffs.length} employees):\n`);

      for (const diff of withDiffs) {
        console.log(`👤 ${diff.employeeName} (CSV #${diff.csvNo})`);
        for (const field of diff.fieldDiffs) {
          console.log(
            `   ${field.fieldName}: CSV=${field.csvValue} | DB=${field.dbValue} | Δ=${field.delta > 0 ? "+" : ""}${field.delta}`
          );
        }
        console.log();
      }
    }

    if (missingInDb.length > 0) {
      console.log(`\n❌ MISSING OR EXTRA RECORDS (${missingInDb.length}):\n`);
      for (const diff of missingInDb) {
        console.log(`   • ${diff.employeeName}: ${diff.errorMsg}`);
      }
      console.log();
    }
  }

  // Summary
  console.log("\n" + "=".repeat(80));
  console.log("SUMMARY");
  console.log("=".repeat(80));
  console.log(`Total CSV rows:          ${csvRows.length}`);
  console.log(`Total DB records:        ${dbRecords.length}`);
  console.log(`Matched (exact):         ${csvRows.length - withDiffs.length - missingInDb.filter((d) => csvRows.some((r) => r.employeeName.toLowerCase() === d.employeeName.toLowerCase())).length}`);
  console.log(`With differences:        ${withDiffs.length}`);
  console.log(`Missing in DB:           ${missingInDb.filter((d) => csvRows.some((r) => r.employeeName.toLowerCase() === d.employeeName.toLowerCase())).length}`);
  console.log(`Extra in DB:             ${missingInDb.filter((d) => !csvRows.some((r) => r.employeeName.toLowerCase() === d.employeeName.toLowerCase())).length}`);
  console.log("=".repeat(80) + "\n");

  process.exit(0);
}

comparePayrolls().catch((err) => {
  console.error("❌ Error during comparison:", err);
  process.exit(1);
});
