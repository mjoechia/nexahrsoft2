import { type User, type InsertUser, type CompanySettings, type AttendanceRecord, type InsertAttendanceRecord, type UserSession, type InsertUserSession, type LoginChallenge, type InsertLoginChallenge, type PayslipRecord, type InsertPayslipRecord, type LeaveBalance, type InsertLeaveBalance, type LeaveApplication, type InsertLeaveApplication, type EmailLog, type InsertEmailLog, type AuditLog, type InsertAuditLog, type PasswordOverrideLog, type InsertPasswordOverrideLog, type PayrollRecord, type InsertPayrollRecord, type LeaveHistory, type InsertLeaveHistory, type LeaveAuditLog, type InsertLeaveAuditLog, type PayrollLoanAccount, type InsertPayrollLoanAccount, type PayrollLoanRepayment, type InsertPayrollLoanRepayment, type PayrollAuditLog, type InsertPayrollAuditLog, type DailyAttendanceSummary, type InsertDailyAttendanceSummary, type PayrollAdjustment, type InsertPayrollAdjustment, type PayrollAdjustmentAuditLog, type InsertPayrollAdjustmentAuditLog, type EmployeeSalaryAdjustment, type InsertEmployeeSalaryAdjustment, type AttendanceAdjustment, type InsertAttendanceAdjustment, type EmployeeMonthlyRemark, type InsertEmployeeMonthlyRemark, type EmployeeDataAuditLog, type InsertEmployeeDataAuditLog, type PayrollImportBatch, type InsertPayrollImportBatch, type ManualPayslip, type InsertManualPayslip, type ManualPayslipAuditLog, type InsertManualPayslipAuditLog, type Claim, type InsertClaim, type EmployeeDocument, type InsertEmployeeDocument } from "@shared/schema";
import { randomUUID } from "crypto";
import { db } from "./db";
import { users, companySettings, attendanceRecords, userSessions, loginChallenges, payslipRecords, leaveBalances, leaveApplications, emailLogs, auditLogs, passwordOverrideLogs, payrollRecords, leaveHistory, leaveAuditLogs, payrollLoanAccounts, payrollLoanRepayments, payrollAuditLogs, dailyAttendanceSummary, payrollAdjustments, payrollAdjustmentAuditLogs, employeeSalaryAdjustments, attendanceAdjustments, employeeMonthlyRemarks, employeeDataAuditLogs, payrollImportBatches, manualPayslips, manualPayslipAuditLogs, claims, claimsAuditLog, employeeDocuments, announcements, leaveTypesTable, employeeLeaveAccrualOverrides, leaveAccrualRuns, leaveBalanceTransactions } from "@shared/schema";
import type { Announcement, InsertAnnouncement, LeaveTypeRow, InsertLeaveType, EmployeeLeaveAccrualOverride, InsertEmployeeLeaveAccrualOverride, LeaveAccrualRun, LeaveBalanceTransaction } from "@shared/schema";
import { eq, or, and, gte, lte, lt, desc, asc, isNull, not, like, sql, inArray } from "drizzle-orm";

// modify the interface with any CRUD methods
// you might need

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  getUserByEmailOrUsername(emailOrUsername: string, username: string): Promise<User | undefined>;
  getUserByAuthId(authId: string): Promise<User | undefined>;
  createUser(user: Partial<User>): Promise<User>;
  getAllUsers(): Promise<User[]>;
  approveUser(id: string): Promise<User | undefined>;
  getCompanySettings(): Promise<CompanySettings>;
  updateCompanySettings(settings: Partial<CompanySettings>): Promise<CompanySettings>;
  
  // Attendance methods
  createAttendanceRecord(record: InsertAttendanceRecord): Promise<AttendanceRecord>;
  getAttendanceRecord(id: string): Promise<AttendanceRecord | undefined>;
  updateAttendanceRecord(id: string, updates: Partial<AttendanceRecord>): Promise<AttendanceRecord | undefined>;
  deleteAttendanceRecord(id: string): Promise<void>;
  getTodayAttendanceRecord(userId: string, date: string): Promise<AttendanceRecord | undefined>;
  getOpenAttendanceRecord(userId: string): Promise<AttendanceRecord | undefined>;
  getOrphanedAttendanceSessions(): Promise<AttendanceRecord[]>;
  getAttendanceRecordsByUserAndDateRange(userId: string, startDate: string, endDate: string): Promise<AttendanceRecord[]>;
  getAllUsersAttendanceByDateRange(startDate: string, endDate: string): Promise<AttendanceRecord[]>;
  getAllAttendanceRecords(): Promise<AttendanceRecord[]>;
  
  // Daily attendance summary methods (pre-calculated for heatmap)
  upsertDailyAttendanceSummary(summary: InsertDailyAttendanceSummary): Promise<DailyAttendanceSummary>;
  getDailyAttendanceSummaries(startDate: string, endDate: string, limit?: number): Promise<DailyAttendanceSummary[]>;
  recalculateDailyAttendanceSummary(date: string, userId: string): Promise<DailyAttendanceSummary | null>;
  recalculateAllSummariesForDate(date: string): Promise<{ processed: number; errors: number; deleted: number }>;
  
  // Attendance adjustment methods (leave/OT override)
  createAttendanceAdjustment(adjustment: InsertAttendanceAdjustment): Promise<AttendanceAdjustment>;
  getAttendanceAdjustment(userId: string, date: string): Promise<AttendanceAdjustment | undefined>;
  getAttendanceAdjustmentById(id: string): Promise<AttendanceAdjustment | undefined>;
  updateAttendanceAdjustment(id: string, updates: Partial<AttendanceAdjustment>): Promise<AttendanceAdjustment | undefined>;
  deleteAttendanceAdjustment(id: string): Promise<void>;
  getAttendanceAdjustmentsByDateRange(startDate: string, endDate: string): Promise<AttendanceAdjustment[]>;
  
  // Employee monthly remarks methods
  upsertEmployeeMonthlyRemark(remark: InsertEmployeeMonthlyRemark): Promise<EmployeeMonthlyRemark>;
  getEmployeeMonthlyRemarks(year: number, month: number): Promise<EmployeeMonthlyRemark[]>;
  getEmployeeMonthlyRemark(userId: string, year: number, month: number): Promise<EmployeeMonthlyRemark | undefined>;
  
  // Session tracking methods
  createUserSession(session: InsertUserSession): Promise<UserSession>;
  getActiveSessions(userId: string): Promise<UserSession[]>;
  getAllLoginHistory(limit?: number): Promise<Array<UserSession & { userName: string; userEmail: string; userDepartment: string | null }>>;
  revokeSession(sessionId: string): Promise<void>;
  revokeAllUserSessions(userId: string, exceptSessionId?: string): Promise<void>;
  updateSessionLastSeen(sessionId: string): Promise<void>;
  
  // Login challenge methods
  createLoginChallenge(challenge: InsertLoginChallenge): Promise<LoginChallenge>;
  getLoginChallenge(challengeToken: string): Promise<LoginChallenge | undefined>;
  useLoginChallenge(challengeId: string): Promise<void>;
  cleanupExpiredChallenges(): Promise<void>;
  
  // Payslip methods
  createPayslip(payslip: InsertPayslipRecord): Promise<PayslipRecord>;
  updatePayslip(id: string, updates: Partial<PayslipRecord>): Promise<PayslipRecord | undefined>;
  getPayslipById(id: string): Promise<PayslipRecord | undefined>;
  getPayslipsByUser(userId: string): Promise<PayslipRecord[]>;
  getApprovedPayslipsByUser(userId: string): Promise<PayslipRecord[]>;
  getAllPayslips(): Promise<PayslipRecord[]>;
  
  // Leave management methods
  createOrUpdateLeaveBalance(balance: InsertLeaveBalance): Promise<LeaveBalance>;
  getLeaveBalance(userId: string, leaveType: string, year: number): Promise<LeaveBalance | undefined>;
  getUserLeaveBalances(userId: string, year: number): Promise<LeaveBalance[]>;
  getAllLeaveBalances(year?: number): Promise<LeaveBalance[]>;
  updateLeaveBalanceTaken(id: string, taken: string, balance: string): Promise<LeaveBalance | undefined>;
  
  createLeaveApplication(application: InsertLeaveApplication): Promise<LeaveApplication>;
  updateLeaveApplication(id: string, updates: Partial<LeaveApplication>): Promise<LeaveApplication | undefined>;
  getLeaveApplicationById(id: string): Promise<LeaveApplication | undefined>;
  getUserLeaveApplications(userId: string): Promise<LeaveApplication[]>;
  getAllLeaveApplications(): Promise<LeaveApplication[]>;
  getPendingLeaveApplications(): Promise<LeaveApplication[]>;
  
  // User update methods
  updateUser(id: string, updates: Partial<User>): Promise<User | undefined>;
  bulkCreateUsers(usersData: Partial<User>[]): Promise<User[]>;
  getUserByEmployeeCode(employeeCode: string): Promise<User | undefined>;
  getUserByName(name: string): Promise<User | undefined>;
  getAdminUsers(): Promise<User[]>;
  
  // Email log methods
  createEmailLog(log: InsertEmailLog): Promise<EmailLog>;
  updateEmailLog(id: string, updates: Partial<EmailLog>): Promise<EmailLog | undefined>;
  getEmailLogsByUser(userId: string): Promise<EmailLog[]>;
  getAllEmailLogs(): Promise<EmailLog[]>;
  
  // Audit log methods
  createAuditLog(log: InsertAuditLog): Promise<AuditLog>;
  getAuditLogsByUser(userId: string): Promise<AuditLog[]>;
  getAuditLogsByFieldPrefix(fieldPrefix: string): Promise<AuditLog[]>;
  getAllAuditLogs(): Promise<AuditLog[]>;
  
  // Employee payroll settings update with audit logging
  updateEmployeePayrollSettings(
    userId: string,
    updates: Partial<User>,
    changedBy: string
  ): Promise<{ user: User | undefined; auditLogs: AuditLog[] }>;
  
  // Password override log methods
  createPasswordOverrideLog(log: InsertPasswordOverrideLog): Promise<PasswordOverrideLog>;
  getPasswordOverrideLogsByUser(userId: string): Promise<PasswordOverrideLog[]>;
  getAllPasswordOverrideLogs(): Promise<PasswordOverrideLog[]>;
  
  // Payroll record methods (CSV import)
  createPayrollRecord(record: InsertPayrollRecord): Promise<PayrollRecord>;
  bulkCreatePayrollRecords(records: InsertPayrollRecord[]): Promise<PayrollRecord[]>;
  getPayrollRecords(year?: number, month?: number): Promise<PayrollRecord[]>;
  getPayrollRecordsByEmployee(employeeCode: string): Promise<PayrollRecord[]>;
  getPayrollRecordsByUserId(userId: string): Promise<PayrollRecord[]>;
  getEmployeeViewablePayrollRecords(userId: string): Promise<PayrollRecord[]>;
  getPayrollRecordById(id: string): Promise<PayrollRecord | undefined>;
  updatePayrollRecord(id: string, updates: Partial<PayrollRecord>): Promise<PayrollRecord | undefined>;
  deletePayrollRecordsByPeriod(year: number, month: number): Promise<void>;
  searchPayrollRecords(year?: number, month?: number, employeeName?: string): Promise<PayrollRecord[]>;
  
  // Payroll audit log methods
  createPayrollAuditLog(log: InsertPayrollAuditLog): Promise<PayrollAuditLog>;
  getPayrollAuditLogsByRecord(payrollRecordId: string): Promise<PayrollAuditLog[]>;
  
  // Leave history methods (CSV import)
  bulkCreateLeaveHistory(records: InsertLeaveHistory[]): Promise<LeaveHistory[]>;
  getLeaveHistory(year?: number): Promise<LeaveHistory[]>;
  getLeaveHistoryById(id: string): Promise<LeaveHistory | undefined>;
  getLeaveHistoryByEmployee(employeeCode: string): Promise<LeaveHistory[]>;
  updateLeaveHistory(id: string, updates: Partial<LeaveHistory>): Promise<LeaveHistory | undefined>;
  deleteLeaveHistory(id: string): Promise<void>;
  deleteLeaveHistoryByYear(year: number): Promise<void>;
  getLeaveHistoryStats(year: number): Promise<{ leaveType: string; totalDays: number; count: number }[]>;
  
  // Leave audit log methods
  createLeaveAuditLog(log: InsertLeaveAuditLog): Promise<LeaveAuditLog>;
  getLeaveAuditLogs(limit?: number): Promise<LeaveAuditLog[]>;
  
  // Payroll Loan methods
  createPayrollLoanAccount(loan: InsertPayrollLoanAccount): Promise<PayrollLoanAccount>;
  updatePayrollLoanAccount(id: string, updates: Partial<PayrollLoanAccount>): Promise<PayrollLoanAccount | undefined>;
  getPayrollLoanAccount(id: string): Promise<PayrollLoanAccount | undefined>;
  getPayrollLoanAccountsByEmployee(employeeCode: string): Promise<PayrollLoanAccount[]>;
  getActivePayrollLoans(): Promise<PayrollLoanAccount[]>;
  getAllPayrollLoanAccounts(): Promise<PayrollLoanAccount[]>;
  
  // Payroll Loan Repayment methods
  createPayrollLoanRepayment(repayment: InsertPayrollLoanRepayment): Promise<PayrollLoanRepayment>;
  getLoanRepaymentsByLoan(loanAccountId: string): Promise<PayrollLoanRepayment[]>;
  getLoanRepaymentsByPeriod(year: number, month: number): Promise<PayrollLoanRepayment[]>;
  getEmployeeLoanRepaymentsForPeriod(employeeCode: string, year: number, month: number): Promise<PayrollLoanRepayment[]>;
  
  // Archive methods
  archiveUsers(userIds: string[]): Promise<void>;
  unarchiveUsers(userIds: string[]): Promise<void>;
  getArchivedUsers(): Promise<User[]>;
  
  // Payroll Adjustment methods
  createPayrollAdjustment(adjustment: InsertPayrollAdjustment): Promise<PayrollAdjustment>;
  updatePayrollAdjustment(id: string, updates: Partial<PayrollAdjustment>): Promise<PayrollAdjustment | undefined>;
  getPayrollAdjustment(id: string): Promise<PayrollAdjustment | undefined>;
  getPayrollAdjustmentsByEmployee(userId: string, year?: number, month?: number): Promise<PayrollAdjustment[]>;
  getPayrollAdjustmentsByPeriod(year: number, month: number): Promise<PayrollAdjustment[]>;
  deletePayrollAdjustment(id: string): Promise<void>;
  
  // Payroll Adjustment Audit Log methods
  createPayrollAdjustmentAuditLog(log: InsertPayrollAdjustmentAuditLog): Promise<PayrollAdjustmentAuditLog>;
  getPayrollAdjustmentAuditLogs(adjustmentId: string): Promise<PayrollAdjustmentAuditLog[]>;
  
  // Employee Salary Adjustments
  getEmployeeSalaryAdjustments(userId: string): Promise<EmployeeSalaryAdjustment[]>;
  createEmployeeSalaryAdjustment(adjustment: InsertEmployeeSalaryAdjustment): Promise<EmployeeSalaryAdjustment>;
  updateEmployeeSalaryAdjustment(id: string, updates: Partial<EmployeeSalaryAdjustment>): Promise<EmployeeSalaryAdjustment | undefined>;
  deleteEmployeeSalaryAdjustment(id: string): Promise<boolean>;
  
  // Employee Data Audit Log methods
  createEmployeeDataAuditLog(log: InsertEmployeeDataAuditLog): Promise<EmployeeDataAuditLog>;
  getEmployeeDataAuditLogs(userId: string): Promise<EmployeeDataAuditLog[]>;
  getAllEmployeeDataAuditLogs(limit?: number): Promise<EmployeeDataAuditLog[]>;
  
  // Payroll Import Batch methods
  createPayrollImportBatch(batch: InsertPayrollImportBatch): Promise<PayrollImportBatch>;
  updatePayrollImportBatch(id: string, updates: Partial<PayrollImportBatch>): Promise<PayrollImportBatch | undefined>;
  getPayrollImportBatch(id: string): Promise<PayrollImportBatch | undefined>;
  getPayrollImportBatches(): Promise<PayrollImportBatch[]>;
  getPayrollImportBatchByPeriod(year: number, month: number): Promise<PayrollImportBatch | undefined>;
  checkDuplicatePayrollRecord(employeeCode: string, year: number, month: number): Promise<boolean>;
  
  // Claims methods
  createClaim(claim: InsertClaim): Promise<Claim>;
  updateClaim(id: string, updates: Partial<Claim>): Promise<Claim | undefined>;
  getClaim(id: string): Promise<Claim | undefined>;
  getClaimsByUser(userId: string): Promise<Claim[]>;
  getAllClaims(): Promise<Claim[]>;
  getClaimsByPeriod(year: number, month: number): Promise<Claim[]>;
  getPendingClaimsCount(): Promise<number>;
  getApprovedClaimsForPayslip(userId: string, year: number, month: number): Promise<Claim[]>;
  deleteClaim(id: string): Promise<void>;
  createClaimsAuditLog(log: {
    claimId: string;
    userId: string;
    employeeCode: string | null;
    employeeName: string | null;
    claimType: string;
    amount: string;
    description: string | null;
    claimMonth: number;
    claimYear: number;
    action: string;
    previousStatus: string | null;
    performedBy: string;
    performedByName: string | null;
    comments: string | null;
  }): Promise<void>;
  getClaimsAuditLogs(month?: number, year?: number): Promise<any[]>;
  
  // Employee document methods
  createEmployeeDocument(doc: InsertEmployeeDocument): Promise<EmployeeDocument>;
  getEmployeeDocuments(userId: string): Promise<EmployeeDocument[]>;
  getEmployeeDocument(id: string): Promise<EmployeeDocument | undefined>;
  deleteEmployeeDocument(id: string): Promise<void>;
}

