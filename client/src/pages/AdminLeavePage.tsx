import { useState, useRef, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toTitleCase } from "@/lib/utils";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Calendar, ArrowLeft, Plus, CheckCircle, XCircle, Upload, BarChart3, PieChart as PieChartIcon, Download, Users, TrendingUp, FileText, AlertTriangle, Printer, Settings, History, Pencil, Trash2, Eye, ChevronDown, ChevronUp } from "lucide-react";
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { Link } from "wouter";
import type { User, LeaveBalance, LeaveApplication, LeaveHistory, LeaveTypeRow } from "@shared/schema";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

interface LeaveHistoryRecord {
  employeeCode: string;
  employeeName: string;
  leaveType: string;
  leaveDate: string;
  dayOfWeek?: string;
  remarks?: string;
  daysOrHours: string;
  mlClaimAmount?: number;
  year: number;
}

interface AnalyticsData {
  year: number;
  stats: { leaveType: string; totalDays: number; count: number }[];
  uniqueEmployees: number;
  totalRecords: number;
  monthlyData: Record<string, Record<string, number>>;
  employeeUtilization: Record<string, { name: string; total: number; byType: Record<string, number> }>;
}

interface LeaveAuditLog {
  id: string;
  action: string;
  tableName: string;
  recordId?: string;
  employeeCode?: string;
  employeeName?: string;
  fieldName?: string;
  oldValue?: string;
  newValue?: string;
  details?: string;
  changedBy: string;
  changedAt: string;
}

const CHART_COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884D8', '#82CA9D', '#FFC658', '#FF6B6B'];

