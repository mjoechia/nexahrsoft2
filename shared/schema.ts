import { sql } from "drizzle-orm";
import { pgSchema, text, varchar, boolean, timestamp, integer, real, unique, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

const appSchema = pgSchema("app_nexahrsoft2");

export const users = appSchema.table("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: text("email").notNull().unique(),
  username: text("username").unique(), // Username for login (nullable for OAuth users)
  name: text("name").notNull(),
  passwordHash: text("password_hash"), // Password hash (nullable for OAuth users)
  mobileNumber: text("mobile_number"), // Mobile number (optional)
  authId: text("auth_id").unique(), // Replit Auth ID for OAuth users
  role: text("role").notNull().default("user"), // 'admin', 'viewonly_admin', 'attendance_view_admin', or 'user'
  isApproved: boolean("is_approved").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  // HR metadata fields
  employeeCode: text("employee_code"), // Employee code (e.g., 06001)
  shortName: text("short_name"), // Short name / nickname
  nricFin: text("nric_fin"), // NRIC/FIN number
  gender: text("gender"), // MALE, FEMALE
  department: text("department"), // Department name
  section: text("section"), // Section (e.g., SINGAPOREAN, FOREIGN)
  designation: text("designation"), // Job title/designation
  fingerId: text("finger_id"), // Finger/Face ID
  joinDate: text("join_date"), // Join date (DD-MM-YYYY)
  resignDate: text("resign_date"), // Resign date (DD-MM-YYYY)
  welcomeEmailSentAt: timestamp("welcome_email_sent_at"), // When welcome email was last sent
  mustChangePassword: boolean("must_change_password").notNull().default(false), // Force password change on first login
  isArchived: boolean("is_archived").notNull().default(false), // Hidden from all views when true
  // CPF and Payroll fields
  birthDate: text("birth_date"), // YYYY-MM-DD format for age-based CPF calculations
  residencyStatus: text("residency_status"), // 'SC' (Singapore Citizen), 'SPR' (Permanent Resident), 'FOREIGNER'
  sprStartDate: text("spr_start_date"), // YYYY-MM-DD when SPR status started (for graduated rates)
  basicMonthlySalary: numeric("basic_monthly_salary", { precision: 12, scale: 2 }), // dollars (e.g., 1200.00)
  hourlyRate: numeric("hourly_rate", { precision: 10, scale: 2 }), // dollars (e.g., 15.50)
  dailyRate: numeric("daily_rate", { precision: 10, scale: 2 }), // dollars (e.g., 120.00)
  payType: text("pay_type"), // 'monthly', 'hourly', 'daily'
  regularHoursPerDay: real("regular_hours_per_day").default(8), // Standard work hours before OT kicks in
  // Default allowances (dollars) - used as defaults when generating payroll
  defaultMobileAllowance: numeric("default_mobile_allowance", { precision: 10, scale: 2 }).default("0"),
  defaultTransportAllowance: numeric("default_transport_allowance", { precision: 10, scale: 2 }).default("0"),
  defaultMealAllowance: numeric("default_meal_allowance", { precision: 10, scale: 2 }).default("0"),
  defaultShiftAllowance: numeric("default_shift_allowance", { precision: 10, scale: 2 }).default("0"),
  defaultOtherAllowance: numeric("default_other_allowance", { precision: 10, scale: 2 }).default("0"),
  defaultOtherAllowance1: numeric("default_other_allowance_1", { precision: 10, scale: 2 }).default("0"),
  defaultOtherAllowance2: numeric("default_other_allowance_2", { precision: 10, scale: 2 }).default("0"),
  defaultHouseRentalAllowance: numeric("default_house_rental_allowance", { precision: 10, scale: 2 }).default("0"),
  // Salary adjustment (dollars) - recurring adjustment added to basic salary
  salaryAdjustment: numeric("salary_adjustment", { precision: 10, scale: 2 }).default("0"),
  salaryAdjustmentReason: text("salary_adjustment_reason"),
  // Work schedule - for salary calculations
  regularDaysPerWeek: real("regular_days_per_week").default(5), // 5 or 5.5 days per week
  weeklyContractHours: real("weekly_contract_hours").default(44), // MOM-compliant weekly contract hours (e.g., 44)
  // OT rate fields (calculated from hourly rate)
  ot15Rate: numeric("ot15_rate", { precision: 10, scale: 2 }), // Calculated OT 1.5x rate
  ot20Rate: numeric("ot20_rate", { precision: 10, scale: 2 }), // Calculated OT 2.0x rate
  // Additional employee fields
  birthday: text("birthday"), // YYYY-MM-DD format
  workPermitNumber: text("work_permit_number"),
  workPermitExpiry: text("work_permit_expiry"), // YYYY-MM-DD format
  finNumber: text("fin_number"),
  finNumberExpiry: text("fin_number_expiry"), // YYYY-MM-DD format
  remarks1: text("remarks_1"),
  remarks2: text("remarks_2"),
  remarks3: text("remarks_3"),
  remarks4: text("remarks_4"),
  // Foreign employee fields
  employeeType: text("employee_type"), // 'local', 'foreigner', 'pr'
  passportNumber: text("passport_number"),
  passportExpiry: text("passport_expiry"), // YYYY-MM-DD format
  // SHG (Self-Help Group) contribution fields
  ethnicity: text("ethnicity"), // 'chinese', 'indian', 'malay', 'eurasian', 'other'
  religion: text("religion"), // 'muslim', 'other', null
  shgOptOut: boolean("shg_opt_out").notNull().default(false), // Opt-out of SHG (not applicable to MBMF)
});

// Employee documents table for storing compliance documents
export const employeeDocuments = appSchema.table("employee_documents", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  documentType: text("document_type").notNull(), // 'passport', 'work_pass', 'certificate', 'other'
  documentName: text("document_name").notNull(), // User-friendly name/label
  fileUrl: text("file_url").notNull(), // URL to file in object storage
  fileName: text("file_name").notNull(), // Original filename
  fileSize: integer("file_size"), // File size in bytes
  expiryDate: text("expiry_date"), // YYYY-MM-DD format (optional, for documents with expiry)
  notes: text("notes"), // Optional notes
  uploadedBy: varchar("uploaded_by").references(() => users.id), // Admin who uploaded
  uploadedAt: timestamp("uploaded_at").notNull().defaultNow(),
});