export class MemStorage implements IStorage {
  private users: Map<string, User>;
  private companySettings: CompanySettings;

  constructor() {
    this.users = new Map();
    this.companySettings = {
      id: randomUUID(),
      companyName: "NexaHR",
      companyAddress: null,
      companyUen: null,
      logoUrl: null,
      clockInLogoUrl: null,
      faviconUrl: null,
      attendanceBufferMinutes: 15,
      defaultTimezone: "Asia/Singapore",
      updatedAt: new Date(),
      senderEmail: null,
      senderName: null,
      appUrl: "https://app.nexahrms.com",
      ignoreOrphanedSessions: false,
      regularHoursPerDay: 8,
      regularDaysPerWeek: 5,
      otMultiplier15: 1.5,
      otMultiplier20: 2.0,
    };
  }
  
  // Stub implementations for methods not used in production MemStorage
  async createPayrollImportBatch(batch: InsertPayrollImportBatch): Promise<PayrollImportBatch> { throw new Error("Not implemented in MemStorage"); }
  async updatePayrollImportBatch(id: string, updates: Partial<PayrollImportBatch>): Promise<PayrollImportBatch | undefined> { throw new Error("Not implemented in MemStorage"); }
  async getPayrollImportBatch(id: string): Promise<PayrollImportBatch | undefined> { return undefined; }
  async getPayrollImportBatches(): Promise<PayrollImportBatch[]> { return []; }
  async getPayrollImportBatchByPeriod(year: number, month: number): Promise<PayrollImportBatch | undefined> { return undefined; }
  async createEmployeeDocument(doc: InsertEmployeeDocument): Promise<EmployeeDocument> { throw new Error("Not implemented in MemStorage"); }
  async getEmployeeDocuments(userId: string): Promise<EmployeeDocument[]> { return []; }
  async getEmployeeDocument(id: string): Promise<EmployeeDocument | undefined> { return undefined; }
  async deleteEmployeeDocument(id: string): Promise<void> { }
  async checkDuplicatePayrollRecord(employeeCode: string, year: number, month: number): Promise<boolean> { return false; }
  async deleteClaim(id: string): Promise<void> { }
  async createClaimsAuditLog(log: any): Promise<any> { throw new Error("Not implemented in MemStorage"); }
  async getClaimsAuditLogs(month?: number, year?: number): Promise<any[]> { return []; }

  // Stub implementations for loan methods (MemStorage not used in production)
  async createPayrollLoanAccount(loan: InsertPayrollLoanAccount): Promise<PayrollLoanAccount> {
    throw new Error("Not implemented in MemStorage");
  }
  async updatePayrollLoanAccount(id: string, updates: Partial<PayrollLoanAccount>): Promise<PayrollLoanAccount | undefined> {
    throw new Error("Not implemented in MemStorage");
  }
  async getPayrollLoanAccount(id: string): Promise<PayrollLoanAccount | undefined> {
    return undefined;
  }
  async getPayrollLoanAccountsByEmployee(employeeCode: string): Promise<PayrollLoanAccount[]> {
    return [];
  }
  async getActivePayrollLoans(): Promise<PayrollLoanAccount[]> {
    return [];
  }
  async getAllPayrollLoanAccounts(): Promise<PayrollLoanAccount[]> {
    return [];
  }
  async createPayrollLoanRepayment(repayment: InsertPayrollLoanRepayment): Promise<PayrollLoanRepayment> {
    throw new Error("Not implemented in MemStorage");
  }
  async getLoanRepaymentsByLoan(loanAccountId: string): Promise<PayrollLoanRepayment[]> {
    return [];
  }
  async getLoanRepaymentsByPeriod(year: number, month: number): Promise<PayrollLoanRepayment[]> {
    return [];
  }
  async getEmployeeLoanRepaymentsForPeriod(employeeCode: string, year: number, month: number): Promise<PayrollLoanRepayment[]> {
    return [];
  }
  
  // Archive stubs (MemStorage not used in production)
  async archiveUsers(userIds: string[]): Promise<void> {
    throw new Error("Not implemented in MemStorage");
  }
  async unarchiveUsers(userIds: string[]): Promise<void> {
    throw new Error("Not implemented in MemStorage");
  }
  async getArchivedUsers(): Promise<User[]> {
    return [];
  }

  async getUser(id: string): Promise<User | undefined> {
    return this.users.get(id);
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(
      (user) => user.email === email,
    );
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(
      (user) => user.username === username,
    );
  }

  async getUserByEmailOrUsername(emailOrUsername: string, username: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(
      (user) => user.email === emailOrUsername || user.username === username,
    );
  }

  async getUserByAuthId(authId: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(
      (user) => user.authId === authId,
    );
  }

  async createUser(insertUser: Partial<User>): Promise<User> {
    const id = randomUUID();
    const user = {
      id,
      name: insertUser.name!,
      email: insertUser.email!,
      username: insertUser.username ?? null,
      passwordHash: insertUser.passwordHash ?? null,
      mobileNumber: insertUser.mobileNumber ?? null,
      authId: insertUser.authId ?? null,
      role: insertUser.role ?? "user",
      isApproved: insertUser.isApproved ?? true,
      createdAt: new Date(),
      employeeCode: insertUser.employeeCode ?? null,
      shortName: insertUser.shortName ?? null,
      nricFin: insertUser.nricFin ?? null,
      gender: insertUser.gender ?? null,
      department: insertUser.department ?? null,
      section: insertUser.section ?? null,
      designation: insertUser.designation ?? null,
      fingerId: insertUser.fingerId ?? null,
      joinDate: insertUser.joinDate ?? null,
      resignDate: insertUser.resignDate ?? null,
      welcomeEmailSentAt: insertUser.welcomeEmailSentAt ?? null,
      mustChangePassword: insertUser.mustChangePassword ?? false,
      isArchived: insertUser.isArchived ?? false,
      birthDate: insertUser.birthDate ?? null,
      residencyStatus: insertUser.residencyStatus ?? null,
      sprStartDate: insertUser.sprStartDate ?? null,
      basicMonthlySalary: insertUser.basicMonthlySalary ?? null,
      hourlyRate: insertUser.hourlyRate ?? null,
      dailyRate: insertUser.dailyRate ?? null,
      payType: insertUser.payType ?? null,
      regularHoursPerDay: insertUser.regularHoursPerDay ?? 8,
      regularDaysPerWeek: insertUser.regularDaysPerWeek ?? null,
      defaultMobileAllowance: String(insertUser.defaultMobileAllowance ?? 0),
      defaultTransportAllowance: String(insertUser.defaultTransportAllowance ?? 0),
      defaultMealAllowance: String(insertUser.defaultMealAllowance ?? 0),
      defaultShiftAllowance: String(insertUser.defaultShiftAllowance ?? 0),
      defaultOtherAllowance: String(insertUser.defaultOtherAllowance ?? 0),
      defaultHouseRentalAllowance: String(insertUser.defaultHouseRentalAllowance ?? 0),
      salaryAdjustment: String(insertUser.salaryAdjustment ?? 0),
      salaryAdjustmentReason: insertUser.salaryAdjustmentReason ?? null,
      weeklyContractHours: insertUser.weeklyContractHours ?? 44,
      ot15Rate: insertUser.ot15Rate ?? null,
      ot20Rate: insertUser.ot20Rate ?? null,
      birthday: insertUser.birthday ?? null,
      employeeType: insertUser.employeeType ?? null,
      ethnicity: insertUser.ethnicity ?? null,
      religion: insertUser.religion ?? null,
      shgOptOut: insertUser.shgOptOut ?? false,
    } as User;
    this.users.set(id, user);
    return user;
  }

  async getAllUsers(): Promise<User[]> {
    return Array.from(this.users.values());
  }

  async approveUser(id: string): Promise<User | undefined> {
    const user = this.users.get(id);
    if (user) {
      const updatedUser = { ...user, isApproved: true };
      this.users.set(id, updatedUser);
      return updatedUser;
    }
    return undefined;
  }

  async getCompanySettings(): Promise<CompanySettings> {
    return this.companySettings;
  }

  async updateCompanySettings(settings: Partial<CompanySettings>): Promise<CompanySettings> {
    this.companySettings = {
      ...this.companySettings,
      ...settings,
      updatedAt: new Date(),
    };
    return this.companySettings;
  }

  // Attendance methods - stub implementations for MemStorage
  async createAttendanceRecord(record: InsertAttendanceRecord): Promise<AttendanceRecord> {
    throw new Error("MemStorage attendance not implemented");
  }

  async getAttendanceRecord(id: string): Promise<AttendanceRecord | undefined> {
    throw new Error("MemStorage attendance not implemented");
  }

  async updateAttendanceRecord(id: string, updates: Partial<AttendanceRecord>): Promise<AttendanceRecord | undefined> {
    throw new Error("MemStorage attendance not implemented");
  }

  async deleteAttendanceRecord(id: string): Promise<void> {
    throw new Error("MemStorage attendance not implemented");
  }

  async getTodayAttendanceRecord(userId: string, date: string): Promise<AttendanceRecord | undefined> {
    throw new Error("MemStorage attendance not implemented");
  }

