import { useState, useMemo } from "react";
import { toTitleCase } from "@/lib/utils";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SelectGroup, SelectLabel } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Calculator, Loader2, Users, DollarSign, Clock, AlertTriangle, CheckCircle2, Play, History, Settings, Download, Printer, Ban, Search } from "lucide-react";
import { useLocation } from "wouter";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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

const MONTH_NAMES: Record<number, string> = {
  1: "January", 2: "February", 3: "March", 4: "April",
  5: "May", 6: "June", 7: "July", 8: "August",
  9: "September", 10: "October", 11: "November", 12: "December"
};

const currentYear = new Date().getFullYear();
const currentMonth = new Date().getMonth() + 1;

interface PeriodGroup {
  year: number;
  months: { value: string; label: string }[];
}

const generatePeriodGroups = (): PeriodGroup[] => {
  const groups: PeriodGroup[] = [];
  
  for (let yearOffset = 0; yearOffset < 3; yearOffset++) {
    const year = currentYear - yearOffset;
    const startMonth = yearOffset === 0 ? currentMonth : 12;
    const months: { value: string; label: string }[] = [];
    
    for (let month = startMonth; month >= 1; month--) {
      months.push({ 
        value: `${year}-${month}`, 
        label: `${MONTH_NAMES[month]} ${year}` 
      });
    }
    
    if (months.length > 0) {
      groups.push({ year, months });
    }
  }
  
  return groups;
};

const PERIOD_GROUPS = generatePeriodGroups();

interface PreviewEmployee {
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
  ot15Pay: number;
  ot20Pay: number;
  overtimePay: number;
  mobileAllowance: number;
  transportAllowance: number;
  mealAllowance: number;
  shiftAllowance: number;
  otherAllowance: number;
  houseRentalAllowance: number;
  loanDeduction: number;
  advance: number;
  annualLeaveEncashment: number;
  salaryAdjustments: number;
  grossWages: number;
  employeeCPF: number;
  employerCPF: number;
  netPay: number;
  salaryBeforeOT: number;
  finalSal: number;
  residencyStatus: string;
  cpfEligible: boolean;
  shgFund: string | null;
  shgAmount: number;
  sinda: number;
  cdac: number;
  mbmf: number;
  ecf: number;
}

interface SkippedEmployee {
  id: string;
  employeeCode: string;
  employeeName: string;
  reason: string;
}

interface PreviewResponse {
  success: boolean;
  period: string;
  periodStart: string;
  periodEnd: string;
  preview: PreviewEmployee[];
  skipped: SkippedEmployee[];
  totalEmployees: number;
  eligibleCount: number;
  skippedCount: number;
}