export const companySettings = appSchema.table("company_settings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyName: text("company_name").notNull().default("NexaHR"),
  companyAddress: text("company_address"), // Company address for payslip header
  companyUen: text("company_uen"), // Company UEN (Unique Entity Number) for payslip header
  logoUrl: text("logo_url"), // URL to app logo in object storage (used in header/branding)
  clockInLogoUrl: text("clock_in_logo_url"), // URL to company logo displayed during clock-in
  faviconUrl: text("favicon_url"), // URL to favicon in object storage
  attendanceBufferMinutes: integer("attendance_buffer_minutes").notNull().default(15), // Max minutes buffer for clock in/out
  defaultTimezone: text("default_timezone").notNull().default("Asia/Singapore"), // IANA timezone for attendance calculations
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  // Email settings
  senderEmail: text("sender_email"), // Email address to send from
  senderName: text("sender_name"), // Sender display name
  appUrl: text("app_url").default("https://app.nexahrms.com"), // App URL for QR code
  // Payroll settings
  regularHoursPerDay: real("regular_hours_per_day").default(8), // Standard work hours before OT
  regularDaysPerWeek: real("regular_days_per_week").default(5), // Standard work days per week
  otMultiplier15: real("ot_multiplier_15").default(1.5), // Weekday OT multiplier
  otMultiplier20: real("ot_multiplier_20").default(2.0), // Weekend/PH OT multiplier
});

// Email logs for tracking sent emails
export const emailLogs = appSchema.table("email_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  emailType: text("email_type").notNull(), // 'welcome', 'password_reset', etc.
  recipientEmail: text("recipient_email").notNull(),
  subject: text("subject").notNull(),
  status: text("status").notNull().default("pending"), // 'pending', 'sent', 'failed'
  errorMessage: text("error_message"), // Error message if failed
  sentAt: timestamp("sent_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const attendanceRecords = appSchema.table("attendance_records", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  date: text("date").notNull(), // Format: YYYY-MM-DD for easy querying
  clockInTime: timestamp("clock_in_time").notNull(),
  clockOutTime: timestamp("clock_out_time"), // Nullable - user might still be clocked in
  photoUrl: text("photo_url"), // URL to attendance photo in object storage
  latitude: text("latitude"), // GPS latitude (clock-in)
  longitude: text("longitude"), // GPS longitude (clock-in)
  clockInLocationText: text("clock_in_location_text"), // Geocoded address text (clock-in)
  clockOutLatitude: text("clock_out_latitude"), // GPS latitude (clock-out)
  clockOutLongitude: text("clock_out_longitude"), // GPS longitude (clock-out)
  clockOutLocationText: text("clock_out_location_text"), // Geocoded address text (clock-out)
  autoClosed: boolean("auto_closed").notNull().default(false), // True if system auto-closed this session (orphaned session recovery)
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const dailyAttendanceSummary = appSchema.table("daily_attendance_summary", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  date: text("date").notNull(), // Format: YYYY-MM-DD
  userId: varchar("user_id").notNull().references(() => users.id),
  employeeCode: text("employee_code"),
  employeeName: text("employee_name"),
  department: text("department"),
  totalClockIns: integer("total_clock_ins").notNull().default(0),
  totalHoursWorked: real("total_hours_worked").default(0), // Decimal hours
  firstClockIn: timestamp("first_clock_in"),
  lastClockOut: timestamp("last_clock_out"),
  status: text("status").notNull().default("absent"), // 'present', 'absent', 'partial'
  calculatedAt: timestamp("calculated_at").notNull().defaultNow(),
}, (table) => [
  unique("daily_attendance_summary_user_date_unique").on(table.userId, table.date),
]);

// Attendance adjustments for leave and OT override
export const attendanceAdjustments = appSchema.table("attendance_adjustments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  date: text("date").notNull(), // Format: YYYY-MM-DD
  adjustmentType: text("adjustment_type").notNull(), // 'leave' or 'hours'
  leaveType: text("leave_type"), // 'AL', 'MC', 'ML', 'CL', 'OIL' (only when adjustmentType is 'leave')
  regularHours: real("regular_hours"), // Regular work hours (default 9 for leave, or admin-specified for hours adjustment)
  otHours: real("ot_hours"), // Overtime hours (for 'hours' adjustmentType)
  notes: text("notes"), // Optional notes by admin
  createdBy: varchar("created_by").notNull().references(() => users.id), // Admin who created adjustment
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  unique("attendance_adjustments_user_date_unique").on(table.userId, table.date),
]);

export const userSessions = appSchema.table("user_sessions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`), // Internal DB ID
  sessionId: text("session_id").notNull().unique(), // Express session ID
  userId: varchar("user_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  lastSeen: timestamp("last_seen").notNull().defaultNow(),
  userAgent: text("user_agent"), // Browser/device info
  ipAddress: text("ip_address"), // IP address
  revokedAt: timestamp("revoked_at"), // Null if active, timestamp if revoked
});

export const loginChallenges = appSchema.table("login_challenges", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  challengeToken: text("challenge_token").notNull().unique(), // Signed token for validation
  ipAddress: text("ip_address"), // IP that initiated login
  userAgent: text("user_agent"), // Browser that initiated login
  expiresAt: timestamp("expires_at").notNull(), // Short-lived (2 minutes)
  createdAt: timestamp("created_at").notNull().defaultNow(),
  usedAt: timestamp("used_at"), // Null if not used, timestamp if consumed
});

export const insertUserSchema = createInsertSchema(users).omit({
  id: true,
  createdAt: true,
  passwordHash: true, // Don't allow direct password hash insertion
});

export const registerUserSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  username: z.string().min(3, "Username must be at least 3 characters"),
  email: z.string().email("Invalid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  confirmPassword: z.string(),
  mobileNumber: z.string().regex(/^\+?[1-9]\d{1,14}$/, "Invalid mobile number format"),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords don't match",
  path: ["confirmPassword"],
});