  async getOpenAttendanceRecord(userId: string): Promise<AttendanceRecord | undefined> {
    throw new Error("MemStorage attendance not implemented");
  }

  async getOrphanedAttendanceSessions(): Promise<AttendanceRecord[]> {
    throw new Error("MemStorage attendance not implemented");
  }

  async getAttendanceRecordsByUserAndDateRange(userId: string, startDate: string, endDate: string): Promise<AttendanceRecord[]> {
    throw new Error("MemStorage attendance not implemented");
  }

  async getAllUsersAttendanceByDateRange(startDate: string, endDate: string): Promise<AttendanceRecord[]> {
    throw new Error("MemStorage attendance not implemented");
  }

  async getAllAttendanceRecords(): Promise<AttendanceRecord[]> {
    throw new Error("MemStorage attendance not implemented");
  }

  // Daily attendance summary methods - stub implementations
  async upsertDailyAttendanceSummary(summary: InsertDailyAttendanceSummary): Promise<DailyAttendanceSummary> {
    throw new Error("MemStorage daily summary not implemented");
  }

  async getDailyAttendanceSummaries(startDate: string, endDate: string, limit?: number): Promise<DailyAttendanceSummary[]> {
    throw new Error("MemStorage daily summary not implemented");
  }

  async recalculateDailyAttendanceSummary(date: string, userId: string): Promise<DailyAttendanceSummary | null> {
    throw new Error("MemStorage daily summary not implemented");
  }

  async recalculateAllSummariesForDate(date: string): Promise<{ processed: number; errors: number; deleted: number }> {
    throw new Error("MemStorage daily summary not implemented");
  }

  // Attendance adjustment methods - stub implementations
  async createAttendanceAdjustment(adjustment: InsertAttendanceAdjustment): Promise<AttendanceAdjustment> {
    throw new Error("MemStorage attendance adjustment not implemented");
  }

  async getAttendanceAdjustment(userId: string, date: string): Promise<AttendanceAdjustment | undefined> {
    throw new Error("MemStorage attendance adjustment not implemented");
  }

  async getAttendanceAdjustmentById(id: string): Promise<AttendanceAdjustment | undefined> {
    throw new Error("MemStorage attendance adjustment not implemented");
  }

  async updateAttendanceAdjustment(id: string, updates: Partial<AttendanceAdjustment>): Promise<AttendanceAdjustment | undefined> {
    throw new Error("MemStorage attendance adjustment not implemented");
  }

  async deleteAttendanceAdjustment(id: string): Promise<void> {
    throw new Error("MemStorage attendance adjustment not implemented");
  }

  async getAttendanceAdjustmentsByDateRange(startDate: string, endDate: string): Promise<AttendanceAdjustment[]> {
    throw new Error("MemStorage attendance adjustment not implemented");
  }

  // Employee monthly remarks - stub implementations
  async upsertEmployeeMonthlyRemark(remark: InsertEmployeeMonthlyRemark): Promise<EmployeeMonthlyRemark> {
    throw new Error("MemStorage employee monthly remark not implemented");
  }

  async getEmployeeMonthlyRemarks(year: number, month: number): Promise<EmployeeMonthlyRemark[]> {
    throw new Error("MemStorage employee monthly remark not implemented");
  }

  async getEmployeeMonthlyRemark(userId: string, year: number, month: number): Promise<EmployeeMonthlyRemark | undefined> {
    throw new Error("MemStorage employee monthly remark not implemented");
  }

  // Session tracking methods - stub implementations for MemStorage
  async createUserSession(session: InsertUserSession): Promise<UserSession> {
    throw new Error("MemStorage session tracking not implemented");
  }

  async getActiveSessions(userId: string): Promise<UserSession[]> {
    throw new Error("MemStorage session tracking not implemented");
  }

  async getAllLoginHistory(_limit = 100): Promise<Array<UserSession & { userName: string; userEmail: string; userDepartment: string | null }>> {
    throw new Error("MemStorage session tracking not implemented");
  }

  async revokeSession(sessionId: string): Promise<void> {
    throw new Error("MemStorage session tracking not implemented");
  }

  async revokeAllUserSessions(userId: string, exceptSessionId?: string): Promise<void> {
    throw new Error("MemStorage session tracking not implemented");
  }

  async updateSessionLastSeen(sessionId: string): Promise<void> {
    throw new Error("MemStorage session tracking not implemented");
  }

  async createLoginChallenge(challenge: InsertLoginChallenge): Promise<LoginChallenge> {
    throw new Error("MemStorage login challenge not implemented");
  }

  async getLoginChallenge(challengeToken: string): Promise<LoginChallenge | undefined> {
    throw new Error("MemStorage login challenge not implemented");
  }

  async useLoginChallenge(challengeId: string): Promise<void> {
    throw new Error("MemStorage login challenge not implemented");
  }

  async cleanupExpiredChallenges(): Promise<void> {
    throw new Error("MemStorage login challenge not implemented");
  }

  // Payslip methods - stub implementations
  async createPayslip(payslip: InsertPayslipRecord): Promise<PayslipRecord> {
    throw new Error("MemStorage payslip not implemented");
  }

  async updatePayslip(id: string, updates: Partial<PayslipRecord>): Promise<PayslipRecord | undefined> {
    throw new Error("MemStorage payslip not implemented");
  }

  async getPayslipById(id: string): Promise<PayslipRecord | undefined> {
    throw new Error("MemStorage payslip not implemented");
  }

  async getPayslipsByUser(userId: string): Promise<PayslipRecord[]> {
    throw new Error("MemStorage payslip not implemented");
  }

  async getApprovedPayslipsByUser(userId: string): Promise<PayslipRecord[]> {
    throw new Error("MemStorage payslip not implemented");
  }

  async getAllPayslips(): Promise<PayslipRecord[]> {
    throw new Error("MemStorage payslip not implemented");
  }

  // Leave management methods - stub implementations
  async createOrUpdateLeaveBalance(balance: InsertLeaveBalance): Promise<LeaveBalance> {
    throw new Error("MemStorage leave not implemented");
  }

  async getLeaveBalance(userId: string, leaveType: string, year: number): Promise<LeaveBalance | undefined> {
    throw new Error("MemStorage leave not implemented");
  }

  async getUserLeaveBalances(userId: string, year: number): Promise<LeaveBalance[]> {
    throw new Error("MemStorage leave not implemented");
  }

  async getAllLeaveBalances(year?: number): Promise<LeaveBalance[]> {
    throw new Error("MemStorage leave not implemented");
  }

  async updateLeaveBalanceTaken(id: string, taken: string, balance: string): Promise<LeaveBalance | undefined> {
    throw new Error("MemStorage leave not implemented");
  }

  async createLeaveApplication(application: InsertLeaveApplication): Promise<LeaveApplication> {
    throw new Error("MemStorage leave not implemented");
  }

  async updateLeaveApplication(id: string, updates: Partial<LeaveApplication>): Promise<LeaveApplication | undefined> {
    throw new Error("MemStorage leave not implemented");
  }

  async getLeaveApplicationById(id: string): Promise<LeaveApplication | undefined> {
    throw new Error("MemStorage leave not implemented");
  }

  async getUserLeaveApplications(userId: string): Promise<LeaveApplication[]> {
    throw new Error("MemStorage leave not implemented");
  }

  async getAllLeaveApplications(): Promise<LeaveApplication[]> {
    throw new Error("MemStorage leave not implemented");
  }

  async getPendingLeaveApplications(): Promise<LeaveApplication[]> {
    throw new Error("MemStorage leave not implemented");
  }

  // User update methods - stub implementations
  async updateUser(id: string, updates: Partial<User>): Promise<User | undefined> {
    throw new Error("MemStorage updateUser not implemented");
  }

  async bulkCreateUsers(usersData: Partial<User>[]): Promise<User[]> {
    throw new Error("MemStorage bulkCreateUsers not implemented");
  }

  async getUserByEmployeeCode(employeeCode: string): Promise<User | undefined> {
    throw new Error("MemStorage getUserByEmployeeCode not implemented");
  }

  async getUserByName(name: string): Promise<User | undefined> {
    throw new Error("MemStorage getUserByName not implemented");
  }

  async getAdminUsers(): Promise<User[]> {
    throw new Error("MemStorage getAdminUsers not implemented");
  }

  // Email log methods - stub implementations
  async createEmailLog(log: InsertEmailLog): Promise<EmailLog> {
    throw new Error("MemStorage createEmailLog not implemented");
  }

  async updateEmailLog(id: string, updates: Partial<EmailLog>): Promise<EmailLog | undefined> {
    throw new Error("MemStorage updateEmailLog not implemented");
  }

  async getEmailLogsByUser(userId: string): Promise<EmailLog[]> {
    throw new Error("MemStorage getEmailLogsByUser not implemented");
  }

  async getAllEmailLogs(): Promise<EmailLog[]> {
    throw new Error("MemStorage getAllEmailLogs not implemented");
  }

  // Audit log methods - stub implementations
  async createAuditLog(log: InsertAuditLog): Promise<AuditLog> {
    throw new Error("MemStorage createAuditLog not implemented");
  }

  async getAuditLogsByUser(userId: string): Promise<AuditLog[]> {
    throw new Error("MemStorage getAuditLogsByUser not implemented");
  }

  async getAuditLogsByFieldPrefix(fieldPrefix: string): Promise<AuditLog[]> {
    throw new Error("MemStorage getAuditLogsByFieldPrefix not implemented");
  }

  async getAllAuditLogs(): Promise<AuditLog[]> {
    throw new Error("MemStorage getAllAuditLogs not implemented");
  }

  async updateEmployeePayrollSettings(
    userId: string,
    updates: Partial<User>,
    changedBy: string
  ): Promise<{ user: User | undefined; auditLogs: AuditLog[] }> {
    throw new Error("MemStorage updateEmployeePayrollSettings not implemented");
  }
  
  async createPasswordOverrideLog(log: InsertPasswordOverrideLog): Promise<PasswordOverrideLog> {
    throw new Error("MemStorage createPasswordOverrideLog not implemented");
  }
  
  async getPasswordOverrideLogsByUser(userId: string): Promise<PasswordOverrideLog[]> {
    throw new Error("MemStorage getPasswordOverrideLogsByUser not implemented");
  }
  
  async getAllPasswordOverrideLogs(): Promise<PasswordOverrideLog[]> {
    throw new Error("MemStorage getAllPasswordOverrideLogs not implemented");
  }
  
  async createPayrollRecord(record: InsertPayrollRecord): Promise<PayrollRecord> {
    throw new Error("MemStorage createPayrollRecord not implemented");
  }
  
  async bulkCreatePayrollRecords(records: InsertPayrollRecord[]): Promise<PayrollRecord[]> {
    throw new Error("MemStorage bulkCreatePayrollRecords not implemented");
  }
  
  async getPayrollRecords(year?: number, month?: number): Promise<PayrollRecord[]> {
    throw new Error("MemStorage getPayrollRecords not implemented");
  }
  
  async getPayrollRecordsByEmployee(employeeCode: string): Promise<PayrollRecord[]> {
    throw new Error("MemStorage getPayrollRecordsByEmployee not implemented");
  }
  
  async getPayrollRecordsByUserId(userId: string): Promise<PayrollRecord[]> {
    throw new Error("MemStorage getPayrollRecordsByUserId not implemented");
  }
  
  async getEmployeeViewablePayrollRecords(userId: string): Promise<PayrollRecord[]> {
    throw new Error("MemStorage getEmployeeViewablePayrollRecords not implemented");
  }
  
  async deletePayrollRecordsByPeriod(year: number, month: number): Promise<void> {
    throw new Error("MemStorage deletePayrollRecordsByPeriod not implemented");
  }
  
  async getPayrollRecordById(id: string): Promise<PayrollRecord | undefined> {
    throw new Error("MemStorage getPayrollRecordById not implemented");
  }
  
  async updatePayrollRecord(id: string, updates: Partial<PayrollRecord>): Promise<PayrollRecord | undefined> {
    throw new Error("MemStorage updatePayrollRecord not implemented");
  }
  
  async searchPayrollRecords(year?: number, month?: number, employeeName?: string): Promise<PayrollRecord[]> {
    throw new Error("MemStorage searchPayrollRecords not implemented");
  }
  
  async createPayrollAuditLog(log: InsertPayrollAuditLog): Promise<PayrollAuditLog> {
    throw new Error("MemStorage createPayrollAuditLog not implemented");
  }
  
  async getPayrollAuditLogsByRecord(payrollRecordId: string): Promise<PayrollAuditLog[]> {
    throw new Error("MemStorage getPayrollAuditLogsByRecord not implemented");
  }
  
  async bulkCreateLeaveHistory(records: InsertLeaveHistory[]): Promise<LeaveHistory[]> {
    throw new Error("MemStorage bulkCreateLeaveHistory not implemented");
  }
  
  async getLeaveHistory(year?: number): Promise<LeaveHistory[]> {
    throw new Error("MemStorage getLeaveHistory not implemented");
  }
  
  async getLeaveHistoryByEmployee(employeeCode: string): Promise<LeaveHistory[]> {
    throw new Error("MemStorage getLeaveHistoryByEmployee not implemented");
  }
  
  async deleteLeaveHistoryByYear(year: number): Promise<void> {
    throw new Error("MemStorage deleteLeaveHistoryByYear not implemented");
  }
  
  async getLeaveHistoryStats(year: number): Promise<{ leaveType: string; totalDays: number; count: number }[]> {
    throw new Error("MemStorage getLeaveHistoryStats not implemented");
  }
  
