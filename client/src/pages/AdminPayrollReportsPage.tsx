import { useState, useMemo, useEffect, useRef } from "react";
import { toTitleCase } from "@/lib/utils";
import { useQuery, useMutation } from "@tanstack/react-query";
import ExcelJS from "exceljs";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowLeft, Download, FileSpreadsheet, Users, DollarSign, Calendar, Trash2, Loader2, TrendingUp, AlertTriangle, FileText, X, Search, Pencil, UserPlus, CheckCircle2, Copy, Check, CreditCard, Calculator, ClipboardEdit, Settings, BarChart3, Clock, Eye, EyeOff } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { PayrollRecord, CompanySettings } from "@shared/schema";
import PayslipView from "@/components/PayslipView";
import EditPayslipModal from "@/components/EditPayslipModal";
import PayrollAdjustmentsDialog, { type PayrollAdjustment, ADJUSTMENT_TYPE_LABELS } from "@/components/PayrollAdjustmentsDialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from "@/components/ui/dialog";



const MONTHS = [
  { value: "1", label: "January" },
  { value: "2", label: "February" },
  { value: "3", label: "March" },
  { value: "4", label: "April" },
  { value: "5", label: "May" },
  { value: "6", label: "June" },
  { value: "7", label: "July" },
  { value: "8", label: "August" },
  { value: "9", label: "September" },
  { value: "10", label: "October" },
  { value: "11", label: "November" },
  { value: "12", label: "December" },
];

const MONTH_NAMES: Record<number, string> = {
  1: "January", 2: "February", 3: "March", 4: "April",
  5: "May", 6: "June", 7: "July", 8: "August",
  9: "September", 10: "October", 11: "November", 12: "December"
};

const MONTH_ABBR: Record<number, string> = {
  1: "Jan", 2: "Feb", 3: "Mar", 4: "Apr",
  5: "May", 6: "Jun", 7: "Jul", 8: "Aug",
  9: "Sep", 10: "Oct", 11: "Nov", 12: "Dec"
};

const currentYear = new Date().getFullYear();
const currentMonth = new Date().getMonth() + 1;
const YEARS = Array.from({ length: 5 }, (_, i) => ({
  value: String(currentYear - i),
  label: String(currentYear - i),
}));

const generatePeriodOptions = () => {
  const options: { value: string; label: string; isYearOnly?: boolean }[] = [];
  
  for (let yearOffset = 0; yearOffset < 3; yearOffset++) {
    const year = currentYear - yearOffset;
    options.push({ value: `${year}-all`, label: `All ${year}`, isYearOnly: true });
    
    const startMonth = yearOffset === 0 ? currentMonth : 12;
    for (let month = startMonth; month >= 1; month--) {
      options.push({ 
        value: `${year}-${month}`, 
        label: `${MONTH_NAMES[month]} ${year}` 
      });
    }
  }
  
  return options;
};

const PERIOD_OPTIONS = generatePeriodOptions();