export const loginUserSchema = z.object({
  usernameOrEmail: z.string().min(1, "Username or email is required"),
  password: z.string().min(1, "Password is required"),
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type RegisterUser = z.infer<typeof registerUserSchema>;
export type LoginUser = z.infer<typeof loginUserSchema>;
export type User = typeof users.$inferSelect;

export const insertEmployeeDocumentSchema = createInsertSchema(employeeDocuments).omit({
  id: true,
  uploadedAt: true,
});
export type InsertEmployeeDocument = z.infer<typeof insertEmployeeDocumentSchema>;
export type EmployeeDocument = typeof employeeDocuments.$inferSelect;

export const insertCompanySettingsSchema = createInsertSchema(companySettings).omit({
  id: true,
  updatedAt: true,
});

export type InsertCompanySettings = z.infer<typeof insertCompanySettingsSchema>;
export type CompanySettings = typeof companySettings.$inferSelect;

export const insertAttendanceRecordSchema = createInsertSchema(attendanceRecords).omit({
  id: true,
  createdAt: true,
});

export const clockInSchema = z.object({
  timestamp: z.string().datetime(), // ISO 8601 datetime string
});

export const clockOutSchema = z.object({
  recordId: z.string().uuid(),
  timestamp: z.string().datetime(), // ISO 8601 datetime string
});

export type InsertAttendanceRecord = z.infer<typeof insertAttendanceRecordSchema>;
export type AttendanceRecord = typeof attendanceRecords.$inferSelect;
export type ClockIn = z.infer<typeof clockInSchema>;
export type ClockOut = z.infer<typeof clockOutSchema>;

export const insertDailyAttendanceSummarySchema = createInsertSchema(dailyAttendanceSummary).omit({
  id: true,
  calculatedAt: true,
});
export type InsertDailyAttendanceSummary = z.infer<typeof insertDailyAttendanceSummarySchema>;
export type DailyAttendanceSummary = typeof dailyAttendanceSummary.$inferSelect;

// Attendance adjustments schemas and types
export const leaveTypes = ["AL", "MC", "ML", "CL", "OIL"] as const;
export type LeaveType = typeof leaveTypes[number];

export const leaveTypeLabels: Record<LeaveType, string> = {
  AL: "Annual Leave",
  MC: "Medical Leave",
  ML: "Maternity Leave",
  CL: "Childcare Leave",
  OIL: "Off in Lieu",
};

export const insertAttendanceAdjustmentSchema = createInsertSchema(attendanceAdjustments).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertAttendanceAdjustment = z.infer<typeof insertAttendanceAdjustmentSchema>;
export type AttendanceAdjustment = typeof attendanceAdjustments.$inferSelect;

// Employee monthly remarks for heatmap
export const employeeMonthlyRemarks = appSchema.table("employee_monthly_remarks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  year: integer("year").notNull(),
  month: integer("month").notNull(), // 0-11 (JavaScript month format)
  remark: text("remark"),
  createdBy: varchar("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  unique("employee_monthly_remarks_user_year_month_unique").on(table.userId, table.year, table.month),
]);

export const insertEmployeeMonthlyRemarkSchema = createInsertSchema(employeeMonthlyRemarks).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertEmployeeMonthlyRemark = z.infer<typeof insertEmployeeMonthlyRemarkSchema>;
export type EmployeeMonthlyRemark = typeof employeeMonthlyRemarks.$inferSelect;

export const insertUserSessionSchema = createInsertSchema(userSessions).omit({
  id: true,
  createdAt: true,
  lastSeen: true,
});

export const insertLoginChallengeSchema = createInsertSchema(loginChallenges).omit({
  id: true,
  createdAt: true,
});

export type InsertUserSession = z.infer<typeof insertUserSessionSchema>;
export type UserSession = typeof userSessions.$inferSelect;
export type InsertLoginChallenge = z.infer<typeof insertLoginChallengeSchema>;
export type LoginChallenge = typeof loginChallenges.$inferSelect;

// Payslip Management
export const payslipRecords = appSchema.table("payslip_records", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  periodStart: text("period_start").notNull(), // Format: YYYY-MM-DD
  periodEnd: text("period_end").notNull(), // Format: YYYY-MM-DD
  hourlyWage: integer("hourly_wage").notNull(), // Cents (e.g., 2500 = $25.00)
  totalHours: integer("total_hours").notNull(), // Total hours in half-hour increments (e.g., 80 = 40 hours)
  totalPay: integer("total_pay").notNull(), // Cents
  status: text("status").notNull().default("draft"), // 'draft' or 'approved'
  approvedAt: timestamp("approved_at"), // Nullable until approved
  approvedBy: varchar("approved_by"), // Admin identifier (not FK since admin is not in users table)
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertPayslipRecordSchema = createInsertSchema(payslipRecords).omit({
  id: true,
  createdAt: true,
});

export type InsertPayslipRecord = z.infer<typeof insertPayslipRecordSchema>;
export type PayslipRecord = typeof payslipRecords.$inferSelect;

// Leave Management
export const leaveBalances = appSchema.table("leave_balances", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  employeeCode: text("employee_code"), // Denormalized for quick reference
  employeeName: text("employee_name"), // Denormalized for quick reference
  leaveType: text("leave_type").notNull(), // 'AL', 'ML', 'OIL', 'UL', 'CL', etc.
  year: integer("year").notNull(), // Year for this balance
  broughtForward: numeric("brought_forward", { precision: 6, scale: 2 }).notNull().default("0"), // Days from previous year
  earned: numeric("earned", { precision: 6, scale: 2 }).notNull().default("0"), // Days earned this year
  eligible: numeric("eligible", { precision: 6, scale: 2 }).notNull().default("0"), // Total entitled days
  taken: numeric("taken", { precision: 6, scale: 2 }).notNull().default("0"), // Days already used
  balance: numeric("balance", { precision: 6, scale: 2 }).notNull().default("0"), // Remaining balance (can be negative)
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const leaveApplications = appSchema.table("leave_applications", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  employeeCode: text("employee_code"), // Denormalized for quick reference
  employeeName: text("employee_name"), // Denormalized for quick reference
  leaveType: text("leave_type").notNull(), // 'AL', 'ML', 'OIL', 'UL', 'CL', etc.
  startDate: text("start_date").notNull(), // Format: YYYY-MM-DD
  endDate: text("end_date").notNull(), // Format: YYYY-MM-DD
  totalDays: numeric("total_days", { precision: 6, scale: 2 }).notNull(), // Number of days requested (supports 0.5 for half-day)
  dayType: text("day_type").notNull().default("full"), // 'full', 'first_half', 'second_half'
  reason: text("reason").notNull(),
  status: text("status").notNull().default("pending"), // 'pending', 'approved', 'rejected', 'cancelled'
  // Medical Leave specific fields
  mcFileUrl: text("mc_file_url"), // URL to medical certificate file
  receiptFileUrl: text("receipt_file_url"), // URL to medical receipt/claim file
  mlClaimAmount: numeric("ml_claim_amount", { precision: 10, scale: 2 }), // Claim amount for medical leave
  // Review fields
  reviewedBy: varchar("reviewed_by").references(() => users.id), // Admin who reviewed
  reviewedAt: timestamp("reviewed_at"), // When it was reviewed
  reviewComments: text("review_comments"), // Admin's comments
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertLeaveBalanceSchema = createInsertSchema(leaveBalances).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertLeaveApplicationSchema = createInsertSchema(leaveApplications).omit({
  id: true,
  createdAt: true,
});

export type InsertLeaveBalance = z.infer<typeof insertLeaveBalanceSchema>;
export type LeaveBalance = typeof leaveBalances.$inferSelect;
export type InsertLeaveApplication = z.infer<typeof insertLeaveApplicationSchema>;
export type LeaveApplication = typeof leaveApplications.$inferSelect;

// Leave History (for imported historical leave data)
export const leaveHistory = appSchema.table("leave_history", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id"), // Linked system user ID (from matching)
  employeeCode: text("employee_code").notNull(),
  employeeName: text("employee_name").notNull(),
  leaveType: text("leave_type").notNull(), // 'AL', 'ML', 'OIL', 'UL', 'CL', etc.
  leaveDate: text("leave_date").notNull(), // Format: YYYY-MM-DD
  dayOfWeek: text("day_of_week"), // Monday, Tuesday, etc.
  remarks: text("remarks"),
  daysOrHours: text("days_or_hours").notNull().default("1.00 day"), // "1.00 day" or "4.00 hr"
  mlClaimAmount: numeric("ml_claim_amount", { precision: 10, scale: 2 }).default("0"), // dollars for medical leave claims
  year: integer("year").notNull(), // Year of the leave
  importedAt: timestamp("imported_at").notNull().defaultNow(),
});

export const insertLeaveHistorySchema = createInsertSchema(leaveHistory).omit({
  id: true,
  importedAt: true,
});

export type InsertLeaveHistory = z.infer<typeof insertLeaveHistorySchema>;
export type LeaveHistory = typeof leaveHistory.$inferSelect;

// Email log types
export const insertEmailLogSchema = createInsertSchema(emailLogs).omit({
  id: true,
  createdAt: true,
});

export type InsertEmailLog = z.infer<typeof insertEmailLogSchema>;
export type EmailLog = typeof emailLogs.$inferSelect;

// Audit logs for tracking admin changes to user data
export const auditLogs = appSchema.table("audit_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id), // User whose data was changed
  changedBy: text("changed_by").notNull(), // Admin username/email who made the change
  fieldChanged: text("field_changed").notNull(), // Which field was changed
  oldValue: text("old_value"), // Previous value (nullable for new records)
  newValue: text("new_value"), // New value
  changeType: text("change_type").notNull().default("update"), // 'create', 'update', 'delete'
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertAuditLogSchema = createInsertSchema(auditLogs).omit({
  id: true,
  createdAt: true,
});

export type InsertAuditLog = z.infer<typeof insertAuditLogSchema>;
export type AuditLog = typeof auditLogs.$inferSelect;

// Password override logs for tracking admin password resets
export const passwordOverrideLogs = appSchema.table("password_override_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id), // User whose password was reset
  changedBy: text("changed_by").notNull(), // Admin who made the change
  reason: text("reason"), // Optional reason for the override
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertPasswordOverrideLogSchema = createInsertSchema(passwordOverrideLogs).omit({
  id: true,
  createdAt: true,
});

export type InsertPasswordOverrideLog = z.infer<typeof insertPasswordOverrideLogSchema>;
export type PasswordOverrideLog = typeof passwordOverrideLogs.$inferSelect;

// Comprehensive Payroll Records (from CSV import)
export const payrollRecords = appSchema.table("payroll_records", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id), // Link to user (nullable if employee not in system)
  payPeriod: text("pay_period").notNull(), // e.g., "NOV 2025", "JAN 2025"
  payPeriodYear: integer("pay_period_year").notNull(), // 2025
  payPeriodMonth: integer("pay_period_month").notNull(), // 1-12
  
  // Employee Info (from CSV)
  employeeCode: text("employee_code").notNull(),
  employeeName: text("employee_name").notNull(),
  deptCode: text("dept_code"),
  deptName: text("dept_name"),
  secCode: text("sec_code"),
  secName: text("sec_name"),
  catCode: text("cat_code"),
  catName: text("cat_name"),
  nric: text("nric"),
  joinDate: text("join_date"),
  
  // Hours Worked (for employer view only)
  basicHoursWorked: real("basic_hours_worked").default(0), // Regular hours worked
  otHoursWorked: real("ot_hours_worked").default(0), // Overtime hours worked
  ot15Hours: real("ot15_hours").default(0), // OT 1.5x hours
  ot20Hours: real("ot20_hours").default(0), // OT 2.0x hours
  
  // Salary Components (stored as dollars, e.g., 1200.00)
  totSalary: numeric("tot_salary", { precision: 12, scale: 2 }).notNull().default("0"),
  basicSalary: numeric("basic_salary", { precision: 12, scale: 2 }).notNull().default("0"),
  monthlyVariablesComponent: numeric("monthly_variables_component", { precision: 12, scale: 2 }).notNull().default("0"),
  
  // Overtime
  flat: numeric("flat", { precision: 12, scale: 2 }).notNull().default("0"),
  ot10: numeric("ot10", { precision: 12, scale: 2 }).notNull().default("0"), // OT 1.0x
  ot15: numeric("ot15", { precision: 12, scale: 2 }).notNull().default("0"), // OT 1.5x
  ot20: numeric("ot20", { precision: 12, scale: 2 }).notNull().default("0"), // OT 2.0x
  ot30: numeric("ot30", { precision: 12, scale: 2 }).notNull().default("0"), // OT 3.0x
  shiftAllowance: numeric("shift_allowance", { precision: 12, scale: 2 }).notNull().default("0"),
  totRestPhAmount: numeric("tot_rest_ph_amount", { precision: 12, scale: 2 }).notNull().default("0"), // Rest/PH Amount
  
  // Allowances with CPF (Ordinary)
  mobileAllowance: numeric("mobile_allowance", { precision: 12, scale: 2 }).notNull().default("0"),
  transportAllowance: numeric("transport_allowance", { precision: 12, scale: 2 }).notNull().default("0"),
  
  // Allowances with CPF (Additional)
  annualLeaveEncashment: numeric("annual_leave_encashment", { precision: 12, scale: 2 }).notNull().default("0"),
  serviceCallAllowances: numeric("service_call_allowances", { precision: 12, scale: 2 }).notNull().default("0"),
  
  // Allowances without CPF
  otherAllowance: numeric("other_allowance", { precision: 12, scale: 2 }).notNull().default("0"),
  otherAllowance1: numeric("other_allowance_1", { precision: 12, scale: 2 }).notNull().default("0"),
  otherAllowance2: numeric("other_allowance_2", { precision: 12, scale: 2 }).notNull().default("0"),
  houseRentalAllowances: numeric("house_rental_allowances", { precision: 12, scale: 2 }).notNull().default("0"),
  
  // Deductions - Loan Repayments (combined into single field as JSON or total)
  loanRepaymentTotal: numeric("loan_repayment_total", { precision: 12, scale: 2 }).notNull().default("0"), // total of all loans
  loanRepaymentDetails: text("loan_repayment_details"), // JSON string with breakdown if needed
  
  // Deductions without CPF
  noPayDay: numeric("no_pay_day", { precision: 12, scale: 2 }).notNull().default("0"), // deduction for unpaid leave
  advance: numeric("advance", { precision: 12, scale: 2 }).notNull().default("0"), // salary advance deduction
  
  // Community Contributions
  cc: numeric("cc", { precision: 12, scale: 2 }).notNull().default("0"), // Chinese Development Assistance Council
  cdac: numeric("cdac", { precision: 12, scale: 2 }).notNull().default("0"),
  ecf: numeric("ecf", { precision: 12, scale: 2 }).notNull().default("0"), // Eurasian Community Fund
  mbmf: numeric("mbmf", { precision: 12, scale: 2 }).notNull().default("0"), // Mosque Building & Mendaki Fund
  sinda: numeric("sinda", { precision: 12, scale: 2 }).notNull().default("0"), // Singapore Indian Development Association
  
  // Bonus
  bonus: numeric("bonus", { precision: 12, scale: 2 }).notNull().default("0"),
  
  // Totals
  grossWages: numeric("gross_wages", { precision: 12, scale: 2 }).notNull().default("0"),
  cpfWages: numeric("cpf_wages", { precision: 12, scale: 2 }).notNull().default("0"),
  
  // Levies
  sdf: numeric("sdf", { precision: 12, scale: 2 }).notNull().default("0"), // Skills Development Fund
  fwl: numeric("fwl", { precision: 12, scale: 2 }).notNull().default("0"), // Foreign Worker Levy
  
  // CPF Contributions
  employerCpf: numeric("employer_cpf", { precision: 12, scale: 2 }).notNull().default("0"),
  employeeCpf: numeric("employee_cpf", { precision: 12, scale: 2 }).notNull().default("0"), // stored as negative
  totalCpf: numeric("total_cpf", { precision: 12, scale: 2 }).notNull().default("0"), // total CPF contribution
  
  // Original Calculated CPF (for override/revert functionality)
  originalEmployerCpf: numeric("original_employer_cpf", { precision: 12, scale: 2 }), // System-calculated employer CPF
  originalEmployeeCpf: numeric("original_employee_cpf", { precision: 12, scale: 2 }), // System-calculated employee CPF
  cpfOverridden: boolean("cpf_overridden").notNull().default(false), // True if CPF has been manually overridden
  
  // Final Amounts
  total: numeric("total", { precision: 12, scale: 2 }).notNull().default("0"), // total before deductions
  nett: numeric("nett", { precision: 12, scale: 2 }).notNull().default("0"), // final take-home pay
  
  // Claims Reimbursement (approved claims added to payslip)
  claimsReimbursement: numeric("claims_reimbursement", { precision: 12, scale: 2 }).notNull().default("0"), // Total approved claims
  
  // Payment Info
  payMode: text("pay_mode"), // 'BANK DISK', 'CASH', 'CHEQUE'
  chequeNo: text("cheque_no"),
  
  // Metadata
  importedAt: timestamp("imported_at").notNull().defaultNow(),
  importedBy: text("imported_by"), // Admin who imported
  importBatchId: varchar("import_batch_id"), // Link to import batch for historical imports
  isHistoricalImport: boolean("is_historical_import").notNull().default(false), // True for imported historical data
  
  // Employee View Permission
  allowEmployeeView: boolean("allow_employee_view").notNull().default(false), // If true, employee can view their own payslip
});

export const insertPayrollRecordSchema = createInsertSchema(payrollRecords).omit({
  id: true,
  importedAt: true,
});

export type InsertPayrollRecord = z.infer<typeof insertPayrollRecordSchema>;
export type PayrollRecord = typeof payrollRecords.$inferSelect;

// Attendance Audit Logs for tracking admin changes to attendance data
export const attendanceAuditLogs = appSchema.table("attendance_audit_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  action: text("action").notNull(), // 'add', 'update', 'delete', 'end_clockin'
  tableName: text("table_name").notNull().default("attendance_records"),
  recordId: text("record_id"), // ID of the affected attendance record
  fieldName: text("field_name"), // Which field was changed (for updates)
  oldValue: text("old_value"), // Previous value
  newValue: text("new_value"), // New value
  changedBy: text("changed_by"), // Admin username who made the change
  changedAt: timestamp("changed_at").notNull().defaultNow(),
  userId: varchar("user_id").references(() => users.id), // User whose attendance was affected
});

export const insertAttendanceAuditLogSchema = createInsertSchema(attendanceAuditLogs).omit({
  id: true,
  changedAt: true,
});

export type InsertAttendanceAuditLog = z.infer<typeof insertAttendanceAuditLogSchema>;
export type AttendanceAuditLog = typeof attendanceAuditLogs.$inferSelect;

// Leave Audit Logs for tracking admin changes to leave records
export const leaveAuditLogs = appSchema.table("leave_audit_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  action: text("action").notNull(), // 'import', 'create', 'update', 'delete', 'balance_update', 'application_review'
  tableName: text("table_name").notNull(), // 'leave_history', 'leave_balances', 'leave_applications'
  recordId: text("record_id"), // ID of the affected record
  employeeCode: text("employee_code"), // For leave history records
  employeeName: text("employee_name"), // For leave history records
  fieldName: text("field_name"), // Which field was changed (for updates)
  oldValue: text("old_value"), // Previous value
  newValue: text("new_value"), // New value
  details: text("details"), // JSON string with additional details
  changedBy: text("changed_by").notNull(), // Admin username who made the change
  changedAt: timestamp("changed_at").notNull().defaultNow(),
});

export const insertLeaveAuditLogSchema = createInsertSchema(leaveAuditLogs).omit({
  id: true,
  changedAt: true,
});

export type InsertLeaveAuditLog = z.infer<typeof insertLeaveAuditLogSchema>;
export type LeaveAuditLog = typeof leaveAuditLogs.$inferSelect;

// Payroll Loan Accounts - tracks loans given to employees
export const payrollLoanAccounts = appSchema.table("payroll_loan_accounts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id),
  employeeCode: text("employee_code").notNull(),
  employeeName: text("employee_name").notNull(),
  loanType: text("loan_type").notNull(), // 'salary_advance', 'company_loan', 'personal_loan', etc.
  loanDescription: text("loan_description"),
  principalAmount: numeric("principal_amount", { precision: 12, scale: 2 }).notNull(), // dollars - original loan amount
  outstandingBalance: numeric("outstanding_balance", { precision: 12, scale: 2 }).notNull(), // dollars - remaining balance
  monthlyRepayment: numeric("monthly_repayment", { precision: 12, scale: 2 }).notNull().default("0"), // dollars - monthly deduction amount
  interestRate: numeric("interest_rate", { precision: 6, scale: 4 }).notNull().default("0"), // percentage (e.g., 1.5 = 1.5%)
  startDate: text("start_date").notNull(), // YYYY-MM-DD
  endDate: text("end_date"), // YYYY-MM-DD expected payoff date
  status: text("status").notNull().default("active"), // 'active', 'paid_off', 'written_off', 'suspended'
  createdAt: timestamp("created_at").notNull().defaultNow(),
  createdBy: text("created_by"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertPayrollLoanAccountSchema = createInsertSchema(payrollLoanAccounts).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertPayrollLoanAccount = z.infer<typeof insertPayrollLoanAccountSchema>;
export type PayrollLoanAccount = typeof payrollLoanAccounts.$inferSelect;

// Payroll Loan Repayments - tracks individual repayments against loans
export const payrollLoanRepayments = appSchema.table("payroll_loan_repayments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  loanAccountId: varchar("loan_account_id").notNull().references(() => payrollLoanAccounts.id),
  payPeriodYear: integer("pay_period_year").notNull(),
  payPeriodMonth: integer("pay_period_month").notNull(),
  repaymentAmount: numeric("repayment_amount", { precision: 12, scale: 2 }).notNull(), // dollars
  repaymentType: text("repayment_type").notNull().default("payroll_deduction"), // 'payroll_deduction', 'manual_payment', 'adjustment'
  notes: text("notes"),
  processedAt: timestamp("processed_at").notNull().defaultNow(),
  processedBy: text("processed_by"),
});

export const insertPayrollLoanRepaymentSchema = createInsertSchema(payrollLoanRepayments).omit({
  id: true,
  processedAt: true,
});

export type InsertPayrollLoanRepayment = z.infer<typeof insertPayrollLoanRepaymentSchema>;
export type PayrollLoanRepayment = typeof payrollLoanRepayments.$inferSelect;

// Payroll Audit Logs - tracks all changes to payroll records
export const payrollAuditLogs = appSchema.table("payroll_audit_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  payrollRecordId: varchar("payroll_record_id").notNull().references(() => payrollRecords.id),
  fieldName: text("field_name").notNull(), // Which field was changed
  oldValue: text("old_value"), // Previous value (as string for any type)
  newValue: text("new_value"), // New value (as string for any type)
  changedBy: text("changed_by").notNull(), // Admin username who made the change
  reason: text("reason"), // Optional reason for the change
  changedAt: timestamp("changed_at").notNull().defaultNow(),
});

export const insertPayrollAuditLogSchema = createInsertSchema(payrollAuditLogs).omit({
  id: true,
  changedAt: true,
});

export type InsertPayrollAuditLog = z.infer<typeof insertPayrollAuditLogSchema>;
export type PayrollAuditLog = typeof payrollAuditLogs.$inferSelect;

// Payroll Adjustments - Admin entries for OT, MC, AL, late hours, advances, claims
export const payrollAdjustments = appSchema.table("payroll_adjustments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  payPeriodYear: integer("pay_period_year").notNull(), // e.g., 2025
  payPeriodMonth: integer("pay_period_month").notNull(), // 1-12
  
  // Adjustment type
  adjustmentType: text("adjustment_type").notNull(), // 'overtime', 'mc_days', 'al_days', 'late_hours', 'advance', 'claim', 'deduction', 'bonus'
  
  // Amounts
  hours: real("hours"), // For OT, late hours
  days: real("days"), // For MC, AL days
  amount: numeric("amount", { precision: 12, scale: 2 }), // dollars - for claims, advances, fixed amounts
  rate: numeric("rate", { precision: 10, scale: 2 }), // dollars - custom rate (e.g., OT hourly rate override)
  rateMultiplier: real("rate_multiplier"), // e.g., 1.5 for OT, null to use employee's calculated rate
  
  // Descriptions
  description: text("description"), // Brief description
  notes: text("notes"), // Detailed admin notes for audit
  
  // Status
  status: text("status").notNull().default("pending"), // 'pending', 'approved', 'rejected', 'processed'
  
  // Audit trail
  createdBy: text("created_by").notNull(), // Admin who created
  createdAt: timestamp("created_at").notNull().defaultNow(),
  approvedBy: text("approved_by"), // Admin who approved
  approvedAt: timestamp("approved_at"),
  processedInPayroll: varchar("processed_in_payroll").references(() => payrollRecords.id), // Link to payroll record when processed
});

export const insertPayrollAdjustmentSchema = createInsertSchema(payrollAdjustments).omit({
  id: true,
  createdAt: true,
});

export type InsertPayrollAdjustment = z.infer<typeof insertPayrollAdjustmentSchema>;
export type PayrollAdjustment = typeof payrollAdjustments.$inferSelect;

// Payroll Adjustment Audit Logs - tracks all changes to adjustment records
export const payrollAdjustmentAuditLogs = appSchema.table("payroll_adjustment_audit_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  adjustmentId: varchar("adjustment_id").notNull().references(() => payrollAdjustments.id),
  action: text("action").notNull(), // 'create', 'update', 'approve', 'reject', 'delete'
  fieldName: text("field_name"), // Which field was changed (for updates)
  oldValue: text("old_value"),
  newValue: text("new_value"),
  notes: text("notes"), // Admin notes explaining the change
  changedBy: text("changed_by").notNull(),
  changedAt: timestamp("changed_at").notNull().defaultNow(),
});

