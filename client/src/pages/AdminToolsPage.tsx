import { useState, useRef } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { ArrowLeft, FileText, Download, Save, Loader2 } from "lucide-react";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { toTitleCase } from "@/lib/utils";
import type { CompanySettings } from "@shared/schema";
import html2pdf from "html2pdf.js";

interface PayslipFormData {
  employeeName: string;
  employeeCode: string;
  nric: string;
  department: string;
  designation: string;
  payPeriodYear: number;
  payPeriodMonth: number;
  payPeriodStart: string;
  payPeriodEnd: string;
  regularHours: string;
  overtimeHours: string;
  basicSalary: string;
  hourlyRate: string;
  regularPay: string;
  overtimePay: string;
  mobileAllowance: string;
  transportAllowance: string;
  loanAllowance: string;
  shiftAllowance: string;
  otherAllowance: string;
  houseRentalAllowance: string;
  bonuses: string;
  employeeCpf: string;
  employerCpf: string;
  loanDeduction: string;
  otherDeductions: string;
  cdac: string;
  mbmf: string;
  sinda: string;
  showCdac: boolean;
  showMbmf: boolean;
  showSinda: boolean;
  remarks: string;
}

const currentDate = new Date();
const currentYear = currentDate.getFullYear();
const currentMonth = currentDate.getMonth() + 1;

const defaultFormData: PayslipFormData = {
  employeeName: "",
  employeeCode: "",
  nric: "",
  department: "",
  designation: "",
  payPeriodYear: currentYear,
  payPeriodMonth: currentMonth,
  payPeriodStart: "",
  payPeriodEnd: "",
  regularHours: "",
  overtimeHours: "",
  basicSalary: "",
  hourlyRate: "",
  regularPay: "",
  overtimePay: "",
  mobileAllowance: "",
  transportAllowance: "",
  loanAllowance: "",
  shiftAllowance: "",
  otherAllowance: "",
  houseRentalAllowance: "",
  bonuses: "",
  employeeCpf: "",
  employerCpf: "",
  loanDeduction: "",
  otherDeductions: "",
  cdac: "",
  mbmf: "",
  sinda: "",
  showCdac: true,
  showMbmf: true,
  showSinda: true,
  remarks: "",
};

function parseNumber(value: string): number {
  const parsed = parseFloat(value);
  return isNaN(parsed) ? 0 : parsed;
}