function formatCurrency(dollars: number): string {
  return `$${dollars.toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatHours(hours: number): string {
  return hours.toFixed(2);
}



function getResidencyLabel(status: string): string {
  switch (status) {
    case 'SC':
    case 'SPR':
      return 'Singaporean';
    case 'FOREIGNER':
      return 'Foreigner';
    default:
      return status;
  }
}

export default function AdminPayrollGeneratePage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [selectedPeriod, setSelectedPeriod] = useState<string>(`${currentYear}-${currentMonth}`);
  const [previewData, setPreviewData] = useState<PreviewResponse | null>(null);
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
  const [suppressAllOT, setSuppressAllOT] = useState(true);
  const [previewSearchQuery, setPreviewSearchQuery] = useState("");

  const { data: masterAdminData } = useQuery<{ isMasterAdmin: boolean }>({
    queryKey: ["/api/admin/is-master-admin"],
  });

  const isMasterAdmin = masterAdminData?.isMasterAdmin === true;
  
  const parsePeriod = (period: string) => {
    const [year, month] = period.split('-');
    return { year: parseInt(year), month: parseInt(month) };
  };
  
  const { year: selectedYear, month: selectedMonth } = parsePeriod(selectedPeriod);

  const previewMutation = useMutation({
    mutationFn: async (options?: { suppressOT?: boolean }) => {
      const response = await apiRequest("POST", "/api/admin/payroll/generate/preview", {
        year: selectedYear,
        month: selectedMonth,
        suppressAllOT: options?.suppressOT ?? suppressAllOT,
      });
      return response.json();
    },
    onSuccess: (data: PreviewResponse) => {
      setPreviewData(data);
      if (data.eligibleCount === 0) {
        toast({
          title: "No Eligible Employees",
          description: "No employees have attendance data or pay rates configured for this period.",
          variant: "destructive",
        });
      }
    },
    onError: (error: Error) => {
      toast({
        title: "Preview Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const generateMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/admin/payroll/generate", {
        year: selectedYear,
        month: selectedMonth,
        suppressAllOT,
      });
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Payroll Generated",
        description: `Successfully generated payroll for ${data.generated} employees.`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/payroll/records"] });
      setPreviewData(null);
      setConfirmDialogOpen(false);
      // Navigate back to Payroll Management after successful generation
      setTimeout(() => {
        setLocation("/admin/payroll");
      }, 100);
    },
    onError: (error: Error) => {
      toast({
        title: "Generation Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handlePreview = () => {
    setPreviewData(null);
    previewMutation.mutate({});
  };

  const handleGenerate = () => {
    setConfirmDialogOpen(true);
  };

  const confirmGenerate = () => {
    generateMutation.mutate();
  };

  const handleDownloadCSV = () => {
    if (!previewData || previewData.preview.length === 0) return;
    
    const headers = [
      'No',
      'Employee Name',
      'Basic Salary',
      'Shift',
      'Mobile',
      'Transport',
      'O. Allow.',
      'Gross',
      'Emp CPF',
      'Advance',
      'A/L',
      'SINDA',
      'MBMF',
      'Loan',
      'Salary',
      'OT 1.5x',
      'OT 2.0x',
      'Final Sal',
      'REMARKS'
    ];
    
    const rows = [...previewData.preview]
      .sort((a, b) => a.employeeName.localeCompare(b.employeeName))
      .map((emp, idx) => {
        const salaryBeforeOT = emp.netPay - (emp.ot15Pay || 0) - (emp.ot20Pay || 0);
        return [
          String(idx + 1),
          toTitleCase(emp.employeeName),
          emp.basicPay.toFixed(2),
          (emp.shiftAllowance || 0).toFixed(2),
          (emp.mobileAllowance || 0).toFixed(2),
          (emp.transportAllowance || 0).toFixed(2),
          (emp.otherAllowance || 0).toFixed(2),
          emp.grossWages.toFixed(2),
          emp.employeeCPF.toFixed(2),
          (emp.advance || 0).toFixed(2),
          (emp.annualLeaveEncashment || 0).toFixed(2),
          (emp.sinda || 0).toFixed(2),
          (emp.mbmf || 0).toFixed(2),
          (emp.loanDeduction || 0).toFixed(2),
          salaryBeforeOT.toFixed(2),
          (emp.ot15Pay || 0).toFixed(2),
          (emp.ot20Pay || 0).toFixed(2),
          emp.netPay.toFixed(2),
          '',
        ];
      });
    
    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `payroll_preview_${previewData.period.replace(' ', '_')}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handlePrint = () => {
    if (!previewData || previewData.preview.length === 0) return;
    
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;
    
    const tableRows = [...previewData.preview]
      .sort((a, b) => a.employeeName.localeCompare(b.employeeName))
      .map((emp, idx) => {
        const salaryBeforeOT = emp.netPay - (emp.ot15Pay || 0) - (emp.ot20Pay || 0);
        return `
        <tr>
          <td style="padding: 8px; border: 1px solid #ddd;">${idx + 1}</td>
          <td style="padding: 8px; border: 1px solid #ddd;">${toTitleCase(emp.employeeName)}<br><small>${emp.employeeCode}</small></td>
          <td style="padding: 8px; border: 1px solid #ddd; text-align: right;">$${emp.basicPay.toFixed(2)}</td>
          <td style="padding: 8px; border: 1px solid #ddd; text-align: right;">$${(emp.shiftAllowance || 0).toFixed(2)}</td>
          <td style="padding: 8px; border: 1px solid #ddd; text-align: right;">$${(emp.mobileAllowance || 0).toFixed(2)}</td>
          <td style="padding: 8px; border: 1px solid #ddd; text-align: right;">$${(emp.transportAllowance || 0).toFixed(2)}</td>
          <td style="padding: 8px; border: 1px solid #ddd; text-align: right;">$${(emp.otherAllowance || 0).toFixed(2)}</td>
          <td style="padding: 8px; border: 1px solid #ddd; text-align: right; font-weight: bold;">$${emp.grossWages.toFixed(2)}</td>
          <td style="padding: 8px; border: 1px solid #ddd; text-align: right;">$${emp.employeeCPF.toFixed(2)}</td>
          <td style="padding: 8px; border: 1px solid #ddd; text-align: right;">$${(emp.advance || 0).toFixed(2)}</td>
          <td style="padding: 8px; border: 1px solid #ddd; text-align: right;">$${(emp.annualLeaveEncashment || 0).toFixed(2)}</td>
          <td style="padding: 8px; border: 1px solid #ddd; text-align: right;">$${(emp.sinda || 0).toFixed(2)}</td>
          <td style="padding: 8px; border: 1px solid #ddd; text-align: right;">$${(emp.mbmf || 0).toFixed(2)}</td>
          <td style="padding: 8px; border: 1px solid #ddd; text-align: right;">$${(emp.loanDeduction || 0).toFixed(2)}</td>
          <td style="padding: 8px; border: 1px solid #ddd; text-align: right; font-weight: bold;">$${salaryBeforeOT.toFixed(2)}</td>
          <td style="padding: 8px; border: 1px solid #ddd; text-align: right;">$${(emp.ot15Pay || 0).toFixed(2)}</td>
          <td style="padding: 8px; border: 1px solid #ddd; text-align: right;">$${(emp.ot20Pay || 0).toFixed(2)}</td>
          <td style="padding: 8px; border: 1px solid #ddd; text-align: right; font-weight: bold; color: green;">$${emp.netPay.toFixed(2)}</td>
          <td style="padding: 8px; border: 1px solid #ddd;"></td>
        </tr>
      `}).join('');
    
    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Payroll Preview - ${previewData.period}</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 20px; }
          table { border-collapse: collapse; width: 100%; font-size: 12px; }
          th { background-color: #f5f5f5; padding: 8px; border: 1px solid #ddd; text-align: left; }
          @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
        </style>
      </head>
      <body>
        <h1>Payroll Preview - ${previewData.period}</h1>
        <p>Period: ${previewData.periodStart} to ${previewData.periodEnd}</p>
        <table>
          <thead>
            <tr>
              <th>No</th>
              <th>Employee Name</th>
              <th style="text-align: right;">Basic Salary</th>
              <th style="text-align: right;">Shift</th>
              <th style="text-align: right;">Mobile</th>
              <th style="text-align: right;">Transport</th>
              <th style="text-align: right;">O. Allow.</th>
              <th style="text-align: right;">Gross</th>
              <th style="text-align: right;">Emp CPF</th>
              <th style="text-align: right;">Advance</th>
              <th style="text-align: right;">A/L</th>
              <th style="text-align: right;">SINDA</th>
              <th style="text-align: right;">MBMF</th>
              <th style="text-align: right;">Loan</th>
              <th style="text-align: right;">Salary</th>
              <th style="text-align: right;">OT 1.5x</th>
              <th style="text-align: right;">OT 2.0x</th>
              <th style="text-align: right;">Final Sal</th>
              <th>REMARKS</th>
            </tr>
          </thead>
          <tbody>
            ${tableRows}
          </tbody>
        </table>
      </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.print();
  };

  const totalGrossWages = previewData?.preview.reduce((sum, emp) => sum + emp.grossWages, 0) || 0;
  const totalEmployeeCPF = previewData?.preview.reduce((sum, emp) => sum + emp.employeeCPF, 0) || 0;
  const totalEmployerCPF = previewData?.preview.reduce((sum, emp) => sum + emp.employerCPF, 0) || 0;
  const totalNetPay = previewData?.preview.reduce((sum, emp) => sum + emp.netPay, 0) || 0;
  const totalHours = previewData?.preview.reduce((sum, emp) => sum + emp.totalHoursWorked, 0) || 0;

  const filteredPreview = useMemo(() => {
    if (!previewData?.preview) return [];
    if (!previewSearchQuery.trim()) return previewData.preview;
    const query = previewSearchQuery.toLowerCase();
    return previewData.preview.filter(
      (emp) =>
        emp.employeeName.toLowerCase().includes(query) ||
        emp.employeeCode.toLowerCase().includes(query)
    );
  }, [previewData?.preview, previewSearchQuery]);

  return (
    <div className="container mx-auto py-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-page-title">Generate Payroll from Attendance</h1>
          <p className="text-muted-foreground">Calculate payroll based on clock-in/clock-out data with CPF contributions</p>
        </div>
        <Button
          variant="outline"
          onClick={() => setLocation("/admin/payroll")}
          data-testid="button-back-payroll"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Payroll Management
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calculator className="h-5 w-5" />
            Select Pay Period
          </CardTitle>
          <CardDescription>
            Choose the month and year to generate payroll from attendance records
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-4 items-end">
            <div className="space-y-2">
              <Label>Pay Period</Label>
              <Select value={selectedPeriod} onValueChange={setSelectedPeriod}>
                <SelectTrigger className="w-48" data-testid="select-period">
                  <SelectValue placeholder="Select period" />
                </SelectTrigger>
                <SelectContent>
                  {PERIOD_GROUPS.map((group) => (
                    <SelectGroup key={group.year}>
                      <SelectLabel className="font-bold">All {group.year}</SelectLabel>
                      {group.months.map((period) => (
                        <SelectItem key={period.value} value={period.value}>
                          {period.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button 
              onClick={handlePreview} 
              disabled={previewMutation.isPending}
              data-testid="button-preview"
            >
              {previewMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Calculating...
                </>
              ) : (
                <>
                  <Calculator className="h-4 w-4 mr-2" />
                  Generate
                </>
              )}
            </Button>
          </div>
          
          {isMasterAdmin && (
            <>
              <Separator className="my-4" />
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Historical Payroll Import</p>
                  <p className="text-xs text-muted-foreground">Import legacy payroll data from Excel files (Master Admin Only)</p>
                </div>
                <Button
                  variant="outline"
                  onClick={() => setLocation("/admin/payroll/historical-import")}
                  data-testid="button-historical-import"
                >
                  <History className="h-4 w-4 mr-2" />
                  Historical Import
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {previewData && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-2">
                  <Users className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="text-sm text-muted-foreground">Employees</p>
                    <p className="text-2xl font-bold" data-testid="text-employee-count">{previewData.eligibleCount}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-2">
                  <Clock className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="text-sm text-muted-foreground">Total Hours</p>
                    <p className="text-2xl font-bold" data-testid="text-total-hours">{formatHours(totalHours)}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-2">
                  <DollarSign className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="text-sm text-muted-foreground">Gross Wages</p>
                    <p className="text-2xl font-bold" data-testid="text-gross-wages">{formatCurrency(totalGrossWages)}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-2">
                  <DollarSign className="h-5 w-5 text-blue-500" />
                  <div>
                    <p className="text-sm text-muted-foreground">Total CPF</p>
                    <p className="text-lg font-bold text-blue-600" data-testid="text-total-cpf">
                      {formatCurrency(totalEmployeeCPF + totalEmployerCPF)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Emp: {formatCurrency(totalEmployeeCPF)} | Er: {formatCurrency(totalEmployerCPF)}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5 text-green-500" />
                  <div>
                    <p className="text-sm text-muted-foreground">Net Pay</p>
                    <p className="text-2xl font-bold text-green-600" data-testid="text-net-pay">{formatCurrency(totalNetPay)}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {previewData.skipped.length > 0 && (
            <Card className="border-yellow-200 bg-yellow-50 dark:bg-yellow-900/10">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-yellow-700 dark:text-yellow-400">
                  <AlertTriangle className="h-5 w-5" />
                  Skipped Employees ({previewData.skipped.length})
                </CardTitle>
                <CardDescription className="text-yellow-600 dark:text-yellow-500">
                  These employees were skipped because they don't have pay rates configured. Click to configure settings.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex flex-col gap-2">
                  {[...previewData.skipped]
                    .sort((a, b) => a.employeeName.localeCompare(b.employeeName))
                    .map((emp, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between gap-4 p-3 rounded-md bg-yellow-100 dark:bg-yellow-900/30 border border-yellow-300 dark:border-yellow-700"
                      data-testid={`row-skipped-employee-${emp.id}`}
                    >
                      <span className="font-medium text-yellow-800 dark:text-yellow-300">
                        {emp.employeeCode}: {toTitleCase(emp.employeeName)}
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        className="border-yellow-400 bg-white dark:bg-yellow-900/50"
                        onClick={() => setLocation(`/admin/payroll/employees?employeeId=${emp.id}&returnTo=generate&period=${selectedPeriod}`)}
                        data-testid={`button-employee-settings-${emp.id}`}
                      >
                        <Settings className="h-4 w-4 mr-2" />
                        Employee Settings
                      </Button>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="flex flex-col gap-4">
              <div className="flex flex-row items-center justify-between gap-4 flex-wrap">
                <div>
                  <CardTitle>Payroll Preview - {previewData.period}</CardTitle>
                  <CardDescription>
                    Period: {previewData.periodStart} to {previewData.periodEnd} ({previewData.preview.length} employees)
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                {previewData.preview.length > 0 && (
                  <>
                    <Button
                      variant={suppressAllOT ? "destructive" : "outline"}
                      size="sm"
                      onClick={() => {
                        const newValue = !suppressAllOT;
                        setSuppressAllOT(newValue);
                        // Refresh preview with new suppressOT value
                        previewMutation.mutate({ suppressOT: newValue });
                      }}
                      disabled={previewMutation.isPending}
                      data-testid="button-suppress-ot"
                    >
                      <Ban className="h-4 w-4 mr-2" />
                      {suppressAllOT ? "OT Suppressed" : "Suppress All OT"}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleDownloadCSV}
                      data-testid="button-download-csv"
                    >
                      <Download className="h-4 w-4 mr-2" />
                      CSV
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handlePrint}
                      data-testid="button-print"
                    >
                      <Printer className="h-4 w-4 mr-2" />
                      Print
                    </Button>
                  </>
                )}
                {previewData.eligibleCount > 0 && (
                  <Button 
                    onClick={handleGenerate}
                    disabled={generateMutation.isPending}
                    data-testid="button-generate"
                  >
                  {generateMutation.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Generating...
                    </>
                  ) : (
                    <>
                      <Play className="h-4 w-4 mr-2" />
                      Generate Payroll
                    </>
                  )}
                </Button>
                )}
                </div>
              </div>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by employee name or code..."
                  value={previewSearchQuery}
                  onChange={(e) => setPreviewSearchQuery(e.target.value)}
                  className="pl-9"
                  data-testid="input-preview-search"
                />
              </div>
            </CardHeader>
            <CardContent>
              {previewData.preview.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  No employees with attendance data found for this period
                </div>
              ) : filteredPreview.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  No employees matching "{previewSearchQuery}" found
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-10">No</TableHead>
                        <TableHead>Employee Name</TableHead>
                        <TableHead className="text-right">Basic Salary</TableHead>
                        <TableHead className="text-right">Shift</TableHead>
                        <TableHead className="text-right">Mobile</TableHead>
                        <TableHead className="text-right">Transport</TableHead>
                        <TableHead className="text-right">O. Allow.</TableHead>
                        <TableHead className="text-right font-semibold">Gross</TableHead>
                        <TableHead className="text-right">Emp CPF</TableHead>
                        <TableHead className="text-right">Advance</TableHead>
                        <TableHead className="text-right">A/L</TableHead>
                        <TableHead className="text-right">SINDA</TableHead>
                        <TableHead className="text-right">MBMF</TableHead>
                        <TableHead className="text-right">Loan</TableHead>
                        <TableHead className="text-right font-semibold">Salary</TableHead>
                        <TableHead className="text-right">OT 1.5x</TableHead>
                        <TableHead className="text-right">OT 2.0x</TableHead>
                        <TableHead className="text-right font-semibold">Final Sal</TableHead>
                        <TableHead>REMARKS</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {[...filteredPreview]
                        .sort((a, b) => a.employeeName.localeCompare(b.employeeName))
                        .map((emp, idx) => (
                        <TableRow key={idx}>
                          <TableCell className="text-muted-foreground">{idx + 1}</TableCell>
                          <TableCell>
                            <div>
                              <p className="font-medium">{toTitleCase(emp.employeeName)}</p>
                              <p className="text-xs text-muted-foreground">{emp.employeeCode}</p>
                            </div>
                          </TableCell>
                          <TableCell className="text-right">{formatCurrency(emp.basicPay)}</TableCell>
                          <TableCell className="text-right">{formatCurrency(emp.shiftAllowance || 0)}</TableCell>
                          <TableCell className="text-right">{formatCurrency(emp.mobileAllowance || 0)}</TableCell>
                          <TableCell className="text-right">{formatCurrency(emp.transportAllowance || 0)}</TableCell>
                          <TableCell className="text-right">{formatCurrency(emp.otherAllowance || 0)}</TableCell>
                          <TableCell className="text-right font-medium">{formatCurrency(emp.grossWages)}</TableCell>
                          <TableCell className="text-right">{formatCurrency(emp.employeeCPF)}</TableCell>
                          <TableCell className="text-right">{formatCurrency(emp.advance || 0)}</TableCell>
                          <TableCell className="text-right">{formatCurrency(emp.annualLeaveEncashment || 0)}</TableCell>
                          <TableCell className="text-right">{formatCurrency(emp.sinda || 0)}</TableCell>
                          <TableCell className="text-right">{formatCurrency(emp.mbmf || 0)}</TableCell>
                          <TableCell className="text-right">{formatCurrency(emp.loanDeduction || 0)}</TableCell>
                          <TableCell className="text-right font-medium">{formatCurrency(emp.netPay - (emp.ot15Pay || 0) - (emp.ot20Pay || 0))}</TableCell>
                          <TableCell className="text-right">{formatCurrency(emp.ot15Pay || 0)}</TableCell>
                          <TableCell className="text-right">{formatCurrency(emp.ot20Pay || 0)}</TableCell>
                          <TableCell className="text-right font-bold text-green-600">{formatCurrency(emp.netPay)}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">-</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      <AlertDialog open={confirmDialogOpen} onOpenChange={setConfirmDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Payroll Generation</AlertDialogTitle>
            <AlertDialogDescription>
              This will create payroll records for {previewData?.eligibleCount || 0} employees 
              for {previewData?.period}. Total net pay: {formatCurrency(totalNetPay)}.
              {suppressAllOT && (
                <>
                  <br /><br />
                  <strong className="text-destructive">Note: All OT (1.5x and 2.0x) will be suppressed for all employees.</strong>
                </>
              )}
              <br /><br />
              Are you sure you want to proceed?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-generate">Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmGenerate} data-testid="button-confirm-generate">
              Generate Payroll
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