export const insertPayrollAdjustmentAuditLogSchema = createInsertSchema(payrollAdjustmentAuditLogs).omit({
  id: true,
  changedAt: true,
});

export type InsertPayrollAdjustmentAuditLog = z.infer<typeof insertPayrollAdjustmentAuditLogSchema>;
export type PayrollAdjustmentAuditLog = typeof payrollAdjustmentAuditLogs.$inferSelect;

// Employee Salary Adjustments - Recurring additions/deductions to base salary configuration
export const employeeSalaryAdjustments = appSchema.table("employee_salary_adjustments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  adjustmentType: text("adjustment_type").notNull(), // 'addition' or 'deduction'
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(), // dollars (e.g., 50.00)
  description: text("description").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  showForEmployee: boolean("show_for_employee").notNull().default(true), // If false, hidden in employee payslip view
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertEmployeeSalaryAdjustmentSchema = createInsertSchema(employeeSalaryAdjustments).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertEmployeeSalaryAdjustment = z.infer<typeof insertEmployeeSalaryAdjustmentSchema>;
export type EmployeeSalaryAdjustment = typeof employeeSalaryAdjustments.$inferSelect;

// Employee Data Audit Logs - Track changes to employee profile fields
export const employeeDataAuditLogs = appSchema.table("employee_data_audit_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  action: text("action").notNull(), // 'create', 'update', 'archive', 'unarchive'
  fieldName: text("field_name"), // Which field was changed (for updates)
  oldValue: text("old_value"),
  newValue: text("new_value"),
  changedBy: text("changed_by").notNull(), // Admin username/name who made the change
  changedAt: timestamp("changed_at").notNull().defaultNow(),
});

