import express, { type Request, Response, NextFunction } from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { Pool } from "pg";
import path from "path";
import { createClient } from "@supabase/supabase-js";
import { sql } from "drizzle-orm";
import { db } from "./db";
import { registerRoutes } from "./routes";
import { startCronJobs } from "./cron";
import { setupVite, serveStatic, log } from "./vite";

// Ensure Supabase Storage buckets exist and clear stale disk-based URLs
async function ensureStorageBuckets() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    log("Skipping storage bucket setup — SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set");
    return;
  }
  try {
    const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });

    const { data: buckets } = await supabase.storage.listBuckets();
    const bucketIds = buckets?.map((b) => b.id) ?? [];

    if (!bucketIds.includes("nexahrsoft-public")) {
      const { error } = await supabase.storage.createBucket("nexahrsoft-public", { public: true });
      if (error) log(`Warning: could not create nexahrsoft-public bucket: ${error.message}`);
      else log("Created Supabase bucket: nexahrsoft-public (public)");
    } else {
      log("Supabase bucket nexahrsoft-public already exists");
    }

    if (!bucketIds.includes("nexahrsoft-private")) {
      const { error } = await supabase.storage.createBucket("nexahrsoft-private", { public: false });
      if (error) log(`Warning: could not create nexahrsoft-private bucket: ${error.message}`);
      else log("Created Supabase bucket: nexahrsoft-private (private)");
    } else {
      log("Supabase bucket nexahrsoft-private already exists");
    }

    // Clear stale /uploads/... URLs left over from old disk storage era (use Drizzle so schema is correct)
    await db.execute(sql`
      UPDATE app_nexahrsoft2.company_settings SET
        logo_url = CASE WHEN logo_url LIKE '/uploads/%' THEN NULL ELSE logo_url END,
        favicon_url = CASE WHEN favicon_url LIKE '/uploads/%' THEN NULL ELSE favicon_url END,
        clock_in_logo_url = CASE WHEN clock_in_logo_url LIKE '/uploads/%' THEN NULL ELSE clock_in_logo_url END
    `);
    log("Stale disk-based URLs cleared from company_settings");
  } catch (err: any) {
    log(`Warning: storage bucket setup failed: ${err.message}`);
  }
}