  async getLeaveHistoryById(id: string): Promise<LeaveHistory | undefined> {
    throw new Error("MemStorage getLeaveHistoryById not implemented");
  }
  
  async updateLeaveHistory(id: string, updates: Partial<LeaveHistory>): Promise<LeaveHistory | undefined> {
    throw new Error("MemStorage updateLeaveHistory not implemented");
  }
  
  async deleteLeaveHistory(id: string): Promise<void> {
    throw new Error("MemStorage deleteLeaveHistory not implemented");
  }
  
  async createLeaveAuditLog(log: InsertLeaveAuditLog): Promise<LeaveAuditLog> {
    throw new Error("MemStorage createLeaveAuditLog not implemented");
  }
  
  async getLeaveAuditLogs(limit?: number): Promise<LeaveAuditLog[]> {
    throw new Error("MemStorage getLeaveAuditLogs not implemented");
  }
  
  // Payroll Adjustment stubs
  async createPayrollAdjustment(adjustment: InsertPayrollAdjustment): Promise<PayrollAdjustment> {
    throw new Error("MemStorage createPayrollAdjustment not implemented");
  }
  async updatePayrollAdjustment(id: string, updates: Partial<PayrollAdjustment>): Promise<PayrollAdjustment | undefined> {
    throw new Error("MemStorage updatePayrollAdjustment not implemented");
  }
  async getPayrollAdjustment(id: string): Promise<PayrollAdjustment | undefined> {
    throw new Error("MemStorage getPayrollAdjustment not implemented");
  }
  async getPayrollAdjustmentsByEmployee(userId: string, year?: number, month?: number): Promise<PayrollAdjustment[]> {
    throw new Error("MemStorage getPayrollAdjustmentsByEmployee not implemented");
  }
  async getPayrollAdjustmentsByPeriod(year: number, month: number): Promise<PayrollAdjustment[]> {
    throw new Error("MemStorage getPayrollAdjustmentsByPeriod not implemented");
  }
  async deletePayrollAdjustment(id: string): Promise<void> {
    throw new Error("MemStorage deletePayrollAdjustment not implemented");
  }
  async createPayrollAdjustmentAuditLog(log: InsertPayrollAdjustmentAuditLog): Promise<PayrollAdjustmentAuditLog> {
    throw new Error("MemStorage createPayrollAdjustmentAuditLog not implemented");
  }
  async getPayrollAdjustmentAuditLogs(adjustmentId: string): Promise<PayrollAdjustmentAuditLog[]> {
    throw new Error("MemStorage getPayrollAdjustmentAuditLogs not implemented");
  }
  
  // Employee Salary Adjustments stubs
  async getEmployeeSalaryAdjustments(userId: string): Promise<EmployeeSalaryAdjustment[]> {
    throw new Error("MemStorage getEmployeeSalaryAdjustments not implemented");
  }
  async createEmployeeSalaryAdjustment(adjustment: InsertEmployeeSalaryAdjustment): Promise<EmployeeSalaryAdjustment> {
    throw new Error("MemStorage createEmployeeSalaryAdjustment not implemented");
  }
  async updateEmployeeSalaryAdjustment(id: string, updates: Partial<EmployeeSalaryAdjustment>): Promise<EmployeeSalaryAdjustment | undefined> {
    throw new Error("MemStorage updateEmployeeSalaryAdjustment not implemented");
  }
  async deleteEmployeeSalaryAdjustment(id: string): Promise<boolean> {
    throw new Error("MemStorage deleteEmployeeSalaryAdjustment not implemented");
  }
  
  // Employee Data Audit Log stubs
  async createEmployeeDataAuditLog(log: InsertEmployeeDataAuditLog): Promise<EmployeeDataAuditLog> {
    throw new Error("MemStorage createEmployeeDataAuditLog not implemented");
  }
  async getEmployeeDataAuditLogs(userId: string): Promise<EmployeeDataAuditLog[]> {
    throw new Error("MemStorage getEmployeeDataAuditLogs not implemented");
  }
  async getAllEmployeeDataAuditLogs(limit?: number): Promise<EmployeeDataAuditLog[]> {
    throw new Error("MemStorage getAllEmployeeDataAuditLogs not implemented");
  }
  
  // Claims stubs
  async createClaim(claim: InsertClaim): Promise<Claim> {
    throw new Error("MemStorage createClaim not implemented");
  }
  async updateClaim(id: string, updates: Partial<Claim>): Promise<Claim | undefined> {
    throw new Error("MemStorage updateClaim not implemented");
  }
  async getClaim(id: string): Promise<Claim | undefined> {
    throw new Error("MemStorage getClaim not implemented");
  }
  async getClaimsByUser(userId: string): Promise<Claim[]> {
    throw new Error("MemStorage getClaimsByUser not implemented");
  }
  async getAllClaims(): Promise<Claim[]> {
    throw new Error("MemStorage getAllClaims not implemented");
  }
  async getClaimsByPeriod(year: number, month: number): Promise<Claim[]> {
    throw new Error("MemStorage getClaimsByPeriod not implemented");
  }
  async getPendingClaimsCount(): Promise<number> {
    throw new Error("MemStorage getPendingClaimsCount not implemented");
  }
  async getApprovedClaimsForPayslip(userId: string, year: number, month: number): Promise<Claim[]> {
    throw new Error("MemStorage getApprovedClaimsForPayslip not implemented");
  }
}