export const insertEmployeeDataAuditLogSchema = createInsertSchema(employeeDataAuditLogs).omit({
  id: true,
  changedAt: true,
});

export type InsertEmployeeDataAuditLog = z.infer<typeof insertEmployeeDataAuditLogSchema>;
export type EmployeeDataAuditLog = typeof employeeDataAuditLogs.$inferSelect;

// Payroll Import Batches - Track historical payroll import sessions
export const payrollImportBatches = appSchema.table("payroll_import_batches", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  fileName: text("file_name").notNull(),
  fileHash: text("file_hash"), // SHA256 hash to detect duplicate uploads
  payPeriodYear: integer("pay_period_year").notNull(),
  payPeriodMonth: integer("pay_period_month").notNull(),
  totalRecords: integer("total_records").notNull().default(0),
  successfulRecords: integer("successful_records").notNull().default(0),
  failedRecords: integer("failed_records").notNull().default(0),
  skippedRecords: integer("skipped_records").notNull().default(0), // Duplicates skipped
  status: text("status").notNull().default("pending"), // 'pending', 'validated', 'importing', 'completed', 'failed'
  validationErrors: text("validation_errors"), // JSON string with validation errors
  importedBy: text("imported_by").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  completedAt: timestamp("completed_at"),
});

export const insertPayrollImportBatchSchema = createInsertSchema(payrollImportBatches).omit({
  id: true,
  createdAt: true,
});

