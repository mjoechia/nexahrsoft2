import { useState, useMemo, useEffect } from "react";
import { toTitleCase } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Calendar, Clock, Users, ArrowLeft, Grid3X3, ChevronLeft, ChevronRight, Search, Plus, CalendarCheck, Trash2, History, FileText, MapPin, ExternalLink, AlertTriangle, CheckCircle2, MoreVertical, X, RefreshCw, Archive, ArchiveRestore, Download, Printer, Upload, FileSpreadsheet, Loader2, Edit } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Link, useSearch } from "wouter";
import ExcelJS from "exceljs";
import { AttendanceEditModal } from "@/components/AttendanceEditModal";
import type { AttendanceRecord, User, DailyAttendanceSummary, CompanySettings, AttendanceAdjustment } from "@shared/schema";

// NOTE: Geocoding is now handled server-side during clock-in/out
// Location text is stored in the database and displayed directly

// Helper function to round hours to nearest 0.5
function roundToHalf(value: number): number {
  return Math.round(value * 2) / 2;
}

// Helper function to format hours for display (always shows x.0 or x.5)
function formatHours(value: number): string {
  const rounded = roundToHalf(value);
  return rounded.toFixed(1);
}

// Helper function to calculate hours worked (to nearest 0.5 hour)
function calculateHours(clockInTime: Date | string, clockOutTime: Date | string | null): number {
  if (!clockOutTime) return 0;
  
  const clockIn = new Date(clockInTime);
  const clockOut = new Date(clockOutTime);
  const diffMs = clockOut.getTime() - clockIn.getTime();
  const diffHours = diffMs / (1000 * 60 * 60);
  
  // Round to nearest 0.5 hour
  return roundToHalf(diffHours);
}

// Helper function to format time in Singapore timezone
function formatTime(date: Date | string | null): string {
  if (!date) return "-";
  const d = new Date(date);
  return d.toLocaleTimeString('en-US', { 
    hour: '2-digit', 
    minute: '2-digit',
    timeZone: 'Asia/Singapore' // Always display in Singapore timezone
  });
}

// Helper function to format date
function formatDate(date: Date | string): string {
  const d = new Date(date);
  return d.toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' });
}


// Helper to get date range for period (using local dates, not UTC)
function getDateRange(period: 'daily' | 'weekly' | 'monthly'): { startDate: string; endDate: string } {
  const now = new Date();
  // Use local date format YYYY-MM-DD
  const formatLocalDate = (d: Date) => {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };
  
  const endDate = formatLocalDate(now);
  let startDate: string;

  if (period === 'daily') {
    startDate = endDate;
  } else if (period === 'weekly') {
    const weekAgo = new Date(now);
    weekAgo.setDate(weekAgo.getDate() - 7);
    startDate = formatLocalDate(weekAgo);
  } else {
    // monthly
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    startDate = formatLocalDate(monthStart);
  }

  return { startDate, endDate };
}

// Get all days in a month
function getDaysInMonth(year: number, month: number): Date[] {
  const days: Date[] = [];
  const date = new Date(year, month, 1);
  while (date.getMonth() === month) {
    days.push(new Date(date));
    date.setDate(date.getDate() + 1);
  }
  return days;
}

// Locale-safe date key formatter (YYYY-MM-DD) avoiding timezone shifts
function getDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Get date key from a date string or Date object (handles API dates)
// IMPORTANT: Date strings like "2025-12-25" are parsed as UTC by JavaScript
// but we need to treat them as local dates for display purposes
function normalizeRecordDateKey(dateValue: Date | string): string {
  if (typeof dateValue === 'string') {
    // If it's already in YYYY-MM-DD format, return it directly
    // This avoids timezone conversion issues
    const match = dateValue.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) {
      return `${match[1]}-${match[2]}-${match[3]}`;
    }
  }
  // For Date objects or other formats, extract local date components
  const d = new Date(dateValue);
  return getDateKey(d);
}

// Get color class based on hours worked and open sessions
function getHeatmapColor(hours: number, hasOpenSession?: boolean): string {
  if (hasOpenSession) return "bg-blue-500 dark:bg-blue-400"; // Blue for in-progress
  if (hours >= 8) return "bg-green-600 dark:bg-green-500";
  if (hours >= 6) return "bg-green-400 dark:bg-green-400";
  if (hours >= 4) return "bg-yellow-400 dark:bg-yellow-500";
  if (hours > 0) return "bg-orange-400 dark:bg-orange-500";
  return "bg-muted";
}

// Get inline style for printing (browsers print inline styles more reliably)
// Covers all cell states: hours worked, in-progress, absent, weekend, and future
function getHeatmapInlineStyle(
  hours: number, 
  hasOpenSession: boolean, 
  isWeekend: boolean, 
  isFuture: boolean,
  hasRecord: boolean
): React.CSSProperties {
  // Future dates - light gray
  if (isFuture) return { backgroundColor: '#f3f4f6' }; // Gray-100
  // Has active session (in progress)
  if (hasOpenSession && hours === 0) return { backgroundColor: '#3b82f6', color: '#fff' }; // Blue
  // Hours worked - color coded by duration
  if (hours >= 8) return { backgroundColor: '#16a34a', color: '#fff' }; // Green-600
  if (hours >= 6) return { backgroundColor: '#4ade80', color: '#000' }; // Green-400
  if (hours >= 4) return { backgroundColor: '#facc15', color: '#000' }; // Yellow-400
  if (hours > 0) return { backgroundColor: '#fb923c', color: '#fff' }; // Orange-400
  // Weekend with no record
  if (isWeekend) return { backgroundColor: '#e5e7eb' }; // Gray-200
  // Regular day with no record (absent)
  return { backgroundColor: '#f9fafb' }; // Gray-50
}

// Get text color based on background
function getHeatmapTextColor(hours: number): string {
  if (hours > 0) return "text-white";
  return "text-muted-foreground";
}