// Startup migration helper - ensures critical tables exist
async function ensureSchemaMigrations(pool: Pool) {
  console.log("Running schema migrations...");
  try {
    // Set search_path so all unqualified table references resolve correctly
    await pool.query(`SET search_path TO app_nexahrsoft2, public`);

    // Ensure pgcrypto extension is available for gen_random_uuid()
    console.log("Ensuring pgcrypto extension...");
    await pool.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);
    console.log("pgcrypto extension ready");

    // Check if attendance_adjustments table exists
    const tableCheck = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'app_nexahrsoft2'
        AND table_name = 'attendance_adjustments'
      )
    `);
    
    const tableExists = tableCheck.rows[0]?.exists;
    console.log("attendance_adjustments table exists:", tableExists);
    
    if (!tableExists) {
      // Create attendance_adjustments table
      console.log("Creating attendance_adjustments table...");
      await pool.query(`
        CREATE TABLE attendance_adjustments (
          id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id varchar NOT NULL REFERENCES users(id),
          date text NOT NULL,
          adjustment_type text NOT NULL,
          leave_type text,
          regular_hours real,
          ot_hours real,
          notes text,
          created_by varchar NOT NULL REFERENCES users(id),
          created_at timestamp NOT NULL DEFAULT now(),
          updated_at timestamp NOT NULL DEFAULT now()
        )
      `);
      console.log("attendance_adjustments table created");
    }
    
    // Create unique index on user_id + date (IF NOT EXISTS handles idempotency)
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS attendance_adjustments_user_date_unique
      ON attendance_adjustments (user_id, date)
    `);
    console.log("attendance_adjustments unique index ready");
    
    // Also ensure the daily_attendance_summary unique index exists
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS daily_attendance_summary_user_date_unique
      ON daily_attendance_summary (user_id, date)
    `);
    console.log("daily_attendance_summary unique index ready");
    
    // Check if employee_monthly_remarks table exists
    const remarksTableCheck = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'app_nexahrsoft2' 
        AND table_name = 'employee_monthly_remarks'
      )
    `);
    
    const remarksTableExists = remarksTableCheck.rows[0]?.exists;
    console.log("employee_monthly_remarks table exists:", remarksTableExists);
    
    if (!remarksTableExists) {
      // Create employee_monthly_remarks table
      console.log("Creating employee_monthly_remarks table...");
      await pool.query(`
        CREATE TABLE employee_monthly_remarks (
          id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id varchar NOT NULL REFERENCES users(id),
          year integer NOT NULL,
          month integer NOT NULL,
          remark text,
          created_by varchar NOT NULL REFERENCES users(id),
          created_at timestamp NOT NULL DEFAULT now(),
          updated_at timestamp NOT NULL DEFAULT now()
        )
      `);
      console.log("employee_monthly_remarks table created");
    }
    
    // Create unique index on user_id + year + month
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS employee_monthly_remarks_user_year_month_unique
      ON employee_monthly_remarks (user_id, year, month)
    `);
    console.log("employee_monthly_remarks unique index ready");
    
    // Add allow_employee_view column to payroll_records if it doesn't exist
    const allowViewCheck = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.columns 
        WHERE table_schema = 'app_nexahrsoft2' 
        AND table_name = 'payroll_records'
        AND column_name = 'allow_employee_view'
      )
    `);
    
    if (!allowViewCheck.rows[0]?.exists) {
      console.log("Adding allow_employee_view column to payroll_records...");
      await pool.query(`
        ALTER TABLE payroll_records 
        ADD COLUMN allow_employee_view boolean NOT NULL DEFAULT false
      `);
      console.log("allow_employee_view column added");
    } else {
      console.log("allow_employee_view column already exists");
    }
    
    // Create manual_payslips table if it doesn't exist
    const manualPayslipsCheck = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'app_nexahrsoft2' 
        AND table_name = 'manual_payslips'
      )
    `);
    
    if (!manualPayslipsCheck.rows[0]?.exists) {
      console.log("Creating manual_payslips table...");
      await pool.query(`
        CREATE TABLE manual_payslips (
          id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
          employee_name text NOT NULL,
          employee_code text,
          nric text,
          department text,
          designation text,
          pay_period_year integer NOT NULL,
          pay_period_month integer NOT NULL,
          pay_period_start text,
          pay_period_end text,
          regular_hours numeric(10,2) DEFAULT 0,
          overtime_hours numeric(10,2) DEFAULT 0,
          basic_salary numeric(12,2) DEFAULT 0,
          hourly_rate numeric(10,2) DEFAULT 0,
          regular_pay numeric(12,2) DEFAULT 0,
          overtime_pay numeric(12,2) DEFAULT 0,
          mobile_allowance numeric(12,2) DEFAULT 0,
          transport_allowance numeric(12,2) DEFAULT 0,
          loan_allowance numeric(12,2) DEFAULT 0,
          shift_allowance numeric(12,2) DEFAULT 0,
          other_allowance numeric(12,2) DEFAULT 0,
          house_rental_allowance numeric(12,2) DEFAULT 0,
          bonuses numeric(12,2) DEFAULT 0,
          employee_cpf numeric(12,2) DEFAULT 0,
          employer_cpf numeric(12,2) DEFAULT 0,
          loan_deduction numeric(12,2) DEFAULT 0,
          other_deductions numeric(12,2) DEFAULT 0,
          gross_pay numeric(12,2) DEFAULT 0,
          total_deductions numeric(12,2) DEFAULT 0,
          net_pay numeric(12,2) DEFAULT 0,
          remarks text,
          created_by text NOT NULL,
          created_at timestamp NOT NULL DEFAULT now(),
          updated_by text,
          updated_at timestamp
        )
      `);
      console.log("manual_payslips table created");
    } else {
      console.log("manual_payslips table already exists");
    }
    
    // Create manual_payslip_audit_logs table if it doesn't exist
    const auditLogsCheck = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'app_nexahrsoft2' 
        AND table_name = 'manual_payslip_audit_logs'
      )
    `);
    
    if (!auditLogsCheck.rows[0]?.exists) {
      console.log("Creating manual_payslip_audit_logs table...");
      await pool.query(`
        CREATE TABLE manual_payslip_audit_logs (
          id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
          payslip_id varchar NOT NULL REFERENCES manual_payslips(id),
          action text NOT NULL,
          field_name text,
          old_value text,
          new_value text,
          details text,
          changed_by text NOT NULL,
          changed_at timestamp NOT NULL DEFAULT now()
        )
      `);
      console.log("manual_payslip_audit_logs table created");
    } else {
      console.log("manual_payslip_audit_logs table already exists");
    }
    
    // Create claims_audit_log table if it doesn't exist
    const claimsAuditLogCheck = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'app_nexahrsoft2' 
        AND table_name = 'claims_audit_log'
      )
    `);
    
    if (!claimsAuditLogCheck.rows[0]?.exists) {
      console.log("Creating claims_audit_log table...");
      await pool.query(`
        CREATE TABLE claims_audit_log (
          id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
          claim_id varchar NOT NULL,
          user_id varchar NOT NULL,
          employee_code text,
          employee_name text,
          claim_type text NOT NULL,
          amount numeric(10,2) NOT NULL,
          description text,
          claim_month integer NOT NULL,
          claim_year integer NOT NULL,
          action text NOT NULL,
          previous_status text,
          performed_by varchar NOT NULL,
          performed_by_name text,
          comments text,
          performed_at timestamp NOT NULL DEFAULT now()
        )
      `);
      console.log("claims_audit_log table created");
    } else {
      console.log("claims_audit_log table already exists");
      // Drop foreign key constraints if they exist (allows master admin to log actions)
      await pool.query(`
        ALTER TABLE claims_audit_log 
        DROP CONSTRAINT IF EXISTS claims_audit_log_performed_by_users_id_fk
      `);
      await pool.query(`
        ALTER TABLE claims_audit_log 
        DROP CONSTRAINT IF EXISTS claims_audit_log_performed_by_fkey
      `);
      await pool.query(`
        ALTER TABLE claims_audit_log 
        DROP CONSTRAINT IF EXISTS claims_audit_log_user_id_fkey
      `);
      console.log("claims_audit_log FK constraints dropped (if existed)");
    }
    
    // Drop FK constraints from claims table if they exist (allows flexibility with user references)
    const claimsTableCheck = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'app_nexahrsoft2' 
        AND table_name = 'claims'
      )
    `);
    
    if (claimsTableCheck.rows[0]?.exists) {
      console.log("Dropping claims table FK constraints...");
      await pool.query(`
        ALTER TABLE claims 
        DROP CONSTRAINT IF EXISTS claims_user_id_users_id_fk
      `);
      await pool.query(`
        ALTER TABLE claims 
        DROP CONSTRAINT IF EXISTS claims_user_id_fkey
      `);
      await pool.query(`
        ALTER TABLE claims 
        DROP CONSTRAINT IF EXISTS claims_reviewed_by_users_id_fk
      `);
      await pool.query(`
        ALTER TABLE claims 
        DROP CONSTRAINT IF EXISTS claims_reviewed_by_fkey
      `);
      console.log("claims table FK constraints dropped (if existed)");
    }
    
    // Add foreign employee fields to users table
    const employeeTypeCheck = await pool.query(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'users' AND column_name = 'employee_type'
      )
    `);
    
    if (!employeeTypeCheck.rows[0]?.exists) {
      console.log("Adding foreign employee fields to users table...");
      await pool.query(`
        ALTER TABLE users 
        ADD COLUMN IF NOT EXISTS employee_type text,
        ADD COLUMN IF NOT EXISTS passport_number text,
        ADD COLUMN IF NOT EXISTS passport_expiry text
      `);
      console.log("Foreign employee fields added to users table");
    } else {
      console.log("Foreign employee fields already exist");
    }
    
    // Create employee_documents table for compliance documents
    const employeeDocsTableCheck = await pool.query(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_name = 'employee_documents'
      )
    `);
    
    if (!employeeDocsTableCheck.rows[0]?.exists) {
      console.log("Creating employee_documents table...");
      await pool.query(`
        CREATE TABLE employee_documents (
          id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id varchar NOT NULL REFERENCES users(id),
          document_type text NOT NULL,
          document_name text NOT NULL,
          file_url text NOT NULL,
          file_name text NOT NULL,
          file_size integer,
          expiry_date text,
          notes text,
          uploaded_by varchar REFERENCES users(id),
          uploaded_at timestamp NOT NULL DEFAULT NOW()
        )
      `);
      console.log("employee_documents table created");
    } else {
      console.log("employee_documents table already exists");
    }
    
    await pool.query(`UPDATE payroll_records SET pay_mode = 'BANK' WHERE pay_mode = 'BANK DISK'`);

    const deletionLogsExists = await pool.query(`
      SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'employee_deletion_logs')
    `);
    if (!deletionLogsExists.rows[0].exists) {
      await pool.query(`
        CREATE TABLE employee_deletion_logs (
          id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
          employee_id varchar NOT NULL,
          employee_code text,
          employee_name text NOT NULL,
          email text,
          department text,
          designation text,
          section text,
          role text,
          join_date text,
          resign_date text,
          residency_status text,
          basic_monthly_salary text,
          nric_fin text,
          mobile_number text,
          full_snapshot text,
          deleted_by text NOT NULL,
          deleted_by_name text,
          reason text,
          deleted_at timestamp NOT NULL DEFAULT NOW()
        )
      `);
      console.log("employee_deletion_logs table created");
    } else {
      console.log("employee_deletion_logs table already exists");
    }

    // Add advance column to payroll_records if it doesn't exist
    const advanceCol = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.columns 
        WHERE table_name = 'payroll_records' AND column_name = 'advance'
      )
    `);
    if (!advanceCol.rows[0].exists) {
      await pool.query(`ALTER TABLE payroll_records ADD COLUMN advance numeric(12,2) NOT NULL DEFAULT '0'`);
      console.log("payroll_records advance column added");
    } else {
      console.log("payroll_records advance column already exists");
    }

    // Add userId column to leave_history if it doesn't exist
    const leaveHistoryUserIdCol = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.columns 
        WHERE table_name = 'leave_history' AND column_name = 'user_id'
      )
    `);
    if (!leaveHistoryUserIdCol.rows[0].exists) {
      await pool.query(`ALTER TABLE leave_history ADD COLUMN user_id varchar`);
      console.log("leave_history user_id column added");
    } else {
      console.log("leave_history user_id column already exists");
    }

    // Add unique constraint on payroll_records to prevent duplicate generation (race-safe)
    await pool.query(`
      DO $$ BEGIN
        ALTER TABLE payroll_records
          ADD CONSTRAINT payroll_records_unique_employee_period
          UNIQUE (user_id, pay_period_year, pay_period_month);
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);
    console.log("payroll_records unique constraint ready");

    log("Schema migrations verified successfully");
  } catch (error: any) {
    // Log detailed error for debugging - this is critical for production
    console.error("=== SCHEMA MIGRATION FAILED ===");
    console.error("Error message:", error.message);
    console.error("Error code:", error.code);
    console.error("Error detail:", error.detail);
    console.error("Full error:", error);
    // Log but don't crash — schema is already migrated on Supabase
    console.error("Continuing startup despite migration error...");
  }
}

const app = express();

// Session configuration - dynamically set secure based on request
// Log environment for debugging
console.log('Environment check:', {
  NODE_ENV: process.env.NODE_ENV,
  REPLIT_DEPLOYMENT: process.env.REPLIT_DEPLOYMENT,
  hostname: process.env.REPL_SLUG,
});

// Create PostgreSQL session store for persistent sessions in production
const PgStore = connectPgSimple(session);
const sessionPool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  // Release idle connections after 60s so PgBouncer's server_idle_timeout (600s default)
  // never silently kills a connection the pool thinks is alive.
  idleTimeoutMillis: 60_000,
  // Hard limit on pool size — prevents connection exhaustion on Supabase's pooler.
  max: 10,
  // TCP keepalive so the OS detects dead connections rather than hanging indefinitely.
  keepAlive: true,
  keepAliveInitialDelayMillis: 10_000,
});
// Surface pool-level errors (dead connection, DNS failure, etc.) without crashing.
sessionPool.on("error", (err) => {
  console.error("[SessionPool] idle client error:", err.message);
});

app.use(
  session({
    store: new PgStore({
      pool: sessionPool,
      tableName: 'session',
      createTableIfMissing: true,
    }),
    secret: process.env.SESSION_SECRET || "nexa-hr-secret-key-change-in-production",
    resave: false,
    saveUninitialized: false,
    proxy: true, // Trust the X-Forwarded-Proto header from Replit's proxy
    cookie: {
      // secure: 'auto' will automatically use true for HTTPS and false for HTTP
      // This works correctly with Replit's reverse proxy
      secure: 'auto',
      httpOnly: true,
      // 'lax' allows cookies in first-party context (works in new tabs)
      // This is correct for apps accessed directly (not in iframes)
      sameSite: 'lax',
      // Session lasts 24 hours for better user experience
      maxAge: 24 * 60 * 60 * 1000,
      path: '/',
    },
  })
);

declare module 'http' {
  interface IncomingMessage {
    rawBody: unknown
  }
}

declare module 'express-session' {
  interface SessionData {
    userId?: string;
    isAdmin?: boolean;
    isViewOnlyAdmin?: boolean;
    isAttendanceViewAdmin?: boolean;
    isEmployeeDataAdmin?: boolean;
    codeVerifier?: string;
  }
}

// Body size limit for clock-in photos (compressed images are under 500KB typically)
app.use(express.json({
  limit: '5mb',
  verify: (req, _res, buf) => {
    req.rawBody = buf;
  }
}));
app.use(express.urlencoded({ extended: false, limit: '5mb' }));

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  // Serve uploaded files (logos, favicons, etc.) as static assets
  const uploadsDir = path.join(process.cwd(), "dist", "public", "uploads");
  app.use("/uploads", express.static(uploadsDir));

  // Ensure Supabase Storage buckets exist and clear stale disk URLs
  await ensureStorageBuckets();

  // Run schema migrations before starting the app
  await ensureSchemaMigrations(sessionPool);

  const server = await registerRoutes(app);

  // Start background cron jobs (auto-archive past resignations, auto-generate payroll, etc.)
  await startCronJobs();

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    throw err;
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || '5000', 10);
  server.listen({
    port,
    host: "0.0.0.0",
    reusePort: true,
  }, () => {
    log(`serving on port ${port}`);
  });
})();