function formatCurrency(value: number): string {
  return value.toLocaleString("en-SG", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

const monthNames = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

export default function AdminToolsPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [formData, setFormData] = useState<PayslipFormData>(defaultFormData);
  const [isSaving, setIsSaving] = useState(false);
  const payslipRef = useRef<HTMLDivElement>(null);

  const { data: companySettings } = useQuery<CompanySettings>({
    queryKey: ["/api/company/settings"],
  });

  const handleInputChange = (field: keyof PayslipFormData, value: string | number | boolean) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const calculateTotals = () => {
    const grossEarnings = 
      parseNumber(formData.basicSalary) +
      parseNumber(formData.regularPay) +
      parseNumber(formData.overtimePay) +
      parseNumber(formData.mobileAllowance) +
      parseNumber(formData.transportAllowance) +
      parseNumber(formData.loanAllowance) +
      parseNumber(formData.shiftAllowance) +
      parseNumber(formData.otherAllowance) +
      parseNumber(formData.houseRentalAllowance) +
      parseNumber(formData.bonuses);

    const totalDeductions = 
      parseNumber(formData.employeeCpf) +
      parseNumber(formData.loanDeduction) +
      parseNumber(formData.otherDeductions) +
      (formData.showCdac ? parseNumber(formData.cdac) : 0) +
      (formData.showMbmf ? parseNumber(formData.mbmf) : 0) +
      (formData.showSinda ? parseNumber(formData.sinda) : 0);

    const netPay = grossEarnings - totalDeductions;

    return { grossEarnings, totalDeductions, netPay };
  };

  const { grossEarnings, totalDeductions, netPay } = calculateTotals();

  const saveMutation = useMutation({
    mutationFn: async (data: PayslipFormData) => {
      const payload = {
        employeeName: data.employeeName,
        employeeCode: data.employeeCode || null,
        nric: data.nric || null,
        department: data.department || null,
        designation: data.designation || null,
        payPeriodYear: data.payPeriodYear,
        payPeriodMonth: data.payPeriodMonth,
        payPeriodStart: data.payPeriodStart || null,
        payPeriodEnd: data.payPeriodEnd || null,
        regularHours: data.regularHours || "0",
        overtimeHours: data.overtimeHours || "0",
        basicSalary: data.basicSalary || "0",
        hourlyRate: data.hourlyRate || "0",
        regularPay: data.regularPay || "0",
        overtimePay: data.overtimePay || "0",
        mobileAllowance: data.mobileAllowance || "0",
        transportAllowance: data.transportAllowance || "0",
        loanAllowance: data.loanAllowance || "0",
        shiftAllowance: data.shiftAllowance || "0",
        otherAllowance: data.otherAllowance || "0",
        houseRentalAllowance: data.houseRentalAllowance || "0",
        bonuses: data.bonuses || "0",
        employeeCpf: data.employeeCpf || "0",
        employerCpf: data.employerCpf || "0",
        loanDeduction: data.loanDeduction || "0",
        otherDeductions: data.otherDeductions || "0",
        grossPay: grossEarnings.toString(),
        totalDeductions: totalDeductions.toString(),
        netPay: netPay.toString(),
        remarks: data.remarks || null,
      };
      return await apiRequest("POST", "/api/admin/tools/payslip", payload);
    },
    onSuccess: () => {
      toast({
        title: "Payslip Saved",
        description: "The payslip has been saved with audit trail.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/tools/payslips"] });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to save payslip",
        variant: "destructive",
      });
    },
  });

  const handleSave = async () => {
    if (!formData.employeeName.trim()) {
      toast({
        title: "Validation Error",
        description: "Employee name is required",
        variant: "destructive",
      });
      return;
    }
    saveMutation.mutate(formData);
  };

  const handleExportPDF = async () => {
    if (!payslipRef.current) return;
    
    const element = payslipRef.current;
    const opt = {
      margin: 10,
      filename: `payslip_${formData.employeeName || 'blank'}_${formData.payPeriodYear}_${formData.payPeriodMonth}.pdf`,
      image: { type: 'jpeg' as const, quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true },
      jsPDF: { unit: 'mm' as const, format: 'a4' as const, orientation: 'portrait' as const }
    };

    try {
      await html2pdf().set(opt).from(element).save();
      toast({
        title: "PDF Exported",
        description: "Payslip has been exported to PDF",
      });
    } catch (error) {
      toast({
        title: "Export Failed",
        description: "Failed to export PDF",
        variant: "destructive",
      });
    }
  };

  const handleClear = () => {
    setFormData(defaultFormData);
  };

  return (
    <div className="min-h-screen bg-muted/30 p-4 md:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex-1">
            <h1 className="text-2xl md:text-3xl font-bold" data-testid="text-page-title">
              Tools
            </h1>
            <p className="text-sm md:text-base text-muted-foreground">
              HR administrative tools
            </p>
          </div>
          <Button
            variant="outline"
            onClick={() => setLocation("/admin/dashboard")}
            data-testid="button-back"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Dashboard
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Payslip Generator
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Form Section */}
              <div className="space-y-6">
                <div className="space-y-4">
                  <h3 className="font-semibold text-lg">Employee Information</h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Employee Name *</Label>
                      <Input
                        value={formData.employeeName}
                        onChange={(e) => handleInputChange("employeeName", e.target.value)}
                        placeholder="Full name"
                        data-testid="input-employee-name"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Employee Code</Label>
                      <Input
                        value={formData.employeeCode}
                        onChange={(e) => handleInputChange("employeeCode", e.target.value)}
                        placeholder="EMP001"
                        data-testid="input-employee-code"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>NRIC/FIN</Label>
                      <Input
                        value={formData.nric}
                        onChange={(e) => handleInputChange("nric", e.target.value)}
                        placeholder="S1234567A"
                        data-testid="input-nric"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Department</Label>
                      <Input
                        value={formData.department}
                        onChange={(e) => handleInputChange("department", e.target.value)}
                        placeholder="Department"
                        data-testid="input-department"
                      />
                    </div>
                    <div className="col-span-2 space-y-2">
                      <Label>Designation</Label>
                      <Input
                        value={formData.designation}
                        onChange={(e) => handleInputChange("designation", e.target.value)}
                        placeholder="Job title"
                        data-testid="input-designation"
                      />
                    </div>
                  </div>
                </div>

                <Separator />

                <div className="space-y-4">
                  <h3 className="font-semibold text-lg">Pay Period</h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Year</Label>
                      <Input
                        type="number"
                        value={formData.payPeriodYear}
                        onChange={(e) => handleInputChange("payPeriodYear", parseInt(e.target.value) || currentYear)}
                        data-testid="input-year"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Month</Label>
                      <Input
                        type="number"
                        min="1"
                        max="12"
                        value={formData.payPeriodMonth}
                        onChange={(e) => handleInputChange("payPeriodMonth", parseInt(e.target.value) || currentMonth)}
                        data-testid="input-month"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Period Start</Label>
                      <Input
                        type="date"
                        value={formData.payPeriodStart}
                        onChange={(e) => handleInputChange("payPeriodStart", e.target.value)}
                        data-testid="input-period-start"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Period End</Label>
                      <Input
                        type="date"
                        value={formData.payPeriodEnd}
                        onChange={(e) => handleInputChange("payPeriodEnd", e.target.value)}
                        data-testid="input-period-end"
                      />
                    </div>
                  </div>
                </div>

                <Separator />

                <div className="space-y-4">
                  <h3 className="font-semibold text-lg">Hours & Rates</h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Regular Hours</Label>
                      <Input
                        type="number"
                        step="0.01"
                        value={formData.regularHours}
                        onChange={(e) => handleInputChange("regularHours", e.target.value)}
                        placeholder="0.00"
                        data-testid="input-regular-hours"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Overtime Hours</Label>
                      <Input
                        type="number"
                        step="0.01"
                        value={formData.overtimeHours}
                        onChange={(e) => handleInputChange("overtimeHours", e.target.value)}
                        placeholder="0.00"
                        data-testid="input-overtime-hours"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Hourly Rate ($)</Label>
                      <Input
                        type="number"
                        step="0.01"
                        value={formData.hourlyRate}
                        onChange={(e) => handleInputChange("hourlyRate", e.target.value)}
                        placeholder="0.00"
                        data-testid="input-hourly-rate"
                      />
                    </div>
                  </div>
                </div>

                <Separator />

                <div className="space-y-4">
                  <h3 className="font-semibold text-lg">Earnings</h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Basic Salary ($)</Label>
                      <Input
                        type="number"
                        step="0.01"
                        value={formData.basicSalary}
                        onChange={(e) => handleInputChange("basicSalary", e.target.value)}
                        placeholder="0.00"
                        data-testid="input-basic-salary"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Regular Pay ($)</Label>
                      <Input
                        type="number"
                        step="0.01"
                        value={formData.regularPay}
                        onChange={(e) => handleInputChange("regularPay", e.target.value)}
                        placeholder="0.00"
                        data-testid="input-regular-pay"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Overtime Pay ($)</Label>
                      <Input
                        type="number"
                        step="0.01"
                        value={formData.overtimePay}
                        onChange={(e) => handleInputChange("overtimePay", e.target.value)}
                        placeholder="0.00"
                        data-testid="input-overtime-pay"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Mobile Allowance ($)</Label>
                      <Input
                        type="number"
                        step="0.01"
                        value={formData.mobileAllowance}
                        onChange={(e) => handleInputChange("mobileAllowance", e.target.value)}
                        placeholder="0.00"
                        data-testid="input-mobile-allowance"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Transport Allowance ($)</Label>
                      <Input
                        type="number"
                        step="0.01"
                        value={formData.transportAllowance}
                        onChange={(e) => handleInputChange("transportAllowance", e.target.value)}
                        placeholder="0.00"
                        data-testid="input-transport-allowance"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Loan ($)</Label>
                      <Input
                        type="number"
                        step="0.01"
                        value={formData.loanAllowance}
                        onChange={(e) => handleInputChange("loanAllowance", e.target.value)}
                        placeholder="0.00"
                        data-testid="input-loan-allowance"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Shift Allowance ($)</Label>
                      <Input
                        type="number"
                        step="0.01"
                        value={formData.shiftAllowance}
                        onChange={(e) => handleInputChange("shiftAllowance", e.target.value)}
                        placeholder="0.00"
                        data-testid="input-shift-allowance"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Other Allowance ($)</Label>
                      <Input
                        type="number"
                        step="0.01"
                        value={formData.otherAllowance}
                        onChange={(e) => handleInputChange("otherAllowance", e.target.value)}
                        placeholder="0.00"
                        data-testid="input-other-allowance"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>House Rental ($)</Label>
                      <Input
                        type="number"
                        step="0.01"
                        value={formData.houseRentalAllowance}
                        onChange={(e) => handleInputChange("houseRentalAllowance", e.target.value)}
                        placeholder="0.00"
                        data-testid="input-house-rental"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Bonuses ($)</Label>
                      <Input
                        type="number"
                        step="0.01"
                        value={formData.bonuses}
                        onChange={(e) => handleInputChange("bonuses", e.target.value)}
                        placeholder="0.00"
                        data-testid="input-bonuses"
                      />
                    </div>
                  </div>
                </div>

                <Separator />

                <div className="space-y-4">
                  <h3 className="font-semibold text-lg">Deductions</h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Employee CPF ($)</Label>
                      <Input
                        type="number"
                        step="0.01"
                        value={formData.employeeCpf}
                        onChange={(e) => handleInputChange("employeeCpf", e.target.value)}
                        placeholder="0.00"
                        data-testid="input-employee-cpf"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Employer CPF ($)</Label>
                      <Input
                        type="number"
                        step="0.01"
                        value={formData.employerCpf}
                        onChange={(e) => handleInputChange("employerCpf", e.target.value)}
                        placeholder="0.00"
                        data-testid="input-employer-cpf"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Loan Deduction ($)</Label>
                      <Input
                        type="number"
                        step="0.01"
                        value={formData.loanDeduction}
                        onChange={(e) => handleInputChange("loanDeduction", e.target.value)}
                        placeholder="0.00"
                        data-testid="input-loan-deduction"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Other Deductions ($)</Label>
                      <Input
                        type="number"
                        step="0.01"
                        value={formData.otherDeductions}
                        onChange={(e) => handleInputChange("otherDeductions", e.target.value)}
                        placeholder="0.00"
                        data-testid="input-other-deductions"
                      />
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <Checkbox
                          id="showCdac"
                          checked={formData.showCdac}
                          onCheckedChange={(checked) => handleInputChange("showCdac", checked as boolean)}
                          data-testid="checkbox-show-cdac"
                        />
                        <Label htmlFor="showCdac" className="flex-1">CDAC ($)</Label>
                      </div>
                      <Input
                        type="number"
                        step="0.01"
                        value={formData.cdac}
                        onChange={(e) => handleInputChange("cdac", e.target.value)}
                        placeholder="0.00"
                        data-testid="input-cdac"
                      />
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <Checkbox
                          id="showMbmf"
                          checked={formData.showMbmf}
                          onCheckedChange={(checked) => handleInputChange("showMbmf", checked as boolean)}
                          data-testid="checkbox-show-mbmf"
                        />
                        <Label htmlFor="showMbmf" className="flex-1">MBMF ($)</Label>
                      </div>
                      <Input
                        type="number"
                        step="0.01"
                        value={formData.mbmf}
                        onChange={(e) => handleInputChange("mbmf", e.target.value)}
                        placeholder="0.00"
                        data-testid="input-mbmf"
                      />
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <Checkbox
                          id="showSinda"
                          checked={formData.showSinda}
                          onCheckedChange={(checked) => handleInputChange("showSinda", checked as boolean)}
                          data-testid="checkbox-show-sinda"
                        />
                        <Label htmlFor="showSinda" className="flex-1">SINDA ($)</Label>
                      </div>
                      <Input
                        type="number"
                        step="0.01"
                        value={formData.sinda}
                        onChange={(e) => handleInputChange("sinda", e.target.value)}
                        placeholder="0.00"
                        data-testid="input-sinda"
                      />
                    </div>
                  </div>
                </div>

                <Separator />

                <div className="space-y-4">
                  <h3 className="font-semibold text-lg">Remarks</h3>
                  <Textarea
                    value={formData.remarks}
                    onChange={(e) => handleInputChange("remarks", e.target.value)}
                    placeholder="Additional notes or remarks"
                    rows={3}
                    data-testid="input-remarks"
                  />
                </div>

                <div className="flex gap-4">
                  <Button onClick={handleSave} disabled={saveMutation.isPending} data-testid="button-save">
                    {saveMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
                    Save Payslip
                  </Button>
                  <Button variant="outline" onClick={handleExportPDF} data-testid="button-export-pdf">
                    <Download className="h-4 w-4 mr-2" />
                    Export PDF
                  </Button>
                  <Button variant="ghost" onClick={handleClear} data-testid="button-clear">
                    Clear Form
                  </Button>
                </div>
              </div>

              {/* Preview Section */}
              <div className="border rounded-lg p-6 bg-white" ref={payslipRef}>
                <div className="space-y-4">
                  {/* Company Header */}
                  <div className="text-center border-b pb-4">
                    {companySettings?.clockInLogoUrl && (
                      <img src={companySettings.clockInLogoUrl} alt="Company Logo" className="h-12 mx-auto mb-2" />
                    )}
                    <h2 className="text-xl font-bold">{companySettings?.companyName || "Company Name"}</h2>
                    {companySettings?.companyAddress && (
                      <p className="text-sm text-muted-foreground">{companySettings.companyAddress}</p>
                    )}
                    {companySettings?.companyUen && (
                      <p className="text-sm text-muted-foreground">UEN: {companySettings.companyUen}</p>
                    )}
                  </div>

                  {/* Payslip Title */}
                  <div className="text-center">
                    <h3 className="text-lg font-semibold">PAYSLIP</h3>
                    <p className="text-sm text-muted-foreground">
                      {monthNames[(formData.payPeriodMonth || 1) - 1]} {formData.payPeriodYear}
                    </p>
                    {formData.payPeriodStart && formData.payPeriodEnd && (
                      <p className="text-xs text-muted-foreground">
                        Period: {formData.payPeriodStart} to {formData.payPeriodEnd}
                      </p>
                    )}
                  </div>

                  {/* Employee Info */}
                  <div className="grid grid-cols-2 gap-2 text-sm border-b pb-4">
                    <div>
                      <span className="text-muted-foreground">Name:</span>
                      <span className="ml-2 font-medium">{toTitleCase(formData.employeeName) || "-"}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Employee Code:</span>
                      <span className="ml-2 font-medium">{formData.employeeCode || "-"}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">NRIC/FIN:</span>
                      <span className="ml-2 font-medium">{formData.nric || "-"}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Department:</span>
                      <span className="ml-2 font-medium">{formData.department || "-"}</span>
                    </div>
                    <div className="col-span-2">
                      <span className="text-muted-foreground">Designation:</span>
                      <span className="ml-2 font-medium">{formData.designation || "-"}</span>
                    </div>
                  </div>

                  {/* Hours */}
                  {(formData.regularHours || formData.overtimeHours) && (
                    <div className="text-sm border-b pb-4">
                      <h4 className="font-semibold mb-2">Hours Worked</h4>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="flex justify-between">
                          <span>Regular Hours:</span>
                          <span>{parseNumber(formData.regularHours).toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Overtime Hours:</span>
                          <span>{parseNumber(formData.overtimeHours).toFixed(2)}</span>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Earnings */}
                  <div className="text-sm border-b pb-4">
                    <h4 className="font-semibold mb-2">Earnings</h4>
                    <div className="space-y-1">
                      {parseNumber(formData.basicSalary) > 0 && (
                        <div className="flex justify-between">
                          <span>Basic Salary</span>
                          <span>${formatCurrency(parseNumber(formData.basicSalary))}</span>
                        </div>
                      )}
                      {parseNumber(formData.regularPay) > 0 && (
                        <div className="flex justify-between">
                          <span>Regular Pay</span>
                          <span>${formatCurrency(parseNumber(formData.regularPay))}</span>
                        </div>
                      )}
                      {parseNumber(formData.overtimePay) > 0 && (
                        <div className="flex justify-between">
                          <span>Overtime Pay</span>
                          <span>${formatCurrency(parseNumber(formData.overtimePay))}</span>
                        </div>
                      )}
                      {parseNumber(formData.mobileAllowance) > 0 && (
                        <div className="flex justify-between">
                          <span>Mobile Allowance</span>
                          <span>${formatCurrency(parseNumber(formData.mobileAllowance))}</span>
                        </div>
                      )}
                      {parseNumber(formData.transportAllowance) > 0 && (
                        <div className="flex justify-between">
                          <span>Transport Allowance</span>
                          <span>${formatCurrency(parseNumber(formData.transportAllowance))}</span>
                        </div>
                      )}
                      {parseNumber(formData.loanAllowance) > 0 && (
                        <div className="flex justify-between">
                          <span>Loan</span>
                          <span>${formatCurrency(parseNumber(formData.loanAllowance))}</span>
                        </div>
                      )}
                      {parseNumber(formData.shiftAllowance) > 0 && (
                        <div className="flex justify-between">
                          <span>Shift Allowance</span>
                          <span>${formatCurrency(parseNumber(formData.shiftAllowance))}</span>
                        </div>
                      )}
                      {parseNumber(formData.otherAllowance) > 0 && (
                        <div className="flex justify-between">
                          <span>Other Allowance</span>
                          <span>${formatCurrency(parseNumber(formData.otherAllowance))}</span>
                        </div>
                      )}
                      {parseNumber(formData.houseRentalAllowance) > 0 && (
                        <div className="flex justify-between">
                          <span>House Rental</span>
                          <span>${formatCurrency(parseNumber(formData.houseRentalAllowance))}</span>
                        </div>
                      )}
                      {parseNumber(formData.bonuses) > 0 && (
                        <div className="flex justify-between">
                          <span>Bonuses</span>
                          <span>${formatCurrency(parseNumber(formData.bonuses))}</span>
                        </div>
                      )}
                      <div className="flex justify-between font-semibold border-t pt-1">
                        <span>Gross Earnings</span>
                        <span>${formatCurrency(grossEarnings)}</span>
                      </div>
                    </div>
                  </div>

                  {/* Deductions */}
                  <div className="text-sm border-b pb-4">
                    <h4 className="font-semibold mb-2">Deductions</h4>
                    <div className="space-y-1">
                      {parseNumber(formData.employeeCpf) > 0 && (
                        <div className="flex justify-between">
                          <span>Employee CPF</span>
                          <span className="text-red-600">-${formatCurrency(parseNumber(formData.employeeCpf))}</span>
                        </div>
                      )}
                      {parseNumber(formData.loanDeduction) > 0 && (
                        <div className="flex justify-between">
                          <span>Loan Deduction</span>
                          <span className="text-red-600">-${formatCurrency(parseNumber(formData.loanDeduction))}</span>
                        </div>
                      )}
                      {parseNumber(formData.otherDeductions) > 0 && (
                        <div className="flex justify-between">
                          <span>Other Deductions</span>
                          <span className="text-red-600">-${formatCurrency(parseNumber(formData.otherDeductions))}</span>
                        </div>
                      )}
                      {formData.showCdac && parseNumber(formData.cdac) > 0 && (
                        <div className="flex justify-between">
                          <span>CDAC</span>
                          <span className="text-red-600">-${formatCurrency(parseNumber(formData.cdac))}</span>
                        </div>
                      )}
                      {formData.showMbmf && parseNumber(formData.mbmf) > 0 && (
                        <div className="flex justify-between">
                          <span>MBMF</span>
                          <span className="text-red-600">-${formatCurrency(parseNumber(formData.mbmf))}</span>
                        </div>
                      )}
                      {formData.showSinda && parseNumber(formData.sinda) > 0 && (
                        <div className="flex justify-between">
                          <span>SINDA</span>
                          <span className="text-red-600">-${formatCurrency(parseNumber(formData.sinda))}</span>
                        </div>
                      )}
                      <div className="flex justify-between font-semibold border-t pt-1">
                        <span>Total Deductions</span>
                        <span className="text-red-600">-${formatCurrency(totalDeductions)}</span>
                      </div>
                    </div>
                  </div>

                  {/* Employer CPF */}
                  {parseNumber(formData.employerCpf) > 0 && (
                    <div className="text-sm border-b pb-4">
                      <h4 className="font-semibold mb-2">Employer Contributions</h4>
                      <div className="flex justify-between">
                        <span>Employer CPF</span>
                        <span>${formatCurrency(parseNumber(formData.employerCpf))}</span>
                      </div>
                    </div>
                  )}

                  {/* Net Pay */}
                  <div className="text-center py-4 bg-green-50 rounded-lg">
                    <p className="text-sm text-muted-foreground">Net Pay</p>
                    <p className="text-2xl font-bold text-green-600">${formatCurrency(netPay)}</p>
                  </div>

                  {/* Remarks */}
                  {formData.remarks && (
                    <div className="text-sm">
                      <h4 className="font-semibold mb-1">Remarks</h4>
                      <p className="text-muted-foreground">{formData.remarks}</p>
                    </div>
                  )}

                  {/* Footer */}
                  <div className="text-center text-xs text-muted-foreground pt-4 border-t">
                    <p>This is a computer-generated payslip. No signature required.</p>
                    <p>Generated on {new Date().toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
