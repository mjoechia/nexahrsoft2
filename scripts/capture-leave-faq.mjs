// Playwright screenshot capture for the Leave FAQ.
//
// 1. Logs into the live app as admin and as a dummy test employee
// 2. Drives the leave flows and screenshots key panels into /attached_assets/faq/
// 3. For each screenshot, POSTs to /api/admin/faq/entries/:id/images so the image
//    is attached to the matching seeded FAQ entry (by title prefix)
//
// Required env vars:
//   BASE_URL            (e.g., https://your-app.up.railway.app)
//   ADMIN_USERNAME      (e.g., nexaadmin)
//   ADMIN_PASSWORD
//   EMPLOYEE_USERNAME   (the throwaway test employee you created)
//   EMPLOYEE_PASSWORD
//
// Run:
//   BASE_URL=... ADMIN_USERNAME=... ADMIN_PASSWORD=... EMPLOYEE_USERNAME=... EMPLOYEE_PASSWORD=... \
//     node scripts/capture-leave-faq.mjs

import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "attached_assets", "faq");

const requiredEnv = ["BASE_URL", "ADMIN_USERNAME", "ADMIN_PASSWORD", "EMPLOYEE_USERNAME", "EMPLOYEE_PASSWORD"];
for (const k of requiredEnv) {
  if (!process.env[k]) {
    console.error(`Missing env var: ${k}`);
    process.exit(1);
  }
}
const BASE_URL = process.env.BASE_URL.replace(/\/$/, "");
const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const EMPLOYEE_USERNAME = process.env.EMPLOYEE_USERNAME;
const EMPLOYEE_PASSWORD = process.env.EMPLOYEE_PASSWORD;

// ── Capture plan ──────────────────────────────────────────────────────────
// Each item maps a screenshot to the FAQ entry it should attach to.
// `entryTitleStartsWith` is matched (case-insensitive) against the seeded entry
// titles in routes.ts > seedDefaultFaq.
const plan = [
  {
    id: "employee-leave-page",
    file: "01-employee-leave-page.png",
    caption: "The Leave page — your balances at the top, Apply Leave button in the top-right.",
    role: "employee",
    entryTitleStartsWith: "Where do I see my leave balance",
    action: async (page) => {
      await page.goto(`${BASE_URL}/leave`);
      await page.waitForSelector('[data-testid="text-page-title"]');
      await page.waitForLoadState("networkidle").catch(() => {});
    },
  },
  {
    id: "employee-apply-leave-dialog",
    file: "02-employee-apply-leave-dialog.png",
    caption: "Apply Leave dialog — pick type, dates, day type, and reason.",
    role: "employee",
    entryTitleStartsWith: "How do I apply for leave",
    action: async (page) => {
      await page.goto(`${BASE_URL}/leave`);
      await page.waitForSelector('[data-testid="button-apply-leave"]', { state: "visible" });
      await page.click('[data-testid="button-apply-leave"]');
      await page.waitForSelector('text="Apply for Leave"');
      await page.waitForTimeout(400); // let the dialog settle
    },
  },
  {
    id: "admin-leave-management",
    file: "03-admin-leave-management.png",
    caption: "Admin > Leave Management — pending requests show at the top.",
    role: "admin",
    entryTitleStartsWith: "How do I approve or reject",
    action: async (page) => {
      await page.goto(`${BASE_URL}/admin/leave`);
      await page.waitForLoadState("networkidle").catch(() => {});
      await page.waitForTimeout(400);
    },
  },
  {
    id: "admin-adjust-balance",
    file: "04-admin-adjust-balance.png",
    caption: "Adjust Balance dialog — prefilled with current values; reason is required.",
    role: "admin",
    entryTitleStartsWith: "How do I adjust an employee",
    action: async (page) => {
      await page.goto(`${BASE_URL}/admin/leave`);
      await page.waitForLoadState("networkidle").catch(() => {});
      // Try to open the first Adjust button found. If none, fall back to plain page screenshot.
      const adjust = page.locator('button:has-text("Adjust")').first();
      if (await adjust.count() > 0) {
        await adjust.click();
        await page.waitForTimeout(600);
      }
    },
  },
  {
    id: "admin-leave-types",
    file: "05-admin-leave-types.png",
    caption: "Tools > Leave Types — manage codes, labels, and accrual strategies.",
    role: "admin",
    entryTitleStartsWith: "How do I add or configure a leave type",
    action: async (page) => {
      await page.goto(`${BASE_URL}/admin/tools`);
      await page.waitForSelector('[data-testid="tab-leave-types"]');
      await page.click('[data-testid="tab-leave-types"]');
      await page.waitForTimeout(400);
    },
  },
];