export type InsertPayrollImportBatch = z.infer<typeof insertPayrollImportBatchSchema>;
export type PayrollImportBatch = typeof payrollImportBatches.$inferSelect;

// Manual Payslips - For admin-created payslips via Tools
export const manualPayslips = appSchema.table("manual_payslips", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  
  // Employee Information
  employeeName: text("employee_name").notNull(),
  employeeCode: text("employee_code"),
  nric: text("nric"),
  department: text("department"),
  designation: text("designation"),
  
  // Pay Period
  payPeriodYear: integer("pay_period_year").notNull(),
  payPeriodMonth: integer("pay_period_month").notNull(),
  payPeriodStart: text("pay_period_start"),
  payPeriodEnd: text("pay_period_end"),
  
  // Hours Worked
  regularHours: numeric("regular_hours", { precision: 10, scale: 2 }).default("0"),
  overtimeHours: numeric("overtime_hours", { precision: 10, scale: 2 }).default("0"),
  
  // Earnings
  basicSalary: numeric("basic_salary", { precision: 12, scale: 2 }).default("0"),
  hourlyRate: numeric("hourly_rate", { precision: 10, scale: 2 }).default("0"),
  regularPay: numeric("regular_pay", { precision: 12, scale: 2 }).default("0"),
  overtimePay: numeric("overtime_pay", { precision: 12, scale: 2 }).default("0"),
  
  // Allowances
  mobileAllowance: numeric("mobile_allowance", { precision: 12, scale: 2 }).default("0"),
  transportAllowance: numeric("transport_allowance", { precision: 12, scale: 2 }).default("0"),
  loanAllowance: numeric("loan_allowance", { precision: 12, scale: 2 }).default("0"),
  shiftAllowance: numeric("shift_allowance", { precision: 12, scale: 2 }).default("0"),
  otherAllowance: numeric("other_allowance", { precision: 12, scale: 2 }).default("0"),
  houseRentalAllowance: numeric("house_rental_allowance", { precision: 12, scale: 2 }).default("0"),
  bonuses: numeric("bonuses", { precision: 12, scale: 2 }).default("0"),
  
  // Deductions
  employeeCpf: numeric("employee_cpf", { precision: 12, scale: 2 }).default("0"),
  employerCpf: numeric("employer_cpf", { precision: 12, scale: 2 }).default("0"),
  loanDeduction: numeric("loan_deduction", { precision: 12, scale: 2 }).default("0"),
  otherDeductions: numeric("other_deductions", { precision: 12, scale: 2 }).default("0"),
  
  // Totals
  grossPay: numeric("gross_pay", { precision: 12, scale: 2 }).default("0"),
  totalDeductions: numeric("total_deductions", { precision: 12, scale: 2 }).default("0"),
  netPay: numeric("net_pay", { precision: 12, scale: 2 }).default("0"),
  
  // Remarks
  remarks: text("remarks"),
  
  // Audit
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedBy: text("updated_by"),
  updatedAt: timestamp("updated_at"),
});