// PostgreSQL-backed storage implementation
export class PgStorage implements IStorage {
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user;
  }

  async getUserByEmailOrUsername(emailOrUsername: string, username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(
      or(
        eq(users.email, emailOrUsername),
        eq(users.username, username),
        eq(users.employeeCode, emailOrUsername),
        eq(users.employeeCode, username)
      )
    );
    return user;
  }

  async getUserByAuthId(authId: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.authId, authId));
    return user;
  }

  async createUser(insertUser: Partial<User>): Promise<User> {
    const [user] = await db.insert(users).values({
      name: insertUser.name!,
      email: insertUser.email!,
      username: insertUser.username ?? null,
      passwordHash: insertUser.passwordHash ?? null,
      mobileNumber: insertUser.mobileNumber ?? null,
      authId: insertUser.authId ?? null,
      role: insertUser.role ?? "user",
      isApproved: insertUser.isApproved ?? true,
    }).returning();
    return user;
  }

  async getAllUsers(): Promise<User[]> {
    return await db.select().from(users);
  }

  async approveUser(id: string): Promise<User | undefined> {
    const [user] = await db.update(users)
      .set({ isApproved: true })
      .where(eq(users.id, id))
      .returning();
    return user;
  }

  async getCompanySettings(): Promise<CompanySettings> {
    const [settings] = await db.select().from(companySettings).limit(1);
    
    if (!settings) {
      // Create default settings if none exist
      const [newSettings] = await db.insert(companySettings).values({
        companyName: "NexaHR",
        logoUrl: null,
        faviconUrl: null,
      }).returning();
      return newSettings;
    }
    
    return settings;
  }

  async updateCompanySettings(updates: Partial<CompanySettings>): Promise<CompanySettings> {
    // Get or create settings first
    let settings = await this.getCompanySettings();
    
    // Update the settings
    const [updated] = await db.update(companySettings)
      .set({
        ...updates,
        updatedAt: new Date(),
      })
      .where(eq(companySettings.id, settings.id))
      .returning();
    
    return updated;
  }

  // Attendance methods
  async createAttendanceRecord(record: InsertAttendanceRecord): Promise<AttendanceRecord> {
    const [attendanceRecord] = await db.insert(attendanceRecords)
      .values(record)
      .returning();
    return attendanceRecord;
  }

  async getAttendanceRecord(id: string): Promise<AttendanceRecord | undefined> {
    const [record] = await db.select()
      .from(attendanceRecords)
      .where(eq(attendanceRecords.id, id))
      .limit(1);
    return record;
  }

  async updateAttendanceRecord(id: string, updates: Partial<AttendanceRecord>): Promise<AttendanceRecord | undefined> {
    const [updated] = await db.update(attendanceRecords)
      .set(updates)
      .where(eq(attendanceRecords.id, id))
      .returning();
    return updated;
  }

  async deleteAttendanceRecord(id: string): Promise<void> {
    await db.delete(attendanceRecords)
      .where(eq(attendanceRecords.id, id));
  }

  async getTodayAttendanceRecord(userId: string, date: string): Promise<AttendanceRecord | undefined> {
    const [record] = await db.select()
      .from(attendanceRecords)
      .where(
        and(
          eq(attendanceRecords.userId, userId),
          eq(attendanceRecords.date, date)
        )
      )
      .limit(1);
    return record;
  }

  async getOpenAttendanceRecord(userId: string): Promise<AttendanceRecord | undefined> {
    // Find any attendance record for this user that has no clock-out time (open session)
    const [record] = await db.select()
      .from(attendanceRecords)
      .where(
        and(
          eq(attendanceRecords.userId, userId),
          isNull(attendanceRecords.clockOutTime)
        )
      )
      .orderBy(desc(attendanceRecords.clockInTime))
      .limit(1);
    return record;
  }

  async getOrphanedAttendanceSessions(): Promise<AttendanceRecord[]> {
    // Find all attendance records without clock-out that are older than 24 hours
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    
    const records = await db.select()
      .from(attendanceRecords)
      .where(
        and(
          isNull(attendanceRecords.clockOutTime),
          lt(attendanceRecords.clockInTime, twentyFourHoursAgo)
        )
      )
      .orderBy(desc(attendanceRecords.clockInTime));
    
    return records;
  }

  async getAttendanceRecordsByUserAndDateRange(userId: string, startDate: string, endDate: string): Promise<AttendanceRecord[]> {
    return await db.select()
      .from(attendanceRecords)
      .where(
        and(
          eq(attendanceRecords.userId, userId),
          gte(attendanceRecords.date, startDate),
          lte(attendanceRecords.date, endDate)
        )
      )
      .orderBy(desc(attendanceRecords.date));
  }

  async getAllUsersAttendanceByDateRange(startDate: string, endDate: string): Promise<AttendanceRecord[]> {
    try {
      console.log(`[Storage] getAllUsersAttendanceByDateRange: ${startDate} to ${endDate}`);
      const records = await db.select()
        .from(attendanceRecords)
        .where(
          and(
            gte(attendanceRecords.date, startDate),
            lte(attendanceRecords.date, endDate)
          )
        )
        .orderBy(desc(attendanceRecords.date));
      console.log(`[Storage] Query returned ${records.length} attendance records`);
      return records;
    } catch (error: any) {
      console.error(`[Storage] getAllUsersAttendanceByDateRange error:`, error.message);
      console.error(`[Storage] Error code:`, error.code);
      console.error(`[Storage] Full error:`, error);
      throw error;
    }
  }

  async getAllAttendanceRecords(): Promise<AttendanceRecord[]> {
    return await db.select()
      .from(attendanceRecords)
      .orderBy(desc(attendanceRecords.date));
  }

  // Daily attendance summary methods (pre-calculated for heatmap)
  async upsertDailyAttendanceSummary(summary: InsertDailyAttendanceSummary): Promise<DailyAttendanceSummary> {
    // Atomic upsert using ON CONFLICT DO UPDATE for race-condition safety
    const [result] = await db.insert(dailyAttendanceSummary)
      .values({ ...summary, calculatedAt: new Date() })
      .onConflictDoUpdate({
        target: [dailyAttendanceSummary.userId, dailyAttendanceSummary.date],
        set: {
          employeeCode: summary.employeeCode,
          employeeName: summary.employeeName,
          department: summary.department,
          totalClockIns: summary.totalClockIns,
          totalHoursWorked: summary.totalHoursWorked,
          firstClockIn: summary.firstClockIn,
          lastClockOut: summary.lastClockOut,
          status: summary.status,
          calculatedAt: new Date(),
        },
      })
      .returning();
    return result;
  }

  async getDailyAttendanceSummaries(startDate: string, endDate: string, limit: number = 5000): Promise<DailyAttendanceSummary[]> {
    return await db.select()
      .from(dailyAttendanceSummary)
      .where(
        and(
          gte(dailyAttendanceSummary.date, startDate),
          lte(dailyAttendanceSummary.date, endDate)
        )
      )
      .orderBy(dailyAttendanceSummary.date, dailyAttendanceSummary.userId)
      .limit(limit);
  }

  async recalculateDailyAttendanceSummary(date: string, userId: string): Promise<DailyAttendanceSummary | null> {
    const records = await db.select()
      .from(attendanceRecords)
      .where(
        and(
          eq(attendanceRecords.date, date),
          eq(attendanceRecords.userId, userId)
        )
      );
    
    if (records.length === 0) {
      await db.delete(dailyAttendanceSummary)
        .where(
          and(
            eq(dailyAttendanceSummary.date, date),
            eq(dailyAttendanceSummary.userId, userId)
          )
        );
      return null;
    }
    
    const user = await this.getUser(userId);
    
    let totalHoursWorked = 0;
    let firstClockIn: Date | null = null;
    let lastClockOut: Date | null = null;
    
    for (const record of records) {
      if (!firstClockIn || record.clockInTime < firstClockIn) {
        firstClockIn = record.clockInTime;
      }
      if (record.clockOutTime) {
        if (!lastClockOut || record.clockOutTime > lastClockOut) {
          lastClockOut = record.clockOutTime;
        }
        const hours = (record.clockOutTime.getTime() - record.clockInTime.getTime()) / (1000 * 60 * 60);
        totalHoursWorked += hours;
      }
    }
    
    const hasCompleteSessions = records.some(r => r.clockOutTime !== null);
    const hasOpenSessions = records.some(r => r.clockOutTime === null);
    const status = hasCompleteSessions ? 'present' : (hasOpenSessions ? 'partial' : 'absent');
    
    const summary: InsertDailyAttendanceSummary = {
      date,
      userId,
      employeeCode: user?.employeeCode || null,
      employeeName: user?.name || null,
      department: user?.department || null,
      totalClockIns: records.length,
      totalHoursWorked: Math.round(totalHoursWorked * 100) / 100,
      firstClockIn,
      lastClockOut,
      status,
    };
    
    return await this.upsertDailyAttendanceSummary(summary);
  }

  async recalculateAllSummariesForDate(date: string): Promise<{ processed: number; errors: number; deleted: number }> {
    // Get all attendance records for this date
    const records = await db.select()
      .from(attendanceRecords)
      .where(eq(attendanceRecords.date, date));
    
    const attendanceUserIds = new Set(records.map(r => r.userId));
    
    // Always get existing summaries for this date to find orphaned ones
    // This is critical even when no attendance records exist (all were deleted)
    const existingSummaries = await db.select()
      .from(dailyAttendanceSummary)
      .where(eq(dailyAttendanceSummary.date, date));
    
    const summaryUserIds = new Set(existingSummaries.map(s => s.userId));
    
    let processed = 0;
    let errors = 0;
    let deleted = 0;
    
    // First, delete orphaned summaries (summaries for users with no attendance records)
    // This handles the case where all attendance records for a user/date were deleted
    for (const userId of Array.from(summaryUserIds)) {
      if (!attendanceUserIds.has(userId)) {
        try {
          await db.delete(dailyAttendanceSummary)
            .where(
              and(
                eq(dailyAttendanceSummary.date, date),
                eq(dailyAttendanceSummary.userId, userId)
              )
            );
          deleted++;
          console.log(`[DailySummary] Deleted orphaned summary for ${date}, user ${userId}`);
        } catch (error) {
          console.error(`[DailySummary] Error deleting orphaned summary ${date} for user ${userId}:`, error);
          errors++;
        }
      }
    }
    
    // Then, recalculate summaries for users with attendance records
    for (const userId of Array.from(attendanceUserIds)) {
      try {
        await this.recalculateDailyAttendanceSummary(date, userId);
        processed++;
      } catch (error) {
        console.error(`[DailySummary] Error recalculating ${date} for user ${userId}:`, error);
        errors++;
        // Continue processing other users even if one fails
      }
    }
    
    return { processed, errors, deleted };
  }

  // Attendance adjustment methods (leave/OT override)
  async createAttendanceAdjustment(adjustment: InsertAttendanceAdjustment): Promise<AttendanceAdjustment> {
    const [record] = await db.insert(attendanceAdjustments)
      .values(adjustment)
      .returning();
    return record;
  }

  async getAttendanceAdjustment(userId: string, date: string): Promise<AttendanceAdjustment | undefined> {
    const [record] = await db.select()
      .from(attendanceAdjustments)
      .where(
        and(
          eq(attendanceAdjustments.userId, userId),
          eq(attendanceAdjustments.date, date)
        )
      )
      .limit(1);
    return record;
  }

  async getAttendanceAdjustmentById(id: string): Promise<AttendanceAdjustment | undefined> {
    const [record] = await db.select()
      .from(attendanceAdjustments)
      .where(eq(attendanceAdjustments.id, id))
      .limit(1);
    return record;
  }

  async updateAttendanceAdjustment(id: string, updates: Partial<AttendanceAdjustment>): Promise<AttendanceAdjustment | undefined> {
    const [updated] = await db.update(attendanceAdjustments)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(attendanceAdjustments.id, id))
      .returning();
    return updated;
  }

  async deleteAttendanceAdjustment(id: string): Promise<void> {
    await db.delete(attendanceAdjustments)
      .where(eq(attendanceAdjustments.id, id));
  }

  async getAttendanceAdjustmentsByDateRange(startDate: string, endDate: string): Promise<AttendanceAdjustment[]> {
    return await db.select()
      .from(attendanceAdjustments)
      .where(
        and(
          gte(attendanceAdjustments.date, startDate),
          lte(attendanceAdjustments.date, endDate)
        )
      );
  }

  // Employee monthly remarks methods
  async upsertEmployeeMonthlyRemark(remark: InsertEmployeeMonthlyRemark): Promise<EmployeeMonthlyRemark> {
    // Check if remark exists
    const existing = await this.getEmployeeMonthlyRemark(remark.userId, remark.year, remark.month);
    
    if (existing) {
      // Update existing remark
      const [updated] = await db.update(employeeMonthlyRemarks)
        .set({ 
          remark: remark.remark,
          createdBy: remark.createdBy,
          updatedAt: new Date() 
        })
        .where(eq(employeeMonthlyRemarks.id, existing.id))
        .returning();
      return updated;
    } else {
      // Insert new remark
      const [created] = await db.insert(employeeMonthlyRemarks)
        .values(remark)
        .returning();
      return created;
    }
  }

  async getEmployeeMonthlyRemarks(year: number, month: number): Promise<EmployeeMonthlyRemark[]> {
    return await db.select()
      .from(employeeMonthlyRemarks)
      .where(
        and(
          eq(employeeMonthlyRemarks.year, year),
          eq(employeeMonthlyRemarks.month, month)
        )
      );
  }

  async getEmployeeMonthlyRemark(userId: string, year: number, month: number): Promise<EmployeeMonthlyRemark | undefined> {
    const [record] = await db.select()
      .from(employeeMonthlyRemarks)
      .where(
        and(
          eq(employeeMonthlyRemarks.userId, userId),
          eq(employeeMonthlyRemarks.year, year),
          eq(employeeMonthlyRemarks.month, month)
        )
      )
      .limit(1);
    return record;
  }

  // Session tracking methods
  async createUserSession(session: InsertUserSession): Promise<UserSession> {
    const [userSession] = await db.insert(userSessions)
      .values(session)
      .returning();
    return userSession;
  }

  async getActiveSessions(userId: string): Promise<UserSession[]> {
    return await db.select()
      .from(userSessions)
      .where(
        and(
          eq(userSessions.userId, userId),
          isNull(userSessions.revokedAt)
        )
      )
      .orderBy(desc(userSessions.createdAt));
  }

  async getAllLoginHistory(limit = 100): Promise<Array<UserSession & { userName: string; userEmail: string; userDepartment: string | null }>> {
    const rows = await db
      .select({
        id: userSessions.id,
        sessionId: userSessions.sessionId,
        userId: userSessions.userId,
        createdAt: userSessions.createdAt,
        lastSeen: userSessions.lastSeen,
        userAgent: userSessions.userAgent,
        ipAddress: userSessions.ipAddress,
        revokedAt: userSessions.revokedAt,
        userName: users.name,
        userEmail: users.email,
        userDepartment: users.department,
      })
      .from(userSessions)
      .innerJoin(users, eq(userSessions.userId, users.id))
      .orderBy(desc(userSessions.createdAt))
      .limit(limit);
    return rows;
  }

  async revokeSession(sessionId: string): Promise<void> {
    await db.update(userSessions)
      .set({ revokedAt: new Date() })
      .where(eq(userSessions.sessionId, sessionId));
  }

  async revokeAllUserSessions(userId: string, exceptSessionId?: string): Promise<void> {
    const conditions = [
      eq(userSessions.userId, userId),
      isNull(userSessions.revokedAt)
    ];
    
    if (exceptSessionId) {
      conditions.push(not(eq(userSessions.sessionId, exceptSessionId)));
    }
    
    await db.update(userSessions)
      .set({ revokedAt: new Date() })
      .where(and(...conditions));
  }

  async updateSessionLastSeen(sessionId: string): Promise<void> {
    await db.update(userSessions)
      .set({ lastSeen: new Date() })
      .where(eq(userSessions.sessionId, sessionId));
  }

  // Login challenge methods
  async createLoginChallenge(challenge: InsertLoginChallenge): Promise<LoginChallenge> {
    const [loginChallenge] = await db.insert(loginChallenges)
      .values(challenge)
      .returning();
    return loginChallenge;
  }

  async getLoginChallenge(challengeToken: string): Promise<LoginChallenge | undefined> {
    const [challenge] = await db.select()
      .from(loginChallenges)
      .where(eq(loginChallenges.challengeToken, challengeToken))
      .limit(1);
    return challenge;
  }

  async useLoginChallenge(challengeId: string): Promise<void> {
    await db.update(loginChallenges)
      .set({ usedAt: new Date() })
      .where(eq(loginChallenges.id, challengeId));
  }

  async cleanupExpiredChallenges(): Promise<void> {
    const now = new Date();
    await db.delete(loginChallenges)
      .where(lte(loginChallenges.expiresAt, now));
  }

  // Payslip methods
  async createPayslip(payslip: InsertPayslipRecord): Promise<PayslipRecord> {
    const [record] = await db.insert(payslipRecords)
      .values(payslip)
      .returning();
    return record;
  }

  async updatePayslip(id: string, updates: Partial<PayslipRecord>): Promise<PayslipRecord | undefined> {
    const [updated] = await db.update(payslipRecords)
      .set(updates)
      .where(eq(payslipRecords.id, id))
      .returning();
    return updated;
  }

  async getPayslipById(id: string): Promise<PayslipRecord | undefined> {
    const [record] = await db.select()
      .from(payslipRecords)
      .where(eq(payslipRecords.id, id));
    return record;
  }

  async getPayslipsByUser(userId: string): Promise<PayslipRecord[]> {
    return await db.select()
      .from(payslipRecords)
      .where(eq(payslipRecords.userId, userId))
      .orderBy(desc(payslipRecords.createdAt));
  }

  async getApprovedPayslipsByUser(userId: string): Promise<PayslipRecord[]> {
    return await db.select()
      .from(payslipRecords)
      .where(
        and(
          eq(payslipRecords.userId, userId),
          eq(payslipRecords.status, "approved")
        )
      )
      .orderBy(desc(payslipRecords.createdAt));
  }

  async getAllPayslips(): Promise<PayslipRecord[]> {
    return await db.select()
      .from(payslipRecords)
      .orderBy(desc(payslipRecords.createdAt));
  }

  // Leave management methods
  async createOrUpdateLeaveBalance(balance: InsertLeaveBalance): Promise<LeaveBalance> {
    // Check if balance already exists
    const [existing] = await db.select()
      .from(leaveBalances)
      .where(
        and(
          eq(leaveBalances.userId, balance.userId),
          eq(leaveBalances.leaveType, balance.leaveType),
          eq(leaveBalances.year, balance.year)
        )
      );

    if (existing) {
      // Update existing balance
      const [updated] = await db.update(leaveBalances)
        .set({
          broughtForward: balance.broughtForward,
          earned: balance.earned,
          eligible: balance.eligible,
          taken: balance.taken,
          balance: balance.balance,
          employeeCode: balance.employeeCode,
          employeeName: balance.employeeName,
          updatedAt: new Date(),
        })
        .where(eq(leaveBalances.id, existing.id))
        .returning();
      return updated;
    } else {
      // Create new balance
      const [created] = await db.insert(leaveBalances)
        .values(balance)
        .returning();
      return created;
    }
  }

  async getLeaveBalance(userId: string, leaveType: string, year: number): Promise<LeaveBalance | undefined> {
    const [balance] = await db.select()
      .from(leaveBalances)
      .where(
        and(
          eq(leaveBalances.userId, userId),
          eq(leaveBalances.leaveType, leaveType),
          eq(leaveBalances.year, year)
        )
      );
    return balance;
  }

  async getUserLeaveBalances(userId: string, year: number): Promise<LeaveBalance[]> {
    return await db.select()
      .from(leaveBalances)
      .where(
        and(
          eq(leaveBalances.userId, userId),
          eq(leaveBalances.year, year)
        )
      )
      .orderBy(leaveBalances.leaveType);
  }

  async getAllLeaveBalances(year?: number): Promise<LeaveBalance[]> {
    const query = db.select().from(leaveBalances);
    if (year) {
      return await query.where(eq(leaveBalances.year, year)).orderBy(leaveBalances.userId, leaveBalances.leaveType);
    }
    return await query.orderBy(leaveBalances.userId, leaveBalances.leaveType);
  }

  async updateLeaveBalanceTaken(id: string, taken: string, balance: string): Promise<LeaveBalance | undefined> {
    const [updated] = await db.update(leaveBalances)
      .set({
        taken,
        balance,
        updatedAt: new Date(),
      })
      .where(eq(leaveBalances.id, id))
      .returning();
    return updated;
  }

  // Clamp any negative leave balances (all types) to 0. Called by the monthly cron at the start of each month.
  // - MC: negative is intentionally allowed during the cycle for urgent sick leave; reset wipes the deficit.
  // - AL/CL/etc.: submission validation blocks new negatives, but legacy/imported data or admin edits may produce them;
  //   reset prevents them from carrying forward past the cycle.
  async clampNegativeLeaveBalances(): Promise<number> {
    const result = await db.update(leaveBalances)
      .set({ balance: '0', updatedAt: new Date() })
      .where(lt(leaveBalances.balance, '0'))
      .returning({ id: leaveBalances.id });
    return result.length;
  }

  async createLeaveApplication(application: InsertLeaveApplication): Promise<LeaveApplication> {
    const [created] = await db.insert(leaveApplications)
      .values(application)
      .returning();
    return created;
  }

  async updateLeaveApplication(id: string, updates: Partial<LeaveApplication>): Promise<LeaveApplication | undefined> {
    const [updated] = await db.update(leaveApplications)
      .set(updates)
      .where(eq(leaveApplications.id, id))
      .returning();
    return updated;
  }

  async getLeaveApplicationById(id: string): Promise<LeaveApplication | undefined> {
    const [application] = await db.select()
      .from(leaveApplications)
      .where(eq(leaveApplications.id, id));
    return application;
  }

  async getUserLeaveApplications(userId: string): Promise<LeaveApplication[]> {
    return await db.select()
      .from(leaveApplications)
      .where(eq(leaveApplications.userId, userId))
      .orderBy(desc(leaveApplications.createdAt));
  }

  async getAllLeaveApplications(): Promise<LeaveApplication[]> {
    return await db.select()
      .from(leaveApplications)
      .orderBy(desc(leaveApplications.createdAt));
  }

  async getPendingLeaveApplications(): Promise<LeaveApplication[]> {
    return await db.select()
      .from(leaveApplications)
      .where(eq(leaveApplications.status, "pending"))
      .orderBy(leaveApplications.createdAt);
  }

  // User update methods
  async updateUser(id: string, updates: Partial<User>): Promise<User | undefined> {
    const [updated] = await db.update(users)
      .set(updates)
      .where(eq(users.id, id))
      .returning();
    return updated;
  }

  async bulkCreateUsers(usersData: Partial<User>[]): Promise<User[]> {
    if (usersData.length === 0) return [];
    
    const createdUsers: User[] = [];
    for (const userData of usersData) {
      try {
        const [created] = await db.insert(users)
          .values(userData as any)
          .returning();
        createdUsers.push(created);
      } catch (error) {
        console.error("Error creating user:", userData.email, error);
      }
    }
    return createdUsers;
  }

  async getUserByEmployeeCode(employeeCode: string): Promise<User | undefined> {
    const [user] = await db.select()
      .from(users)
      .where(eq(users.employeeCode, employeeCode))
      .limit(1);
    return user;
  }

  async getUserByName(name: string): Promise<User | undefined> {
    // Case-insensitive name matching
    const normalizedName = name.trim().toUpperCase();
    const allUsers = await db.select().from(users);
    const matchedUser = allUsers.find(u => u.name.trim().toUpperCase() === normalizedName);
    return matchedUser;
  }

  async getAdminUsers(): Promise<User[]> {
    return await db.select()
      .from(users)
      .where(
        or(
          eq(users.role, "admin"),
          eq(users.role, "viewonly_admin")
        )
      )
      .limit(10);
  }

  // Email log methods
  async createEmailLog(log: InsertEmailLog): Promise<EmailLog> {
    const [created] = await db.insert(emailLogs)
      .values(log)
      .returning();
    return created;
  }

  async updateEmailLog(id: string, updates: Partial<EmailLog>): Promise<EmailLog | undefined> {
    const [updated] = await db.update(emailLogs)
      .set(updates)
      .where(eq(emailLogs.id, id))
      .returning();
    return updated;
  }

  async getEmailLogsByUser(userId: string): Promise<EmailLog[]> {
    return await db.select()
      .from(emailLogs)
      .where(eq(emailLogs.userId, userId))
      .orderBy(desc(emailLogs.createdAt));
  }

  async getAllEmailLogs(): Promise<EmailLog[]> {
    return await db.select()
      .from(emailLogs)
      .orderBy(desc(emailLogs.createdAt));
  }

  // Audit log methods
  async createAuditLog(log: InsertAuditLog): Promise<AuditLog> {
    const [created] = await db.insert(auditLogs)
      .values(log)
      .returning();
    return created;
  }

  async getAuditLogsByUser(userId: string): Promise<AuditLog[]> {
    return await db.select()
      .from(auditLogs)
      .where(eq(auditLogs.userId, userId))
      .orderBy(desc(auditLogs.createdAt));
  }

  async getAuditLogsByFieldPrefix(fieldPrefix: string): Promise<AuditLog[]> {
    return await db.select()
      .from(auditLogs)
      .where(like(auditLogs.fieldChanged, `${fieldPrefix}%`))
      .orderBy(desc(auditLogs.createdAt));
  }

  async getAllAuditLogs(): Promise<AuditLog[]> {
    return await db.select()
      .from(auditLogs)
      .orderBy(desc(auditLogs.createdAt));
  }

  async updateEmployeePayrollSettings(
    userId: string,
    updates: Partial<User>,
    changedBy: string
  ): Promise<{ user: User | undefined; auditLogs: AuditLog[] }> {
    // Get current user data to compare changes
    const [currentUser] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!currentUser) {
      return { user: undefined, auditLogs: [] };
    }

    // Track which fields are being changed for audit logging
    const payrollFields = [
      'residencyStatus', 'sprStartDate', 'birthDate',
      'basicMonthlySalary', 'hourlyRate', 'dailyRate', 'payType', 'regularHoursPerDay', 'regularDaysPerWeek',
      'defaultMobileAllowance', 'defaultTransportAllowance', 'defaultMealAllowance',
      'defaultShiftAllowance', 'defaultOtherAllowance', 'defaultOtherAllowance1', 'defaultOtherAllowance2', 'defaultHouseRentalAllowance',
      'salaryAdjustment', 'salaryAdjustmentReason'
    ];

    const createdAuditLogs: AuditLog[] = [];

    // Create audit logs for each changed field
    for (const field of payrollFields) {
      const key = field as keyof User;
      if (key in updates) {
        const oldValue = currentUser[key];
        const newValue = updates[key];
        
        // Only log if value actually changed
        if (String(oldValue ?? '') !== String(newValue ?? '')) {
          const [auditLog] = await db.insert(auditLogs)
            .values({
              userId,
              changedBy,
              fieldChanged: field,
              oldValue: oldValue != null ? String(oldValue) : null,
              newValue: newValue != null ? String(newValue) : null,
              changeType: 'update',
            })
            .returning();
          createdAuditLogs.push(auditLog);
        }
      }
    }

    // Update the user
    const [updatedUser] = await db.update(users)
      .set(updates)
      .where(eq(users.id, userId))
      .returning();

    return { user: updatedUser, auditLogs: createdAuditLogs };
  }
  
  async createPasswordOverrideLog(log: InsertPasswordOverrideLog): Promise<PasswordOverrideLog> {
    const [result] = await db.insert(passwordOverrideLogs).values(log).returning();
    return result;
  }
  
  async getPasswordOverrideLogsByUser(userId: string): Promise<PasswordOverrideLog[]> {
    return await db.select()
      .from(passwordOverrideLogs)
      .where(eq(passwordOverrideLogs.userId, userId))
      .orderBy(desc(passwordOverrideLogs.createdAt));
  }
  
  async getAllPasswordOverrideLogs(): Promise<PasswordOverrideLog[]> {
    return await db.select()
      .from(passwordOverrideLogs)
      .orderBy(desc(passwordOverrideLogs.createdAt));
  }
  
  // Payroll record methods (CSV import)
  async createPayrollRecord(record: InsertPayrollRecord): Promise<PayrollRecord> {
    const [created] = await db.insert(payrollRecords)
      .values(record)
      .returning();
    return created;
  }
  
  async bulkCreatePayrollRecords(records: InsertPayrollRecord[]): Promise<PayrollRecord[]> {
    if (records.length === 0) return [];
    const created = await db.insert(payrollRecords)
      .values(records)
      .returning();
    return created;
  }
  
  async getPayrollRecords(year?: number, month?: number): Promise<PayrollRecord[]> {
    if (year !== undefined && month !== undefined) {
      return await db.select()
        .from(payrollRecords)
        .where(
          and(
            eq(payrollRecords.payPeriodYear, year),
            eq(payrollRecords.payPeriodMonth, month)
          )
        )
        .orderBy(asc(payrollRecords.employeeName));
    } else if (year !== undefined) {
      return await db.select()
        .from(payrollRecords)
        .where(eq(payrollRecords.payPeriodYear, year))
        .orderBy(asc(payrollRecords.employeeName));
    }
    return await db.select()
      .from(payrollRecords)
      .orderBy(asc(payrollRecords.employeeName));
  }
  
  async getPayrollRecordsByEmployee(employeeCode: string): Promise<PayrollRecord[]> {
    return await db.select()
      .from(payrollRecords)
      .where(eq(payrollRecords.employeeCode, employeeCode))
      .orderBy(desc(payrollRecords.payPeriodYear), desc(payrollRecords.payPeriodMonth));
  }
  
  async getPayrollRecordsByUserId(userId: string): Promise<PayrollRecord[]> {
    return await db.select()
      .from(payrollRecords)
      .where(eq(payrollRecords.userId, userId))
      .orderBy(desc(payrollRecords.payPeriodYear), desc(payrollRecords.payPeriodMonth));
  }
  
  async getEmployeeViewablePayrollRecords(userId: string): Promise<PayrollRecord[]> {
    return await db.select()
      .from(payrollRecords)
      .where(
        and(
          eq(payrollRecords.userId, userId),
          eq(payrollRecords.allowEmployeeView, true)
        )
      )
      .orderBy(desc(payrollRecords.payPeriodYear), desc(payrollRecords.payPeriodMonth));
  }
  
  async deletePayrollRecordsByPeriod(year: number, month: number): Promise<void> {
    // First, get all payroll record IDs for this period
    const records = await db.select({ id: payrollRecords.id })
      .from(payrollRecords)
      .where(
        and(
          eq(payrollRecords.payPeriodYear, year),
          eq(payrollRecords.payPeriodMonth, month)
        )
      );
    
    if (records.length === 0) {
      return; // Nothing to delete
    }
    
    const recordIds = records.map(r => r.id);
    
    // Delete related audit logs first (foreign key constraint)
    await db.delete(payrollAuditLogs)
      .where(inArray(payrollAuditLogs.payrollRecordId, recordIds));
    
    // Now delete the payroll records
    await db.delete(payrollRecords)
      .where(
        and(
          eq(payrollRecords.payPeriodYear, year),
          eq(payrollRecords.payPeriodMonth, month)
        )
      );
  }
  
  async getPayrollRecordById(id: string): Promise<PayrollRecord | undefined> {
    const [record] = await db.select()
      .from(payrollRecords)
      .where(eq(payrollRecords.id, id));
    return record;
  }
  
  async updatePayrollRecord(id: string, updates: Partial<PayrollRecord>): Promise<PayrollRecord | undefined> {
    const [updated] = await db.update(payrollRecords)
      .set(updates)
      .where(eq(payrollRecords.id, id))
      .returning();
    return updated;
  }
  
  async searchPayrollRecords(year?: number, month?: number, employeeName?: string): Promise<PayrollRecord[]> {
    const conditions = [];
    if (year !== undefined) {
      conditions.push(eq(payrollRecords.payPeriodYear, year));
    }
    if (month !== undefined) {
      conditions.push(eq(payrollRecords.payPeriodMonth, month));
    }
    if (employeeName) {
      conditions.push(like(payrollRecords.employeeName, `%${employeeName}%`));
    }
    
    if (conditions.length > 0) {
      return await db.select()
        .from(payrollRecords)
        .where(and(...conditions))
        .orderBy(asc(payrollRecords.employeeName));
    }
    return await db.select()
      .from(payrollRecords)
      .orderBy(asc(payrollRecords.employeeName));
  }
  
  async createPayrollAuditLog(log: InsertPayrollAuditLog): Promise<PayrollAuditLog> {
    const [created] = await db.insert(payrollAuditLogs)
      .values(log)
      .returning();
    return created;
  }
  
  async getPayrollAuditLogsByRecord(payrollRecordId: string): Promise<PayrollAuditLog[]> {
    return await db.select()
      .from(payrollAuditLogs)
      .where(eq(payrollAuditLogs.payrollRecordId, payrollRecordId))
      .orderBy(desc(payrollAuditLogs.changedAt));
  }
  
  // Leave history methods (CSV import)
  async bulkCreateLeaveHistory(records: InsertLeaveHistory[]): Promise<LeaveHistory[]> {
    if (records.length === 0) return [];
    const created = await db.insert(leaveHistory)
      .values(records)
      .returning();
    return created;
  }
  
  async getLeaveHistory(year?: number): Promise<LeaveHistory[]> {
    if (year !== undefined) {
      return await db.select()
        .from(leaveHistory)
        .where(eq(leaveHistory.year, year))
        .orderBy(desc(leaveHistory.leaveDate));
    }
    return await db.select()
      .from(leaveHistory)
      .orderBy(desc(leaveHistory.leaveDate));
  }
  
  async getLeaveHistoryByEmployee(employeeCode: string): Promise<LeaveHistory[]> {
    return await db.select()
      .from(leaveHistory)
      .where(eq(leaveHistory.employeeCode, employeeCode))
      .orderBy(desc(leaveHistory.leaveDate));
  }
  
  async deleteLeaveHistoryByYear(year: number): Promise<void> {
    await db.delete(leaveHistory)
      .where(eq(leaveHistory.year, year));
  }
  
  async getLeaveHistoryStats(year: number): Promise<{ leaveType: string; totalDays: number; count: number }[]> {
    const results = await db.select({
      leaveType: leaveHistory.leaveType,
      count: sql<number>`count(*)::int`,
      totalDays: sql<number>`sum(
        CASE 
          WHEN ${leaveHistory.daysOrHours} LIKE '%day%' THEN 
            CAST(REGEXP_REPLACE(${leaveHistory.daysOrHours}, '[^0-9.]', '', 'g') AS DECIMAL)
          WHEN ${leaveHistory.daysOrHours} LIKE '%hr%' THEN 
            CAST(REGEXP_REPLACE(${leaveHistory.daysOrHours}, '[^0-9.]', '', 'g') AS DECIMAL) / 8
          ELSE 1
        END
      )::numeric(10,2)`,
    })
      .from(leaveHistory)
      .where(eq(leaveHistory.year, year))
      .groupBy(leaveHistory.leaveType);
    return results.map(r => ({ 
      leaveType: r.leaveType, 
      totalDays: Number(r.totalDays) || 0, 
      count: r.count 
    }));
  }
  
  async getLeaveHistoryById(id: string): Promise<LeaveHistory | undefined> {
    const [record] = await db.select()
      .from(leaveHistory)
      .where(eq(leaveHistory.id, id));
    return record;
  }
  
  async updateLeaveHistory(id: string, updates: Partial<LeaveHistory>): Promise<LeaveHistory | undefined> {
    const [updated] = await db.update(leaveHistory)
      .set(updates)
      .where(eq(leaveHistory.id, id))
      .returning();
    return updated;
  }
  
  async deleteLeaveHistory(id: string): Promise<void> {
    await db.delete(leaveHistory)
      .where(eq(leaveHistory.id, id));
  }
  
  async createLeaveAuditLog(log: InsertLeaveAuditLog): Promise<LeaveAuditLog> {
    const [created] = await db.insert(leaveAuditLogs)
      .values(log)
      .returning();
    return created;
  }
  
  async getLeaveAuditLogs(limit?: number): Promise<LeaveAuditLog[]> {
    if (limit) {
      return await db.select()
        .from(leaveAuditLogs)
        .orderBy(desc(leaveAuditLogs.changedAt))
        .limit(limit);
    }
    return await db.select()
      .from(leaveAuditLogs)
      .orderBy(desc(leaveAuditLogs.changedAt));
  }
  
  // Payroll Loan Account methods
  async createPayrollLoanAccount(loan: InsertPayrollLoanAccount): Promise<PayrollLoanAccount> {
    const [created] = await db.insert(payrollLoanAccounts)
      .values(loan)
      .returning();
    return created;
  }
  
  async updatePayrollLoanAccount(id: string, updates: Partial<PayrollLoanAccount>): Promise<PayrollLoanAccount | undefined> {
    const [updated] = await db.update(payrollLoanAccounts)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(payrollLoanAccounts.id, id))
      .returning();
    return updated;
  }
  
  async getPayrollLoanAccount(id: string): Promise<PayrollLoanAccount | undefined> {
    const [loan] = await db.select()
      .from(payrollLoanAccounts)
      .where(eq(payrollLoanAccounts.id, id));
    return loan;
  }
  
  async getPayrollLoanAccountsByEmployee(employeeCode: string): Promise<PayrollLoanAccount[]> {
    return await db.select()
      .from(payrollLoanAccounts)
      .where(eq(payrollLoanAccounts.employeeCode, employeeCode))
      .orderBy(desc(payrollLoanAccounts.createdAt));
  }
  
  async getActivePayrollLoans(): Promise<PayrollLoanAccount[]> {
    return await db.select()
      .from(payrollLoanAccounts)
      .where(eq(payrollLoanAccounts.status, "active"))
      .orderBy(desc(payrollLoanAccounts.createdAt));
  }
  
  async getAllPayrollLoanAccounts(): Promise<PayrollLoanAccount[]> {
    return await db.select()
      .from(payrollLoanAccounts)
      .orderBy(desc(payrollLoanAccounts.createdAt));
  }
  
  // Payroll Loan Repayment methods
  async createPayrollLoanRepayment(repayment: InsertPayrollLoanRepayment): Promise<PayrollLoanRepayment> {
    const [created] = await db.insert(payrollLoanRepayments)
      .values(repayment)
      .returning();
    
    // Update the loan's outstanding balance
    const loan = await this.getPayrollLoanAccount(repayment.loanAccountId);
    if (loan) {
      const newBalance = parseFloat(loan.outstandingBalance as any) - parseFloat(repayment.repaymentAmount as any);
      await this.updatePayrollLoanAccount(loan.id, {
        outstandingBalance: String(Math.max(0, newBalance)) as any,
        status: newBalance <= 0 ? "paid_off" : "active"
      });
    }
    
    return created;
  }
  
  async getLoanRepaymentsByLoan(loanAccountId: string): Promise<PayrollLoanRepayment[]> {
    return await db.select()
      .from(payrollLoanRepayments)
      .where(eq(payrollLoanRepayments.loanAccountId, loanAccountId))
      .orderBy(desc(payrollLoanRepayments.processedAt));
  }
  
  async getLoanRepaymentsByPeriod(year: number, month: number): Promise<PayrollLoanRepayment[]> {
    return await db.select()
      .from(payrollLoanRepayments)
      .where(and(
        eq(payrollLoanRepayments.payPeriodYear, year),
        eq(payrollLoanRepayments.payPeriodMonth, month)
      ))
      .orderBy(desc(payrollLoanRepayments.processedAt));
  }
  
  async getEmployeeLoanRepaymentsForPeriod(employeeCode: string, year: number, month: number): Promise<PayrollLoanRepayment[]> {
    // Get all loans for this employee first, then filter repayments
    const loans = await this.getPayrollLoanAccountsByEmployee(employeeCode);
    const loanIds = loans.map(l => l.id);
    
    if (loanIds.length === 0) return [];
    
    const allRepayments = await this.getLoanRepaymentsByPeriod(year, month);
    return allRepayments.filter(r => loanIds.includes(r.loanAccountId));
  }
  
  // Archive methods
  async archiveUsers(userIds: string[]): Promise<void> {
    if (userIds.length === 0) return;
    
    for (const userId of userIds) {
      await db.update(users)
        .set({ isArchived: true })
        .where(eq(users.id, userId));
    }
  }
  
  async unarchiveUsers(userIds: string[]): Promise<void> {
    if (userIds.length === 0) return;
    
    for (const userId of userIds) {
      await db.update(users)
        .set({ isArchived: false })
        .where(eq(users.id, userId));
    }
  }
  
  async getArchivedUsers(): Promise<User[]> {
    return await db.select()
      .from(users)
      .where(eq(users.isArchived, true))
      .orderBy(users.name);
  }
  
  // Payroll Adjustment methods
  async createPayrollAdjustment(adjustment: InsertPayrollAdjustment): Promise<PayrollAdjustment> {
    const [created] = await db.insert(payrollAdjustments)
      .values(adjustment)
      .returning();
    return created;
  }
  
  async updatePayrollAdjustment(id: string, updates: Partial<PayrollAdjustment>): Promise<PayrollAdjustment | undefined> {
    const [updated] = await db.update(payrollAdjustments)
      .set(updates)
      .where(eq(payrollAdjustments.id, id))
      .returning();
    return updated;
  }
  
  async getPayrollAdjustment(id: string): Promise<PayrollAdjustment | undefined> {
    const [adjustment] = await db.select()
      .from(payrollAdjustments)
      .where(eq(payrollAdjustments.id, id));
    return adjustment;
  }
  
  async getPayrollAdjustmentsByEmployee(userId: string, year?: number, month?: number): Promise<PayrollAdjustment[]> {
    let conditions = [eq(payrollAdjustments.userId, userId)];
    if (year !== undefined) {
      conditions.push(eq(payrollAdjustments.payPeriodYear, year));
    }
    if (month !== undefined) {
      conditions.push(eq(payrollAdjustments.payPeriodMonth, month));
    }
    return await db.select()
      .from(payrollAdjustments)
      .where(and(...conditions))
      .orderBy(desc(payrollAdjustments.createdAt));
  }
  
  async getPayrollAdjustmentsByPeriod(year: number, month: number): Promise<PayrollAdjustment[]> {
    return await db.select()
      .from(payrollAdjustments)
      .where(and(
        eq(payrollAdjustments.payPeriodYear, year),
        eq(payrollAdjustments.payPeriodMonth, month)
      ))
      .orderBy(desc(payrollAdjustments.createdAt));
  }
  
  async deletePayrollAdjustment(id: string): Promise<void> {
    // First delete any audit logs
    await db.delete(payrollAdjustmentAuditLogs)
      .where(eq(payrollAdjustmentAuditLogs.adjustmentId, id));
    // Then delete the adjustment
    await db.delete(payrollAdjustments)
      .where(eq(payrollAdjustments.id, id));
  }
  
  // Payroll Adjustment Audit Log methods
  async createPayrollAdjustmentAuditLog(log: InsertPayrollAdjustmentAuditLog): Promise<PayrollAdjustmentAuditLog> {
    const [created] = await db.insert(payrollAdjustmentAuditLogs)
      .values(log)
      .returning();
    return created;
  }
  
  async getPayrollAdjustmentAuditLogs(adjustmentId: string): Promise<PayrollAdjustmentAuditLog[]> {
    return await db.select()
      .from(payrollAdjustmentAuditLogs)
      .where(eq(payrollAdjustmentAuditLogs.adjustmentId, adjustmentId))
      .orderBy(desc(payrollAdjustmentAuditLogs.changedAt));
  }
  
  // Employee Salary Adjustments
  async getEmployeeSalaryAdjustments(userId: string): Promise<EmployeeSalaryAdjustment[]> {
    return await db.select()
      .from(employeeSalaryAdjustments)
      .where(eq(employeeSalaryAdjustments.userId, userId))
      .orderBy(desc(employeeSalaryAdjustments.createdAt));
  }
  
  async createEmployeeSalaryAdjustment(adjustment: InsertEmployeeSalaryAdjustment): Promise<EmployeeSalaryAdjustment> {
    const [created] = await db.insert(employeeSalaryAdjustments)
      .values(adjustment)
      .returning();
    return created;
  }
  
  async updateEmployeeSalaryAdjustment(id: string, updates: Partial<EmployeeSalaryAdjustment>): Promise<EmployeeSalaryAdjustment | undefined> {
    const [updated] = await db.update(employeeSalaryAdjustments)
      .set({
        ...updates,
        updatedAt: new Date(),
      })
      .where(eq(employeeSalaryAdjustments.id, id))
      .returning();
    return updated;
  }
  
  async deleteEmployeeSalaryAdjustment(id: string): Promise<boolean> {
    const result = await db.delete(employeeSalaryAdjustments)
      .where(eq(employeeSalaryAdjustments.id, id))
      .returning();
    return result.length > 0;
  }
  
  // Employee Data Audit Log methods
  async createEmployeeDataAuditLog(log: InsertEmployeeDataAuditLog): Promise<EmployeeDataAuditLog> {
    const [created] = await db.insert(employeeDataAuditLogs)
      .values(log)
      .returning();
    return created;
  }
  
  async getEmployeeDataAuditLogs(userId: string): Promise<EmployeeDataAuditLog[]> {
    return await db.select()
      .from(employeeDataAuditLogs)
      .where(eq(employeeDataAuditLogs.userId, userId))
      .orderBy(desc(employeeDataAuditLogs.changedAt));
  }
  
  async getAllEmployeeDataAuditLogs(limit?: number): Promise<EmployeeDataAuditLog[]> {
    const query = db.select()
      .from(employeeDataAuditLogs)
      .orderBy(desc(employeeDataAuditLogs.changedAt));
    
    if (limit) {
      return await query.limit(limit);
    }
    return await query;
  }
  
  // Payroll Import Batch methods
  async createPayrollImportBatch(batch: InsertPayrollImportBatch): Promise<PayrollImportBatch> {
    const [created] = await db.insert(payrollImportBatches)
      .values(batch)
      .returning();
    return created;
  }
  
  async updatePayrollImportBatch(id: string, updates: Partial<PayrollImportBatch>): Promise<PayrollImportBatch | undefined> {
    const [updated] = await db.update(payrollImportBatches)
      .set(updates)
      .where(eq(payrollImportBatches.id, id))
      .returning();
    return updated;
  }
  
  async getPayrollImportBatch(id: string): Promise<PayrollImportBatch | undefined> {
    const [batch] = await db.select()
      .from(payrollImportBatches)
      .where(eq(payrollImportBatches.id, id))
      .limit(1);
    return batch;
  }
  
  async getPayrollImportBatches(): Promise<PayrollImportBatch[]> {
    return await db.select()
      .from(payrollImportBatches)
      .orderBy(desc(payrollImportBatches.createdAt));
  }
  
  async getPayrollImportBatchByPeriod(year: number, month: number): Promise<PayrollImportBatch | undefined> {
    const [batch] = await db.select()
      .from(payrollImportBatches)
      .where(and(
        eq(payrollImportBatches.payPeriodYear, year),
        eq(payrollImportBatches.payPeriodMonth, month),
        eq(payrollImportBatches.status, 'completed')
      ))
      .limit(1);
    return batch;
  }
  
  async checkDuplicatePayrollRecord(employeeCode: string, year: number, month: number): Promise<boolean> {
    const [existing] = await db.select()
      .from(payrollRecords)
      .where(and(
        eq(payrollRecords.employeeCode, employeeCode),
        eq(payrollRecords.payPeriodYear, year),
        eq(payrollRecords.payPeriodMonth, month)
      ))
      .limit(1);
    return !!existing;
  }
  
  // Claims methods
  async createClaim(claim: InsertClaim): Promise<Claim> {
    const [created] = await db.insert(claims).values(claim).returning();
    return created;
  }
  
  async updateClaim(id: string, updates: Partial<Claim>): Promise<Claim | undefined> {
    const [updated] = await db.update(claims)
      .set(updates)
      .where(eq(claims.id, id))
      .returning();
    return updated;
  }
  
  async getClaim(id: string): Promise<Claim | undefined> {
    const [claim] = await db.select()
      .from(claims)
      .where(eq(claims.id, id))
      .limit(1);
    return claim;
  }
  
  async getClaimsByUser(userId: string): Promise<Claim[]> {
    return await db.select()
      .from(claims)
      .where(eq(claims.userId, userId))
      .orderBy(desc(claims.submittedAt));
  }
  
  async getAllClaims(): Promise<Claim[]> {
    return await db.select()
      .from(claims)
      .orderBy(desc(claims.submittedAt));
  }
  
  async getClaimsByPeriod(year: number, month: number): Promise<Claim[]> {
    return await db.select()
      .from(claims)
      .where(and(
        eq(claims.claimYear, year),
        eq(claims.claimMonth, month)
      ))
      .orderBy(desc(claims.submittedAt));
  }
  
  async getPendingClaimsCount(): Promise<number> {
    const result = await db.select({ count: sql<number>`count(*)` })
      .from(claims)
      .where(eq(claims.status, 'pending'));
    return Number(result[0]?.count || 0);
  }
  
  async getApprovedClaimsForPayslip(userId: string, year: number, month: number): Promise<Claim[]> {
    return await db.select()
      .from(claims)
      .where(and(
        eq(claims.userId, userId),
        eq(claims.claimYear, year),
        eq(claims.claimMonth, month),
        eq(claims.status, 'approved')
      ))
      .orderBy(desc(claims.submittedAt));
  }
  
  async deleteClaim(id: string): Promise<void> {
    await db.delete(claims).where(eq(claims.id, id));
  }
  
  async createClaimsAuditLog(log: {
    claimId: string;
    userId: string;
    employeeCode: string | null;
    employeeName: string | null;
    claimType: string;
    amount: string;
    description: string | null;
    claimMonth: number;
    claimYear: number;
    action: string;
    previousStatus: string | null;
    performedBy: string;
    performedByName: string | null;
    comments: string | null;
  }): Promise<void> {
    await db.insert(claimsAuditLog).values(log);
  }
  
  async getClaimsAuditLogs(month?: number, year?: number): Promise<any[]> {
    if (month && year) {
      return await db.select()
        .from(claimsAuditLog)
        .where(and(
          eq(claimsAuditLog.claimMonth, month),
          eq(claimsAuditLog.claimYear, year)
        ))
        .orderBy(desc(claimsAuditLog.performedAt));
    }
    return await db.select()
      .from(claimsAuditLog)
      .orderBy(desc(claimsAuditLog.performedAt));
  }
  
  // Employee document methods
  async createEmployeeDocument(doc: InsertEmployeeDocument): Promise<EmployeeDocument> {
    const result = await db.insert(employeeDocuments).values(doc).returning();
    return result[0];
  }
  
  async getEmployeeDocuments(userId: string): Promise<EmployeeDocument[]> {
    return await db.select()
      .from(employeeDocuments)
      .where(eq(employeeDocuments.userId, userId))
      .orderBy(desc(employeeDocuments.uploadedAt));
  }
  
  async getEmployeeDocument(id: string): Promise<EmployeeDocument | undefined> {
    const result = await db.select()
      .from(employeeDocuments)
      .where(eq(employeeDocuments.id, id))
      .limit(1);
    return result[0];
  }
  
  async deleteEmployeeDocument(id: string): Promise<void> {
    await db.delete(employeeDocuments).where(eq(employeeDocuments.id, id));
  }

  // ─── Announcements ───────────────────────────────────────────────────────
  async getActiveAnnouncements(): Promise<Announcement[]> {
    return await db.select()
      .from(announcements)
      .where(eq(announcements.isActive, true))
      .orderBy(desc(announcements.createdAt));
  }

  async getAllAnnouncements(): Promise<Announcement[]> {
    return await db.select()
      .from(announcements)
      .orderBy(desc(announcements.createdAt));
  }

  async createAnnouncement(data: InsertAnnouncement): Promise<Announcement> {
    const [created] = await db.insert(announcements).values(data).returning();
    return created;
  }

  async updateAnnouncement(id: string, updates: Partial<InsertAnnouncement>): Promise<Announcement | undefined> {
    const [updated] = await db.update(announcements)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(announcements.id, id))
      .returning();
    return updated;
  }

  async deleteAnnouncement(id: string): Promise<void> {
    await db.delete(announcements).where(eq(announcements.id, id));
  }

  // ─── Leave Types ─────────────────────────────────────────────────────────
  async getAllLeaveTypes(): Promise<LeaveTypeRow[]> {
    return await db.select().from(leaveTypesTable).orderBy(asc(leaveTypesTable.sortOrder), asc(leaveTypesTable.label));
  }

  async getActiveLeaveTypes(): Promise<LeaveTypeRow[]> {
    return await db.select().from(leaveTypesTable)
      .where(eq(leaveTypesTable.isActive, true))
      .orderBy(asc(leaveTypesTable.sortOrder), asc(leaveTypesTable.label));
  }

  async getLeaveTypeById(id: string): Promise<LeaveTypeRow | undefined> {
    const [row] = await db.select().from(leaveTypesTable).where(eq(leaveTypesTable.id, id)).limit(1);
    return row;
  }

  async createLeaveType(data: InsertLeaveType): Promise<LeaveTypeRow> {
    const [created] = await db.insert(leaveTypesTable).values(data).returning();
    return created;
  }

  // PATCH — does NOT allow changing `code` (immutable). Caller must strip.
  async updateLeaveType(id: string, updates: Partial<Omit<InsertLeaveType, "code">>): Promise<LeaveTypeRow | undefined> {
    const [updated] = await db.update(leaveTypesTable)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(leaveTypesTable.id, id))
      .returning();
    return updated;
  }

  // ─── Per-Employee Accrual Overrides ──────────────────────────────────────
  async getAllOverrides(): Promise<EmployeeLeaveAccrualOverride[]> {
    return await db.select().from(employeeLeaveAccrualOverrides).orderBy(desc(employeeLeaveAccrualOverrides.createdAt));
  }

  async createOverride(data: InsertEmployeeLeaveAccrualOverride): Promise<EmployeeLeaveAccrualOverride> {
    const [created] = await db.insert(employeeLeaveAccrualOverrides).values(data).returning();
    return created;
  }

  async updateOverride(id: string, updates: Partial<InsertEmployeeLeaveAccrualOverride>): Promise<EmployeeLeaveAccrualOverride | undefined> {
    const [updated] = await db.update(employeeLeaveAccrualOverrides)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(employeeLeaveAccrualOverrides.id, id))
      .returning();
    return updated;
  }

  async deleteOverride(id: string): Promise<void> {
    await db.delete(employeeLeaveAccrualOverrides).where(eq(employeeLeaveAccrualOverrides.id, id));
  }

  // ─── Accrual Runs (idempotency ledger) ───────────────────────────────────
  async getRecentAccrualRuns(limit = 12): Promise<LeaveAccrualRun[]> {
    return await db.select().from(leaveAccrualRuns)
      .orderBy(desc(leaveAccrualRuns.startedAt))
      .limit(limit);
  }

  // Returns null if a run for this (year, month) already exists (unique violation caught).
  async startAccrualRun(year: number, month: number, triggeredBy: string): Promise<LeaveAccrualRun | null> {
    try {
      const [run] = await db.insert(leaveAccrualRuns)
        .values({ year, month, triggeredBy, status: "running" })
        .returning();
      return run;
    } catch (err) {
      // Unique (year, month) violation = already accrued
      const msg = (err as Error).message || "";
      if (msg.includes("duplicate key") || msg.includes("unique")) return null;
      throw err;
    }
  }

  async completeAccrualRun(id: string, rowsTouched: number): Promise<void> {
    await db.update(leaveAccrualRuns)
      .set({ status: "completed", completedAt: new Date(), rowsTouched })
      .where(eq(leaveAccrualRuns.id, id));
  }

  async failAccrualRun(id: string, errorMessage: string): Promise<void> {
    await db.update(leaveAccrualRuns)
      .set({ status: "failed", completedAt: new Date(), errorMessage })
      .where(eq(leaveAccrualRuns.id, id));
  }

  // ─── Balance Transactions (audit ledger) ─────────────────────────────────
  async recordBalanceTransaction(tx: {
    userId: string; leaveTypeCode: string; year: number;
    delta: number; source: string; sourceRefId?: string | null; notes?: string | null;
  }): Promise<void> {
    await db.insert(leaveBalanceTransactions).values({
      userId: tx.userId,
      leaveTypeCode: tx.leaveTypeCode,
      year: tx.year,
      delta: String(tx.delta),
      source: tx.source,
      sourceRefId: tx.sourceRefId ?? null,
      notes: tx.notes ?? null,
    });
  }

  async getTransactionsForUser(userId: string, limit = 50): Promise<LeaveBalanceTransaction[]> {
    return await db.select().from(leaveBalanceTransactions)
      .where(eq(leaveBalanceTransactions.userId, userId))
      .orderBy(desc(leaveBalanceTransactions.createdAt))
      .limit(limit);
  }

  // ─── Monthly Accrual (idempotent; caller must hold an accrual_runs row) ──
  // For each active leave type × non-archived user:
  //   - lazy-create the leave_balances row using type.initial_balance as brought_forward
  //   - add (base + override) to balance and earned via SQL numeric arithmetic
  //   - write one ledger row per non-zero delta
  // Returns the count of (user, type) pairs touched.
  async runMonthlyLeaveAccrual(year: number, runId: string, asOf: Date = new Date()): Promise<number> {
    const types = await this.getActiveLeaveTypes();
    const activeUsers = await db.select().from(users).where(eq(users.isArchived, false));
    const overrides = await db.select().from(employeeLeaveAccrualOverrides);
    const overrideMap = new Map<string, number>();
    for (const o of overrides) {
      overrideMap.set(`${o.userId}|${o.leaveTypeCode}`, parseFloat(o.extraMonthlyAccrual));
    }

    let touched = 0;

    for (const type of types) {
      const baseRaw = type.accrualStrategy === "tenure_al" ? null : parseFloat(type.monthlyAccrual);
      for (const user of activeUsers) {
        const base = baseRaw !== null ? baseRaw : alAccrualForUser(user.joinDate, asOf);
        const extra = overrideMap.get(`${user.id}|${type.code}`) || 0;
        const totalAdd = base + extra;
        if (totalAdd === 0 && parseFloat(type.initialBalance) === 0) continue;

        // Lazy-create or update the leave_balances row using SQL numeric arithmetic
        const [existing] = await db.select().from(leaveBalances)
          .where(and(
            eq(leaveBalances.userId, user.id),
            eq(leaveBalances.leaveType, type.code),
            eq(leaveBalances.year, year),
          ))
          .limit(1);

        if (!existing) {
          // Lazy create — seed with initial_balance + this month's accrual
          const initialBal = parseFloat(type.initialBalance);
          await db.insert(leaveBalances).values({
            userId: user.id,
            employeeCode: user.employeeCode || null,
            employeeName: user.name || null,
            leaveType: type.code,
            year,
            broughtForward: type.initialBalance,
            earned: String(totalAdd),
            eligible: String(initialBal + totalAdd),
            taken: "0",
            balance: String(initialBal + totalAdd),
          });
          if (initialBal !== 0) {
            await this.recordBalanceTransaction({
              userId: user.id, leaveTypeCode: type.code, year,
              delta: initialBal, source: "initial_seed", sourceRefId: runId,
              notes: `Auto-seeded with ${type.label} initial balance`,
            });
          }
        } else {
          // Add base + extra in SQL — no JS float accumulation across runs
          await db.update(leaveBalances)
            .set({
              earned: sql`(${leaveBalances.earned})::numeric + ${totalAdd}`,
              balance: sql`(${leaveBalances.balance})::numeric + ${totalAdd}`,
              eligible: sql`(${leaveBalances.eligible})::numeric + ${totalAdd}`,
              updatedAt: new Date(),
            })
            .where(eq(leaveBalances.id, existing.id));
        }

        // Ledger entries (split base vs override for traceability)
        if (base !== 0) {
          await this.recordBalanceTransaction({
            userId: user.id, leaveTypeCode: type.code, year,
            delta: base, source: "monthly_accrual", sourceRefId: runId,
            notes: type.accrualStrategy === "tenure_al" ? "AL tenure-scaled" : null,
          });
        }
        if (extra !== 0) {
          await this.recordBalanceTransaction({
            userId: user.id, leaveTypeCode: type.code, year,
            delta: extra, source: "override_accrual", sourceRefId: runId,
            notes: "Per-employee override",
          });
        }

        touched++;
      }
    }
    return touched;
  }
}

// ─── Helper: AL tenure-based monthly accrual ──────────────────────────────
// MOM minimum: 7 days at year 1, +1/year, capped at 14.
// Exported for testing.
export function alAccrualForUser(joinDateText: string | null, asOf: Date): number {
  const join = parseDDMMYYYY(joinDateText);
  if (!join) return 7 / 12;  // safe default if join_date missing or malformed
  const yrs = (asOf.getTime() - join.getTime()) / (365.25 * 86400000);
  const fullYears = Math.floor(yrs);
  const annual = Math.min(7 + Math.max(0, fullYears - 1), 14);
  return annual / 12;
}

function parseDDMMYYYY(s: string | null): Date | null {
  if (!s) return null;
  const m = s.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  const d = new Date(`${yyyy}-${mm}-${dd}T00:00:00Z`);
  return isNaN(d.getTime()) ? null : d;
}

export const storage = new PgStorage();