// ── Login helpers ─────────────────────────────────────────────────────────
async function loginAdmin(page) {
  await page.goto(`${BASE_URL}/admin/login`);
  await page.fill('[data-testid="input-username"]', ADMIN_USERNAME);
  await page.fill('[data-testid="input-password"]', ADMIN_PASSWORD);
  await Promise.all([
    page.waitForURL(/\/admin\/(dashboard|tools|leave|attendance)/, { timeout: 15000 }).catch(() => {}),
    page.click('[data-testid="button-login"]'),
  ]);
}

async function loginEmployee(page) {
  await page.goto(`${BASE_URL}/`);
  // The login tab on UserLoginPage
  const loginTab = page.locator('[data-testid="tab-login"]');
  if (await loginTab.count() > 0) await loginTab.click();
  await page.fill('[data-testid="input-login-username"]', EMPLOYEE_USERNAME);
  await page.fill('[data-testid="input-login-password"]', EMPLOYEE_PASSWORD);
  await Promise.all([
    page.waitForURL(/\/(dashboard|leave|attendance|payslip|claims)/, { timeout: 15000 }).catch(() => {}),
    page.click('[data-testid="button-login"]'),
  ]);
}

// ── FAQ entry lookup + upload ─────────────────────────────────────────────
async function listLeaveEntries(adminContext) {
  const res = await adminContext.request.get(`${BASE_URL}/api/admin/faq/categories`);
  if (!res.ok()) throw new Error(`Failed to list categories: ${res.status()}`);
  const { categories } = await res.json();
  const leave = categories.find((c) => c.slug === "leave");
  if (!leave) throw new Error("No 'leave' FAQ category on the server. Did the seed run?");
  const r2 = await adminContext.request.get(`${BASE_URL}/api/admin/faq/entries?categoryId=${leave.id}`);
  if (!r2.ok()) throw new Error(`Failed to list entries: ${r2.status()}`);
  const { entries } = await r2.json();
  return entries;
}

function findEntry(entries, titlePrefix) {
  const target = titlePrefix.toLowerCase();
  return entries.find((e) => e.title.toLowerCase().startsWith(target));
}

async function uploadImage(adminContext, entryId, filePath, caption) {
  const buf = await fs.readFile(filePath);
  const filename = path.basename(filePath);
  const res = await adminContext.request.post(`${BASE_URL}/api/admin/faq/entries/${entryId}/images`, {
    multipart: {
      file: { name: filename, mimeType: "image/png", buffer: buf },
      caption,
    },
  });
  if (!res.ok()) {
    const text = await res.text();
    throw new Error(`Upload failed for ${filename}: ${res.status()} ${text}`);
  }
  return res.json();
}

// ── Main ──────────────────────────────────────────────────────────────────
async function run() {
  await fs.mkdir(OUT_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const adminContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const employeeContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });

  const adminPage = await adminContext.newPage();
  const employeePage = await employeeContext.newPage();

  console.log("Logging in as admin…");
  await loginAdmin(adminPage);
  console.log("Logging in as employee…");
  await loginEmployee(employeePage);

  console.log("Fetching seeded Leave FAQ entries…");
  const entries = await listLeaveEntries(adminContext);
  console.log(`Found ${entries.length} entries.`);

  const results = [];
  for (const step of plan) {
    const page = step.role === "admin" ? adminPage : employeePage;
    const outPath = path.join(OUT_DIR, step.file);
    console.log(`\n[${step.role}] ${step.id} → ${step.file}`);
    try {
      await step.action(page);
      await page.screenshot({ path: outPath, fullPage: true });
      console.log(`  ✓ Saved ${outPath}`);

      const entry = findEntry(entries, step.entryTitleStartsWith);
      if (!entry) {
        console.warn(`  ! No matching FAQ entry for "${step.entryTitleStartsWith}". Skipping upload.`);
        results.push({ ...step, status: "captured_no_match" });
        continue;
      }
      await uploadImage(adminContext, entry.id, outPath, step.caption);
      console.log(`  ✓ Uploaded to entry "${entry.title}"`);
      results.push({ ...step, status: "uploaded", entryId: entry.id, entryTitle: entry.title });
    } catch (err) {
      console.error(`  ✗ Failed: ${err.message}`);
      results.push({ ...step, status: "failed", error: err.message });
    }
  }

  await browser.close();

  const manifestPath = path.join(OUT_DIR, "manifest.json");
  await fs.writeFile(manifestPath, JSON.stringify(results, null, 2));
  console.log(`\nWrote manifest: ${manifestPath}`);

  const failed = results.filter((r) => r.status === "failed").length;
  if (failed > 0) {
    console.error(`\n${failed} step(s) failed. See output above.`);
    process.exitCode = 2;
  } else {
    console.log("\nAll steps succeeded.");
  }
}

run().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