export default function AdminAttendancePage() {
  // Check if navigated from payroll page for "Back to Payroll Reports" button
  const searchString = useSearch();
  const urlParams = new URLSearchParams(searchString);
  const fromPayroll = urlParams.get('from') === 'payroll';
  
  // Default to heatmap view to prevent geocoding on initial page load
  const [viewMode, setViewMode] = useState<'today' | 'orphaned' | 'heatmap' | 'details'>('heatmap');
  const [heatmapViewType, setHeatmapViewType] = useState<'week' | 'month'>('week');
  const [heatmapMonth, setHeatmapMonth] = useState(() => {
    // Initialize to previous month if we're in the first week of the month
    // This provides better UX as most attendance data is in the previous month
    const now = new Date();
    const dayOfMonth = now.getDate();
    if (dayOfMonth <= 7) {
      // First week - default to previous month
      const prevMonth = now.getMonth() === 0 ? 11 : now.getMonth() - 1;
      const prevYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
      return { year: prevYear, month: prevMonth };
    }
    return { year: now.getFullYear(), month: now.getMonth() };
  });
  // For week view - track custom date range (up to 7 days)
  const [heatmapWeekStart, setHeatmapWeekStart] = useState(() => {
    const now = new Date();
    const dayOfWeek = now.getDay();
    const diff = now.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1); // Adjust for Monday start
    const weekStart = new Date(now.setDate(diff));
    weekStart.setHours(0, 0, 0, 0);
    return weekStart;
  });
  const [heatmapWeekEnd, setHeatmapWeekEnd] = useState(() => {
    const now = new Date();
    const dayOfWeek = now.getDay();
    const diff = now.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1);
    const weekStart = new Date(now.setDate(diff));
    weekStart.setHours(0, 0, 0, 0);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    return weekEnd;
  });
  const [useCustomRange, setUseCustomRange] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState("all");
  // Selected date for clock-ins view (defaults to today)
  const [clockInsDate, setClockInsDate] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  });
  
  // Add attendance dialog state
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [addSearchQuery, setAddSearchQuery] = useState("");
  const [selectedEmployee, setSelectedEmployee] = useState<User | null>(null);
  const [selectedDate, setSelectedDate] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  });
  const [clockInTime, setClockInTime] = useState("09:00");
  const [clockOutTime, setClockOutTime] = useState("");
  
  // End clock-in dialog state
  const [showEndClockInDialog, setShowEndClockInDialog] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState<AttendanceRecord | null>(null);
  const [endClockOutTime, setEndClockOutTime] = useState("18:00");
  
  // Delete confirmation dialog state
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [recordToDelete, setRecordToDelete] = useState<AttendanceRecord | null>(null);
  
  // State to track which location buttons have been expanded (show map link)
  const [expandedLocations, setExpandedLocations] = useState<Set<string>>(new Set());
  
  // Heatmap selection state for archive functionality
  const [selectedHeatmapUsers, setSelectedHeatmapUsers] = useState<Set<string>>(new Set());
  const [showUnarchiveModal, setShowUnarchiveModal] = useState(false);
  const [selectedArchivedUsers, setSelectedArchivedUsers] = useState<Set<string>>(new Set());
  const [showDeleteEmployeeDialog, setShowDeleteEmployeeDialog] = useState(false);
  const [employeeToDelete, setEmployeeToDelete] = useState<User | null>(null);
  const [deleteReason, setDeleteReason] = useState("");
  const [showDeletionLogs, setShowDeletionLogs] = useState(false);
  const [isPrinting, setIsPrinting] = useState(false);
  const [showDailyReport, setShowDailyReport] = useState(false);
  
  // Import attendance modal state
  const [showImportModal, setShowImportModal] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importPreviewData, setImportPreviewData] = useState<{
    employeeName: string;
    employeeCode: string | null;
    department: string | null;
    date: string;
    hours: number;
    status: 'pending' | 'matched' | 'not_found';
    matchedUserId?: string;
  }[]>([]);
  const [importOverwrite, setImportOverwrite] = useState(false);
  const [importStep, setImportStep] = useState<'upload' | 'preview' | 'importing' | 'results'>('upload');
  const [importResults, setImportResults] = useState<{
    success: boolean;
    employeeName: string;
    date: string;
    hours: number;
    error?: string;
    action?: string;
  }[]>([]);
  
  // Attendance edit modal state
  const [showEditModal, setShowEditModal] = useState(false);
  const [editModalData, setEditModalData] = useState<{
    userId: string;
    userName: string;
    date: string;
    actualHours: number;
  } | null>(null);
  
  const { toast } = useToast();

  // Fetch session to check if user is nexaadmin (master admin) or view-only admin
  const { data: sessionData } = useQuery<{ authenticated: boolean; isAdmin: boolean; isViewOnlyAdmin?: boolean; isAttendanceViewAdmin?: boolean; user?: { id: string; name: string; email: string } }>({
    queryKey: ['/api/auth/session'],
  });
  
  // Check if current user is nexaadmin (master admin has user.id === "admin")
  const isNexaAdmin = sessionData?.user?.id === "admin";
  const isViewOnlyAdmin = sessionData?.isViewOnlyAdmin === true;
  const isAttendanceViewAdmin = sessionData?.isAttendanceViewAdmin === true;
  
  // Combined read-only flag: both view-only admins and attendance view admins cannot edit
  const cannotEdit = isViewOnlyAdmin || isAttendanceViewAdmin;
  
  // Check if current admin is a super admin (can archive/unarchive employees)
  const { data: superAdminData } = useQuery<{ isSuperAdmin: boolean }>({
    queryKey: ['/api/admin/is-super-admin'],
  });
  const isSuperAdmin = superAdminData?.isSuperAdmin === true;

  // Fetch all users
  const { data: usersData } = useQuery<User[]>({
    queryKey: ['/api/admin/users'],
  });
  
  // Fetch archived users for unarchive modal
  const { data: archivedUsersData, isLoading: archivedUsersLoading } = useQuery<User[]>({
    queryKey: ['/api/admin/users/archived'],
    enabled: showUnarchiveModal,
  });
  const archivedUsers = archivedUsersData || [];

  const { data: deletionLogsData, isLoading: deletionLogsLoading } = useQuery<any[]>({
    queryKey: ['/api/admin/employee-deletion-logs'],
    enabled: showDeletionLogs,
  });
  const deletionLogs = deletionLogsData || [];

  // Fetch attendance records for selected clock-ins date (only when viewing Clock-ins tab)
  const { data: clockInsRecordsData, isLoading: clockInsLoading } = useQuery<{ records: AttendanceRecord[] }>({
    queryKey: ['/api/admin/attendance/records', { startDate: clockInsDate, endDate: clockInsDate }],
    enabled: viewMode === 'today', // Only fetch when viewing Clock-ins tab
  });

  // Fetch attendance summaries for heatmap (week or month) - use local dates
  // Week view now supports custom date range (up to 7 days)
  const heatmapStartDate = heatmapViewType === 'week' 
    ? getDateKey(heatmapWeekStart)
    : getDateKey(new Date(heatmapMonth.year, heatmapMonth.month, 1));
  const heatmapEndDate = heatmapViewType === 'week'
    ? getDateKey(heatmapWeekEnd)
    : getDateKey(new Date(heatmapMonth.year, heatmapMonth.month + 1, 0));
  
  // WEEK VIEW: Always use raw attendance records for reliability
  // MONTH VIEW: Use pre-calculated summaries ONLY (no raw records fallback to prevent timeouts)
  
  // Only fetch summaries for month view
  const { data: heatmapSummariesData, isLoading: heatmapSummariesLoading, refetch: refetchHeatmapSummaries } = useQuery<{ summaries: DailyAttendanceSummary[] }>({
    queryKey: ['/api/admin/attendance/summaries', { startDate: heatmapStartDate, endDate: heatmapEndDate }],
    staleTime: 0,
    enabled: heatmapViewType === 'month', // Only fetch summaries for month view
  });
  
  // Only fetch raw attendance records for week view (NOT for month view to prevent timeouts)
  const { data: heatmapRecordsData, isLoading: heatmapRecordsLoading, refetch: refetchHeatmapRawRecords } = useQuery<{ records: AttendanceRecord[] }>({
    queryKey: ['/api/admin/attendance/records', { startDate: heatmapStartDate, endDate: heatmapEndDate }],
    staleTime: 0,
    enabled: heatmapViewType === 'week', // Only fetch records for week view
  });
  
  // Loading state depends on view type
  const heatmapLoading = heatmapViewType === 'week' 
    ? heatmapRecordsLoading 
    : heatmapSummariesLoading;
  
  const refetchHeatmapRecords = () => {
    if (heatmapViewType === 'month') {
      refetchHeatmapSummaries();
    } else {
      refetchHeatmapRawRecords();
    }
  };
  
  // Sync month with week when switching from week to month view
  // This ensures the month view shows the same period the user was viewing in week view
  useEffect(() => {
    if (heatmapViewType === 'month') {
      // When switching to month view, use the month of the week start date
      const weekMonth = heatmapWeekStart.getMonth();
      const weekYear = heatmapWeekStart.getFullYear();
      setHeatmapMonth(prev => {
        // Only update if different to avoid unnecessary re-renders
        if (prev.month !== weekMonth || prev.year !== weekYear) {
          return { year: weekYear, month: weekMonth };
        }
        return prev;
      });
    }
  }, [heatmapViewType, heatmapWeekStart]);
  
  // Refetch when switching between week/month view
  useEffect(() => {
    if (viewMode === 'heatmap') {
      refetchHeatmapRecords();
    }
  }, [heatmapViewType, heatmapStartDate, heatmapEndDate, viewMode]);

  // Fetch audit logs for attendance changes (for details and audit views)
  type AuditLogEntry = {
    id: number;
    action: string;
    tableName: string;
    recordId: string | null;
    fieldName: string | null;
    oldValue: string | null;
    newValue: string | null;
    changedBy: string | null;
    changedAt: Date;
    userName: string | null;
    employeeCode: string | null;
  };
  const { data: auditLogsData, isLoading: auditLoading } = useQuery<{ logs: AuditLogEntry[] }>({
    queryKey: ['/api/admin/attendance/audit-logs'],
    enabled: viewMode === 'details',
  });
  const auditLogs = auditLogsData?.logs || [];

  // Fetch orphaned attendance sessions (older than 24 hours without clock-out)
  const { data: orphanedSessionsData, isLoading: orphanedLoading } = useQuery<{ records: AttendanceRecord[] }>({
    queryKey: ['/api/admin/attendance/orphaned'],
    enabled: viewMode === 'orphaned',
  });
  const orphanedSessions = orphanedSessionsData?.records || [];
  
  // Fetch attendance adjustments for heatmap date range
  const { data: adjustmentsData, refetch: refetchAdjustments } = useQuery<{ adjustments: AttendanceAdjustment[] }>({
    queryKey: ['/api/admin/attendance/adjustments', { startDate: heatmapStartDate, endDate: heatmapEndDate }],
    staleTime: 0,
    enabled: viewMode === 'heatmap',
  });
  
  // Build a map of adjustments keyed by `${userId}-${date}` for quick lookup
  const adjustmentsMap = useMemo(() => {
    const map = new Map<string, AttendanceAdjustment>();
    if (adjustmentsData?.adjustments) {
      adjustmentsData.adjustments.forEach(adj => {
        const key = `${adj.userId}-${adj.date}`;
        map.set(key, adj);
      });
    }
    return map;
  }, [adjustmentsData]);

  // Fetch employee monthly remarks for current heatmap month
  type EmployeeMonthlyRemark = {
    id: string;
    userId: string;
    year: number;
    month: number;
    remark: string | null;
    createdBy: string;
    createdAt: Date;
    updatedAt: Date;
  };
  const { data: remarksData, refetch: refetchRemarks } = useQuery<EmployeeMonthlyRemark[]>({
    queryKey: ['/api/admin/attendance/remarks', { year: heatmapMonth.year, month: heatmapMonth.month }],
    staleTime: 0,
    enabled: viewMode === 'heatmap',
  });
  
  // Build a map of remarks keyed by userId for quick lookup
  const remarksMap = useMemo(() => {
    const map = new Map<string, string>();
    if (remarksData) {
      remarksData.forEach(r => {
        if (r.remark) {
          map.set(r.userId, r.remark);
        }
      });
    }
    return map;
  }, [remarksData]);
  
  // State for editing remarks
  const [editingRemarkUserId, setEditingRemarkUserId] = useState<string | null>(null);
  const [editingRemarkValue, setEditingRemarkValue] = useState("");

  // State for selected orphaned records
  const [selectedOrphanedIds, setSelectedOrphanedIds] = useState<Set<string>>(new Set());
  const [bulkClockOutTime, setBulkClockOutTime] = useState("18:00");

  const users = usersData || [];
  const heatmapSummaries = heatmapSummariesData?.summaries || [];
  const heatmapRawRecords = heatmapRecordsData?.records || [];
  const clockInsRecords = clockInsRecordsData?.records || [];
  
  
  // Check if selected date is today
  const todayDate = getDateKey(new Date());
  const isViewingToday = clockInsDate === todayDate;

  // Get unique departments for filter
  const departments = useMemo(() => {
    const depts = new Set(users.map(u => u.department).filter(Boolean));
    return Array.from(depts).sort();
  }, [users]);

  // Filter users for heatmap (exclude archived and resigned users)
  const filteredUsers = useMemo(() => {
    return users
      .filter(u => !u.id.includes('admin'))
      .filter(u => !u.isArchived) // Exclude archived users
      .filter(u => !u.resignDate) // Exclude resigned users
      .filter(u => {
        if (searchQuery) {
          const query = searchQuery.toLowerCase();
          return (
            u.name?.toLowerCase().includes(query) ||
            u.email?.toLowerCase().includes(query) ||
            u.employeeCode?.toLowerCase().includes(query)
          );
        }
        return true;
      })
      .filter(u => {
        if (departmentFilter !== "all") {
          return u.department === departmentFilter;
        }
        return true;
      })
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }, [users, searchQuery, departmentFilter]);

  // Days in selected period for heatmap (week or month)
  // Week view now supports custom date range (up to 7 days)
  const heatmapDays = useMemo(() => {
    if (heatmapViewType === 'week') {
      const days: Date[] = [];
      const rangeDays = Math.round((heatmapWeekEnd.getTime() - heatmapWeekStart.getTime()) / (24 * 60 * 60 * 1000)) + 1;
      for (let i = 0; i < rangeDays; i++) {
        const day = new Date(heatmapWeekStart);
        day.setDate(heatmapWeekStart.getDate() + i);
        days.push(day);
      }
      return days;
    } else {
      return getDaysInMonth(heatmapMonth.year, heatmapMonth.month);
    }
  }, [heatmapViewType, heatmapWeekStart, heatmapWeekEnd, heatmapMonth]);

  // Aggregated data type for heatmap cells
  type AggregatedAttendance = {
    totalHours: number;
    recordCount: number;
    hasOpenSession: boolean; // true if any record is missing clock-out
    openSessionRecordId: string | null; // record ID for the open session (for quick end clock-in)
    employeeName: string | null;
    employeeCode: string | null;
  };

  // Helper function to build map from raw attendance records
  const buildMapFromRawRecords = (records: AttendanceRecord[]): Record<string, Record<string, AggregatedAttendance>> => {
    const map: Record<string, Record<string, AggregatedAttendance>> = {};
    records.forEach(record => {
      if (!map[record.userId]) {
        map[record.userId] = {};
      }
      const dateKey = normalizeRecordDateKey(record.date);
      
      if (!map[record.userId][dateKey]) {
        map[record.userId][dateKey] = {
          totalHours: 0,
          recordCount: 0,
          hasOpenSession: false,
          openSessionRecordId: null,
          employeeName: null,
          employeeCode: null,
        };
      }
      
      // Aggregate hours
      const hours = record.clockOutTime 
        ? calculateHours(record.clockInTime, record.clockOutTime)
        : 0;
      map[record.userId][dateKey].totalHours += hours;
      map[record.userId][dateKey].recordCount += 1;
      
      // Check for open sessions (no clock-out) and store the record ID
      if (!record.clockOutTime) {
        map[record.userId][dateKey].hasOpenSession = true;
        map[record.userId][dateKey].openSessionRecordId = record.id;
      }
    });
    return map;
  };

  // Create a map of userId -> date -> aggregated attendance data for heatmap
  // WEEK VIEW: Always uses raw attendance records for reliability
  // MONTH VIEW: Uses pre-calculated summaries ONLY (no raw records fallback to prevent timeouts)
  const heatmapDataMap = useMemo(() => {
    // Guard: Only use data if queries have loaded (not in loading state)
    // This prevents stale data from a different date range being displayed
    if (heatmapLoading) {
      return {};
    }
    
    // WEEK VIEW: Always use raw records directly
    if (heatmapViewType === 'week') {
      return buildMapFromRawRecords(heatmapRawRecords);
    }
    
    // MONTH VIEW: Use summaries only (no fallback to raw records to prevent timeouts on large datasets)
    const map: Record<string, Record<string, AggregatedAttendance>> = {};
    
    // Use pre-calculated summaries for month view
    heatmapSummaries.forEach(summary => {
      if (!map[summary.userId]) {
        map[summary.userId] = {};
      }
      const dateKey = summary.date;
      
      map[summary.userId][dateKey] = {
        totalHours: summary.totalHoursWorked || 0,
        recordCount: summary.totalClockIns,
        hasOpenSession: summary.status === 'partial',
        openSessionRecordId: null, // Not available in summaries - use week view for quick end
        employeeName: summary.employeeName,
        employeeCode: summary.employeeCode,
      };
    });
    
    return map;
  }, [heatmapViewType, heatmapSummaries, heatmapRawRecords, heatmapLoading]);


  // Filter employees for add attendance dialog (exclude view-only admins only)
  // Admins can also be employees who need attendance tracking
  const addDialogFilteredEmployees = useMemo(() => {
    if (!addSearchQuery.trim()) return [];
    const query = addSearchQuery.toLowerCase();
    return users
      .filter(u => u.role !== "viewonly_admin")
      .filter(u => !u.isArchived)
      .filter(u => 
        u.name?.toLowerCase().includes(query) ||
        u.email?.toLowerCase().includes(query) ||
        u.employeeCode?.toLowerCase().includes(query)
      )
      .slice(0, 10);
  }, [users, addSearchQuery]);

  // Get today's date string
  const todayStr = new Date().toISOString().split('T')[0];

  // Check if employee already has attendance today (using heatmapDataMap which has fallback logic)
  const employeeHasAttendanceToday = (userId: string) => {
    return !!heatmapDataMap[userId]?.[todayStr];
  };

  // Check if employee already has attendance on selected date
  const employeeHasAttendanceOnDate = (userId: string, date: string) => {
    return !!heatmapDataMap[userId]?.[date];
  };

  // Add attendance mutation
  const addAttendanceMutation = useMutation({
    mutationFn: async (data: { userId: string; date: string; clockInTime: string; clockOutTime?: string }) => {
      const response = await apiRequest("POST", "/api/admin/attendance/add", data);
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Attendance Added",
        description: data.message || "Attendance record created successfully",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/attendance/records'] });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/attendance/summaries'] });
      setShowAddDialog(false);
      setSelectedEmployee(null);
      setAddSearchQuery("");
      setClockInTime("09:00");
      setClockOutTime("");
      // Reset date to today
      const now = new Date();
      setSelectedDate(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`);
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to add attendance",
        variant: "destructive",
      });
    },
  });

  const handleAddAttendance = () => {
    if (!selectedEmployee || !selectedDate) return;
    
    addAttendanceMutation.mutate({
      userId: selectedEmployee.id,
      date: selectedDate,
      clockInTime,
      clockOutTime: clockOutTime || undefined,
    });
  };

  // End clock-in mutation (nexaadmin only)
  const endClockInMutation = useMutation({
    mutationFn: async (data: { recordId: string; clockOutTime: string }) => {
      const response = await apiRequest("POST", "/api/admin/attendance/end-clockin", data);
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Clock-out Set",
        description: data.message || "Clock-out time has been recorded",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/attendance/records'] });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/attendance/orphaned'] });
      setShowEndClockInDialog(false);
      setSelectedRecord(null);
      setEndClockOutTime("18:00");
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to end clock-in",
        variant: "destructive",
      });
    },
  });

  const handleEndClockIn = () => {
    if (!selectedRecord) return;
    
    endClockInMutation.mutate({
      recordId: selectedRecord.id,
      clockOutTime: endClockOutTime,
    });
  };

  // Delete attendance mutation (nexaadmin only)
  const deleteAttendanceMutation = useMutation({
    mutationFn: async (recordId: string) => {
      const response = await apiRequest("DELETE", `/api/admin/attendance/${recordId}`);
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Attendance Deleted",
        description: data.message || "Attendance record has been deleted",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/attendance/records'] });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/attendance/orphaned'] });
      setShowDeleteDialog(false);
      setRecordToDelete(null);
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete attendance record",
        variant: "destructive",
      });
    },
  });

  const handleDeleteAttendance = () => {
    if (!recordToDelete || !isNexaAdmin) return;
    deleteAttendanceMutation.mutate(recordToDelete.id);
  };

  // Bulk close orphaned sessions mutation
  const bulkCloseOrphanedMutation = useMutation({
    mutationFn: async (data: { recordIds: string[]; clockOutTime?: string }) => {
      const response = await apiRequest("POST", "/api/admin/attendance/bulk-close-orphaned", data);
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Sessions Closed",
        description: data.message || "Orphaned sessions have been closed",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/attendance/orphaned'] });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/attendance/records'] });
      setSelectedOrphanedIds(new Set());
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to close orphaned sessions",
        variant: "destructive",
      });
    },
  });

  const handleBulkCloseOrphaned = () => {
    if (selectedOrphanedIds.size === 0) return;
    bulkCloseOrphanedMutation.mutate({
      recordIds: Array.from(selectedOrphanedIds),
      clockOutTime: bulkClockOutTime || undefined,
    });
  };

  // Backfill location text for records with coordinates but no address
  const backfillLocationsMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/admin/attendance/backfill-locations", {});
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Locations Updated",
        description: data.message || `Updated ${data.updatedCount} records with location data`,
      });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/attendance/records'] });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update locations",
        variant: "destructive",
      });
    },
  });

  // Resolve location for a single record (on-demand geocoding)
  const [resolvingLocationId, setResolvingLocationId] = useState<string | null>(null);
  const resolveLocationMutation = useMutation({
    mutationFn: async (data: { recordId: string; locationType: "in" | "out" }) => {
      const response = await apiRequest("POST", "/api/admin/attendance/resolve-location", data);
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Location Resolved",
        description: data.address || "Address updated successfully",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/attendance/records'] });
      setResolvingLocationId(null);
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to resolve location",
        variant: "destructive",
      });
      setResolvingLocationId(null);
    },
  });

  const handleResolveLocation = (recordId: string, locationType: "in" | "out") => {
    setResolvingLocationId(`${recordId}-${locationType}`);
    resolveLocationMutation.mutate({ recordId, locationType });
  };

  // Regenerate summaries mutation (for populating month view data)
  const regenerateSummariesMutation = useMutation({
    mutationFn: async (data: { startDate: string; endDate: string }) => {
      const response = await apiRequest("POST", "/api/admin/attendance/recalculate-summaries", data);
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Summaries Regenerated",
        description: data.message || `Processed ${data.processedDays} days, ${data.totalProcessed} summaries`,
      });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/attendance/summaries'] });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to regenerate summaries",
        variant: "destructive",
      });
    },
  });

  const handleRegenerateSummaries = () => {
    regenerateSummariesMutation.mutate({
      startDate: heatmapStartDate,
      endDate: heatmapEndDate,
    });
  };
  
  // Archive users mutation
  const archiveUsersMutation = useMutation({
    mutationFn: async (userIds: string[]) => {
      const response = await apiRequest("POST", "/api/admin/users/archive", { userIds });
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Users Archived",
        description: data.message || "Selected users have been archived",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/users'] });
      setSelectedHeatmapUsers(new Set());
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to archive users",
        variant: "destructive",
      });
    },
  });
  
  // Unarchive users mutation
  const unarchiveUsersMutation = useMutation({
    mutationFn: async (userIds: string[]) => {
      const response = await apiRequest("POST", "/api/admin/users/unarchive", { userIds });
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Users Unarchived",
        description: data.message || "Selected users have been unarchived",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/users'] });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/users/archived'] });
      setSelectedArchivedUsers(new Set());
      setShowUnarchiveModal(false);
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to unarchive users",
        variant: "destructive",
      });
    },
  });
  
  const deleteEmployeeMutation = useMutation({
    mutationFn: async ({ userId, reason }: { userId: string; reason?: string }) => {
      const response = await apiRequest("POST", "/api/admin/users/delete", { userId, reason });
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Employee Deleted",
        description: data.message || "Employee has been permanently deleted",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/users'] });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/users/archived'] });
      setShowDeleteEmployeeDialog(false);
      setEmployeeToDelete(null);
      setDeleteReason("");
      setSelectedHeatmapUsers(new Set());
      setSelectedArchivedUsers(new Set());
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete employee",
        variant: "destructive",
      });
    },
  });

  // Import attendance mutation
  const importAttendanceMutation = useMutation({
    mutationFn: async (data: { records: typeof importPreviewData, overwriteExisting: boolean }) => {
      const response = await apiRequest("POST", "/api/admin/attendance/import", {
        records: data.records.map(r => ({
          employeeName: r.employeeName,
          employeeCode: r.employeeCode,
          department: r.department,
          date: r.date,
          hours: r.hours,
        })),
        overwriteExisting: data.overwriteExisting,
      });
      return response.json();
    },
    onSuccess: (data) => {
      setImportResults(data.results);
      setImportStep('results');
      toast({
        title: "Import Complete",
        description: data.message,
      });
      // Refresh attendance data
      queryClient.invalidateQueries({ queryKey: ['/api/admin/attendance/records'] });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/attendance/summaries'] });
    },
    onError: (error: Error) => {
      toast({
        title: "Import Failed",
        description: error.message || "Failed to import attendance data",
        variant: "destructive",
      });
      setImportStep('preview');
    },
  });
  
  // Save employee monthly remark mutation
  const saveRemarkMutation = useMutation({
    mutationFn: async (data: { userId: string; year: number; month: number; remark: string | null }) => {
      const response = await apiRequest("POST", "/api/admin/attendance/remarks", data);
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Remark Saved",
        description: "Employee remark has been saved",
      });
      setEditingRemarkUserId(null);
      refetchRemarks();
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to save remark",
        variant: "destructive",
      });
    },
  });
  
  // Parse Excel file for import
  const parseImportFile = async (file: File) => {
    const workbook = new ExcelJS.Workbook();
    const arrayBuffer = await file.arrayBuffer();
    await workbook.xlsx.load(arrayBuffer);
    
    const worksheet = workbook.worksheets[0];
    if (!worksheet) {
      throw new Error("No worksheet found in Excel file");
    }
    
    const records: typeof importPreviewData = [];
    const allUsersLower = new Map((usersData || []).map(u => [u.name.toLowerCase().trim(), u]));
    const allUsersCodeLower = new Map((usersData || []).filter(u => u.employeeCode).map(u => [u.employeeCode!.toLowerCase().trim(), u]));
    
    // Find header row (row with "Employee Name" or "S/N")
    let headerRowIndex = 1;
    let dateColumns: { colIndex: number; date: Date }[] = [];
    
    worksheet.eachRow((row, rowNumber) => {
      const cellValue = row.getCell(1).value?.toString()?.toLowerCase() || '';
      if (cellValue === 's/n' || cellValue === 'sn' || cellValue.includes('employee')) {
        headerRowIndex = rowNumber;
        return;
      }
    });
    
    // Parse header row to find date columns
    const headerRow = worksheet.getRow(headerRowIndex);
    const titleRow = worksheet.getRow(1);
    
    // Extract month/year from title row if available
    // Supports formats:
    // - "Attendance Report - Dec 2025"
    // - "Attendance Report - Dec 1 to Dec 9, 2025"
    // - "Attendance Report - December 2025"
    let targetYear = new Date().getFullYear();
    let targetMonth = new Date().getMonth();
    
    const titleValue = titleRow.getCell(1).value?.toString() || '';
    const monthNames = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
    
    // Try multiple patterns for month/year extraction
    // Pattern 1: "Dec 2025" or "December 2025" (standard month year)
    let monthMatch = titleValue.match(/\b([A-Za-z]+)\s+(\d{4})\b/);
    
    // Pattern 2: "Dec 1 to Dec 9, 2025" (date range with year at end)
    if (!monthMatch || !monthNames.includes(monthMatch[1].toLowerCase().slice(0, 3))) {
      const rangeMatch = titleValue.match(/\b([A-Za-z]+)\s+\d+.*?(\d{4})\b/);
      if (rangeMatch) {
        monthMatch = rangeMatch;
      }
    }
    
    // Pattern 3: Look for any month name followed later by a year
    if (!monthMatch || !monthNames.includes(monthMatch[1].toLowerCase().slice(0, 3))) {
      const monthOnly = titleValue.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/i);
      const yearOnly = titleValue.match(/\b(20\d{2})\b/);
      if (monthOnly && yearOnly) {
        monthMatch = [titleValue, monthOnly[1], yearOnly[1]];
      }
    }
    
    if (monthMatch) {
      const monthName = monthMatch[1].toLowerCase().slice(0, 3);
      const monthIndex = monthNames.indexOf(monthName);
      if (monthIndex !== -1) {
        targetMonth = monthIndex;
        targetYear = parseInt(monthMatch[2]);
      }
    }
    
    // Find date columns (columns with numbers 1-31 in header)
    headerRow.eachCell((cell, colNumber) => {
      if (colNumber > 4) { // Skip S/N, Employee Name, Employee Code, Department
        const value = cell.value;
        if (typeof value === 'number' && value >= 1 && value <= 31) {
          const date = new Date(targetYear, targetMonth, value);
          dateColumns.push({ colIndex: colNumber, date });
        }
      }
    });
    
    // Parse data rows (start from row after header)
    const dataStartRow = headerRowIndex + 2; // Skip day-of-week row
    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber < dataStartRow) return;
      
      const snValue = row.getCell(1).value;
      // Skip if S/N is not a number (likely header or empty row)
      if (typeof snValue !== 'number') return;
      
      const employeeName = row.getCell(2).value?.toString()?.trim() || '';
      const employeeCode = row.getCell(3).value?.toString()?.trim() || null;
      const department = row.getCell(4).value?.toString()?.trim() || null;
      
      if (!employeeName) return;
      
      // Find matching user
      let matchedUser = null;
      if (employeeCode) {
        matchedUser = allUsersCodeLower.get(employeeCode.toLowerCase().trim());
      }
      if (!matchedUser) {
        matchedUser = allUsersLower.get(employeeName.toLowerCase().trim());
      }
      
      // Extract hours for each date column
      dateColumns.forEach(({ colIndex, date }) => {
        const cellValue = row.getCell(colIndex).value;
        let hours = 0;
        
        if (typeof cellValue === 'number') {
          hours = cellValue;
        } else if (cellValue) {
          const parsed = parseFloat(cellValue.toString());
          if (!isNaN(parsed)) hours = parsed;
        }
        
        if (hours > 0) { // Only include non-zero hours
          const dateKey = getDateKey(date);
          records.push({
            employeeName,
            employeeCode,
            department,
            date: dateKey,
            hours,
            status: matchedUser ? 'matched' : 'not_found',
            matchedUserId: matchedUser?.id,
          });
        }
      });
    });
    
    return records;
  };
  
  // Handle file upload
  const handleImportFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    setImportFile(file);
    
    try {
      const records = await parseImportFile(file);
      setImportPreviewData(records);
      setImportStep('preview');
    } catch (error: any) {
      toast({
        title: "Error Parsing File",
        description: error.message || "Failed to parse the Excel file",
        variant: "destructive",
      });
    }
  };
  
  // Execute import - only send matched records
  const executeImport = () => {
    setImportStep('importing');
    const matchedRecords = importPreviewData.filter(r => r.status === 'matched');
    importAttendanceMutation.mutate({
      records: matchedRecords,
      overwriteExisting: importOverwrite,
    });
  };
  
  // Reset import modal
  const resetImportModal = () => {
    setShowImportModal(false);
    setImportFile(null);
    setImportPreviewData([]);
    setImportOverwrite(false);
    setImportStep('upload');
    setImportResults([]);
  };
  
  // Handle archive selected users
  const handleArchiveSelected = () => {
    if (selectedHeatmapUsers.size === 0) return;
    archiveUsersMutation.mutate(Array.from(selectedHeatmapUsers));
  };
  
  // Handle unarchive selected users
  const handleUnarchiveSelected = () => {
    if (selectedArchivedUsers.size === 0) return;
    unarchiveUsersMutation.mutate(Array.from(selectedArchivedUsers));
  };
  
  // Toggle heatmap user selection
  const toggleHeatmapUserSelection = (userId: string) => {
    setSelectedHeatmapUsers(prev => {
      const newSet = new Set(prev);
      if (newSet.has(userId)) {
        newSet.delete(userId);
      } else {
        newSet.add(userId);
      }
      return newSet;
    });
  };
  
  // Toggle all heatmap users selection
  const toggleAllHeatmapUsers = () => {
    if (selectedHeatmapUsers.size === filteredUsers.length) {
      setSelectedHeatmapUsers(new Set());
    } else {
      setSelectedHeatmapUsers(new Set(filteredUsers.map(u => u.id)));
    }
  };
  
  // Toggle archived user selection
  const toggleArchivedUserSelection = (userId: string) => {
    setSelectedArchivedUsers(prev => {
      const newSet = new Set(prev);
      if (newSet.has(userId)) {
        newSet.delete(userId);
      } else {
        newSet.add(userId);
      }
      return newSet;
    });
  };
  
  // Helper function to format date as "1 Dec", "2 Dec", etc.
  const formatDateForExport = (date: Date) => {
    return date.toLocaleDateString('en-SG', { day: 'numeric', month: 'short' });
  };
  
  // Helper function to get day of week abbreviation
  const getDayOfWeek = (date: Date) => {
    return date.toLocaleDateString('en-SG', { weekday: 'short' });
  };
  
  // Check if date is weekend
  const isWeekendDate = (date: Date) => {
    const dayOfWeek = date.getDay();
    return dayOfWeek === 0 || dayOfWeek === 6; // Sunday = 0, Saturday = 6
  };
  
  // Export heatmap data to CSV
  const exportToCSV = () => {
    // Get month/year for title from first day in range
    const firstDay = heatmapDays[0];
    const monthYearTitle = firstDay.toLocaleDateString('en-SG', { month: 'short', year: 'numeric' });
    
    // Title row with month/year
    const titleRow = [`Attendance Report - ${monthYearTitle}`, '', '', '', ...heatmapDays.map(() => ''), '', ''];
    
    // Header row with just day numbers (1, 2, 3, etc.)
    const dateHeaders = heatmapDays.map(d => d.getDate().toString());
    const headers = ['S/N', 'Employee Name', 'Employee Code', 'Department', ...dateHeaders, 'Total Hours', 'Remark'];
    
    // Day of week row
    const dayOfWeekRow = ['', '', '', '', ...heatmapDays.map(d => getDayOfWeek(d)), '', ''];
    
    const rows = filteredUsers.map((user, idx) => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const totalHours = heatmapDays.reduce((sum, day) => {
        if (day > today) return sum;
        const dateKey = getDateKey(day);
        const adjustment = adjustmentsMap.get(`${user.id}-${dateKey}`);
        if (adjustment) {
          if (adjustment.adjustmentType === 'leave') return sum + 9;
          return sum + (adjustment.regularHours || 0) + (adjustment.otHours || 0);
        }
        const aggData = heatmapDataMap[user.id]?.[dateKey];
        return sum + (aggData?.totalHours || 0);
      }, 0);
      
      const userRemark = remarksMap.get(user.id) || '';
      
      return [
        idx + 1,
        toTitleCase(user.name),
        user.employeeCode || '',
        user.department || '',
        ...heatmapDays.map(day => {
          if (day > today) return '';
          const dateKey = getDateKey(day);
          const adjustment = adjustmentsMap.get(`${user.id}-${dateKey}`);
          if (adjustment) {
            if (adjustment.adjustmentType === 'leave') return adjustment.leaveType || 'Leave';
            const adjHrs = (adjustment.regularHours || 0) + (adjustment.otHours || 0);
            return adjHrs > 0 ? formatHours(adjHrs) : 0;
          }
          const aggData = heatmapDataMap[user.id]?.[dateKey];
          const hrs = aggData?.totalHours || 0;
          return hrs > 0 ? formatHours(hrs) : 0;
        }),
        formatHours(totalHours),
        userRemark
      ];
    });
    
    const csvContent = [titleRow, headers, dayOfWeekRow, ...rows]
      .map((row: (string | number)[]) => row.map(cell => `"${cell}"`).join(','))
      .join('\n');
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    // File name includes month/year
    const fileMonthYear = firstDay.toLocaleDateString('en-SG', { month: 'short', year: 'numeric' }).replace(' ', '_');
    link.download = `Attendance_Report_${fileMonthYear}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    
    toast({
      title: "Export Complete",
      description: `Heatmap data exported to CSV - ${monthYearTitle}`,
    });
  };
  
  // Export heatmap data to Excel (using ExcelJS for proper styling)
  const exportToExcel = async () => {
    // Get month/year for title from first day in range
    const firstDay = heatmapDays[0];
    const monthYearTitle = firstDay.toLocaleDateString('en-SG', { month: 'short', year: 'numeric' });
    
    // Create workbook and worksheet
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Attendance');
    
    // Define yellow fill for weekends
    const weekendFill: ExcelJS.Fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFFFFF00' }
    };
    
    // Define header fill
    const headerFill: ExcelJS.Fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFF0F0F0' }
    };
    
    // Define total column fill
    const totalFill: ExcelJS.Fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0F0E0' }
    };
    
    // Set column widths
    worksheet.columns = [
      { width: 5 },   // S/N
      { width: 30 },  // Employee Name
      { width: 15 },  // Employee Code
      { width: 15 },  // Department
      ...heatmapDays.map(() => ({ width: 6 })), // Day columns
      { width: 12 },  // Total Hours
      { width: 25 }   // Remark
    ];
    
    // Title row
    const totalColumns = 4 + heatmapDays.length + 2; // +2 for Total Hours and Remark
    const titleRow = worksheet.addRow([`Attendance Report - ${monthYearTitle}`]);
    worksheet.mergeCells(1, 1, 1, totalColumns);
    titleRow.font = { bold: true, size: 14 };
    
    // Header row with day numbers
    const headerData = ['S/N', 'Employee Name', 'Employee Code', 'Department'];
    heatmapDays.forEach(day => headerData.push(day.getDate().toString()));
    headerData.push('Total Hours');
    headerData.push('Remark');
    const headerRow = worksheet.addRow(headerData);
    headerRow.font = { bold: true };
    headerRow.eachCell((cell, colNumber) => {
      cell.fill = headerFill;
      cell.alignment = { horizontal: 'center' };
      // Apply yellow to weekend columns (columns 5 onwards are days)
      if (colNumber > 4 && colNumber <= 4 + heatmapDays.length) {
        const dayIndex = colNumber - 5;
        if (isWeekendDate(heatmapDays[dayIndex])) {
          cell.fill = weekendFill;
        }
      }
      // Total column
      if (colNumber === totalColumns) {
        cell.fill = totalFill;
      }
    });
    
    // Day of week row
    const dayOfWeekData = ['', '', '', ''];
    heatmapDays.forEach(day => dayOfWeekData.push(getDayOfWeek(day)));
    dayOfWeekData.push(''); // Total Hours
    dayOfWeekData.push(''); // Remark
    const dowRow = worksheet.addRow(dayOfWeekData);
    dowRow.eachCell((cell, colNumber) => {
      cell.alignment = { horizontal: 'center' };
      // Apply yellow to weekend columns
      if (colNumber > 4 && colNumber <= 4 + heatmapDays.length) {
        const dayIndex = colNumber - 5;
        if (isWeekendDate(heatmapDays[dayIndex])) {
          cell.fill = weekendFill;
        }
      }
      // Total column
      if (colNumber === totalColumns) {
        cell.fill = totalFill;
      }
    });
    
    // Data rows
    filteredUsers.forEach((user, idx) => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const totalHours = heatmapDays.reduce((sum, day) => {
        if (day > today) return sum;
        const dateKey = getDateKey(day);
        const adjustment = adjustmentsMap.get(`${user.id}-${dateKey}`);
        if (adjustment) {
          if (adjustment.adjustmentType === 'leave') return sum + 9;
          return sum + (adjustment.regularHours || 0) + (adjustment.otHours || 0);
        }
        const aggData = heatmapDataMap[user.id]?.[dateKey];
        return sum + (aggData?.totalHours || 0);
      }, 0);
      
      const userRemark = remarksMap.get(user.id) || '';
      
      const rowData: (string | number)[] = [
        idx + 1,
        toTitleCase(user.name),
        user.employeeCode || '',
        user.department || ''
      ];
      
      heatmapDays.forEach(day => {
        if (day <= today) {
          const dateKey = getDateKey(day);
          const adjustment = adjustmentsMap.get(`${user.id}-${dateKey}`);
          if (adjustment) {
            if (adjustment.adjustmentType === 'leave') {
              rowData.push(adjustment.leaveType || 'Leave');
            } else {
              const adjHrs = (adjustment.regularHours || 0) + (adjustment.otHours || 0);
              rowData.push(adjHrs > 0 ? parseFloat(formatHours(adjHrs)) : 0);
            }
          } else {
            const aggData = heatmapDataMap[user.id]?.[dateKey];
            const hrs = aggData?.totalHours || 0;
            rowData.push(hrs > 0 ? parseFloat(formatHours(hrs)) : 0);
          }
        } else {
          rowData.push('');
        }
      });
      
      rowData.push(parseFloat(formatHours(totalHours)));
      rowData.push(userRemark);
      const dataRow = worksheet.addRow(rowData);
      
      // Apply weekend styling to data cells
      dataRow.eachCell((cell, colNumber) => {
        cell.alignment = { horizontal: 'center' };
        // Apply yellow to weekend columns
        if (colNumber > 4 && colNumber <= 4 + heatmapDays.length) {
          const dayIndex = colNumber - 5;
          if (isWeekendDate(heatmapDays[dayIndex])) {
            cell.fill = weekendFill;
          }
        }
        // Total column
        if (colNumber === totalColumns) {
          cell.fill = totalFill;
        }
      });
    });
    
    // Generate and download file
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const fileMonthYear = firstDay.toLocaleDateString('en-SG', { month: 'short', year: 'numeric' }).replace(' ', '_');
    link.download = `Attendance_Report_${fileMonthYear}.xlsx`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    
    toast({
      title: "Export Complete",
      description: `Attendance report exported to Excel - ${monthYearTitle}`,
    });
  };
  
  // Print heatmap
  const handlePrintHeatmap = () => {
    // Guard against empty data
    if (!heatmapDays || heatmapDays.length === 0) {
      toast({
        title: "No Data to Print",
        description: "Please wait for the attendance data to load before printing.",
        variant: "destructive",
      });
      return;
    }
    
    setIsPrinting(true);
    
    // Add print-heatmap class to body for A4 landscape styling
    document.body.classList.add('print-heatmap');
    
    // Dynamically inject @page rule for A4 landscape (cross-browser compatible)
    const printStyle = document.createElement('style');
    printStyle.id = 'heatmap-print-style';
    printStyle.textContent = `
      @page {
        size: A4 landscape;
        margin: 0.25in;
      }
    `;
    document.head.appendChild(printStyle);
    
    // Change document title to month/year for print
    const originalTitle = document.title;
    const firstDay = heatmapDays[0];
    const lastDay = heatmapDays[heatmapDays.length - 1];
    
    // Format: "Attendance Report - January 2026" for single month, or "Attendance Report - Jan 5-11, 2026" for week view
    let printTitle: string;
    if (heatmapViewType === 'month') {
      printTitle = `Attendance Report - ${firstDay.toLocaleDateString('en-SG', { month: 'long', year: 'numeric' })}`;
    } else {
      // Week view - show date range
      const startDate = firstDay.toLocaleDateString('en-SG', { day: 'numeric', month: 'short' });
      const endDate = lastDay.toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' });
      printTitle = `Attendance Report - ${startDate} to ${endDate}`;
    }
    document.title = printTitle;
    
    setTimeout(() => {
      window.print();
      // Restore original title, remove print class, and remove injected style
      document.title = originalTitle;
      document.body.classList.remove('print-heatmap');
      const injectedStyle = document.getElementById('heatmap-print-style');
      if (injectedStyle) {
        injectedStyle.remove();
      }
      setIsPrinting(false);
    }, 100);
  };

  const toggleOrphanedSelection = (recordId: string) => {
    setSelectedOrphanedIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(recordId)) {
        newSet.delete(recordId);
      } else {
        newSet.add(recordId);
      }
      return newSet;
    });
  };

  const selectAllOrphaned = () => {
    if (selectedOrphanedIds.size === orphanedSessions.length) {
      setSelectedOrphanedIds(new Set());
    } else {
      setSelectedOrphanedIds(new Set(orphanedSessions.map(r => r.id)));
    }
  };

  // Week navigation - maintains the same range length
  const goToPreviousWeek = () => {
    const rangeDays = Math.round((heatmapWeekEnd.getTime() - heatmapWeekStart.getTime()) / (24 * 60 * 60 * 1000));
    setHeatmapWeekStart(prev => {
      const newDate = new Date(prev);
      newDate.setDate(newDate.getDate() - (rangeDays + 1));
      return newDate;
    });
    setHeatmapWeekEnd(prev => {
      const newDate = new Date(prev);
      newDate.setDate(newDate.getDate() - (rangeDays + 1));
      return newDate;
    });
  };

  const goToNextWeek = () => {
    const rangeDays = Math.round((heatmapWeekEnd.getTime() - heatmapWeekStart.getTime()) / (24 * 60 * 60 * 1000));
    setHeatmapWeekStart(prev => {
      const newDate = new Date(prev);
      newDate.setDate(newDate.getDate() + rangeDays + 1);
      return newDate;
    });
    setHeatmapWeekEnd(prev => {
      const newDate = new Date(prev);
      newDate.setDate(newDate.getDate() + rangeDays + 1);
      return newDate;
    });
  };
  
  // Handle custom date range changes
  const handleWeekStartChange = (dateStr: string) => {
    const newStart = new Date(dateStr + 'T00:00:00');
    setHeatmapWeekStart(newStart);
    // If end date is before start or more than 7 days after, adjust it
    const maxEnd = new Date(newStart);
    maxEnd.setDate(newStart.getDate() + 6);
    if (heatmapWeekEnd < newStart) {
      setHeatmapWeekEnd(newStart);
    } else if (heatmapWeekEnd > maxEnd) {
      setHeatmapWeekEnd(maxEnd);
    }
    setUseCustomRange(true);
  };
  
  const handleWeekEndChange = (dateStr: string) => {
    const newEnd = new Date(dateStr + 'T00:00:00');
    // Ensure end is not before start and not more than 7 days after start
    const minEnd = heatmapWeekStart;
    const maxEnd = new Date(heatmapWeekStart);
    maxEnd.setDate(heatmapWeekStart.getDate() + 6);
    
    if (newEnd < minEnd) {
      setHeatmapWeekEnd(minEnd);
    } else if (newEnd > maxEnd) {
      setHeatmapWeekEnd(maxEnd);
    } else {
      setHeatmapWeekEnd(newEnd);
    }
    setUseCustomRange(true);
  };

  // Month navigation
  const goToPreviousMonth = () => {
    setHeatmapMonth(prev => {
      if (prev.month === 0) {
        return { year: prev.year - 1, month: 11 };
      }
      return { year: prev.year, month: prev.month - 1 };
    });
  };

  const goToNextMonth = () => {
    setHeatmapMonth(prev => {
      if (prev.month === 11) {
        return { year: prev.year + 1, month: 0 };
      }
      return { year: prev.year, month: prev.month + 1 };
    });
  };

  const monthName = new Date(heatmapMonth.year, heatmapMonth.month).toLocaleDateString('en-SG', { 
    month: 'long', 
    year: 'numeric' 
  });

  // Format week range (now uses custom end date)
  const weekRangeName = heatmapWeekStart.getTime() === heatmapWeekEnd.getTime()
    ? heatmapWeekStart.toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' })
    : `${heatmapWeekStart.toLocaleDateString('en-SG', { day: 'numeric', month: 'short' })} - ${heatmapWeekEnd.toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' })}`;

  // Navigate heatmap based on view type
  const goToPrevious = heatmapViewType === 'week' ? goToPreviousWeek : goToPreviousMonth;
  const goToNext = heatmapViewType === 'week' ? goToNextWeek : goToNextMonth;
  const periodLabel = heatmapViewType === 'week' ? weekRangeName : monthName;

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-semibold mb-2" data-testid="text-admin-attendance-title">
            Attendance Reports
          </h1>
          <p className="text-sm text-muted-foreground">
            View and manage employee attendance records
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={() => setShowAddDialog(true)}
            disabled={cannotEdit}
            data-testid="button-add-attendance"
          >
            <Plus className="h-4 w-4 mr-1" />
            Add Attendance
          </Button>
          <Button
            variant={viewMode === 'today' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setViewMode('today')}
            data-testid="button-view-today"
          >
            <CalendarCheck className="h-4 w-4 mr-1" />
            Clock-ins
          </Button>
          <Button
            variant={viewMode === 'orphaned' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setViewMode('orphaned')}
            data-testid="button-view-orphaned"
            className={orphanedSessions.length > 0 ? "relative" : ""}
          >
            <AlertTriangle className="h-4 w-4 mr-1" />
            Orphaned
            {orphanedSessions.length > 0 && (
              <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full h-4 w-4 flex items-center justify-center">
                {orphanedSessions.length}
              </span>
            )}
          </Button>
          <Button
            variant={viewMode === 'heatmap' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setViewMode('heatmap')}
            data-testid="button-view-heatmap"
          >
            <Grid3X3 className="h-4 w-4 mr-1" />
            Heatmap
          </Button>
          <Button
            variant={viewMode === 'details' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setViewMode('details')}
            data-testid="button-view-details"
          >
            <History className="h-4 w-4 mr-1" />
            Attendance Details
          </Button>
          {fromPayroll ? (
            <Link href="/admin/payroll">
              <Button variant="outline" size="sm" data-testid="button-back-payroll">
                <ArrowLeft className="mr-1 h-4 w-4" />
                Back to Payroll Reports
              </Button>
            </Link>
          ) : (
            <Link href="/admin/dashboard">
              <Button variant="outline" size="sm" data-testid="button-back-dashboard">
                <ArrowLeft className="mr-1 h-4 w-4" />
                Back to Dashboard
              </Button>
            </Link>
          )}
        </div>
      </div>

      {viewMode === 'today' ? (
        <>
          {/* Clock-ins View with Date Selection */}
          <Card>
            <CardHeader className="pb-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <CalendarCheck className="h-5 w-5" />
                    {isViewingToday ? "Today's Clock-ins" : "Clock-ins"}
                  </CardTitle>
                  <CardDescription>
                    {new Date(clockInsDate + 'T00:00:00').toLocaleDateString('en-SG', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    type="date"
                    value={clockInsDate}
                    onChange={(e) => setClockInsDate(e.target.value)}
                    className="w-[160px]"
                    data-testid="input-clockins-date"
                  />
                  {!isViewingToday && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setClockInsDate(todayDate)}
                      data-testid="button-clockins-today"
                    >
                      Today
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowDailyReport(true)}
                    data-testid="button-print-daily-report"
                  >
                    <Printer className="h-4 w-4 mr-1" />
                    Print Daily Report
                  </Button>
                  <div className="text-sm text-muted-foreground">
                    <span className="font-medium text-foreground" data-testid="text-today-clocked-in-count">{clockInsRecords.length}</span> clock-ins
                  </div>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Legend */}
              <div className="flex flex-wrap items-center gap-4 text-xs">
                <span className="text-muted-foreground">Status:</span>
                <div className="flex items-center gap-1">
                  <div className="w-4 h-4 rounded bg-blue-500 dark:bg-blue-400"></div>
                  <span>In Progress</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-4 h-4 rounded bg-green-600 dark:bg-green-500"></div>
                  <span>Completed (8+ hrs)</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-4 h-4 rounded bg-green-400"></div>
                  <span>Completed (6-8 hrs)</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-4 h-4 rounded bg-yellow-400 dark:bg-yellow-500"></div>
                  <span>Completed (4-6 hrs)</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-4 h-4 rounded bg-orange-400 dark:bg-orange-500"></div>
                  <span>Completed (1-4 hrs)</span>
                </div>
              </div>

              {/* Clock-ins Grid */}
              {clockInsLoading ? (
                <div className="text-center py-8 text-muted-foreground">Loading records...</div>
              ) : clockInsRecords.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <Clock className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p className="text-lg font-medium">No clock-ins on this date</p>
                  <p className="text-sm">No attendance records found for the selected date</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {clockInsRecords
                    .sort((a, b) => new Date(a.clockInTime).getTime() - new Date(b.clockInTime).getTime())
                    .map((record) => {
                      const user = users.find(u => u.id === record.userId);
                      const hours = calculateHours(record.clockInTime, record.clockOutTime);
                      const isInProgress = !record.clockOutTime;
                      const statusColor = isInProgress 
                        ? "border-l-blue-500" 
                        : hours >= 8 ? "border-l-green-600" : hours >= 6 ? "border-l-green-400" : hours >= 4 ? "border-l-yellow-400" : "border-l-orange-400";
                      
                      return (
                        <Card 
                          key={record.id} 
                          className={`border-l-4 ${statusColor}`}
                          data-testid={`card-today-${record.id}`}
                        >
                          <CardContent className="p-4">
                            <div className="flex items-start justify-between gap-2 mb-3">
                              <div>
                                <div className="font-semibold text-sm">
                                  {user?.name || 'Unknown'}
                                </div>
                                {user?.employeeCode && (
                                  <div className="text-xs text-muted-foreground">{user.employeeCode}</div>
                                )}
                              </div>
                              <div className={`px-2 py-0.5 rounded text-xs font-medium ${
                                isInProgress 
                                  ? "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300" 
                                  : "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300"
                              }`}>
                                {isInProgress ? "In Progress" : `${formatHours(hours)} hrs`}
                              </div>
                            </div>
                            
                            <div className="space-y-2 text-xs">
                              {/* Clock In */}
                              <div className="flex items-start gap-2">
                                <span className="font-medium text-muted-foreground w-8 shrink-0">In:</span>
                                <div className="min-w-0 flex-1">
                                  <div className="font-medium">{formatTime(record.clockInTime)}</div>
                                  {(record.clockInLocationText || (record.latitude && record.longitude)) ? (
                                    <div className="mt-0.5">
                                      <div className="flex items-start gap-1 text-muted-foreground">
                                        <MapPin className="h-3 w-3 shrink-0 mt-0.5" />
                                        <span className="break-words">
                                          {record.clockInLocationText || `${parseFloat(record.latitude!).toFixed(4)}, ${parseFloat(record.longitude!).toFixed(4)}`}
                                        </span>
                                      </div>
                                      {record.latitude && record.longitude && (
                                        <div className="flex items-center gap-2 mt-1 ml-4">
                                          <a 
                                            href={`https://www.google.com/maps?q=${record.latitude},${record.longitude}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="flex items-center gap-1 text-blue-600 dark:text-blue-400 hover:underline"
                                            data-testid={`link-location-in-${record.id}`}
                                          >
                                            <ExternalLink className="h-3 w-3" />
                                            <span>Map</span>
                                          </a>
                                          {(!record.clockInLocationText || /^[\d.-]+,\s*[\d.-]+$/.test(record.clockInLocationText)) && (
                                            <Button
                                              variant="ghost"
                                              size="sm"
                                              className="h-5 px-1 py-0 text-xs text-blue-600 dark:text-blue-400"
                                              onClick={() => handleResolveLocation(record.id, "in")}
                                              disabled={resolvingLocationId === `${record.id}-in`}
                                              data-testid={`button-resolve-location-in-${record.id}`}
                                            >
                                              {resolvingLocationId === `${record.id}-in` ? "Resolving..." : "Resolve Address"}
                                            </Button>
                                          )}
                                        </div>
                                      )}
                                    </div>
                                  ) : (
                                    <span className="text-muted-foreground">No location</span>
                                  )}
                                </div>
                              </div>
                              
                              {/* Clock Out */}
                              <div className="flex items-start gap-2">
                                <span className="font-medium text-muted-foreground w-8 shrink-0">Out:</span>
                                <div className="min-w-0 flex-1">
                                  {record.clockOutTime ? (
                                    <>
                                      <div className="font-medium">{formatTime(record.clockOutTime)}</div>
                                      {(record.clockOutLocationText || (record.clockOutLatitude && record.clockOutLongitude)) ? (
                                        <div className="mt-0.5">
                                          <div className="flex items-start gap-1 text-muted-foreground">
                                            <MapPin className="h-3 w-3 shrink-0 mt-0.5" />
                                            <span className="break-words">
                                              {record.clockOutLocationText || `${parseFloat(record.clockOutLatitude!).toFixed(4)}, ${parseFloat(record.clockOutLongitude!).toFixed(4)}`}
                                            </span>
                                          </div>
                                          {record.clockOutLatitude && record.clockOutLongitude && (
                                            <div className="flex items-center gap-2 mt-1 ml-4">
                                              <a 
                                                href={`https://www.google.com/maps?q=${record.clockOutLatitude},${record.clockOutLongitude}`}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="flex items-center gap-1 text-blue-600 dark:text-blue-400 hover:underline"
                                                data-testid={`link-location-out-${record.id}`}
                                              >
                                                <ExternalLink className="h-3 w-3" />
                                                <span>Map</span>
                                              </a>
                                              {(!record.clockOutLocationText || /^[\d.-]+,\s*[\d.-]+$/.test(record.clockOutLocationText)) && (
                                                <Button
                                                  variant="ghost"
                                                  size="sm"
                                                  className="h-5 px-1 py-0 text-xs text-blue-600 dark:text-blue-400"
                                                  onClick={() => handleResolveLocation(record.id, "out")}
                                                  disabled={resolvingLocationId === `${record.id}-out`}
                                                  data-testid={`button-resolve-location-out-${record.id}`}
                                                >
                                                  {resolvingLocationId === `${record.id}-out` ? "Resolving..." : "Resolve Address"}
                                                </Button>
                                              )}
                                            </div>
                                          )}
                                        </div>
                                      ) : (
                                        <span className="text-muted-foreground">No location</span>
                                      )}
                                    </>
                                  ) : (
                                    <span className="text-blue-600 dark:text-blue-400 font-medium">Not clocked out</span>
                                  )}
                                </div>
                              </div>
                            </div>
                            
                            {/* Action Buttons */}
                            <div className="flex gap-2 mt-3 pt-3 border-t">
                              {isInProgress && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 text-xs flex-1"
                                  onClick={() => {
                                    setSelectedRecord(record);
                                    setShowEndClockInDialog(true);
                                  }}
                                  disabled={cannotEdit}
                                  data-testid={`button-end-clockin-today-${record.id}`}
                                >
                                  End Clock-in
                                </Button>
                              )}
                              {isNexaAdmin && !cannotEdit && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 text-xs text-destructive hover:text-destructive"
                                  onClick={() => {
                                    setRecordToDelete(record);
                                    setShowDeleteDialog(true);
                                  }}
                                  data-testid={`button-delete-attendance-today-${record.id}`}
                                >
                                  <Trash2 className="h-3 w-3" />
                                </Button>
                              )}
                            </div>
                          </CardContent>
                        </Card>
                      );
                    })}
                </div>
              )}

              {/* Summary stats */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-4 border-t">
                <div className="bg-muted/50 p-3 rounded-md">
                  <p className="text-xs text-muted-foreground mb-1">Total Clock-ins</p>
                  <p className="text-xl font-bold" data-testid="text-today-total-clockins">
                    {clockInsRecords.length}
                  </p>
                </div>
                <div className="bg-muted/50 p-3 rounded-md">
                  <p className="text-xs text-muted-foreground mb-1">In Progress</p>
                  <p className="text-xl font-bold text-blue-500" data-testid="text-today-in-progress">
                    {clockInsRecords.filter(r => !r.clockOutTime).length}
                  </p>
                </div>
                <div className="bg-muted/50 p-3 rounded-md">
                  <p className="text-xs text-muted-foreground mb-1">Completed</p>
                  <p className="text-xl font-bold text-green-600" data-testid="text-today-completed">
                    {clockInsRecords.filter(r => r.clockOutTime).length}
                  </p>
                </div>
                <div className="bg-muted/50 p-3 rounded-md">
                  <p className="text-xs text-muted-foreground mb-1">Avg Hours</p>
                  <p className="text-xl font-bold" data-testid="text-today-avg-hours">
                    {clockInsRecords.filter(r => r.clockOutTime).length > 0
                      ? formatHours(clockInsRecords
                          .filter(r => r.clockOutTime)
                          .reduce((sum, r) => sum + calculateHours(r.clockInTime, r.clockOutTime), 0) / 
                         clockInsRecords.filter(r => r.clockOutTime).length)
                      : '-'}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </>
      ) : viewMode === 'orphaned' ? (
        <>
          {/* Orphaned Sessions View */}
          <Card>
            <CardHeader className="pb-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <AlertTriangle className="h-5 w-5 text-amber-500" />
                    Orphaned Sessions
                  </CardTitle>
                  <CardDescription>
                    Clock-ins without clock-out for more than 24 hours. These need to be closed to allow employees to clock in again.
                  </CardDescription>
                </div>
                {orphanedSessions.length > 0 && (
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setViewMode('details')}
                      data-testid="button-audit-trail"
                    >
                      <FileText className="h-4 w-4 mr-1" />
                      Audit Trail
                    </Button>
                    <Button
                      size="sm"
                      onClick={handleBulkCloseOrphaned}
                      disabled={selectedOrphanedIds.size === 0 || cannotEdit || bulkCloseOrphanedMutation.isPending}
                      data-testid="button-bulk-close-orphaned"
                    >
                      <CheckCircle2 className="h-4 w-4 mr-1" />
                      Close Selected ({selectedOrphanedIds.size})
                    </Button>
                  </div>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {orphanedLoading ? (
                <div className="text-center py-8 text-muted-foreground">Loading orphaned sessions...</div>
              ) : orphanedSessions.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <CheckCircle2 className="h-12 w-12 mx-auto mb-4 text-green-500 opacity-50" />
                  <p className="text-lg font-medium text-green-600">No Orphaned Sessions</p>
                  <p className="text-sm">All attendance sessions are properly closed</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Select All */}
                  <div className="flex items-center gap-2 pb-2 border-b">
                    <input
                      type="checkbox"
                      checked={selectedOrphanedIds.size === orphanedSessions.length && orphanedSessions.length > 0}
                      onChange={selectAllOrphaned}
                      className="h-4 w-4 rounded border-gray-300"
                      data-testid="checkbox-select-all-orphaned"
                    />
                    <span className="text-sm font-medium">
                      Select All ({orphanedSessions.length} orphaned session{orphanedSessions.length !== 1 ? 's' : ''})
                    </span>
                  </div>
                  
                  {/* Orphaned Sessions List */}
                  <div className="space-y-3">
                    {orphanedSessions.map((record) => {
                      const user = users.find(u => u.id === record.userId);
                      const clockInDate = new Date(record.clockInTime);
                      const daysAgo = Math.floor((Date.now() - clockInDate.getTime()) / (1000 * 60 * 60 * 24));
                      
                      return (
                        <div 
                          key={record.id}
                          className="flex items-center gap-4 p-4 border rounded-lg bg-amber-50/50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800"
                          data-testid={`orphaned-record-${record.id}`}
                        >
                          <input
                            type="checkbox"
                            checked={selectedOrphanedIds.has(record.id)}
                            onChange={() => toggleOrphanedSelection(record.id)}
                            className="h-4 w-4 rounded border-gray-300"
                            data-testid={`checkbox-orphaned-${record.id}`}
                          />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-semibold">{user?.name || 'Unknown'}</span>
                              {user?.employeeCode && (
                                <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                                  {user.employeeCode}
                                </span>
                              )}
                            </div>
                            <div className="text-sm text-muted-foreground mt-1">
                              <span className="font-medium">Clocked in:</span>{' '}
                              {clockInDate.toLocaleString('en-US', { 
                                timeZone: 'Asia/Singapore',
                                weekday: 'short',
                                month: 'short', 
                                day: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit'
                              })}
                            </div>
                            {user?.department && (
                              <div className="text-xs text-muted-foreground mt-0.5">
                                {user.department}
                              </div>
                            )}
                          </div>
                          <div className="text-right">
                            <div className="text-sm font-medium text-amber-600 dark:text-amber-400">
                              {daysAgo} day{daysAgo !== 1 ? 's' : ''} ago
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {record.date}
                            </div>
                          </div>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={cannotEdit}
                                data-testid={`button-actions-orphaned-${record.id}`}
                              >
                                <MoreVertical className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                onClick={() => {
                                  // Cancel - just remove selection
                                  setSelectedOrphanedIds(prev => {
                                    const newSet = new Set(prev);
                                    newSet.delete(record.id);
                                    return newSet;
                                  });
                                }}
                                data-testid={`action-cancel-${record.id}`}
                              >
                                <X className="h-4 w-4 mr-2" />
                                Cancel
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => {
                                  setSelectedRecord(record);
                                  setShowEndClockInDialog(true);
                                }}
                                data-testid={`action-set-clockout-${record.id}`}
                              >
                                <Clock className="h-4 w-4 mr-2" />
                                Set Clock-out
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => {
                                  setRecordToDelete(record);
                                  setShowDeleteDialog(true);
                                }}
                                className="text-red-600 focus:text-red-600"
                                data-testid={`action-delete-${record.id}`}
                              >
                                <Trash2 className="h-4 w-4 mr-2" />
                                Delete Record
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      ) : viewMode === 'heatmap' ? (
        <>
          {/* Heatmap View */}
          <Card>
            <CardHeader className="pb-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Grid3X3 className="h-5 w-5" />
                    Attendance Heatmap
                  </CardTitle>
                  <CardDescription>Visual overview of attendance for all employees</CardDescription>
                </div>
                <div className="flex items-center gap-3">
                  {/* Week/Month Toggle */}
                  <div className="flex items-center gap-1 bg-muted rounded-md p-1">
                    <Button
                      variant={heatmapViewType === 'week' ? 'default' : 'ghost'}
                      size="sm"
                      className="h-7 px-3"
                      onClick={() => setHeatmapViewType('week')}
                      data-testid="button-heatmap-week"
                    >
                      Week
                    </Button>
                    <Button
                      variant={heatmapViewType === 'month' ? 'default' : 'ghost'}
                      size="sm"
                      className="h-7 px-3"
                      onClick={() => setHeatmapViewType('month')}
                      data-testid="button-heatmap-month"
                    >
                      Month
                    </Button>
                  </div>
                  {/* Navigation */}
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="icon" onClick={goToPrevious} data-testid="button-prev-period">
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <span className="text-sm font-medium min-w-[180px] text-center" data-testid="text-current-period">
                      {periodLabel}
                    </span>
                    <Button variant="outline" size="icon" onClick={goToNext} data-testid="button-next-period">
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                  {/* Regenerate summaries button (month view only) */}
                  {heatmapViewType === 'month' && !cannotEdit && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleRegenerateSummaries}
                          disabled={regenerateSummariesMutation.isPending}
                          data-testid="button-regenerate-summaries"
                        >
                          <RefreshCw className={`h-4 w-4 mr-1 ${regenerateSummariesMutation.isPending ? 'animate-spin' : ''}`} />
                          {regenerateSummariesMutation.isPending ? 'Regenerating...' : 'Refresh Data'}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>Recalculate attendance summaries from raw records for this month</p>
                      </TooltipContent>
                    </Tooltip>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Filters */}
              <div className="flex flex-col sm:flex-row gap-3 flex-wrap">
                <div className="relative flex-1 max-w-xs">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search employee..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-9"
                    data-testid="input-search-employee"
                  />
                </div>
                <Select value={departmentFilter} onValueChange={setDepartmentFilter}>
                  <SelectTrigger className="w-[180px]" data-testid="select-department">
                    <SelectValue placeholder="All Departments" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Departments</SelectItem>
                    {departments.map(dept => (
                      <SelectItem key={dept} value={dept!}>{dept}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                
                {/* Custom Date Range for Week View */}
                {heatmapViewType === 'week' && (
                  <div className="flex items-center gap-2 ml-auto">
                    <Label className="text-sm text-muted-foreground whitespace-nowrap">Date Range:</Label>
                    <Input
                      type="date"
                      value={getDateKey(heatmapWeekStart)}
                      onChange={(e) => handleWeekStartChange(e.target.value)}
                      className="w-[140px]"
                      data-testid="input-week-start-date"
                    />
                    <span className="text-muted-foreground">to</span>
                    <Input
                      type="date"
                      value={getDateKey(heatmapWeekEnd)}
                      onChange={(e) => handleWeekEndChange(e.target.value)}
                      min={getDateKey(heatmapWeekStart)}
                      max={getDateKey(new Date(heatmapWeekStart.getTime() + 6 * 24 * 60 * 60 * 1000))}
                      className="w-[140px]"
                      data-testid="input-week-end-date"
                    />
                    <span className="text-xs text-muted-foreground">(max 7 days)</span>
                  </div>
                )}
              </div>

              {/* Legend */}
              <div className="flex flex-wrap items-center gap-4 text-xs">
                <span className="text-muted-foreground">Hours:</span>
                <div className="flex items-center gap-1">
                  <div className="w-4 h-4 rounded bg-green-600 dark:bg-green-500"></div>
                  <span>8+</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-4 h-4 rounded bg-green-400"></div>
                  <span>6-8</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-4 h-4 rounded bg-yellow-400 dark:bg-yellow-500"></div>
                  <span>4-6</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-4 h-4 rounded bg-orange-400 dark:bg-orange-500"></div>
                  <span>1-4</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-4 h-4 rounded bg-blue-500 dark:bg-blue-400"></div>
                  <span>In Progress</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-4 h-4 rounded bg-muted border"></div>
                  <span>Absent</span>
                </div>
                <span className="text-muted-foreground ml-2">Leave:</span>
                <div className="flex items-center gap-1">
                  <div className="w-4 h-4 rounded bg-indigo-500 dark:bg-indigo-400 flex items-center justify-center text-[8px] text-white font-bold">AL</div>
                  <span>Annual</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-4 h-4 rounded bg-rose-500 dark:bg-rose-400 flex items-center justify-center text-[8px] text-white font-bold">MC</div>
                  <span>Medical</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-4 h-4 rounded bg-fuchsia-500 dark:bg-fuchsia-400 flex items-center justify-center text-[8px] text-white font-bold">ML</div>
                  <span>Maternity</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-4 h-4 rounded bg-violet-500 dark:bg-violet-400 flex items-center justify-center text-[8px] text-white font-bold">CL</div>
                  <span>Compassionate</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-4 h-4 rounded bg-cyan-600 dark:bg-cyan-500 flex items-center justify-center text-[8px] text-white font-bold">OIL</div>
                  <span>Off-in-Lieu</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-4 h-4 rounded bg-amber-500 dark:bg-amber-400 flex items-center justify-center text-[8px] text-white font-bold">HDL</div>
                  <span>Half Day</span>
                </div>
              </div>
              
              {/* Action Buttons Row */}
              <div className="flex flex-wrap items-center gap-2 print:hidden">
                {/* Archive button - super admin only, only when users selected */}
                {isSuperAdmin && selectedHeatmapUsers.size > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleArchiveSelected}
                    disabled={archiveUsersMutation.isPending}
                    data-testid="button-archive-selected"
                  >
                    <Archive className="h-4 w-4 mr-1" />
                    Archive ({selectedHeatmapUsers.size})
                  </Button>
                )}
                
                {isSuperAdmin && selectedHeatmapUsers.size > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-destructive border-destructive/30"
                    onClick={() => {
                      if (selectedHeatmapUsers.size !== 1) {
                        toast({ title: "Select One Employee", description: "Please select exactly one employee to delete.", variant: "destructive" });
                        return;
                      }
                      const userId = Array.from(selectedHeatmapUsers)[0];
                      const user = users.find(u => u.id === userId);
                      if (user) {
                        setEmployeeToDelete(user);
                        setDeleteReason("");
                        setShowDeleteEmployeeDialog(true);
                      }
                    }}
                    disabled={deleteEmployeeMutation.isPending}
                    data-testid="button-delete-selected"
                  >
                    <Trash2 className="h-4 w-4 mr-1" />
                    Delete
                  </Button>
                )}

                {/* Unarchive button - super admin only, opens modal */}
                {isSuperAdmin && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowUnarchiveModal(true)}
                    data-testid="button-open-unarchive"
                  >
                    <ArchiveRestore className="h-4 w-4 mr-1" />
                    Unarchive Employees
                  </Button>
                )}
                
                {isSuperAdmin && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowDeletionLogs(true)}
                    data-testid="button-deletion-history"
                  >
                    <History className="h-4 w-4 mr-1" />
                    Deletion History
                  </Button>
                )}
                
                {/* Export dropdown */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" data-testid="button-export-dropdown">
                      <Download className="h-4 w-4 mr-1" />
                      Export
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    <DropdownMenuItem onClick={exportToCSV} data-testid="button-export-csv">
                      Export to CSV
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={exportToExcel} data-testid="button-export-excel">
                      Export to Excel
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                
                {/* Print button */}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handlePrintHeatmap}
                  data-testid="button-print-heatmap"
                >
                  <Printer className="h-4 w-4 mr-1" />
                  Print
                </Button>
                
                {/* Import button - nexaadmin only */}
                {isNexaAdmin && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowImportModal(true)}
                    data-testid="button-import-attendance"
                  >
                    <Upload className="h-4 w-4 mr-1" />
                    Import
                  </Button>
                )}
                
                {/* Selection info */}
                {selectedHeatmapUsers.size > 0 && (
                  <span className="text-sm text-muted-foreground ml-2">
                    {selectedHeatmapUsers.size} of {filteredUsers.length} selected
                  </span>
                )}
              </div>

              {/* Heatmap Grid */}
              {heatmapLoading ? (
                <div className="text-center py-8 text-muted-foreground">Loading heatmap data...</div>
              ) : (
                <div className="overflow-x-auto print:overflow-visible" data-testid="heatmap-container">
                  <div className={heatmapViewType === 'month' ? 'min-w-[1500px]' : 'min-w-[800px]'}>
                    {/* Header row with dates */}
                    <div className="flex border-b sticky top-0 bg-background z-10">
                      {/* Checkbox column - hidden when printing */}
                      {!isPrinting && (
                        <div className="w-10 flex-shrink-0 p-2 flex items-center justify-center border-r print:hidden">
                          <Checkbox
                            checked={selectedHeatmapUsers.size === filteredUsers.length && filteredUsers.length > 0}
                            onCheckedChange={toggleAllHeatmapUsers}
                            data-testid="checkbox-select-all"
                          />
                        </div>
                      )}
                      {/* Serial number column */}
                      <div className="w-6 flex-shrink-0 p-1 font-medium text-xs border-r text-center">
                        #
                      </div>
                      <div className="w-56 flex-shrink-0 p-2 font-medium text-sm border-r">
                        Employee
                      </div>
                      <div className={`flex ${heatmapViewType === 'week' ? 'flex-1' : ''}`}>
                        {heatmapDays.map((day, idx) => {
                          const isWeekend = day.getDay() === 0 || day.getDay() === 6;
                          return (
                            <div
                              key={idx}
                              className={`${heatmapViewType === 'week' ? 'flex-1 min-w-[60px]' : 'w-8 flex-shrink-0'} p-1 text-center text-xs border-r ${isWeekend ? 'bg-muted/50' : ''}`}
                            >
                              <div className="font-medium">{day.getDate()}</div>
                              <div className="text-muted-foreground text-[10px]">
                                {heatmapViewType === 'week' 
                                  ? day.toLocaleDateString('en-SG', { weekday: 'short' })
                                  : day.toLocaleDateString('en-SG', { weekday: 'short' }).charAt(0)}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      {/* Total column header */}
                      <div className="w-12 flex-shrink-0 p-1 text-center text-xs border-l bg-primary/10">
                        <div className="font-bold">Total</div>
                      </div>
                      {/* Remark column header */}
                      <div className="w-52 flex-shrink-0 p-1 text-center text-xs border-l bg-muted/50">
                        <div className="font-bold">Remark</div>
                      </div>
                    </div>

                    {/* Employee rows */}
                    {filteredUsers.length === 0 ? (
                      <div className="text-center py-8 text-muted-foreground">
                        No employees found matching your filters
                      </div>
                    ) : (
                      <div className="max-h-[60vh] overflow-y-auto print:max-h-none print:overflow-visible">
                        {filteredUsers.map((user, userIndex) => (
                          <div key={user.id} className="flex border-b hover:bg-muted/30" data-testid={`heatmap-row-${user.id}`}>
                            {/* Checkbox column - hidden when printing */}
                            {!isPrinting && (
                              <div className="w-10 flex-shrink-0 p-2 flex items-center justify-center border-r print:hidden">
                                <Checkbox
                                  checked={selectedHeatmapUsers.has(user.id)}
                                  onCheckedChange={() => toggleHeatmapUserSelection(user.id)}
                                  data-testid={`checkbox-user-${user.id}`}
                                />
                              </div>
                            )}
                            {/* Serial number column */}
                            <div className="w-6 flex-shrink-0 p-1 text-xs text-center text-muted-foreground border-r">
                              {userIndex + 1}
                            </div>
                            <div className="w-56 flex-shrink-0 p-2 border-r">
                              <div className="text-sm font-medium" title={toTitleCase(user.name)}>
                                {toTitleCase(user.name)}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                {user.department || 'No dept'}
                              </div>
                            </div>
                            <div className={`flex ${heatmapViewType === 'week' ? 'flex-1' : ''}`}>
                              {heatmapDays.map((day, idx) => {
                                const dateKey = getDateKey(day);
                                const aggData = heatmapDataMap[user.id]?.[dateKey];
                                const hours = aggData?.totalHours || 0;
                                const recordCount = aggData?.recordCount || 0;
                                const hasOpenSession = aggData?.hasOpenSession || false;
                                const isWeekend = day.getDay() === 0 || day.getDay() === 6;
                                const today = new Date();
                                today.setHours(0, 0, 0, 0);
                                const isFuture = day > today;
                                const hasRecord = aggData && recordCount > 0;
                                
                                // Check for adjustments
                                const adjustmentKey = `${user.id}-${dateKey}`;
                                const adjustment = adjustmentsMap.get(adjustmentKey);
                                const hasAdjustment = !!adjustment;
                                const isLeaveAdjustment = adjustment?.adjustmentType === 'leave';
                                const leaveCode = adjustment?.leaveType;

                                // Cell content - shared between print and interactive modes
                                const cellContent = (
                                  <>
                                    {hasAdjustment && isLeaveAdjustment && (
                                      <span className="font-medium text-[10px]">{leaveCode}</span>
                                    )}
                                    {hasAdjustment && !isLeaveAdjustment && (
                                      <span className="font-medium">{formatHours((adjustment?.regularHours || 0) + (adjustment?.otHours || 0))}</span>
                                    )}
                                    {!hasAdjustment && !isFuture && hasOpenSession && hours === 0 && (
                                      <Clock className="h-3 w-3" />
                                    )}
                                    {!hasAdjustment && !isFuture && hours > 0 && (
                                      <span className="font-medium">{formatHours(hours)}</span>
                                    )}
                                  </>
                                );
                                
                                // Determine cell background color based on leave type
                                // Using colors that don't clash with heatmap: green/yellow/orange/blue/gray
                                const getLeaveColor = (type: string | undefined) => {
                                  switch (type) {
                                    case 'AL': return 'bg-indigo-500 dark:bg-indigo-400'; // Annual Leave - Indigo
                                    case 'MC': return 'bg-rose-500 dark:bg-rose-400'; // Medical Certificate - Rose
                                    case 'ML': return 'bg-fuchsia-500 dark:bg-fuchsia-400'; // Maternity Leave - Fuchsia
                                    case 'CL': return 'bg-violet-500 dark:bg-violet-400'; // Compassionate Leave - Violet
                                    case 'OIL': return 'bg-cyan-600 dark:bg-cyan-500'; // Off-in-Lieu - Cyan
                                    case 'HDL': return 'bg-amber-500 dark:bg-amber-400'; // Half Day Leave - Amber
                                    default: return 'bg-purple-500 dark:bg-purple-400'; // Default purple
                                  }
                                };
                                
                                const getCellColor = () => {
                                  if (hasAdjustment && isLeaveAdjustment) return getLeaveColor(leaveCode ?? undefined);
                                  if (hasAdjustment && !isLeaveAdjustment) {
                                    const adjTotal = (adjustment?.regularHours || 0) + (adjustment?.otHours || 0);
                                    return getHeatmapColor(adjTotal, false);
                                  }
                                  if (isFuture && !hasAdjustment) return 'bg-muted/30';
                                  if (isWeekend && !hasRecord) return 'bg-muted/50';
                                  return getHeatmapColor(hours, hasOpenSession);
                                };
                                
                                const cellClassName = `${heatmapViewType === 'week' ? 'flex-1 min-w-[60px]' : 'w-8 flex-shrink-0'} min-h-[36px] flex items-center justify-center text-xs border-r last:border-r-0 ${getCellColor()} ${(hours > 0 || hasOpenSession || hasAdjustment) ? 'text-white' : ''}`;
                                
                                // Apply inline style for proper color - use adjusted hours for override, original hours otherwise
                                const getCellStyle = (): React.CSSProperties => {
                                  if (hasAdjustment && isLeaveAdjustment) {
                                    // Leave adjustments - use distinct leave colors (handled by Tailwind class)
                                    return { color: '#fff' };
                                  }
                                  if (hasAdjustment && !isLeaveAdjustment) {
                                    // Hours override - use adjusted total for normal clock-in color scheme (treat as non-future since adjustment exists)
                                    const adjTotal = (adjustment?.regularHours || 0) + (adjustment?.otHours || 0);
                                    return getHeatmapInlineStyle(adjTotal, false, isWeekend, false, true);
                                  }
                                  return getHeatmapInlineStyle(hours, hasOpenSession, isWeekend, isFuture, hasRecord);
                                };
                                const cellStyle = getCellStyle();
                                
                                // When printing, render simple div without Tooltip wrapper
                                if (isPrinting) {
                                  return (
                                    <div
                                      key={idx}
                                      className={cellClassName}
                                      style={cellStyle}
                                      data-testid={`cell-${user.id}-${dateKey}`}
                                    >
                                      {cellContent}
                                    </div>
                                  );
                                }
                                
                                // Interactive mode with Tooltip
                                return (
                                  <Tooltip key={idx}>
                                    <TooltipTrigger asChild>
                                      <div
                                        className={`${cellClassName} cursor-pointer transition-opacity hover:opacity-80`}
                                        style={cellStyle}
                                        data-testid={`cell-${user.id}-${dateKey}`}
                                      >
                                        {cellContent}
                                      </div>
                                    </TooltipTrigger>
                                    <TooltipContent side="top" className="text-xs max-w-xs">
                                      <div className="font-medium">{toTitleCase(user.name)}</div>
                                      <div className="text-muted-foreground">{formatDate(day)}</div>
                                      
                                      {/* Show adjustment details if present */}
                                      {hasAdjustment && (
                                        <div className="mt-1 space-y-1 bg-purple-100 dark:bg-purple-900/30 p-2 rounded">
                                          <div className="text-purple-700 dark:text-purple-300 font-medium">
                                            {isLeaveAdjustment ? `Leave: ${leaveCode}` : 'Hours Override'}
                                          </div>
                                          {isLeaveAdjustment ? (
                                            <div>Payroll Hours: 9 (full day)</div>
                                          ) : (
                                            <>
                                              <div>Regular: {formatHours(adjustment?.regularHours || 0)} hrs</div>
                                              <div>OT: {formatHours(adjustment?.otHours || 0)} hrs</div>
                                            </>
                                          )}
                                          {adjustment?.notes && (
                                            <div className="text-muted-foreground italic">{adjustment.notes}</div>
                                          )}
                                          {hours > 0 && (
                                            <div className="text-muted-foreground">(Actual: {formatHours(hours)} hrs)</div>
                                          )}
                                        </div>
                                      )}
                                      
                                      {!hasAdjustment && aggData ? (
                                        <div className="mt-1 space-y-1">
                                          {recordCount > 1 && (
                                            <div className="text-yellow-600 dark:text-yellow-400 font-medium">
                                              {recordCount} clock-in entries
                                            </div>
                                          )}
                                          <div className="border-t pt-1 space-y-1">
                                            <div>Total Hours: {formatHours(hours)} hrs</div>
                                            {hasOpenSession && (
                                              <>
                                                <div className="text-blue-500 font-medium">Has active session</div>
                                                {isNexaAdmin && aggData.openSessionRecordId && (
                                                  <Button
                                                    size="sm"
                                                    variant="outline"
                                                    className="w-full h-7 mt-1 text-xs"
                                                    onClick={(e) => {
                                                      e.stopPropagation();
                                                      // Find the record and open the end clock-in dialog
                                                      const record = heatmapRawRecords.find(r => r.id === aggData.openSessionRecordId);
                                                      if (record) {
                                                        setSelectedRecord(record);
                                                        setEndClockOutTime("18:00");
                                                        setShowEndClockInDialog(true);
                                                      }
                                                    }}
                                                    data-testid={`button-end-clockin-heatmap-${user.id}-${dateKey}`}
                                                  >
                                                    <Clock className="h-3 w-3 mr-1" />
                                                    End Clock-in
                                                  </Button>
                                                )}
                                              </>
                                            )}
                                          </div>
                                        </div>
                                      ) : !hasAdjustment ? (
                                        <div className="text-muted-foreground">No record</div>
                                      ) : null}
                                      
                                      {/* Edit button for admins */}
                                      {!cannotEdit && (
                                        <Button
                                          size="sm"
                                          variant="outline"
                                          className="w-full h-7 mt-2 text-xs"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setEditModalData({
                                              userId: user.id,
                                              userName: toTitleCase(user.name) || 'Unknown',
                                              date: dateKey,
                                              actualHours: hours,
                                            });
                                            setShowEditModal(true);
                                          }}
                                          data-testid={`button-edit-attendance-${user.id}-${dateKey}`}
                                        >
                                          <Edit className="h-3 w-3 mr-1" />
                                          {hasAdjustment ? 'Edit Adjustment' : 'Add Adjustment'}
                                        </Button>
                                      )}
                                    </TooltipContent>
                                  </Tooltip>
                                );
                              })}
                            </div>
                            {/* Total hours column for this employee */}
                            {(() => {
                              const userTotalHours = heatmapDays.reduce((sum, day) => {
                                const today = new Date();
                                today.setHours(0, 0, 0, 0);
                                if (day > today) return sum;
                                const dateKey = getDateKey(day);
                                const aggData = heatmapDataMap[user.id]?.[dateKey];
                                return sum + (aggData?.totalHours || 0);
                              }, 0);
                              
                              const totalCellContent = userTotalHours > 0 ? formatHours(userTotalHours) : '-';
                              const totalCellClassName = "w-12 flex-shrink-0 min-h-[36px] flex items-center justify-center text-xs font-bold border-l";
                              const totalCellStyle: React.CSSProperties = { backgroundColor: '#e0f2fe' }; // Light blue for print
                              
                              // When printing, render simple div without Tooltip
                              if (isPrinting) {
                                return (
                                  <div 
                                    className={totalCellClassName}
                                    style={totalCellStyle}
                                    data-testid={`total-hours-${user.id}`}
                                  >
                                    {totalCellContent}
                                  </div>
                                );
                              }
                              
                              return (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <div 
                                      className={`${totalCellClassName} bg-primary/10 cursor-pointer hover:bg-primary/20`}
                                      data-testid={`total-hours-${user.id}`}
                                    >
                                      {totalCellContent}
                                    </div>
                                  </TooltipTrigger>
                                  <TooltipContent side="left" className="text-xs">
                                    <div className="font-medium">{toTitleCase(user.name)}</div>
                                    <div>Total hours this {heatmapViewType === 'week' ? 'week' : 'month'}: {formatHours(userTotalHours)} hrs</div>
                                  </TooltipContent>
                                </Tooltip>
                              );
                            })()}
                            {/* Remark column for this employee */}
                            {(() => {
                              const userRemark = remarksMap.get(user.id) || '';
                              const isEditing = editingRemarkUserId === user.id;
                              
                              // Editable remark cell
                              if (isEditing) {
                                return (
                                  <div className="w-52 flex-shrink-0 min-h-[36px] flex items-center p-1 border-l bg-muted/30">
                                    <Input
                                      value={editingRemarkValue}
                                      onChange={(e) => setEditingRemarkValue(e.target.value)}
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                          saveRemarkMutation.mutate({
                                            userId: user.id,
                                            year: heatmapMonth.year,
                                            month: heatmapMonth.month,
                                            remark: editingRemarkValue || null,
                                          });
                                        } else if (e.key === 'Escape') {
                                          setEditingRemarkUserId(null);
                                        }
                                      }}
                                      onBlur={() => {
                                        saveRemarkMutation.mutate({
                                          userId: user.id,
                                          year: heatmapMonth.year,
                                          month: heatmapMonth.month,
                                          remark: editingRemarkValue || null,
                                        });
                                      }}
                                      className="h-6 text-xs"
                                      placeholder="Enter remark..."
                                      autoFocus
                                      data-testid={`input-remark-${user.id}`}
                                    />
                                  </div>
                                );
                              }
                              
                              // Display mode - click to edit (not in print mode)
                              if (isPrinting) {
                                return (
                                  <div 
                                    className="w-52 flex-shrink-0 min-h-[36px] flex items-center p-1 text-xs border-l bg-muted/30"
                                    data-testid={`remark-${user.id}`}
                                  >
                                    <span className="truncate">{userRemark || '-'}</span>
                                  </div>
                                );
                              }
                              
                              return (
                                <div 
                                  className="w-52 flex-shrink-0 min-h-[36px] flex items-center p-1 text-xs border-l bg-muted/30 cursor-pointer hover:bg-muted/50"
                                  onClick={() => {
                                    if (!cannotEdit) {
                                      setEditingRemarkUserId(user.id);
                                      setEditingRemarkValue(userRemark);
                                    }
                                  }}
                                  data-testid={`remark-${user.id}`}
                                  title={cannotEdit ? 'View only' : 'Click to edit remark'}
                                >
                                  <span className="truncate">{userRemark || (cannotEdit ? '-' : 'Click to add...')}</span>
                                </div>
                              );
                            })()}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Summary stats */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-4 border-t">
                <div className="bg-muted/50 p-3 rounded-md">
                  <p className="text-xs text-muted-foreground mb-1">Total Employees</p>
                  <p className="text-xl font-bold" data-testid="text-heatmap-total-employees">
                    {filteredUsers.length}
                  </p>
                </div>
                <div className="bg-muted/50 p-3 rounded-md">
                  <p className="text-xs text-muted-foreground mb-1">Total Records</p>
                  <p className="text-xl font-bold" data-testid="text-heatmap-total-records">
                    {(() => {
                      // Use heatmapDataMap which has fallback logic
                      let total = 0;
                      filteredUsers.forEach(u => {
                        const userData = heatmapDataMap[u.id];
                        if (userData) {
                          Object.values(userData).forEach(dayData => {
                            total += dayData.recordCount;
                          });
                        }
                      });
                      return total;
                    })()}
                  </p>
                </div>
                <div className="bg-muted/50 p-3 rounded-md">
                  <p className="text-xs text-muted-foreground mb-1">Active This {heatmapViewType === 'week' ? 'Week' : 'Month'}</p>
                  <p className="text-xl font-bold" data-testid="text-heatmap-active">
                    {filteredUsers.filter(u => heatmapDataMap[u.id] && Object.keys(heatmapDataMap[u.id]).length > 0).length}
                  </p>
                </div>
                <div className="bg-muted/50 p-3 rounded-md">
                  <p className="text-xs text-muted-foreground mb-1">Working Days</p>
                  <p className="text-xl font-bold" data-testid="text-heatmap-working-days">
                    {heatmapDays.filter(d => {
                      const today = new Date();
                      today.setHours(23, 59, 59, 999);
                      return d.getDay() !== 0 && d.getDay() !== 6 && d <= today;
                    }).length}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </>
      ) : viewMode === 'details' ? (
        <>
          {/* Attendance Details View */}
          <Card>
            <CardHeader className="pb-4">
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                Attendance Details
              </CardTitle>
              <CardDescription>
                View detailed attendance record information and changes
              </CardDescription>
            </CardHeader>
            <CardContent>
              {auditLoading ? (
                <div className="text-center py-8 text-muted-foreground">Loading attendance details...</div>
              ) : auditLogs.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p className="text-lg font-medium">No attendance details yet</p>
                  <p className="text-sm">Attendance record changes will appear here</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {auditLogs.map((log) => {
                    const actionColor = log.action === 'create' 
                      ? 'text-green-600 dark:text-green-400' 
                      : log.action === 'delete' 
                        ? 'text-red-600 dark:text-red-400' 
                        : 'text-yellow-600 dark:text-yellow-400';
                    const actionIcon = log.action === 'create' 
                      ? <Plus className="h-4 w-4" /> 
                      : log.action === 'delete' 
                        ? <Trash2 className="h-4 w-4" /> 
                        : <FileText className="h-4 w-4" />;
                    
                    return (
                      <div
                        key={log.id}
                        className="border rounded-lg p-3 space-y-2"
                        data-testid={`details-log-${log.id}`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span className={`${actionColor}`}>{actionIcon}</span>
                            <span className={`font-medium capitalize ${actionColor}`}>{log.action}</span>
                            <span className="text-muted-foreground">attendance record</span>
                          </div>
                          <span className="text-xs text-muted-foreground whitespace-nowrap">
                            {new Date(log.changedAt).toLocaleString()}
                          </span>
                        </div>
                        
                        <div className="text-sm space-y-1">
                          {log.userName && (
                            <div className="flex items-center gap-2">
                              <span className="text-muted-foreground">Employee:</span>
                              <span className="font-medium">{log.userName}</span>
                              {log.employeeCode && (
                                <span className="text-xs text-muted-foreground">({log.employeeCode})</span>
                              )}
                            </div>
                          )}
                          
                          {log.changedBy && (
                            <div className="flex items-center gap-2">
                              <span className="text-muted-foreground">Changed by:</span>
                              <span className="font-medium">{log.changedBy === 'admin' ? 'nexaadmin' : log.changedBy}</span>
                            </div>
                          )}
                          
                          {log.fieldName && (
                            <div className="flex items-center gap-2">
                              <span className="text-muted-foreground">Field:</span>
                              <span>{log.fieldName}</span>
                            </div>
                          )}
                          
                          {(log.oldValue || log.newValue) && (
                            <div className="flex flex-wrap items-center gap-2 text-xs">
                              {log.oldValue && (
                                <span className="bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 px-2 py-0.5 rounded">
                                  Old: {log.oldValue}
                                </span>
                              )}
                              {log.newValue && (
                                <span className="bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 px-2 py-0.5 rounded">
                                  New: {log.newValue}
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      ) : null}

      {/* Add Attendance Dialog */}
      <Dialog open={showAddDialog} onOpenChange={(open) => {
        setShowAddDialog(open);
        if (!open) {
          setSelectedEmployee(null);
          setAddSearchQuery("");
          setClockInTime("09:00");
          setClockOutTime("");
          // Reset date to today
          const now = new Date();
          setSelectedDate(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`);
        }
      }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add Attendance Record</DialogTitle>
            <DialogDescription>
              Add attendance for an employee for any date
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {/* Date Selection */}
            <div className="space-y-2">
              <Label htmlFor="attendanceDate">Date</Label>
              <Input
                id="attendanceDate"
                type="date"
                value={selectedDate}
                onChange={(e) => {
                  setSelectedDate(e.target.value);
                  setSelectedEmployee(null);
                }}
                data-testid="input-attendance-date"
              />
            </div>

            {/* Employee Search */}
            <div className="space-y-2">
              <Label>Search Employee</Label>
              <Input
                placeholder="Type name, email, or employee code..."
                value={addSearchQuery}
                onChange={(e) => {
                  setAddSearchQuery(e.target.value);
                  setSelectedEmployee(null);
                }}
                data-testid="input-search-add-attendance"
              />
            </div>

            {/* Search Results */}
            {addSearchQuery.trim() !== "" && !selectedEmployee && (
              <div className="border rounded-lg max-h-48 overflow-auto">
                {addDialogFilteredEmployees.length === 0 ? (
                  <div className="p-3 text-sm text-muted-foreground text-center">
                    No matching employees found
                  </div>
                ) : (
                  <div className="divide-y">
                    {addDialogFilteredEmployees.map((emp) => {
                      const hasAttendance = employeeHasAttendanceOnDate(emp.id, selectedDate);
                      return (
                        <div
                          key={emp.id}
                          className={`p-3 cursor-pointer hover-elevate ${hasAttendance ? 'opacity-50' : ''}`}
                          onClick={() => {
                            if (!hasAttendance) {
                              setSelectedEmployee(emp);
                            }
                          }}
                          data-testid={`option-employee-${emp.id}`}
                        >
                          <div className="flex items-center justify-between">
                            <div>
                              <div className="font-medium">{emp.name}</div>
                              <div className="text-sm text-muted-foreground">
                                {emp.email} {emp.employeeCode && `· ${emp.employeeCode}`}
                              </div>
                            </div>
                            {hasAttendance && (
                              <span className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded">
                                Already has attendance
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Selected Employee */}
            {selectedEmployee && (
              <div className="p-3 bg-primary/5 rounded-lg border border-primary/20">
                <div className="text-sm text-muted-foreground">Selected Employee:</div>
                <div className="font-medium">{selectedEmployee.name}</div>
                <div className="text-sm text-muted-foreground">{selectedEmployee.email}</div>
              </div>
            )}

            {/* Time Inputs */}
            {selectedEmployee && (
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="clockIn">Clock In Time</Label>
                  <Input
                    id="clockIn"
                    type="time"
                    value={clockInTime}
                    onChange={(e) => setClockInTime(e.target.value)}
                    data-testid="input-clock-in-time"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="clockOut">Clock Out Time (Optional)</Label>
                  <Input
                    id="clockOut"
                    type="time"
                    value={clockOutTime}
                    onChange={(e) => setClockOutTime(e.target.value)}
                    data-testid="input-clock-out-time"
                  />
                </div>
              </div>
            )}

            <p className="text-xs text-muted-foreground">
              Note: This action will be recorded in the audit log.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleAddAttendance}
              disabled={!selectedEmployee || !clockInTime || addAttendanceMutation.isPending}
              data-testid="button-confirm-add-attendance"
            >
              {addAttendanceMutation.isPending ? "Adding..." : "Add Attendance"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* End Clock-in Dialog (nexaadmin only) */}
      <Dialog open={showEndClockInDialog} onOpenChange={(open) => {
        setShowEndClockInDialog(open);
        if (!open) {
          setSelectedRecord(null);
          setEndClockOutTime("18:00");
        }
      }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>End Clock-in</DialogTitle>
            <DialogDescription>
              Set the clock-out time for this attendance record
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {selectedRecord && (
              <>
                <div className="p-3 bg-muted/50 rounded-lg">
                  <div className="text-sm text-muted-foreground">Record Details:</div>
                  <div className="font-medium">
                    {users.find(u => u.id === selectedRecord.userId)?.name || 'Unknown Employee'}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    Date: {formatDate(selectedRecord.date)}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    Clock In: {formatTime(selectedRecord.clockInTime)}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="endClockOut">Clock Out Time</Label>
                  <Input
                    id="endClockOut"
                    type="time"
                    value={endClockOutTime}
                    onChange={(e) => setEndClockOutTime(e.target.value)}
                    data-testid="input-end-clock-out-time"
                  />
                </div>

                <p className="text-xs text-muted-foreground">
                  Note: Only master admin (nexaadmin) can end clock-ins. This action will be recorded in the audit log.
                </p>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEndClockInDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleEndClockIn}
              disabled={!selectedRecord || !endClockOutTime || endClockInMutation.isPending}
              data-testid="button-confirm-end-clockin"
            >
              {endClockInMutation.isPending ? "Saving..." : "Set Clock-out"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog (nexaadmin only) */}
      <AlertDialog open={showDeleteDialog} onOpenChange={(open) => {
        setShowDeleteDialog(open);
        if (!open) {
          setRecordToDelete(null);
        }
      }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Attendance Record</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this attendance record? This action cannot be undone and will be recorded in the audit log.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {recordToDelete && (
            <div className="p-3 bg-muted/50 rounded-lg text-sm">
              <div className="font-medium">
                {users.find(u => u.id === recordToDelete.userId)?.name || 'Unknown Employee'}
              </div>
              <div className="text-muted-foreground">
                Date: {formatDate(recordToDelete.date)}
              </div>
              <div className="text-muted-foreground">
                Clock In: {formatTime(recordToDelete.clockInTime)}
              </div>
              {recordToDelete.clockOutTime && (
                <div className="text-muted-foreground">
                  Clock Out: {formatTime(recordToDelete.clockOutTime)}
                </div>
              )}
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteAttendance}
              disabled={deleteAttendanceMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-delete"
            >
              {deleteAttendanceMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      
      {/* Unarchive Modal */}
      <Dialog open={showUnarchiveModal} onOpenChange={(open) => {
        setShowUnarchiveModal(open);
        if (!open) {
          setSelectedArchivedUsers(new Set());
        }
      }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ArchiveRestore className="h-5 w-5" />
              Unarchive Employees
            </DialogTitle>
            <DialogDescription>
              Select archived employees to restore them back to the active list.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 max-h-[400px] overflow-y-auto">
            {archivedUsersLoading ? (
              <div className="text-center py-4 text-muted-foreground">Loading archived employees...</div>
            ) : archivedUsers.length === 0 ? (
              <div className="text-center py-4 text-muted-foreground">No archived employees found</div>
            ) : (
              archivedUsers.map((user) => (
                <div
                  key={user.id}
                  className="flex items-center gap-3 p-3 border rounded-lg hover:bg-muted/30"
                  data-testid={`archived-user-${user.id}`}
                >
                  <Checkbox
                    checked={selectedArchivedUsers.has(user.id)}
                    onCheckedChange={() => toggleArchivedUserSelection(user.id)}
                    data-testid={`checkbox-archived-${user.id}`}
                  />
                  <div className="flex-1">
                    <div className="text-sm font-medium">{toTitleCase(user.name) || 'Unknown'}</div>
                    <div className="text-xs text-muted-foreground">
                      {user.employeeCode || 'No code'} | {user.department || 'No dept'}
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-destructive border-destructive/30"
                    onClick={(e) => {
                      e.stopPropagation();
                      setEmployeeToDelete(user);
                      setDeleteReason("");
                      setShowDeleteEmployeeDialog(true);
                    }}
                    data-testid={`button-delete-archived-${user.id}`}
                  >
                    <Trash2 className="h-3 w-3 mr-1" />
                    Delete
                  </Button>
                </div>
              ))
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowUnarchiveModal(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleUnarchiveSelected}
              disabled={selectedArchivedUsers.size === 0 || unarchiveUsersMutation.isPending}
              data-testid="button-confirm-unarchive"
            >
              {unarchiveUsersMutation.isPending ? "Unarchiving..." : `Unarchive (${selectedArchivedUsers.size})`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      {/* Delete Employee Confirmation Dialog */}
      <AlertDialog open={showDeleteEmployeeDialog} onOpenChange={(open) => {
        if (!open) {
          setShowDeleteEmployeeDialog(false);
          setEmployeeToDelete(null);
          setDeleteReason("");
        }
      }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="h-5 w-5" />
              Permanently Delete Employee
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-3">
              <span className="block">
                This will permanently delete <strong>{employeeToDelete?.name}</strong> ({employeeToDelete?.employeeCode || 'No code'}) and all associated data including:
              </span>
              <span className="block text-sm">
                Attendance records, leave data, payroll records, claims, documents, and audit logs.
              </span>
              <span className="block font-semibold text-destructive">
                This action cannot be undone. A record of the deletion will be kept in the audit trail.
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="delete-reason">Reason for Deletion (optional)</Label>
            <Textarea
              id="delete-reason"
              placeholder="Enter reason for deleting this employee..."
              value={deleteReason}
              onChange={(e) => setDeleteReason(e.target.value)}
              className="resize-none"
              rows={3}
              data-testid="input-delete-reason"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete-employee">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground"
              onClick={() => {
                if (employeeToDelete) {
                  deleteEmployeeMutation.mutate({
                    userId: employeeToDelete.id,
                    reason: deleteReason || undefined,
                  });
                }
              }}
              disabled={deleteEmployeeMutation.isPending}
              data-testid="button-confirm-delete-employee"
            >
              {deleteEmployeeMutation.isPending ? "Deleting..." : "Permanently Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Deletion History Dialog */}
      <Dialog open={showDeletionLogs} onOpenChange={setShowDeletionLogs}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <History className="h-5 w-5" />
              Employee Deletion History
            </DialogTitle>
            <DialogDescription>
              Audit trail of all permanently deleted employees with their details.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {deletionLogsLoading ? (
              <div className="text-center py-4 text-muted-foreground">Loading deletion logs...</div>
            ) : deletionLogs.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">No employees have been deleted yet.</div>
            ) : (
              <div className="space-y-3">
                {deletionLogs.map((log: any) => (
                  <Card key={log.id}>
                    <CardContent className="p-4">
                      <div className="flex flex-col gap-2">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <div>
                            <span className="font-semibold text-sm">{log.employee_name}</span>
                            {log.employee_code && (
                              <span className="text-xs text-muted-foreground ml-2">({log.employee_code})</span>
                            )}
                          </div>
                          <span className="text-xs text-muted-foreground">
                            {new Date(log.deleted_at).toLocaleString('en-SG', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1 text-xs text-muted-foreground">
                          {log.email && <div><span className="font-medium">Email:</span> {log.email}</div>}
                          {log.department && <div><span className="font-medium">Dept:</span> {log.department}</div>}
                          {log.designation && <div><span className="font-medium">Designation:</span> {log.designation}</div>}
                          {log.section && <div><span className="font-medium">Section:</span> {log.section}</div>}
                          {log.role && <div><span className="font-medium">Role:</span> {log.role}</div>}
                          {log.join_date && <div><span className="font-medium">Join Date:</span> {log.join_date}</div>}
                          {log.resign_date && <div><span className="font-medium">Resign Date:</span> {log.resign_date}</div>}
                          {log.residency_status && <div><span className="font-medium">Residency:</span> {log.residency_status}</div>}
                          {log.basic_monthly_salary && <div><span className="font-medium">Salary:</span> ${Number(log.basic_monthly_salary).toFixed(2)}</div>}
                          {log.nric_fin && <div><span className="font-medium">NRIC/FIN:</span> {log.nric_fin}</div>}
                        </div>
                        <div className="flex items-center justify-between gap-2 flex-wrap pt-1 border-t text-xs">
                          <div className="text-muted-foreground">
                            <span className="font-medium">Deleted by:</span> {log.deleted_by_name || log.deleted_by}
                          </div>
                          {log.reason && (
                            <div className="text-muted-foreground">
                              <span className="font-medium">Reason:</span> {log.reason}
                            </div>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Daily Report Dialog */}
      <Dialog open={showDailyReport} onOpenChange={setShowDailyReport}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Daily Attendance Report
            </DialogTitle>
            <DialogDescription>
              {new Date(clockInsDate + 'T00:00:00').toLocaleDateString('en-SG', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4" id="daily-report-content">
            {clockInsRecords.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                No attendance records for this date.
              </div>
            ) : (
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="p-2 text-left font-medium">S/N</th>
                    <th className="p-2 text-left font-medium">Employee</th>
                    <th className="p-2 text-left font-medium">Clock-in Time</th>
                    <th className="p-2 text-left font-medium">Clock-out Time</th>
                    <th className="p-2 text-left font-medium">Clock-in Location</th>
                    <th className="p-2 text-left font-medium">Clock-out Location</th>
                  </tr>
                </thead>
                <tbody>
                  {clockInsRecords
                    .sort((a, b) => new Date(a.clockInTime).getTime() - new Date(b.clockInTime).getTime())
                    .map((record, idx) => {
                      const user = users.find(u => u.id === record.userId);
                      return (
                        <tr key={record.id} className="border-b hover:bg-muted/30" data-testid={`daily-report-row-${record.id}`}>
                          <td className="p-2 text-muted-foreground">{idx + 1}</td>
                          <td className="p-2">
                            <div className="font-medium">{user?.name || 'Unknown'}</div>
                            <div className="text-xs text-muted-foreground">{user?.employeeCode || '-'}</div>
                          </td>
                          <td className="p-2">{formatTime(record.clockInTime)}</td>
                          <td className="p-2">{record.clockOutTime ? formatTime(record.clockOutTime) : <span className="text-blue-500">In Progress</span>}</td>
                          <td className="p-2">
                            <div className="max-w-[150px]">
                              {record.clockInLocationText || (record.latitude && record.longitude ? 'Location recorded' : 'No location')}
                            </div>
                          </td>
                          <td className="p-2">
                            <div className="max-w-[150px]">
                              {record.clockOutLocationText || (record.clockOutLatitude && record.clockOutLongitude ? 'Location recorded' : record.clockOutTime ? 'No location' : '-')}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            )}
          </div>
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDailyReport(false)}>
              Close
            </Button>
            <Button
              onClick={() => {
                const reportContent = document.getElementById('daily-report-content');
                if (reportContent) {
                  const printWindow = window.open('', '_blank');
                  if (printWindow) {
                    printWindow.document.write(`
                      <!DOCTYPE html>
                      <html>
                        <head>
                          <title>Daily Attendance Report - ${clockInsDate}</title>
                          <style>
                            body { font-family: system-ui, -apple-system, sans-serif; padding: 20px; }
                            h1 { font-size: 18px; margin-bottom: 5px; }
                            h2 { font-size: 14px; color: #666; margin-bottom: 20px; }
                            table { width: 100%; border-collapse: collapse; font-size: 12px; }
                            th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
                            th { background: #f5f5f5; font-weight: 600; }
                            tr:nth-child(even) { background: #fafafa; }
                            .in-progress { color: #3b82f6; }
                          </style>
                        </head>
                        <body>
                          <h1>Daily Attendance Report</h1>
                          <h2>${new Date(clockInsDate + 'T00:00:00').toLocaleDateString('en-SG', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</h2>
                          ${reportContent.innerHTML}
                        </body>
                      </html>
                    `);
                    printWindow.document.close();
                    printWindow.print();
                  }
                }
              }}
              data-testid="button-print-report"
            >
              <Printer className="h-4 w-4 mr-1" />
              Print Report
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      {/* Import Attendance Modal */}
      <Dialog open={showImportModal} onOpenChange={(open) => {
        if (!open) resetImportModal();
        else setShowImportModal(true);
      }}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileSpreadsheet className="h-5 w-5" />
              Import Attendance Data
            </DialogTitle>
            <DialogDescription>
              {importStep === 'upload' && "Upload an Excel file exported from this system to import attendance records."}
              {importStep === 'preview' && "Review the data below before importing. Green rows will be imported, red rows have issues."}
              {importStep === 'importing' && "Importing attendance records..."}
              {importStep === 'results' && "Import complete. See the results below."}
            </DialogDescription>
          </DialogHeader>
          
          {importStep === 'upload' && (
            <div className="space-y-4">
              <div className="border-2 border-dashed rounded-lg p-8 text-center">
                <FileSpreadsheet className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <p className="text-sm text-muted-foreground mb-4">
                  Upload an Excel file (.xlsx) exported from the attendance heatmap
                </p>
                <Label htmlFor="import-file" className="cursor-pointer">
                  <Button asChild>
                    <span>
                      <Upload className="h-4 w-4 mr-2" />
                      Select File
                    </span>
                  </Button>
                </Label>
                <Input
                  id="import-file"
                  type="file"
                  accept=".xlsx,.xls"
                  className="hidden"
                  onChange={handleImportFileChange}
                  data-testid="input-import-file"
                />
              </div>
              <div className="text-xs text-muted-foreground">
                <p className="font-medium mb-1">Expected file format:</p>
                <ul className="list-disc list-inside space-y-1">
                  <li>Row 1: Title (e.g., "Attendance Report - Dec 2025")</li>
                  <li>Row 2: Headers (S/N, Employee Name, Employee Code, Department, 1, 2, 3...)</li>
                  <li>Row 3: Day of week</li>
                  <li>Row 4+: Employee attendance data</li>
                </ul>
              </div>
            </div>
          )}
          
          {importStep === 'preview' && (
            <div className="space-y-4">
              {importFile && (
                <div className="flex items-center gap-2 p-2 bg-muted rounded-md">
                  <FileSpreadsheet className="h-4 w-4" />
                  <span className="text-sm font-medium">{importFile.name}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setImportFile(null);
                      setImportPreviewData([]);
                      setImportStep('upload');
                    }}
                    className="ml-auto"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              )}
              
              <div className="flex items-center gap-2">
                <Checkbox
                  id="overwrite-existing"
                  checked={importOverwrite}
                  onCheckedChange={(checked) => setImportOverwrite(checked as boolean)}
                  data-testid="checkbox-overwrite"
                />
                <Label htmlFor="overwrite-existing" className="text-sm">
                  Overwrite existing records (if unchecked, duplicate dates will be skipped)
                </Label>
              </div>
              
              <div className="border rounded-lg max-h-[300px] overflow-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted sticky top-0">
                    <tr>
                      <th className="p-2 text-left">Status</th>
                      <th className="p-2 text-left">Employee</th>
                      <th className="p-2 text-left">Code</th>
                      <th className="p-2 text-left">Date</th>
                      <th className="p-2 text-right">Hours</th>
                    </tr>
                  </thead>
                  <tbody>
                    {importPreviewData.map((row, idx) => (
                      <tr
                        key={idx}
                        className={row.status === 'matched' ? 'bg-green-50 dark:bg-green-950/20' : 'bg-red-50 dark:bg-red-950/20'}
                        data-testid={`import-preview-row-${idx}`}
                      >
                        <td className="p-2">
                          {row.status === 'matched' ? (
                            <CheckCircle2 className="h-4 w-4 text-green-600" />
                          ) : (
                            <AlertTriangle className="h-4 w-4 text-red-600" />
                          )}
                        </td>
                        <td className="p-2">{row.employeeName}</td>
                        <td className="p-2 text-muted-foreground">{row.employeeCode || '-'}</td>
                        <td className="p-2">{row.date}</td>
                        <td className="p-2 text-right">{row.hours}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              
              <div className="flex justify-between text-sm">
                <div className="text-muted-foreground">
                  {importPreviewData.length} records found
                </div>
                <div className="flex gap-4">
                  <span className="text-green-600">
                    {importPreviewData.filter(r => r.status === 'matched').length} matched
                  </span>
                  <span className="text-red-600">
                    {importPreviewData.filter(r => r.status === 'not_found').length} not found
                  </span>
                </div>
              </div>
            </div>
          )}
          
          {importStep === 'importing' && (
            <div className="py-12 text-center">
              <Loader2 className="h-12 w-12 mx-auto animate-spin text-primary mb-4" />
              <p className="text-muted-foreground">Importing attendance records...</p>
            </div>
          )}
          
          {importStep === 'results' && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-4 text-center">
                <div className="p-4 bg-muted rounded-lg">
                  <div className="text-2xl font-bold">{importResults.length}</div>
                  <div className="text-sm text-muted-foreground">Total</div>
                </div>
                <div className="p-4 bg-green-100 dark:bg-green-950/30 rounded-lg">
                  <div className="text-2xl font-bold text-green-600">{importResults.filter(r => r.success).length}</div>
                  <div className="text-sm text-green-600">Successful</div>
                </div>
                <div className="p-4 bg-red-100 dark:bg-red-950/30 rounded-lg">
                  <div className="text-2xl font-bold text-red-600">{importResults.filter(r => !r.success).length}</div>
                  <div className="text-sm text-red-600">Failed</div>
                </div>
              </div>
              
              {importResults.filter(r => !r.success).length > 0 && (
                <div className="border rounded-lg max-h-[200px] overflow-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted sticky top-0">
                      <tr>
                        <th className="p-2 text-left">Employee</th>
                        <th className="p-2 text-left">Date</th>
                        <th className="p-2 text-left">Error</th>
                      </tr>
                    </thead>
                    <tbody>
                      {importResults.filter(r => !r.success).map((row, idx) => (
                        <tr key={idx} className="border-t">
                          <td className="p-2">{row.employeeName}</td>
                          <td className="p-2">{row.date}</td>
                          <td className="p-2 text-red-600">{row.error}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
          
          <DialogFooter>
            {importStep === 'upload' && (
              <Button variant="outline" onClick={resetImportModal}>
                Cancel
              </Button>
            )}
            {importStep === 'preview' && (
              <>
                <Button variant="outline" onClick={() => setImportStep('upload')}>
                  Back
                </Button>
                <Button
                  onClick={executeImport}
                  disabled={importPreviewData.filter(r => r.status === 'matched').length === 0}
                  data-testid="button-confirm-import"
                >
                  Import {importPreviewData.filter(r => r.status === 'matched').length} Records
                </Button>
              </>
            )}
            {importStep === 'results' && (
              <Button onClick={resetImportModal} data-testid="button-close-import">
                Close
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      {/* Attendance Edit Modal for adjustments (leave/OT override) */}
      {editModalData && (
        <AttendanceEditModal
          open={showEditModal}
          onOpenChange={(open) => {
            setShowEditModal(open);
            if (!open) setEditModalData(null);
          }}
          userId={editModalData.userId}
          userName={editModalData.userName}
          date={editModalData.date}
          actualHours={editModalData.actualHours}
          existingAdjustment={adjustmentsMap.get(`${editModalData.userId}-${editModalData.date}`)}
          onSuccess={() => {
            refetchAdjustments();
            refetchHeatmapRecords();
          }}
        />
      )}
    </div>
  );
}
