import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { randomBytes } from "crypto";
import { storage } from "./storage";
import { z } from "zod";
import bcrypt from "bcryptjs";
import QRCode from "qrcode";
import * as XLSX from "xlsx";
import multer from "multer";
import { registerUserSchema, loginUserSchema, leaveHistory, leaveBalances } from "@shared/schema";
import { ObjectStorageService } from "./objectStorage";
import { Resend } from "resend";
import { Pool } from "pg";
import { db } from "./db";
import { eq, and } from "drizzle-orm";

// Create a pool for raw SQL queries (used by tools API)
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max file size
  },
  fileFilter: (_req, file, cb) => {
    const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/jpg'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only PDF, JPEG, and PNG files are allowed.'));
    }
  }
});

/**
 * Helper to convert PostgreSQL numeric strings to numbers.
 * PostgreSQL numeric type returns strings in JavaScript for precision.
 * Use this for monetary fields that are stored as numeric(12,2) or similar.
 * 
 * IMPORTANT: This function returns 0 for null/undefined values.
 * If you need to preserve null semantics, use parseNumericOrNull instead.
 */
function parseNumeric(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return value;
  const parsed = parseFloat(value);
  return isNaN(parsed) ? 0 : parsed;
}

/**
 * Helper to convert PostgreSQL numeric strings to numbers, preserving null.
 * Use this when null has semantic meaning (e.g., "not set" vs "set to 0").
 */
function parseNumericOrNull(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return value;
  const parsed = parseFloat(value);
  return isNaN(parsed) ? null : parsed;
}

/**
 * Rounds a dollar amount to 2 decimal places using banker's rounding.
 * Use this for all monetary calculations to maintain consistent precision.
 */