export const insertManualPayslipSchema = createInsertSchema(manualPayslips).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertManualPayslip = z.infer<typeof insertManualPayslipSchema>;
export type ManualPayslip = typeof manualPayslips.$inferSelect;

// Manual Payslip Audit Logs
export const manualPayslipAuditLogs = appSchema.table("manual_payslip_audit_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  payslipId: varchar("payslip_id").notNull().references(() => manualPayslips.id),
  action: text("action").notNull(), // 'create', 'update', 'delete', 'pdf_export'
  fieldName: text("field_name"),
  oldValue: text("old_value"),
  newValue: text("new_value"),
  details: text("details"), // JSON for additional info
  changedBy: text("changed_by").notNull(),
  changedAt: timestamp("changed_at").notNull().defaultNow(),
});

export const insertManualPayslipAuditLogSchema = createInsertSchema(manualPayslipAuditLogs).omit({
  id: true,
  changedAt: true,
});

export type InsertManualPayslipAuditLog = z.infer<typeof insertManualPayslipAuditLogSchema>;
export type ManualPayslipAuditLog = typeof manualPayslipAuditLogs.$inferSelect;

// Claims System
export const claimTypes = ["transport", "material_purchase", "other", "overtime", "ot_timesheet"] as const;
export type ClaimType = typeof claimTypes[number];