export default function AdminLeavePage() {
  const { toast } = useToast();
  const [balanceDialogOpen, setBalanceDialogOpen] = useState(false);
  const [reviewDialogOpen, setReviewDialogOpen] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [leaveType, setLeaveType] = useState("");
  const [totalDays, setTotalDays] = useState("");
  const [selectedApplication, setSelectedApplication] = useState<LeaveApplication | null>(null);
  const [reviewComments, setReviewComments] = useState("");
  const [approvedDays, setApprovedDays] = useState<string>("");

  // Prefill approvedDays with the requested totalDays whenever the review modal opens
  useEffect(() => {
    if (selectedApplication) {
      setApprovedDays(String(selectedApplication.totalDays));
    } else {
      setApprovedDays("");
    }
  }, [selectedApplication]);
  
  // Analytics state
  const [analyticsYear, setAnalyticsYear] = useState(new Date().getFullYear());
  const [parsedRecords, setParsedRecords] = useState<LeaveHistoryRecord[]>([]);
  const [csvFileName, setCsvFileName] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Edit/Delete leave history state
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedHistoryRecord, setSelectedHistoryRecord] = useState<LeaveHistory | null>(null);
  const [expandedEmployee, setExpandedEmployee] = useState<string | null>(null);
  
  // Edit form state
  const [editLeaveType, setEditLeaveType] = useState("");
  const [editLeaveDate, setEditLeaveDate] = useState("");
  const [editDaysOrHours, setEditDaysOrHours] = useState("");
  const [editRemarks, setEditRemarks] = useState("");
  
  // Diagnostic dialog state
  const [diagnosticOpen, setDiagnosticOpen] = useState(false);
  const [diagnosticData, setDiagnosticData] = useState<{
    total: number;
    matchedCount: number;
    unmatchedCount: number;
    matched: { code: string; importName: string; recordCount: number; systemName: string | null; systemCode: string | null; matchMethod: 'code' | 'name' | null }[];
    unmatched: { code: string; importName: string; recordCount: number }[];
    totalRecordsMatched: number;
    totalRecordsUnmatched: number;
  } | null>(null);
  const [diagnosticLoading, setDiagnosticLoading] = useState(false);

  // Fetch all approved users
  const { data: usersData } = useQuery<{ users: User[] }>({
    queryKey: ['/api/admin/users'],
  });

  // Fetch all leave balances (all years combined)
  const { data: balancesData, isLoading: balancesLoading } = useQuery<{ balances: LeaveBalance[] }>({
    queryKey: ['/api/admin/leave/balances'],
  });

  // Fetch all leave applications
  const { data: applicationsData, isLoading: applicationsLoading } = useQuery<{ applications: LeaveApplication[] }>({
    queryKey: ['/api/admin/leave/applications'],
  });

  const users = usersData?.users?.filter(u => u.isApproved && !u.isArchived && !u.role?.includes('admin')) || [];
  const balances = balancesData?.balances || [];
  const applications = applicationsData?.applications || [];

  // Fetch analytics data
  const { data: analyticsData, isLoading: analyticsLoading } = useQuery<AnalyticsData>({
    queryKey: ['/api/admin/leave/analytics', analyticsYear],
  });

  // Fetch leave audit logs
  const { data: auditLogsData, isLoading: auditLogsLoading } = useQuery<{ logs: LeaveAuditLog[] }>({
    queryKey: ['/api/admin/leave/audit-logs'],
  });

  const auditLogs = auditLogsData?.logs || [];
  
  // Fetch session to check if current user is view-only admin
  const { data: sessionData } = useQuery<{ authenticated: boolean; isAdmin: boolean; isViewOnlyAdmin?: boolean }>({
    queryKey: ["/api/auth/session"],
  });
  
  const isViewOnlyAdmin = sessionData?.isViewOnlyAdmin === true;
  
  // Fetch leave history records for the selected year
  const { data: historyData, isLoading: historyLoading } = useQuery<{ records: LeaveHistory[] }>({
    queryKey: ['/api/admin/leave/history', analyticsYear],
  });
  
  const historyRecords = historyData?.records || [];

  // Active leave types for the Set Balance dropdown
  const { data: leaveTypesData } = useQuery<{ leaveTypes: LeaveTypeRow[] }>({
    queryKey: ['/api/leave-types'],
  });
  const leaveTypeOptions = leaveTypesData?.leaveTypes || [];

  // Import leave history mutation
  const importMutation = useMutation({
    mutationFn: async (records: LeaveHistoryRecord[]) => {
      const res = await apiRequest("POST", "/api/admin/leave/history/import", {
        records,
        replaceExisting: false,
      });
      return res.json() as Promise<{ imported: number; skipped?: number; balancesSynced?: number; message?: string }>;
    },
    onSuccess: (data) => {
      toast({
        title: "Import Complete",
        description: data.message || `Imported ${data.imported} leave records`,
      });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/leave/analytics', analyticsYear] });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/leave/audit-logs'] });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/leave/balances'] });
      setParsedRecords([]);
      setCsvFileName("");
      if (fileInputRef.current) fileInputRef.current.value = "";
    },
    onError: (error: Error) => {
      toast({
        title: "Import Error",
        description: error.message || "Failed to import leave records",
        variant: "destructive",
      });
    },
  });
  
  // Update leave history mutation
  const updateHistoryMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: { leaveType?: string; leaveDate?: string; daysOrHours?: string; remarks?: string } }) => {
      return apiRequest("PATCH", `/api/admin/leave/history/${id}`, data);
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Leave record updated successfully",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/leave/history', analyticsYear] });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/leave/analytics', analyticsYear] });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/leave/audit-logs'] });
      setEditDialogOpen(false);
      setSelectedHistoryRecord(null);
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update leave record",
        variant: "destructive",
      });
    },
  });
  
  // Delete leave history mutation
  const deleteHistoryMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/admin/leave/history/${id}`);
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Leave record deleted successfully",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/leave/history', analyticsYear] });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/leave/analytics', analyticsYear] });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/leave/audit-logs'] });
      setDeleteDialogOpen(false);
      setSelectedHistoryRecord(null);
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete leave record",
        variant: "destructive",
      });
    },
  });

  const parseDate = (dateStr: string): { formatted: string; year: number } | null => {
    const ddmmyyyy = dateStr.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
    if (ddmmyyyy) {
      const [, d, m, y] = ddmmyyyy;
      return { formatted: `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`, year: parseInt(y) };
    }
    const yyyymmdd = dateStr.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
    if (yyyymmdd) {
      const [, y, m, d] = yyyymmdd;
      return { formatted: `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`, year: parseInt(y) };
    }
    return null;
  };

  const normalizeLeaveType = (raw: string): string => {
    const upper = raw.trim().toUpperCase();
    const mapping: Record<string, string> = {
      'ANNUAL LEAVE': 'AL', 'ANNUAL': 'AL',
      'MEDICAL LEAVE': 'ML', 'MEDICAL': 'ML', 'SICK LEAVE': 'ML', 'SICK': 'ML',
      'COMPASSIONATE LEAVE': 'CL', 'COMPASSIONATE': 'CL',
      'OFF IN LIEU': 'OIL', 'OFF-IN-LIEU': 'OIL', 'TIME OFF IN LIEU': 'OIL',
      'UNPAID LEAVE': 'UL', 'UNPAID': 'UL', 'NO PAY LEAVE': 'UL',
      'MATERNITY LEAVE': 'MTL', 'MATERNITY': 'MTL',
      'PATERNITY LEAVE': 'PL', 'PATERNITY': 'PL',
      'HOSPITALIZATION LEAVE': 'HL', 'HOSPITALIZATION': 'HL',
    };
    if (/^[A-Z]{2,4}(FH|SH)?$/.test(upper)) return upper;
    for (const [key, val] of Object.entries(mapping)) {
      if (upper === key || upper.includes(key)) return val;
    }
    const abbrevMatch = upper.match(/^([A-Z]{2,4})\s*[-–]\s*/);
    if (abbrevMatch) return abbrevMatch[1];
    return upper.substring(0, 4);
  };

  const parseFlatCSV = (lines: string[]): LeaveHistoryRecord[] => {
    const records: LeaveHistoryRecord[] = [];
    if (lines.length < 2) return records;

    const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/['"]/g, ''));

    const findCol = (keywords: string[]): number => {
      for (const kw of keywords) {
        const idx = headers.findIndex(h => h.includes(kw));
        if (idx >= 0) return idx;
      }
      return -1;
    };

    const codeCol = findCol(['emp code', 'employee code', 'emp_code', 'employee_code', 'empcode', 'code', 'emp no', 'emp_no', 'empno', 'employee no', 'employee_no', 'id']);
    const nameCol = findCol(['emp name', 'employee name', 'emp_name', 'employee_name', 'empname', 'name']);
    const typeCol = findCol(['leave type', 'leave_type', 'leavetype', 'type']);
    const dateCol = findCol(['date', 'leave date', 'leave_date', 'leavedate', 'from', 'start']);
    const daysCol = findCol(['days', 'day', 'hours', 'duration', 'days_or_hours', 'qty', 'quantity']);
    const remarksCol = findCol(['remarks', 'remark', 'notes', 'note', 'comment', 'comments', 'reason']);

    if (dateCol < 0 || typeCol < 0) return records;
    if (codeCol < 0 && nameCol < 0) return records;

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const cols = line.split(',').map(c => c.trim().replace(/^["']|["']$/g, ''));

      const dateStr = cols[dateCol] || '';
      const parsed = parseDate(dateStr);
      if (!parsed) continue;

      const leaveTypeRaw = cols[typeCol] || '';
      if (!leaveTypeRaw) continue;
      const leaveType = normalizeLeaveType(leaveTypeRaw);

      const empCode = codeCol >= 0 ? (cols[codeCol] || '') : '';
      const empName = nameCol >= 0 ? (cols[nameCol] || '') : '';
      if (!empCode && !empName) continue;

      let daysOrHours = '1.00 day';
      if (daysCol >= 0 && cols[daysCol]) {
        const val = cols[daysCol].trim();
        if (/^\d+\.?\d*$/.test(val)) {
          daysOrHours = `${parseFloat(val).toFixed(2)} day`;
        } else {
          daysOrHours = val;
        }
      }

      const remarks = remarksCol >= 0 ? (cols[remarksCol] || undefined) : undefined;

      records.push({
        employeeCode: empCode,
        employeeName: empName,
        leaveType,
        leaveDate: parsed.formatted,
        dayOfWeek: '',
        remarks,
        daysOrHours,
        year: parsed.year,
      });
    }
    return records;
  };

  const parse3SICSV = (lines: string[]): LeaveHistoryRecord[] => {
    const records: LeaveHistoryRecord[] = [];
    let currentEmployeeCode = "";
    let currentEmployeeName = "";
    let currentLeaveType = "";
    
    for (const line of lines) {
      const columns = line.split(',').map(col => col.trim());
      const fullLine = columns.join(' ');
      
      if (!fullLine.replace(/,/g, '').trim()) continue;
      
      if (fullLine.includes("Emp Code:") && fullLine.includes("Employee:")) {
        const empCodeMatch = fullLine.match(/Emp Code:\s*(\w+)/);
        const empNameMatch = fullLine.match(/Employee:\s*([A-Z\s@.]+?)(?:\s{2,}|Leave)/i);
        
        if (empCodeMatch) currentEmployeeCode = empCodeMatch[1];
        if (empNameMatch) currentEmployeeName = empNameMatch[1].trim();
        continue;
      }
      
      if (fullLine.includes("Leave Type:")) {
        const typeMatch = fullLine.match(/([A-Z]{2,4})\s*-\s*[A-Z\s]+/i);
        if (typeMatch) currentLeaveType = typeMatch[1].toUpperCase();
        continue;
      }
      
      if (fullLine.includes("S No.") || fullLine.includes("Total :") || 
          fullLine.includes("ML Claims") || fullLine.includes("Total Leave:") ||
          fullLine.includes("Eligible") || fullLine.includes("Credit") ||
          fullLine.includes("Bring Fwd") || fullLine.includes("Earned") ||
          fullLine.includes("Balance") || fullLine.includes("Leave History Report") ||
          fullLine.includes("Period From:") || fullLine.includes("Date :") ||
          fullLine.includes("Page :") || fullLine.includes("Unnamed:")) {
        continue;
      }
      
      const dateMatch = fullLine.match(/(\d{2})-(\d{2})-(\d{4})/);
      const daysMatch = fullLine.match(/([\d.]+)\s*day/i);
      const rowNum = parseInt(columns[1] || columns[0]);
      
      if (dateMatch && currentEmployeeCode && currentLeaveType && !isNaN(rowNum)) {
        const [, day, month, year] = dateMatch;
        const leaveDate = `${year}-${month}-${day}`;
        const daysOrHours = daysMatch ? daysMatch[0].trim() : '1.00 day';
        
        let dayOfWeek = "";
        for (const col of columns) {
          if (/^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)$/i.test(col)) {
            dayOfWeek = col;
            break;
          }
        }
        
        const remarksCol = columns.find((col, idx) => 
          idx > 10 && col.length > 2 && 
          !/^\d/.test(col) && 
          !/day$/i.test(col) &&
          !/(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)/i.test(col)
        );
        
        records.push({
          employeeCode: currentEmployeeCode,
          employeeName: currentEmployeeName,
          leaveType: currentLeaveType,
          leaveDate,
          dayOfWeek,
          remarks: remarksCol || undefined,
          daysOrHours,
          year: parseInt(year),
        });
      }
    }
    return records;
  };

  const parseCSV = (text: string): LeaveHistoryRecord[] => {
    const lines = text.split('\n').filter(l => l.trim());
    if (lines.length === 0) return [];

    const firstFewLines = lines.slice(0, 5).join(' ').toLowerCase();
    const is3SI = firstFewLines.includes('emp code:') || 
                  firstFewLines.includes('leave history report') ||
                  firstFewLines.includes('leave type:') ||
                  firstFewLines.includes('period from:');

    if (is3SI) {
      const result = parse3SICSV(lines);
      if (result.length > 0) return result;
    }

    const flatResult = parseFlatCSV(lines);
    if (flatResult.length > 0) return flatResult;

    if (!is3SI) {
      return parse3SICSV(lines);
    }

    return [];
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    
    setCsvFileName(file.name);
    const fileExt = file.name.toLowerCase().split('.').pop();
    
    // For Excel files, use server-side parsing
    if (fileExt === 'xls' || fileExt === 'xlsx') {
      const reader = new FileReader();
      reader.onload = async (e) => {
        const arrayBuffer = e.target?.result as ArrayBuffer;
        const base64 = btoa(
          new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
        );
        
        try {
          const res = await apiRequest('POST', '/api/admin/leave/history/parse-excel', { 
            fileBase64: base64, 
            fileName: file.name 
          });
          const response = await res.json();
          
          if (response.success && response.records) {
            setParsedRecords(response.records);
            toast({
              title: "Excel File Parsed",
              description: `Found ${response.records.length} leave records from ${response.summary?.uniqueEmployees || 0} employees`,
            });
          } else {
            toast({
              title: "Parse Error",
              description: response.message || "Could not parse leave records from the file",
              variant: "destructive",
            });
          }
        } catch (error: any) {
          toast({
            title: "Parse Error",
            description: error.message || "Failed to parse Excel file",
            variant: "destructive",
          });
        }
      };
      reader.readAsArrayBuffer(file);
    } else {
      // For CSV files, use client-side parsing
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target?.result as string;
        const records = parseCSV(text);
        setParsedRecords(records);
        
        if (records.length === 0) {
          toast({
            title: "No Records Found",
            description: "Could not parse any leave records from the file. Please check the format.",
            variant: "destructive",
          });
        } else {
          toast({
            title: "File Parsed",
            description: `Found ${records.length} leave records ready to import`,
          });
        }
      };
      reader.readAsText(file);
    }
  };

  const checkMatches = async (records: LeaveHistoryRecord[]) => {
    setDiagnosticLoading(true);
    try {
      const employeeMap = new Map<string, { name: string; count: number }>();
      records.forEach(r => {
        const existing = employeeMap.get(r.employeeCode);
        if (existing) {
          existing.count++;
        } else {
          employeeMap.set(r.employeeCode, { name: r.employeeName, count: 1 });
        }
      });

      const employeeCodes = Array.from(employeeMap.entries()).map(([code, data]) => ({
        code,
        name: data.name,
        recordCount: data.count,
      }));

      const res = await apiRequest('POST', '/api/admin/leave/history/check-matches', { employeeCodes });
      const data = await res.json();
      setDiagnosticData(data);
      setDiagnosticOpen(true);
    } catch (error: any) {
      toast({
        title: "Match Check Failed",
        description: error.message || "Could not check employee matches",
        variant: "destructive",
      });
    } finally {
      setDiagnosticLoading(false);
    }
  };

  const handleImport = () => {
    if (parsedRecords.length === 0) return;
    importMutation.mutate(parsedRecords);
  };

  // Prepare chart data
  const pieChartData = analyticsData?.stats?.map(s => ({
    name: s.leaveType,
    value: s.totalDays,
    count: s.count,
  })) || [];

  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const barChartData = monthNames.map((month, idx) => {
    const monthKey = `${analyticsYear}-${String(idx + 1).padStart(2, '0')}`;
    const monthData = analyticsData?.monthlyData?.[monthKey] || {};
    return {
      month,
      ...monthData,
      total: Object.values(monthData).reduce((sum: number, val) => sum + (val as number), 0),
    };
  });

  const employeeUtilizationList = Object.entries(analyticsData?.employeeUtilization || {})
    .map(([code, data]) => ({ code, ...data }))
    .sort((a, b) => b.total - a.total);

  const totalDaysTaken = analyticsData?.stats?.reduce((sum, s) => sum + s.totalDays, 0) || 0;

  // Export balances to CSV
  const exportBalancesToCSV = () => {
    if (balances.length === 0) return;
    
    const headers = ['Employee', 'Leave Type', 'Brought Fwd', 'Earned', 'Eligible', 'Taken', 'Balance'];
    const rows = balances.map(b => [
      toTitleCase(b.employeeName || getUserName(b.userId)),
      b.leaveType,
      b.broughtForward,
      b.earned,
      b.eligible,
      b.taken,
      b.balance,
    ]);
    
    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'leave-balances.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  // Print function
  const handlePrint = () => {
    window.print();
  };

  // Export CSV function
  const exportToCSV = () => {
    if (!analyticsData || employeeUtilizationList.length === 0) return;
    
    const leaveTypes = Array.from(new Set(analyticsData.stats.map(s => s.leaveType)));
    const headers = ['Employee Code', 'Employee Name', ...leaveTypes, 'Total Days'];
    
    const rows = employeeUtilizationList.map(emp => [
      emp.code,
      toTitleCase(emp.name),
      ...leaveTypes.map(lt => emp.byType[lt]?.toString() || '0'),
      emp.total.toString(),
    ]);
    
    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `leave-analytics-${analyticsYear}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const setBalanceMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", "/api/admin/leave/balances", {
        userId: selectedUserId,
        leaveType,
        totalDays: parseFloat(totalDays),
      });
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Leave balance updated successfully",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/leave/balances'] });
      setBalanceDialogOpen(false);
      setSelectedUserId("");
      setLeaveType("");
      setTotalDays("");
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update leave balance",
        variant: "destructive",
      });
    },
  });

  const reviewMutation = useMutation({
    mutationFn: async ({ applicationId, status, approvedDays }: { applicationId: string; status: "approved" | "rejected"; approvedDays?: number }) => {
      return apiRequest("PATCH", `/api/admin/leave/applications/${applicationId}`, {
        status,
        reviewComments: reviewComments || undefined,
        approvedDays,
      });
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Leave application reviewed successfully",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/leave/applications'] });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/leave/balances'] });
      setReviewDialogOpen(false);
      setSelectedApplication(null);
      setReviewComments("");
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to review leave application",
        variant: "destructive",
      });
    },
  });

  const handleSetBalance = () => {
    if (!selectedUserId || !leaveType || !totalDays) {
      toast({
        title: "Error",
        description: "Please fill in all fields",
        variant: "destructive",
      });
      return;
    }
    setBalanceMutation.mutate();
  };

  const handleReviewApplication = (status: "approved" | "rejected") => {
    if (!selectedApplication) return;
    if (status === "approved") {
      const days = parseFloat(approvedDays);
      if (Number.isNaN(days) || days < 0) {
        toast({
          title: "Invalid approved days",
          description: "Enter a non-negative number for the days to deduct.",
          variant: "destructive",
        });
        return;
      }
      reviewMutation.mutate({ applicationId: selectedApplication.id, status, approvedDays: days });
    } else {
      reviewMutation.mutate({ applicationId: selectedApplication.id, status });
    }
  };

  const getUserName = (userId: string) => {
    const user = users.find(u => u.id === userId);
    return toTitleCase(user?.name) || user?.username || "Unknown User";
  };
  
  // Handle opening edit dialog
  const handleOpenEdit = (record: LeaveHistory) => {
    setSelectedHistoryRecord(record);
    setEditLeaveType(record.leaveType);
    setEditLeaveDate(record.leaveDate);
    setEditDaysOrHours(record.daysOrHours);
    setEditRemarks(record.remarks || "");
    setEditDialogOpen(true);
  };
  
  // Handle saving edit
  const handleSaveEdit = () => {
    if (!selectedHistoryRecord) return;
    updateHistoryMutation.mutate({
      id: selectedHistoryRecord.id,
      data: {
        leaveType: editLeaveType,
        leaveDate: editLeaveDate,
        daysOrHours: editDaysOrHours,
        remarks: editRemarks || undefined,
      },
    });
  };
  
  // Handle opening delete dialog
  const handleOpenDelete = (record: LeaveHistory) => {
    setSelectedHistoryRecord(record);
    setDeleteDialogOpen(true);
  };
  
  // Handle confirming delete
  const handleConfirmDelete = () => {
    if (!selectedHistoryRecord) return;
    deleteHistoryMutation.mutate(selectedHistoryRecord.id);
  };
  
  // Get leave records for a specific employee
  const getEmployeeRecords = (employeeCode: string) => {
    return historyRecords.filter(r => r.employeeCode === employeeCode);
  };

  // Low balance alerts - employees with less than 20% of total leave remaining (or overdrawn)
  const lowBalanceAlerts = balances.filter(b => {
    const remaining = parseFloat(b.balance || '0');
    const eligible = parseFloat(b.eligible || '0');
    const percentRemaining = eligible > 0 ? (remaining / eligible) * 100 : 100;
    return percentRemaining <= 20;
  }).map(b => {
    const remaining = parseFloat(b.balance || '0');
    const eligible = parseFloat(b.eligible || '0');
    return {
      ...b,
      remaining: Math.max(0, remaining),
      percentRemaining: eligible > 0 ? Math.max(0, (remaining / eligible) * 100) : 100,
      userName: toTitleCase(b.employeeName) || getUserName(b.userId),
      isOverdrawn: remaining < 0,
    };
  });

  // Group balances by user
  const balancesByUser = balances.reduce((acc, balance) => {
    if (!acc[balance.userId]) {
      acc[balance.userId] = [];
    }
    acc[balance.userId].push(balance);
    return acc;
  }, {} as Record<string, LeaveBalance[]>);

  const pendingApplications = applications.filter(app => app.status === "pending");
  const reviewedApplications = applications.filter(app => app.status !== "pending");

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-semibold mb-2" data-testid="text-admin-leave-title">
            Leave Management
          </h1>
          <p className="text-sm text-muted-foreground">
            Manage employee leave balances and review applications
          </p>
        </div>
        <Link href="/admin/dashboard">
          <Button variant="outline" data-testid="button-back-dashboard">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Dashboard
          </Button>
        </Link>
      </div>

      <Tabs defaultValue="balances" className="space-y-6">
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="balances" data-testid="tab-balances">
            Leave Balances
            {lowBalanceAlerts.length > 0 && (
              <Badge variant="outline" className="ml-2 border-orange-500 text-orange-600">
                <AlertTriangle className="h-3 w-3 mr-1" />
                {lowBalanceAlerts.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="applications" data-testid="tab-applications">
            Applications
            {pendingApplications.length > 0 && (
              <Badge variant="destructive" className="ml-2">
                {pendingApplications.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="analytics" data-testid="tab-analytics">
            <BarChart3 className="mr-2 h-4 w-4" />
            Analytics
          </TabsTrigger>
          <TabsTrigger value="settings" data-testid="tab-leave-settings">
            <Settings className="mr-2 h-4 w-4" />
            Settings
          </TabsTrigger>
          <TabsTrigger value="logs" data-testid="tab-leave-logs">
            <History className="mr-2 h-4 w-4" />
            Logs
          </TabsTrigger>
        </TabsList>

        <TabsContent value="balances" className="space-y-6">
          {/* Low Balance Alerts */}
          {lowBalanceAlerts.length > 0 && (
            <Card className="border-orange-200 dark:border-orange-900" data-testid="card-low-balance-alerts">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-orange-600">
                  <AlertTriangle className="h-5 w-5" />
                  Low Balance Alerts
                </CardTitle>
                <CardDescription>Employees with 20% or less leave remaining</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {lowBalanceAlerts.map((alert) => (
                    <div 
                      key={alert.id} 
                      className="flex items-center justify-between p-3 rounded-lg bg-orange-50 dark:bg-orange-950/30"
                      data-testid={`alert-low-balance-${alert.id}`}
                    >
                      <div className="flex items-center gap-3">
                        <AlertTriangle className="h-4 w-4 text-orange-500" />
                        <div>
                          <p className="font-medium">{alert.userName}</p>
                          <p className="text-sm text-muted-foreground">{alert.leaveType}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <Badge variant="outline" className="border-orange-500 text-orange-600">
                          {alert.remaining.toFixed(1)} / {alert.eligible} days
                        </Badge>
                        <p className="text-xs text-muted-foreground mt-1">
                          {alert.percentRemaining.toFixed(0)}% remaining
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Set Leave Balance */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Calendar className="h-5 w-5" />
                Set Leave Balance
              </CardTitle>
              <CardDescription>Configure leave entitlements for employees</CardDescription>
            </CardHeader>
            <CardContent>
              <Dialog open={balanceDialogOpen} onOpenChange={setBalanceDialogOpen}>
                <DialogTrigger asChild>
                  <Button data-testid="button-set-leave-balance">
                    <Plus className="mr-2 h-4 w-4" />
                    Set Leave Balance
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Set Employee Leave Balance</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="user-select">Employee</Label>
                      <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                        <SelectTrigger id="user-select" data-testid="select-user">
                          <SelectValue placeholder="Select employee" />
                        </SelectTrigger>
                        <SelectContent>
                          {users.map((user) => (
                            <SelectItem key={user.id} value={user.id}>
                              {toTitleCase(user.name) || user.username} ({user.email})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="leave-type">Leave Type</Label>
                      <Select value={leaveType} onValueChange={setLeaveType}>
                        <SelectTrigger id="leave-type" data-testid="select-leave-type">
                          <SelectValue placeholder="Select leave type" />
                        </SelectTrigger>
                        <SelectContent>
                          {leaveTypeOptions.map((lt) => (
                            <SelectItem key={lt.id} value={lt.code}>
                              {lt.label} ({lt.code})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="total-days">Total Days</Label>
                      <Input
                        id="total-days"
                        type="number"
                        min="0"
                        step="0.5"
                        placeholder="14"
                        value={totalDays}
                        onChange={(e) => setTotalDays(e.target.value)}
                        data-testid="input-total-days"
                      />
                    </div>

                    <Button
                      onClick={handleSetBalance}
                      disabled={setBalanceMutation.isPending}
                      data-testid="button-submit-balance"
                      className="w-full"
                    >
                      {setBalanceMutation.isPending ? "Setting..." : "Set Balance"}
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            </CardContent>
          </Card>

          {/* Leave Balances List */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between flex-wrap gap-2">
                <CardTitle>Employee Leave Balances</CardTitle>
                <div className="flex items-center gap-2">
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={handlePrint}
                    data-testid="button-print-balances"
                  >
                    <Printer className="h-4 w-4 mr-1" />
                    Print
                  </Button>
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={exportBalancesToCSV}
                    disabled={balances.length === 0}
                    data-testid="button-export-balances"
                  >
                    <Download className="h-4 w-4 mr-1" />
                    Export
                  </Button>
                </div>
              </div>
              <CardDescription>Current leave entitlements for all employees</CardDescription>
            </CardHeader>
            <CardContent>
              {balancesLoading ? (
                <div className="space-y-4">
                  {[1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-24 w-full" />
                  ))}
                </div>
              ) : Object.keys(balancesByUser).length === 0 ? (
                <div className="py-12 text-center text-sm text-muted-foreground">
                  No leave balances configured yet
                </div>
              ) : (
                <div className="space-y-6">
                  {Object.entries(balancesByUser).map(([userId, userBalances]) => {
                    const displayName = userBalances[0]?.employeeName 
                      ? toTitleCase(userBalances[0].employeeName)
                      : getUserName(userId);
                    return (
                    <div key={userId} className="space-y-3">
                      <h3 className="font-medium" data-testid={`text-user-${userId}`}>
                        {displayName}
                      </h3>
                      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                        {userBalances.map((balance) => (
                          <Card key={balance.id} data-testid={`card-balance-${balance.id}`}>
                            <CardContent className="pt-6">
                              <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                  <span className="font-medium">{balance.leaveType}</span>
                                  <Badge variant="outline">
                                    {balance.balance} / {balance.eligible} days
                                  </Badge>
                                </div>
                                <p className="text-sm text-muted-foreground">
                                  Taken: {balance.taken} days | B/F: {balance.broughtForward}
                                </p>
                              </div>
                            </CardContent>
                          </Card>
                        ))}
                      </div>
                    </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="applications" className="space-y-6">
          {/* Pending Applications */}
          <Card>
            <CardHeader>
              <CardTitle>Pending Applications</CardTitle>
              <CardDescription>Review and approve/reject leave requests</CardDescription>
            </CardHeader>
            <CardContent>
              {applicationsLoading ? (
                <div className="space-y-4">
                  {[1, 2].map((i) => (
                    <Skeleton key={i} className="h-32 w-full" />
                  ))}
                </div>
              ) : pendingApplications.length === 0 ? (
                <div className="py-12 text-center text-sm text-muted-foreground">
                  No pending applications
                </div>
              ) : (
                <div className="space-y-4">
                  {pendingApplications.map((app) => (
                    <Card key={app.id} data-testid={`card-application-${app.id}`}>
                      <CardContent className="pt-6">
                        <div className="space-y-4">
                          <div className="flex items-start justify-between">
                            <div className="space-y-2 flex-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <h3 className="font-medium">{getUserName(app.userId)}</h3>
                                <Badge>{app.leaveType}</Badge>
                                {app.leaveType === "MC" && app.submissionTiming && (
                                  <Badge variant="outline">
                                    {app.submissionTiming === "pre_event" ? "Planned" : "Post-event"}
                                  </Badge>
                                )}
                              </div>
                              <div className="grid grid-cols-2 gap-4 text-sm">
                                <div>
                                  <p className="text-muted-foreground">Dates</p>
                                  <p className="font-medium">
                                    {new Date(app.startDate).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' })} - {new Date(app.endDate).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' })}
                                  </p>
                                </div>
                                <div>
                                  <p className="text-muted-foreground">Duration</p>
                                  <p className="font-medium">{app.totalDays} {parseFloat(String(app.totalDays)) === 1 ? "day" : "days"}</p>
                                </div>
                              </div>
                              <div>
                                <p className="text-muted-foreground text-sm">Reason</p>
                                <p className="text-sm">{app.reason}</p>
                              </div>
                            </div>
                          </div>
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              onClick={() => {
                                setSelectedApplication(app);
                                setReviewDialogOpen(true);
                              }}
                              data-testid={`button-review-${app.id}`}
                            >
                              Review
                            </Button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Reviewed Applications */}
          <Card>
            <CardHeader>
              <CardTitle>Reviewed Applications</CardTitle>
              <CardDescription>Previously reviewed leave requests</CardDescription>
            </CardHeader>
            <CardContent>
              {reviewedApplications.length === 0 ? (
                <div className="py-12 text-center text-sm text-muted-foreground">
                  No reviewed applications yet
                </div>
              ) : (
                <div className="space-y-3">
                  {reviewedApplications.map((app) => (
                    <Card key={app.id} data-testid={`card-reviewed-${app.id}`}>
                      <CardContent className="pt-6">
                        <div className="flex items-center justify-between">
                          <div className="space-y-1 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="font-medium">{getUserName(app.userId)}</span>
                              <Badge variant="outline">{app.leaveType}</Badge>
                              <Badge variant={app.status === "approved" ? "default" : "destructive"}>
                                {app.status}
                              </Badge>
                            </div>
                            <p className="text-sm text-muted-foreground">
                              {new Date(app.startDate).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' })} - {new Date(app.endDate).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' })} • {app.totalDays} days
                            </p>
                            {app.reviewComments && (
                              <p className="text-sm text-muted-foreground">Comment: {app.reviewComments}</p>
                            )}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="analytics" className="space-y-6">
          {/* Year Selector and Import Section */}
          <div className="flex flex-col md:flex-row gap-4 items-start md:items-end justify-between">
            <div className="space-y-2">
              <Label htmlFor="analytics-year">Select Year</Label>
              <Select 
                value={analyticsYear.toString()} 
                onValueChange={(val) => setAnalyticsYear(parseInt(val))}
              >
                <SelectTrigger className="w-[180px]" data-testid="select-analytics-year">
                  <SelectValue placeholder="Select year" />
                </SelectTrigger>
                <SelectContent>
                  {[2024, 2025, 2026, 2027, 2028, 2029, 2030].map(year => (
                    <SelectItem key={year} value={year.toString()}>{year}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            <div className="flex gap-2 items-end">
              <Button 
                variant="outline" 
                onClick={exportToCSV}
                disabled={!analyticsData || employeeUtilizationList.length === 0}
                data-testid="button-export-csv"
              >
                <Download className="mr-2 h-4 w-4" />
                Export CSV
              </Button>
            </div>
          </div>

          {/* Statistics Cards */}
          {analyticsLoading ? (
            <div className="grid gap-4 md:grid-cols-3">
              {[1, 2, 3].map(i => <Skeleton key={i} className="h-24" />)}
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-3">
              <Card data-testid="card-stat-records">
                <CardContent className="pt-6">
                  <div className="flex items-center gap-4">
                    <div className="p-2 bg-primary/10 rounded-lg">
                      <FileText className="h-6 w-6 text-primary" />
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Total Records</p>
                      <p className="text-2xl font-bold">{analyticsData?.totalRecords || 0}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card data-testid="card-stat-employees">
                <CardContent className="pt-6">
                  <div className="flex items-center gap-4">
                    <div className="p-2 bg-primary/10 rounded-lg">
                      <Users className="h-6 w-6 text-primary" />
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Unique Employees</p>
                      <p className="text-2xl font-bold">{analyticsData?.uniqueEmployees || 0}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card data-testid="card-stat-days">
                <CardContent className="pt-6">
                  <div className="flex items-center gap-4">
                    <div className="p-2 bg-primary/10 rounded-lg">
                      <TrendingUp className="h-6 w-6 text-primary" />
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Total Days Taken</p>
                      <p className="text-2xl font-bold">{totalDaysTaken.toFixed(1)}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Charts Section */}
          {!analyticsLoading && analyticsData && analyticsData.totalRecords > 0 && (
            <div className="grid gap-6 lg:grid-cols-2">
              {/* Pie Chart - Leave Type Distribution */}
              <Card data-testid="card-chart-pie">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <PieChartIcon className="h-5 w-5" />
                    Leave Type Distribution
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="h-[300px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={pieChartData}
                          cx="50%"
                          cy="50%"
                          labelLine={false}
                          label={({ name, percent }) => `${name} (${(percent * 100).toFixed(0)}%)`}
                          outerRadius={100}
                          fill="#8884d8"
                          dataKey="value"
                        >
                          {pieChartData.map((_, index) => (
                            <Cell key={`cell-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip 
                          formatter={(value: number, name: string) => [`${value} days`, name]}
                        />
                        <Legend />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>

              {/* Bar Chart - Monthly Trend */}
              <Card data-testid="card-chart-bar">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <BarChart3 className="h-5 w-5" />
                    Monthly Leave Trend
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="h-[300px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={barChartData}>
                        <XAxis dataKey="month" />
                        <YAxis />
                        <Tooltip />
                        <Legend />
                        <Bar dataKey="total" fill="#8884d8" name="Total Days" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Employee Utilization Table */}
          {!analyticsLoading && employeeUtilizationList.length > 0 && (
            <Card data-testid="card-employee-utilization">
              <CardHeader>
                <CardTitle>Employee Leave Utilization</CardTitle>
                <CardDescription>Leave days taken by each employee in {analyticsYear}. Click a row to view and edit individual records.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left py-3 px-2 font-medium w-8"></th>
                        <th className="text-left py-3 px-2 font-medium">Employee Code</th>
                        <th className="text-left py-3 px-2 font-medium">Name</th>
                        <th className="text-right py-3 px-2 font-medium">Total Days</th>
                        <th className="text-left py-3 px-2 font-medium">Breakdown</th>
                      </tr>
                    </thead>
                    <tbody>
                      {employeeUtilizationList.slice(0, 20).map((emp, idx) => {
                        const isExpanded = expandedEmployee === emp.code;
                        const empRecords = isExpanded ? getEmployeeRecords(emp.code) : [];
                        return (
                          <>
                            <tr 
                              key={emp.code} 
                              className="border-b hover-elevate cursor-pointer" 
                              data-testid={`row-employee-${idx}`}
                              onClick={() => setExpandedEmployee(isExpanded ? null : emp.code)}
                            >
                              <td className="py-3 px-2">
                                <Button size="icon" variant="ghost" className="h-6 w-6" data-testid={`button-expand-${idx}`}>
                                  {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                                </Button>
                              </td>
                              <td className="py-3 px-2 font-mono">{emp.code}</td>
                              <td className="py-3 px-2">{toTitleCase(emp.name)}</td>
                              <td className="py-3 px-2 text-right font-medium">{emp.total.toFixed(1)}</td>
                              <td className="py-3 px-2">
                                <div className="flex flex-wrap gap-1">
                                  {Object.entries(emp.byType).map(([type, days]) => (
                                    <Badge key={type} variant="outline" className="text-xs">
                                      {type}: {days}
                                    </Badge>
                                  ))}
                                </div>
                              </td>
                            </tr>
                            {isExpanded && (
                              <tr key={`${emp.code}-details`}>
                                <td colSpan={5} className="bg-muted/50 p-4">
                                  <div className="space-y-2">
                                    <p className="text-sm font-medium mb-3">Leave Records for {toTitleCase(emp.name)}</p>
                                    {historyLoading ? (
                                      <Skeleton className="h-20 w-full" />
                                    ) : empRecords.length === 0 ? (
                                      <p className="text-sm text-muted-foreground">No individual records found</p>
                                    ) : (
                                      <table className="w-full text-sm">
                                        <thead>
                                          <tr className="border-b">
                                            <th className="text-left py-2 px-2 font-medium">Date</th>
                                            <th className="text-left py-2 px-2 font-medium">Type</th>
                                            <th className="text-left py-2 px-2 font-medium">Duration</th>
                                            <th className="text-left py-2 px-2 font-medium">Remarks</th>
                                            <th className="text-right py-2 px-2 font-medium">Actions</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {empRecords.map((record) => (
                                            <tr key={record.id} className="border-b" data-testid={`row-record-${record.id}`}>
                                              <td className="py-2 px-2">{new Date(record.leaveDate).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' })}</td>
                                              <td className="py-2 px-2">
                                                <Badge variant="outline" className="text-xs">{record.leaveType}</Badge>
                                              </td>
                                              <td className="py-2 px-2">{record.daysOrHours}</td>
                                              <td className="py-2 px-2 text-muted-foreground">{record.remarks || "-"}</td>
                                              <td className="py-2 px-2 text-right">
                                                <div className="flex gap-1 justify-end">
                                                  <Button 
                                                    size="icon" 
                                                    variant="ghost" 
                                                    className="h-7 w-7"
                                                    onClick={(e) => { e.stopPropagation(); handleOpenEdit(record); }}
                                                    disabled={isViewOnlyAdmin}
                                                    title={isViewOnlyAdmin ? "View-only admins cannot edit" : "Edit record"}
                                                    data-testid={`button-edit-${record.id}`}
                                                  >
                                                    <Pencil className="h-3 w-3" />
                                                  </Button>
                                                  <Button 
                                                    size="icon" 
                                                    variant="ghost" 
                                                    className="h-7 w-7 text-destructive hover:text-destructive"
                                                    onClick={(e) => { e.stopPropagation(); handleOpenDelete(record); }}
                                                    disabled={isViewOnlyAdmin}
                                                    title={isViewOnlyAdmin ? "View-only admins cannot delete" : "Delete record"}
                                                    data-testid={`button-delete-${record.id}`}
                                                  >
                                                    <Trash2 className="h-3 w-3" />
                                                  </Button>
                                                </div>
                                              </td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            )}
                          </>
                        );
                      })}
                    </tbody>
                  </table>
                  {employeeUtilizationList.length > 20 && (
                    <p className="text-sm text-muted-foreground mt-4 text-center">
                      Showing top 20 of {employeeUtilizationList.length} employees
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Empty State */}
          {!analyticsLoading && (!analyticsData || analyticsData.totalRecords === 0) && (
            <Card>
              <CardContent className="py-12">
                <div className="text-center text-muted-foreground">
                  <BarChart3 className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p className="text-lg font-medium mb-2">No Leave Data for {analyticsYear}</p>
                  <p className="text-sm">Import a CSV file with leave records to view analytics</p>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Leave Settings Tab */}
        <TabsContent value="settings" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Upload className="h-5 w-5" />
                Import Leave History
              </CardTitle>
              <CardDescription>
                Upload an Excel (.xls, .xlsx) or CSV file with historical leave records
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-end">
                  <div className="space-y-2 flex-1">
                    <Label htmlFor="leave-file">Leave History File</Label>
                    <Input
                      ref={fileInputRef}
                      id="leave-file"
                      type="file"
                      accept=".xls,.xlsx,.csv,.txt"
                      onChange={handleFileUpload}
                      data-testid="input-leave-file"
                    />
                    {csvFileName && (
                      <p className="text-sm text-muted-foreground flex items-center gap-1">
                        <FileText className="h-4 w-4" />
                        {csvFileName} - {parsedRecords.length} records parsed
                      </p>
                    )}
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    <Button 
                      variant="outline"
                      onClick={() => checkMatches(parsedRecords)}
                      disabled={parsedRecords.length === 0 || diagnosticLoading}
                      data-testid="button-check-matches"
                    >
                      {diagnosticLoading ? "Checking..." : "Check Matches"}
                    </Button>
                    <Button 
                      onClick={handleImport}
                      disabled={parsedRecords.length === 0 || importMutation.isPending || isViewOnlyAdmin}
                      data-testid="button-import-leave"
                    >
                      {importMutation.isPending ? "Importing..." : "Import Records"}
                    </Button>
                  </div>
                </div>
                <div className="text-sm text-muted-foreground">
                  <p className="font-medium mb-2">Supported Formats:</p>
                  <ul className="list-disc list-inside space-y-1">
                    <li><strong>Excel (.xls, .xlsx)</strong> - 3SI Leave History Report format</li>
                    <li><strong>CSV (3SI)</strong> - 3SI Leave History Report exported as CSV</li>
                    <li><strong>CSV (Flat)</strong> - Simple CSV with column headers: Employee Code, Employee Name, Leave Type, Date, Days (optional), Remarks (optional)</li>
                    <li>Leave types: AL, ML, OIL, UL, CL, and variants (ALFH, ALSH, etc.) or full names (Annual Leave, Medical Leave, etc.)</li>
                    <li>Dates in DD-MM-YYYY or YYYY-MM-DD format</li>
                  </ul>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Leave Logs Tab */}
        <TabsContent value="logs" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <History className="h-5 w-5" />
                Leave Audit Trail
              </CardTitle>
              <CardDescription>
                Track all changes made to leave records, balances, and applications
              </CardDescription>
            </CardHeader>
            <CardContent>
              {auditLogsLoading ? (
                <div className="space-y-4">
                  {[1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-16 w-full" />
                  ))}
                </div>
              ) : auditLogs.length === 0 ? (
                <div className="py-12 text-center text-sm text-muted-foreground">
                  <History className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p className="text-lg font-medium mb-2">No Audit Logs Yet</p>
                  <p>Changes to leave records will appear here</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {auditLogs.map((log) => (
                    <div 
                      key={log.id} 
                      className="flex items-start gap-4 p-4 rounded-lg border"
                      data-testid={`log-entry-${log.id}`}
                    >
                      <div className="flex-1 space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge variant={
                            log.action === 'import' ? 'default' :
                            log.action === 'delete' ? 'destructive' :
                            log.action === 'update' ? 'secondary' : 'outline'
                          }>
                            {log.action}
                          </Badge>
                          <span className="text-sm text-muted-foreground">
                            {log.tableName.replace('_', ' ')}
                          </span>
                          {log.employeeName && (
                            <span className="text-sm font-medium">
                              {toTitleCase(log.employeeName)} ({log.employeeCode})
                            </span>
                          )}
                        </div>
                        {log.fieldName && (
                          <p className="text-sm">
                            <span className="text-muted-foreground">{log.fieldName}:</span>{' '}
                            {log.oldValue && <span className="line-through text-muted-foreground">{log.oldValue}</span>}
                            {log.oldValue && log.newValue && ' → '}
                            {log.newValue && <span className="font-medium">{log.newValue}</span>}
                          </p>
                        )}
                        {log.details && (
                          <p className="text-sm text-muted-foreground">{log.details}</p>
                        )}
                        <p className="text-xs text-muted-foreground">
                          By {log.changedBy} • {new Date(log.changedAt).toLocaleString()}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Review Dialog */}
      <Dialog open={reviewDialogOpen} onOpenChange={setReviewDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Review Leave Application</DialogTitle>
          </DialogHeader>
          {selectedApplication && (
            <div className="space-y-4">
              <div className="space-y-2">
                <div>
                  <p className="text-sm text-muted-foreground">Employee</p>
                  <p className="font-medium">{getUserName(selectedApplication.userId)}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Leave Type</p>
                  <p className="font-medium">{selectedApplication.leaveType}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Duration</p>
                  <p className="font-medium">
                    {new Date(selectedApplication.startDate).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' })} - {new Date(selectedApplication.endDate).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' })} ({selectedApplication.totalDays} days)
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Reason</p>
                  <p className="text-sm">{selectedApplication.reason}</p>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="approved-days">Approved Leave Days (deducted from balance on approve)</Label>
                <div className="flex gap-2">
                  <Input
                    id="approved-days"
                    type="number"
                    min="0"
                    step="0.5"
                    value={approvedDays}
                    onChange={(e) => setApprovedDays(e.target.value)}
                    className="flex-1"
                    data-testid="input-approved-days"
                  />
                  <Button type="button" variant="outline" size="sm"
                    onClick={() => setApprovedDays(String(selectedApplication.totalDays))}
                    data-testid="button-approved-full"
                  >
                    Full
                  </Button>
                  <Button type="button" variant="outline" size="sm"
                    onClick={() => setApprovedDays(String(parseFloat(String(selectedApplication.totalDays)) / 2))}
                    data-testid="button-approved-half"
                  >
                    Half
                  </Button>
                  <Button type="button" variant="outline" size="sm"
                    onClick={() => setApprovedDays("0")}
                    data-testid="button-approved-none"
                  >
                    None
                  </Button>
                </div>
                {parseFloat(approvedDays) > parseFloat(String(selectedApplication.totalDays)) && (
                  <p className="text-xs text-amber-600">
                    ⚠️ Exceeds requested ({selectedApplication.totalDays}) — allowed but unusual
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="review-comments">Comments (Optional)</Label>
                <Textarea
                  id="review-comments"
                  placeholder="Add review comments..."
                  value={reviewComments}
                  onChange={(e) => setReviewComments(e.target.value)}
                  data-testid="textarea-review-comments"
                />
              </div>

              <div className="flex gap-2">
                <Button
                  onClick={() => handleReviewApplication("approved")}
                  disabled={reviewMutation.isPending || isViewOnlyAdmin}
                  data-testid="button-approve-application"
                  className="flex-1"
                >
                  <CheckCircle className="mr-2 h-4 w-4" />
                  Approve
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => handleReviewApplication("rejected")}
                  disabled={reviewMutation.isPending || isViewOnlyAdmin}
                  data-testid="button-reject-application"
                  className="flex-1"
                >
                  <XCircle className="mr-2 h-4 w-4" />
                  Reject
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
      
      {/* Edit Leave Record Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Leave Record</DialogTitle>
          </DialogHeader>
          {selectedHistoryRecord && (
            <div className="space-y-4">
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  Employee: <span className="font-medium text-foreground">{toTitleCase(selectedHistoryRecord.employeeName)}</span> ({selectedHistoryRecord.employeeCode})
                </p>
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="edit-leave-type">Leave Type</Label>
                <Input
                  id="edit-leave-type"
                  value={editLeaveType}
                  onChange={(e) => setEditLeaveType(e.target.value)}
                  placeholder="AL, ML, UL, etc."
                  data-testid="input-edit-leave-type"
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="edit-leave-date">Leave Date</Label>
                <Input
                  id="edit-leave-date"
                  type="date"
                  value={editLeaveDate}
                  onChange={(e) => setEditLeaveDate(e.target.value)}
                  data-testid="input-edit-leave-date"
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="edit-days-hours">Duration</Label>
                <Input
                  id="edit-days-hours"
                  value={editDaysOrHours}
                  onChange={(e) => setEditDaysOrHours(e.target.value)}
                  placeholder="1.00 day or 4.00 hr"
                  data-testid="input-edit-days-hours"
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="edit-remarks">Remarks (Optional)</Label>
                <Input
                  id="edit-remarks"
                  value={editRemarks}
                  onChange={(e) => setEditRemarks(e.target.value)}
                  placeholder="Optional remarks"
                  data-testid="input-edit-remarks"
                />
              </div>
              
              <div className="flex gap-2 justify-end">
                <Button variant="outline" onClick={() => setEditDialogOpen(false)} data-testid="button-cancel-edit">
                  Cancel
                </Button>
                <Button 
                  onClick={handleSaveEdit} 
                  disabled={updateHistoryMutation.isPending}
                  data-testid="button-save-edit"
                >
                  {updateHistoryMutation.isPending ? "Saving..." : "Save Changes"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
      
      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Leave Record</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this leave record? This action cannot be undone.
              {selectedHistoryRecord && (
                <span className="block mt-2 text-foreground font-medium">
                  {toTitleCase(selectedHistoryRecord.employeeName)} - {selectedHistoryRecord.leaveType} on {new Date(selectedHistoryRecord.leaveDate).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' })}
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={handleConfirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-delete"
            >
              {deleteHistoryMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Import Diagnostic Dialog */}
      <Dialog open={diagnosticOpen} onOpenChange={setDiagnosticOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Import Match Diagnostic
            </DialogTitle>
          </DialogHeader>
          {diagnosticData && (
            <div className="space-y-4" data-testid="diagnostic-results">
              <div className="grid grid-cols-2 gap-4">
                <Card>
                  <CardContent className="pt-4">
                    <div className="text-2xl font-bold text-green-600 dark:text-green-400" data-testid="text-matched-count">
                      {diagnosticData.matchedCount}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Matched Employees ({diagnosticData.totalRecordsMatched} records)
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4">
                    <div className="text-2xl font-bold text-orange-600 dark:text-orange-400" data-testid="text-unmatched-count">
                      {diagnosticData.unmatchedCount}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Unmatched Employees ({diagnosticData.totalRecordsUnmatched} records)
                    </p>
                  </CardContent>
                </Card>
              </div>

              {diagnosticData.unmatchedCount > 0 && (
                <div className="rounded-lg border border-orange-200 dark:border-orange-800 p-3">
                  <p className="text-sm font-medium text-orange-700 dark:text-orange-300 mb-1 flex items-center gap-1">
                    <AlertTriangle className="h-4 w-4" />
                    Unmatched employees will be stored in leave history but won't appear in Leave Balances until those employees are added to the system with matching employee codes.
                  </p>
                </div>
              )}

              {diagnosticData.matched.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium mb-2 flex items-center gap-1">
                    <CheckCircle className="h-4 w-4 text-green-600 dark:text-green-400" />
                    Matched Employees ({diagnosticData.matchedCount})
                  </h4>
                  <div className="border rounded-md overflow-hidden">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b bg-muted/50">
                          <th className="text-left p-2">Code</th>
                          <th className="text-left p-2">Import Name</th>
                          <th className="text-left p-2">System Name</th>
                          <th className="text-left p-2">Match</th>
                          <th className="text-right p-2">Records</th>
                        </tr>
                      </thead>
                      <tbody>
                        {diagnosticData.matched.map((m) => (
                          <tr key={m.code} className="border-b last:border-0" data-testid={`match-row-${m.code}`}>
                            <td className="p-2 font-mono">{m.code}</td>
                            <td className="p-2">{toTitleCase(m.importName)}</td>
                            <td className="p-2">{m.systemName}</td>
                            <td className="p-2">
                              {m.matchMethod && (
                                <Badge variant={m.matchMethod === 'code' ? 'default' : 'secondary'}>
                                  {m.matchMethod === 'code' ? 'By Code' : 'By Name'}
                                </Badge>
                              )}
                            </td>
                            <td className="p-2 text-right">{m.recordCount}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {diagnosticData.unmatched.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium mb-2 flex items-center gap-1">
                    <XCircle className="h-4 w-4 text-orange-600 dark:text-orange-400" />
                    Unmatched Employees ({diagnosticData.unmatchedCount})
                  </h4>
                  <div className="border rounded-md overflow-hidden">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b bg-muted/50">
                          <th className="text-left p-2">Code</th>
                          <th className="text-left p-2">Import Name</th>
                          <th className="text-right p-2">Records</th>
                        </tr>
                      </thead>
                      <tbody>
                        {diagnosticData.unmatched.map((u) => (
                          <tr key={u.code} className="border-b last:border-0" data-testid={`unmatch-row-${u.code}`}>
                            <td className="p-2 font-mono">{u.code}</td>
                            <td className="p-2">{toTitleCase(u.importName)}</td>
                            <td className="p-2 text-right">{u.recordCount}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <div className="text-xs text-muted-foreground">
                Total: {diagnosticData.total} employees, {diagnosticData.totalRecordsMatched + diagnosticData.totalRecordsUnmatched} records parsed
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