function roundToDollars(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Convert a number to a string for PostgreSQL numeric columns.
 * Use this when inserting/updating numeric columns which expect string values.
 */
function toNumericString(value: number): string {
  return value.toFixed(2);
}

// Initialize Resend email client
const resend = process.env.RESEND_API ? new Resend(process.env.RESEND_API) : null;

// Address cache for server-side geocoding
const serverAddressCache: Record<string, string> = {};
const SERVER_GEOCODE_DELAY_MS = 1100; // 1.1 second delay between requests

// Promise chain to serialize geocode requests - ensures only one request at a time
let geocodeQueue: Promise<void> = Promise.resolve();

// Internal function that performs the actual geocoding using OpenStreetMap Nominatim
async function performGeocode(lat: string, lng: string): Promise<string> {
  const cacheKey = `${lat},${lng}`;
  
  // Check cache first (already checked in wrapper, but double-check for safety)
  if (serverAddressCache[cacheKey]) {
    return serverAddressCache[cacheKey];
  }
  
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`;
    
    const response = await fetch(url, {
      headers: {
        'Accept-Language': 'en',
        'User-Agent': 'NexaHR-HRMS/1.0'
      }
    });
    
    if (!response.ok) {
      throw new Error(`Geocoding failed with status ${response.status}`);
    }
    
    const data = await response.json();
    
    // Build a short address from components
    const address = data.address || {};
    const parts: string[] = [];
    
    if (address.road || address.street) {
      parts.push(address.road || address.street);
    }
    if (address.suburb || address.neighbourhood) {
      parts.push(address.suburb || address.neighbourhood);
    }
    if (address.city || address.town || address.village) {
      parts.push(address.city || address.town || address.village);
    }
    
    const shortAddress = parts.length > 0 ? parts.join(', ') : data.display_name?.split(',').slice(0, 3).join(',') || 'Unknown location';
    serverAddressCache[cacheKey] = shortAddress;
    return shortAddress;
  } catch (error) {
    console.error('Server reverse geocoding error:', error);
    const fallback = `${parseFloat(lat).toFixed(4)}, ${parseFloat(lng).toFixed(4)}`;
    serverAddressCache[cacheKey] = fallback;
    return fallback;
  }
}

// Server-side reverse geocoding function with proper serialization
// This queues requests to ensure only one geocode call happens at a time with proper spacing
async function serverReverseGeocode(lat: string, lng: string): Promise<string> {
  const cacheKey = `${lat},${lng}`;
  
  // Return cached result immediately if available
  if (serverAddressCache[cacheKey]) {
    return serverAddressCache[cacheKey];
  }
  
  // Create a new promise that chains after the current queue
  // This ensures requests are processed sequentially with proper delays
  return new Promise<string>((resolve, reject) => {
    geocodeQueue = geocodeQueue.then(async () => {
      try {
        // Check cache again in case a previous queued request already resolved this
        if (serverAddressCache[cacheKey]) {
          resolve(serverAddressCache[cacheKey]);
          return;
        }
        
        // Perform the geocoding
        const result = await performGeocode(lat, lng);
        resolve(result);
        
        // Wait the required delay before allowing next request
        await new Promise(r => setTimeout(r, SERVER_GEOCODE_DELAY_MS));
      } catch (error) {
        reject(error);
      }
    }).catch(() => {
      // Keep the queue alive even if one request fails
    });
  });
}

// Admin credentials
const ADMIN_CREDENTIALS = {
  username: "nexaadmin",
  password: "jc123!",
};

// Super admin emails - only these users can archive/unarchive employees
const SUPER_ADMIN_EMAILS = [
  "rebekah.sr@3si.com.sg",
];

// Helper function to check if current session is a super admin
async function isSuperAdmin(session: any, storage: any): Promise<boolean> {
  // Master admin (nexaadmin) is always a super admin
  if (session.userId === "admin") {
    return true;
  }
  
  // Check if the logged-in admin's email is in the super admin list
  if (session.userId) {
    const user = await storage.getUser(session.userId);
    if (user && user.email && SUPER_ADMIN_EMAILS.includes(user.email.toLowerCase())) {
      return true;
    }
  }
  
  return false;
}

// Generate temporary password for welcome emails
function generateTempPassword(employeeCode: string): string {
  const randomPart = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `${employeeCode}@${randomPart}`;
}

// Default user credentials (for development/testing)
const DEFAULT_USER = {
  username: "nexauser",
  password: "nexa123!",
  email: "nexauser@nexahr.com",
  name: "Nexa User",
  mobileNumber: "+1234567890",
};

// Seed default user (call this on server startup)
async function seedDefaultUser() {
  try {
    // Check if default user already exists
    const existingUser = await storage.getUserByUsername(DEFAULT_USER.username);
    if (!existingUser) {
      console.log("Seeding default user...");
      const passwordHash = await bcrypt.hash(DEFAULT_USER.password, 10);
      await storage.createUser({
        username: DEFAULT_USER.username,
        email: DEFAULT_USER.email,
        name: DEFAULT_USER.name,
        passwordHash,
        mobileNumber: DEFAULT_USER.mobileNumber,
        role: "user",
        isApproved: true, // Default user is pre-approved
      });
      console.log("Default user created successfully!");
    }
  } catch (error) {
    console.error("Error seeding default user:", error);
  }
}

// ---------------------------------------------------------------------------
// Auto-regenerate payroll when attendance adjustments change
// ---------------------------------------------------------------------------
const regenLocks = new Map<string, boolean>();
const regenTimers = new Map<string, NodeJS.Timeout>();

function triggerAutoPayrollRegen(date: string) {
  const [yearStr, monthStr] = date.split('-');
  const autoYear = parseInt(yearStr, 10);
  const autoMonth = parseInt(monthStr, 10);
  const key = `${autoYear}-${autoMonth}`;

  clearTimeout(regenTimers.get(key));
  regenTimers.set(key, setTimeout(async () => {
    if (regenLocks.get(key)) return;
    regenLocks.set(key, true);
    try {
      const existing = await storage.getPayrollRecords(autoYear, autoMonth);
      if (existing.length > 0) {
        await storage.deletePayrollRecordsByPeriod(autoYear, autoMonth);
        const { generatePayrollForPeriod } = await import("./payrollService");
        await generatePayrollForPeriod(autoYear, autoMonth, {
          suppressAllOT: true,
          importedBy: 'auto-regen',
        });
        console.log(`[auto-regen] Payroll regenerated for ${autoMonth}/${autoYear}`);
      }
    } catch (err) {
      console.error('[auto-regen] Payroll regeneration failed:', { error: err, year: autoYear, month: autoMonth });
    } finally {
      regenLocks.delete(key);
    }
  }, 1000));
}

export async function registerRoutes(app: Express): Promise<Server> {
  // Seed default user on startup
  await seedDefaultUser();

  // Admin login
  app.post("/api/admin/login", async (req: Request, res: Response) => {
    try {
      const schema = z.object({
        username: z.string(),
        password: z.string(),
      });

      const { username, password } = schema.parse(req.body);
      console.log('Admin login attempt:', { username, passwordLength: password.length });

      // First check hardcoded master admin credentials
      if (username === ADMIN_CREDENTIALS.username && password === ADMIN_CREDENTIALS.password) {
        req.session.userId = "admin";
        req.session.isAdmin = true;
        console.log('Master admin login successful, session:', { userId: req.session.userId, isAdmin: req.session.isAdmin });
        // Ensure session is saved before responding
        return req.session.save((err) => {
          if (err) {
            console.error('Session save error:', err);
            return res.status(500).json({ message: "Session save failed" });
          }
          return res.json({ success: true, message: "Admin login successful" });
        });
      }

      // Then check database users with role='admin', 'viewonly_admin', or 'attendance_view_admin'
      const user = await storage.getUserByUsername(username);
      
      // Define admin roles that can log in via admin portal
      const adminRoles = ["admin", "viewonly_admin", "attendance_view_admin", "employee_data_admin"];
      
      // If user exists but is not an admin role, reject with helpful message
      if (user && !adminRoles.includes(user.role)) {
        return res.status(403).json({ message: "Please use the Employee Login page to access your account" });
      }
      
      if (user && adminRoles.includes(user.role) && user.isApproved) {
        // Block archived admin accounts
        if (user.isArchived) {
          return res.status(403).json({ message: "This account has been deactivated." });
        }
        // Security: Only allow login if user has a valid password hash
        if (!user.passwordHash) {
          console.log(`Admin login rejected: User ${username} has no password set`);
          return res.status(401).json({ message: "Invalid credentials" });
        }
        const passwordValid = await bcrypt.compare(password, user.passwordHash);
        if (passwordValid) {
          req.session.userId = user.id;
          req.session.isAdmin = true;
          req.session.isViewOnlyAdmin = user.role === "viewonly_admin";
          req.session.isAttendanceViewAdmin = user.role === "attendance_view_admin";
          req.session.isEmployeeDataAdmin = user.role === "employee_data_admin";
          // Record login history (fire-and-forget)
          const adminIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || null;
          storage.createUserSession({
            sessionId: req.sessionID,
            userId: user.id,
            userAgent: req.headers['user-agent'] || null,
            ipAddress: adminIp,
          }).catch(err => console.error('Failed to record admin login history:', err));
          return res.json({ success: true, message: "Admin login successful" });
        }
      }

      return res.status(401).json({ message: "Invalid credentials" });
    } catch (error) {
      return res.status(400).json({ message: "Invalid request" });
    }
  });

  // Admin logout
  app.post("/api/admin/logout", async (req: Request, res: Response) => {
    req.session.destroy((err) => {
      if (err) {
        return res.status(500).json({ message: "Failed to logout" });
      }
      res.json({ success: true, message: "Logged out successfully" });
    });
  });

  // Login history (admin only)
  app.get("/api/admin/login-history", async (req: Request, res: Response) => {
    if (!req.session?.isAdmin) {
      return res.status(403).json({ message: "Admin access required" });
    }
    try {
      const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);
      const history = await storage.getAllLoginHistory(limit);
      res.json(history);
    } catch (error) {
      console.error("Login history error:", error);
      res.status(500).json({ message: "Failed to fetch login history" });
    }
  });

  // Get current session
  app.get("/api/auth/session", async (req: Request, res: Response) => {
    // Debug logging
    console.log('Session check:', {
      hasSession: !!req.session,
      sessionId: req.sessionID,
      userId: req.session?.userId,
      cookie: req.session?.cookie,
    });

    if (req.session.userId) {
      if (req.session.isAdmin) {
        // Check if it's the master admin or a database admin user
        if (req.session.userId === "admin") {
          return res.json({
            authenticated: true,
            isAdmin: true,
            isMasterAdmin: true,
            user: { id: "admin", name: "Admin", email: "admin@nexahr.com" },
          });
        }
        // Database admin user (admin, viewonly_admin, or attendance_view_admin)
        const adminUser = await storage.getUser(req.session.userId);
        if (adminUser) {
          return res.json({
            authenticated: true,
            isAdmin: true,
            isViewOnlyAdmin: req.session.isViewOnlyAdmin || false,
            isAttendanceViewAdmin: req.session.isAttendanceViewAdmin || false,
            isEmployeeDataAdmin: req.session.isEmployeeDataAdmin || false,
            user: {
              id: adminUser.id,
              name: adminUser.name,
              email: adminUser.email,
            },
          });
        }
      }

      const user = await storage.getUser(req.session.userId);
      if (user) {
        return res.json({
          authenticated: true,
          isAdmin: false,
          user: {
            id: user.id,
            name: user.name,
            email: user.email,
            isApproved: user.isApproved,
            mustChangePassword: user.mustChangePassword || false,
          },
        });
      }
    }

    return res.json({ authenticated: false });
  });

  // User logout
  app.post("/api/auth/logout", async (req: Request, res: Response) => {
    req.session.destroy((err) => {
      if (err) {
        return res.status(500).json({ message: "Failed to logout" });
      }
      res.json({ success: true, message: "Logged out successfully" });
    });
  });

  // Change password endpoint (for first-time login or voluntary change)
  app.post("/api/auth/change-password", async (req: Request, res: Response) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ message: "Authentication required" });
      }

      const schema = z.object({
        currentPassword: z.string().min(1, "Current password is required"),
        newPassword: z.string().min(8, "New password must be at least 8 characters"),
        confirmPassword: z.string(),
      }).refine((data) => data.newPassword === data.confirmPassword, {
        message: "Passwords don't match",
        path: ["confirmPassword"],
      }).refine((data) => data.currentPassword !== data.newPassword, {
        message: "New password must be different from current password",
        path: ["newPassword"],
      });

      const { currentPassword, newPassword } = schema.parse(req.body);

      const user = await storage.getUser(req.session.userId);
      if (!user || !user.passwordHash) {
        return res.status(404).json({ message: "User not found" });
      }

      // Verify current password
      const isValidPassword = await bcrypt.compare(currentPassword, user.passwordHash);
      if (!isValidPassword) {
        return res.status(401).json({ message: "Current password is incorrect" });
      }

      // Hash new password and update user
      const newPasswordHash = await bcrypt.hash(newPassword, 10);
      await storage.updateUser(user.id, {
        passwordHash: newPasswordHash,
        mustChangePassword: false,
      });

      res.json({ 
        success: true, 
        message: "Password changed successfully" 
      });
    } catch (error) {
      console.error("Change password error:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: error.errors[0].message });
      }
      res.status(500).json({ message: "Failed to change password" });
    }
  });

  // User registration endpoint (with password)
  app.post("/api/auth/register", async (req: Request, res: Response) => {
    try {
      const validatedData = registerUserSchema.parse(req.body);
      const { name, username, email, password, mobileNumber } = validatedData;

      // Check if user already exists
      const existingUser = await storage.getUserByEmailOrUsername(email, username);
      if (existingUser) {
        return res.status(400).json({ message: "User with this email or username already exists" });
      }

      // Hash password
      const passwordHash = await bcrypt.hash(password, 10);

      // Create new user (approved by default)
      const user = await storage.createUser({
        email,
        username,
        name,
        passwordHash,
        mobileNumber,
        authId: null,
        role: "user",
        isApproved: true,
      });

      // Set session for the user
      req.session.userId = user.id;
      req.session.isAdmin = false;

      res.json({ 
        success: true, 
        user: { 
          id: user.id, 
          email: user.email, 
          username: user.username,
          name: user.name, 
          isApproved: user.isApproved 
        } 
      });
    } catch (error) {
      console.error("Registration error:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: error.errors[0].message });
      }
      res.status(400).json({ message: "Registration failed" });
    }
  });

  // User login endpoint
  app.post("/api/auth/login", async (req: Request, res: Response) => {
    try {
      const validatedData = loginUserSchema.parse(req.body);
      const { usernameOrEmail, password } = validatedData;

      // Find user by username or email
      const user = await storage.getUserByEmailOrUsername(usernameOrEmail, usernameOrEmail);
      
      if (!user || !user.passwordHash) {
        return res.status(401).json({ message: "Invalid credentials" });
      }

      // Admin users cannot log in through user login - they must use admin login
      if (user.role === "admin") {
        return res.status(403).json({ message: "Please use the Admin Login page to access your account" });
      }

      // Check password
      const isValidPassword = await bcrypt.compare(password, user.passwordHash);
      if (!isValidPassword) {
        return res.status(401).json({ message: "Invalid credentials" });
      }

      // Check if user is approved BEFORE setting session
      if (!user.isApproved) {
        return res.status(403).json({ message: "Account pending approval" });
      }

      // Block archived users (except nexauser test account)
      if (user.isArchived && user.email !== 'nexauser@nexahr.com') {
        return res.status(403).json({ message: "This account has been deactivated. Please contact HR." });
      }

      // Block users whose resign date has passed
      if (user.resignDate) {
        const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Singapore" });
        if (user.resignDate <= today) {
          return res.status(403).json({ message: "This account has been deactivated. Please contact HR." });
        }
      }

      // Only set session for approved, active users
      req.session.userId = user.id;
      req.session.isAdmin = false;

      // Record login history (fire-and-forget — never block login on history failure)
      const employeeIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || null;
      storage.createUserSession({
        sessionId: req.sessionID,
        userId: user.id,
        userAgent: req.headers['user-agent'] || null,
        ipAddress: employeeIp,
      }).catch(err => console.error('Failed to record login history:', err));

      // Debug logging
      console.log('Login successful, session created:', {
        userId: req.session.userId,
        sessionId: req.sessionID,
        cookie: req.session.cookie,
        headers: req.headers,
      });

      res.json({ 
        success: true, 
        user: { 
          id: user.id, 
          email: user.email,
          username: user.username, 
          name: user.name,
          isApproved: user.isApproved,
          mustChangePassword: user.mustChangePassword || false
        } 
      });
    } catch (error) {
      console.error("Login error:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: error.errors[0].message });
      }
      res.status(400).json({ message: "Login failed" });
    }
  });

  // Google OAuth login route (using Replit Auth)
  app.get("/api/login", (req, res) => {
    // This will be handled by Replit Auth in future implementation
    // For now, redirect to Google OAuth placeholder
    res.redirect("https://replit.com/oidc");
  });

  // Admin middleware - check if user is admin
  const requireAdmin = (req: Request, res: Response, next: any) => {
    console.log('requireAdmin check:', { 
      path: req.path, 
      userId: req.session.userId, 
      isAdmin: req.session.isAdmin,
      sessionId: req.sessionID 
    });
    if (!req.session.isAdmin) {
      return res.status(403).json({ message: "Unauthorized - Admin access required" });
    }
    next();
  };
  
  // Middleware to block view-only admins from write operations
  const requireWriteAccess = (req: Request, res: Response, next: any) => {
    if (req.session.isViewOnlyAdmin || req.session.isAttendanceViewAdmin) {
      return res.status(403).json({ message: "View-only admins cannot perform this action" });
    }
    next();
  };
  
  // Middleware to block attendance-only admins from non-attendance routes
  const requireFullAdmin = (req: Request, res: Response, next: any) => {
    if (req.session.isAttendanceViewAdmin) {
      return res.status(403).json({ message: "Attendance view-only admins cannot access this feature" });
    }
    if (req.session.isEmployeeDataAdmin) {
      return res.status(403).json({ message: "Employee data admins cannot access this feature" });
    }
    next();
  };
  
  // Middleware to allow only employee data admins and full admins for employee data routes
  const requireEmployeeDataAccess = (req: Request, res: Response, next: any) => {
    // Full admins and employee data admins can access
    if (req.session.isEmployeeDataAdmin || 
        (!req.session.isViewOnlyAdmin && !req.session.isAttendanceViewAdmin)) {
      return next();
    }
    return res.status(403).json({ message: "You do not have access to employee data management" });
  };
  
  // Middleware for master admin (nexaadmin) only operations
  const requireMasterAdmin = (req: Request, res: Response, next: any) => {
    if (req.session.userId !== "admin") {
      return res.status(403).json({ message: "Only master admin can access this feature" });
    }
    next();
  };

  // Get all users (admin only)
  app.get("/api/admin/users", requireAdmin, async (req: Request, res: Response) => {
    try {
      const users = await storage.getAllUsers();
      res.json(users);
    } catch (error) {
      console.error("Get users error:", error);
      res.status(500).json({ message: "Failed to fetch users" });
    }
  });
  
  // Get archived users (admin only)
  app.get("/api/admin/users/archived", requireAdmin, async (req: Request, res: Response) => {
    try {
      const archivedUsers = await storage.getArchivedUsers();
      res.json(archivedUsers);
    } catch (error) {
      console.error("Get archived users error:", error);
      res.status(500).json({ message: "Failed to fetch archived users" });
    }
  });
  
  // Check if current admin is a super admin
  app.get("/api/admin/is-super-admin", requireAdmin, async (req: Request, res: Response) => {
    try {
      const isSuper = await isSuperAdmin(req.session, storage);
      res.json({ isSuperAdmin: isSuper });
    } catch (error) {
      console.error("Check super admin error:", error);
      res.status(500).json({ message: "Failed to check super admin status" });
    }
  });

  // Archive users (super admin only)
  app.post("/api/admin/users/archive", requireAdmin, requireWriteAccess, async (req: Request, res: Response) => {
    try {
      // Check if user is a super admin
      const isSuper = await isSuperAdmin(req.session, storage);
      if (!isSuper) {
        return res.status(403).json({ message: "Only super admins can archive employees" });
      }
      
      const schema = z.object({
        userIds: z.array(z.string()).min(1, "At least one user ID is required"),
      });
      
      const { userIds } = schema.parse(req.body);
      await storage.archiveUsers(userIds);
      
      res.json({ success: true, message: `${userIds.length} user(s) archived` });
    } catch (error) {
      console.error("Archive users error:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: error.errors[0].message });
      }
      res.status(500).json({ message: "Failed to archive users" });
    }
  });
  
  // Unarchive users (super admin only)
  app.post("/api/admin/users/unarchive", requireAdmin, requireWriteAccess, async (req: Request, res: Response) => {
    try {
      // Check if user is a super admin
      const isSuper = await isSuperAdmin(req.session, storage);
      if (!isSuper) {
        return res.status(403).json({ message: "Only super admins can unarchive employees" });
      }
      
      const schema = z.object({
        userIds: z.array(z.string()).min(1, "At least one user ID is required"),
      });
      
      const { userIds } = schema.parse(req.body);
      await storage.unarchiveUsers(userIds);
      
      res.json({ success: true, message: `${userIds.length} user(s) unarchived` });
    } catch (error) {
      console.error("Unarchive users error:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: error.errors[0].message });
      }
      res.status(500).json({ message: "Failed to unarchive users" });
    }
  });

  app.post("/api/admin/users/delete", requireAdmin, requireWriteAccess, async (req: Request, res: Response) => {
    try {
      const isSuper = await isSuperAdmin(req.session, storage);
      if (!isSuper) {
        return res.status(403).json({ message: "Only super admins can delete employees" });
      }

      const schema = z.object({
        userId: z.string().min(1, "User ID is required"),
        reason: z.string().optional(),
      });

      const { userId, reason } = schema.parse(req.body);

      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ message: "Employee not found" });
      }

      if (user.role === "admin") {
        return res.status(403).json({ message: "Cannot delete admin users. Remove admin role first." });
      }

      const adminName = req.session.userId === "admin" ? "Master Admin" : (await storage.getUser(req.session.userId!))?.name || "Unknown";

      const fullSnapshot = JSON.stringify(user);

      const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        await client.query(`
          INSERT INTO employee_deletion_logs (employee_id, employee_code, employee_name, email, department, designation, section, role, join_date, resign_date, residency_status, basic_monthly_salary, nric_fin, mobile_number, full_snapshot, deleted_by, deleted_by_name, reason)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
        `, [
          user.id, user.employeeCode, user.name, user.email, user.department,
          user.designation, user.section, user.role, user.joinDate, user.resignDate,
          user.residencyStatus, user.basicMonthlySalary, user.nricFin, user.mobileNumber,
          fullSnapshot, req.session.userId, adminName, reason || null,
        ]);

        await client.query(`UPDATE attendance_adjustments SET created_by = 'deleted' WHERE created_by = $1`, [userId]);
        await client.query(`UPDATE employee_documents SET uploaded_by = NULL WHERE uploaded_by = $1`, [userId]);
        await client.query(`UPDATE claims SET reviewed_by = NULL WHERE reviewed_by = $1`, [userId]);
        await client.query(`UPDATE leave_applications SET uploaded_by = NULL WHERE uploaded_by = $1`, [userId]);
        await client.query(`UPDATE employee_salary_adjustments SET created_by = NULL WHERE created_by = $1`, [userId]);

        const tablesToClean = [
          'attendance_records', 'daily_attendance_summary', 'attendance_adjustments',
          'attendance_audit_logs', 'leave_balances', 'leave_applications', 'leave_history',
          'payroll_records', 'payroll_loan_accounts', 'payroll_loan_repayments',
          'payroll_adjustments', 'payslip_records', 'claims', 'claims_audit_log',
          'employee_documents', 'employee_salary_adjustments', 'employee_data_audit_logs',
          'employee_monthly_remarks', 'audit_logs', 'password_override_logs',
          'email_logs', 'login_challenges', 'user_sessions',
        ];
        for (const table of tablesToClean) {
          await client.query(`DELETE FROM ${table} WHERE user_id = $1`, [userId]);
        }
        await client.query(`DELETE FROM users WHERE id = $1`, [userId]);

        await client.query('COMMIT');
        res.json({ success: true, message: `Employee "${user.name}" has been permanently deleted` });
      } catch (txError) {
        await client.query('ROLLBACK');
        throw txError;
      } finally {
        client.release();
        await pool.end();
      }
    } catch (error) {
      console.error("Delete employee error:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: error.errors[0].message });
      }
      res.status(500).json({ message: "Failed to delete employee" });
    }
  });

  app.get("/api/admin/employee-deletion-logs", requireAdmin, async (req: Request, res: Response) => {
    try {
      const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
      try {
        const result = await pool.query(`SELECT * FROM employee_deletion_logs ORDER BY deleted_at DESC`);
        res.json(result.rows);
      } finally {
        await pool.end();
      }
    } catch (error) {
      console.error("Get deletion logs error:", error);
      res.status(500).json({ message: "Failed to fetch deletion logs" });
    }
  });

  // Set user role to attendance_view_admin (super admin only)
  app.post("/api/admin/users/:id/set-attendance-view-admin", requireAdmin, requireWriteAccess, async (req: Request, res: Response) => {
    try {
      // Check if user is a super admin
      const isSuper = await isSuperAdmin(req.session, storage);
      if (!isSuper) {
        return res.status(403).json({ message: "Only super admins can manage admin roles" });
      }
      
      const { id } = req.params;
      const user = await storage.getUser(id);
      
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      
      // Prevent modifying super admins
      if (user.role === "admin") {
        return res.status(400).json({ message: "Cannot modify full admin users" });
      }
      
      // Update user role to attendance_view_admin
      await storage.updateUser(id, { role: "attendance_view_admin" });
      
      res.json({ success: true, message: `${user.name} is now an Attendance View-Only Admin` });
    } catch (error) {
      console.error("Set attendance view admin error:", error);
      res.status(500).json({ message: "Failed to update user role" });
    }
  });
  
  // Remove attendance_view_admin role (demote back to user) (super admin only)
  app.post("/api/admin/users/:id/remove-attendance-view-admin", requireAdmin, requireWriteAccess, async (req: Request, res: Response) => {
    try {
      // Check if user is a super admin
      const isSuper = await isSuperAdmin(req.session, storage);
      if (!isSuper) {
        return res.status(403).json({ message: "Only super admins can manage admin roles" });
      }
      
      const { id } = req.params;
      const user = await storage.getUser(id);
      
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      
      // Only allow demoting attendance_view_admin users
      if (user.role !== "attendance_view_admin") {
        return res.status(400).json({ message: "User is not an Attendance View-Only Admin" });
      }
      
      // Update user role back to user
      await storage.updateUser(id, { role: "user" });
      
      res.json({ success: true, message: `${user.name} is no longer an Attendance View-Only Admin` });
    } catch (error) {
      console.error("Remove attendance view admin error:", error);
      res.status(500).json({ message: "Failed to update user role" });
    }
  });
  
  // Get all attendance view admins (super admin only)
  app.get("/api/admin/users/attendance-view-admins", requireAdmin, async (req: Request, res: Response) => {
    try {
      const allUsers = await storage.getAllUsers();
      const attendanceViewAdmins = allUsers.filter(u => u.role === "attendance_view_admin");
      res.json(attendanceViewAdmins);
    } catch (error) {
      console.error("Get attendance view admins error:", error);
      res.status(500).json({ message: "Failed to fetch attendance view admins" });
    }
  });

  // Set user role to employee_data_admin (super admin only)
  app.post("/api/admin/users/:id/set-employee-data-admin", requireAdmin, requireWriteAccess, requireFullAdmin, async (req: Request, res: Response) => {
    try {
      const isSuper = await isSuperAdmin(req.session, storage);
      if (!isSuper) {
        return res.status(403).json({ message: "Only super admins can manage admin roles" });
      }
      
      const { id } = req.params;
      const user = await storage.getUser(id);
      
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      
      if (user.role === "admin") {
        return res.status(400).json({ message: "Cannot modify full admin users" });
      }
      
      await storage.updateUser(id, { role: "employee_data_admin" });
      
      res.json({ success: true, message: `${user.name} is now an Employee Data Admin` });
    } catch (error) {
      console.error("Set employee data admin error:", error);
      res.status(500).json({ message: "Failed to update user role" });
    }
  });
  
  // Remove employee_data_admin role (demote back to user) (super admin only)
  app.post("/api/admin/users/:id/remove-employee-data-admin", requireAdmin, requireWriteAccess, requireFullAdmin, async (req: Request, res: Response) => {
    try {
      const isSuper = await isSuperAdmin(req.session, storage);
      if (!isSuper) {
        return res.status(403).json({ message: "Only super admins can manage admin roles" });
      }
      
      const { id } = req.params;
      const user = await storage.getUser(id);
      
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      
      if (user.role !== "employee_data_admin") {
        return res.status(400).json({ message: "User is not an Employee Data Admin" });
      }
      
      await storage.updateUser(id, { role: "user" });
      
      res.json({ success: true, message: `${user.name} is no longer an Employee Data Admin` });
    } catch (error) {
      console.error("Remove employee data admin error:", error);
      res.status(500).json({ message: "Failed to update user role" });
    }
  });
  
  // Get all employee data admins (full admins can view)
  app.get("/api/admin/users/employee-data-admins", requireAdmin, requireFullAdmin, async (req: Request, res: Response) => {
    try {
      const allUsers = await storage.getAllUsers();
      const employeeDataAdmins = allUsers.filter(u => u.role === "employee_data_admin");
      res.json(employeeDataAdmins);
    } catch (error) {
      console.error("Get employee data admins error:", error);
      res.status(500).json({ message: "Failed to fetch employee data admins" });
    }
  });

  // Approve user (admin only, write access required)
  app.post("/api/admin/users/:id/approve", requireAdmin, requireWriteAccess, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const user = await storage.approveUser(id);
      
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      
      res.json({ success: true, user });
    } catch (error) {
      console.error("Approve user error:", error);
      res.status(500).json({ message: "Failed to approve user" });
    }
  });

  // Save employee code for user (admin only, write access required) - used when linking payroll records
  app.post("/api/admin/users/:id/save-employee-code", requireAdmin, requireWriteAccess, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      
      const schema = z.object({
        employeeCode: z.string().min(1, "Employee code is required"),
      });
      
      const { employeeCode } = schema.parse(req.body);
      
      const user = await storage.getUser(id);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      
      const updatedUser = await storage.updateUser(id, { employeeCode });
      
      // Create audit log for this change
      if (user.employeeCode !== employeeCode) {
        await storage.createAuditLog({
          userId: id,
          changedBy: 'admin',
          fieldChanged: 'employeeCode',
          oldValue: user.employeeCode || null,
          newValue: employeeCode,
          changeType: 'update',
        });
      }
      
      res.json({ success: true, user: updatedUser });
    } catch (error) {
      console.error("Save employee code error:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: error.errors[0].message });
      }
      res.status(500).json({ message: "Failed to save employee code" });
    }
  });

  // Update user (admin only) with audit logging
  app.put("/api/admin/users/:id", requireAdmin, requireWriteAccess, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      
      // Get admin username for audit trail
      const adminUser = req.session?.userId 
        ? await storage.getUser(req.session.userId)
        : null;
      const changedBy = adminUser?.username || adminUser?.name || "nexaadmin";
      
      // Whitelist allowed fields - prevent updating sensitive fields like role, passwordHash
      const allowedFields = [
        'name', 'email', 'department', 'designation', 'employeeCode', 'section', 'shortName', 
        'mobileNumber', 'gender', 'joinDate', 'resignDate', 'nricFin', 'fingerId',
        'birthday', 'workPermitNumber', 'workPermitExpiry', 'finNumber', 'finNumberExpiry',
        'remarks1', 'remarks2', 'remarks3', 'remarks4',
        'basicMonthlySalary', 'weeklyContractHours', 'regularDaysPerWeek', 'hourlyRate', 'ot15Rate', 'ot20Rate',
        'defaultMobileAllowance', 'defaultTransportAllowance', 'defaultMealAllowance',
        'defaultShiftAllowance', 'defaultOtherAllowance', 'defaultHouseRentalAllowance'
      ];
      
      // Validate and sanitize input
      const updateSchema = z.object({
        name: z.string().min(1).optional(),
        email: z.string().email().optional(),
        department: z.string().optional(),
        designation: z.string().optional(),
        employeeCode: z.string().optional(),
        section: z.string().optional(),
        shortName: z.string().optional(),
        mobileNumber: z.string().optional(),
        gender: z.string().optional(),
        joinDate: z.string().optional(),
        resignDate: z.string().optional(),
        nricFin: z.string().optional(),
        fingerId: z.string().optional(),
        birthday: z.string().optional(),
        workPermitNumber: z.string().optional(),
        workPermitExpiry: z.string().optional(),
        finNumber: z.string().optional(),
        finNumberExpiry: z.string().optional(),
        remarks1: z.string().optional(),
        remarks2: z.string().optional(),
        remarks3: z.string().optional(),
        remarks4: z.string().optional(),
        basicMonthlySalary: z.string().optional().transform(v => v === '' ? null : v),
        weeklyContractHours: z.string().optional().transform(v => !v || v === '' ? null : parseFloat(v)),
        regularDaysPerWeek: z.string().optional().transform(v => !v || v === '' ? null : parseFloat(v)),
        hourlyRate: z.string().optional().transform(v => v === '' ? null : v),
        ot15Rate: z.string().optional().transform(v => v === '' ? null : v),
        ot20Rate: z.string().optional().transform(v => v === '' ? null : v),
        defaultMobileAllowance: z.string().optional().transform(v => v === '' ? null : v),
        defaultTransportAllowance: z.string().optional().transform(v => v === '' ? null : v),
        defaultMealAllowance: z.string().optional().transform(v => v === '' ? null : v),
        defaultShiftAllowance: z.string().optional().transform(v => v === '' ? null : v),
        defaultOtherAllowance: z.string().optional().transform(v => v === '' ? null : v),
        defaultHouseRentalAllowance: z.string().optional().transform(v => v === '' ? null : v),
      });
      
      const validatedData = updateSchema.parse(req.body);
      
      // Only include allowed fields
      const updates: Partial<typeof validatedData> = {};
      for (const field of allowedFields) {
        if (field in validatedData) {
          (updates as any)[field] = (validatedData as any)[field];
        }
      }
      
      // Get the old user data first for audit logging
      const oldUser = await storage.getUser(id);
      if (!oldUser) {
        return res.status(404).json({ message: "User not found" });
      }
      
      let user = await storage.updateUser(id, updates);

      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      // Smart auto-archive: if resign_date is today or in the past, archive the user
      if (user.resignDate && !user.isArchived) {
        const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Singapore" });
        if (user.resignDate <= today) {
          await storage.archiveUsers([id]);
          user = (await storage.getUser(id)) || user;
          console.log(`[Auto-archive] User ${id} (${user.name}) archived — resign_date ${user.resignDate} <= ${today}`);
        }
      }

      // Create audit logs for each changed field
      for (const field of allowedFields) {
        if ((updates as any)[field] !== undefined) {
          const oldValue = (oldUser as any)[field];
          const newValue = (user as any)[field];
          
          // Only log if value actually changed
          if (String(oldValue ?? '') !== String(newValue ?? '')) {
            // Log to general audit logs table
            await storage.createAuditLog({
              userId: id,
              changedBy,
              fieldChanged: field,
              oldValue: oldValue !== null && oldValue !== undefined ? String(oldValue) : null,
              newValue: newValue !== null && newValue !== undefined ? String(newValue) : null,
              changeType: 'update',
            });
            
            // Also log to employee data audit logs table
            await storage.createEmployeeDataAuditLog({
              userId: id,
              changedBy,
              fieldName: field,
              oldValue: oldValue !== null && oldValue !== undefined ? String(oldValue) : null,
              newValue: newValue !== null && newValue !== undefined ? String(newValue) : null,
              action: 'update',
            });
          }
        }
      }
      
      res.json({ success: true, user });
    } catch (error) {
      console.error("Update user error:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid input data", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to update user" });
    }
  });

  // Reset user password (admin only) - manual override
  app.post("/api/admin/users/:id/reset-password", requireAdmin, requireWriteAccess, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      
      const schema = z.object({
        reason: z.string().optional(),
      });
      
      const { reason } = schema.parse(req.body);
      
      // Get the user first
      const user = await storage.getUser(id);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      
      // Generate a cryptographically secure random password
      const newPassword = randomBytes(6).toString('base64').replace(/[+\/=]/g, '').slice(0, 10) + '!1';
      
      // Hash the new password
      const passwordHash = await bcrypt.hash(newPassword, 10);
      
      // Update user with new password and set mustChangePassword flag
      await storage.updateUser(id, {
        passwordHash,
        mustChangePassword: true, // Force password change on next login
      });
      
      // Log the password override
      await storage.createPasswordOverrideLog({
        userId: id,
        changedBy: 'admin',
        reason: reason || null,
      });
      
      res.json({ 
        success: true, 
        password: newPassword,
        message: "Password reset successfully. User will be required to change password on next login." 
      });
    } catch (error) {
      console.error("Password reset error:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid input data", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to reset password" });
    }
  });

  // Get password override logs (admin only)
  app.get("/api/admin/password-override-logs", requireAdmin, async (_req: Request, res: Response) => {
    try {
      const logs = await storage.getAllPasswordOverrideLogs();
      res.json({ logs });
    } catch (error) {
      console.error("Get password override logs error:", error);
      res.status(500).json({ message: "Failed to get password override logs" });
    }
  });

  // Bulk import employees (admin only)
  app.post("/api/admin/users/import", requireAdmin, requireWriteAccess, async (req: Request, res: Response) => {
    try {
      const schema = z.object({
        employees: z.array(z.object({
          code: z.string(),
          name: z.string(),
          shortName: z.string().optional(),
          nricFin: z.string().optional(),
          gender: z.string().optional(),
          department: z.string().optional(),
          section: z.string().optional(),
          designation: z.string().optional(),
          fingerId: z.string().optional(),
          email: z.string().email(),
          joinDate: z.string().optional(),
          resignDate: z.string().optional(),
        })),
      });

      const { employees } = schema.parse(req.body);
      
      const results = {
        created: 0,
        skipped: 0,
        errors: [] as string[],
      };

      for (const emp of employees) {
        try {
          // Check if user already exists by email or employee code
          const existingByEmail = await storage.getUserByEmail(emp.email);
          const existingByCode = emp.code ? await storage.getUserByEmployeeCode(emp.code) : null;
          
          if (existingByEmail || existingByCode) {
            results.skipped++;
            continue;
          }

          // Generate username from employee code
          const username = emp.code.toLowerCase();
          
          // Generate initial password (employee code + last 4 of NRIC or random)
          const nricSuffix = emp.nricFin ? emp.nricFin.slice(-4) : Math.random().toString(36).substring(2, 6);
          const initialPassword = `${emp.code}${nricSuffix}`;
          const passwordHash = await bcrypt.hash(initialPassword, 10);

          await storage.createUser({
            email: emp.email.toLowerCase(),
            username,
            name: emp.name,
            passwordHash,
            role: "user",
            isApproved: true, // Pre-approve imported employees
            employeeCode: emp.code,
            shortName: emp.shortName || null,
            nricFin: emp.nricFin || null,
            gender: emp.gender || null,
            department: emp.department || null,
            section: emp.section || null,
            designation: emp.designation || null,
            fingerId: emp.fingerId || null,
            joinDate: emp.joinDate || null,
            resignDate: emp.resignDate || null,
          });
          
          results.created++;
        } catch (error: any) {
          results.errors.push(`${emp.name}: ${error.message}`);
        }
      }

      res.json({
        success: true,
        message: `Imported ${results.created} employees, skipped ${results.skipped} existing`,
        ...results,
      });
    } catch (error) {
      console.error("Import employees error:", error);
      res.status(500).json({ message: "Failed to import employees" });
    }
  });

  // Create individual user (admin only)
  app.post("/api/admin/users/create", requireAdmin, requireWriteAccess, async (req: Request, res: Response) => {
    try {
      const schema = z.object({
        employeeCode: z.string().optional(),
        name: z.string().min(1, "Name is required"),
        email: z.string().email("Valid email is required"),
        department: z.string().optional(),
        designation: z.string().optional(),
        section: z.string().optional(),
        mobileNumber: z.string().optional(),
        gender: z.string().optional(),
        joinDate: z.string().optional(),
        sendWelcomeEmail: z.boolean().optional(),
        role: z.enum(["user", "admin"]).optional(),
      });

      const data = schema.parse(req.body);
      
      // Check if user already exists by email
      const existingByEmail = await storage.getUserByEmail(data.email);
      if (existingByEmail) {
        return res.status(400).json({ message: "User with this email already exists" });
      }
      
      // Check if employee code exists (only if provided)
      if (data.employeeCode && data.employeeCode.trim()) {
        const existingByCode = await storage.getUserByEmployeeCode(data.employeeCode);
        if (existingByCode) {
          return res.status(400).json({ message: "User with this employee code already exists" });
        }
      }

      // Generate username from employee code or email prefix
      const employeeCode = data.employeeCode?.trim() || null;
      const username = employeeCode ? employeeCode.toLowerCase() : data.email.split('@')[0].toLowerCase();
      
      // Generate initial password (employee code or email prefix + 4 random chars)
      const randomSuffix = Math.random().toString(36).substring(2, 6).toUpperCase();
      const passwordBase = employeeCode || data.email.split('@')[0];
      const initialPassword = `${passwordBase}${randomSuffix}`;
      const passwordHash = await bcrypt.hash(initialPassword, 10);

      const user = await storage.createUser({
        email: data.email.toLowerCase(),
        username,
        name: data.name,
        passwordHash,
        role: data.role || "user",
        isApproved: true,
        employeeCode: employeeCode,
        department: data.department || null,
        designation: data.designation || null,
        section: data.section || null,
        mobileNumber: data.mobileNumber || null,
        gender: data.gender || null,
        joinDate: data.joinDate || null,
        mustChangePassword: true,
      });

      res.json({
        success: true,
        user,
        initialPassword,
        message: `User ${data.name} created successfully`,
      });
    } catch (error: any) {
      console.error("Create user error:", error);
      if (error.name === "ZodError") {
        return res.status(400).json({ message: error.errors[0].message });
      }
      res.status(500).json({ message: error.message || "Failed to create user" });
    }
  });

  // Get admin users (admin only) - includes both 'admin' and 'viewonly_admin' roles
  app.get("/api/admin/admins", requireAdmin, async (_req: Request, res: Response) => {
    try {
      const users = await storage.getAllUsers();
      const adminUsers = users.filter((u: { role: string }) => u.role === "admin" || u.role === "viewonly_admin");
      res.json(adminUsers);
    } catch (error) {
      console.error("Get admin users error:", error);
      res.status(500).json({ message: "Failed to get admin users" });
    }
  });

  // Update user role (promote/demote admin) - admin only (view-only admins cannot change roles)
  app.patch("/api/admin/users/:id/role", requireAdmin, requireWriteAccess, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const schema = z.object({
        role: z.enum(["user", "admin", "viewonly_admin"]),
      });
      const { role } = schema.parse(req.body);

      const user = await storage.getUser(id);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      const oldRole = user.role;
      await storage.updateUser(id, { role });
      
      // Determine the actor's identity for audit logging
      let changedByIdentifier: string;
      if (req.session.userId === "admin") {
        changedByIdentifier = "master_admin (nexaadmin)";
      } else {
        const actorUser = await storage.getUser(req.session.userId!);
        changedByIdentifier = actorUser ? `${actorUser.name} (${actorUser.email})` : req.session.userId!;
      }
      
      // Log the role change
      await storage.createAuditLog({
        userId: id,
        changedBy: changedByIdentifier,
        fieldChanged: "role",
        oldValue: oldRole,
        newValue: role,
        changeType: "update",
      });

      // If the acting admin demoted themselves, invalidate their admin session
      if (role === "user" && req.session.userId === id) {
        req.session.isAdmin = false;
        return res.json({ 
          success: true, 
          message: "Your admin access has been removed. You will be redirected.",
          selfDemoted: true 
        });
      }

      res.json({ success: true, message: `User role updated to ${role}` });
    } catch (error: any) {
      console.error("Update user role error:", error);
      res.status(500).json({ message: error.message || "Failed to update user role" });
    }
  });

  // Change admin user password (nexadmin/master admin only)
  app.patch("/api/admin/users/:id/password", requireAdmin, async (req: Request, res: Response) => {
    try {
      // Only master admin (nexadmin) can change other admin passwords
      if (req.session.userId !== "admin") {
        return res.status(403).json({ message: "Only the master admin can change other admin passwords" });
      }

      const { id } = req.params;
      const schema = z.object({
        newPassword: z.string().min(6, "Password must be at least 6 characters"),
      });
      const { newPassword } = schema.parse(req.body);

      const user = await storage.getUser(id);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      if (user.role !== "admin" && user.role !== "viewonly_admin") {
        return res.status(400).json({ message: "This operation is only for admin users" });
      }

      // Hash the new password
      const passwordHash = await bcrypt.hash(newPassword, 10);
      await storage.updateUser(id, { passwordHash, mustChangePassword: true });
      
      // Log the password change
      await storage.createAuditLog({
        userId: id,
        changedBy: "master_admin (nexaadmin)",
        fieldChanged: "password",
        oldValue: null,
        newValue: "[password changed]",
        changeType: "update",
      });

      res.json({ 
        success: true, 
        message: `Password changed for ${user.name}. They will be required to change it on next login.` 
      });
    } catch (error: any) {
      console.error("Change admin password error:", error);
      if (error.name === "ZodError") {
        return res.status(400).json({ message: error.errors[0].message });
      }
      res.status(500).json({ message: error.message || "Failed to change password" });
    }
  });

  // Employee payroll settings management (admin only)
  // Get employee payroll settings
  app.get("/api/admin/employees/:id/payroll-settings", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const user = await storage.getUser(id);
      
      if (!user) {
        return res.status(404).json({ message: "Employee not found" });
      }

      // Return only payroll-related fields
      res.json({
        id: user.id,
        name: user.name,
        email: user.email,
        employeeCode: user.employeeCode,
        department: user.department,
        designation: user.designation,
        // Residency and CPF fields
        residencyStatus: user.residencyStatus,
        birthDate: user.birthDate,
        sprStartDate: user.sprStartDate,
        // Pay configuration
        payType: user.payType,
        basicMonthlySalary: user.basicMonthlySalary,
        hourlyRate: user.hourlyRate,
        dailyRate: user.dailyRate,
        regularHoursPerDay: user.regularHoursPerDay,
        regularDaysPerWeek: user.regularDaysPerWeek,
        // Default allowances (dollars)
        defaultMobileAllowance: user.defaultMobileAllowance,
        defaultTransportAllowance: user.defaultTransportAllowance,
        defaultMealAllowance: user.defaultMealAllowance,
        defaultShiftAllowance: user.defaultShiftAllowance,
        defaultOtherAllowance: user.defaultOtherAllowance,
        defaultHouseRentalAllowance: user.defaultHouseRentalAllowance,
        // Salary adjustment
        salaryAdjustment: user.salaryAdjustment,
        salaryAdjustmentReason: user.salaryAdjustmentReason,
        // SHG fields
        ethnicity: user.ethnicity,
        religion: user.religion,
        shgOptOut: user.shgOptOut,
      });
    } catch (error) {
      console.error("Get employee payroll settings error:", error);
      res.status(500).json({ message: "Failed to fetch employee payroll settings" });
    }
  });

  // Update employee payroll settings with audit logging
  app.patch("/api/admin/employees/:id/payroll-settings", requireAdmin, requireWriteAccess, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      
      const schema = z.object({
        // Residency and CPF fields
        residencyStatus: z.enum(['SC', 'SPR', 'FOREIGNER']).nullable().optional(),
        birthDate: z.string().nullable().optional(),
        sprStartDate: z.string().nullable().optional(),
        // Pay configuration
        payType: z.enum(['monthly', 'hourly', 'daily']).nullable().optional(),
        basicMonthlySalary: z.number().nullable().optional(), // dollars
        hourlyRate: z.number().nullable().optional(), // dollars
        dailyRate: z.number().nullable().optional(), // dollars
        regularHoursPerDay: z.number().nullable().optional(),
        regularDaysPerWeek: z.number().nullable().optional(),
        // Default allowances (dollars)
        defaultMobileAllowance: z.number().nullable().optional(),
        defaultTransportAllowance: z.number().nullable().optional(),
        defaultMealAllowance: z.number().nullable().optional(),
        defaultShiftAllowance: z.number().nullable().optional(),
        defaultOtherAllowance: z.number().nullable().optional(),
        defaultOtherAllowance1: z.number().nullable().optional(),
        defaultOtherAllowance2: z.number().nullable().optional(),
        defaultHouseRentalAllowance: z.number().nullable().optional(),
        // Salary adjustment
        salaryAdjustment: z.number().nullable().optional(),
        salaryAdjustmentReason: z.string().nullable().optional(),
        // SHG fields
        ethnicity: z.enum(['chinese', 'indian', 'malay', 'eurasian', 'other']).nullable().optional(),
        religion: z.enum(['muslim', 'other']).nullable().optional(),
        shgOptOut: z.boolean().optional(),
      });

      const updates = schema.parse(req.body);
      
      // Get the admin identifier for audit logging
      let changedBy = "admin";
      if (req.session.userId === "admin") {
        changedBy = "master_admin (nexaadmin)";
      } else if (req.session.userId) {
        const adminUser = await storage.getUser(req.session.userId);
        if (adminUser) {
          changedBy = `admin (${adminUser.name || adminUser.email})`;
        }
      }

      const { user, auditLogs } = await storage.updateEmployeePayrollSettings(id, updates as any, changedBy);
      
      if (!user) {
        return res.status(404).json({ message: "Employee not found" });
      }

      // Auto-refresh all payslips for this employee using userId
      let payslipsRefreshed = 0;
      let payslipChanges = 0;
      
      try {
        const allRecords = await storage.getPayrollRecordsByUserId(id);

        if (allRecords && allRecords.length > 0) {
          const { calculateSHG } = await import("./shg-calculator");
          const shgRelevantChanged = 'shgOptOut' in updates || 'ethnicity' in updates || 'religion' in updates || 'residencyStatus' in updates;

          const allowanceMapping: Record<string, { from: string; to: string }> = {
            defaultMobileAllowance: { from: 'defaultMobileAllowance', to: 'mobileAllowance' },
            defaultTransportAllowance: { from: 'defaultTransportAllowance', to: 'transportAllowance' },
            defaultMealAllowance: { from: 'defaultMealAllowance', to: 'mealAllowance' },
            defaultShiftAllowance: { from: 'defaultShiftAllowance', to: 'shiftAllowance' },
            defaultOtherAllowance: { from: 'defaultOtherAllowance', to: 'otherAllowance' },
            defaultOtherAllowance1: { from: 'defaultOtherAllowance1', to: 'otherAllowance1' },
            defaultOtherAllowance2: { from: 'defaultOtherAllowance2', to: 'otherAllowance2' },
            defaultHouseRentalAllowance: { from: 'defaultHouseRentalAllowance', to: 'houseRentalAllowances' },
          };

          for (const existingRecord of allRecords) {
            const payslipUpdates: Record<string, any> = {};
            const changes: { field: string; oldValue: number; newValue: number }[] = [];
            
            // Check each allowance field
            for (const mapping of Object.values(allowanceMapping)) {
              const employeeValue = parseNumeric((user as any)[mapping.from]);
              const currentValue = parseNumeric((existingRecord as any)[mapping.to]);
              
              if (employeeValue !== currentValue) {
                payslipUpdates[mapping.to] = employeeValue;
                changes.push({
                  field: mapping.to,
                  oldValue: currentValue,
                  newValue: employeeValue,
                });
              }
            }
            
            // Also check basic salary
            const employeeBasicSalary = parseNumeric(user.basicMonthlySalary);
            const currentBasicSalary = parseNumeric(existingRecord.basicSalary);
            if (employeeBasicSalary !== currentBasicSalary && employeeBasicSalary > 0) {
              payslipUpdates.basicSalary = employeeBasicSalary;
              changes.push({
                field: 'basicSalary',
                oldValue: currentBasicSalary,
                newValue: employeeBasicSalary,
              });
            }
            
            // Recalculate SHG when opt-out / ethnicity / religion / residency changes
            if (shgRelevantChanged) {
              const grossWagesForSHG = parseNumeric(existingRecord.grossWages);
              const shgResult = calculateSHG(
                user.ethnicity,
                user.religion,
                user.residencyStatus,
                grossWagesForSHG,
                user.shgOptOut || false,
              );
              const newSinda = shgResult.fund === 'SINDA' ? shgResult.contribution : 0;
              const newCdac  = shgResult.fund === 'CDAC'  ? shgResult.contribution : 0;
              const newMbmf  = shgResult.fund === 'MBMF'  ? shgResult.contribution : 0;
              const newEcf   = shgResult.fund === 'ECF'   ? shgResult.contribution : 0;
              const oldSinda = parseNumeric(existingRecord.sinda);
              const oldCdac  = parseNumeric(existingRecord.cdac);
              const oldMbmf  = parseNumeric(existingRecord.mbmf);
              const oldEcf   = parseNumeric(existingRecord.ecf);
              if (newSinda !== oldSinda) { payslipUpdates.sinda = newSinda; changes.push({ field: 'sinda', oldValue: oldSinda, newValue: newSinda }); }
              if (newCdac  !== oldCdac)  { payslipUpdates.cdac  = newCdac;  changes.push({ field: 'cdac',  oldValue: oldCdac,  newValue: newCdac  }); }
              if (newMbmf  !== oldMbmf)  { payslipUpdates.mbmf  = newMbmf;  changes.push({ field: 'mbmf',  oldValue: oldMbmf,  newValue: newMbmf  }); }
              if (newEcf   !== oldEcf)   { payslipUpdates.ecf   = newEcf;   changes.push({ field: 'ecf',   oldValue: oldEcf,   newValue: newEcf   }); }
            }

            if (Object.keys(payslipUpdates).length === 0) {
              continue;
            }

            // Recalculate totals
            const mergedRecord = { ...existingRecord, ...payslipUpdates };
            
            const basicSalary = parseNumeric(mergedRecord.basicSalary);
            const monthlyVariablesComponent = parseNumeric(mergedRecord.monthlyVariablesComponent);
            const flat = parseNumeric(mergedRecord.flat);
            const ot10 = parseNumeric(mergedRecord.ot10);
            const ot15 = parseNumeric(mergedRecord.ot15);
            const ot20 = parseNumeric(mergedRecord.ot20);
            const ot30 = parseNumeric(mergedRecord.ot30);
            const shiftAllowance = parseNumeric(mergedRecord.shiftAllowance);
            const totRestPhAmount = parseNumeric(mergedRecord.totRestPhAmount);
            const mobileAllowance = parseNumeric(mergedRecord.mobileAllowance);
            const transportAllowance = parseNumeric(mergedRecord.transportAllowance);
            const mealAllowance = parseNumeric((mergedRecord as any).mealAllowance);
            const annualLeaveEncashment = parseNumeric(mergedRecord.annualLeaveEncashment);
            const serviceCallAllowances = parseNumeric(mergedRecord.serviceCallAllowances);
            const otherAllowance = parseNumeric(mergedRecord.otherAllowance);
            const otherAllowance1 = parseNumeric((mergedRecord as any).otherAllowance1);
            const otherAllowance2 = parseNumeric((mergedRecord as any).otherAllowance2);
            const houseRentalAllowances = parseNumeric(mergedRecord.houseRentalAllowances);
            const bonus = parseNumeric(mergedRecord.bonus);
            const employerCpf = parseNumeric(mergedRecord.employerCpf);
            const employeeCpf = parseNumeric(mergedRecord.employeeCpf);
            const cc = parseNumeric(mergedRecord.cc);
            const cdac = parseNumeric(mergedRecord.cdac);
            const ecf = parseNumeric(mergedRecord.ecf);
            const mbmf = parseNumeric(mergedRecord.mbmf);
            const sinda = parseNumeric(mergedRecord.sinda);
            const loanRepaymentTotal = parseNumeric(mergedRecord.loanRepaymentTotal);
            const noPayDay = parseNumeric(mergedRecord.noPayDay);
            const advance = parseNumeric(mergedRecord.advance);
            
            const totSalary = roundToDollars(basicSalary + monthlyVariablesComponent);
            const overtimeTotal = roundToDollars(flat + ot10 + ot15 + ot20 + ot30 + shiftAllowance + totRestPhAmount);
            const allowancesWithCpf = roundToDollars(mobileAllowance + transportAllowance + annualLeaveEncashment + serviceCallAllowances);
            const allowancesWithoutCpf = roundToDollars(otherAllowance + otherAllowance1 + otherAllowance2 + houseRentalAllowances);
            const grossWages = roundToDollars(totSalary + overtimeTotal + allowancesWithCpf + allowancesWithoutCpf + bonus);
            const cpfWages = roundToDollars(totSalary + overtimeTotal + allowancesWithCpf + bonus);
            const totalCpf = roundToDollars(employerCpf + Math.abs(employeeCpf));
            const communityDeductions = roundToDollars(cc + cdac + ecf + mbmf + sinda);
            const effectiveLoanRepayment = roundToDollars(loanRepaymentTotal + mealAllowance);
            const totalDeductions = roundToDollars(effectiveLoanRepayment + noPayDay + advance + communityDeductions + Math.abs(employeeCpf));
            const nett = roundToDollars(grossWages - totalDeductions);
            
            const recalculated = {
              totSalary: toNumericString(totSalary),
              overtimeTotal: toNumericString(overtimeTotal),
              allowancesWithCpf: toNumericString(allowancesWithCpf),
              allowancesWithoutCpf: toNumericString(allowancesWithoutCpf),
              grossWages: toNumericString(grossWages),
              cpfWages: toNumericString(cpfWages),
              totalCpf: toNumericString(totalCpf),
              total: toNumericString(grossWages),
              nett: toNumericString(nett),
            };
            
            const finalUpdates = { ...payslipUpdates, ...recalculated };
            await storage.updatePayrollRecord(existingRecord.id, finalUpdates);
            
            // Create audit logs AFTER successful update
            for (const change of changes) {
              await storage.createPayrollAuditLog({
                payrollRecordId: existingRecord.id,
                fieldName: change.field,
                oldValue: String(change.oldValue),
                newValue: String(change.newValue),
                changedBy,
                reason: `Auto-refresh from settings update (${existingRecord.payPeriod})`,
              });
            }
            
            payslipsRefreshed++;
            payslipChanges += changes.length;
          }
        }
      } catch (refreshError) {
        console.error("Auto-refresh payslips error (non-fatal):", refreshError);
      }

      res.json({
        success: true,
        message: `Updated payroll settings for ${user.name}`,
        changesLogged: auditLogs.length,
        payslipsRefreshed,
        payslipChanges,
        user: {
          id: user.id,
          name: user.name,
          employeeCode: user.employeeCode,
          residencyStatus: user.residencyStatus,
          payType: user.payType,
        }
      });
    } catch (error) {
      console.error("Update employee payroll settings error:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid data", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to update employee payroll settings" });
    }
  });

  // Get audit logs for an employee
  app.get("/api/admin/employees/:id/audit-logs", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const user = await storage.getUser(id);
      
      if (!user) {
        return res.status(404).json({ message: "Employee not found" });
      }

      const auditLogs = await storage.getAuditLogsByUser(id);
      
      res.json({
        employee: {
          id: user.id,
          name: user.name,
          employeeCode: user.employeeCode,
        },
        auditLogs,
      });
    } catch (error) {
      console.error("Get employee audit logs error:", error);
      res.status(500).json({ message: "Failed to fetch audit logs" });
    }
  });
  
  // Get employee data audit logs for a specific employee
  app.get("/api/admin/employees/:id/data-audit-logs", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const user = await storage.getUser(id);
      
      if (!user) {
        return res.status(404).json({ message: "Employee not found" });
      }

      const auditLogs = await storage.getEmployeeDataAuditLogs(id);
      
      res.json({
        employee: {
          id: user.id,
          name: user.name,
          employeeCode: user.employeeCode,
        },
        auditLogs,
      });
    } catch (error) {
      console.error("Get employee data audit logs error:", error);
      res.status(500).json({ message: "Failed to fetch employee data audit logs" });
    }
  });
  
  // Get all employee data audit logs (global)
  app.get("/api/admin/employee-data-audit-logs", requireAdmin, async (req: Request, res: Response) => {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 100;
      const auditLogs = await storage.getAllEmployeeDataAuditLogs(limit);
      res.json({ auditLogs });
    } catch (error) {
      console.error("Get all employee data audit logs error:", error);
      res.status(500).json({ message: "Failed to fetch employee data audit logs" });
    }
  });

  // Get salary adjustments for an employee
  app.get("/api/admin/employees/:id/salary-adjustments", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const adjustments = await storage.getEmployeeSalaryAdjustments(id);
      res.json({ adjustments });
    } catch (error) {
      console.error("Get salary adjustments error:", error);
      res.status(500).json({ message: "Failed to fetch salary adjustments" });
    }
  });

  // Create a salary adjustment for an employee
  app.post("/api/admin/employees/:id/salary-adjustments", requireWriteAccess, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const adminUser = req.session?.userId 
        ? await storage.getUser(req.session.userId)
        : null;
      const changedBy = adminUser?.username || "nexaadmin";

      const schema = z.object({
        adjustmentType: z.enum(['addition', 'deduction']),
        amount: z.number().positive(),
        description: z.string().min(1),
        showForEmployee: z.boolean().optional().default(true),
      });

      const data = schema.parse(req.body);
      
      const adjustment = await storage.createEmployeeSalaryAdjustment({
        userId: id,
        adjustmentType: data.adjustmentType,
        amount: toNumericString(data.amount),
        description: data.description,
        createdBy: changedBy,
        isActive: true,
        showForEmployee: data.showForEmployee,
      });

      res.json({ adjustment });
    } catch (error) {
      console.error("Create salary adjustment error:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid data", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to create salary adjustment" });
    }
  });

  // Update a salary adjustment
  app.patch("/api/admin/employees/:userId/salary-adjustments/:id", requireWriteAccess, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;

      const schema = z.object({
        adjustmentType: z.enum(['addition', 'deduction']).optional(),
        amount: z.number().positive().optional(),
        description: z.string().min(1).optional(),
        isActive: z.boolean().optional(),
        showForEmployee: z.boolean().optional(),
      });

      const data = schema.parse(req.body);
      
      // Convert amount to string if provided
      const updateData: any = { ...data };
      if (data.amount !== undefined) {
        updateData.amount = toNumericString(data.amount);
      }
      
      const adjustment = await storage.updateEmployeeSalaryAdjustment(id, updateData);

      if (!adjustment) {
        return res.status(404).json({ message: "Adjustment not found" });
      }

      res.json({ adjustment });
    } catch (error) {
      console.error("Update salary adjustment error:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid data", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to update salary adjustment" });
    }
  });

  // Delete a salary adjustment
  app.delete("/api/admin/employees/:userId/salary-adjustments/:id", requireWriteAccess, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      
      const deleted = await storage.deleteEmployeeSalaryAdjustment(id);

      if (!deleted) {
        return res.status(404).json({ message: "Adjustment not found" });
      }

      res.json({ success: true });
    } catch (error) {
      console.error("Delete salary adjustment error:", error);
      res.status(500).json({ message: "Failed to delete salary adjustment" });
    }
  });

  // Get all employees with payroll summary (for the employee list page)
  app.get("/api/admin/employees/payroll-list", requireAdmin, async (req: Request, res: Response) => {
    try {
      const allUsers = await storage.getAllUsers();
      
      // Filter to employees eligible for payroll
      // Include admin users if they have payroll settings configured (salary, etc.)
      const employees = allUsers
        .filter(u => {
          if (u.isArchived) return false;
          
          // For admin/viewonly_admin users, include if they have payroll settings configured
          if (u.role === 'admin' || u.role === 'viewonly_admin' || u.role === 'attendance_view_admin') {
            const hasPayrollSettings = 
              (u.basicMonthlySalary && parseFloat(u.basicMonthlySalary) > 0) ||
              (u.hourlyRate && parseFloat(u.hourlyRate) > 0) ||
              (u.dailyRate && parseFloat(u.dailyRate) > 0);
            return hasPayrollSettings;
          }
          
          return true;
        })
        .map(u => ({
          id: u.id,
          name: u.name,
          email: u.email,
          employeeCode: u.employeeCode,
          department: u.department,
          designation: u.designation,
          isApproved: u.isApproved,
          residencyStatus: u.residencyStatus,
          payType: u.payType,
          basicMonthlySalary: u.basicMonthlySalary,
          hourlyRate: u.hourlyRate,
          dailyRate: u.dailyRate,
          hasPayrollConfig: !!(u.residencyStatus && u.payType && (u.basicMonthlySalary || u.hourlyRate || u.dailyRate)),
        }));

      res.json({ employees });
    } catch (error) {
      console.error("Get employees payroll list error:", error);
      res.status(500).json({ message: "Failed to fetch employees" });
    }
  });

  // Company settings routes
  app.get("/api/company/settings", async (req: Request, res: Response) => {
    try {
      const settings = await storage.getCompanySettings();
      res.json(settings);
    } catch (error) {
      console.error("Get company settings error:", error);
      res.status(500).json({ message: "Failed to get company settings" });
    }
  });

  // Upload logo file (admin only)
  app.post("/api/company/upload-logo", upload.single("file"), async (req: Request, res: Response) => {
    if (!req.session?.isAdmin) {
      return res.status(403).json({ message: "Admin access required" });
    }
    if (!req.file) {
      return res.status(400).json({ message: "No file uploaded" });
    }
    if (!/^image\/(png|jpeg|jpg|gif|svg\+xml|webp)$/i.test(req.file.mimetype)) {
      return res.status(400).json({ message: "Invalid file. Must be an image (PNG, JPEG, GIF, SVG, WebP) under 5MB" });
    }
    if (req.file.size > 5 * 1024 * 1024) {
      return res.status(400).json({ message: "File too large. Maximum 5MB" });
    }
    try {
      const objectStorageService = new ObjectStorageService();
      const fileUrl = await objectStorageService.uploadPublicFile(req.file.buffer, req.file.originalname, req.file.mimetype);
      res.json({ fileUrl });
    } catch (error) {
      console.error("Upload logo error:", error);
      res.status(500).json({ message: "Failed to upload logo" });
    }
  });

  // Upload favicon file (admin only)
  app.post("/api/company/upload-favicon", upload.single("file"), async (req: Request, res: Response) => {
    if (!req.session?.isAdmin) {
      return res.status(403).json({ message: "Admin access required" });
    }
    if (!req.file) {
      return res.status(400).json({ message: "No file uploaded" });
    }
    if (!/^image\/(x-icon|png|jpeg|jpg|vnd\.microsoft\.icon)$/i.test(req.file.mimetype)) {
      return res.status(400).json({ message: "Invalid file. Must be an icon or image (ICO, PNG, JPEG) under 1MB" });
    }
    if (req.file.size > 1 * 1024 * 1024) {
      return res.status(400).json({ message: "File too large. Maximum 1MB" });
    }
    try {
      const objectStorageService = new ObjectStorageService();
      const fileUrl = await objectStorageService.uploadPublicFile(req.file.buffer, req.file.originalname, req.file.mimetype);
      res.json({ fileUrl });
    } catch (error) {
      console.error("Upload favicon error:", error);
      res.status(500).json({ message: "Failed to upload favicon" });
    }
  });

  // Upload clock-in logo file (admin only)
  app.post("/api/company/upload-clockin-logo", upload.single("file"), async (req: Request, res: Response) => {
    if (!req.session?.isAdmin) {
      return res.status(403).json({ message: "Admin access required" });
    }
    if (!req.file) {
      return res.status(400).json({ message: "No file uploaded" });
    }
    if (!/^image\/(png|jpeg|jpg|gif|webp|svg\+xml)$/i.test(req.file.mimetype)) {
      return res.status(400).json({ message: "Invalid file. Must be an image (PNG, JPEG, GIF, WebP) under 5MB" });
    }
    if (req.file.size > 5 * 1024 * 1024) {
      return res.status(400).json({ message: "File too large. Maximum 5MB" });
    }
    try {
      const objectStorageService = new ObjectStorageService();
      const fileUrl = await objectStorageService.uploadPublicFile(req.file.buffer, req.file.originalname, req.file.mimetype);
      res.json({ fileUrl });
    } catch (error) {
      console.error("Upload clock-in logo error:", error);
      res.status(500).json({ message: "Failed to upload clock-in logo" });
    }
  });

  // Update company settings (admin only)
  app.put("/api/company/settings", async (req: Request, res: Response) => {
    if (!req.session?.isAdmin) {
      return res.status(403).json({ message: "Admin access required" });
    }

    try {
      const { logoUrl, faviconUrl, companyName, clockInLogoUrl } = req.body;
      const objectStorageService = new ObjectStorageService();
      
      const updates: any = {};
      if (companyName) updates.companyName = companyName;
      if (logoUrl) {
        updates.logoUrl = objectStorageService.normalizePublicAssetPath(logoUrl);
      }
      if (faviconUrl) {
        updates.faviconUrl = objectStorageService.normalizePublicAssetPath(faviconUrl);
      }
      if (clockInLogoUrl) {
        updates.clockInLogoUrl = objectStorageService.normalizePublicAssetPath(clockInLogoUrl);
      }

      const updatedSettings = await storage.updateCompanySettings(updates);
      res.json(updatedSettings);
    } catch (error) {
      console.error("Update company settings error:", error);
      res.status(500).json({ message: "Failed to update company settings" });
    }
  });

  // ==================== GEOCODING ENDPOINTS ====================
  
  // Simple in-memory cache for geocoding results
  const geocodeCache = new Map<string, { address: string, timestamp: number }>();
  const GEOCODE_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

  // Reverse geocode coordinates to address
  app.get("/api/geocode/reverse", async (req: Request, res: Response) => {
    const { lat, lon } = req.query;

    if (!lat || !lon) {
      return res.status(400).json({ message: "Latitude and longitude required" });
    }

    try {
      const latitude = parseFloat(lat as string);
      const longitude = parseFloat(lon as string);

      if (isNaN(latitude) || isNaN(longitude)) {
        return res.status(400).json({ message: "Invalid coordinates" });
      }

      // Round coordinates to 5 decimal places for cache key (~1 meter precision)
      const cacheKey = `${latitude.toFixed(5)},${longitude.toFixed(5)}`;

      // Check cache
      const cached = geocodeCache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < GEOCODE_CACHE_TTL) {
        return res.json({ 
          coordinates: `${latitude}, ${longitude}`,
          address: cached.address,
          cached: true
        });
      }

      // Call Nominatim API for reverse geocoding
      const response = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&zoom=18&addressdetails=1`,
        {
          headers: {
            'User-Agent': 'NexaHR HRMS App'
          }
        }
      );

      if (!response.ok) {
        throw new Error("Geocoding service unavailable");
      }

      const data = await response.json();
      const address = data.display_name || `${latitude}, ${longitude}`;

      // Cache the result
      geocodeCache.set(cacheKey, { address, timestamp: Date.now() });

      res.json({ 
        coordinates: `${latitude}, ${longitude}`,
        address,
        cached: false
      });
    } catch (error) {
      console.error("Geocoding error:", error);
      res.status(500).json({ 
        message: "Failed to geocode coordinates",
        coordinates: `${lat}, ${lon}`
      });
    }
  });

  // ==================== ATTENDANCE ENDPOINTS ====================
  
  // Clock in (one active clock-in per user at a time)
  app.post("/api/attendance/clock-in", async (req: Request, res: Response) => {
    if (!req.session?.userId || req.session.isAdmin) {
      return res.status(401).json({ message: "User authentication required" });
    }

    try {
      const userId = req.session.userId;
      const now = new Date();
      
      const companySettings = await storage.getCompanySettings();
      const timezone = companySettings?.defaultTimezone || 'Asia/Singapore';
      
      // Get today's date in company timezone
      const todayDate = now.toLocaleDateString('en-CA', { timeZone: timezone }); // YYYY-MM-DD
      
      // Check if user already has an open attendance session (no clock-out)
      const openSession = await storage.getOpenAttendanceRecord(userId);
      if (openSession) {
        const prevClockInTime = new Date(openSession.clockInTime);
        const prevClockInDate = prevClockInTime.toLocaleDateString('en-CA', { timeZone: timezone });
        const isSameDay = prevClockInDate === todayDate;

        if (isSameDay) {
          // Real same-day duplicate — block it
          const formattedTime = prevClockInTime.toLocaleString('en-US', {
            timeZone: timezone,
            hour: '2-digit',
            minute: '2-digit',
          });
          console.log(`[Clock-in Blocked] User ${userId} already clocked in today at ${formattedTime}`);
          return res.status(409).json({
            message: `You already clocked in today at ${formattedTime}. Please clock out first.`,
            existingRecord: openSession
          });
        }

        // Previous-day (or older) session — auto-close it before creating new clock-in
        const estimatedClose = new Date(
          Math.min(
            prevClockInTime.getTime() + 8 * 60 * 60 * 1000, // cap at 8h after original clock-in
            now.getTime()                                    // never set a future time
          )
        );
        await storage.updateAttendanceRecord(openSession.id, {
          clockOutTime: estimatedClose,
          autoClosed: true,
        });
        await storage.recalculateDailyAttendanceSummary(openSession.date, userId);
        console.log(`[Orphaned] Auto-closed session ${openSession.id} for user ${userId} (was from ${prevClockInDate})`);
      }
      
      // Get date in company timezone (not UTC)
      const date = now.toLocaleDateString('en-CA', { timeZone: timezone }); // Returns YYYY-MM-DD
      
      const { photoUrl, latitude, longitude } = req.body;

      // Geocode the location if coordinates are provided
      let clockInLocationText: string | null = null;
      if (latitude && longitude) {
        try {
          clockInLocationText = await serverReverseGeocode(latitude, longitude);
        } catch (error) {
          console.error('Geocoding failed during clock-in:', error);
          // Fallback to coordinates if geocoding fails
          clockInLocationText = `${parseFloat(latitude).toFixed(4)}, ${parseFloat(longitude).toFixed(4)}`;
        }
      }

      // Create new attendance record
      const record = await storage.createAttendanceRecord({
        userId,
        date,
        clockInTime: now,
        clockOutTime: null,
        photoUrl: photoUrl || null,
        latitude: latitude || null,
        longitude: longitude || null,
        clockInLocationText,
      });

      // Recalculate daily summary for this user and date
      await storage.recalculateDailyAttendanceSummary(date, userId);

      res.json({ success: true, record });
    } catch (error) {
      console.error("Clock in error:", error);
      res.status(500).json({ message: "Failed to clock in" });
    }
  });

  // Clock out (clocks out the most recent uncompleted record)
  app.post("/api/attendance/clock-out", async (req: Request, res: Response) => {
    if (!req.session?.userId || req.session.isAdmin) {
      return res.status(401).json({ message: "User authentication required" });
    }

    try {
      const userId = req.session.userId;
      const now = new Date();
      
      // Get company timezone to find records for the correct local date
      const companySettings = await storage.getCompanySettings();
      const timezone = companySettings?.defaultTimezone || 'Asia/Singapore';
      const date = now.toLocaleDateString('en-CA', { timeZone: timezone }); // YYYY-MM-DD in company timezone
      
      const { latitude, longitude } = req.body as { latitude?: string; longitude?: string };

      // Use getOpenAttendanceRecord so employees can clock out even if their open session
      // spans into a new calendar day (e.g. restored via admin SQL fix)
      const openRecord = await storage.getOpenAttendanceRecord(userId);

      if (!openRecord) {
        return res.status(400).json({ message: "No active clock-in found. Please clock in first." });
      }

      // Geocode the location if coordinates are provided
      let clockOutLocationText: string | null = null;
      if (latitude && longitude) {
        try {
          clockOutLocationText = await serverReverseGeocode(latitude, longitude);
        } catch (error) {
          console.error('Geocoding failed during clock-out:', error);
          // Fallback to coordinates if geocoding fails
          clockOutLocationText = `${parseFloat(latitude).toFixed(4)}, ${parseFloat(longitude).toFixed(4)}`;
        }
      }

      // Update with clock out time and location
      const updated = await storage.updateAttendanceRecord(openRecord.id, {
        clockOutTime: now,
        clockOutLatitude: latitude || null,
        clockOutLongitude: longitude || null,
        clockOutLocationText,
      });

      // Recalculate daily summary using the record's own date (may differ from today if cross-day)
      await storage.recalculateDailyAttendanceSummary(openRecord.date, userId);

      res.json({ success: true, record: updated });
    } catch (error) {
      console.error("Clock out error:", error);
      res.status(500).json({ message: "Failed to clock out" });
    }
  });

  // Get today's attendance records (returns all records for today)
  app.get("/api/attendance/today", async (req: Request, res: Response) => {
    if (!req.session?.userId || req.session.isAdmin) {
      return res.status(401).json({ message: "User authentication required" });
    }

    try {
      const userId = req.session.userId;
      // Use company timezone so the date matches what clock-in stored
      const companySettings = await storage.getCompanySettings();
      const timezone = companySettings?.defaultTimezone || 'Asia/Singapore';
      const date = new Date().toLocaleDateString('en-CA', { timeZone: timezone }); // YYYY-MM-DD

      const records = await storage.getAttendanceRecordsByUserAndDateRange(userId, date, date);

      // If there is an open session from a PREVIOUS day (e.g. restored after SQL fix or midnight
      // shift), include it so the client shows "Clock Out" instead of "Clock In"
      const openSession = await storage.getOpenAttendanceRecord(userId);
      if (openSession && openSession.date !== date) {
        records.unshift(openSession); // prepend so .find(!clockOutTime) returns it first
      }

      res.json({ records });
    } catch (error) {
      console.error("Get today attendance error:", error);
      res.status(500).json({ message: "Failed to get attendance records" });
    }
  });

  // Get attendance records with date range
  app.get("/api/attendance/records", async (req: Request, res: Response) => {
    if (!req.session?.userId || req.session.isAdmin) {
      return res.status(401).json({ message: "User authentication required" });
    }

    try {
      const userId = req.session.userId;
      const { startDate, endDate } = req.query as { startDate?: string; endDate?: string };
      
      // Default to current month if no dates provided
      const now = new Date();
      const defaultStartDate = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
      const defaultEndDate = now.toISOString().split('T')[0];
      
      const records = await storage.getAttendanceRecordsByUserAndDateRange(
        userId,
        startDate || defaultStartDate,
        endDate || defaultEndDate
      );
      
      res.json({ records });
    } catch (error) {
      console.error("Get attendance records error:", error);
      res.status(500).json({ message: "Failed to get attendance records" });
    }
  });

  // Admin: Get all users' attendance records
  app.get("/api/admin/attendance/records", requireAdmin, requireFullAdmin, async (req: Request, res: Response) => {

    try {
      const { startDate, endDate } = req.query as { startDate?: string; endDate?: string };
      
      // Default to current month if no dates provided
      const now = new Date();
      const defaultStartDate = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
      const defaultEndDate = now.toISOString().split('T')[0];
      
      const queryStartDate = startDate || defaultStartDate;
      const queryEndDate = endDate || defaultEndDate;
      
      console.log(`[Attendance Records] Fetching records from ${queryStartDate} to ${queryEndDate}`);
      
      const records = await storage.getAllUsersAttendanceByDateRange(queryStartDate, queryEndDate);
      
      console.log(`[Attendance Records] Found ${records.length} records`);
      
      res.json({ records });
    } catch (error: any) {
      console.error("Get all attendance records error:", error);
      console.error("Error stack:", error?.stack);
      res.status(500).json({ message: "Failed to get attendance records", error: error?.message });
    }
  });

  // Admin: Get orphaned attendance sessions (clocked in > 24 hours ago without clock-out)
  app.get("/api/admin/attendance/orphaned", requireAdmin, requireFullAdmin, async (req: Request, res: Response) => {

    try {
      const records = await storage.getOrphanedAttendanceSessions();
      res.json({ records });
    } catch (error) {
      console.error("Get orphaned sessions error:", error);
      res.status(500).json({ message: "Failed to get orphaned sessions" });
    }
  });

  // Admin: Get pre-calculated daily attendance summaries for heatmap
  app.get("/api/admin/attendance/summaries", requireAdmin, requireFullAdmin, async (req: Request, res: Response) => {

    try {
      const { startDate, endDate } = req.query as { startDate?: string; endDate?: string };
      
      const now = new Date();
      const defaultStartDate = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
      const defaultEndDate = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];
      
      const queryStartDate = startDate || defaultStartDate;
      const queryEndDate = endDate || defaultEndDate;
      
      console.log(`[Attendance Summaries] Fetching summaries from ${queryStartDate} to ${queryEndDate}`);
      
      const summaries = await storage.getDailyAttendanceSummaries(queryStartDate, queryEndDate);
      
      console.log(`[Attendance Summaries] Found ${summaries.length} summaries`);
      
      res.json({ summaries });
    } catch (error: any) {
      console.error("Get attendance summaries error:", error);
      res.status(500).json({ message: "Failed to get attendance summaries" });
    }
  });

  // Admin: Recalculate attendance summaries for a date range (e.g., populate December data)
  app.post("/api/admin/attendance/recalculate-summaries", requireAdmin, requireWriteAccess, requireFullAdmin, async (req: Request, res: Response) => {

    try {
      const { startDate, endDate } = req.body as { startDate: string; endDate: string };
      
      if (!startDate || !endDate) {
        return res.status(400).json({ message: "startDate and endDate are required" });
      }
      
      console.log(`[Recalculate Summaries] Processing ${startDate} to ${endDate}`);
      
      const start = new Date(startDate);
      const end = new Date(endDate);
      let processedDays = 0;
      let totalProcessed = 0;
      let totalDeleted = 0;
      let totalErrors = 0;
      
      const currentDate = new Date(start);
      while (currentDate <= end) {
        const dateStr = currentDate.toISOString().split('T')[0];
        const result = await storage.recalculateAllSummariesForDate(dateStr);
        totalProcessed += result.processed;
        totalDeleted += result.deleted;
        totalErrors += result.errors;
        processedDays++;
        currentDate.setDate(currentDate.getDate() + 1);
      }
      
      console.log(`[Recalculate Summaries] Processed ${processedDays} days, ${totalProcessed} summaries, ${totalDeleted} deleted, ${totalErrors} errors`);
      
      const response = {
        success: totalErrors === 0,
        message: totalErrors > 0 
          ? `Recalculated summaries for ${processedDays} days with ${totalErrors} errors`
          : `Recalculated summaries for ${processedDays} days`,
        processedDays,
        totalProcessed,
        totalDeleted,
        totalErrors,
      };
      
      // Return 207 (Multi-Status) if there were partial errors, 200 for full success
      res.status(totalErrors > 0 ? 207 : 200).json(response);
    } catch (error: any) {
      console.error("Recalculate summaries error:", error);
      res.status(500).json({ success: false, message: "Failed to recalculate summaries" });
    }
  });

  // Admin: Get attendance adjustments for a date range
  app.get("/api/admin/attendance/adjustments", requireAdmin, requireFullAdmin, async (req: Request, res: Response) => {
    try {
      const { startDate, endDate } = req.query as { startDate?: string; endDate?: string };
      
      const now = new Date();
      const defaultStartDate = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
      const defaultEndDate = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];
      
      const queryStartDate = startDate || defaultStartDate;
      const queryEndDate = endDate || defaultEndDate;
      
      const adjustments = await storage.getAttendanceAdjustmentsByDateRange(queryStartDate, queryEndDate);
      res.json({ adjustments });
    } catch (error: any) {
      console.error("Get attendance adjustments error:", error);
      res.status(500).json({ message: "Failed to get attendance adjustments" });
    }
  });

  // Admin: Get single attendance adjustment
  app.get("/api/admin/attendance/adjustments/:userId/:date", requireAdmin, requireFullAdmin, async (req: Request, res: Response) => {
    try {
      const { userId, date } = req.params;
      const adjustment = await storage.getAttendanceAdjustment(userId, date);
      res.json({ adjustment: adjustment || null });
    } catch (error: any) {
      console.error("Get attendance adjustment error:", error);
      res.status(500).json({ message: "Failed to get attendance adjustment" });
    }
  });

  // Admin: Create or update attendance adjustment (leave or hours override)
  app.post("/api/admin/attendance/adjustments", requireAdmin, requireWriteAccess, requireFullAdmin, async (req: Request, res: Response) => {
    try {
      const schema = z.object({
        userId: z.string().uuid(),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        adjustmentType: z.enum(["leave", "hours"]),
        leaveType: z.enum(["AL", "MC", "ML", "CL", "OIL"]).optional().nullable(),
        regularHours: z.number().min(0).max(24).optional().nullable(),
        otHours: z.number().min(0).max(24).optional().nullable(),
        notes: z.string().optional().nullable(),
      });
      
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid request", errors: parsed.error.errors });
      }
      
      const { userId, date, adjustmentType, leaveType, regularHours, otHours, notes } = parsed.data;
      
      // Validate leave type is provided for leave adjustments
      if (adjustmentType === "leave" && !leaveType) {
        return res.status(400).json({ message: "Leave type is required for leave adjustments" });
      }
      
      // Get admin user ID - handle master admin case
      let creatorId = req.session?.userId;
      if (!creatorId) {
        return res.status(401).json({ message: "Admin user not identified" });
      }
      
      // If master admin (userId = "admin"), find a real admin user to use as creator
      // or use the target user as creator (self-adjustment by system)
      if (creatorId === "admin") {
        // Try to find any admin user in the database
        const adminUsers = await storage.getAdminUsers();
        if (adminUsers.length > 0) {
          creatorId = adminUsers[0].id;
        } else {
          // Fall back to using the target user as the "creator" for FK compliance
          creatorId = userId;
        }
      }
      
      // Check if adjustment already exists for this user/date
      const existingAdjustment = await storage.getAttendanceAdjustment(userId, date);
      
      if (existingAdjustment) {
        // Update existing adjustment
        const updated = await storage.updateAttendanceAdjustment(existingAdjustment.id, {
          adjustmentType,
          leaveType: leaveType || null,
          regularHours: adjustmentType === "leave" ? 9 : (regularHours || null),
          otHours: adjustmentType === "hours" ? (otHours || null) : null,
          notes: notes || null,
          createdBy: creatorId,
        });
        res.json({ adjustment: updated, message: "Attendance adjustment updated" });
      } else {
        // Create new adjustment
        const newAdjustment = await storage.createAttendanceAdjustment({
          userId,
          date,
          adjustmentType,
          leaveType: leaveType || null,
          regularHours: adjustmentType === "leave" ? 9 : (regularHours || null),
          otHours: adjustmentType === "hours" ? (otHours || null) : null,
          notes: notes || null,
          createdBy: creatorId,
        });
        res.json({ adjustment: newAdjustment, message: "Attendance adjustment created" });
      }
      triggerAutoPayrollRegen(date as string);
    } catch (error: any) {
      console.error("=== ATTENDANCE ADJUSTMENT ERROR ===");
      console.error("Error message:", error.message);
      console.error("Error code:", error.code);
      console.error("Error detail:", error.detail);
      console.error("Error constraint:", error.constraint);
      console.error("Full error:", error);
      res.status(500).json({ 
        message: "Failed to save attendance adjustment",
        debug: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  });

  // Admin: Delete attendance adjustment (revert to actual clock-in data)
  app.delete("/api/admin/attendance/adjustments/:id", requireAdmin, requireWriteAccess, requireFullAdmin, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      
      const adjustment = await storage.getAttendanceAdjustmentById(id);
      if (!adjustment) {
        return res.status(404).json({ message: "Adjustment not found" });
      }
      
      await storage.deleteAttendanceAdjustment(id);
      res.json({ message: "Attendance adjustment deleted, reverting to actual clock-in data" });
      triggerAutoPayrollRegen(adjustment.date as string);
    } catch (error: any) {
      console.error("Delete attendance adjustment error:", error);
      res.status(500).json({ message: "Failed to delete attendance adjustment" });
    }
  });

  // Admin: Get employee monthly remarks for a specific month
  app.get("/api/admin/attendance/remarks", requireAdmin, requireFullAdmin, async (req: Request, res: Response) => {
    try {
      const { year, month } = req.query;
      
      if (!year || !month) {
        return res.status(400).json({ message: "Year and month are required" });
      }
      
      const remarks = await storage.getEmployeeMonthlyRemarks(
        parseInt(year as string),
        parseInt(month as string)
      );
      res.json(remarks);
    } catch (error: any) {
      console.error("Get employee monthly remarks error:", error);
      res.status(500).json({ message: "Failed to get employee remarks" });
    }
  });

  // Admin: Save employee monthly remark
  app.post("/api/admin/attendance/remarks", requireAdmin, requireWriteAccess, requireFullAdmin, async (req: Request, res: Response) => {
    try {
      const schema = z.object({
        userId: z.string().uuid(),
        year: z.number(),
        month: z.number().min(0).max(11),
        remark: z.string().nullable(),
      });
      
      const { userId, year, month, remark } = schema.parse(req.body);
      
      // Handle master admin case - find a real admin user for createdBy
      let creatorId = req.session?.userId;
      if (!creatorId || creatorId === "admin") {
        const adminUsers = await storage.getAdminUsers();
        if (adminUsers.length > 0) {
          creatorId = adminUsers[0].id;
        } else {
          creatorId = userId; // Fallback to target user
        }
      }
      
      const savedRemark = await storage.upsertEmployeeMonthlyRemark({
        userId,
        year,
        month,
        remark,
        createdBy: creatorId,
      });
      
      res.json({ remark: savedRemark, message: "Remark saved successfully" });
    } catch (error: any) {
      console.error("Save employee monthly remark error:", error);
      res.status(500).json({ message: "Failed to save remark" });
    }
  });

  // Admin: Bulk close orphaned attendance sessions
  app.post("/api/admin/attendance/bulk-close-orphaned", requireAdmin, requireWriteAccess, requireFullAdmin, async (req: Request, res: Response) => {
    if (!req.session?.isAdmin) {
      return res.status(403).json({ message: "Admin access required" });
    }
    
    if (req.session.isViewOnlyAdmin) {
      return res.status(403).json({ message: "View-only admins cannot close attendance sessions" });
    }

    try {
      const schema = z.object({
        recordIds: z.array(z.string().uuid()),
        clockOutTime: z.string().optional(), // HH:mm format, optional - defaults to 8 hours after clock-in
      });

      const { recordIds, clockOutTime } = schema.parse(req.body);

      if (recordIds.length === 0) {
        return res.status(400).json({ message: "No records selected" });
      }

      let closedCount = 0;
      const errors: string[] = [];

      for (const recordId of recordIds) {
        try {
          const record = await storage.getAttendanceRecord(recordId);
          if (!record) {
            errors.push(`Record ${recordId} not found`);
            continue;
          }

          if (record.clockOutTime) {
            errors.push(`Record ${recordId} already has clock-out time`);
            continue;
          }

          // Calculate clock-out time: use provided time or default to 8 hours after clock-in
          let clockOutDateTime: Date;
          
          if (clockOutTime) {
            // Parse clock-out time based on the record's date
            const [hours, minutes] = clockOutTime.split(':').map(Number);
            clockOutDateTime = new Date(record.clockInTime);
            clockOutDateTime.setHours(hours, minutes, 0, 0);
            
            // If clock-out would be before clock-in, assume next day
            if (clockOutDateTime <= new Date(record.clockInTime)) {
              clockOutDateTime.setDate(clockOutDateTime.getDate() + 1);
            }
          } else {
            // Default to 8 hours after clock-in
            clockOutDateTime = new Date(new Date(record.clockInTime).getTime() + 8 * 60 * 60 * 1000);
          }

          await storage.updateAttendanceRecord(recordId, {
            clockOutTime: clockOutDateTime,
          });

          // Recalculate daily summary for this user and date
          await storage.recalculateDailyAttendanceSummary(record.date, record.userId);

          closedCount++;
        } catch (err) {
          errors.push(`Failed to close record ${recordId}`);
        }
      }

      res.json({ 
        success: true, 
        closedCount, 
        message: `Closed ${closedCount} of ${recordIds.length} sessions`,
        errors: errors.length > 0 ? errors : undefined
      });
    } catch (error) {
      console.error("Bulk close orphaned sessions error:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid input data", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to close orphaned sessions" });
    }
  });

  // Admin: Backfill location text for records that have coordinates but no address
  app.post("/api/admin/attendance/backfill-locations", requireAdmin, requireWriteAccess, requireFullAdmin, async (req: Request, res: Response) => {
    if (!req.session?.isAdmin) {
      return res.status(403).json({ message: "Admin access required" });
    }
    
    // View-only admins cannot modify records
    if (req.session.isViewOnlyAdmin) {
      return res.status(403).json({ message: "View-only admins cannot modify attendance records" });
    }

    try {
      // Get all attendance records
      const allRecords = await storage.getAllAttendanceRecords();
      
      // Filter records that have coordinates but no location text
      const recordsToUpdate = allRecords.filter(r => 
        (r.latitude && r.longitude && !r.clockInLocationText) ||
        (r.clockOutLatitude && r.clockOutLongitude && !r.clockOutLocationText)
      );

      console.log(`[Backfill] Found ${recordsToUpdate.length} records to update`);

      let updatedCount = 0;
      const errors: string[] = [];

      for (const record of recordsToUpdate) {
        try {
          const updates: any = {};
          
          // Geocode clock-in location if needed
          if (record.latitude && record.longitude && !record.clockInLocationText) {
            console.log(`[Backfill] Geocoding clock-in for record ${record.id}: ${record.latitude}, ${record.longitude}`);
            const address = await serverReverseGeocode(record.latitude, record.longitude);
            // Only update if we got a real address (not coordinates)
            if (address && !address.match(/^[\d.-]+,\s*[\d.-]+$/)) {
              updates.clockInLocationText = address;
            }
          }
          
          // Geocode clock-out location if needed
          if (record.clockOutLatitude && record.clockOutLongitude && !record.clockOutLocationText) {
            console.log(`[Backfill] Geocoding clock-out for record ${record.id}: ${record.clockOutLatitude}, ${record.clockOutLongitude}`);
            const address = await serverReverseGeocode(record.clockOutLatitude, record.clockOutLongitude);
            // Only update if we got a real address (not coordinates)
            if (address && !address.match(/^[\d.-]+,\s*[\d.-]+$/)) {
              updates.clockOutLocationText = address;
            }
          }
          
          if (Object.keys(updates).length > 0) {
            await storage.updateAttendanceRecord(record.id, updates);
            updatedCount++;
            console.log(`[Backfill] Updated record ${record.id} with:`, updates);
          }
        } catch (err) {
          console.error(`[Backfill] Error processing record ${record.id}:`, err);
          errors.push(`Failed to update record ${record.id}`);
        }
      }

      res.json({
        success: true,
        message: `Updated ${updatedCount} of ${recordsToUpdate.length} records with location data`,
        updatedCount,
        totalToUpdate: recordsToUpdate.length,
        errors: errors.length > 0 ? errors : undefined
      });
    } catch (error) {
      console.error("Backfill locations error:", error);
      res.status(500).json({ message: "Failed to backfill locations" });
    }
  });

  // Admin: Resolve location for a single attendance record (on-demand geocoding)
  app.post("/api/admin/attendance/resolve-location", requireAdmin, requireWriteAccess, requireFullAdmin, async (req: Request, res: Response) => {
    if (!req.session?.isAdmin) {
      return res.status(403).json({ message: "Admin access required" });
    }

    try {
      const schema = z.object({
        recordId: z.string().uuid(),
        locationType: z.enum(["in", "out"])
      });

      const { recordId, locationType } = schema.parse(req.body);

      // Get the attendance record
      const record = await storage.getAttendanceRecord(recordId);
      if (!record) {
        return res.status(404).json({ message: "Attendance record not found" });
      }

      let lat: string | null = null;
      let lng: string | null = null;
      let updateField: string = "";

      if (locationType === "in") {
        lat = record.latitude;
        lng = record.longitude;
        updateField = "clockInLocationText";
      } else {
        lat = record.clockOutLatitude;
        lng = record.clockOutLongitude;
        updateField = "clockOutLocationText";
      }

      if (!lat || !lng) {
        return res.status(400).json({ message: "No coordinates available to resolve" });
      }

      // Perform geocoding
      const address = await serverReverseGeocode(lat, lng);

      // Update the record with the resolved address
      const updates: any = {};
      updates[updateField] = address;
      await storage.updateAttendanceRecord(recordId, updates);

      res.json({
        success: true,
        address,
        message: "Location resolved successfully"
      });
    } catch (error) {
      console.error("Resolve location error:", error);
      res.status(500).json({ message: "Failed to resolve location" });
    }
  });

  // Admin: Add attendance record for an employee (any date) - write access required
  app.post("/api/admin/attendance/add", requireAdmin, requireWriteAccess, requireFullAdmin, async (req: Request, res: Response) => {
    if (!req.session?.isAdmin) {
      return res.status(403).json({ message: "Admin access required" });
    }
    
    // View-only admins cannot add attendance records
    if (req.session.isViewOnlyAdmin) {
      return res.status(403).json({ message: "View-only admins cannot add attendance records" });
    }

    try {
      const schema = z.object({
        userId: z.string().uuid(),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format"),
        clockInTime: z.string(), // HH:mm format
        clockOutTime: z.string().optional(), // HH:mm format, optional
      });

      const { userId, date, clockInTime, clockOutTime } = schema.parse(req.body);

      // Parse the provided date
      const [year, month, day] = date.split('-').map(Number);
      const targetDate = new Date(year, month - 1, day);

      // Check if employee exists
      const employee = await storage.getUser(userId);
      if (!employee) {
        return res.status(404).json({ message: "Employee not found" });
      }

      // Check if attendance already exists for this user on the target date
      const existingRecords = await storage.getAttendanceRecordsByUserAndDateRange(userId, date, date);
      if (existingRecords.length > 0) {
        return res.status(400).json({ message: `Attendance record already exists for this employee on ${date}` });
      }
      
      // If adding a record without clock-out (creating an open session), check for existing open sessions
      if (!clockOutTime) {
        const openSession = await storage.getOpenAttendanceRecord(userId);
        if (openSession) {
          const existingClockIn = new Date(openSession.clockInTime);
          const formattedTime = existingClockIn.toLocaleString('en-US', { 
            timeZone: 'Asia/Singapore',
            hour: '2-digit',
            minute: '2-digit',
            month: 'short',
            day: 'numeric'
          });
          return res.status(409).json({ 
            message: `Employee already has an active clock-in from ${formattedTime}. Please end that session first before adding a new clock-in without clock-out.`,
            existingRecord: openSession
          });
        }
      }

      // Get company timezone setting for proper time interpretation
      const companySettings = await storage.getCompanySettings();
      const timezone = companySettings?.defaultTimezone || 'Asia/Singapore';
      
      // Get timezone offset (Singapore is UTC+8)
      const getTimezoneOffset = (tz: string): string => {
        const offsets: Record<string, string> = {
          'Asia/Singapore': '+08:00',
          'Asia/Kuala_Lumpur': '+08:00',
          'Asia/Hong_Kong': '+08:00',
          'Asia/Shanghai': '+08:00',
          'Asia/Tokyo': '+09:00',
          'Asia/Seoul': '+09:00',
          'Asia/Bangkok': '+07:00',
          'Asia/Jakarta': '+07:00',
          'Asia/Kolkata': '+05:30',
          'Asia/Dubai': '+04:00',
          'Europe/London': '+00:00',
          'America/New_York': '-05:00',
          'America/Los_Angeles': '-08:00',
          'Australia/Sydney': '+11:00',
        };
        return offsets[tz] || '+08:00'; // Default to Singapore if unknown
      };
      
      const tzOffset = getTimezoneOffset(timezone);

      // Parse clock in time (HH:mm) to full datetime with timezone
      const clockInISOString = `${date}T${clockInTime}:00${tzOffset}`;
      const clockInDateTime = new Date(clockInISOString);

      // Parse clock out time if provided
      let clockOutDateTime: Date | undefined;
      if (clockOutTime) {
        const clockOutISOString = `${date}T${clockOutTime}:00${tzOffset}`;
        clockOutDateTime = new Date(clockOutISOString);
        
        // Validate clock out is after clock in
        if (clockOutDateTime <= clockInDateTime) {
          return res.status(400).json({ message: "Clock out time must be after clock in time" });
        }
      }

      // Create attendance record
      const record = await storage.createAttendanceRecord({
        userId,
        date: date,
        clockInTime: clockInDateTime,
        clockOutTime: clockOutDateTime || null,
      });

      // Create audit log entry - get admin identifier
      let adminName = "Master Admin";
      if (req.session.userId !== "admin") {
        const adminUser = await storage.getUser(req.session.userId!);
        adminName = adminUser ? `${adminUser.name} (${adminUser.email})` : req.session.userId!;
      }
      await storage.createAuditLog({
        userId,
        changedBy: adminName,
        fieldChanged: "attendance",
        oldValue: null,
        newValue: JSON.stringify({
          date: date,
          clockIn: clockInTime,
          clockOut: clockOutTime || null,
        }),
        changeType: "create",
      });

      // Recalculate daily summary for this user and date
      await storage.recalculateDailyAttendanceSummary(date, userId);

      res.json({ 
        success: true, 
        record,
        message: `Attendance added for ${employee.name} on ${date}` 
      });
    } catch (error) {
      console.error("Admin add attendance error:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid input data", errors: error.errors });
      }
      // Provide more specific error message if available
      const errorMessage = error instanceof Error ? error.message : "Failed to add attendance record";
      res.status(500).json({ message: errorMessage });
    }
  });

  // Admin: End clock-in for an employee (nexaadmin only)
  app.post("/api/admin/attendance/end-clockin", requireAdmin, requireWriteAccess, requireFullAdmin, async (req: Request, res: Response) => {
    if (!req.session?.isAdmin) {
      return res.status(403).json({ message: "Admin access required" });
    }

    // Only master admin (nexaadmin) can end clock-ins
    if (req.session.userId !== "admin") {
      return res.status(403).json({ message: "Only master admin can end employee clock-ins" });
    }

    try {
      const schema = z.object({
        recordId: z.string().uuid(),
        clockOutTime: z.string(), // HH:mm format
      });

      const { recordId, clockOutTime } = schema.parse(req.body);

      // Get the attendance record
      const record = await storage.getAttendanceRecord(recordId);
      if (!record) {
        return res.status(404).json({ message: "Attendance record not found" });
      }

      // Check if already clocked out
      if (record.clockOutTime) {
        return res.status(400).json({ message: "This attendance record already has a clock-out time" });
      }

      // Get the employee
      const employee = await storage.getUser(record.userId);
      if (!employee) {
        return res.status(404).json({ message: "Employee not found" });
      }

      // Get company timezone setting for proper time interpretation
      const companySettings = await storage.getCompanySettings();
      const timezone = companySettings?.defaultTimezone || 'Asia/Singapore';
      
      // Get timezone offset
      const getTimezoneOffset = (tz: string): string => {
        const offsets: Record<string, string> = {
          'Asia/Singapore': '+08:00',
          'Asia/Kuala_Lumpur': '+08:00',
          'Asia/Hong_Kong': '+08:00',
          'Asia/Shanghai': '+08:00',
          'Asia/Tokyo': '+09:00',
          'Asia/Seoul': '+09:00',
          'Asia/Bangkok': '+07:00',
          'Asia/Jakarta': '+07:00',
          'Asia/Kolkata': '+05:30',
          'Asia/Dubai': '+04:00',
          'Europe/London': '+00:00',
          'America/New_York': '-05:00',
          'America/Los_Angeles': '-08:00',
          'Australia/Sydney': '+11:00',
        };
        return offsets[tz] || '+08:00';
      };
      
      const tzOffset = getTimezoneOffset(timezone);

      // Parse clock out time to full datetime using the record's date with proper timezone
      const recordDateStr = typeof record.date === 'string' ? record.date : new Date(record.date).toISOString().split('T')[0];
      const clockOutISOString = `${recordDateStr}T${clockOutTime}:00${tzOffset}`;
      const clockOutDateTime = new Date(clockOutISOString);

      // Validate clock out is after clock in
      const clockInDateTime = new Date(record.clockInTime);
      
      // Debug logging to diagnose timezone issues
      console.log("End clock-in debug:", {
        recordId,
        recordDate: record.date,
        recordDateStr,
        clockOutTimeInput: clockOutTime,
        clockOutISOString,
        clockOutDateTime: clockOutDateTime.toISOString(),
        clockOutDateTimeMs: clockOutDateTime.getTime(),
        clockInTime: record.clockInTime,
        clockInDateTime: clockInDateTime.toISOString(),
        clockInDateTimeMs: clockInDateTime.getTime(),
        timezone,
        tzOffset,
        comparison: clockOutDateTime.getTime() > clockInDateTime.getTime() ? "VALID" : "INVALID"
      });
      
      if (clockOutDateTime <= clockInDateTime) {
        return res.status(400).json({ 
          message: "Clock out time must be after clock in time",
          debug: {
            clockIn: clockInDateTime.toISOString(),
            clockOut: clockOutDateTime.toISOString()
          }
        });
      }

      // Update the attendance record
      const updatedRecord = await storage.updateAttendanceRecord(recordId, {
        clockOutTime: clockOutDateTime,
      });

      // Create audit log entry
      await storage.createAuditLog({
        userId: record.userId,
        changedBy: "Master Admin (nexaadmin)",
        fieldChanged: "attendance_clockout",
        oldValue: null,
        newValue: JSON.stringify({
          recordId,
          date: record.date,
          clockOut: clockOutTime,
        }),
        changeType: "update",
      });

      // Recalculate daily summary for this user and date
      await storage.recalculateDailyAttendanceSummary(record.date, record.userId);

      res.json({ 
        success: true, 
        record: updatedRecord,
        message: `Clock-out set for ${employee.name}` 
      });
    } catch (error: any) {
      console.error("Admin end clock-in error:", error);
      console.error("Error context - recordId:", req.body?.recordId);
      
      if (error instanceof z.ZodError) {
        const errorMessages = error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ');
        return res.status(400).json({ message: `Invalid input: ${errorMessages}`, errors: error.errors });
      }
      
      // Keep user-facing message generic for security
      res.status(500).json({ message: "Failed to end clock-in. Please try again or contact support." });
    }
  });

  // Admin: Delete attendance record (nexaadmin only)
  app.delete("/api/admin/attendance/:recordId", requireAdmin, requireWriteAccess, requireFullAdmin, async (req: Request, res: Response) => {
    if (!req.session?.isAdmin) {
      return res.status(403).json({ message: "Admin access required" });
    }

    // Only master admin (nexaadmin) can delete attendance records
    if (req.session.userId !== "admin") {
      return res.status(403).json({ message: "Only master admin can delete attendance records" });
    }

    try {
      const { recordId } = req.params;

      // Get the attendance record first for audit logging
      const record = await storage.getAttendanceRecord(recordId);
      if (!record) {
        return res.status(404).json({ message: "Attendance record not found" });
      }

      // Get employee info for the response message
      const employee = await storage.getUser(record.userId);

      // Delete the attendance record
      await storage.deleteAttendanceRecord(recordId);

      // Create audit log entry
      await storage.createAuditLog({
        userId: record.userId,
        changedBy: "Master Admin (nexaadmin)",
        fieldChanged: "attendance",
        oldValue: JSON.stringify({
          recordId,
          date: record.date,
          clockIn: record.clockInTime,
          clockOut: record.clockOutTime,
        }),
        newValue: null,
        changeType: "delete",
      });

      res.json({ 
        success: true, 
        message: `Attendance record deleted for ${employee?.name || 'Unknown'} on ${record.date}` 
      });
    } catch (error) {
      console.error("Admin delete attendance error:", error);
      res.status(500).json({ message: "Failed to delete attendance record" });
    }
  });

  // Admin: Get attendance audit logs
  app.get("/api/admin/attendance/audit-logs", requireAdmin, requireFullAdmin, async (req: Request, res: Response) => {
    if (!req.session?.isAdmin) {
      return res.status(403).json({ message: "Admin access required" });
    }

    try {
      // Get all audit logs for attendance-related changes
      const allLogs = await storage.getAuditLogsByFieldPrefix("attendance");
      
      // Enrich logs with user information
      const enrichedLogs = await Promise.all(allLogs.map(async (log) => {
        const user = await storage.getUser(log.userId);
        return {
          ...log,
          userName: user?.name || 'Unknown',
          employeeCode: user?.employeeCode || null,
        };
      }));

      res.json({ logs: enrichedLogs });
    } catch (error) {
      console.error("Get attendance audit logs error:", error);
      res.status(500).json({ message: "Failed to get audit logs" });
    }
  });

  // Admin: Import attendance data from Excel
  app.post("/api/admin/attendance/import", requireAdmin, requireWriteAccess, requireFullAdmin, async (req: Request, res: Response) => {
    if (!req.session?.isAdmin) {
      return res.status(403).json({ message: "Admin access required" });
    }
    
    // View-only admins cannot import attendance records
    if (req.session.isViewOnlyAdmin) {
      return res.status(403).json({ message: "View-only admins cannot import attendance records" });
    }

    try {
      const schema = z.object({
        records: z.array(z.object({
          employeeName: z.string(),
          employeeCode: z.string().optional().nullable(),
          department: z.string().optional().nullable(),
          date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format"),
          hours: z.number().min(0).max(24),
        })),
        overwriteExisting: z.boolean().default(false),
      });

      const { records, overwriteExisting } = schema.parse(req.body);
      
      // Get all users for matching
      const allUsers = await storage.getAllUsers();
      
      // Get company timezone setting
      const companySettings = await storage.getCompanySettings();
      const timezone = companySettings?.defaultTimezone || 'Asia/Singapore';
      
      // Get timezone offset
      const getTimezoneOffset = (tz: string): string => {
        const offsets: Record<string, string> = {
          'Asia/Singapore': '+08:00',
          'Asia/Kuala_Lumpur': '+08:00',
          'Asia/Hong_Kong': '+08:00',
          'Asia/Shanghai': '+08:00',
          'Asia/Tokyo': '+09:00',
          'Asia/Seoul': '+09:00',
          'Asia/Bangkok': '+07:00',
          'Asia/Jakarta': '+07:00',
          'Asia/Kolkata': '+05:30',
          'Asia/Dubai': '+04:00',
          'Europe/London': '+00:00',
          'America/New_York': '-05:00',
          'America/Los_Angeles': '-08:00',
          'Australia/Sydney': '+11:00',
        };
        return offsets[tz] || '+08:00';
      };
      
      const tzOffset = getTimezoneOffset(timezone);
      
      const results: { 
        success: boolean; 
        employeeName: string; 
        date: string; 
        hours: number;
        error?: string;
        action?: string;
      }[] = [];
      
      for (const record of records) {
        try {
          // Skip if hours is 0
          if (record.hours === 0) {
            results.push({
              success: true,
              employeeName: record.employeeName,
              date: record.date,
              hours: record.hours,
              action: 'skipped_zero_hours',
            });
            continue;
          }
          
          // Find matching user - prefer employee code, fallback to name
          let matchedUser = null;
          
          if (record.employeeCode) {
            matchedUser = allUsers.find(u => 
              u.employeeCode?.toLowerCase().trim() === record.employeeCode?.toLowerCase().trim()
            );
          }
          
          if (!matchedUser) {
            // Try matching by name (case-insensitive, trimmed)
            matchedUser = allUsers.find(u => 
              u.name.toLowerCase().trim() === record.employeeName.toLowerCase().trim()
            );
          }
          
          if (!matchedUser) {
            results.push({
              success: false,
              employeeName: record.employeeName,
              date: record.date,
              hours: record.hours,
              error: `Employee not found: ${record.employeeName}${record.employeeCode ? ` (${record.employeeCode})` : ''}`,
            });
            continue;
          }
          
          // Check for existing records on this date
          const existingRecords = await storage.getAttendanceRecordsByUserAndDateRange(
            matchedUser.id, 
            record.date, 
            record.date
          );
          
          if (existingRecords.length > 0) {
            if (overwriteExisting) {
              // Delete existing records
              for (const existing of existingRecords) {
                await storage.deleteAttendanceRecord(existing.id);
              }
            } else {
              results.push({
                success: false,
                employeeName: record.employeeName,
                date: record.date,
                hours: record.hours,
                error: `Attendance record already exists for ${record.date}`,
              });
              continue;
            }
          }
          
          // Create attendance record with calculated clock-in/out times
          // Clock in at 09:00, clock out at 09:00 + hours
          const clockInTime = new Date(`${record.date}T09:00:00${tzOffset}`);
          const clockOutTime = new Date(clockInTime.getTime() + record.hours * 60 * 60 * 1000);
          
          await storage.createAttendanceRecord({
            userId: matchedUser.id,
            date: record.date,
            clockInTime,
            clockOutTime,
            clockInLocationText: 'Imported from Excel',
            clockOutLocationText: 'Imported from Excel',
          });
          
          results.push({
            success: true,
            employeeName: record.employeeName,
            date: record.date,
            hours: record.hours,
            action: overwriteExisting && existingRecords.length > 0 ? 'replaced' : 'created',
          });
        } catch (err: any) {
          results.push({
            success: false,
            employeeName: record.employeeName,
            date: record.date,
            hours: record.hours,
            error: err.message || 'Unknown error',
          });
        }
      }
      
      const successCount = results.filter(r => r.success).length;
      const failureCount = results.filter(r => !r.success).length;
      
      res.json({
        success: true,
        message: `Imported ${successCount} records, ${failureCount} failed`,
        results,
        summary: {
          total: records.length,
          success: successCount,
          failed: failureCount,
          skipped: results.filter(r => r.action === 'skipped_zero_hours').length,
        }
      });
    } catch (error) {
      console.error("Import attendance error:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ 
          message: "Invalid import data", 
          errors: error.errors 
        });
      }
      res.status(500).json({ message: "Failed to import attendance data" });
    }
  });

  // Admin: Update attendance buffer settings
  app.put("/api/admin/attendance/buffer", requireAdmin, requireWriteAccess, requireFullAdmin, async (req: Request, res: Response) => {
    if (!req.session?.isAdmin) {
      return res.status(403).json({ message: "Admin access required" });
    }

    try {
      const schema = z.object({
        attendanceBufferMinutes: z.number().min(0).max(120), // Max 2 hours buffer
      });

      const { attendanceBufferMinutes } = schema.parse(req.body);
      const updatedSettings = await storage.updateCompanySettings({ attendanceBufferMinutes });
      
      res.json({ success: true, settings: updatedSettings });
    } catch (error) {
      console.error("Update attendance buffer error:", error);
      res.status(500).json({ message: "Failed to update attendance buffer" });
    }
  });

  // ==================== PAYSLIP ENDPOINTS ====================

  // Helper function to calculate hours from attendance records (rounded to nearest 0.5)
  function calculateTotalHoursFromRecords(records: any[]): number {
    const totalHours = records.reduce((sum, record) => {
      if (record.clockOutTime) {
        const hours = (new Date(record.clockOutTime).getTime() - new Date(record.clockInTime).getTime()) / (1000 * 60 * 60);
        return sum + Math.round(hours * 2) / 2; // Round to nearest 0.5
      }
      return sum;
    }, 0);
    return totalHours;
  }

  // Admin: Calculate hours for payslip generation
  app.get("/api/admin/payslips/calculate", async (req: Request, res: Response) => {
    if (!req.session?.isAdmin) {
      return res.status(403).json({ message: "Admin access required" });
    }

    try {
      const { userId, startDate, endDate } = req.query as { userId?: string; startDate?: string; endDate?: string };
      
      if (!userId || !startDate || !endDate) {
        return res.status(400).json({ message: "userId, startDate, and endDate are required" });
      }

      const records = await storage.getAttendanceRecordsByUserAndDateRange(userId, startDate, endDate);
      const totalHours = calculateTotalHoursFromRecords(records);

      res.json({
        userId,
        startDate,
        endDate,
        totalHours,
        recordCount: records.length,
      });
    } catch (error) {
      console.error("Calculate hours error:", error);
      res.status(500).json({ message: "Failed to calculate hours" });
    }
  });

  // Admin: Get all payslips
  app.get("/api/admin/payslips", async (req: Request, res: Response) => {
    if (!req.session?.isAdmin) {
      return res.status(403).json({ message: "Admin access required" });
    }

    try {
      const payslips = await storage.getAllPayslips();
      res.json({ payslips });
    } catch (error) {
      console.error("Get all payslips error:", error);
      res.status(500).json({ message: "Failed to get payslips" });
    }
  });

  // Admin: Create payslip
  app.post("/api/admin/payslips", async (req: Request, res: Response) => {
    if (!req.session?.isAdmin) {
      return res.status(403).json({ message: "Admin access required" });
    }

    try {
      const schema = z.object({
        userId: z.string(),
        periodStart: z.string(),
        periodEnd: z.string(),
        hourlyWage: z.number().min(0), // Cents
      });

      const data = schema.parse(req.body);

      // Calculate total hours from attendance records
      const records = await storage.getAttendanceRecordsByUserAndDateRange(
        data.userId,
        data.periodStart,
        data.periodEnd
      );
      const totalHours = calculateTotalHoursFromRecords(records);
      
      // Convert hours to half-hour increments (e.g., 8.5 hours = 17 half-hours)
      const totalHalfHours = Math.round(totalHours * 2);
      const totalPay = (data.hourlyWage * totalHalfHours) / 2; // Divide by 2 since wage is per hour but we have half-hours

      const payslip = await storage.createPayslip({
        userId: data.userId,
        periodStart: data.periodStart,
        periodEnd: data.periodEnd,
        hourlyWage: data.hourlyWage,
        totalHours: totalHalfHours,
        totalPay: Math.round(totalPay),
        status: "draft",
        approvedAt: null,
        approvedBy: null,
      });

      res.json({ success: true, payslip });
    } catch (error) {
      console.error("Create payslip error:", error);
      res.status(500).json({ message: "Failed to create payslip" });
    }
  });

  // Admin: Approve payslip
  app.patch("/api/admin/payslips/:id/approve", async (req: Request, res: Response) => {
    if (!req.session?.isAdmin) {
      return res.status(403).json({ message: "Admin access required" });
    }

    try {
      const { id } = req.params;
      const adminId = req.session.userId!;

      const payslip = await storage.updatePayslip(id, {
        status: "approved",
        approvedAt: new Date(),
        approvedBy: adminId,
      });

      if (!payslip) {
        return res.status(404).json({ message: "Payslip not found" });
      }

      res.json({ success: true, payslip });
    } catch (error) {
      console.error("Approve payslip error:", error);
      res.status(500).json({ message: "Failed to approve payslip" });
    }
  });

  // User: Get approved payslips
  app.get("/api/payslips", async (req: Request, res: Response) => {
    if (!req.session?.userId || req.session.isAdmin) {
      return res.status(401).json({ message: "User authentication required" });
    }

    try {
      const userId = req.session.userId;
      const payslips = await storage.getApprovedPayslipsByUser(userId);
      res.json({ payslips });
    } catch (error) {
      console.error("Get user payslips error:", error);
      res.status(500).json({ message: "Failed to get payslips" });
    }
  });

  // Admin: Toggle allow employee view for a payroll record
  app.patch("/api/admin/payroll/:id/allow-employee-view", requireAdmin, requireWriteAccess, requireFullAdmin, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { allowEmployeeView } = req.body;
      
      if (typeof allowEmployeeView !== 'boolean') {
        return res.status(400).json({ message: "allowEmployeeView must be a boolean" });
      }
      
      const record = await storage.updatePayrollRecord(id, { allowEmployeeView });
      
      if (!record) {
        return res.status(404).json({ message: "Payroll record not found" });
      }
      
      res.json({ success: true, record });
    } catch (error) {
      console.error("Toggle allow employee view error:", error);
      res.status(500).json({ message: "Failed to update payroll record" });
    }
  });

  // Admin: Bulk toggle allow employee view for all payroll records in a period
  app.patch("/api/admin/payroll/bulk-allow-employee-view", requireAdmin, requireWriteAccess, requireFullAdmin, async (req: Request, res: Response) => {
    try {
      const schema = z.object({
        year: z.number().min(2020).max(2100),
        month: z.number().min(1).max(12),
        allowEmployeeView: z.boolean(),
      });
      const { year, month, allowEmployeeView } = schema.parse(req.body);
      
      const records = await storage.getPayrollRecords(year, month);
      if (records.length === 0) {
        return res.status(404).json({ message: "No payroll records found for this period" });
      }
      
      let updatedCount = 0;
      for (const record of records) {
        await storage.updatePayrollRecord(record.id, { allowEmployeeView });
        updatedCount++;
      }
      
      res.json({ 
        success: true, 
        updatedCount,
        allowEmployeeView,
        message: `Updated ${updatedCount} payroll records` 
      });
    } catch (error) {
      console.error("Bulk toggle allow employee view error:", error);
      res.status(500).json({ message: "Failed to bulk update payroll records" });
    }
  });

  // Employee: Get their own viewable payroll records (payslips)
  app.get("/api/employee/payroll", async (req: Request, res: Response) => {
    if (!req.session?.userId) {
      return res.status(401).json({ message: "Authentication required" });
    }
    
    // Admin users should not use this endpoint
    if (req.session.isAdmin) {
      return res.status(403).json({ message: "This endpoint is for employees only" });
    }

    try {
      const userId = req.session.userId;
      const records = await storage.getEmployeeViewablePayrollRecords(userId);
      res.json({ records });
    } catch (error) {
      console.error("Get employee payroll records error:", error);
      res.status(500).json({ message: "Failed to get payroll records" });
    }
  });

  // ==================== LEAVE MANAGEMENT ENDPOINTS ====================

  // Admin: Get all leave balances
  app.get("/api/admin/leave/balances", requireAdmin, requireFullAdmin, async (req: Request, res: Response) => {
    if (!req.session?.isAdmin) {
      return res.status(403).json({ message: "Admin access required" });
    }

    try {
      const { year } = req.query as { year?: string };
      const yearFilter = year ? parseInt(year) : undefined;
      let balances = await storage.getAllLeaveBalances(yearFilter);
      
      // Auto-fill missing employee names from users table
      const balancesWithMissingNames = balances.filter(b => !b.employeeName);
      if (balancesWithMissingNames.length > 0) {
        const allUsers = await storage.getAllUsers();
        const userMap = new Map(allUsers.map(u => [u.id, u]));
        
        for (const balance of balancesWithMissingNames) {
          const user = userMap.get(balance.userId);
          if (user) {
            // Update directly in database
            await db.update(leaveBalances)
              .set({
                employeeName: user.name,
                employeeCode: balance.employeeCode || user.employeeCode || undefined,
              })
              .where(eq(leaveBalances.id, balance.id));
          }
        }
        // Refetch after update
        balances = await storage.getAllLeaveBalances(yearFilter);
      }
      
      res.json({ balances });
    } catch (error) {
      console.error("Get all leave balances error:", error);
      res.status(500).json({ message: "Failed to get leave balances" });
    }
  });

  // Admin: Create or update leave balance
  app.post("/api/admin/leave/balances", requireAdmin, requireWriteAccess, requireFullAdmin, async (req: Request, res: Response) => {
    if (!req.session?.isAdmin) {
      return res.status(403).json({ message: "Admin access required" });
    }

    try {
      const schema = z.object({
        userId: z.string(),
        leaveType: z.string(),
        year: z.number().optional(),
        broughtForward: z.number().optional().default(0),
        earned: z.number().optional().default(0),
        eligible: z.number().optional().default(0),
        taken: z.number().optional().default(0),
        balance: z.number().optional().default(0),
        employeeCode: z.string().optional(),
        employeeName: z.string().optional(),
      });

      const data = schema.parse(req.body);
      const year = data.year || new Date().getFullYear();

      const balance = await storage.createOrUpdateLeaveBalance({
        userId: data.userId,
        leaveType: data.leaveType,
        year,
        broughtForward: String(data.broughtForward),
        earned: String(data.earned),
        eligible: String(data.eligible),
        taken: String(data.taken),
        balance: String(data.balance),
        employeeCode: data.employeeCode,
        employeeName: data.employeeName,
      });

      res.json({ success: true, balance });
    } catch (error) {
      console.error("Create/update leave balance error:", error);
      res.status(500).json({ message: "Failed to update leave balance" });
    }
  });

  // Admin: Get all leave applications
  app.get("/api/admin/leave/applications", requireAdmin, requireFullAdmin, async (req: Request, res: Response) => {
    if (!req.session?.isAdmin) {
      return res.status(403).json({ message: "Admin access required" });
    }

    try {
      const applications = await storage.getAllLeaveApplications();
      res.json({ applications });
    } catch (error) {
      console.error("Get all leave applications error:", error);
      res.status(500).json({ message: "Failed to get leave applications" });
    }
  });

  // Admin: Review leave application (approve/reject)
  app.patch("/api/admin/leave/applications/:id", requireAdmin, requireWriteAccess, requireFullAdmin, async (req: Request, res: Response) => {
    if (!req.session?.isAdmin) {
      return res.status(403).json({ message: "Admin access required" });
    }

    try {
      const { id } = req.params;
      const schema = z.object({
        status: z.enum(["approved", "rejected"]),
        reviewComments: z.string().optional(),
      });

      const data = schema.parse(req.body);
      const adminId = req.session.userId!;

      const application = await storage.getLeaveApplicationById(id);
      if (!application) {
        return res.status(404).json({ message: "Leave application not found" });
      }

      // If approved, update leave balance (increment taken field)
      if (data.status === "approved") {
        const leaveYear = new Date(application.startDate).getFullYear();
        const balance = await storage.getLeaveBalance(
          application.userId,
          application.leaveType,
          leaveYear
        );

        if (balance) {
          const currentTaken = parseFloat(balance.taken || '0');
          const applicationDays = parseFloat(String(application.totalDays) || '0');
          const newTaken = currentTaken + applicationDays;
          const currentBalance = parseFloat(balance.balance || '0');
          const newBalance = currentBalance - applicationDays;
          
          await storage.updateLeaveBalanceTaken(
            balance.id,
            String(newTaken),
            String(newBalance)
          );
        }
      }

      const updated = await storage.updateLeaveApplication(id, {
        status: data.status,
        reviewedBy: adminId,
        reviewedAt: new Date(),
        reviewComments: data.reviewComments || null,
      });

      res.json({ success: true, application: updated });
    } catch (error) {
      console.error("Review leave application error:", error);
      res.status(500).json({ message: "Failed to review leave application" });
    }
  });

  // Admin: Import leave history from CSV (server-side matching, only imports matched employees)
  app.post("/api/admin/leave/history/import", requireAdmin, requireWriteAccess, requireFullAdmin, async (req: Request, res: Response) => {
    if (!req.session?.isAdmin) {
      return res.status(403).json({ message: "Admin access required" });
    }

    try {
      const schema = z.object({
        records: z.array(z.object({
          employeeCode: z.string(),
          employeeName: z.string(),
          leaveType: z.string(),
          leaveDate: z.string(),
          dayOfWeek: z.string().optional().nullable(),
          remarks: z.string().optional().nullable(),
          daysOrHours: z.string().default("1.00 day"),
          mlClaimAmount: z.any().optional().nullable(),
          year: z.number(),
        })),
        replaceExisting: z.boolean().optional().default(false),
      });

      const { records, replaceExisting } = schema.parse(req.body);

      if (records.length === 0) {
        return res.status(400).json({ message: "No records to import" });
      }

      console.log(`[Leave Import] Starting import of ${records.length} total records, replaceExisting=${replaceExisting}`);

      // Server-side employee matching (same logic as check-matches)
      const allUsers = await storage.getAllUsers();
      const activeUsers = allUsers.filter(u => (u.isApproved && !u.role?.includes('admin')) || u.isArchived);
      const usersByCode = new Map(activeUsers.filter(u => u.employeeCode).map(u => [u.employeeCode!, u]));

      // Build a map of import employee key -> matched system user
      const uniqueEmployees = new Map<string, { code: string; name: string }>();
      for (const r of records) {
        const key = `${r.employeeCode}||${r.employeeName}`;
        if (!uniqueEmployees.has(key)) {
          uniqueEmployees.set(key, { code: r.employeeCode, name: r.employeeName });
        }
      }

      const matchMap = new Map<string, { userId: string; systemName: string; systemCode: string | null }>();
      for (const [key, emp] of Array.from(uniqueEmployees)) {
        let user = usersByCode.get(emp.code);
        if (!user) {
          const importNameLower = emp.name.toLowerCase().trim();
          for (const u of activeUsers) {
            const systemNameLower = (u.name || '').toLowerCase().trim();
            if (!systemNameLower) continue;
            if (importNameLower.includes(systemNameLower) || systemNameLower.includes(importNameLower)) {
              user = u;
              break;
            }
          }
        }
        if (user) {
          matchMap.set(key, { userId: user.id, systemName: user.name, systemCode: user.employeeCode || null });
        }
      }

      console.log(`[Leave Import] Matched ${matchMap.size} of ${uniqueEmployees.size} unique employees`);

      // Filter to only matched records and stamp with userId
      const matchedRecords = records
        .map(r => {
          const key = `${r.employeeCode}||${r.employeeName}`;
          const match = matchMap.get(key);
          if (!match) return null;
          return {
            ...r,
            userId: match.userId,
            employeeCode: match.systemCode || r.employeeCode,
            mlClaimAmount: (() => {
              if (r.mlClaimAmount === null || r.mlClaimAmount === undefined || r.mlClaimAmount === '') return "0";
              const num = parseFloat(String(r.mlClaimAmount));
              return isNaN(num) ? "0" : num.toFixed(2);
            })(),
            dayOfWeek: r.dayOfWeek || null,
            remarks: r.remarks || null,
            daysOrHours: r.daysOrHours || "1.00 day",
          };
        })
        .filter((r): r is NonNullable<typeof r> => r !== null);

      const skippedCount = records.length - matchedRecords.length;
      console.log(`[Leave Import] ${matchedRecords.length} matched records to import, ${skippedCount} unmatched records skipped`);

      if (matchedRecords.length === 0) {
        return res.status(400).json({ message: "No matching employees found. Use Check Matches to verify employee matching before importing." });
      }

      if (replaceExisting) {
        const years = Array.from(new Set(matchedRecords.map(r => r.year)));
        for (const year of years) {
          await storage.deleteLeaveHistoryByYear(year);
        }
      }

      const CHUNK_SIZE = 200;
      let allCreated: any[] = [];
      const failedChunks: number[] = [];
      const totalChunks = Math.ceil(matchedRecords.length / CHUNK_SIZE);
      for (let i = 0; i < matchedRecords.length; i += CHUNK_SIZE) {
        const chunkIdx = Math.floor(i / CHUNK_SIZE) + 1;
        const chunk = matchedRecords.slice(i, i + CHUNK_SIZE);
        try {
          const created = await storage.bulkCreateLeaveHistory(chunk);
          allCreated = allCreated.concat(created);
          console.log(`[Leave Import] Inserted chunk ${chunkIdx}/${totalChunks}: ${created.length} records`);
        } catch (chunkError: any) {
          failedChunks.push(chunkIdx);
          console.error(`[Leave Import] Chunk ${chunkIdx}/${totalChunks} failed:`, chunkError?.message || chunkError);
          console.error(`[Leave Import] Sample record from failed chunk:`, JSON.stringify(chunk[0]));
        }
      }

      if (failedChunks.length === totalChunks) {
        return res.status(500).json({ message: `All ${totalChunks} batch(es) failed to import. Check server logs for details.` });
      }
      
      const adminUsername = req.session.userId || "admin";
      const years = Array.from(new Set(matchedRecords.map(r => r.year)));
      await storage.createLeaveAuditLog({
        action: "import",
        tableName: "leave_history",
        details: JSON.stringify({ 
          totalRecords: records.length, 
          matchedImported: allCreated.length, 
          unmatchedSkipped: skippedCount,
          years, 
          replaceExisting 
        }),
        changedBy: adminUsername,
      });

      // Auto-sync leave history into leave_balances
      // Recompute "taken" from ALL leave_history records per userId/leaveType/year
      // and preserve existing broughtForward/earned/eligible values
      const syncResults = { synced: 0, errors: 0 };
      try {
        // Identify unique userId/leaveType/year combos from this import
        const affectedKeys = new Set<string>();
        const affectedMeta = new Map<string, { userId: string; leaveType: string; year: number; employeeCode: string | null; employeeName: string }>();
        for (const r of allCreated) {
          const aggKey = `${r.userId}||${r.leaveType}||${r.year}`;
          if (!affectedMeta.has(aggKey)) {
            affectedMeta.set(aggKey, {
              userId: r.userId,
              leaveType: r.leaveType,
              year: r.year,
              employeeCode: r.employeeCode,
              employeeName: r.employeeName,
            });
          }
          affectedKeys.add(aggKey);
        }

        console.log(`[Leave Import] Syncing ${affectedMeta.size} leave balance entries from full history`);

        for (const [, meta] of Array.from(affectedMeta)) {
          try {
            // Query ALL leave_history records for this userId/leaveType/year to get accurate total
            const allHistoryForKey = await db.select()
              .from(leaveHistory)
              .where(
                and(
                  eq(leaveHistory.userId, meta.userId),
                  eq(leaveHistory.leaveType, meta.leaveType),
                  eq(leaveHistory.year, meta.year)
                )
              );
            
            const totalDays = allHistoryForKey.reduce((sum, h) => {
              const days = parseFloat(h.daysOrHours?.match(/[\d.]+/)?.[0] || '1') || 1;
              return sum + days;
            }, 0);

            // Get existing balance to preserve broughtForward/earned/eligible
            const existingBalance = await storage.getLeaveBalance(meta.userId, meta.leaveType, meta.year);
            const bf = existingBalance ? parseFloat(existingBalance.broughtForward || '0') : 0;
            const earned = existingBalance ? parseFloat(existingBalance.earned || '0') : 0;
            const eligible = existingBalance ? parseFloat(existingBalance.eligible || '0') : 0;
            const computedBalance = eligible - totalDays;

            await storage.createOrUpdateLeaveBalance({
              userId: meta.userId,
              leaveType: meta.leaveType,
              year: meta.year,
              taken: totalDays.toFixed(2),
              balance: computedBalance.toFixed(2),
              broughtForward: bf.toFixed(2),
              earned: earned.toFixed(2),
              eligible: eligible.toFixed(2),
              employeeCode: meta.employeeCode || undefined,
              employeeName: meta.employeeName,
            });
            syncResults.synced++;
          } catch (syncErr: any) {
            syncResults.errors++;
            console.error(`[Leave Import] Balance sync error for ${meta.userId}/${meta.leaveType}/${meta.year}:`, syncErr?.message);
          }
        }
        console.log(`[Leave Import] Balance sync complete: ${syncResults.synced} synced, ${syncResults.errors} errors`);
      } catch (syncError: any) {
        console.error("[Leave Import] Balance sync failed:", syncError?.message);
      }

      console.log(`[Leave Import] Complete: ${allCreated.length} records imported (${skippedCount} unmatched skipped), ${failedChunks.length} chunk(s) failed`);

      const partialFailure = failedChunks.length > 0;
      res.json({ 
        success: true, 
        message: partialFailure 
          ? `Imported ${allCreated.length} of ${matchedRecords.length} matched records (${skippedCount} unmatched skipped, ${failedChunks.length} batch(es) failed)`
          : `Imported ${allCreated.length} matched records (${skippedCount} unmatched skipped). ${syncResults.synced} leave balance entries synced.`,
        imported: allCreated.length,
        skipped: skippedCount,
        balancesSynced: syncResults.synced,
        ...(partialFailure && { failedBatches: failedChunks.length, totalBatches: totalChunks })
      });
    } catch (error: any) {
      console.error("Import leave history error:", error?.message || error);
      console.error("Import leave history stack:", error?.stack);
      res.status(500).json({ message: `Failed to import leave history: ${error?.message || "Unknown error"}` });
    }
  });

  // Admin: Parse Excel leave history file (3SI format + flat tabular)
  app.post("/api/admin/leave/history/parse-excel", requireAdmin, requireWriteAccess, requireFullAdmin, async (req: Request, res: Response) => {
    if (!req.session?.isAdmin) {
      return res.status(403).json({ message: "Admin access required" });
    }

    try {
      const { fileBase64, fileName } = req.body;
      
      if (!fileBase64) {
        return res.status(400).json({ message: "No file data provided" });
      }

      console.log(`[Leave Import] Parsing file: ${fileName}, base64 length: ${fileBase64?.length || 0}`);
      
      let buffer: Buffer;
      try {
        buffer = Buffer.from(fileBase64, "base64");
        console.log(`[Leave Import] Buffer created, size: ${buffer.length} bytes`);
      } catch (bufferError) {
        console.error("[Leave Import] Buffer creation failed:", bufferError);
        return res.status(400).json({ message: "Invalid file data encoding" });
      }
      
      let workbook;
      try {
        workbook = XLSX.read(buffer, { type: "buffer" });
        console.log(`[Leave Import] Workbook read successfully, sheets: ${workbook.SheetNames.join(", ")}`);
      } catch (xlsxError: any) {
        console.error("[Leave Import] XLSX parse failed:", xlsxError);
        return res.status(400).json({ message: `Failed to parse Excel file: ${xlsxError.message || "Unknown error"}` });
      }
      
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const data = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];
      
      console.log(`[Leave Import] Raw data rows: ${data.length}`);
      if (data.length > 0) {
        console.log(`[Leave Import] First row sample:`, JSON.stringify(data[0]?.slice(0, 10)));
        if (data.length > 1) console.log(`[Leave Import] Second row sample:`, JSON.stringify(data[1]?.slice(0, 10)));
      }

      const parseExcelDate = (val: any): { formatted: string; year: number } | null => {
        if (val === null || val === undefined) return null;
        const str = val.toString().trim();
        const ddmmyyyy = str.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
        if (ddmmyyyy) {
          const [, d, m, y] = ddmmyyyy;
          return { formatted: `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`, year: parseInt(y) };
        }
        const yyyymmdd = str.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
        if (yyyymmdd) {
          const [, y, m, d] = yyyymmdd;
          return { formatted: `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`, year: parseInt(y) };
        }
        if (typeof val === 'number' && val > 25000 && val < 60000) {
          const date = new Date((val - 25569) * 86400 * 1000);
          if (!isNaN(date.getTime())) {
            const y = date.getFullYear();
            const m = String(date.getMonth() + 1).padStart(2, '0');
            const d = String(date.getDate()).padStart(2, '0');
            return { formatted: `${y}-${m}-${d}`, year: y };
          }
        }
        return null;
      };

      const normalizeLeaveType = (raw: string): string => {
        const upper = raw.trim().toUpperCase();
        if (/^[A-Z]{2,4}(FH|SH)?$/.test(upper)) return upper;
        const mapping: Record<string, string> = {
          'ANNUAL LEAVE': 'AL', 'ANNUAL': 'AL',
          'MEDICAL LEAVE': 'ML', 'MEDICAL': 'ML', 'SICK LEAVE': 'ML',
          'COMPASSIONATE LEAVE': 'CL', 'COMPASSIONATE': 'CL',
          'OFF IN LIEU': 'OIL', 'OFF-IN-LIEU': 'OIL', 'TIME OFF IN LIEU': 'OIL',
          'UNPAID LEAVE': 'UL', 'UNPAID': 'UL', 'NO PAY LEAVE': 'UL',
          'MATERNITY LEAVE': 'MTL', 'MATERNITY': 'MTL',
          'PATERNITY LEAVE': 'PL', 'PATERNITY': 'PL',
          'HOSPITALIZATION LEAVE': 'HL', 'HOSPITALIZATION': 'HL',
        };
        for (const [key, val] of Object.entries(mapping)) {
          if (upper === key || upper.includes(key)) return val;
        }
        const abbrevMatch = upper.match(/^([A-Z]{2,4})\s*[-–]\s*/);
        if (abbrevMatch) return abbrevMatch[1];
        return upper.substring(0, 4);
      };
      
      let records: any[] = [];

      // Try 3SI format first
      let currentEmployee: { code: string; name: string } | null = null;
      let currentLeaveType: string | null = null;
      
      for (let i = 0; i < data.length; i++) {
        const row = data[i];
        if (!row || row.length === 0) continue;
        
        const rowStr = row.map((c: any) => c?.toString() || '').join(' ');
        
        if (rowStr.includes('Emp Code:') && rowStr.includes('Employee:')) {
          const match = rowStr.match(/Emp Code:\s*(\w+)\s+Employee:\s*(.+?)(?:\s{2,}|Leave Calculation)/);
          if (match) {
            currentEmployee = { code: match[1], name: match[2].trim() };
          }
          continue;
        }
        
        if (rowStr.includes('Leave Type:') || (row[1] && row[1].toString().includes('Leave Type'))) {
          const typeMatch = rowStr.match(/([A-Z]{2,4})\s*-\s*[A-Z\s]+/i);
          if (typeMatch) currentLeaveType = typeMatch[1].toUpperCase();
          continue;
        }
        
        if (currentEmployee && currentLeaveType && typeof row[1] === 'number' && row[3]) {
          const parsed = parseExcelDate(row[3]);
          if (parsed) {
            const dayOfWeek = row[9]?.toString() || '';
            const remarks = row[13]?.toString() || null;
            const daysOrHours = row[24]?.toString() || '1.00 day';
            const mlClaimAmt = row[31]?.toString() || null;
            
            records.push({
              employeeCode: currentEmployee.code,
              employeeName: currentEmployee.name,
              leaveType: currentLeaveType,
              leaveDate: parsed.formatted,
              dayOfWeek: dayOfWeek || null,
              remarks: remarks,
              daysOrHours: daysOrHours,
              mlClaimAmount: mlClaimAmt,
              year: parsed.year
            });
          }
        }
      }
      
      console.log(`[Leave Import] 3SI parser found ${records.length} records`);

      if (records.length === 0 && data.length >= 2) {
        console.log(`[Leave Import] Trying flat tabular format...`);
        const headerRow = data[0]?.map((h: any) => h?.toString().trim().toLowerCase() || '') || [];
        console.log(`[Leave Import] Headers detected: ${JSON.stringify(headerRow)}`);

        const findCol = (keywords: string[]): number => {
          for (const kw of keywords) {
            const idx = headerRow.findIndex((h: string) => h.includes(kw));
            if (idx >= 0) return idx;
          }
          return -1;
        };

        const codeCol = findCol(['emp code', 'employee code', 'emp_code', 'employee_code', 'empcode', 'code', 'emp no', 'emp_no', 'empno', 'employee no', 'employee_no', 's/no', 's.no']);
        const nameCol = findCol(['emp name', 'employee name', 'emp_name', 'employee_name', 'empname', 'name', 'employee']);
        const typeCol = findCol(['leave type', 'leave_type', 'leavetype', 'type', 'leave code', 'leave_code']);
        const dateCol = findCol(['date', 'leave date', 'leave_date', 'leavedate', 'from', 'start', 'from date']);
        const daysCol = findCol(['days', 'day', 'hours', 'duration', 'days_or_hours', 'qty', 'quantity', 'no of day', 'no. of day']);
        const remarksCol = findCol(['remarks', 'remark', 'notes', 'note', 'comment', 'comments', 'reason', 'description']);

        console.log(`[Leave Import] Flat CSV column mapping: code=${codeCol}, name=${nameCol}, type=${typeCol}, date=${dateCol}, days=${daysCol}, remarks=${remarksCol}`);

        if (dateCol >= 0 && typeCol >= 0 && (codeCol >= 0 || nameCol >= 0)) {
          for (let i = 1; i < data.length; i++) {
            const row = data[i];
            if (!row || row.length === 0) continue;

            const dateVal = row[dateCol];
            const parsed = parseExcelDate(dateVal);
            if (!parsed) continue;

            const leaveTypeRaw = row[typeCol]?.toString().trim() || '';
            if (!leaveTypeRaw) continue;
            const leaveType = normalizeLeaveType(leaveTypeRaw);

            const empCode = codeCol >= 0 ? (row[codeCol]?.toString().trim() || '') : '';
            const empName = nameCol >= 0 ? (row[nameCol]?.toString().trim() || '') : '';
            if (!empCode && !empName) continue;

            let daysOrHours = '1.00 day';
            if (daysCol >= 0 && row[daysCol] != null) {
              const val = row[daysCol].toString().trim();
              if (/^\d+\.?\d*$/.test(val)) {
                daysOrHours = `${parseFloat(val).toFixed(2)} day`;
              } else if (val) {
                daysOrHours = val;
              }
            }

            const remarks = remarksCol >= 0 ? (row[remarksCol]?.toString().trim() || null) : null;

            records.push({
              employeeCode: empCode,
              employeeName: empName,
              leaveType,
              leaveDate: parsed.formatted,
              dayOfWeek: null,
              remarks,
              daysOrHours,
              mlClaimAmount: null,
              year: parsed.year
            });
          }
          console.log(`[Leave Import] Flat tabular parser found ${records.length} records`);
        } else {
          console.log(`[Leave Import] Could not identify required columns (date, type, code/name) in header row`);
        }
      }
      
      console.log(`[Leave Import] Total parsed ${records.length} leave records`);
      
      const uniqueEmployees = new Set(records.map(r => r.employeeCode || r.employeeName));
      const leaveTypeCounts: Record<string, number> = {};
      records.forEach(r => {
        leaveTypeCounts[r.leaveType] = (leaveTypeCounts[r.leaveType] || 0) + 1;
      });
      
      res.json({
        success: true,
        records,
        summary: {
          totalRecords: records.length,
          uniqueEmployees: uniqueEmployees.size,
          leaveTypes: leaveTypeCounts
        }
      });
    } catch (error) {
      console.error("[Leave Import] Parse error:", error);
      res.status(500).json({ message: "Failed to parse leave history file" });
    }
  });

  // Admin: Check employee matches for leave import
  app.post("/api/admin/leave/history/check-matches", requireAdmin, requireFullAdmin, async (req: Request, res: Response) => {
    if (!req.session?.isAdmin) {
      return res.status(403).json({ message: "Admin access required" });
    }

    try {
      const { employeeCodes } = req.body as { employeeCodes: { code: string; name: string; recordCount: number }[] };
      
      if (!employeeCodes || !Array.isArray(employeeCodes)) {
        return res.status(400).json({ message: "employeeCodes array required" });
      }

      const allUsers = await storage.getAllUsers();
      const activeUsers = allUsers.filter(u => (u.isApproved && !u.role?.includes('admin')) || u.isArchived);
      const usersByCode = new Map(activeUsers.filter(u => u.employeeCode).map(u => [u.employeeCode!, u]));
      
      const results = employeeCodes.map(ec => {
        let user = usersByCode.get(ec.code);
        let matchMethod: 'code' | 'name' | null = user ? 'code' : null;

        if (!user) {
          const importNameLower = ec.name.toLowerCase().trim();
          for (const u of activeUsers) {
            const systemNameLower = (u.name || '').toLowerCase().trim();
            if (!systemNameLower) continue;
            if (importNameLower.includes(systemNameLower) || systemNameLower.includes(importNameLower)) {
              user = u;
              matchMethod = 'name';
              break;
            }
          }
        }

        return {
          code: ec.code,
          importName: ec.name,
          recordCount: ec.recordCount,
          matched: !!user,
          matchMethod,
          systemName: user?.name || null,
          systemCode: user?.employeeCode || null,
          systemId: user?.id || null,
        };
      });

      const matched = results.filter(r => r.matched);
      const unmatched = results.filter(r => !r.matched);

      res.json({
        total: results.length,
        matchedCount: matched.length,
        unmatchedCount: unmatched.length,
        matched,
        unmatched,
        totalRecordsMatched: matched.reduce((sum, r) => sum + r.recordCount, 0),
        totalRecordsUnmatched: unmatched.reduce((sum, r) => sum + r.recordCount, 0),
      });
    } catch (error) {
      console.error("Check matches error:", error);
      res.status(500).json({ message: "Failed to check employee matches" });
    }
  });

  // Admin: Get leave history
  app.get("/api/admin/leave/history", requireAdmin, requireFullAdmin, async (req: Request, res: Response) => {
    if (!req.session?.isAdmin) {
      return res.status(403).json({ message: "Admin access required" });
    }

    try {
      const { year } = req.query as { year?: string };
      const yearNum = year ? parseInt(year) : undefined;
      const records = await storage.getLeaveHistory(yearNum);
      res.json({ records });
    } catch (error) {
      console.error("Get leave history error:", error);
      res.status(500).json({ message: "Failed to get leave history" });
    }
  });

  // Admin: Get leave analytics/statistics
  app.get("/api/admin/leave/analytics", requireAdmin, requireFullAdmin, async (req: Request, res: Response) => {
    if (!req.session?.isAdmin) {
      return res.status(403).json({ message: "Admin access required" });
    }

    try {
      const { year } = req.query as { year?: string };
      const yearNum = year ? parseInt(year) : new Date().getFullYear();
      
      const stats = await storage.getLeaveHistoryStats(yearNum);
      const records = await storage.getLeaveHistory(yearNum);
      
      // Calculate additional analytics
      const uniqueEmployees = Array.from(new Set(records.map(r => r.employeeCode))).length;
      const totalRecords = records.length;
      
      // Group by month for chart data
      const monthlyData: Record<string, Record<string, number>> = {};
      for (const record of records) {
        const date = new Date(record.leaveDate);
        const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        if (!monthlyData[monthKey]) {
          monthlyData[monthKey] = {};
        }
        if (!monthlyData[monthKey][record.leaveType]) {
          monthlyData[monthKey][record.leaveType] = 0;
        }
        // Parse days/hours
        const match = record.daysOrHours.match(/(\d+\.?\d*)/);
        const value = match ? parseFloat(match[1]) : 1;
        const days = record.daysOrHours.includes('hr') ? value / 8 : value;
        monthlyData[monthKey][record.leaveType] += days;
      }
      
      // Employee utilization data
      const employeeUtilization: Record<string, { name: string; total: number; byType: Record<string, number> }> = {};
      for (const record of records) {
        if (!employeeUtilization[record.employeeCode]) {
          employeeUtilization[record.employeeCode] = { name: record.employeeName, total: 0, byType: {} };
        }
        const match = record.daysOrHours.match(/(\d+\.?\d*)/);
        const value = match ? parseFloat(match[1]) : 1;
        const days = record.daysOrHours.includes('hr') ? value / 8 : value;
        employeeUtilization[record.employeeCode].total += days;
        if (!employeeUtilization[record.employeeCode].byType[record.leaveType]) {
          employeeUtilization[record.employeeCode].byType[record.leaveType] = 0;
        }
        employeeUtilization[record.employeeCode].byType[record.leaveType] += days;
      }

      res.json({
        year: yearNum,
        stats,
        uniqueEmployees,
        totalRecords,
        monthlyData,
        employeeUtilization,
      });
    } catch (error) {
      console.error("Get leave analytics error:", error);
      res.status(500).json({ message: "Failed to get leave analytics" });
    }
  });

  // Admin: Update leave history record
  app.patch("/api/admin/leave/history/:id", requireAdmin, requireWriteAccess, requireFullAdmin, async (req: Request, res: Response) => {
    if (!req.session?.isAdmin) {
      return res.status(403).json({ message: "Admin access required" });
    }

    try {
      const { id } = req.params;
      const existing = await storage.getLeaveHistoryById(id);
      if (!existing) {
        return res.status(404).json({ message: "Leave record not found" });
      }

      const schema = z.object({
        employeeCode: z.string().optional(),
        employeeName: z.string().optional(),
        leaveType: z.string().optional(),
        leaveDate: z.string().optional(),
        daysOrHours: z.string().optional(),
        remarks: z.string().optional(),
      });

      const data = schema.parse(req.body);
      const updated = await storage.updateLeaveHistory(id, data);
      
      // Log the change
      const adminUsername = req.session.userId || "admin";
      const changedFields = Object.keys(data).filter(k => data[k as keyof typeof data] !== undefined);
      
      await storage.createLeaveAuditLog({
        action: "update",
        tableName: "leave_history",
        recordId: id,
        employeeCode: existing.employeeCode,
        employeeName: existing.employeeName,
        fieldName: changedFields.join(", "),
        oldValue: JSON.stringify(changedFields.reduce((acc, k) => ({ ...acc, [k]: existing[k as keyof typeof existing] }), {})),
        newValue: JSON.stringify(data),
        details: `Updated leave record for ${existing.employeeName}`,
        changedBy: adminUsername,
      });

      res.json({ success: true, record: updated });
    } catch (error) {
      console.error("Update leave history error:", error);
      res.status(500).json({ message: "Failed to update leave record" });
    }
  });

  // Admin: Delete leave history record
  app.delete("/api/admin/leave/history/:id", requireAdmin, requireWriteAccess, requireFullAdmin, async (req: Request, res: Response) => {
    if (!req.session?.isAdmin) {
      return res.status(403).json({ message: "Admin access required" });
    }

    try {
      const { id } = req.params;
      const existing = await storage.getLeaveHistoryById(id);
      if (!existing) {
        return res.status(404).json({ message: "Leave record not found" });
      }

      await storage.deleteLeaveHistory(id);
      
      // Log the deletion
      const adminUsername = req.session.userId || "admin";
      await storage.createLeaveAuditLog({
        action: "delete",
        tableName: "leave_history",
        recordId: id,
        employeeCode: existing.employeeCode,
        employeeName: existing.employeeName,
        oldValue: JSON.stringify(existing),
        details: `Deleted leave record for ${existing.employeeName} on ${existing.leaveDate}`,
        changedBy: adminUsername,
      });

      res.json({ success: true });
    } catch (error) {
      console.error("Delete leave history error:", error);
      res.status(500).json({ message: "Failed to delete leave record" });
    }
  });

  // Admin: Get leave audit logs
  app.get("/api/admin/leave/audit-logs", requireAdmin, requireFullAdmin, async (req: Request, res: Response) => {
    if (!req.session?.isAdmin) {
      return res.status(403).json({ message: "Admin access required" });
    }

    try {
      const { limit } = req.query as { limit?: string };
      const limitNum = limit ? parseInt(limit) : 100;
      const logs = await storage.getLeaveAuditLogs(limitNum);
      res.json({ logs });
    } catch (error) {
      console.error("Get leave audit logs error:", error);
      res.status(500).json({ message: "Failed to get audit logs" });
    }
  });

  // User: Get leave balances
  app.get("/api/leave/balances", async (req: Request, res: Response) => {
    if (!req.session?.userId || req.session.isAdmin) {
      return res.status(401).json({ message: "User authentication required" });
    }

    try {
      const userId = req.session.userId;
      const { year } = req.query as { year?: string };
      const currentYear = year ? parseInt(year) : new Date().getFullYear();
      
      const balances = await storage.getUserLeaveBalances(userId, currentYear);
      res.json({ balances });
    } catch (error) {
      console.error("Get user leave balances error:", error);
      res.status(500).json({ message: "Failed to get leave balances" });
    }
  });

  // User: Get leave applications
  app.get("/api/leave/applications", async (req: Request, res: Response) => {
    if (!req.session?.userId || req.session.isAdmin) {
      return res.status(401).json({ message: "User authentication required" });
    }

    try {
      const userId = req.session.userId;
      const applications = await storage.getUserLeaveApplications(userId);
      res.json({ applications });
    } catch (error) {
      console.error("Get user leave applications error:", error);
      res.status(500).json({ message: "Failed to get leave applications" });
    }
  });

  // User: Submit leave application (with file upload support)
  app.post("/api/leave/applications", upload.fields([
    { name: 'mcFile', maxCount: 1 },
    { name: 'receiptFile', maxCount: 1 }
  ]), async (req: Request, res: Response) => {
    if (!req.session?.userId || req.session.isAdmin) {
      return res.status(401).json({ message: "User authentication required" });
    }

    try {
      const schema = z.object({
        leaveType: z.string(),
        startDate: z.string(),
        endDate: z.string(),
        totalDays: z.string().transform(val => parseFloat(val)),
        dayType: z.enum(["full", "first_half", "second_half"]).optional().default("full"),
        reason: z.string().min(1),
        mlClaimAmount: z.string().optional().nullable().transform(val => val ? parseFloat(val) : null),
      });

      const data = schema.parse(req.body);
      const userId = req.session.userId;

      // Check if user has enough leave balance
      const leaveYear = new Date(data.startDate).getFullYear();
      const balance = await storage.getLeaveBalance(
        userId,
        data.leaveType,
        leaveYear
      );

      if (balance) {
        const remainingDays = parseFloat(balance.balance || '0');
        if (data.totalDays > remainingDays) {
          return res.status(400).json({ 
            message: `Insufficient leave balance. You have ${remainingDays} days remaining.` 
          });
        }
      }

      // Handle file uploads to object storage
      let mcFileUrl: string | null = null;
      let receiptFileUrl: string | null = null;
      
      const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;
      
      if (files) {
        const objectStorageService = new ObjectStorageService();
        
        if (files.mcFile && files.mcFile[0]) {
          const mcFile = files.mcFile[0];
          mcFileUrl = await objectStorageService.uploadPrivateFile(
            mcFile.buffer,
            mcFile.originalname,
            mcFile.mimetype,
            "leave-mc"
          );
        }
        
        if (files.receiptFile && files.receiptFile[0]) {
          const receiptFile = files.receiptFile[0];
          receiptFileUrl = await objectStorageService.uploadPrivateFile(
            receiptFile.buffer,
            receiptFile.originalname,
            receiptFile.mimetype,
            "leave-receipts"
          );
        }
      }

      // Get user details for denormalization
      const user = await storage.getUser(userId);

      const application = await storage.createLeaveApplication({
        userId,
        employeeCode: user?.employeeCode || null,
        employeeName: user?.name || null,
        leaveType: data.leaveType,
        startDate: data.startDate,
        endDate: data.endDate,
        totalDays: String(data.totalDays),
        dayType: data.dayType,
        reason: data.reason,
        status: "pending",
        mcFileUrl,
        receiptFileUrl,
        mlClaimAmount: data.mlClaimAmount ? String(data.mlClaimAmount) : null,
        reviewedBy: null,
        reviewedAt: null,
        reviewComments: null,
      });

      res.json({ success: true, application });
    } catch (error) {
      console.error("Submit leave application error:", error);
      if (error instanceof multer.MulterError) {
        return res.status(400).json({ message: `File upload error: ${error.message}` });
      }
      res.status(500).json({ message: "Failed to submit leave application" });
    }
  });

  // ==================== EMAIL ENDPOINTS ====================

  // Send welcome emails to selected users (admin only)
  app.post("/api/admin/users/send-welcome-email", requireAdmin, requireWriteAccess, async (req: Request, res: Response) => {
    try {
      const schema = z.object({
        userIds: z.array(z.string()),
      });

      const { userIds } = schema.parse(req.body);
      
      if (userIds.length === 0) {
        return res.status(400).json({ message: "No users selected" });
      }

      const companySettings = await storage.getCompanySettings();
      let sent = 0;
      let failed = 0;
      const errors: string[] = [];

      for (const userId of userIds) {
        try {
          const user = await storage.getUser(userId);
          if (!user) {
            errors.push(`User ${userId} not found`);
            failed++;
            continue;
          }

          // Generate new temporary password
          const tempPassword = generateTempPassword(user.employeeCode || user.username || '');
          const passwordHash = await bcrypt.hash(tempPassword, 10);

          // Update user with new password, timestamp, and force password change
          await storage.updateUser(userId, {
            passwordHash,
            welcomeEmailSentAt: new Date(),
            mustChangePassword: true,
          });

          // Generate QR code for app URL
          const appUrl = companySettings.appUrl || 'https://app.nexahrms.com';
          const qrCodeDataUrl = await QRCode.toDataURL(appUrl, { width: 150 });
          const qrCodeBase64 = qrCodeDataUrl.split(',')[1];

          // Send actual email using Resend
          if (resend) {
            const senderEmail = companySettings.senderEmail || 'onboarding@resend.dev';
            const senderName = companySettings.senderName || 'NexaHRMS';
            
            console.log(`Sending email to ${user.email} from ${senderName} <${senderEmail}>`);
            
            const { data, error } = await resend.emails.send({
              from: `${senderName} <${senderEmail}>`,
              to: user.email,
              subject: 'Welcome to NexaHRMS - Your Login Credentials',
              html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                  <h2 style="color: #333;">Welcome to NexaHRMS!</h2>
                  <p>Dear ${user.name},</p>
                  <p>We're excited to provide you with a seamless, efficient, and user-friendly experience for managing all your HR needs. From attendance and leave management to performance, payroll, and beyond—everything you need is right here at your fingertips.</p>
                  <h3 style="color: #333;">Your Login Credentials</h3>
                  <div style="background-color: #f5f5f5; padding: 15px; border-radius: 8px; margin: 15px 0;">
                    <p><strong>App URL:</strong> <a href="${appUrl}">${appUrl}</a></p>
                    <p><strong>Username:</strong> ${user.employeeCode || user.username}</p>
                    <p><strong>Password:</strong> ${tempPassword}</p>
                  </div>
                  <p style="color: #e74c3c;"><strong>Important:</strong> You will be required to change your password upon first login.</p>
                  <div style="text-align: center; margin: 20px 0;">
                    <p>Scan this QR code to access the app:</p>
                    <img src="cid:qrcode" alt="QR Code" style="width: 150px; height: 150px;" />
                  </div>
                  <p>Best regards,<br>${senderName} Team</p>
                </div>
              `,
              attachments: [
                {
                  filename: 'qrcode.png',
                  content: qrCodeBase64,
                  contentId: 'qrcode',
                },
              ],
            });
            
            if (error) {
              console.error(`Resend API error for ${user.email}:`, JSON.stringify(error));
              throw new Error(`Resend error: ${error.message}`);
            }
            
            console.log(`Resend API success for ${user.email}:`, JSON.stringify(data));
          }

          // Log the email
          await storage.createEmailLog({
            userId,
            emailType: 'welcome',
            recipientEmail: user.email,
            subject: 'Welcome to NexaHRMS - Your Login Credentials',
            status: 'sent',
            sentAt: new Date(),
          });

          console.log(`Welcome email sent to ${user.email}`);
          sent++;
        } catch (error: any) {
          console.error(`Failed to send email to user ${userId}:`, error);
          errors.push(`User ${userId}: ${error.message}`);
          failed++;
        }
      }

      res.json({
        success: true,
        message: `Sent ${sent} emails, ${failed} failed`,
        sent,
        failed,
        errors: errors.length > 0 ? errors : undefined,
      });
    } catch (error) {
      console.error("Send welcome emails error:", error);
      res.status(500).json({ message: "Failed to send welcome emails" });
    }
  });

  // Resend welcome email to a single user (regenerates password)
  app.post("/api/admin/users/resend-welcome-email", requireAdmin, requireWriteAccess, async (req: Request, res: Response) => {
    try {
      const schema = z.object({
        userId: z.string(),
      });

      const { userId } = schema.parse(req.body);

      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      const companySettings = await storage.getCompanySettings();

      // Generate new temporary password
      const tempPassword = generateTempPassword(user.employeeCode || user.username || '');
      const passwordHash = await bcrypt.hash(tempPassword, 10);

      // Update user with new password, timestamp, and force password change
      await storage.updateUser(userId, {
        passwordHash,
        welcomeEmailSentAt: new Date(),
        mustChangePassword: true,
      });

      // Generate QR code for app URL
      const appUrl = companySettings.appUrl || 'https://app.nexahrms.com';
      const qrCodeDataUrl = await QRCode.toDataURL(appUrl, { width: 150 });
      const qrCodeBase64 = qrCodeDataUrl.split(',')[1];

      // Send actual email using Resend
      if (resend) {
        const senderEmail = companySettings.senderEmail || 'onboarding@resend.dev';
        const senderName = companySettings.senderName || 'NexaHRMS';
        
        console.log(`Resending email to ${user.email} from ${senderName} <${senderEmail}>`);
        
        const { data, error } = await resend.emails.send({
          from: `${senderName} <${senderEmail}>`,
          to: user.email,
          subject: 'Welcome to NexaHRMS - Your New Login Credentials',
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h2 style="color: #333;">Welcome to NexaHRMS!</h2>
              <p>Dear ${user.name},</p>
              <p>Your login credentials have been reset. Please use the new credentials below to access the system.</p>
              <h3 style="color: #333;">Your New Login Credentials</h3>
              <div style="background-color: #f5f5f5; padding: 15px; border-radius: 8px; margin: 15px 0;">
                <p><strong>App URL:</strong> <a href="${appUrl}">${appUrl}</a></p>
                <p><strong>Username:</strong> ${user.employeeCode || user.username}</p>
                <p><strong>Password:</strong> ${tempPassword}</p>
              </div>
              <p style="color: #e74c3c;"><strong>Important:</strong> You will be required to change your password upon first login.</p>
              <div style="text-align: center; margin: 20px 0;">
                <p>Scan this QR code to access the app:</p>
                <img src="cid:qrcode" alt="QR Code" style="width: 150px; height: 150px;" />
              </div>
              <p>Best regards,<br>${senderName} Team</p>
            </div>
          `,
          attachments: [
            {
              filename: 'qrcode.png',
              content: qrCodeBase64,
              contentId: 'qrcode',
            },
          ],
        });
        
        if (error) {
          console.error(`Resend API error for ${user.email}:`, JSON.stringify(error));
          return res.status(400).json({ message: `Email failed: ${error.message}` });
        }
        
        console.log(`Resend API success for ${user.email}:`, JSON.stringify(data));
      }

      // Log the email
      await storage.createEmailLog({
        userId,
        emailType: 'welcome',
        recipientEmail: user.email,
        subject: 'Welcome to NexaHRMS - Your New Login Credentials',
        status: 'sent',
        sentAt: new Date(),
      });

      console.log(`Welcome email resent to ${user.email}`);

      res.json({
        success: true,
        message: `Welcome email resent to ${user.email} with new password`,
      });
    } catch (error) {
      console.error("Resend welcome email error:", error);
      res.status(500).json({ message: "Failed to resend welcome email" });
    }
  });

  // Get email logs (admin only)
  app.get("/api/admin/email-logs", requireAdmin, async (req: Request, res: Response) => {
    try {
      const logs = await storage.getAllEmailLogs();
      res.json({ logs });
    } catch (error) {
      console.error("Get email logs error:", error);
      res.status(500).json({ message: "Failed to fetch email logs" });
    }
  });

  // Get audit logs (admin only)
  app.get("/api/admin/audit-logs", requireAdmin, async (req: Request, res: Response) => {
    try {
      const logs = await storage.getAllAuditLogs();
      res.json({ logs });
    } catch (error) {
      console.error("Get audit logs error:", error);
      res.status(500).json({ message: "Failed to fetch audit logs" });
    }
  });

  // Generate QR code for app URL (admin only)
  app.get("/api/admin/qr-code", requireAdmin, async (req: Request, res: Response) => {
    try {
      const companySettings = await storage.getCompanySettings();
      const appUrl = companySettings.appUrl || 'https://app.nexahrms.com';
      
      const qrCodeDataUrl = await QRCode.toDataURL(appUrl, {
        errorCorrectionLevel: 'H',
        width: 200,
        margin: 2,
        color: {
          dark: '#000000',
          light: '#FFFFFF'
        }
      });

      res.json({ 
        success: true, 
        qrCode: qrCodeDataUrl,
        appUrl 
      });
    } catch (error) {
      console.error("Generate QR code error:", error);
      res.status(500).json({ message: "Failed to generate QR code" });
    }
  });

  // Update email settings (admin only)
  app.put("/api/company/email-settings", requireAdmin, requireWriteAccess, async (req: Request, res: Response) => {
    try {
      const schema = z.object({
        senderEmail: z.string().email().optional(),
        senderName: z.string().optional(),
        appUrl: z.string().url().optional(),
      });

      const data = schema.parse(req.body);
      const updated = await storage.updateCompanySettings(data);
      res.json({ success: true, settings: updated });
    } catch (error) {
      console.error("Update email settings error:", error);
      res.status(500).json({ message: "Failed to update email settings" });
    }
  });

  // Update company timezone (admin only)
  app.put("/api/company/timezone", requireAdmin, requireWriteAccess, async (req: Request, res: Response) => {
    try {
      const schema = z.object({
        defaultTimezone: z.string().min(1, "Timezone is required"),
      });

      const data = schema.parse(req.body);
      const updated = await storage.updateCompanySettings({ defaultTimezone: data.defaultTimezone });
      res.json({ success: true, settings: updated });
    } catch (error) {
      console.error("Update timezone error:", error);
      res.status(500).json({ message: "Failed to update timezone" });
    }
  });

  // Update company info (admin only) - name, address and UEN for payslips
  app.put("/api/company/info", requireAdmin, requireWriteAccess, async (req: Request, res: Response) => {
    try {
      const schema = z.object({
        companyName: z.string().optional(),
        companyAddress: z.string().optional(),
        companyUen: z.string().optional(),
      });

      const data = schema.parse(req.body);
      const updated = await storage.updateCompanySettings(data);
      res.json({ success: true, settings: updated });
    } catch (error) {
      console.error("Update company info error:", error);
      res.status(500).json({ message: "Failed to update company information" });
    }
  });

  // ==================== PAYROLL IMPORT API ====================

  // Import payroll records (admin only)
  app.post("/api/admin/payroll/import", requireAdmin, requireWriteAccess, requireFullAdmin, async (req: Request, res: Response) => {
    try {
      const schema = z.object({
        records: z.array(z.object({
          userId: z.string().nullable().optional(),
          payPeriod: z.string(),
          payPeriodYear: z.number(),
          payPeriodMonth: z.number(),
          employeeCode: z.string(),
          employeeName: z.string(),
          deptCode: z.string().nullable().optional(),
          deptName: z.string().nullable().optional(),
          secCode: z.string().nullable().optional(),
          secName: z.string().nullable().optional(),
          catCode: z.string().nullable().optional(),
          catName: z.string().nullable().optional(),
          nric: z.string().nullable().optional(),
          joinDate: z.string().nullable().optional(),
          totSalary: z.number(),
          basicSalary: z.number(),
          monthlyVariablesComponent: z.number(),
          flat: z.number(),
          ot10: z.number(),
          ot15: z.number(),
          ot20: z.number(),
          ot30: z.number(),
          shiftAllowance: z.number(),
          totRestPhAmount: z.number(),
          mobileAllowance: z.number(),
          transportAllowance: z.number(),
          annualLeaveEncashment: z.number(),
          serviceCallAllowances: z.number(),
          otherAllowance: z.number(),
          otherAllowance1: z.number().default(0),
          otherAllowance2: z.number().default(0),
          houseRentalAllowances: z.number(),
          loanRepaymentTotal: z.number(),
          loanRepaymentDetails: z.string().nullable().optional(),
          noPayDay: z.number(),
          cc: z.number(),
          cdac: z.number(),
          ecf: z.number(),
          mbmf: z.number(),
          sinda: z.number(),
          bonus: z.number(),
          grossWages: z.number(),
          cpfWages: z.number(),
          sdf: z.number(),
          fwl: z.number(),
          employerCpf: z.number(),
          employeeCpf: z.number(),
          totalCpf: z.number(),
          total: z.number(),
          nett: z.number(),
          payMode: z.string().nullable().optional(),
          chequeNo: z.string().nullable().optional(),
          importedBy: z.string().nullable().optional(),
        })),
      });

      const { records } = schema.parse(req.body);
      
      if (records.length === 0) {
        return res.status(400).json({ message: "No records to import" });
      }

      // Convert numeric fields to strings for PostgreSQL storage
      const recordsForStorage = records.map(r => ({
        ...r,
        totSalary: toNumericString(r.totSalary),
        basicSalary: toNumericString(r.basicSalary),
        monthlyVariablesComponent: toNumericString(r.monthlyVariablesComponent),
        flat: toNumericString(r.flat),
        ot10: toNumericString(r.ot10),
        ot15: toNumericString(r.ot15),
        ot20: toNumericString(r.ot20),
        ot30: toNumericString(r.ot30),
        shiftAllowance: toNumericString(r.shiftAllowance),
        totRestPhAmount: toNumericString(r.totRestPhAmount),
        mobileAllowance: toNumericString(r.mobileAllowance),
        transportAllowance: toNumericString(r.transportAllowance),
        annualLeaveEncashment: toNumericString(r.annualLeaveEncashment),
        serviceCallAllowances: toNumericString(r.serviceCallAllowances),
        otherAllowance: toNumericString(r.otherAllowance),
        otherAllowance1: toNumericString(r.otherAllowance1 ?? 0),
        otherAllowance2: toNumericString(r.otherAllowance2 ?? 0),
        houseRentalAllowances: toNumericString(r.houseRentalAllowances),
        loanRepaymentTotal: toNumericString(r.loanRepaymentTotal),
        noPayDay: toNumericString(r.noPayDay),
        cc: toNumericString(r.cc),
        cdac: toNumericString(r.cdac),
        ecf: toNumericString(r.ecf),
        mbmf: toNumericString(r.mbmf),
        sinda: toNumericString(r.sinda),
        bonus: toNumericString(r.bonus),
        grossWages: toNumericString(r.grossWages),
        cpfWages: toNumericString(r.cpfWages),
        sdf: toNumericString(r.sdf),
        fwl: toNumericString(r.fwl),
        employerCpf: toNumericString(r.employerCpf),
        employeeCpf: toNumericString(r.employeeCpf),
        totalCpf: toNumericString(r.totalCpf),
        total: toNumericString(r.total),
        nett: toNumericString(r.nett),
      }));

      // Bulk create payroll records
      const created = await storage.bulkCreatePayrollRecords(recordsForStorage);
      
      res.json({
        success: true,
        message: `Successfully imported ${created.length} payroll records`,
        count: created.length,
      });
    } catch (error) {
      console.error("Payroll import error:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid payroll data", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to import payroll records" });
    }
  });

  // Generate payroll from attendance data (admin only)
  app.post("/api/admin/payroll/generate", requireAdmin, requireWriteAccess, requireFullAdmin, async (req: Request, res: Response) => {
    try {
      const { generatePayrollForPeriod } = await import("./payrollService");

      const schema = z.object({
        year: z.number().min(2020).max(2100),
        month: z.number().min(1).max(12),
        employeeIds: z.array(z.string()).optional(),
        suppressAllOT: z.boolean().optional(),
      });

      const { year, month, suppressAllOT } = schema.parse(req.body);
      const employeeIds = req.body.employeeIds as string[] | undefined;

      // Fast path: check for existing records before running generation
      const payPeriod = `${new Date(year, month - 1).toLocaleString('default', { month: 'short' }).toUpperCase()} ${year}`;
      const existingRecords = await storage.getPayrollRecords(year, month);
      if (existingRecords.length > 0) {
        return res.status(400).json({
          message: `Payroll records already exist for ${payPeriod}. Please delete existing records first or view them in the reports.`,
          existingCount: existingRecords.length,
        });
      }

      const result = await generatePayrollForPeriod(year, month, {
        suppressAllOT,
        employeeIds,
        importedBy: (req.session as any)?.user?.id || 'system',
      });

      res.json({
        success: true,
        message: `Generated payroll for ${result.generated} employees`,
        ...result,
      });
    } catch (error) {
      console.error("Generate payroll error:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid request data", errors: error.errors });
      }
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      res.status(500).json({ message: `Failed to generate payroll: ${errorMessage}` });
    }
  });

  // Preview payroll generation (shows what would be generated without saving)
  app.post("/api/admin/payroll/generate/preview", requireAdmin, requireFullAdmin, async (req: Request, res: Response) => {
    try {
      const { calculateCPF, calculateAge, calculateSPRYears, splitHours, calculatePayFromHours, monthlyToHourlyRate, dailyToHourlyRate } = await import("./cpf-calculator");
      
      const schema = z.object({
        year: z.number().min(2020).max(2100),
        month: z.number().min(1).max(12),
        employeeIds: z.array(z.string()).optional(),
        suppressAllOT: z.boolean().optional(),
      });

      const { year, month, suppressAllOT } = schema.parse(req.body);
      const employeeIds = req.body.employeeIds as string[] | undefined;
      
      // Get all approved employees
      const allUsers = await storage.getAllUsers();
      const employees = allUsers.filter(u => {
        if (u.isArchived) return false;
        if (!u.isApproved) return false;
        if (employeeIds && !employeeIds.includes(u.id)) return false;
        
        if (u.role === 'admin' || u.role === 'viewonly_admin') {
          const hasPayrollSettings = 
            (u.basicMonthlySalary && parseFloat(u.basicMonthlySalary) > 0) ||
            (u.hourlyRate && parseFloat(u.hourlyRate) > 0) ||
            (u.dailyRate && parseFloat(u.dailyRate) > 0);
          return hasPayrollSettings;
        }
        
        return true;
      });

      const settings = await storage.getCompanySettings();
      const regularHoursPerDay = settings?.regularHoursPerDay || 8;
      const regularDaysPerWeek = settings?.regularDaysPerWeek || 5;

      const periodStart = `${year}-${String(month).padStart(2, '0')}-01`;
      const lastDay = new Date(year, month, 0).getDate();
      const periodEnd = `${year}-${String(month).padStart(2, '0')}-${lastDay}`;
      const payPeriod = `${new Date(year, month - 1).toLocaleString('default', { month: 'short' }).toUpperCase()} ${year}`;

      const attendanceData = await storage.getAllUsersAttendanceByDateRange(periodStart, periodEnd);
      
      // Get attendance adjustments for the period (leave/OT overrides)
      const adjustmentsData = await storage.getAttendanceAdjustmentsByDateRange(periodStart, periodEnd);
      
      // Build a map of adjustments by `${userId}-${date}` for quick lookup
      const adjustmentsMap = new Map<string, typeof adjustmentsData[0]>();
      for (const adj of adjustmentsData) {
        adjustmentsMap.set(`${adj.userId}-${adj.date}`, adj);
      }
      
      // Get payroll adjustments for the period (including suppress_ot15 and suppress_ot20)
      const payrollAdjustmentsData = await storage.getPayrollAdjustmentsByPeriod(year, month);
      
      // Build sets of employee IDs that have suppress_ot15 and suppress_ot20 adjustments
      const suppressOt15Employees = new Set<string>();
      const suppressOt20Employees = new Set<string>();
      for (const adj of payrollAdjustmentsData) {
        if (adj.adjustmentType === 'suppress_ot15' && adj.status === 'approved') {
          suppressOt15Employees.add(adj.userId);
        }
        if (adj.adjustmentType === 'suppress_ot20' && adj.status === 'approved') {
          suppressOt20Employees.add(adj.userId);
        }
      }

      // Fetch all active salary adjustments for employees
      const allSalaryAdjustments = await Promise.all(
        employees.map(emp => storage.getEmployeeSalaryAdjustments(emp.id))
      );
      const salaryAdjustmentsMap = new Map<string, typeof allSalaryAdjustments[0]>();
      employees.forEach((emp, idx) => {
        salaryAdjustmentsMap.set(emp.id, allSalaryAdjustments[idx].filter(adj => adj.isActive));
      });

      const preview: {
        employeeCode: string;
        employeeName: string;
        department: string;
        totalHoursWorked: number;
        regularHours: number;
        overtimeHours: number;
        daysWorked: number;
        payType: string;
        hourlyRate: number;
        basicPay: number;
        ot15Pay?: number;
        ot20Pay?: number;
        overtimePay: number;
        mobileAllowance: number;
        transportAllowance: number;
        mealAllowance: number;
        shiftAllowance: number;
        otherAllowance: number;
        otherAllowance1: number;
        otherAllowance2: number;
        houseRentalAllowance: number;
        loanDeduction: number;
        advance?: number;
        annualLeaveEncashment?: number;
        salaryAdjustments: number;
        grossWages: number;
        employeeCPF: number;
        employerCPF: number;
        netPay: number;
        salaryBeforeOT?: number;
        finalSal?: number;
        residencyStatus: string;
        cpfEligible: boolean;
        shgFund?: string;
        shgAmount?: number;
        sinda?: number;
        cdac?: number;
        mbmf?: number;
        ecf?: number;
      }[] = [];

      const skipped: { id: string; employeeCode: string; employeeName: string; reason: string }[] = [];

      for (const employee of employees) {
        const empAttendance = attendanceData.filter(a => a.userId === employee.id);

        // Calculate total hours worked from attendance, respecting adjustments
        let totalHoursWorked = 0;
        let totalOtHoursFromAdjustments = 0;
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
              
              if (adjustment.adjustmentType === 'leave') {
                totalHoursWorked += 9;
              } else if (adjustment.adjustmentType === 'hours') {
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
          
          if (adj.adjustmentType === 'leave') {
            totalHoursWorked += 9;
          } else if (adj.adjustmentType === 'hours') {
            const adjRegular = adj.regularHours ?? 0;
            const adjOt = adj.otHours ?? 0;
            totalHoursWorked += adjRegular;
            totalOtHoursFromAdjustments += adjOt;
          }
        }
        
        const daysWorked = uniqueDays.size;

        // Use parseNumericOrNull to properly distinguish between "not set" (null) and "set to 0"
        const empHourlyRateRaw = parseNumericOrNull(employee.hourlyRate);
        const empMonthlySalaryRaw = parseNumericOrNull(employee.basicMonthlySalary);
        const empDailyRateRaw = parseNumericOrNull(employee.dailyRate);
        
        let hourlyRate = empHourlyRateRaw ?? 0;
        let payType = employee.payType || 'hourly';
        
        // Auto-detect pay type based on what's configured
        // Priority: monthly salary > daily rate > hourly rate
        // Only override if the value exists and is positive
        if (empMonthlySalaryRaw !== null && empMonthlySalaryRaw > 0) {
          payType = 'monthly';
          hourlyRate = monthlyToHourlyRate(empMonthlySalaryRaw, regularHoursPerDay, employee.regularDaysPerWeek || regularDaysPerWeek);
        } else if (empDailyRateRaw !== null && empDailyRateRaw > 0) {
          payType = 'daily';
          hourlyRate = dailyToHourlyRate(empDailyRateRaw, regularHoursPerDay);
        }

        if (!hourlyRate || hourlyRate === 0) {
          skipped.push({
            id: employee.id,
            employeeCode: employee.employeeCode || 'N/A',
            employeeName: employee.name,
            reason: 'No pay rate configured',
          });
          continue;
        }

        const { regularHours, overtimeHours: calculatedOtHours } = splitHours(totalHoursWorked, regularHoursPerDay, daysWorked);
        
        // Add explicit OT hours from adjustments to calculated OT
        const overtimeHours = calculatedOtHours + totalOtHoursFromAdjustments;
        
        const otMultiplier = settings?.otMultiplier15 || 1.5;
        
        // Calculate pay differently based on pay type
        let basicPay: number;
        let overtimePay: number;
        const configuredMonthlySalary = empMonthlySalaryRaw ?? 0;
        
        if (payType === 'monthly') {
          // MONTHLY EMPLOYEES: Get full monthly salary, OT calculated separately
          basicPay = configuredMonthlySalary;
          overtimePay = overtimeHours > 0 && hourlyRate > 0 
            ? roundToDollars(overtimeHours * hourlyRate * otMultiplier) 
            : 0;
        } else {
          // HOURLY/DAILY EMPLOYEES: Calculate pay based on hours worked
          const result = calculatePayFromHours(regularHours, overtimeHours, hourlyRate, otMultiplier);
          basicPay = result.regularPay;
          overtimePay = result.overtimePay;
        }
        
        // Check if OT should be suppressed for this employee (separate OT1.5 and OT2.0 suppression)
        // Global suppressAllOT flag or individual suppress_ot15/suppress_ot20 adjustments
        let finalOt15Pay = overtimePay; // Standard OT goes into 1.5x by default
        let finalOt20Pay = 0; // 2.0x OT (usually from adjustments or weekend work)
        let finalOvertimeHours = overtimeHours;
        
        const shouldSuppressOt15 = suppressAllOT || suppressOt15Employees.has(employee.id);
        const shouldSuppressOt20 = suppressAllOT || suppressOt20Employees.has(employee.id);
        
        if (shouldSuppressOt15) {
          finalOt15Pay = 0;
          // Only zero hours if both OT types are suppressed
          if (shouldSuppressOt20) {
            finalOvertimeHours = 0;
          }
        }
        if (shouldSuppressOt20) {
          finalOt20Pay = 0;
        }
        
        const finalOvertimePay = finalOt15Pay + finalOt20Pay;
        
        // Get default allowances from employee profile
        const mobileAllowance = parseFloat(employee.defaultMobileAllowance || '0');
        const transportAllowance = parseFloat(employee.defaultTransportAllowance || '0');
        const mealAllowance = parseFloat(employee.defaultMealAllowance || '0');
        const shiftAllowance = parseFloat(employee.defaultShiftAllowance || '0');
        const otherAllowance = parseFloat(employee.defaultOtherAllowance || '0');
        const otherAllowance1 = parseFloat((employee as any).defaultOtherAllowance1 || '0');
        const otherAllowance2 = parseFloat((employee as any).defaultOtherAllowance2 || '0');
        const houseRentalAllowance = parseFloat(employee.defaultHouseRentalAllowance || '0');
        const loanDeduction = 0; // Loan deductions come from payroll_loan_accounts, not employee settings
        const totalAllowances = mobileAllowance + transportAllowance + mealAllowance + shiftAllowance + otherAllowance + otherAllowance1 + otherAllowance2 + houseRentalAllowance;
        
        // Calculate salary adjustments (additions/deductions from employee settings)
        const employeeSalaryAdjustments = salaryAdjustmentsMap.get(employee.id) || [];
        let salaryAdjustmentsTotal = 0;
        for (const adj of employeeSalaryAdjustments) {
          const amount = parseFloat(String(adj.amount));
          if (isNaN(amount)) continue;
          if (adj.adjustmentType === 'addition') {
            salaryAdjustmentsTotal += amount;
          } else if (adj.adjustmentType === 'deduction') {
            salaryAdjustmentsTotal -= amount;
          }
        }
        
        const grossWages = basicPay + finalOvertimePay + totalAllowances + salaryAdjustmentsTotal;

        // Determine residency status for CPF - only process CPF for explicitly configured SC/SPR
        const residencyStatus = employee.residencyStatus as 'SC' | 'SPR' | 'FOREIGNER' | null;
        
        // Calculate CPF only for SC/SPR with explicit configuration
        let cpfResult: ReturnType<typeof calculateCPF>;
        
        if (residencyStatus === 'SC' || residencyStatus === 'SPR') {
          // Calculate age for CPF rates - MUST use END of wage month per CPF rules
          const wageMonth = `${year}-${String(month).padStart(2, '0')}`; // Format: "YYYY-MM"
          const wageMonthEndDate = new Date(year, month, 0); // Last day of wage month
          const age = employee.birthDate ? calculateAge(employee.birthDate, wageMonthEndDate) : 45; // Default to 45 if no birthdate
          
          // Calculate SPR years if applicable (also at end of wage month)
          let sprYears: number | undefined;
          if (residencyStatus === 'SPR' && employee.sprStartDate) {
            sprYears = calculateSPRYears(employee.sprStartDate, wageMonthEndDate);
          }

          // Calculate CPF contributions (pass wageMonth to select correct rate table)
          cpfResult = calculateCPF(grossWages, age, residencyStatus, sprYears, 0, wageMonth);
        } else {
          // Foreigner or no residency status - no CPF
          cpfResult = {
            grossWages,
            cpfWages: 0,
            employeeCPF: 0,
            employerCPF: 0,
            totalCPF: 0,
            netPay: grossWages,
            isEligible: false,
            reason: residencyStatus === 'FOREIGNER' ? 'Foreigners are not eligible for CPF' : 'Residency status not configured',
          };
        }

        // Calculate SHG for preview
        const { calculateSHG } = await import("./shg-calculator");
        const previewShg = calculateSHG(
          employee.ethnicity,
          employee.religion,
          residencyStatus,
          grossWages,
          employee.shgOptOut || false,
        );
        const previewShgTotal = previewShg.contribution;

        const previewNetPay = cpfResult.netPay - loanDeduction - previewShgTotal;

        const previewSalaryBeforeOT = previewNetPay - finalOvertimePay;
        const previewFinalSal = previewNetPay;

        preview.push({
          employeeCode: employee.employeeCode || 'N/A',
          employeeName: employee.name,
          department: employee.department || '',
          totalHoursWorked,
          regularHours,
          overtimeHours: finalOvertimeHours,
          daysWorked,
          payType,
          hourlyRate,
          basicPay,
          ot15Pay: finalOt15Pay,
          ot20Pay: finalOt20Pay,
          overtimePay: finalOvertimePay,
          mobileAllowance,
          transportAllowance,
          mealAllowance,
          shiftAllowance,
          otherAllowance,
          otherAllowance1,
          otherAllowance2,
          houseRentalAllowance,
          loanDeduction,
          advance: 0,
          annualLeaveEncashment: 0,
          salaryAdjustments: salaryAdjustmentsTotal,
          grossWages,
          employeeCPF: cpfResult.employeeCPF,
          employerCPF: cpfResult.employerCPF,
          netPay: previewNetPay,
          salaryBeforeOT: previewSalaryBeforeOT,
          finalSal: previewFinalSal,
          residencyStatus: residencyStatus || 'NOT_SET',
          cpfEligible: cpfResult.isEligible,
          shgFund: previewShg.fund ?? undefined,
          shgAmount: previewShg.contribution,
          sinda: previewShg.fund === 'SINDA' ? previewShg.contribution : 0,
          cdac: previewShg.fund === 'CDAC' ? previewShg.contribution : 0,
          mbmf: previewShg.fund === 'MBMF' ? previewShg.contribution : 0,
          ecf: previewShg.fund === 'ECF' ? previewShg.contribution : 0,
        });
      }

      res.json({
        success: true,
        period: payPeriod,
        periodStart,
        periodEnd,
        preview,
        skipped,
        totalEmployees: employees.length,
        eligibleCount: preview.length,
        skippedCount: skipped.length,
      });
    } catch (error) {
      console.error("Preview payroll error:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid request data", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to preview payroll" });
    }
  });

  // Get most recent payroll period that has records (admin only)
  app.get("/api/admin/payroll/latest-period", requireAdmin, requireFullAdmin, async (req: Request, res: Response) => {
    try {
      const result = await pool.query(
        `SELECT pay_period_year, pay_period_month
         FROM app_nexahrsoft2.payroll_records
         ORDER BY pay_period_year DESC, pay_period_month DESC
         LIMIT 1`
      );
      const row = result.rows[0];
      if (!row) return res.json({ year: null, month: null });
      res.json({ year: row.pay_period_year, month: row.pay_period_month });
    } catch (error) {
      console.error("Get latest payroll period error:", error);
      res.status(500).json({ message: "Failed to fetch latest period" });
    }
  });

  // Get payroll records with optional year/month filter (admin only)
  app.get("/api/admin/payroll/records", requireAdmin, requireFullAdmin, async (req: Request, res: Response) => {
    try {
      const year = req.query.year ? parseInt(req.query.year as string) : undefined;
      const month = req.query.month ? parseInt(req.query.month as string) : undefined;
      
      const records = await storage.getPayrollRecords(year, month);
      res.json({ records });
    } catch (error) {
      console.error("Get payroll records error:", error);
      res.status(500).json({ message: "Failed to fetch payroll records" });
    }
  });

  // Get payroll-leave summary (annual leave encashment and no-pay day deductions linked with leave balances)
  app.get("/api/admin/payroll/leave-summary", requireAdmin, requireFullAdmin, async (req: Request, res: Response) => {
    try {
      const year = req.query.year ? parseInt(req.query.year as string) : new Date().getFullYear();
      const records = await storage.getPayrollRecords(year);
      const allLeaveBalances = await storage.getAllLeaveBalances(year);
      const allLeaveApplications = await storage.getAllLeaveApplications();
      
      const summary = records.reduce((acc, record) => {
        const key = record.employeeCode;
        if (!acc[key]) {
          acc[key] = {
            employeeCode: record.employeeCode,
            employeeName: record.employeeName,
            userId: record.userId,
            totalLeaveEncashment: 0,
            totalNoPayDeduction: 0,
            monthsWithData: [] as { month: number; year: number; leaveEncashment: number; noPayDeduction: number }[],
            leaveBalances: [] as { leaveType: string; eligible: string; taken: string; balance: string }[],
            unpaidLeaveApplications: [] as { startDate: string; endDate: string; totalDays: string; status: string }[],
          };
        }
        const leaveEncashmentNum = parseFloat(record.annualLeaveEncashment) || 0;
        const noPayDayNum = parseFloat(record.noPayDay) || 0;
        acc[key].totalLeaveEncashment += leaveEncashmentNum;
        acc[key].totalNoPayDeduction += noPayDayNum;
        if (leaveEncashmentNum > 0 || noPayDayNum > 0) {
          acc[key].monthsWithData.push({
            month: record.payPeriodMonth,
            year: record.payPeriodYear,
            leaveEncashment: leaveEncashmentNum,
            noPayDeduction: noPayDayNum,
          });
        }
        return acc;
      }, {} as Record<string, { 
        employeeCode: string; 
        employeeName: string; 
        userId: string | null;
        totalLeaveEncashment: number; 
        totalNoPayDeduction: number;
        monthsWithData: { month: number; year: number; leaveEncashment: number; noPayDeduction: number }[];
        leaveBalances: { leaveType: string; eligible: string; taken: string; balance: string }[];
        unpaidLeaveApplications: { startDate: string; endDate: string; totalDays: string; status: string }[];
      }>);
      
      // Enrich with leave balance data
      for (const key of Object.keys(summary)) {
        const emp = summary[key];
        if (emp.userId) {
          const balances = allLeaveBalances.filter(b => b.userId === emp.userId && b.year === year);
          emp.leaveBalances = balances.map(b => ({
            leaveType: b.leaveType,
            eligible: b.eligible,
            taken: b.taken,
            balance: b.balance,
          }));
          
          // Get unpaid leave applications for this year
          const unpaidApps = allLeaveApplications.filter(a => 
            a.userId === emp.userId && 
            a.leaveType === 'UL' &&
            a.startDate.startsWith(String(year))
          );
          emp.unpaidLeaveApplications = unpaidApps.map(a => ({
            startDate: a.startDate,
            endDate: a.endDate,
            totalDays: a.totalDays,
            status: a.status,
          }));
        }
      }
      
      const employeeSummaries = Object.values(summary).filter(
        s => s.totalLeaveEncashment > 0 || s.totalNoPayDeduction > 0
      );
      
      res.json({
        year,
        totalLeaveEncashment: records.reduce((sum, r) => sum + (parseFloat(r.annualLeaveEncashment) || 0), 0),
        totalNoPayDeduction: records.reduce((sum, r) => sum + (parseFloat(r.noPayDay) || 0), 0),
        employees: employeeSummaries,
      });
    } catch (error) {
      console.error("Get payroll leave summary error:", error);
      res.status(500).json({ message: "Failed to fetch payroll leave summary" });
    }
  });

  // Delete payroll records for a specific period (admin only)
  app.delete("/api/admin/payroll/records/:year/:month", requireAdmin, requireWriteAccess, requireFullAdmin, async (req: Request, res: Response) => {
    try {
      const year = parseInt(req.params.year);
      const month = parseInt(req.params.month);
      
      if (isNaN(year) || isNaN(month) || month < 1 || month > 12) {
        return res.status(400).json({ message: "Invalid year or month" });
      }
      
      await storage.deletePayrollRecordsByPeriod(year, month);
      res.json({ 
        success: true, 
        message: `Deleted payroll records for ${month}/${year}` 
      });
    } catch (error) {
      console.error("Delete payroll records error:", error);
      res.status(500).json({ message: "Failed to delete payroll records" });
    }
  });

  // Get a specific payroll record with its audit history
  app.get("/api/admin/payroll/records/:id", requireAdmin, requireFullAdmin, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const record = await storage.getPayrollRecordById(id);
      if (!record) {
        return res.status(404).json({ message: "Payroll record not found" });
      }
      const auditLogs = await storage.getPayrollAuditLogsByRecord(id);
      res.json({ record, auditLogs });
    } catch (error) {
      console.error("Get payroll record error:", error);
      res.status(500).json({ message: "Failed to fetch payroll record" });
    }
  });

  // Update a payroll record with audit logging
  app.patch("/api/admin/payroll/records/:id", requireAdmin, requireWriteAccess, requireFullAdmin, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const adminUsername = (req.session as any)?.adminUsername || "admin";
      const recalculateCpf = req.body.recalculateCpf === true;
      
      const existingRecord = await storage.getPayrollRecordById(id);
      if (!existingRecord) {
        return res.status(404).json({ message: "Payroll record not found" });
      }
      
      const editableFields = [
        'basicSalary', 'monthlyVariablesComponent', 'flat', 'ot10', 'ot15', 'ot20', 'ot30',
        'shiftAllowance', 'mobileAllowance', 'transportAllowance', 'serviceCallAllowances',
        'otherAllowance', 'houseRentalAllowances', 'annualLeaveEncashment', 'totRestPhAmount',
        'bonus', 'sdf', 'fwl', 'cc', 'cdac', 'ecf', 'mbmf', 'sinda', 'noPayDay', 'advance',
        'loanRepaymentTotal', 'employerCpf', 'employeeCpf'
      ];
      
      const updates: Record<string, any> = {};
      const reason = req.body.reason || null;
      
      for (const field of editableFields) {
        if (req.body[field] !== undefined) {
          const newValue = parseInt(req.body[field]);
          if (!isNaN(newValue)) {
            const oldValue = (existingRecord as any)[field] || 0;
            if (newValue !== oldValue) {
              updates[field] = newValue;
              await storage.createPayrollAuditLog({
                payrollRecordId: id,
                fieldName: field,
                oldValue: String(oldValue),
                newValue: String(newValue),
                changedBy: adminUsername,
                reason: reason,
              });
            }
          }
        }
      }
      
      if (Object.keys(updates).length === 0 && !recalculateCpf) {
        return res.json({ record: existingRecord, message: "No changes made" });
      }
      
      const recalculate = async (record: any, shouldRecalculateCpf: boolean) => {
        // Parse all numeric fields (database returns strings for numeric type)
        const basicSalary = parseNumeric(record.basicSalary);
        const monthlyVariablesComponent = parseNumeric(record.monthlyVariablesComponent);
        const flat = parseNumeric(record.flat);
        const ot10 = parseNumeric(record.ot10);
        const ot15 = parseNumeric(record.ot15);
        const ot20 = parseNumeric(record.ot20);
        const ot30 = parseNumeric(record.ot30);
        const shiftAllowance = parseNumeric(record.shiftAllowance);
        const totRestPhAmount = parseNumeric(record.totRestPhAmount);
        const mobileAllowance = parseNumeric(record.mobileAllowance);
        const transportAllowance = parseNumeric(record.transportAllowance);
        const annualLeaveEncashment = parseNumeric(record.annualLeaveEncashment);
        const serviceCallAllowances = parseNumeric(record.serviceCallAllowances);
        const otherAllowance = parseNumeric(record.otherAllowance);
        const otherAllowance1 = parseNumeric((record as any).otherAllowance1);
        const otherAllowance2 = parseNumeric((record as any).otherAllowance2);
        const houseRentalAllowances = parseNumeric(record.houseRentalAllowances);
        const bonus = parseNumeric(record.bonus);
        let employerCpf = parseNumeric(record.employerCpf);
        let employeeCpf = parseNumeric(record.employeeCpf);
        const cc = parseNumeric(record.cc);
        const cdac = parseNumeric(record.cdac);
        const ecf = parseNumeric(record.ecf);
        const mbmf = parseNumeric(record.mbmf);
        const sinda = parseNumeric(record.sinda);
        const loanRepaymentTotal = parseNumeric(record.loanRepaymentTotal);
        const noPayDay = parseNumeric(record.noPayDay);
        const advance = parseNumeric(record.advance);
        
        // Apply consistent 2-decimal rounding to all calculated totals
        const totSalary = roundToDollars(basicSalary + monthlyVariablesComponent);
        const overtimeTotal = roundToDollars(flat + ot10 + ot15 + ot20 + ot30 + shiftAllowance + totRestPhAmount);
        const allowancesWithCpf = roundToDollars(mobileAllowance + transportAllowance + annualLeaveEncashment + serviceCallAllowances);
        const allowancesWithoutCpf = roundToDollars(otherAllowance + otherAllowance1 + otherAllowance2 + houseRentalAllowances);
        const grossWages = roundToDollars(totSalary + overtimeTotal + allowancesWithCpf + allowancesWithoutCpf + bonus);
        const cpfWages = roundToDollars(totSalary + overtimeTotal + allowancesWithCpf + bonus);

        // Recalculate CPF contributions if requested
        let cpfRecalculated = false;
        if (shouldRecalculateCpf) {
          const { calculateCPF, calculateAge, calculateSPRYears } = await import("./cpf-calculator");
          
          // Find the employee by their userId or employeeCode
          let employee = null;
          if (record.userId) {
            employee = await storage.getUser(record.userId);
          }
          if (!employee && record.employeeCode) {
            employee = await storage.getUserByEmployeeCode(record.employeeCode);
          }
          
          if (employee) {
            const residencyStatus = employee.residencyStatus as 'SC' | 'SPR' | 'FOREIGNER' | null;
            
            if (residencyStatus === 'SC' || residencyStatus === 'SPR') {
              // Use the numeric payPeriodYear and payPeriodMonth fields directly (more reliable than parsing string)
              const periodMonth = record.payPeriodMonth ?? (new Date().getMonth() + 1);
              const periodYear = record.payPeriodYear ?? new Date().getFullYear();
              
              // Format wage month for rate table selection
              const wageMonth = `${periodYear}-${String(periodMonth).padStart(2, '0')}`; // Format: "YYYY-MM"
              // Calculate age at END of wage month per CPF rules
              const wageMonthEndDate = new Date(periodYear, periodMonth, 0); // Last day of wage month
              
              console.log(`CPF recalc for ${record.employeeName}: payPeriodMonth=${periodMonth}, payPeriodYear=${periodYear}, wageMonth=${wageMonth}`);
              
              const age = employee.birthDate ? calculateAge(employee.birthDate, wageMonthEndDate) : 45;
              
              let sprYears: number | undefined;
              if (residencyStatus === 'SPR' && employee.sprStartDate) {
                sprYears = calculateSPRYears(employee.sprStartDate, wageMonthEndDate);
              }
              
              // Pass wageMonth to select correct rate table (2025 vs 2026)
              const cpfResult = calculateCPF(cpfWages, age, residencyStatus, sprYears, 0, wageMonth);
              
              // Store employee CPF as negative (deduction from salary)
              employerCpf = cpfResult.employerCPF;
              employeeCpf = -Math.abs(cpfResult.employeeCPF);
              cpfRecalculated = true;
              
              console.log(`Recalculated CPF for ${record.employeeName}: CPF wages $${cpfWages.toFixed(2)}, age ${age}, employer $${employerCpf.toFixed(2)}, employee $${Math.abs(employeeCpf).toFixed(2)}`);
            }
          }
        }
        
        // Note: employeeCpf is stored as negative, use Math.abs for total
        const totalCpf = roundToDollars(employerCpf + Math.abs(employeeCpf));
        const communityDeductions = roundToDollars(cc + cdac + ecf + mbmf + sinda);
        const totalDeductions = roundToDollars(loanRepaymentTotal + noPayDay + advance + communityDeductions + Math.abs(employeeCpf));
        const nett = roundToDollars(grossWages - totalDeductions);
        
        const result: Record<string, any> = { 
          totSalary: toNumericString(totSalary), 
          grossWages: toNumericString(grossWages), 
          cpfWages: toNumericString(cpfWages), 
          totalCpf: toNumericString(totalCpf), 
          total: toNumericString(grossWages), 
          nett: toNumericString(nett) 
        };
        
        // Include recalculated CPF values if they were updated
        if (cpfRecalculated) {
          result.employerCpf = toNumericString(employerCpf);
          result.employeeCpf = toNumericString(employeeCpf);
        }
        
        return result;
      };
      
      const mergedRecord = { ...existingRecord, ...updates };
      const recalculated = await recalculate(mergedRecord, recalculateCpf);
      
      // If CPF was recalculated, add audit logs for the CPF changes
      if (recalculateCpf && recalculated.employerCpf !== undefined) {
        const oldEmployerCpf = parseNumeric(existingRecord.employerCpf);
        const newEmployerCpf = parseNumeric(recalculated.employerCpf);
        const oldEmployeeCpf = parseNumeric(existingRecord.employeeCpf);
        const newEmployeeCpf = parseNumeric(recalculated.employeeCpf);
        
        if (oldEmployerCpf !== newEmployerCpf) {
          await storage.createPayrollAuditLog({
            payrollRecordId: id,
            fieldName: 'employerCpf',
            oldValue: String(oldEmployerCpf),
            newValue: String(newEmployerCpf),
            changedBy: adminUsername,
            reason: reason || 'CPF auto-recalculated after allowance change',
          });
        }
        if (oldEmployeeCpf !== newEmployeeCpf) {
          await storage.createPayrollAuditLog({
            payrollRecordId: id,
            fieldName: 'employeeCpf',
            oldValue: String(oldEmployeeCpf),
            newValue: String(newEmployeeCpf),
            changedBy: adminUsername,
            reason: reason || 'CPF auto-recalculated after allowance change',
          });
        }
      }
      
      const finalUpdates = { ...updates, ...recalculated };
      
      // Track CPF override status
      // If CPF was manually changed (not recalculated), mark as overridden
      const cpfManuallyChanged = (updates.employerCpf !== undefined || updates.employeeCpf !== undefined) && !recalculateCpf;
      // If CPF was recalculated by the system, clear the override flag
      const cpfWasRecalculated = recalculateCpf && recalculated.employerCpf !== undefined;
      
      if (cpfManuallyChanged) {
        finalUpdates.cpfOverridden = true;
        // Audit log for the override flag change
        if (!existingRecord.cpfOverridden) {
          await storage.createPayrollAuditLog({
            payrollRecordId: id,
            fieldName: 'cpfOverridden',
            oldValue: 'false',
            newValue: 'true',
            changedBy: adminUsername,
            reason: reason || 'CPF manually overridden by admin',
          });
        }
      } else if (cpfWasRecalculated) {
        // When CPF is recalculated, clear override flag and update original values
        finalUpdates.cpfOverridden = false;
        finalUpdates.originalEmployerCpf = recalculated.employerCpf;
        finalUpdates.originalEmployeeCpf = recalculated.employeeCpf;
      }
      
      const updated = await storage.updatePayrollRecord(id, finalUpdates);
      const cpfSkippedReason = recalculateCpf && !cpfWasRecalculated 
        ? "CPF recalculation skipped - employee residency status not set to SC or SPR"
        : undefined;
      
      res.json({ 
        record: updated, 
        message: cpfWasRecalculated 
          ? "Record updated and CPF recalculated" 
          : cpfSkippedReason 
            ? `Record updated. ${cpfSkippedReason}`
            : "Record updated successfully",
        cpfRecalculated: cpfWasRecalculated,
        cpfSkippedReason
      });
    } catch (error) {
      console.error("Update payroll record error:", error);
      res.status(500).json({ message: "Failed to update payroll record" });
    }
  });

  // Revert CPF to original calculated values
  app.post("/api/admin/payroll/records/:id/revert-cpf", requireAdmin, requireWriteAccess, requireFullAdmin, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const adminUsername = (req.session as any)?.adminUsername || "admin";
      const reason = req.body.reason || "Reverted CPF to original calculated values";
      
      const existingRecord = await storage.getPayrollRecordById(id);
      if (!existingRecord) {
        return res.status(404).json({ message: "Payroll record not found" });
      }
      
      // Check if original CPF values are available
      if (existingRecord.originalEmployerCpf === null || existingRecord.originalEmployeeCpf === null) {
        return res.status(400).json({ 
          message: "Original calculated CPF values not available for this record. This may be an older payslip generated before the feature was added." 
        });
      }
      
      const oldEmployerCpf = parseNumeric(existingRecord.employerCpf);
      const oldEmployeeCpf = parseNumeric(existingRecord.employeeCpf);
      const originalEmployerCpf = parseNumeric(existingRecord.originalEmployerCpf);
      const originalEmployeeCpf = parseNumeric(existingRecord.originalEmployeeCpf);
      
      // Check if already at original values
      if (oldEmployerCpf === originalEmployerCpf && oldEmployeeCpf === originalEmployeeCpf) {
        return res.json({ 
          record: existingRecord, 
          message: "CPF values already match the original calculated amounts" 
        });
      }
      
      // Create audit logs for the revert
      if (oldEmployerCpf !== originalEmployerCpf) {
        await storage.createPayrollAuditLog({
          payrollRecordId: id,
          fieldName: 'employerCpf',
          oldValue: String(oldEmployerCpf),
          newValue: String(originalEmployerCpf),
          changedBy: adminUsername,
          reason: reason,
        });
      }
      if (oldEmployeeCpf !== originalEmployeeCpf) {
        await storage.createPayrollAuditLog({
          payrollRecordId: id,
          fieldName: 'employeeCpf',
          oldValue: String(oldEmployeeCpf),
          newValue: String(originalEmployeeCpf),
          changedBy: adminUsername,
          reason: reason,
        });
      }
      
      // Calculate new totals
      const totalCpf = roundToDollars(originalEmployerCpf + Math.abs(originalEmployeeCpf));
      const grossWages = parseNumeric(existingRecord.grossWages);
      const cc = parseNumeric(existingRecord.cc);
      const cdac = parseNumeric(existingRecord.cdac);
      const ecf = parseNumeric(existingRecord.ecf);
      const mbmf = parseNumeric(existingRecord.mbmf);
      const sinda = parseNumeric(existingRecord.sinda);
      const loanRepaymentTotal = parseNumeric(existingRecord.loanRepaymentTotal);
      const noPayDay = parseNumeric(existingRecord.noPayDay);
      const advance = parseNumeric(existingRecord.advance);
      const communityDeductions = roundToDollars(cc + cdac + ecf + mbmf + sinda);
      const totalDeductions = roundToDollars(loanRepaymentTotal + noPayDay + advance + communityDeductions + Math.abs(originalEmployeeCpf));
      const nett = roundToDollars(grossWages - totalDeductions);
      
      // Update the record
      const updates = {
        employerCpf: toNumericString(originalEmployerCpf),
        employeeCpf: toNumericString(originalEmployeeCpf),
        totalCpf: toNumericString(totalCpf),
        nett: toNumericString(nett),
        cpfOverridden: false,
      };
      
      await storage.createPayrollAuditLog({
        payrollRecordId: id,
        fieldName: 'cpfOverridden',
        oldValue: 'true',
        newValue: 'false',
        changedBy: adminUsername,
        reason: reason,
      });
      
      const updated = await storage.updatePayrollRecord(id, updates);
      
      res.json({ 
        record: updated, 
        message: "CPF reverted to original calculated values",
        reverted: {
          employerCpf: originalEmployerCpf,
          employeeCpf: originalEmployeeCpf
        }
      });
    } catch (error) {
      console.error("Revert CPF error:", error);
      res.status(500).json({ message: "Failed to revert CPF values" });
    }
  });

  // Refresh payroll record from employee settings (pulls latest allowances)
  app.post("/api/admin/payroll/records/:id/refresh-from-settings", requireAdmin, requireWriteAccess, requireFullAdmin, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const adminUsername = (req.session as any)?.adminUsername || "admin";
      const reason = req.body.reason || "Refreshed allowances from employee settings";
      
      const existingRecord = await storage.getPayrollRecordById(id);
      if (!existingRecord) {
        return res.status(404).json({ message: "Payroll record not found" });
      }
      
      // Find the employee from the record
      let employee = null;
      if (existingRecord.userId) {
        employee = await storage.getUser(existingRecord.userId);
      }
      if (!employee && existingRecord.employeeCode) {
        employee = await storage.getUserByEmployeeCode(existingRecord.employeeCode);
      }
      
      if (!employee) {
        return res.status(404).json({ message: "Employee not found for this payroll record" });
      }
      
      // Map employee default allowances to payslip fields
      const allowanceMapping: Record<string, { from: string; to: string }> = {
        defaultMobileAllowance: { from: 'defaultMobileAllowance', to: 'mobileAllowance' },
        defaultTransportAllowance: { from: 'defaultTransportAllowance', to: 'transportAllowance' },
        defaultMealAllowance: { from: 'defaultMealAllowance', to: 'mealAllowance' },
        defaultShiftAllowance: { from: 'defaultShiftAllowance', to: 'shiftAllowance' },
        defaultOtherAllowance: { from: 'defaultOtherAllowance', to: 'otherAllowance' },
        defaultOtherAllowance1: { from: 'defaultOtherAllowance1', to: 'otherAllowance1' },
        defaultOtherAllowance2: { from: 'defaultOtherAllowance2', to: 'otherAllowance2' },
        defaultHouseRentalAllowance: { from: 'defaultHouseRentalAllowance', to: 'houseRentalAllowances' },
      };

      const updates: Record<string, any> = {};
      const changes: { field: string; oldValue: number; newValue: number }[] = [];
      
      // Collect all changes first (don't create audit logs yet)
      for (const mapping of Object.values(allowanceMapping)) {
        const employeeValue = parseNumeric((employee as any)[mapping.from]);
        const currentValue = parseNumeric((existingRecord as any)[mapping.to]);
        
        if (employeeValue !== currentValue) {
          updates[mapping.to] = employeeValue;
          changes.push({
            field: mapping.to,
            oldValue: currentValue,
            newValue: employeeValue,
          });
        }
      }
      
      // Also check basic salary if it changed
      const employeeBasicSalary = parseNumeric(employee.basicMonthlySalary);
      const currentBasicSalary = parseNumeric(existingRecord.basicSalary);
      if (employeeBasicSalary !== currentBasicSalary && employeeBasicSalary > 0) {
        updates.basicSalary = employeeBasicSalary;
        changes.push({
          field: 'basicSalary',
          oldValue: currentBasicSalary,
          newValue: employeeBasicSalary,
        });
      }
      
      if (Object.keys(updates).length === 0) {
        return res.json({ 
          record: existingRecord, 
          message: "No changes needed - payslip already matches employee settings",
          changes: [] 
        });
      }
      
      // Recalculate totals after updating allowances
      const mergedRecord = { ...existingRecord, ...updates };
      
      // Parse all numeric fields for recalculation
      const basicSalary = parseNumeric(mergedRecord.basicSalary);
      const monthlyVariablesComponent = parseNumeric(mergedRecord.monthlyVariablesComponent);
      const flat = parseNumeric(mergedRecord.flat);
      const ot10 = parseNumeric(mergedRecord.ot10);
      const ot15 = parseNumeric(mergedRecord.ot15);
      const ot20 = parseNumeric(mergedRecord.ot20);
      const ot30 = parseNumeric(mergedRecord.ot30);
      const shiftAllowance = parseNumeric(mergedRecord.shiftAllowance);
      const totRestPhAmount = parseNumeric(mergedRecord.totRestPhAmount);
      const mobileAllowance = parseNumeric(mergedRecord.mobileAllowance);
      const transportAllowance = parseNumeric(mergedRecord.transportAllowance);
      const mealAllowance = parseNumeric((mergedRecord as any).mealAllowance);
      const annualLeaveEncashment = parseNumeric(mergedRecord.annualLeaveEncashment);
      const serviceCallAllowances = parseNumeric(mergedRecord.serviceCallAllowances);
      const otherAllowance = parseNumeric(mergedRecord.otherAllowance);
      const otherAllowance1 = parseNumeric((mergedRecord as any).otherAllowance1);
      const otherAllowance2 = parseNumeric((mergedRecord as any).otherAllowance2);
      const houseRentalAllowances = parseNumeric(mergedRecord.houseRentalAllowances);
      const bonus = parseNumeric(mergedRecord.bonus);
      const employerCpf = parseNumeric(mergedRecord.employerCpf);
      const employeeCpf = parseNumeric(mergedRecord.employeeCpf);
      const cc = parseNumeric(mergedRecord.cc);
      const cdac = parseNumeric(mergedRecord.cdac);
      const ecf = parseNumeric(mergedRecord.ecf);
      const mbmf = parseNumeric(mergedRecord.mbmf);
      const sinda = parseNumeric(mergedRecord.sinda);
      const loanRepaymentTotal = parseNumeric(mergedRecord.loanRepaymentTotal);
      const noPayDay = parseNumeric(mergedRecord.noPayDay);

      const totSalary = roundToDollars(basicSalary + monthlyVariablesComponent);
      const overtimeTotal = roundToDollars(flat + ot10 + ot15 + ot20 + ot30 + shiftAllowance + totRestPhAmount);
      const allowancesWithCpf = roundToDollars(mobileAllowance + transportAllowance + annualLeaveEncashment + serviceCallAllowances);
      const allowancesWithoutCpf = roundToDollars(otherAllowance + otherAllowance1 + otherAllowance2 + houseRentalAllowances);
      const grossWages = roundToDollars(totSalary + overtimeTotal + allowancesWithCpf + allowancesWithoutCpf + bonus);
      const cpfWages = roundToDollars(totSalary + overtimeTotal + allowancesWithCpf + bonus);
      // Note: employeeCpf is stored as negative, use Math.abs for totals (consistent with existing update logic)
      const totalCpf = roundToDollars(employerCpf + Math.abs(employeeCpf));
      const communityDeductions = roundToDollars(cc + cdac + ecf + mbmf + sinda);
      const effectiveLoanRepayment = roundToDollars(loanRepaymentTotal + mealAllowance);
      const totalDeductions = roundToDollars(effectiveLoanRepayment + noPayDay + communityDeductions + Math.abs(employeeCpf));
      const nett = roundToDollars(grossWages - totalDeductions);
      
      const recalculated = {
        totSalary: toNumericString(totSalary),
        overtimeTotal: toNumericString(overtimeTotal),
        allowancesWithCpf: toNumericString(allowancesWithCpf),
        allowancesWithoutCpf: toNumericString(allowancesWithoutCpf),
        grossWages: toNumericString(grossWages),
        cpfWages: toNumericString(cpfWages),
        totalCpf: toNumericString(totalCpf),
        total: toNumericString(grossWages),
        nett: toNumericString(nett),
      };
      
      const finalUpdates = { ...updates, ...recalculated };
      const updated = await storage.updatePayrollRecord(id, finalUpdates);
      
      // Create audit logs AFTER successful update to avoid partial logging
      for (const change of changes) {
        await storage.createPayrollAuditLog({
          payrollRecordId: id,
          fieldName: change.field,
          oldValue: String(change.oldValue),
          newValue: String(change.newValue),
          changedBy: adminUsername,
          reason,
        });
      }
      
      res.json({ 
        record: updated, 
        message: `Updated ${changes.length} field(s) from employee settings`,
        changes
      });
    } catch (error) {
      console.error("Refresh payroll from settings error:", error);
      res.status(500).json({ message: "Failed to refresh payroll from settings" });
    }
  });

  // Search payroll records
  app.get("/api/admin/payroll/search", requireAdmin, requireFullAdmin, async (req: Request, res: Response) => {
    try {
      const year = req.query.year ? parseInt(req.query.year as string) : undefined;
      const month = req.query.month ? parseInt(req.query.month as string) : undefined;
      const employeeName = req.query.name as string | undefined;
      
      const records = await storage.searchPayrollRecords(year, month, employeeName);
      res.json({ records });
    } catch (error) {
      console.error("Search payroll records error:", error);
      res.status(500).json({ message: "Failed to search payroll records" });
    }
  });

  // === Payroll Loan Management ===
  
  // Get all loan accounts (admin only)
  app.get("/api/admin/payroll/loans", requireAdmin, requireFullAdmin, async (req: Request, res: Response) => {
    try {
      const loans = await storage.getAllPayrollLoanAccounts();
      res.json({ loans });
    } catch (error) {
      console.error("Get loans error:", error);
      res.status(500).json({ message: "Failed to fetch loans" });
    }
  });
  
  // Get active loans (admin only)
  app.get("/api/admin/payroll/loans/active", requireAdmin, requireFullAdmin, async (req: Request, res: Response) => {
    try {
      const loans = await storage.getActivePayrollLoans();
      res.json({ loans });
    } catch (error) {
      console.error("Get active loans error:", error);
      res.status(500).json({ message: "Failed to fetch active loans" });
    }
  });
  
  // Get loans for a specific employee (admin only)
  app.get("/api/admin/payroll/loans/employee/:employeeCode", requireAdmin, requireFullAdmin, async (req: Request, res: Response) => {
    try {
      const { employeeCode } = req.params;
      const loans = await storage.getPayrollLoanAccountsByEmployee(employeeCode);
      res.json({ loans });
    } catch (error) {
      console.error("Get employee loans error:", error);
      res.status(500).json({ message: "Failed to fetch employee loans" });
    }
  });
  
  // Create a new loan (admin only)
  app.post("/api/admin/payroll/loans", requireAdmin, requireWriteAccess, requireFullAdmin, async (req: Request, res: Response) => {
    try {
      const schema = z.object({
        userId: z.string().nullable().optional(),
        employeeCode: z.string(),
        employeeName: z.string(),
        loanType: z.string(),
        loanDescription: z.string().nullable().optional(),
        principalAmount: z.number().positive(),
        monthlyRepayment: z.number().min(0),
        interestRate: z.number().min(0).default(0),
        startDate: z.string(),
        endDate: z.string().nullable().optional(),
      });
      
      const data = schema.parse(req.body);
      const adminUsername = (req.session as any)?.adminUsername || "admin";
      
      const loan = await storage.createPayrollLoanAccount({
        ...data,
        principalAmount: toNumericString(data.principalAmount),
        monthlyRepayment: toNumericString(data.monthlyRepayment),
        interestRate: toNumericString(data.interestRate),
        outstandingBalance: toNumericString(data.principalAmount),
        createdBy: adminUsername,
        status: "active",
      });
      
      res.json({ loan, message: "Loan created successfully" });
    } catch (error) {
      console.error("Create loan error:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Validation error", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to create loan" });
    }
  });
  
  // Update a loan (admin only)
  app.patch("/api/admin/payroll/loans/:id", requireAdmin, requireWriteAccess, requireFullAdmin, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const schema = z.object({
        loanType: z.string().optional(),
        loanDescription: z.string().nullable().optional(),
        monthlyRepayment: z.number().min(0).optional(),
        endDate: z.string().nullable().optional(),
        status: z.enum(["active", "paid_off", "written_off", "suspended"]).optional(),
      });
      
      const updates = schema.parse(req.body);
      const updatesForStorage: Record<string, any> = { ...updates };
      if (updates.monthlyRepayment !== undefined) {
        updatesForStorage.monthlyRepayment = toNumericString(updates.monthlyRepayment);
      }
      const loan = await storage.updatePayrollLoanAccount(id, updatesForStorage as any);
      
      if (!loan) {
        return res.status(404).json({ message: "Loan not found" });
      }
      
      res.json({ loan, message: "Loan updated successfully" });
    } catch (error) {
      console.error("Update loan error:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Validation error", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to update loan" });
    }
  });
  
  // Record a loan repayment (admin only)
  app.post("/api/admin/payroll/loans/:loanId/repayments", requireAdmin, requireWriteAccess, requireFullAdmin, async (req: Request, res: Response) => {
    try {
      const { loanId } = req.params;
      const schema = z.object({
        payPeriodYear: z.number(),
        payPeriodMonth: z.number().min(1).max(12),
        repaymentAmount: z.number().positive(),
        repaymentType: z.string().default("payroll_deduction"),
        notes: z.string().nullable().optional(),
      });
      
      const data = schema.parse(req.body);
      const adminUsername = (req.session as any)?.adminUsername || "admin";
      
      const loan = await storage.getPayrollLoanAccount(loanId);
      if (!loan) {
        return res.status(404).json({ message: "Loan not found" });
      }
      
      const repayment = await storage.createPayrollLoanRepayment({
        loanAccountId: loanId,
        payPeriodYear: data.payPeriodYear,
        payPeriodMonth: data.payPeriodMonth,
        repaymentAmount: toNumericString(data.repaymentAmount),
        repaymentType: data.repaymentType,
        notes: data.notes,
        processedBy: adminUsername,
      });
      
      const updatedLoan = await storage.getPayrollLoanAccount(loanId);
      
      res.json({ 
        repayment, 
        loan: updatedLoan,
        message: "Repayment recorded successfully" 
      });
    } catch (error) {
      console.error("Create repayment error:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Validation error", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to record repayment" });
    }
  });
  
  // Get repayments for a loan (admin only)
  app.get("/api/admin/payroll/loans/:loanId/repayments", requireAdmin, requireFullAdmin, async (req: Request, res: Response) => {
    try {
      const { loanId } = req.params;
      const repayments = await storage.getLoanRepaymentsByLoan(loanId);
      res.json({ repayments });
    } catch (error) {
      console.error("Get loan repayments error:", error);
      res.status(500).json({ message: "Failed to fetch repayments" });
    }
  });
  
  // Get loan repayments for an employee for a specific pay period (for payslip)
  app.get("/api/admin/payroll/loans/repayments/:employeeCode/:year/:month", requireAdmin, requireFullAdmin, async (req: Request, res: Response) => {
    try {
      const { employeeCode, year, month } = req.params;
      const repayments = await storage.getEmployeeLoanRepaymentsForPeriod(
        employeeCode, 
        parseInt(year), 
        parseInt(month)
      );
      res.json({ repayments });
    } catch (error) {
      console.error("Get employee loan repayments error:", error);
      res.status(500).json({ message: "Failed to fetch employee loan repayments" });
    }
  });

  // ============= PAYROLL ADJUSTMENTS =============
  
  // Get all payroll adjustments for a period
  app.get("/api/admin/payroll/adjustments", requireAdmin, requireFullAdmin, async (req: Request, res: Response) => {
    try {
      const { year, month, userId } = req.query;
      
      if (userId) {
        const adjustments = await storage.getPayrollAdjustmentsByEmployee(
          userId as string, 
          year ? parseInt(year as string) : undefined,
          month ? parseInt(month as string) : undefined
        );
        return res.json({ adjustments });
      }
      
      if (year && month) {
        const adjustments = await storage.getPayrollAdjustmentsByPeriod(
          parseInt(year as string),
          parseInt(month as string)
        );
        return res.json({ adjustments });
      }
      
      if (year) {
        const allAdjustments: any[] = [];
        for (let m = 1; m <= 12; m++) {
          const monthAdj = await storage.getPayrollAdjustmentsByPeriod(parseInt(year as string), m);
          allAdjustments.push(...monthAdj);
        }
        return res.json({ adjustments: allAdjustments });
      }
      
      res.status(400).json({ message: "Please provide year/month or userId" });
    } catch (error) {
      console.error("Get payroll adjustments error:", error);
      res.status(500).json({ message: "Failed to fetch payroll adjustments" });
    }
  });
  
  // Get single adjustment with audit logs
  app.get("/api/admin/payroll/adjustments/:id", requireAdmin, requireFullAdmin, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const adjustment = await storage.getPayrollAdjustment(id);
      
      if (!adjustment) {
        return res.status(404).json({ message: "Adjustment not found" });
      }
      
      const auditLogs = await storage.getPayrollAdjustmentAuditLogs(id);
      
      res.json({ adjustment, auditLogs });
    } catch (error) {
      console.error("Get payroll adjustment error:", error);
      res.status(500).json({ message: "Failed to fetch adjustment" });
    }
  });
  
  // Create payroll adjustment
  app.post("/api/admin/payroll/adjustments", requireAdmin, requireWriteAccess, requireFullAdmin, async (req: Request, res: Response) => {
    try {
      const schema = z.object({
        userId: z.string().min(1),
        payPeriodYear: z.number().min(2000).max(2100),
        payPeriodMonth: z.number().min(1).max(12),
        adjustmentType: z.enum(['overtime', 'mc_days', 'al_days', 'late_hours', 'advance', 'claim', 'deduction', 'bonus', 'other', 'addition', 'suppress_ot15', 'suppress_ot20']),
        description: z.string().optional().nullable(),
        hours: z.number().positive().optional().nullable(), // Must be > 0 if provided
        days: z.number().positive().optional().nullable(), // Must be > 0 if provided
        rate: z.union([z.number().positive(), z.string()]).optional().nullable(), // Must be > 0 if provided (dollars per hour/day)
        amount: z.union([z.number(), z.string()]).optional().nullable(), // dollars for fixed amounts
        notes: z.string().optional().nullable(),
        status: z.enum(['pending', 'approved']).optional(), // Allow direct approval
      });
      
      const data = schema.parse(req.body);
      
      // Get admin info for audit
      let createdBy = "admin";
      if (req.session.userId === "admin") {
        createdBy = "master_admin (nexaadmin)";
      } else if (req.session.userId) {
        const adminUser = await storage.getUser(req.session.userId);
        if (adminUser) {
          createdBy = adminUser.name || adminUser.email;
        }
      }
      
      // Parse and ensure all amounts are stored as positive values
      const parseNum = (val: number | string | null | undefined): number | undefined => {
        if (val === null || val === undefined) return undefined;
        const num = typeof val === 'string' ? parseFloat(val) : val;
        return isNaN(num) ? undefined : Math.abs(num);
      };
      
      const adjustedData = {
        userId: data.userId,
        payPeriodYear: data.payPeriodYear,
        payPeriodMonth: data.payPeriodMonth,
        adjustmentType: data.adjustmentType,
        description: data.description || null,
        notes: data.notes || null,
        amount: parseNum(data.amount) !== undefined ? toNumericString(parseNum(data.amount)!) : null,
        hours: parseNum(data.hours) ?? null,
        days: parseNum(data.days) ?? null,
        rate: parseNum(data.rate) !== undefined ? toNumericString(parseNum(data.rate)!) : null,
      };
      
      // For suppress adjustments, default to 'approved' so they take effect immediately
      const isSuppressType = data.adjustmentType === 'suppress_ot15' || data.adjustmentType === 'suppress_ot20';
      const defaultStatus = isSuppressType ? 'approved' : 'pending';
      
      const adjustment = await storage.createPayrollAdjustment({
        ...adjustedData,
        createdBy,
        status: data.status || defaultStatus,
      });
      
      // Create audit log entry
      await storage.createPayrollAdjustmentAuditLog({
        adjustmentId: adjustment.id,
        action: 'created',
        changedBy: createdBy,
        newValue: JSON.stringify(data),
        notes: data.notes || null,
      });
      
      // Auto-recalculate payroll when suppress_ot15 or suppress_ot20 adjustment is created with status "approved"
      let payrollRecalculated = false;
      if (isSuppressType && adjustment.status === 'approved') {
        console.log(`Processing auto-recalculation for suppress adjustment: ${adjustment.adjustmentType}, status: ${adjustment.status}`);
        try {
          // Find the existing payroll record for this employee and period
          const allRecords = await storage.getPayrollRecords(data.payPeriodYear, data.payPeriodMonth);
          const payrollRecord = allRecords.find(r => r.userId === data.userId);
          
          if (payrollRecord) {
            // Get all approved suppress adjustments for this employee/period (including the one just created)
            const allAdjustments = await storage.getPayrollAdjustmentsByEmployee(data.userId, data.payPeriodYear, data.payPeriodMonth);
            const hasSuppressOt15 = allAdjustments.some(adj => adj.adjustmentType === 'suppress_ot15' && adj.status === 'approved');
            const hasSuppressOt20 = allAdjustments.some(adj => adj.adjustmentType === 'suppress_ot20' && adj.status === 'approved');
            
            // Parse current values
            const currentOt15 = parseFloat(payrollRecord.ot15 as string) || 0;
            const currentOt20 = parseFloat(payrollRecord.ot20 as string) || 0;
            const currentGrossWages = parseFloat(payrollRecord.grossWages as string) || 0;
            const currentNett = parseFloat(payrollRecord.nett as string) || 0;
            
            // Calculate the OT amount to remove
            let otReduction = 0;
            const updates: any = {};
            
            if (hasSuppressOt15 && currentOt15 > 0) {
              updates.ot15 = toNumericString(0);
              otReduction += currentOt15;
            }
            if (hasSuppressOt20 && currentOt20 > 0) {
              updates.ot20 = toNumericString(0);
              otReduction += currentOt20;
            }
            
            if (otReduction > 0) {
              // Recalculate gross wages and nett pay
              const newGrossWages = currentGrossWages - otReduction;
              updates.grossWages = toNumericString(Math.max(0, newGrossWages));
              
              // Nett pay = Gross - Employee CPF - other deductions
              // Simplify: just reduce nett pay by the OT reduction amount
              const newNett = currentNett - otReduction;
              updates.nett = toNumericString(Math.max(0, newNett));
              
              // Update the payroll record
              await storage.updatePayrollRecord(payrollRecord.id, updates);
              payrollRecalculated = true;
              
              console.log(`Auto-recalculated payroll for ${payrollRecord.employeeName}: OT reduced by $${otReduction.toFixed(2)}`);
            }
          }
        } catch (recalcError) {
          console.error("Failed to auto-recalculate payroll after suppress adjustment:", recalcError);
          // Don't fail the adjustment creation, just log the error
        }
      }
      
      res.json({ 
        adjustment, 
        message: payrollRecalculated 
          ? "Adjustment created and payroll automatically recalculated" 
          : "Adjustment created successfully" 
      });
    } catch (error) {
      console.error("Create payroll adjustment error:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Validation error", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to create adjustment" });
    }
  });
  
  // Update payroll adjustment
  app.patch("/api/admin/payroll/adjustments/:id", requireAdmin, requireWriteAccess, requireFullAdmin, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      
      const schema = z.object({
        adjustmentType: z.enum(['overtime', 'mc_days', 'al_days', 'late_hours', 'advance', 'claim', 'deduction', 'bonus', 'other', 'addition', 'suppress_ot15', 'suppress_ot20']).optional(),
        description: z.string().optional(),
        hours: z.number().positive().optional(), // Must be > 0 if provided
        days: z.number().positive().optional(), // Must be > 0 if provided
        rate: z.number().positive().optional(), // Must be > 0 if provided
        amount: z.number().optional(), // Will be stored as absolute value
        notes: z.string().optional(),
        status: z.enum(['pending', 'approved', 'rejected', 'processed']).optional(),
      });
      
      const updates = schema.parse(req.body);
      
      const currentAdjustment = await storage.getPayrollAdjustment(id);
      if (!currentAdjustment) {
        return res.status(404).json({ message: "Adjustment not found" });
      }
      
      // Compute merged state for validation (current + updates)
      const mergedType = updates.adjustmentType || currentAdjustment.adjustmentType;
      const mergedHours = updates.hours !== undefined ? updates.hours : currentAdjustment.hours;
      const mergedDays = updates.days !== undefined ? updates.days : currentAdjustment.days;
      const mergedRate = updates.rate !== undefined ? updates.rate : currentAdjustment.rate;
      const mergedAmount = updates.amount !== undefined ? updates.amount : currentAdjustment.amount;
      
      // If updating value fields (not just status), validate the merged result
      const isValueUpdate = updates.hours !== undefined || updates.days !== undefined || 
                           updates.rate !== undefined || updates.amount !== undefined ||
                           updates.adjustmentType !== undefined;
      
      if (isValueUpdate) {
        const mergedHoursNum = typeof mergedHours === 'string' ? parseFloat(mergedHours) : mergedHours;
        const mergedRateNum = typeof mergedRate === 'string' ? parseFloat(mergedRate) : mergedRate;
        const mergedAmountNum = typeof mergedAmount === 'string' ? parseFloat(mergedAmount) : mergedAmount;
        const hasHoursRate = (mergedHoursNum !== null && mergedHoursNum !== undefined && mergedHoursNum > 0) && 
                             (mergedRateNum !== null && mergedRateNum !== undefined && mergedRateNum > 0);
        const hasAmount = mergedAmountNum !== null && mergedAmountNum !== undefined && Math.abs(mergedAmountNum) > 0;
        const hasDays = mergedDays !== null && mergedDays !== undefined && mergedDays > 0;
        
        // For day-based adjustments (mc_days, al_days), days is sufficient
        if (mergedType === 'mc_days' || mergedType === 'al_days') {
          if (!hasDays) {
            return res.status(400).json({ message: "Day-based adjustments require days > 0" });
          }
        } else {
          if (!hasHoursRate && !hasAmount) {
            return res.status(400).json({ message: "Must provide either (hours and rate) or a non-zero amount" });
          }
        }
      }
      
      // Normalize values to absolute before storage (convert amount to string for storage)
      const normalizedUpdates: Record<string, any> = {
        ...updates,
        amount: updates.amount !== undefined ? toNumericString(Math.abs(updates.amount)) : undefined,
        hours: updates.hours !== undefined ? Math.abs(updates.hours) : undefined,
        days: updates.days !== undefined ? Math.abs(updates.days) : undefined,
        rate: updates.rate !== undefined ? Math.abs(updates.rate) : undefined,
      };
      
      // Get admin info for audit
      let changedBy = "admin";
      if (req.session.userId === "admin") {
        changedBy = "master_admin (nexaadmin)";
      } else if (req.session.userId) {
        const adminUser = await storage.getUser(req.session.userId);
        if (adminUser) {
          changedBy = adminUser.name || adminUser.email;
        }
      }
      
      const adjustment = await storage.updatePayrollAdjustment(id, normalizedUpdates as any);
      
      // Create audit log entry
      await storage.createPayrollAdjustmentAuditLog({
        adjustmentId: id,
        action: 'updated',
        changedBy,
        oldValue: JSON.stringify({
          adjustmentType: currentAdjustment.adjustmentType,
          hours: currentAdjustment.hours,
          days: currentAdjustment.days,
          rate: currentAdjustment.rate,
          amount: currentAdjustment.amount,
          status: currentAdjustment.status,
        }),
        newValue: JSON.stringify(updates),
        notes: updates.notes,
      });
      
      res.json({ adjustment, message: "Adjustment updated successfully" });
    } catch (error) {
      console.error("Update payroll adjustment error:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Validation error", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to update adjustment" });
    }
  });
  
  // Delete payroll adjustment
  app.delete("/api/admin/payroll/adjustments/:id", requireAdmin, requireWriteAccess, requireFullAdmin, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      
      const adjustment = await storage.getPayrollAdjustment(id);
      if (!adjustment) {
        return res.status(404).json({ message: "Adjustment not found" });
      }
      
      await storage.deletePayrollAdjustment(id);
      
      // Note: Adjustments are tracked for reporting purposes but don't automatically 
      // modify payroll totals. Admin should regenerate payroll if needed.
      
      res.json({ message: "Adjustment deleted successfully" });
    } catch (error) {
      console.error("Delete payroll adjustment error:", error);
      res.status(500).json({ message: "Failed to delete adjustment" });
    }
  });
  
  // Get running payroll summary for an employee (to-date earnings)
  app.get("/api/admin/payroll/summary/:userId/:year/:month", requireAdmin, requireFullAdmin, async (req: Request, res: Response) => {
    try {
      const { userId, year, month } = req.params;
      const yearNum = parseInt(year);
      const monthNum = parseInt(month);
      
      // Get employee details
      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ message: "Employee not found" });
      }
      
      // Calculate daily rate from monthly salary using formula: (Basic × 12) / (daysPerWeek × 52)
      // Use parseNumericOrNull to properly distinguish between "not set" (null) and "set to 0"
      const basicMonthlySalaryRaw = parseNumericOrNull(user.basicMonthlySalary);
      const basicMonthlySalary = basicMonthlySalaryRaw ?? 0; // dollars
      const daysPerWeek = user.regularDaysPerWeek || 5;
      const hoursPerDay = user.regularHoursPerDay || 8;
      const isExecutive = daysPerWeek === 0; // Executive employees don't have daily/hourly rates
      
      // Calculate derived rates (Executive gets monthly salary only, no daily/hourly rates)
      let dailyRate = 0;
      let hourlyRate = 0;
      
      if (!isExecutive && daysPerWeek > 0 && basicMonthlySalary > 0) {
        const annualSalary = basicMonthlySalary * 12;
        const workDaysPerYear = daysPerWeek * 52;
        dailyRate = annualSalary / workDaysPerYear; // dollars
        hourlyRate = dailyRate / hoursPerDay; // dollars
      }
      
      // Get attendance records for the period
      const startDate = `${yearNum}-${String(monthNum).padStart(2, '0')}-01`;
      const lastDay = new Date(yearNum, monthNum, 0).getDate();
      const endDate = `${yearNum}-${String(monthNum).padStart(2, '0')}-${lastDay}`;
      
      const attendanceRecords = await storage.getAttendanceRecordsByUserAndDateRange(userId, startDate, endDate);
      const userAttendance = attendanceRecords.filter(r => r.clockOutTime !== null);
      
      // Calculate total hours worked
      let totalHoursWorked = 0;
      for (const record of userAttendance) {
        if (record.clockOutTime && record.clockInTime) {
          const clockIn = new Date(record.clockInTime);
          const clockOut = new Date(record.clockOutTime);
          const hoursWorked = (clockOut.getTime() - clockIn.getTime()) / (1000 * 60 * 60);
          totalHoursWorked += hoursWorked;
        }
      }
      
      // Calculate regular hours vs overtime
      // Executive employees get full monthly salary regardless of hours, no OT calculation
      let regularHours = totalHoursWorked;
      let overtimeHours = 0;
      
      if (!isExecutive && daysPerWeek > 0) {
        const regularHoursLimit = daysPerWeek * hoursPerDay * 4.33; // ~4.33 weeks per month
        regularHours = Math.min(totalHoursWorked, regularHoursLimit);
        overtimeHours = Math.max(0, totalHoursWorked - regularHoursLimit);
      }
      
      // Get company OT settings
      const companySettings = await storage.getCompanySettings();
      const otMultiplier = companySettings?.otMultiplier15 || 1.5;
      
      // Get adjustments for this period (need to check for suppress_ot15/ot20 before calculating)
      const adjustments = await storage.getPayrollAdjustmentsByEmployee(userId, yearNum, monthNum);
      
      // Check if OT should be suppressed (suppress_ot15 and/or suppress_ot20 adjustments)
      const hasSuppressOt15 = adjustments.some(adj => adj.adjustmentType === 'suppress_ot15' && adj.status === 'approved');
      const hasSuppressOt20 = adjustments.some(adj => adj.adjustmentType === 'suppress_ot20' && adj.status === 'approved');
      
      // Calculate base earnings from attendance
      // Executive employees get full monthly salary, not hourly calculation
      let baseEarnings = 0;
      let autoOt15Pay = 0;  // OT at 1.5x
      let autoOt20Pay = 0;  // OT at 2.0x
      let finalOvertimeHours = overtimeHours;
      
      if (isExecutive) {
        // Executive gets full monthly salary
        baseEarnings = basicMonthlySalary;
      } else {
        // Use shared rounding utility for consistent precision
        baseEarnings = roundToDollars(regularHours * hourlyRate);
        // Apply OT suppression if present - separate for OT1.5 and OT2.0
        if (!hasSuppressOt15) {
          autoOt15Pay = roundToDollars(overtimeHours * hourlyRate * otMultiplier);
        }
        // OT 2.0 would come from specific adjustments or weekend work, calculated separately
        if (!hasSuppressOt20) {
          // OT 2.0 typically from weekend/holiday work - handled by adjustments
          autoOt20Pay = 0; // Will be set if there are specific 2.0x OT adjustments
        }
        // Only zero hours if both OT types are suppressed
        if (hasSuppressOt15 && hasSuppressOt20) {
          finalOvertimeHours = 0;
        }
      }
      const autoOvertimePay = autoOt15Pay + autoOt20Pay;
      
      // Calculate totals from adjustments
      let totalOvertimeFromAdj = 0;
      let totalClaims = 0;
      let totalDeductions = 0;
      let totalBonus = 0;
      let totalMcDays = 0;
      let totalAlDays = 0;
      
      for (const adj of adjustments) {
        // Calculate the monetary value from amount or hours*rate
        // Use parseNumericOrNull to distinguish between "not set" (null) and "set to 0"
        const adjAmountRaw = parseNumericOrNull(adj.amount);
        const adjRateRaw = parseNumericOrNull(adj.rate);
        
        // Prefer explicit amount, fallback to hours*rate calculation
        let value = 0;
        if (adjAmountRaw !== null) {
          value = roundToDollars(adjAmountRaw);
        } else if (adj.hours && adjRateRaw !== null && adjRateRaw > 0) {
          value = roundToDollars(adj.hours * adjRateRaw);
        }
        
        // Handle each adjustment type - preserve sign where appropriate
        // Additions are positive, deductions stored as positive but treated as subtractions
        switch (adj.adjustmentType) {
          case 'overtime':
            totalOvertimeFromAdj += Math.abs(value); // OT is always positive
            break;
          case 'claim':
          case 'other':
            // Claims/other can be positive (additions) - use as-is
            totalClaims += value > 0 ? value : 0;
            break;
          case 'advance':
          case 'deduction':
          case 'late_hours':
            // Deductions stored as positive values, treated as subtractions
            totalDeductions += Math.abs(value);
            break;
          case 'bonus':
            totalBonus += Math.abs(value); // Bonus is always positive
            break;
          case 'mc_days':
            totalMcDays += Math.abs(adj.days || 0);
            break;
          case 'al_days':
            totalAlDays += Math.abs(adj.days || 0);
            break;
        }
      }
      
      // Calculate leave pay (paid at daily rate) - use shared rounding utility
      const leavePay = roundToDollars((totalMcDays + totalAlDays) * dailyRate);
      
      // Calculate totals
      const totalOvertimePay = autoOvertimePay + totalOvertimeFromAdj;
      const grossPay = baseEarnings + totalOvertimePay + totalClaims + totalBonus + leavePay;
      const netPay = grossPay - totalDeductions;
      
      res.json({
        employee: {
          id: user.id,
          name: user.name,
          employeeCode: user.employeeCode,
          department: user.department,
        },
        period: { year: yearNum, month: monthNum },
        paySettings: {
          basicMonthlySalary,
          daysPerWeek,
          hoursPerDay,
          dailyRate,
          hourlyRate,
          isExecutive,
        },
        attendance: {
          totalHoursWorked: Math.round(totalHoursWorked * 100) / 100,
          regularHours: Math.round(regularHours * 100) / 100,
          overtimeHours: Math.round(finalOvertimeHours * 100) / 100,
          daysWorked: userAttendance.length,
        },
        earnings: {
          baseEarnings,
          autoOvertimePay,
          manualOvertimePay: totalOvertimeFromAdj,
          totalOvertimePay,
          claims: totalClaims,
          bonus: totalBonus,
          leavePay,
          mcDays: totalMcDays,
          alDays: totalAlDays,
        },
        deductions: {
          total: totalDeductions,
        },
        summary: {
          grossPay,
          totalDeductions,
          netPay,
        },
        adjustments,
      });
    } catch (error) {
      console.error("Get payroll summary error:", error);
      res.status(500).json({ message: "Failed to calculate payroll summary" });
    }
  });

  // ============================================================
  // Historical Payroll Import (Master Admin Only)
  // ============================================================
  
  // Check if user is master admin
  app.get("/api/admin/is-master-admin", requireAdmin, async (req: Request, res: Response) => {
    res.json({ isMasterAdmin: req.session.userId === "admin" });
  });
  
  // Get all import batches
  app.get("/api/admin/payroll/import-batches", requireAdmin, requireMasterAdmin, async (req: Request, res: Response) => {
    try {
      const batches = await storage.getPayrollImportBatches();
      res.json({ batches });
    } catch (error) {
      console.error("Get import batches error:", error);
      res.status(500).json({ message: "Failed to fetch import batches" });
    }
  });
  
  // Parse Excel file for historical payroll import (validation/preview step)
  app.post("/api/admin/payroll/historical-import/parse", requireAdmin, requireMasterAdmin, async (req: Request, res: Response) => {
    try {
      const { fileBase64, fileName } = req.body;
      
      if (!fileBase64 || !fileName) {
        return res.status(400).json({ message: "File data and name are required" });
      }
      
      console.log(`[Historical Import] Parsing file: ${fileName}, base64 length: ${fileBase64?.length || 0}`);
      
      // Decode base64 file
      let buffer: Buffer;
      try {
        buffer = Buffer.from(fileBase64, "base64");
        console.log(`[Historical Import] Buffer created, size: ${buffer.length} bytes`);
      } catch (bufferError) {
        console.error("[Historical Import] Buffer creation failed:", bufferError);
        return res.status(400).json({ message: "Invalid file data encoding" });
      }
      
      let workbook;
      try {
        workbook = XLSX.read(buffer, { type: "buffer" });
        console.log(`[Historical Import] Workbook read successfully, sheets: ${workbook.SheetNames.join(", ")}`);
      } catch (xlsxError: any) {
        console.error("[Historical Import] XLSX parse failed:", xlsxError);
        return res.status(400).json({ message: `Failed to parse Excel file: ${xlsxError.message || "Unknown error"}. Please ensure the file is a valid .xlsx or .xls file.` });
      }
      
      // Read first sheet
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const rawData = XLSX.utils.sheet_to_json(sheet, { header: 1 });
      
      console.log(`[Historical Import] Raw data rows: ${rawData.length}`);
      
      // Find pay period from header rows
      let payPeriodYear: number | null = null;
      let payPeriodMonth: number | null = null;
      let payPeriodText = "";
      
      for (let i = 0; i < Math.min(5, rawData.length); i++) {
        const row = rawData[i] as any[];
        if (row && row[0] && typeof row[0] === "string" && row[0].includes("Pay Period")) {
          payPeriodText = row[1] || "";
          // Parse format like "END,MID,BONUS Month - JUL '2025" or "JAN '2025"
          const monthMatch = payPeriodText.match(/(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s*['"]?(\d{4})/i);
          if (monthMatch) {
            const monthNames: Record<string, number> = {
              JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6,
              JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12
            };
            payPeriodMonth = monthNames[monthMatch[1].toUpperCase()] || null;
            payPeriodYear = parseInt(monthMatch[2]);
          }
          break;
        }
      }
      
      // Find header row (starts with "No")
      let headerRowIndex = -1;
      let headers: string[] = [];
      for (let i = 0; i < rawData.length; i++) {
        const row = rawData[i] as any[];
        if (row && row[0] === "No") {
          headerRowIndex = i;
          headers = row.map((h: any) => (h || "").toString().trim());
          break;
        }
      }
      
      if (headerRowIndex === -1) {
        return res.status(400).json({ message: "Could not find header row in Excel file" });
      }
      
      // Parse data rows
      const records: any[] = [];
      const validationErrors: string[] = [];
      let successCount = 0;
      let errorCount = 0;
      let skipCount = 0;
      
      for (let i = headerRowIndex + 1; i < rawData.length; i++) {
        const row = rawData[i] as any[];
        if (!row || !row[0] || row[0] === "" || typeof row[0] !== "number") continue;
        
        const getValue = (columnName: string): any => {
          const index = headers.indexOf(columnName);
          return index >= 0 && row[index] !== undefined ? row[index] : null;
        };
        
        const getNumericValue = (columnName: string): string => {
          const val = getValue(columnName);
          if (val === null || val === undefined || val === "") return "0";
          return String(parseFloat(val) || 0);
        };
        
        const employeeCode = getValue("EMP CODE")?.toString() || "";
        const employeeName = getValue("EMPLOYEE NAME") || "";
        
        if (!employeeCode || !employeeName) {
          errorCount++;
          validationErrors.push(`Row ${i + 1}: Missing employee code or name`);
          continue;
        }
        
        // Check for duplicates in current payroll
        if (payPeriodYear && payPeriodMonth) {
          const exists = await storage.checkDuplicatePayrollRecord(employeeCode, payPeriodYear, payPeriodMonth);
          if (exists) {
            skipCount++;
            validationErrors.push(`Row ${i + 1}: ${employeeName} (${employeeCode}) already has payroll record for this period - will skip`);
            continue;
          }
        }
        
        // Map Excel columns to payroll record fields
        const record = {
          employeeCode,
          employeeName: employeeName.toString(),
          deptCode: getValue("DEPT CODE")?.toString() || null,
          deptName: getValue("DEPT NAME")?.toString() || null,
          secCode: getValue("SEC CODE")?.toString() || null,
          secName: getValue("SEC NAME")?.toString() || null,
          catCode: getValue("CAT CODE")?.toString() || null,
          catName: getValue("CAT NAME")?.toString() || null,
          nric: getValue("NRIC")?.toString() || null,
          joinDate: getValue("JOIN DATE") ? 
            (typeof getValue("JOIN DATE") === "number" 
              ? new Date((getValue("JOIN DATE") - 25569) * 86400 * 1000).toISOString().split("T")[0]
              : getValue("JOIN DATE").toString())
            : null,
          totSalary: getNumericValue("TOT SALARY"),
          basicSalary: getNumericValue("BASIC SALARY"),
          monthlyVariablesComponent: getNumericValue("MONTHLY VARIABLES COMPONENT"),
          flat: getNumericValue("FLAT"),
          ot10: getNumericValue("OT10"),
          ot15: getNumericValue("OT15"),
          ot20: getNumericValue("OT20"),
          ot30: getNumericValue("OT30"),
          shiftAllowance: getNumericValue("SHIFT ALLOWANCE"),
          totRestPhAmount: getNumericValue("TOT REST/PH AMOUNT"),
          transportAllowance: getNumericValue("TRANSPORT ALLOWANCE (60-111)"),
          annualLeaveEncashment: getNumericValue("ANNUAL LEAVE ENCASHMENT"),
          serviceCallAllowances: getNumericValue("SERVICE CALL ALLOWANCES (60-102)"),
          otherAllowance: getNumericValue("OTHER ALLOWANCE"),
          houseRentalAllowances: getNumericValue("HOUSE RENTAL ALLOWANCES (60-217)"),
          noPayDay: getNumericValue("NO PAY DAY"),
          cc: getNumericValue("CC"),
          cdac: getNumericValue("CDAC"),
          ecf: getNumericValue("ECF"),
          mbmf: getNumericValue("MBMF"),
          sinda: getNumericValue("SINDA"),
          bonus: getNumericValue("BONUS"),
          grossWages: getNumericValue("GROSS WAGES"),
          cpfWages: getNumericValue("CPF WAGES"),
          sdf: getNumericValue("SDF"),
          fwl: getNumericValue("FWL"),
          employerCpf: getNumericValue("EMPLOYER CPF"),
          employeeCpf: getNumericValue("EMPLOYEE CPF"),
          totalCpf: getNumericValue("TOTAL"),
          nett: getNumericValue("NETT"),
          payMode: getValue("Pay Mode")?.toString() || null,
          chequeNo: getValue("Cheque No")?.toString() || null,
        };
        
        // Try to match employee - first by code, then by name
        let existingUser = await storage.getUserByEmployeeCode(employeeCode);
        
        // If no match by code, try matching by name (case-insensitive)
        if (!existingUser && employeeName) {
          existingUser = await storage.getUserByName(employeeName);
        }
        
        records.push({
          ...record,
          userId: existingUser?.id || null,
          matchedEmployee: existingUser ? { id: existingUser.id, name: existingUser.name } : null,
          rowNumber: i + 1,
        });
        successCount++;
      }
      
      res.json({
        payPeriod: {
          year: payPeriodYear,
          month: payPeriodMonth,
          text: payPeriodText,
        },
        records,
        summary: {
          total: records.length + errorCount + skipCount,
          valid: successCount,
          errors: errorCount,
          skipped: skipCount,
        },
        validationErrors,
        headers,
      });
    } catch (error: any) {
      console.error("Parse historical payroll error:", error);
      const errorMessage = error?.message || "Unknown error occurred";
      res.status(500).json({ message: `Failed to parse payroll file: ${errorMessage}` });
    }
  });
  
  // Execute historical payroll import
  app.post("/api/admin/payroll/historical-import/execute", requireAdmin, requireMasterAdmin, async (req: Request, res: Response) => {
    try {
      const schema = z.object({
        fileName: z.string(),
        payPeriodYear: z.number().int().min(2000).max(2100),
        payPeriodMonth: z.number().int().min(1).max(12),
        records: z.array(z.object({
          employeeCode: z.string(),
          employeeName: z.string(),
          userId: z.string().nullable().optional(),
          deptCode: z.string().nullable().optional(),
          deptName: z.string().nullable().optional(),
          secCode: z.string().nullable().optional(),
          secName: z.string().nullable().optional(),
          catCode: z.string().nullable().optional(),
          catName: z.string().nullable().optional(),
          nric: z.string().nullable().optional(),
          joinDate: z.string().nullable().optional(),
          totSalary: z.string().default("0"),
          basicSalary: z.string().default("0"),
          monthlyVariablesComponent: z.string().default("0"),
          flat: z.string().default("0"),
          ot10: z.string().default("0"),
          ot15: z.string().default("0"),
          ot20: z.string().default("0"),
          ot30: z.string().default("0"),
          shiftAllowance: z.string().default("0"),
          totRestPhAmount: z.string().default("0"),
          transportAllowance: z.string().default("0"),
          annualLeaveEncashment: z.string().default("0"),
          serviceCallAllowances: z.string().default("0"),
          otherAllowance: z.string().default("0"),
          houseRentalAllowances: z.string().default("0"),
          noPayDay: z.string().default("0"),
          cc: z.string().default("0"),
          cdac: z.string().default("0"),
          ecf: z.string().default("0"),
          mbmf: z.string().default("0"),
          sinda: z.string().default("0"),
          bonus: z.string().default("0"),
          grossWages: z.string().default("0"),
          cpfWages: z.string().default("0"),
          sdf: z.string().default("0"),
          fwl: z.string().default("0"),
          employerCpf: z.string().default("0"),
          employeeCpf: z.string().default("0"),
          totalCpf: z.string().default("0"),
          nett: z.string().default("0"),
          payMode: z.string().nullable().optional(),
          chequeNo: z.string().nullable().optional(),
        })),
      });
      
      const { fileName, payPeriodYear, payPeriodMonth, records } = schema.parse(req.body);
      
      const monthNames = ["", "JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
      const payPeriod = `${monthNames[payPeriodMonth]} ${payPeriodYear}`;
      
      // Create import batch record
      const batch = await storage.createPayrollImportBatch({
        fileName,
        payPeriodYear,
        payPeriodMonth,
        totalRecords: records.length,
        importedBy: "master_admin (nexaadmin)",
        status: "importing",
      });
      
      let successCount = 0;
      let errorCount = 0;
      let skippedCount = 0;
      const errors: string[] = [];
      
      for (const record of records) {
        try {
          // Check for duplicate again
          const exists = await storage.checkDuplicatePayrollRecord(record.employeeCode, payPeriodYear, payPeriodMonth);
          if (exists) {
            skippedCount++;
            continue;
          }
          
          // Create payroll record
          await storage.createPayrollRecord({
            userId: record.userId || undefined,
            payPeriod,
            payPeriodYear,
            payPeriodMonth,
            employeeCode: record.employeeCode,
            employeeName: record.employeeName,
            deptCode: record.deptCode,
            deptName: record.deptName,
            secCode: record.secCode,
            secName: record.secName,
            catCode: record.catCode,
            catName: record.catName,
            nric: record.nric,
            joinDate: record.joinDate,
            totSalary: record.totSalary,
            basicSalary: record.basicSalary,
            monthlyVariablesComponent: record.monthlyVariablesComponent,
            flat: record.flat,
            ot10: record.ot10,
            ot15: record.ot15,
            ot20: record.ot20,
            ot30: record.ot30,
            shiftAllowance: record.shiftAllowance,
            totRestPhAmount: record.totRestPhAmount,
            transportAllowance: record.transportAllowance,
            annualLeaveEncashment: record.annualLeaveEncashment,
            serviceCallAllowances: record.serviceCallAllowances,
            otherAllowance: record.otherAllowance,
            houseRentalAllowances: record.houseRentalAllowances,
            noPayDay: record.noPayDay,
            cc: record.cc,
            cdac: record.cdac,
            ecf: record.ecf,
            mbmf: record.mbmf,
            sinda: record.sinda,
            bonus: record.bonus,
            grossWages: record.grossWages,
            cpfWages: record.cpfWages,
            sdf: record.sdf,
            fwl: record.fwl,
            employerCpf: record.employerCpf,
            employeeCpf: record.employeeCpf,
            totalCpf: record.totalCpf,
            nett: record.nett,
            payMode: record.payMode,
            chequeNo: record.chequeNo,
            importedBy: "master_admin (nexaadmin)",
            importBatchId: batch.id,
            isHistoricalImport: true,
          });
          successCount++;
        } catch (err: any) {
          errorCount++;
          errors.push(`${record.employeeName} (${record.employeeCode}): ${err.message}`);
        }
      }
      
      // Update batch status
      await storage.updatePayrollImportBatch(batch.id, {
        status: "completed",
        successfulRecords: successCount,
        failedRecords: errorCount,
        skippedRecords: skippedCount,
        validationErrors: errors.length > 0 ? JSON.stringify(errors) : null,
        completedAt: new Date(),
      });
      
      res.json({
        success: true,
        batchId: batch.id,
        summary: {
          total: records.length,
          successful: successCount,
          failed: errorCount,
          skipped: skippedCount,
        },
        errors,
      });
    } catch (error) {
      console.error("Execute historical import error:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid data", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to import payroll records" });
    }
  });

  // Public uploads are served as static files under /uploads/ — no dynamic route needed.
  // This route handles legacy /public-objects/ URLs that may still exist in the database.
  app.get("/public-objects/:filePath(*)", (_req: Request, res: Response) => {
    return res.status(404).json({ error: "File not found" });
  });

  // Serve private objects (authenticated users only - for MC docs, receipts)
  app.get("/private-objects/:filePath(*)", async (req: Request, res: Response) => {
    if (!req.session?.userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const filePath = req.params.filePath;
    const objectStorageService = new ObjectStorageService();
    try {
      await objectStorageService.downloadObject(`/private-objects/${filePath}`, res);
    } catch (error) {
      console.error("Error fetching private object:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  // ========== TOOLS API (Manual Payslip Generator) ==========
  
  // Create a manual payslip
  app.post("/api/admin/tools/payslip", requireAdmin, requireWriteAccess, async (req: Request, res: Response) => {
    try {
      const adminSession = req.session as any;
      const createdBy = adminSession.adminId || adminSession.userName || "admin";
      
      const data = req.body;
      
      if (!data.employeeName) {
        return res.status(400).json({ message: "Employee name is required" });
      }
      
      // Insert the payslip using raw SQL since tables were just created
      const result = await pool.query(`
        INSERT INTO manual_payslips (
          employee_name, employee_code, nric, department, designation,
          pay_period_year, pay_period_month, pay_period_start, pay_period_end,
          regular_hours, overtime_hours, basic_salary, hourly_rate, regular_pay, overtime_pay,
          mobile_allowance, transport_allowance, loan_allowance, shift_allowance,
          other_allowance, house_rental_allowance, bonuses,
          employee_cpf, employer_cpf, loan_deduction, other_deductions,
          gross_pay, total_deductions, net_pay, remarks, created_by
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
          $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31
        ) RETURNING id
      `, [
        data.employeeName,
        data.employeeCode,
        data.nric,
        data.department,
        data.designation,
        data.payPeriodYear,
        data.payPeriodMonth,
        data.payPeriodStart,
        data.payPeriodEnd,
        data.regularHours || "0",
        data.overtimeHours || "0",
        data.basicSalary || "0",
        data.hourlyRate || "0",
        data.regularPay || "0",
        data.overtimePay || "0",
        data.mobileAllowance || "0",
        data.transportAllowance || "0",
        data.loanAllowance || "0",
        data.shiftAllowance || "0",
        data.otherAllowance || "0",
        data.houseRentalAllowance || "0",
        data.bonuses || "0",
        data.employeeCpf || "0",
        data.employerCpf || "0",
        data.loanDeduction || "0",
        data.otherDeductions || "0",
        data.grossPay || "0",
        data.totalDeductions || "0",
        data.netPay || "0",
        data.remarks,
        createdBy
      ]);
      
      const payslipId = result.rows[0]?.id;
      
      // Create audit log entry
      await pool.query(`
        INSERT INTO manual_payslip_audit_logs (payslip_id, action, details, changed_by)
        VALUES ($1, $2, $3, $4)
      `, [
        payslipId,
        'create',
        JSON.stringify({ employeeName: data.employeeName, period: `${data.payPeriodMonth}/${data.payPeriodYear}`, netPay: data.netPay }),
        createdBy
      ]);
      
      res.json({ success: true, id: payslipId, message: "Payslip saved successfully" });
    } catch (error) {
      console.error("Create manual payslip error:", error);
      res.status(500).json({ message: "Failed to save payslip" });
    }
  });
  
  // Get all manual payslips
  app.get("/api/admin/tools/payslips", requireAdmin, async (req: Request, res: Response) => {
    try {
      const result = await pool.query(`
        SELECT * FROM manual_payslips 
        ORDER BY created_at DESC
        LIMIT 100
      `);
      res.json({ payslips: result.rows });
    } catch (error) {
      console.error("Get manual payslips error:", error);
      res.status(500).json({ message: "Failed to fetch payslips" });
    }
  });
  
  // Get manual payslip audit logs
  app.get("/api/admin/tools/payslips/:id/audit", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const result = await pool.query(`
        SELECT * FROM manual_payslip_audit_logs 
        WHERE payslip_id = $1 
        ORDER BY changed_at DESC
      `, [id]);
      res.json({ logs: result.rows });
    } catch (error) {
      console.error("Get payslip audit logs error:", error);
      res.status(500).json({ message: "Failed to fetch audit logs" });
    }
  });

  // ==================== EMPLOYEE DOCUMENTS ROUTES ====================
  
  // Get documents for an employee
  app.get("/api/admin/employees/:id/documents", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const documents = await storage.getEmployeeDocuments(id);
      res.json(documents);
    } catch (error) {
      console.error("Get employee documents error:", error);
      res.status(500).json({ message: "Failed to fetch employee documents" });
    }
  });
  
  // Upload document for an employee
  app.post("/api/admin/employees/:id/documents", requireAdmin, requireWriteAccess, upload.single('file'), async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { documentType, documentName, expiryDate, notes } = req.body;
      
      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }
      
      if (!documentType || !documentName) {
        return res.status(400).json({ message: "Document type and name are required" });
      }
      
      // Validate document type
      const validTypes = ['passport', 'work_pass', 'certificate', 'other'];
      if (!validTypes.includes(documentType)) {
        return res.status(400).json({ message: "Invalid document type" });
      }
      
      // Upload to object storage
      const objectStorageService = new ObjectStorageService();
      const fileUrl = await objectStorageService.uploadPrivateFile(
        req.file.buffer,
        req.file.originalname,
        req.file.mimetype,
        `employee-documents/${id}`
      );
      
      // Get uploader ID (handle master admin case)
      let uploadedBy: string | null = null;
      if (req.session.userId && req.session.userId !== "admin") {
        uploadedBy = req.session.userId;
      }
      
      const document = await storage.createEmployeeDocument({
        userId: id,
        documentType,
        documentName,
        fileUrl,
        fileName: req.file.originalname,
        fileSize: req.file.size,
        expiryDate: expiryDate || null,
        notes: notes || null,
        uploadedBy,
      });
      
      res.json(document);
    } catch (error) {
      console.error("Upload employee document error:", error);
      res.status(500).json({ message: "Failed to upload document" });
    }
  });
  
  // Download/view employee document
  app.get("/api/admin/employees/:userId/documents/:docId/file", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { docId } = req.params;
      const document = await storage.getEmployeeDocument(docId);
      
      if (!document) {
        return res.status(404).json({ message: "Document not found" });
      }
      
      const objectStorageService = new ObjectStorageService();
      res.setHeader('Content-Disposition', `inline; filename="${document.fileName}"`);
      await objectStorageService.downloadObject(document.fileUrl, res);
    } catch (error) {
      console.error("Get employee document file error:", error);
      res.status(500).json({ message: "Failed to get document file" });
    }
  });
  
  // Delete employee document
  app.delete("/api/admin/employees/:userId/documents/:docId", requireAdmin, requireWriteAccess, async (req: Request, res: Response) => {
    try {
      const { docId } = req.params;
      const document = await storage.getEmployeeDocument(docId);
      
      if (!document) {
        return res.status(404).json({ message: "Document not found" });
      }
      
      // Delete from object storage
      const objectStorageService = new ObjectStorageService();
      try {
        await objectStorageService.deletePrivateFile(document.fileUrl);
      } catch (err) {
        console.error("Failed to delete file from storage:", err);
        // Continue with database deletion even if storage deletion fails
      }
      
      await storage.deleteEmployeeDocument(docId);
      
      res.json({ success: true, message: "Document deleted successfully" });
    } catch (error) {
      console.error("Delete employee document error:", error);
      res.status(500).json({ message: "Failed to delete document" });
    }
  });

  // ==================== CLAIMS ROUTES ====================
  
  // Employee: Submit a new claim
  app.post("/api/claims", upload.single('receipt'), async (req: Request, res: Response) => {
    if (!req.session?.userId || req.session.isAdmin) {
      return res.status(401).json({ message: "User authentication required" });
    }
    
    try {
      const userId = req.session.userId;
      
      // Zod validation for claims
      const claimSchema = z.object({
        claimType: z.enum(["transport", "material_purchase", "other"]),
        amount: z.string().refine(val => !isNaN(parseFloat(val)) && parseFloat(val) > 0, {
          message: "Amount must be a positive number"
        }),
        description: z.string().optional(),
        claimMonth: z.string().refine(val => {
          const num = parseInt(val);
          return num >= 1 && num <= 12;
        }, { message: "Invalid month" }),
        claimYear: z.string().refine(val => {
          const num = parseInt(val);
          return num >= 2020 && num <= 2100;
        }, { message: "Invalid year" }),
      });
      
      const validation = claimSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ 
          message: "Validation failed", 
          errors: validation.error.errors 
        });
      }
      
      const { claimType, amount, description, claimMonth, claimYear } = validation.data;
      
      // Upload receipt to object storage if provided
      let receiptUrl: string | null = null;
      let receiptFileName: string | null = null;
      
      if (req.file) {
        const objectStorageService = new ObjectStorageService();
        receiptUrl = await objectStorageService.uploadPrivateFile(
          req.file.buffer,
          req.file.originalname,
          req.file.mimetype,
          `claims/${userId}`
        );
        receiptFileName = req.file.originalname;
      }
      
      // Get employee details
      const employee = await storage.getUser(userId);
      
      const claim = await storage.createClaim({
        userId: userId,
        employeeCode: employee?.employeeCode || null,
        employeeName: employee?.name || 'Unknown',
        claimType,
        amount: amount.toString(),
        description: description || null,
        receiptUrl,
        receiptFileName,
        claimMonth: parseInt(claimMonth),
        claimYear: parseInt(claimYear),
        status: 'pending',
      });
      
      res.json({ success: true, claim });
    } catch (error) {
      console.error("Submit claim error:", error);
      res.status(500).json({ message: "Failed to submit claim" });
    }
  });
  
  // Employee: Get my claims
  app.get("/api/claims", async (req: Request, res: Response) => {
    if (!req.session?.userId || req.session.isAdmin) {
      return res.status(401).json({ message: "User authentication required" });
    }
    
    try {
      const claims = await storage.getClaimsByUser(req.session.userId);
      res.json({ claims });
    } catch (error) {
      console.error("Get claims error:", error);
      res.status(500).json({ message: "Failed to fetch claims" });
    }
  });
  
  // Admin: Get all claims
  app.get("/api/admin/claims", requireAdmin, requireFullAdmin, async (req: Request, res: Response) => {
    try {
      const { year, month } = req.query;
      
      let claimsData;
      if (year && month) {
        claimsData = await storage.getClaimsByPeriod(
          parseInt(year as string),
          parseInt(month as string)
        );
      } else {
        claimsData = await storage.getAllClaims();
      }
      
      res.json({ claims: claimsData });
    } catch (error) {
      console.error("Get all claims error:", error);
      res.status(500).json({ message: "Failed to fetch claims" });
    }
  });
  
  // Admin: Get pending claims count
  app.get("/api/admin/claims/pending-count", requireAdmin, requireFullAdmin, async (req: Request, res: Response) => {
    try {
      const count = await storage.getPendingClaimsCount();
      res.json({ count });
    } catch (error) {
      console.error("Get pending claims count error:", error);
      res.status(500).json({ message: "Failed to fetch pending count" });
    }
  });
  
  // Admin: Get single claim
  app.get("/api/admin/claims/:id", requireAdmin, requireFullAdmin, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const claim = await storage.getClaim(id);
      
      if (!claim) {
        return res.status(404).json({ message: "Claim not found" });
      }
      
      res.json({ claim });
    } catch (error) {
      console.error("Get claim error:", error);
      res.status(500).json({ message: "Failed to fetch claim" });
    }
  });
  
  // Admin: Update claim status (approve/reject/reverse)
  app.patch("/api/admin/claims/:id", requireAdmin, requireWriteAccess, requireFullAdmin, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { status, reviewComments } = req.body;
      const adminUserId = req.session.userId;
      
      if (!status || !['approved', 'rejected', 'pending', 'processed'].includes(status)) {
        return res.status(400).json({ message: "Invalid status" });
      }
      
      // Get claim before updating for audit log
      const existingClaim = await storage.getClaim(id);
      if (!existingClaim) {
        return res.status(404).json({ message: "Claim not found" });
      }
      
      // For reversals, clear the reviewer info
      const updateData: any = {
        status,
        reviewComments: reviewComments || null,
      };
      
      if (status === 'pending') {
        // Reversal - clear reviewer info
        updateData.reviewedBy = null;
        updateData.reviewedAt = null;
      } else {
        // Approval/rejection - set reviewer info
        updateData.reviewedBy = adminUserId;
        updateData.reviewedAt = new Date();
      }
      
      const updatedClaim = await storage.updateClaim(id, updateData);
      
      // Log the action - handle master admin case
      let performedByName = "Master Admin";
      if (adminUserId !== "admin") {
        const admin = await storage.getUser(adminUserId!);
        performedByName = admin?.name || "Unknown Admin";
      }
      
      // Determine audit action - use 'reversed' when changing to pending from approved/rejected
      const auditAction = status === 'pending' ? 'reversed' : status;
      
      await storage.createClaimsAuditLog({
        claimId: id,
        userId: existingClaim.userId,
        employeeCode: existingClaim.employeeCode || null,
        employeeName: existingClaim.employeeName || null,
        claimType: existingClaim.claimType,
        amount: existingClaim.amount,
        description: existingClaim.description || null,
        claimMonth: existingClaim.claimMonth,
        claimYear: existingClaim.claimYear,
        action: auditAction,
        previousStatus: existingClaim.status,
        performedBy: adminUserId!,
        performedByName,
        comments: reviewComments || null,
      });
      
      res.json({ success: true, claim: updatedClaim });
    } catch (error) {
      console.error("Update claim error:", error);
      res.status(500).json({ message: "Failed to update claim" });
    }
  });
  
  // Admin: Delete claim with audit trail
  app.delete("/api/admin/claims/:id", requireAdmin, requireWriteAccess, requireFullAdmin, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { reason } = req.body;
      const adminUserId = req.session.userId;
      
      console.log("Delete claim request:", { id, reason, adminUserId });
      
      // Get claim before deleting for audit log
      const claim = await storage.getClaim(id);
      if (!claim) {
        return res.status(404).json({ message: "Claim not found" });
      }
      
      console.log("Found claim to delete:", claim);
      
      // For master admin, use "Master Admin" as the name
      let performedByName = "Master Admin";
      if (adminUserId !== "admin") {
        const admin = await storage.getUser(adminUserId!);
        performedByName = admin?.name || "Unknown Admin";
      }
      
      // Log the deletion first
      const auditLogData = {
        claimId: id,
        userId: claim.userId,
        employeeCode: claim.employeeCode || null,
        employeeName: claim.employeeName || null,
        claimType: claim.claimType,
        amount: claim.amount,
        description: claim.description || null,
        claimMonth: claim.claimMonth,
        claimYear: claim.claimYear,
        action: 'deleted',
        previousStatus: claim.status,
        performedBy: adminUserId!,
        performedByName,
        comments: reason || null,
      };
      
      console.log("Creating audit log:", auditLogData);
      
      try {
        await storage.createClaimsAuditLog(auditLogData);
        console.log("Audit log created successfully");
      } catch (auditError) {
        console.error("Failed to create audit log:", auditError);
        throw new Error("Failed to create audit log for deletion");
      }
      
      // Delete the claim
      await storage.deleteClaim(id);
      
      console.log("Claim deleted successfully");
      
      res.json({ success: true, message: "Claim deleted successfully" });
    } catch (error) {
      console.error("Delete claim error:", error);
      res.status(500).json({ message: "Failed to delete claim" });
    }
  });
  
  // Admin: Get claims audit log
  app.get("/api/admin/claims/audit-log", requireAdmin, requireFullAdmin, async (req: Request, res: Response) => {
    try {
      const { month, year } = req.query;
      
      const auditLogs = await storage.getClaimsAuditLogs(
        month ? parseInt(month as string) : undefined,
        year ? parseInt(year as string) : undefined
      );
      
      res.json(auditLogs);
    } catch (error) {
      console.error("Get claims audit log error:", error);
      res.status(500).json({ message: "Failed to fetch audit log" });
    }
  });
  
  // Get approved claims for payslip (accessible by admin or employee viewing own payslip)
  app.get("/api/payslip/claims", async (req: Request, res: Response) => {
    if (!req.session?.userId) {
      return res.status(401).json({ message: "Authentication required" });
    }
    
    try {
      const { userId, year, month } = req.query;
      const isAdmin = req.session.isAdmin;
      const sessionUserId = req.session.userId;
      
      if (!userId || !year || !month) {
        return res.status(400).json({ message: "userId, year, and month are required" });
      }
      
      // Employees can only view their own claims
      if (!isAdmin && userId !== sessionUserId) {
        return res.status(403).json({ message: "Access denied" });
      }
      
      const approvedClaims = await storage.getApprovedClaimsForPayslip(
        userId as string,
        parseInt(year as string),
        parseInt(month as string)
      );
      
      res.json({ claims: approvedClaims });
    } catch (error) {
      console.error("Get payslip claims error:", error);
      res.status(500).json({ message: "Failed to fetch claims" });
    }
  });

  // Get receipt file (stream private file) - accessible by employee owner or admin
  app.get("/api/claims/:id/receipt", async (req: Request, res: Response) => {
    if (!req.session?.userId) {
      return res.status(401).json({ message: "Authentication required" });
    }
    
    try {
      const { id } = req.params;
      const userId = req.session.userId;
      const isAdmin = req.session.isAdmin;
      
      const claim = await storage.getClaim(id);
      
      if (!claim) {
        return res.status(404).json({ message: "Claim not found" });
      }
      
      // Check if user is admin or the claim owner
      if (!isAdmin && claim.userId !== userId) {
        return res.status(403).json({ message: "Access denied" });
      }
      
      if (!claim.receiptUrl) {
        return res.status(404).json({ message: "No receipt attached" });
      }
      
      const objectStorageService = new ObjectStorageService();
      await objectStorageService.downloadObject(claim.receiptUrl, res);
    } catch (error) {
      console.error("Get receipt error:", error);
      res.status(500).json({ message: "Failed to get receipt" });
    }
  });

  const httpServer = createServer(app);

  return httpServer;
}