export const claimTypeLabels: Record<ClaimType, string> = {
  transport: "Transport",
  material_purchase: "Material Purchase",
  other: "Other",
  overtime: "Overtime",
  ot_timesheet: "OT Timesheet (Monthly)",
};

export type TimesheetRow = {
  date: string;          // "DD/MM/YYYY"
  dayName: string;       // "MON", "TUE", etc.
  customerName: string;
  projectNumber: string;
  timeIn: string;        // "HH:mm" 24h
  timeOut: string;       // "HH:mm"
  hours1_5: number;
  hours2: number;
};

export const claims = appSchema.table("claims", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(), // Employee who submitted the claim
  employeeCode: text("employee_code"), // Denormalized for quick reference
  employeeName: text("employee_name"), // Denormalized for quick reference
  claimType: text("claim_type").notNull(), // 'transport', 'material_purchase', 'other', 'overtime'
  amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
  description: text("description"), // Optional description of the claim
  receiptUrl: text("receipt_url"), // URL to uploaded receipt file
  receiptFileName: text("receipt_file_name"), // Original file name
  status: text("status").notNull().default("pending"), // 'pending', 'approved', 'rejected', 'processed'
  reviewedBy: varchar("reviewed_by"), // Admin who reviewed (no FK for flexibility)
  reviewedAt: timestamp("reviewed_at"),
  reviewComments: text("review_comments"),
  submittedAt: timestamp("submitted_at").notNull().defaultNow(),
  claimMonth: integer("claim_month").notNull(), // Month the claim is for (1-12)
  claimYear: integer("claim_year").notNull(), // Year the claim is for
  // OT-specific fields
  workDate: text("work_date"), // Date of OT work (YYYY-MM-DD)
  hours1_5: numeric("hours_1_5", { precision: 4, scale: 2 }), // 1.5x OT hours
  hours2: numeric("hours_2", { precision: 4, scale: 2 }), // 2x OT hours
  calculatedAmount: numeric("calculated_amount", { precision: 10, scale: 2 }), // Server-computed OT pay (never sent to employee)
  otFiles: text("ot_files"), // JSON array of {url, name} for multiple proof files
  // OT Timesheet (Monthly) specific fields
  timesheetRows: text("timesheet_rows"), // JSON string of TimesheetRow[]
  totalHours1_5: numeric("total_hours_1_5", { precision: 6, scale: 2 }), // Sum of 1.5x hours across all rows
  totalHours2: numeric("total_hours_2", { precision: 6, scale: 2 }),     // Sum of 2x hours across all rows
});

export const insertClaimSchema = createInsertSchema(claims).omit({
  id: true,
  submittedAt: true,
});

export type InsertClaim = z.infer<typeof insertClaimSchema>;
export type Claim = typeof claims.$inferSelect;

// Claims Audit Log - tracks all changes to claims (approvals, rejections, deletions)
export const claimsAuditLog = appSchema.table("claims_audit_log", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  claimId: varchar("claim_id").notNull(), // Original claim ID (may not exist if deleted)
  userId: varchar("user_id").notNull(), // Employee who submitted the claim
  employeeCode: text("employee_code"),
  employeeName: text("employee_name"),
  claimType: text("claim_type").notNull(),
  amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
  description: text("description"),
  claimMonth: integer("claim_month").notNull(),
  claimYear: integer("claim_year").notNull(),
  action: text("action").notNull(), // 'approved', 'rejected', 'deleted'
  previousStatus: text("previous_status"), // Status before the action
  performedBy: varchar("performed_by").notNull(), // Can be user ID or "admin" for master admin
  performedByName: text("performed_by_name"),
  comments: text("comments"), // Optional reason/comments for the action
  performedAt: timestamp("performed_at").notNull().defaultNow(),
});

export type ClaimsAuditLog = typeof claimsAuditLog.$inferSelect;

export const employeeDeletionLogs = appSchema.table("employee_deletion_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  employeeId: varchar("employee_id").notNull(),
  employeeCode: text("employee_code"),
  employeeName: text("employee_name").notNull(),
  email: text("email"),
  department: text("department"),
  designation: text("designation"),
  section: text("section"),
  role: text("role"),
  joinDate: text("join_date"),
  resignDate: text("resign_date"),
  residencyStatus: text("residency_status"),
  basicMonthlySalary: text("basic_monthly_salary"),
  nricFin: text("nric_fin"),
  mobileNumber: text("mobile_number"),
  fullSnapshot: text("full_snapshot"),
  deletedBy: text("deleted_by").notNull(),
  deletedByName: text("deleted_by_name"),
  reason: text("reason"),
  deletedAt: timestamp("deleted_at").notNull().defaultNow(),
});

export type EmployeeDeletionLog = typeof employeeDeletionLogs.$inferSelect;