function escapeCsvField(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

interface NewUserForm {
  employeeCode: string;
  name: string;
  email: string;
  department: string;
  designation: string;
  section: string;
  mobileNumber: string;
  gender: string;
  joinDate: string;
  role: "user" | "admin";
}

const initialFormState: NewUserForm = {
  employeeCode: "",
  name: "",
  email: "",
  department: "",
  designation: "",
  section: "",
  mobileNumber: "",
  gender: "",
  joinDate: "",
  role: "user",
};

export default function AdminPayrollReportsPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  // Default to previous calendar month immediately (no blank flash while API loads)
  const defaultPeriod = currentMonth === 1
    ? `${currentYear - 1}-12`
    : `${currentYear}-${currentMonth - 1}`;
  const [selectedPeriod, setSelectedPeriod] = useState<string>(defaultPeriod);
  const [selectedPayslip, setSelectedPayslip] = useState<PayrollRecord | null>(null);

  // Fetch the most recently created payroll period and refine the default once
  const { data: latestPeriod } = useQuery<{ year: number | null; month: number | null }>({
    queryKey: ["/api/admin/payroll/latest-period"],
    staleTime: Infinity,
    throwOnError: false,
  });
  const periodInitialized = useRef(false);

  // Sticky horizontal scrollbar: mirror the table container's scroll at the viewport bottom
  const tableScrollRef = useRef<HTMLDivElement>(null);
  const mirrorScrollRef = useRef<HTMLDivElement>(null);
  const [tableScrollWidth, setTableScrollWidth] = useState(0);
  const isMirrorScrolling = useRef(false);
  const isTableScrolling = useRef(false);
  useEffect(() => {
    if (!periodInitialized.current && latestPeriod) {
      periodInitialized.current = true;
      if (latestPeriod.year && latestPeriod.month) {
        setSelectedPeriod(`${latestPeriod.year}-${latestPeriod.month}`);
      }
      // If no records exist yet, keep the "previous month" default
    }
  }, [latestPeriod]);

  const parsePeriod = (period: string) => {
    const [year, monthOrAll] = period.split('-');
    return {
      year,
      month: monthOrAll === 'all' ? '' : monthOrAll
    };
  };

  const { year: selectedYear, month: selectedMonth } = parsePeriod(selectedPeriod);
  const [payslipDialogOpen, setPayslipDialogOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [editRecord, setEditRecord] = useState<PayrollRecord | null>(null);
  const [editModalOpen, setEditModalOpen] = useState(false);
  
  const [showAddForm, setShowAddForm] = useState(false);
  const [newUserForm, setNewUserForm] = useState<NewUserForm>(initialFormState);
  const [createdUserInfo, setCreatedUserInfo] = useState<{ username: string; password: string } | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  
  // Adjustments dialog state
  const [adjustmentsDialogOpen, setAdjustmentsDialogOpen] = useState(false);
  const [adjustmentsRecord, setAdjustmentsRecord] = useState<PayrollRecord | null>(null);

  // No CPF dialog state
  const [noCpfDialogOpen, setNoCpfDialogOpen] = useState(false);
  const [noCpfRecord, setNoCpfRecord] = useState<PayrollRecord | null>(null);

  // OT Calculator dialog state
  const [otDialogOpen, setOtDialogOpen] = useState(false);
  const [otRecord, setOtRecord] = useState<PayrollRecord | null>(null);
  const [otHours15, setOtHours15] = useState("");
  const [otHours20, setOtHours20] = useState("");
  const [otDaysPerWeek, setOtDaysPerWeek] = useState("5");
  const [otCalculated, setOtCalculated] = useState(false);

  const applyNoCpfMutation = useMutation({
    mutationFn: async (record: PayrollRecord) => {
      const response = await apiRequest("PATCH", `/api/admin/payroll/records/${record.id}`, {
        employerCpf: 0,
        employeeCpf: 0,
        reason: "No CPF applied - CPF contributions removed via impact analysis",
      });
      return await response.json();
    },
    onSuccess: () => {
      toast({
        title: "No CPF Applied",
        description: "CPF contributions have been removed and net pay recalculated.",
      });
      setNoCpfDialogOpen(false);
      setNoCpfRecord(null);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/payroll/records"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to apply No CPF",
        variant: "destructive",
      });
    },
  });

  const applyOtMutation = useMutation({
    mutationFn: async ({ record, ot15Amount, ot20Amount }: { record: PayrollRecord; ot15Amount: number; ot20Amount: number }) => {
      const updates: Record<string, any> = {
        reason: "OT recalculated via OT Calculator",
        recalculateCpf: true,
      };
      updates.ot15 = Math.round(ot15Amount * 100) / 100;
      updates.ot20 = Math.round(ot20Amount * 100) / 100;
      const response = await apiRequest("PATCH", `/api/admin/payroll/records/${record.id}`, updates);
      return await response.json();
    },
    onSuccess: () => {
      toast({
        title: "OT Updated",
        description: "Overtime amounts have been updated and payslip recalculated.",
      });
      setOtDialogOpen(false);
      setOtRecord(null);
      setOtHours15("");
      setOtHours20("");
      setOtCalculated(false);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/payroll/records"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update OT",
        variant: "destructive",
      });
    },
  });

  const buildQueryUrl = () => {
    let url = `/api/admin/payroll/records?year=${selectedYear}`;
    if (selectedMonth && selectedMonth !== "") {
      url += `&month=${selectedMonth}`;
    }
    return url;
  };

  const queryUrl = buildQueryUrl();

  const { data, isLoading, refetch } = useQuery<{ records: PayrollRecord[] }>({
    queryKey: ['/api/admin/payroll/records', selectedYear, selectedMonth || null],
    queryFn: async () => {
      const res = await fetch(queryUrl, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch payroll records');
      return res.json();
    },
  });

  const { data: companySettings } = useQuery<CompanySettings>({
    queryKey: ['/api/company/settings'],
  });

  const { data: adjustmentsData } = useQuery<{ adjustments: PayrollAdjustment[] }>({
    queryKey: ['/api/admin/payroll/adjustments', selectedYear, selectedMonth || 'all'],
    queryFn: async () => {
      let url = `/api/admin/payroll/adjustments?year=${selectedYear}`;
      if (selectedMonth) url += `&month=${selectedMonth}`;
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) return { adjustments: [] };
      return res.json();
    },
  });

  const getAdjKey = (userId: string, year: number, month: number) => `${userId}_${year}_${month}`;

  const adjustmentsByUserPeriod = useMemo(() => {
    const map: Record<string, { net: number; items: PayrollAdjustment[] }> = {};
    (adjustmentsData?.adjustments || []).forEach(adj => {
      const key = getAdjKey(adj.userId, adj.payPeriodYear, adj.payPeriodMonth);
      if (!map[key]) map[key] = { net: 0, items: [] };
      map[key].items.push(adj);
      const amt = adj.amount ? parseFloat(adj.amount) : 0;
      if (adj.adjustmentType === 'deduction') {
        map[key].net -= amt;
      } else if (adj.adjustmentType === 'addition') {
        map[key].net += amt;
      }
    });
    return map;
  }, [adjustmentsData]);

  const bulkAllowEmployeeViewMutation = useMutation({
    mutationFn: async ({ year, month, allowEmployeeView }: { year: number; month: number; allowEmployeeView: boolean }) => {
      return apiRequest("PATCH", "/api/admin/payroll/bulk-allow-employee-view", {
        year, month, allowEmployeeView,
      });
    },
    onSuccess: (_, variables) => {
      toast({
        title: variables.allowEmployeeView ? "Payslips Visible to Employees" : "Payslips Hidden from Employees",
        description: variables.allowEmployeeView 
          ? "All employees can now view their payslips for this period."
          : "Payslips are now hidden from all employees for this period.",
      });
      queryClient.invalidateQueries({ 
        queryKey: ['/api/admin/payroll/records'],
        exact: false,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Update Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async ({ year, month }: { year: number; month: number }) => {
      return apiRequest("DELETE", `/api/admin/payroll/records/${year}/${month}`);
    },
    onSuccess: () => {
      toast({
        title: "Records Deleted",
        description: "Payroll records have been deleted successfully.",
      });
      queryClient.invalidateQueries({ 
        queryKey: ['/api/admin/payroll/records'],
        exact: false,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Delete Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const createUserMutation = useMutation({
    mutationFn: async (data: NewUserForm) => {
      const response = await apiRequest("POST", "/api/admin/users/create", data);
      return await response.json();
    },
    onSuccess: (data: { success: boolean; user: { username?: string; employeeCode?: string }; initialPassword: string; message: string }) => {
      toast({
        title: "Employee Created",
        description: data.message,
      });
      setCreatedUserInfo({
        username: data.user.username || data.user.employeeCode || "",
        password: data.initialPassword,
      });
      setNewUserForm(initialFormState);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create employee",
        variant: "destructive",
      });
    },
  });

  const handleFormChange = (field: keyof NewUserForm, value: string) => {
    setNewUserForm(prev => ({ ...prev, [field]: value }));
  };

  const handleCreateUser = () => {
    if (!newUserForm.employeeCode || !newUserForm.name || !newUserForm.email) {
      toast({
        title: "Missing Required Fields",
        description: "Employee code, name, and email are required.",
        variant: "destructive",
      });
      return;
    }
    createUserMutation.mutate(newUserForm);
  };

  const handleCopy = async (text: string, field: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const allRecords = data?.records || [];
  
  const records = useMemo(() => {
    if (!searchQuery.trim()) return allRecords;
    const query = searchQuery.toLowerCase();
    return allRecords.filter(
      (r) =>
        r.employeeName.toLowerCase().includes(query) ||
        r.employeeCode.toLowerCase().includes(query)
    );
  }, [allRecords, searchQuery]);

  // Re-measure table scroll width whenever records change so the mirror scrollbar stays accurate
  useEffect(() => {
    const el = tableScrollRef.current;
    if (!el) return;
    const update = () => setTableScrollWidth(el.scrollWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [records]);

  const allEmployeeViewEnabled = useMemo(() => {
    if (allRecords.length === 0) return false;
    return allRecords.every(r => r.allowEmployeeView === true);
  }, [allRecords]);

  const someEmployeeViewEnabled = useMemo(() => {
    if (allRecords.length === 0) return false;
    return allRecords.some(r => r.allowEmployeeView === true);
  }, [allRecords]);

  // Helper to safely parse numeric values (API returns strings from PostgreSQL numeric type)
  const parseAmount = (value: string | number | null | undefined): number => {
    if (value === null || value === undefined) return 0;
    if (typeof value === 'number') return value;
    const parsed = parseFloat(value);
    return isNaN(parsed) ? 0 : parsed;
  };

  // Format currency from dollars (not cents anymore)
  const formatCurrency = (dollars: number | string | null | undefined) => {
    const amount = parseAmount(dollars);
    return `$${amount.toFixed(2)}`;
  };

  const totalNett = records.reduce((sum, r) => sum + parseAmount(r.nett), 0);
  const totalGross = records.reduce((sum, r) => sum + parseAmount(r.grossWages), 0);
  const totalCpf = records.reduce((sum, r) => sum + parseAmount(r.employerCpf) + Math.abs(parseAmount(r.employeeCpf)), 0);
  const totalLeaveEncashment = records.reduce((sum, r) => sum + parseAmount(r.annualLeaveEncashment), 0);
  const totalNoPayDeduction = records.reduce((sum, r) => sum + parseAmount(r.noPayDay), 0);

  const groupedByPeriod = records.reduce((acc, record) => {
    const key = `${record.payPeriodYear}-${record.payPeriodMonth}`;
    if (!acc[key]) {
      acc[key] = {
        year: record.payPeriodYear,
        month: record.payPeriodMonth,
        display: record.payPeriod,
        records: [],
        totalNett: 0,
        totalGross: 0,
      };
    }
    acc[key].records.push(record);
    acc[key].totalNett += parseAmount(record.nett);
    acc[key].totalGross += parseAmount(record.grossWages);
    return acc;
  }, {} as Record<string, { year: number; month: number; display: string; records: PayrollRecord[]; totalNett: number; totalGross: number }>);

  const periods = Object.values(groupedByPeriod).sort((a, b) => {
    if (a.year !== b.year) return b.year - a.year;
    return b.month - a.month;
  });

  const exportToCsv = () => {
    if (records.length === 0) {
      toast({
        title: "No Data",
        description: "No payroll records to export.",
        variant: "destructive",
      });
      return;
    }

    const monthPrefix = selectedMonth ? `${MONTH_ABBR[parseInt(selectedMonth)]} ` : '';
    const headers = [
      "No", "Employee Name", "Basic Salary",
      "Shift", "Mobile", "Transport", "O. Allow.", "O. Allow. 1", "O. Allow. 2",
      "Gross", "Emp CPF", "Advance", "A/L",
      "SINDA", "MBMF",
      "Loan", "Salary",
      `${monthPrefix}OT 1.5x`, `${monthPrefix}OT 2.0x`,
      "Final Sal", "REMARKS"
    ];

    const csvRows = [headers.join(",")];

    records.forEach((r, idx) => {
      const nett = parseAmount(r.nett);
      const ot15 = parseAmount(r.ot15);
      const ot20 = parseAmount(r.ot20);
      const salaryBeforeOT = nett - ot15 - ot20;
      const row = [
        String(idx + 1),
        escapeCsvField(toTitleCase(r.employeeName)),
        parseAmount(r.basicSalary).toFixed(2),
        parseAmount(r.shiftAllowance).toFixed(2),
        parseAmount(r.mobileAllowance).toFixed(2),
        parseAmount(r.transportAllowance).toFixed(2),
        parseAmount(r.otherAllowance).toFixed(2),
        parseAmount((r as any).otherAllowance1).toFixed(2),
        parseAmount((r as any).otherAllowance2).toFixed(2),
        parseAmount(r.grossWages).toFixed(2),
        parseAmount(r.employeeCpf).toFixed(2),
        parseAmount(r.advance).toFixed(2),
        parseAmount(r.annualLeaveEncashment).toFixed(2),
        parseAmount(r.sinda).toFixed(2),
        parseAmount(r.mbmf).toFixed(2),
        parseAmount(r.loanRepaymentTotal).toFixed(2),
        salaryBeforeOT.toFixed(2),
        ot15.toFixed(2),
        ot20.toFixed(2),
        nett.toFixed(2),
        "",
      ];
      csvRows.push(row.join(","));
    });

    const csvContent = csvRows.join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    const filename = selectedMonth 
      ? `payroll_${selectedYear}_${selectedMonth}.csv`
      : `payroll_${selectedYear}.csv`;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    toast({
      title: "Export Complete",
      description: `Exported ${records.length} records to ${filename}`,
    });
  };

  const exportToExcel = async () => {
    if (records.length === 0) {
      toast({
        title: "No Data",
        description: "No payroll records to export.",
        variant: "destructive",
      });
      return;
    }

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Payroll Records");

    const xlMonthPrefix = selectedMonth ? `${MONTH_ABBR[parseInt(selectedMonth)]} ` : '';
    const xlHeaders = [
      "No", "Employee Name", "Basic Salary",
      "Shift", "Mobile", "Transport", "O. Allow.", "O. Allow. 1", "O. Allow. 2",
      "Gross", "Emp CPF", "Advance", "A/L",
      "SINDA", "MBMF",
      "Loan", "Salary",
      `${xlMonthPrefix}OT 1.5x`, `${xlMonthPrefix}OT 2.0x`,
      "Final Sal", "REMARKS"
    ];

    const headerRow = worksheet.addRow(xlHeaders);
    const headerFill: ExcelJS.Fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF1F2937" },
    };
    headerRow.eachCell((cell) => {
      cell.fill = headerFill;
      cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
      cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      cell.border = {
        top: { style: "thin", color: { argb: "FFD1D5DB" } },
        bottom: { style: "thin", color: { argb: "FFD1D5DB" } },
        left: { style: "thin", color: { argb: "FFD1D5DB" } },
        right: { style: "thin", color: { argb: "FFD1D5DB" } },
      };
    });
    headerRow.height = 28;

    const currencyCols = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18];

    records.forEach((r, idx) => {
      const nett = parseAmount(r.nett);
      const ot15 = parseAmount(r.ot15);
      const ot20 = parseAmount(r.ot20);
      const salaryBeforeOT = nett - ot15 - ot20;
      const row = worksheet.addRow([
        idx + 1,
        toTitleCase(r.employeeName),
        parseAmount(r.basicSalary),
        parseAmount(r.shiftAllowance),
        parseAmount(r.mobileAllowance),
        parseAmount(r.transportAllowance),
        parseAmount(r.otherAllowance),
        parseAmount((r as any).otherAllowance1),
        parseAmount((r as any).otherAllowance2),
        parseAmount(r.grossWages),
        parseAmount(r.employeeCpf),
        parseAmount(r.advance),
        parseAmount(r.annualLeaveEncashment),
        parseAmount(r.sinda),
        parseAmount(r.mbmf),
        parseAmount(r.loanRepaymentTotal),
        salaryBeforeOT,
        ot15,
        ot20,
        nett,
        "",
      ]);

      const isEven = idx % 2 === 0;
      const rowFill: ExcelJS.Fill = isEven
        ? { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFFFFF" } }
        : { type: "pattern", pattern: "solid", fgColor: { argb: "FFF9FAFB" } };

      row.eachCell((cell, colNumber) => {
        cell.fill = rowFill;
        cell.border = {
          top: { style: "thin", color: { argb: "FFE5E7EB" } },
          bottom: { style: "thin", color: { argb: "FFE5E7EB" } },
          left: { style: "thin", color: { argb: "FFE5E7EB" } },
          right: { style: "thin", color: { argb: "FFE5E7EB" } },
        };
        if (currencyCols.includes(colNumber)) {
          cell.numFmt = '#,##0.00';
          cell.alignment = { horizontal: "right" };
        }
      });
    });

    worksheet.columns.forEach((col, i) => {
      const headerLen = xlHeaders[i]?.length || 10;
      let maxLen = headerLen;
      worksheet.getColumn(i + 1).eachCell({ includeEmpty: false }, (cell) => {
        const val = cell.value?.toString() || "";
        maxLen = Math.max(maxLen, Math.min(val.length, 50));
      });
      col.width = maxLen + 3;
    });

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    const filename = selectedMonth
      ? `payroll_${selectedYear}_${selectedMonth}.xlsx`
      : `payroll_${selectedYear}.xlsx`;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    toast({
      title: "Export Complete",
      description: `Exported ${records.length} records to ${filename}`,
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex-1">
          <h1 className="text-2xl font-bold" data-testid="text-page-title">Payroll Management</h1>
          <p className="text-muted-foreground" data-testid="text-page-description">Manage payroll, loans, adjustments, and employee settings</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setLocation("/admin/dashboard")} data-testid="button-back-dashboard">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Dashboard
          </Button>
          <Button onClick={() => setLocation("/admin/payroll/import")} data-testid="button-import-new">
            <FileSpreadsheet className="h-4 w-4 mr-2" />
            Import New Data
          </Button>
        </div>
      </div>

      {/* Quick Actions Navigation */}
      <Card data-testid="card-quick-actions">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg" data-testid="text-quick-actions-title">Quick Actions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <Button 
              variant="outline" 
              className="flex flex-col h-auto py-4 gap-2"
              onClick={() => setLocation("/admin/payroll/loans")}
              data-testid="button-manage-loans"
            >
              <CreditCard className="h-5 w-5" />
              <span className="text-xs">Manage Loans</span>
            </Button>
            <Button 
              variant="outline" 
              className="flex flex-col h-auto py-4 gap-2"
              onClick={() => setLocation("/admin/payroll/generate")}
              data-testid="button-generate-payroll"
            >
              <Calculator className="h-5 w-5" />
              <span className="text-xs">Generate from Attendance</span>
            </Button>
            <Button 
              variant="outline" 
              className="flex flex-col h-auto py-4 gap-2"
              onClick={() => setLocation("/admin/payroll/adjustments")}
              data-testid="button-payroll-adjustments"
            >
              <ClipboardEdit className="h-5 w-5" />
              <span className="text-xs">Payroll Adjustments</span>
            </Button>
            <Button 
              variant="outline" 
              className="flex flex-col h-auto py-4 gap-2"
              onClick={() => setLocation("/admin/payroll/employees")}
              data-testid="button-employee-payroll"
            >
              <Settings className="h-5 w-5" />
              <span className="text-xs">Employee Payroll Settings</span>
            </Button>
            <Button 
              variant="outline" 
              className="flex flex-col h-auto py-4 gap-2"
              onClick={() => setLocation("/admin/attendance?tab=heatmap&from=payroll")}
              data-testid="button-heatmap"
            >
              <BarChart3 className="h-5 w-5" />
              <span className="text-xs">Attendance Heatmap</span>
            </Button>
            <Button 
              variant="outline" 
              className="flex flex-col h-auto py-4 gap-2"
              onClick={() => setLocation("/admin/payroll/import")}
              data-testid="button-import-payroll"
            >
              <FileSpreadsheet className="h-5 w-5" />
              <span className="text-xs">Import Payroll</span>
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card data-testid="card-filter">
        <CardHeader>
          <CardTitle data-testid="text-filter-title">Filter Records</CardTitle>
          <CardDescription data-testid="text-filter-description">Select period to filter payroll records, or search by employee name</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4 flex-wrap">
            <div className="w-48">
              <Select value={selectedPeriod} onValueChange={setSelectedPeriod}>
                <SelectTrigger data-testid="select-period">
                  <SelectValue placeholder="Select Period" />
                </SelectTrigger>
                <SelectContent>
                  {PERIOD_OPTIONS.map(p => (
                    <SelectItem 
                      key={p.value} 
                      value={p.value} 
                      data-testid={`option-period-${p.value}`}
                      className={p.isYearOnly ? "font-semibold" : ""}
                    >
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1 min-w-[200px] max-w-sm relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                type="text"
                placeholder="Search by employee name..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
                data-testid="input-search"
              />
            </div>
            <Button 
              variant="outline" 
              onClick={exportToCsv}
              disabled={records.length === 0}
              data-testid="button-export-csv"
            >
              <Download className="h-4 w-4 mr-2" />
              Export CSV
            </Button>
            <Button 
              variant="outline" 
              onClick={exportToExcel}
              disabled={records.length === 0}
              data-testid="button-export-excel"
            >
              <FileSpreadsheet className="h-4 w-4 mr-2" />
              Export Excel
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Add Employee Card */}
      <Card data-testid="card-add-employee">
        <CardHeader>
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <CardTitle className="flex items-center gap-2">
                <UserPlus className="h-5 w-5" />
                Add Individual Employee
              </CardTitle>
              <CardDescription>
                Create a new employee account with login credentials
              </CardDescription>
            </div>
            <Button
              variant={showAddForm ? "outline" : "default"}
              onClick={() => {
                setShowAddForm(!showAddForm);
                setCreatedUserInfo(null);
              }}
              data-testid="button-toggle-add-form"
            >
              <UserPlus className="mr-2 h-4 w-4" />
              {showAddForm ? "Hide Form" : "Add Employee"}
            </Button>
          </div>
        </CardHeader>
        {showAddForm && (
          <CardContent className="space-y-4">
            {createdUserInfo ? (
              <div className="bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded-lg p-4 space-y-4">
                <div className="flex items-center gap-2 text-green-700 dark:text-green-400">
                  <CheckCircle2 className="h-5 w-5" />
                  <span className="font-medium">Employee Created Successfully!</span>
                </div>
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2 bg-white dark:bg-background rounded-md p-3 border">
                    <div>
                      <p className="text-xs text-muted-foreground">Username</p>
                      <p className="font-mono font-medium" data-testid="text-created-username">{createdUserInfo.username}</p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleCopy(createdUserInfo.username, "username")}
                      data-testid="button-copy-username"
                    >
                      {copiedField === "username" ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                    </Button>
                  </div>
                  <div className="flex items-center justify-between gap-2 bg-white dark:bg-background rounded-md p-3 border">
                    <div>
                      <p className="text-xs text-muted-foreground">Initial Password</p>
                      <p className="font-mono font-medium" data-testid="text-created-password">{createdUserInfo.password}</p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleCopy(createdUserInfo.password, "password")}
                      data-testid="button-copy-password"
                    >
                      {copiedField === "password" ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>
                <p className="text-sm text-muted-foreground">
                  Share these credentials with the employee. They will be required to change their password on first login.
                </p>
                <Button
                  variant="outline"
                  onClick={() => setCreatedUserInfo(null)}
                  data-testid="button-add-another"
                >
                  Add Another Employee
                </Button>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="employeeCode">Employee Code *</Label>
                    <Input
                      id="employeeCode"
                      placeholder="e.g., EMP001"
                      value={newUserForm.employeeCode}
                      onChange={(e) => handleFormChange("employeeCode", e.target.value)}
                      data-testid="input-employee-code"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="name">Full Name *</Label>
                    <Input
                      id="name"
                      placeholder="e.g., John Smith"
                      value={newUserForm.name}
                      onChange={(e) => handleFormChange("name", e.target.value)}
                      data-testid="input-employee-name"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="email">Email Address *</Label>
                    <Input
                      id="email"
                      type="email"
                      placeholder="e.g., john@company.com"
                      value={newUserForm.email}
                      onChange={(e) => handleFormChange("email", e.target.value)}
                      data-testid="input-employee-email"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="department">Department</Label>
                    <Input
                      id="department"
                      placeholder="e.g., Engineering"
                      value={newUserForm.department}
                      onChange={(e) => handleFormChange("department", e.target.value)}
                      data-testid="input-employee-department"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="designation">Designation</Label>
                    <Input
                      id="designation"
                      placeholder="e.g., Software Engineer"
                      value={newUserForm.designation}
                      onChange={(e) => handleFormChange("designation", e.target.value)}
                      data-testid="input-employee-designation"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="section">Section</Label>
                    <Input
                      id="section"
                      placeholder="e.g., Backend Team"
                      value={newUserForm.section}
                      onChange={(e) => handleFormChange("section", e.target.value)}
                      data-testid="input-employee-section"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="mobileNumber">Mobile Number</Label>
                    <Input
                      id="mobileNumber"
                      type="tel"
                      placeholder="e.g., +65 9123 4567"
                      value={newUserForm.mobileNumber}
                      onChange={(e) => handleFormChange("mobileNumber", e.target.value)}
                      data-testid="input-employee-mobile"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="gender">Gender</Label>
                    <Select
                      value={newUserForm.gender}
                      onValueChange={(value) => handleFormChange("gender", value)}
                    >
                      <SelectTrigger data-testid="select-employee-gender">
                        <SelectValue placeholder="Select gender" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="MALE">Male</SelectItem>
                        <SelectItem value="FEMALE">Female</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="joinDate">Join Date</Label>
                    <Input
                      id="joinDate"
                      type="date"
                      value={newUserForm.joinDate}
                      onChange={(e) => handleFormChange("joinDate", e.target.value)}
                      data-testid="input-employee-join-date"
                    />
                  </div>
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setShowAddForm(false);
                      setNewUserForm(initialFormState);
                    }}
                    data-testid="button-cancel-add"
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={handleCreateUser}
                    disabled={createUserMutation.isPending}
                    data-testid="button-create-employee"
                  >
                    {createUserMutation.isPending ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <UserPlus className="h-4 w-4 mr-2" />
                    )}
                    Create Employee
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        )}
      </Card>

      {isLoading ? (
        <Card data-testid="card-loading">
          <CardContent className="py-12 text-center">
            <Loader2 className="h-8 w-8 mx-auto animate-spin text-muted-foreground mb-4" />
            <p className="text-muted-foreground" data-testid="text-loading">Loading payroll records...</p>
          </CardContent>
        </Card>
      ) : records.length === 0 ? (
        <Card data-testid="card-empty">
          <CardContent className="py-12 text-center">
            <FileSpreadsheet className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <p className="text-lg font-medium mb-2" data-testid="text-no-records">No Payroll Records Found</p>
            <p className="text-muted-foreground mb-4" data-testid="text-no-records-description">
              {selectedMonth 
                ? `No records for ${MONTH_NAMES[parseInt(selectedMonth)]} ${selectedYear}`
                : `No records for ${selectedYear}`
              }
            </p>
            <Button onClick={() => setLocation("/admin/payroll/generate")} data-testid="button-generate-from-empty">
              Generate from Attendance
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card data-testid="card-stat-employees">
              <CardContent className="pt-6">
                <div className="flex items-center gap-4">
                  <div className="p-3 rounded-full bg-blue-100 dark:bg-blue-900/30">
                    <Users className="h-6 w-6 text-blue-600 dark:text-blue-400" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold" data-testid="text-total-employees">{records.length}</p>
                    <p className="text-muted-foreground text-sm" data-testid="text-label-employees">Employee Records</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card data-testid="card-stat-nett">
              <CardContent className="pt-6">
                <div className="flex items-center gap-4">
                  <div className="p-3 rounded-full bg-green-100 dark:bg-green-900/30">
                    <DollarSign className="h-6 w-6 text-green-600 dark:text-green-400" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold" data-testid="text-total-nett">{formatCurrency(totalNett)}</p>
                    <p className="text-muted-foreground text-sm" data-testid="text-label-nett">Total Nett Pay</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card data-testid="card-stat-gross">
              <CardContent className="pt-6">
                <div className="flex items-center gap-4">
                  <div className="p-3 rounded-full bg-purple-100 dark:bg-purple-900/30">
                    <TrendingUp className="h-6 w-6 text-purple-600 dark:text-purple-400" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold" data-testid="text-total-gross">{formatCurrency(totalGross)}</p>
                    <p className="text-muted-foreground text-sm" data-testid="text-label-gross">Total Gross Wages</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card data-testid="card-stat-cpf">
              <CardContent className="pt-6">
                <div className="flex items-center gap-4">
                  <div className="p-3 rounded-full bg-orange-100 dark:bg-orange-900/30">
                    <Calendar className="h-6 w-6 text-orange-600 dark:text-orange-400" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold" data-testid="text-total-cpf">{formatCurrency(totalCpf)}</p>
                    <p className="text-muted-foreground text-sm" data-testid="text-label-cpf">Total CPF</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {(totalLeaveEncashment > 0 || totalNoPayDeduction > 0) && (
            <Card className="border-blue-500/50 bg-blue-50/50 dark:bg-blue-950/20" data-testid="card-leave-payroll">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2" data-testid="text-leave-title">
                  <Calendar className="h-5 w-5" />
                  Leave-Related Payroll Data
                </CardTitle>
                <CardDescription data-testid="text-leave-description">
                  Summary of annual leave encashment and no-pay day deductions from payroll
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="flex items-center justify-between p-4 bg-background rounded-lg border" data-testid="card-leave-encashment">
                    <div>
                      <p className="font-medium" data-testid="text-encashment-label">Annual Leave Encashment</p>
                      <p className="text-sm text-muted-foreground">Total paid out for unused leave</p>
                    </div>
                    <p className="text-xl font-bold text-green-600 dark:text-green-400" data-testid="text-leave-encashment">
                      {formatCurrency(totalLeaveEncashment)}
                    </p>
                  </div>
                  <div className="flex items-center justify-between p-4 bg-background rounded-lg border" data-testid="card-nopay-deduction">
                    <div>
                      <p className="font-medium" data-testid="text-nopay-label">No-Pay Day Deductions</p>
                      <p className="text-sm text-muted-foreground">Total deducted for unpaid leave</p>
                    </div>
                    <p className="text-xl font-bold text-red-600 dark:text-red-400" data-testid="text-nopay-deduction">
                      {formatCurrency(totalNoPayDeduction)}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {!selectedMonth && periods.length > 1 && (
            <Card data-testid="card-monthly-summary">
              <CardHeader>
                <CardTitle data-testid="text-monthly-title">Monthly Summary</CardTitle>
                <CardDescription data-testid="text-monthly-description">Payroll totals by month</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {periods.map(period => (
                    <div 
                      key={`${period.year}-${period.month}`}
                      className="flex items-center justify-between p-4 bg-muted/50 rounded-lg"
                      data-testid={`row-period-${period.year}-${period.month}`}
                    >
                      <div className="flex items-center gap-4">
                        <div>
                          <p className="font-medium" data-testid={`text-period-${period.year}-${period.month}`}>{period.display}</p>
                          <p className="text-sm text-muted-foreground" data-testid={`text-count-${period.year}-${period.month}`}>{period.records.length} employees</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-6">
                        <div className="text-right">
                          <p className="text-sm text-muted-foreground">Gross</p>
                          <p className="font-medium" data-testid={`text-gross-${period.year}-${period.month}`}>{formatCurrency(period.totalGross)}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm text-muted-foreground">Nett</p>
                          <p className="font-bold" data-testid={`text-nett-${period.year}-${period.month}`}>{formatCurrency(period.totalNett)}</p>
                        </div>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button 
                              variant="ghost" 
                              size="icon"
                              className="text-red-600 hover:text-red-700 hover:bg-red-100 dark:hover:bg-red-900/30"
                              data-testid={`button-delete-${period.year}-${period.month}`}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle className="flex items-center gap-2">
                                <AlertTriangle className="h-5 w-5 text-red-600" />
                                Delete Payroll Records
                              </AlertDialogTitle>
                              <AlertDialogDescription>
                                Are you sure you want to delete all {period.records.length} payroll records for {period.display}? 
                                This action cannot be undone.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel data-testid={`button-cancel-delete-${period.year}-${period.month}`}>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                className="bg-red-600 hover:bg-red-700"
                                onClick={() => deleteMutation.mutate({ year: period.year, month: period.month })}
                                data-testid={`button-confirm-delete-${period.year}-${period.month}`}
                              >
                                {deleteMutation.isPending ? (
                                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                                ) : null}
                                Delete Records
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          <Card data-testid="card-records-table">
            <CardHeader>
              <div className="flex items-center justify-between flex-wrap gap-4">
                <div>
                  <CardTitle data-testid="text-records-title">Payroll Records</CardTitle>
                  <CardDescription data-testid="text-records-description">
                    {selectedMonth 
                      ? `${MONTH_NAMES[parseInt(selectedMonth)]} ${selectedYear} - ${records.length} records`
                      : `${selectedYear} - ${records.length} records`
                    }
                  </CardDescription>
                </div>
                {records.length > 0 && selectedMonth && (
                  <div className="flex items-center gap-3 flex-wrap">
                    <div className="flex items-center gap-2 border rounded-md px-3 py-1.5">
                      {allEmployeeViewEnabled ? (
                        <Eye className="h-4 w-4 text-green-600" />
                      ) : (
                        <EyeOff className="h-4 w-4 text-muted-foreground" />
                      )}
                      <Switch
                        checked={allEmployeeViewEnabled}
                        onCheckedChange={(checked) => {
                          bulkAllowEmployeeViewMutation.mutate({
                            year: parseInt(selectedYear),
                            month: parseInt(selectedMonth),
                            allowEmployeeView: checked,
                          });
                        }}
                        disabled={bulkAllowEmployeeViewMutation.isPending}
                        data-testid="switch-bulk-employee-view"
                      />
                      <span className="text-sm whitespace-nowrap">
                        {bulkAllowEmployeeViewMutation.isPending ? (
                          <span className="flex items-center gap-1">
                            <Loader2 className="h-3 w-3 animate-spin" /> Updating...
                          </span>
                        ) : allEmployeeViewEnabled ? (
                          "Visible to employees"
                        ) : someEmployeeViewEnabled ? (
                          "Partially visible"
                        ) : (
                          "Hidden from employees"
                        )}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </CardHeader>
            <CardContent>
              <div className="relative">
              <div
                ref={tableScrollRef}
                style={{ overflowX: "auto", overflowY: "auto", maxHeight: "65vh" }}
                onScroll={(e) => {
                  if (isMirrorScrolling.current) return;
                  isTableScrolling.current = true;
                  if (mirrorScrollRef.current) mirrorScrollRef.current.scrollLeft = e.currentTarget.scrollLeft;
                  isTableScrolling.current = false;
                }}
              >
                <table className="w-full text-sm" data-testid="table-payroll-records">
                  <thead>
                    <tr className="sticky top-0 z-10 border-b">
                      <th className="text-center p-2 font-medium w-10 bg-muted">No</th>
                      <th className="text-left p-2 font-medium bg-muted">Employee Name</th>
                      <th className="text-right p-2 font-medium bg-muted">Basic Salary</th>
                      <th className="text-right p-2 font-medium bg-muted">Shift</th>
                      <th className="text-right p-2 font-medium bg-muted">Mobile</th>
                      <th className="text-right p-2 font-medium bg-muted">Transport</th>
                      <th className="text-right p-2 font-medium bg-muted">O. Allow.</th>
                      <th className="text-right p-2 font-medium bg-muted">O. Allow. 1</th>
                      <th className="text-right p-2 font-medium bg-muted">O. Allow. 2</th>
                      <th className="text-right p-2 font-medium bg-muted">Gross</th>
                      <th className="text-right p-2 font-medium bg-muted">Emp CPF</th>
                      <th className="text-right p-2 font-medium bg-muted">Advance</th>
                      <th className="text-right p-2 font-medium bg-muted">A/L</th>
                      <th className="text-right p-2 font-medium bg-muted">SINDA</th>
                      <th className="text-right p-2 font-medium bg-muted">MBMF</th>
                      <th className="text-right p-2 font-medium bg-muted">Loan</th>
                      <th className="text-right p-2 font-medium bg-muted">Salary</th>
                      <th className="text-right p-2 font-medium bg-muted">{selectedMonth ? `${MONTH_ABBR[parseInt(selectedMonth)]} ` : ''}OT 1.5x</th>
                      <th className="text-right p-2 font-medium bg-muted">{selectedMonth ? `${MONTH_ABBR[parseInt(selectedMonth)]} ` : ''}OT 2.0x</th>
                      <th className="text-right p-2 font-medium bg-muted">Final Sal</th>
                      <th className="text-left p-2 font-medium bg-muted">REMARKS</th>
                      <th className="text-center p-2 font-medium bg-muted">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {records.map((row, idx) => (
                      <tr 
                        key={row.id} 
                        className="border-b hover:bg-muted/30"
                        data-testid={`row-payroll-${idx}`}
                      >
                        <td className="p-2 text-center text-muted-foreground" data-testid={`cell-serial-${idx}`}>{idx + 1}</td>
                        <td className="p-2 whitespace-nowrap" data-testid={`cell-name-${idx}`}>{row.employeeName.split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(' ')}</td>
                        <td className="p-2 text-right font-mono" data-testid={`cell-basic-${idx}`}>{formatCurrency(row.basicSalary)}</td>
                        <td className="p-2 text-right font-mono" data-testid={`cell-shift-${idx}`}>{formatCurrency(row.shiftAllowance)}</td>
                        <td className="p-2 text-right font-mono" data-testid={`cell-mobile-${idx}`}>{formatCurrency(row.mobileAllowance)}</td>
                        <td className="p-2 text-right font-mono" data-testid={`cell-transport-${idx}`}>{formatCurrency(row.transportAllowance)}</td>
                        <td className="p-2 text-right font-mono" data-testid={`cell-other-${idx}`}>{formatCurrency(row.otherAllowance)}</td>
                        <td className="p-2 text-right font-mono" data-testid={`cell-other1-${idx}`}>{formatCurrency((row as any).otherAllowance1)}</td>
                        <td className="p-2 text-right font-mono" data-testid={`cell-other2-${idx}`}>{formatCurrency((row as any).otherAllowance2)}</td>
                        <td className="p-2 text-right font-mono font-medium" data-testid={`cell-gross-${idx}`}>{formatCurrency(row.grossWages)}</td>
                        <td className="p-2 text-right font-mono" data-testid={`cell-employee-cpf-${idx}`}>{formatCurrency(row.employeeCpf)}</td>
                        <td className="p-2 text-right font-mono" data-testid={`cell-advance-${idx}`}>{formatCurrency(row.advance)}</td>
                        <td className="p-2 text-right font-mono" data-testid={`cell-al-${idx}`}>{formatCurrency(row.annualLeaveEncashment)}</td>
                        <td className="p-2 text-right font-mono" data-testid={`cell-sinda-${idx}`}>{formatCurrency(row.sinda)}</td>
                        <td className="p-2 text-right font-mono" data-testid={`cell-mbmf-${idx}`}>{formatCurrency(row.mbmf)}</td>
                        <td className="p-2 text-right font-mono" data-testid={`cell-loan-${idx}`}>{formatCurrency(row.loanRepaymentTotal)}</td>
                        <td className="p-2 text-right font-mono font-medium" data-testid={`cell-salary-${idx}`}>{formatCurrency(parseAmount(row.nett) - parseAmount(row.ot15) - parseAmount(row.ot20))}</td>
                        <td className="p-2 text-right font-mono" data-testid={`cell-ot15-${idx}`}>{formatCurrency(row.ot15)}</td>
                        <td className="p-2 text-right font-mono" data-testid={`cell-ot20-${idx}`}>{formatCurrency(row.ot20)}</td>
                        <td className="p-2 text-right font-mono font-medium" data-testid={`cell-nett-${idx}`}>{formatCurrency(row.nett)}</td>
                        <td className="p-2 text-left text-xs text-muted-foreground" data-testid={`cell-remarks-${idx}`}>-</td>
                        <td className="p-2 text-center">
                          <div className="flex gap-1 justify-center">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  size="icon"
                                  variant="outline"
                                  onClick={() => {
                                    setSelectedPayslip(row);
                                    setPayslipDialogOpen(true);
                                  }}
                                  data-testid={`button-view-payslip-${idx}`}
                                >
                                  <FileText className="h-4 w-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>View Payslip</TooltipContent>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  size="icon"
                                  variant="outline"
                                  onClick={() => {
                                    if (row.userId) {
                                      setAdjustmentsRecord(row);
                                      setAdjustmentsDialogOpen(true);
                                    } else {
                                      toast({
                                        title: "Cannot Add Adjustments",
                                        description: "This payroll record is not linked to an employee account.",
                                        variant: "destructive",
                                      });
                                    }
                                  }}
                                  data-testid={`button-adjustments-payslip-${idx}`}
                                >
                                  <ClipboardEdit className="h-4 w-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Adjustments</TooltipContent>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  size="icon"
                                  variant="outline"
                                  onClick={() => {
                                    setOtRecord(row);
                                    const daysPerWeek = (row as any).regularDaysPerWeek || 5;
                                    setOtDaysPerWeek(String(daysPerWeek));
                                    const basicAmt = parseAmount(row.basicSalary);
                                    const dailyRate = (basicAmt * 12) / (daysPerWeek * 52);
                                    const hourlyRate = dailyRate / 8;
                                    const currentOt15 = parseAmount(row.ot15);
                                    const currentOt20 = parseAmount(row.ot20);
                                    const rate15 = hourlyRate * 1.5;
                                    const rate20 = hourlyRate * 2.0;
                                    setOtHours15(rate15 > 0 ? (currentOt15 / rate15).toFixed(2) : "0");
                                    setOtHours20(rate20 > 0 ? (currentOt20 / rate20).toFixed(2) : "0");
                                    setOtCalculated(false);
                                    setOtDialogOpen(true);
                                  }}
                                  data-testid={`button-ot-calc-${idx}`}
                                >
                                  <Clock className="h-4 w-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>OT Calculator</TooltipContent>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  size="icon"
                                  variant="outline"
                                  onClick={() => {
                                    setNoCpfRecord(row);
                                    setNoCpfDialogOpen(true);
                                  }}
                                  data-testid={`button-no-cpf-${idx}`}
                                >
                                  <Calculator className="h-4 w-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>No CPF</TooltipContent>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  size="icon"
                                  variant="outline"
                                  onClick={() => {
                                    if (row.userId) {
                                      setLocation(`/admin/payroll/employees?employeeId=${row.userId}`);
                                    } else {
                                      toast({
                                        title: "Cannot Edit",
                                        description: "This payroll record is not linked to an employee account.",
                                        variant: "destructive",
                                      });
                                    }
                                  }}
                                  data-testid={`button-edit-payslip-${idx}`}
                                >
                                  <Settings className="h-4 w-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Settings</TooltipContent>
                            </Tooltip>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {/* Sticky mirror scrollbar — sticks to viewport bottom so it's always reachable */}
              <div
                ref={mirrorScrollRef}
                style={{ overflowX: "auto", overflowY: "hidden", position: "sticky", bottom: 0 }}
                onScroll={(e) => {
                  if (isTableScrolling.current) return;
                  isMirrorScrolling.current = true;
                  if (tableScrollRef.current) tableScrollRef.current.scrollLeft = e.currentTarget.scrollLeft;
                  isMirrorScrolling.current = false;
                }}
              >
                <div style={{ width: tableScrollWidth, height: 1 }} />
              </div>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {/* Individual Payslip Report Dialog */}
      <Dialog open={payslipDialogOpen} onOpenChange={setPayslipDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto" data-testid="dialog-payslip">
          {selectedPayslip && (
            <>
              <DialogHeader className="print:hidden">
                <DialogTitle className="flex items-center gap-2" data-testid="text-payslip-title">
                  <FileText className="h-5 w-5" />
                  Payslip Report
                </DialogTitle>
              </DialogHeader>
              
              <PayslipView
                record={selectedPayslip}
                companySettings={companySettings}
                defaultMode="employer"
                showToggle={true}
                isAdmin={true}
              />

              <div className="flex justify-end gap-2 pt-4 print:hidden">
                <DialogClose asChild>
                  <Button variant="outline" data-testid="button-close-payslip">
                    <X className="h-4 w-4 mr-2" />
                    Close
                  </Button>
                </DialogClose>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Edit Payslip Modal */}
      <EditPayslipModal
        record={editRecord}
        open={editModalOpen}
        onClose={() => {
          setEditModalOpen(false);
          setEditRecord(null);
        }}
        onSaved={() => {
          queryClient.invalidateQueries({
            queryKey: ['/api/admin/payroll/records'],
            exact: false,
          });
        }}
      />

      {/* Payroll Adjustments Dialog */}
      <PayrollAdjustmentsDialog
        open={adjustmentsDialogOpen}
        onOpenChange={setAdjustmentsDialogOpen}
        record={adjustmentsRecord}
        onAdjustmentSaved={async () => {
          const result = await refetch();
          if (selectedPayslip && result.data?.records) {
            const updatedRecord = result.data.records.find(r => r.id === selectedPayslip.id);
            if (updatedRecord) {
              setSelectedPayslip(updatedRecord);
            }
          }
        }}
      />

      {/* No CPF Impact Analysis Dialog */}
      <Dialog open={noCpfDialogOpen} onOpenChange={setNoCpfDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="dialog-no-cpf">
          {noCpfRecord && (() => {
            const employeeCpfAmt = Math.abs(parseAmount(noCpfRecord.employeeCpf));
            const employerCpfAmt = parseAmount(noCpfRecord.employerCpf);
            const currentNett = parseAmount(noCpfRecord.nett);
            const grossWages = parseAmount(noCpfRecord.grossWages);
            const totalCpfAmt = employeeCpfAmt + employerCpfAmt;

            const noCpfNett = currentNett + employeeCpfAmt;
            const companySavings = employerCpfAmt;
            const employeeGain = employeeCpfAmt;

            const basicSalary = parseAmount(noCpfRecord.basicSalary);
            const monthlyVariables = parseAmount(noCpfRecord.monthlyVariablesComponent);
            const otTotal = parseAmount(noCpfRecord.flat) + parseAmount(noCpfRecord.ot10) + parseAmount(noCpfRecord.ot15) + parseAmount(noCpfRecord.ot20) + parseAmount(noCpfRecord.ot30) + parseAmount(noCpfRecord.totRestPhAmount);
            const shiftAllowance = parseAmount(noCpfRecord.shiftAllowance);
            const allowancesWithCpf = parseAmount(noCpfRecord.mobileAllowance) + parseAmount(noCpfRecord.transportAllowance) + parseAmount(noCpfRecord.annualLeaveEncashment) + parseAmount(noCpfRecord.serviceCallAllowances);
            const allowancesWithoutCpf = parseAmount(noCpfRecord.otherAllowance) + parseAmount((noCpfRecord as any).otherAllowance1) + parseAmount((noCpfRecord as any).otherAllowance2) + parseAmount(noCpfRecord.houseRentalAllowances);
            const bonusAmt = parseAmount(noCpfRecord.bonus);
            const claimsReimbursement = parseAmount(noCpfRecord.claimsReimbursement);
            const deductions = parseAmount(noCpfRecord.loanRepaymentTotal) + parseAmount(noCpfRecord.noPayDay);
            const communityFunds = parseAmount(noCpfRecord.cdac) + parseAmount(noCpfRecord.ecf) + parseAmount(noCpfRecord.mbmf) + parseAmount(noCpfRecord.sinda) + parseAmount(noCpfRecord.cc);
            const allAllowances = shiftAllowance + allowancesWithCpf + allowancesWithoutCpf;

            const currentEmployerCost = grossWages + employerCpfAmt + parseAmount(noCpfRecord.sdf) + parseAmount(noCpfRecord.fwl);
            const noCpfEmployerCost = grossWages + parseAmount(noCpfRecord.sdf) + parseAmount(noCpfRecord.fwl);

            return (
              <>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2" data-testid="text-no-cpf-title">
                    <Calculator className="h-5 w-5" />
                    No CPF Impact Analysis
                  </DialogTitle>
                  <p className="text-sm text-muted-foreground">
                    {toTitleCase(noCpfRecord.employeeName)} — {noCpfRecord.payPeriod}
                  </p>
                </DialogHeader>

                <div className="space-y-5">
                  {/* Salary Breakdown */}
                  <div>
                    <h4 className="text-sm font-medium mb-2">Salary Breakdown</h4>
                    <Card>
                      <CardContent className="pt-4 space-y-2">
                        <div className="flex justify-between text-sm">
                          <span>Basic Salary</span>
                          <span className="font-mono">{formatCurrency(basicSalary)}</span>
                        </div>
                        {monthlyVariables > 0 && (
                          <div className="flex justify-between text-sm">
                            <span>Monthly Variables</span>
                            <span className="font-mono">{formatCurrency(monthlyVariables)}</span>
                          </div>
                        )}
                        {otTotal > 0 && (
                          <div className="flex justify-between text-sm">
                            <span>Overtime / Rest Day / PH</span>
                            <span className="font-mono">{formatCurrency(otTotal)}</span>
                          </div>
                        )}
                        {shiftAllowance > 0 && (
                          <div className="flex justify-between text-sm">
                            <span>Shift Allowance</span>
                            <span className="font-mono">{formatCurrency(shiftAllowance)}</span>
                          </div>
                        )}
                        {allowancesWithCpf > 0 && (
                          <div className="flex justify-between text-sm">
                            <span>Allowances (with CPF)</span>
                            <span className="font-mono">{formatCurrency(allowancesWithCpf)}</span>
                          </div>
                        )}
                        {allowancesWithoutCpf > 0 && (
                          <div className="flex justify-between text-sm">
                            <span>Allowances (no CPF)</span>
                            <span className="font-mono">{formatCurrency(allowancesWithoutCpf)}</span>
                          </div>
                        )}
                        {bonusAmt > 0 && (
                          <div className="flex justify-between text-sm">
                            <span>Bonus</span>
                            <span className="font-mono">{formatCurrency(bonusAmt)}</span>
                          </div>
                        )}
                        {claimsReimbursement > 0 && (
                          <div className="flex justify-between text-sm">
                            <span>Claims Reimbursement</span>
                            <span className="font-mono">{formatCurrency(claimsReimbursement)}</span>
                          </div>
                        )}
                        <div className="flex justify-between text-sm font-medium border-t pt-2">
                          <span>Gross Wages</span>
                          <span className="font-mono">{formatCurrency(grossWages)}</span>
                        </div>
                      </CardContent>
                    </Card>
                  </div>

                  {/* Side-by-side Comparison */}
                  <div className="grid grid-cols-2 gap-4">
                    {/* Current - With CPF */}
                    <div>
                      <h4 className="text-sm font-medium mb-2">Current (With CPF)</h4>
                      <Card>
                        <CardContent className="pt-4 space-y-2">
                          <div className="flex justify-between text-sm">
                            <span>Gross Wages</span>
                            <span className="font-mono">{formatCurrency(grossWages)}</span>
                          </div>
                          <div className="flex justify-between text-sm text-red-600 dark:text-red-400">
                            <span>Employee CPF</span>
                            <span className="font-mono">-{formatCurrency(employeeCpfAmt)}</span>
                          </div>
                          {deductions > 0 && (
                            <div className="flex justify-between text-sm text-red-600 dark:text-red-400">
                              <span>Deductions</span>
                              <span className="font-mono">-{formatCurrency(deductions)}</span>
                            </div>
                          )}
                          {communityFunds > 0 && (
                            <div className="flex justify-between text-sm text-red-600 dark:text-red-400">
                              <span>Community Funds</span>
                              <span className="font-mono">-{formatCurrency(communityFunds)}</span>
                            </div>
                          )}
                          <div className="flex justify-between text-sm font-medium border-t pt-2">
                            <span>Net Pay</span>
                            <span className="font-mono">{formatCurrency(currentNett)}</span>
                          </div>
                        </CardContent>
                      </Card>
                    </div>

                    {/* Without CPF */}
                    <div>
                      <h4 className="text-sm font-medium mb-2">Without CPF</h4>
                      <Card className="border-green-200 dark:border-green-900">
                        <CardContent className="pt-4 space-y-2">
                          <div className="flex justify-between text-sm">
                            <span>Gross Wages</span>
                            <span className="font-mono">{formatCurrency(grossWages)}</span>
                          </div>
                          <div className="flex justify-between text-sm text-muted-foreground line-through">
                            <span>Employee CPF</span>
                            <span className="font-mono">$0.00</span>
                          </div>
                          {deductions > 0 && (
                            <div className="flex justify-between text-sm text-red-600 dark:text-red-400">
                              <span>Deductions</span>
                              <span className="font-mono">-{formatCurrency(deductions)}</span>
                            </div>
                          )}
                          {communityFunds > 0 && (
                            <div className="flex justify-between text-sm text-red-600 dark:text-red-400">
                              <span>Community Funds</span>
                              <span className="font-mono">-{formatCurrency(communityFunds)}</span>
                            </div>
                          )}
                          <div className="flex justify-between text-sm font-medium border-t pt-2 text-green-600 dark:text-green-400">
                            <span>Net Pay</span>
                            <span className="font-mono">{formatCurrency(noCpfNett)}</span>
                          </div>
                        </CardContent>
                      </Card>
                    </div>
                  </div>

                  {/* Impact Summary */}
                  <div>
                    <h4 className="text-sm font-medium mb-2">Impact Summary</h4>
                    <Card>
                      <CardContent className="pt-4 space-y-3">
                        <div className="flex justify-between items-center">
                          <div>
                            <p className="text-sm font-medium">Employee Take-Home Increase</p>
                            <p className="text-xs text-muted-foreground">Employee CPF contribution removed</p>
                          </div>
                          <Badge variant="outline" className="text-green-600 border-green-300 dark:border-green-800 dark:text-green-400" data-testid="badge-employee-gain">
                            +{formatCurrency(employeeGain)}
                          </Badge>
                        </div>
                        <div className="flex justify-between items-center">
                          <div>
                            <p className="text-sm font-medium">Company Savings</p>
                            <p className="text-xs text-muted-foreground">Employer CPF contribution removed</p>
                          </div>
                          <Badge variant="outline" className="text-green-600 border-green-300 dark:border-green-800 dark:text-green-400" data-testid="badge-company-savings">
                            +{formatCurrency(companySavings)}
                          </Badge>
                        </div>
                        <div className="border-t pt-3">
                          <div className="flex justify-between items-center">
                            <div>
                              <p className="text-sm font-medium">Total CPF Eliminated</p>
                              <p className="text-xs text-muted-foreground">Employee + Employer contributions</p>
                            </div>
                            <Badge variant="outline" data-testid="badge-total-cpf">
                              {formatCurrency(totalCpfAmt)}
                            </Badge>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </div>

                  {/* Employer Cost Comparison */}
                  <div>
                    <h4 className="text-sm font-medium mb-2">Employer Total Cost</h4>
                    <Card>
                      <CardContent className="pt-4 space-y-2">
                        <div className="flex justify-between text-sm">
                          <span>Current employer cost</span>
                          <span className="font-mono">{formatCurrency(currentEmployerCost)}</span>
                        </div>
                        <div className="flex justify-between text-sm text-green-600 dark:text-green-400">
                          <span>Without CPF employer cost</span>
                          <span className="font-mono">{formatCurrency(noCpfEmployerCost)}</span>
                        </div>
                        <div className="flex justify-between text-sm font-medium border-t pt-2">
                          <span>Monthly savings</span>
                          <span className="font-mono text-green-600 dark:text-green-400">
                            {formatCurrency(currentEmployerCost - noCpfEmployerCost)}
                          </span>
                        </div>
                      </CardContent>
                    </Card>
                  </div>

                  {/* Apply No CPF Button */}
                  <div className="pt-2 border-t">
                    {employeeCpfAmt === 0 && employerCpfAmt === 0 ? (
                      <div className="flex items-center gap-2 justify-center text-sm text-muted-foreground py-2">
                        <CheckCircle2 className="h-4 w-4 text-green-600" />
                        No CPF is already applied for this record
                      </div>
                    ) : (
                      <Button
                        className="w-full"
                        variant="default"
                        onClick={() => applyNoCpfMutation.mutate(noCpfRecord)}
                        disabled={applyNoCpfMutation.isPending}
                        data-testid="button-apply-no-cpf"
                      >
                        {applyNoCpfMutation.isPending ? (
                          <>
                            <Loader2 className="h-4 w-4 animate-spin mr-2" />
                            Applying...
                          </>
                        ) : (
                          <>
                            <Calculator className="h-4 w-4 mr-2" />
                            Apply No CPF for This Employee
                          </>
                        )}
                      </Button>
                    )}
                  </div>
                </div>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* OT Calculator Dialog */}
      <Dialog open={otDialogOpen} onOpenChange={(open) => {
        setOtDialogOpen(open);
        if (!open) {
          setOtRecord(null);
          setOtHours15("");
          setOtHours20("");
          setOtCalculated(false);
        }
      }}>
        <DialogContent className="max-w-lg" data-testid="dialog-ot-calc">
          {otRecord && (() => {
            const basicAmt = parseAmount(otRecord.basicSalary);
            const daysPerWeek = parseFloat(otDaysPerWeek) || 5;
            const dailyRate = (basicAmt * 12) / (daysPerWeek * 52);
            const hourlyRate = dailyRate / 8;
            const rate15 = hourlyRate * 1.5;
            const rate20 = hourlyRate * 2.0;
            const currentOt15Amt = parseAmount(otRecord.ot15);
            const currentOt20Amt = parseAmount(otRecord.ot20);
            const hours15 = parseFloat(otHours15) || 0;
            const hours20 = parseFloat(otHours20) || 0;
            const newOt15Amt = Math.round(hours15 * rate15 * 100) / 100;
            const newOt20Amt = Math.round(hours20 * rate20 * 100) / 100;

            return (
              <>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2" data-testid="text-ot-calc-title">
                    <Clock className="h-5 w-5" />
                    OT Calculator
                  </DialogTitle>
                  <p className="text-sm text-muted-foreground">
                    {toTitleCase(otRecord.employeeName)} — {otRecord.payPeriod}
                  </p>
                </DialogHeader>

                <div className="space-y-4">
                  <Card>
                    <CardContent className="pt-4 space-y-3">
                      <div className="flex justify-between items-center text-sm">
                        <span>Basic Salary</span>
                        <span className="font-mono font-medium">{formatCurrency(basicAmt)}</span>
                      </div>
                      <div className="flex justify-between items-center text-sm">
                        <span>Work Days Per Week</span>
                        <span className="font-mono font-medium text-muted-foreground" data-testid="label-ot-days">{otDaysPerWeek} days <span className="text-xs">(from Employee Settings)</span></span>
                      </div>
                      <div className="flex justify-between text-sm text-muted-foreground">
                        <span>MOM Formula: (Monthly x 12) / ({daysPerWeek} x 52) / 8</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span>Hourly Rate</span>
                        <span className="font-mono">${hourlyRate.toFixed(4)}/hr</span>
                      </div>
                      <div className="flex justify-between text-sm border-t pt-2">
                        <span>OT 1.5x Rate</span>
                        <span className="font-mono font-medium">${rate15.toFixed(4)}/hr</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span>OT 2.0x Rate</span>
                        <span className="font-mono font-medium">${rate20.toFixed(4)}/hr</span>
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardContent className="pt-4 space-y-2">
                      <h4 className="text-sm font-medium mb-1">Current OT</h4>
                      <div className="flex justify-between text-sm text-muted-foreground">
                        <span>OT 1.5x Amount</span>
                        <span className="font-mono">{formatCurrency(currentOt15Amt)}</span>
                      </div>
                      <div className="flex justify-between text-sm text-muted-foreground">
                        <span>OT 2.0x Amount</span>
                        <span className="font-mono">{formatCurrency(currentOt20Amt)}</span>
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardContent className="pt-4 space-y-4">
                      <h4 className="text-sm font-medium">Override OT Hours</h4>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1">
                          <Label className="text-xs">OT 1.5x Hours</Label>
                          <Input
                            type="text"
                            inputMode="decimal"
                            placeholder="0.00"
                            value={otHours15}
                            onChange={(e) => { setOtHours15(e.target.value); setOtCalculated(false); }}
                            data-testid="input-ot15-hours"
                          />
                          {otCalculated && (
                            <p className="text-xs text-muted-foreground font-mono">
                              = {formatCurrency(newOt15Amt)}
                            </p>
                          )}
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">OT 2.0x Hours</Label>
                          <Input
                            type="text"
                            inputMode="decimal"
                            placeholder="0.00"
                            value={otHours20}
                            onChange={(e) => { setOtHours20(e.target.value); setOtCalculated(false); }}
                            data-testid="input-ot20-hours"
                          />
                          {otCalculated && (
                            <p className="text-xs text-muted-foreground font-mono">
                              = {formatCurrency(newOt20Amt)}
                            </p>
                          )}
                        </div>
                      </div>

                      <Button
                        className="w-full"
                        variant="outline"
                        onClick={() => setOtCalculated(true)}
                        data-testid="button-calculate-ot"
                      >
                        <Calculator className="h-4 w-4 mr-2" />
                        Calculate
                      </Button>

                      {otCalculated && (
                        <div className="flex justify-between text-sm font-medium border-t pt-2">
                          <span>New OT Total</span>
                          <span className="font-mono">{formatCurrency(newOt15Amt + newOt20Amt)}</span>
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  <Button
                    className="w-full"
                    variant="default"
                    onClick={() => applyOtMutation.mutate({ record: otRecord, ot15Amount: newOt15Amt, ot20Amount: newOt20Amt })}
                    disabled={applyOtMutation.isPending || !otCalculated}
                    data-testid="button-apply-ot"
                  >
                    {applyOtMutation.isPending ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                        Applying...
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="h-4 w-4 mr-2" />
                        Confirm & Update Payslip
                      </>
                    )}
                  </Button>
                </div>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}
