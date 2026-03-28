import { useState, useEffect } from "react";
import { toTitleCase } from "@/lib/utils";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, Users, DollarSign, Save, Loader2, RefreshCw, History, User, Building, Calendar, X, Search, AlertCircle, CheckCircle2, Edit, Plus, Trash2, PlusCircle, MinusCircle } from "lucide-react";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { format } from "date-fns";
import { 
  calculateCPF, 
  calculateAge, 
  calculateSPRYears,
  formatPercentage, 
  getAgeBracketDescription,
  getSPRYearDescription,
  type ResidencyStatus 
} from "@/lib/cpf-calculator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";

interface EmployeePayrollSummary {
  id: string;
  name: string;
  email: string;
  employeeCode: string | null;
  department: string | null;
  designation: string | null;
  isApproved: boolean;
  residencyStatus: string | null;
  payType: string | null;
  basicMonthlySalary: number | null;
  hourlyRate: number | null;
  dailyRate: number | null;
  hasPayrollConfig: boolean;
}

interface EmployeePayrollSettings {
  id: string;
  name: string;
  email: string;
  employeeCode: string | null;
  department: string | null;
  designation: string | null;
  residencyStatus: string | null;
  birthDate: string | null;
  sprStartDate: string | null;
  payType: string | null;
  basicMonthlySalary: number | null;
  hourlyRate: number | null;
  dailyRate: number | null;
  regularHoursPerDay: number | null;
  regularDaysPerWeek: number | null;
  defaultMobileAllowance: number | null;
  defaultTransportAllowance: number | null;
  defaultMealAllowance: number | null;
  defaultShiftAllowance: number | null;
  defaultOtherAllowance: number | null;
  defaultHouseRentalAllowance: number | null;
  salaryAdjustment: number | null;
  salaryAdjustmentReason: string | null;
  ethnicity: string | null;
  religion: string | null;
  shgOptOut: boolean;
}

interface SalaryAdjustment {
  id: string;
  userId: string;
  adjustmentType: "addition" | "deduction";
  amount: number;
  description: string | null;
  isActive: boolean;
  showForEmployee: boolean;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

interface AuditLog {
  id: number;
  userId: string;
  changedBy: string;
  fieldChanged: string;
  oldValue: string | null;
  newValue: string | null;
  changeType: string;
  createdAt: string;
}

function formatCurrency(dollars: number | null): string {
  if (dollars === null || dollars === undefined) return "$0.00";
  return `$${Number(dollars).toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function dollarsToDisplay(dollars: number | null): string {
  if (dollars === null || dollars === undefined) return "";
  return Number(dollars).toFixed(2);
}

function displayToDollars(display: string): number | null {
  if (!display || display.trim() === "") return null;
  const value = parseFloat(display);
  if (isNaN(value)) return null;
  return Math.round(value * 100) / 100; // Round to 2 decimal places
}

function getResidencyLabel(status: string | null): string {
  if (!status) return "Not Set";
  switch (status) {
    case "SC":
      return "Singaporean";
    case "SPR":
      return "Singapore PR";
    case "FOREIGNER":
      return "Foreigner";
    default:
      return status;
  }
}

function normalizeResidencyStatus(status: string | null | undefined): string {
  return status || "";
}

function calculateCompletionPercentage(employee: EmployeePayrollSummary): number {
  const fields = [
    employee.residencyStatus,
    employee.basicMonthlySalary,
  ];
  const filledCount = fields.filter(f => f !== null && f !== undefined).length;
  return Math.round((filledCount / fields.length) * 100);
}


function getFieldLabel(field: string): string {
  const labels: Record<string, string> = {
    residencyStatus: "Residency Status",
    birthDate: "Date of Birth",
    sprStartDate: "SPR Start Date",
    payType: "Pay Type",
    basicMonthlySalary: "Basic Monthly Salary",
    hourlyRate: "Hourly Rate",
    dailyRate: "Daily Rate",
    regularHoursPerDay: "Regular Hours/Day",
    regularDaysPerWeek: "Regular Days/Week",
    defaultMobileAllowance: "Mobile Allowance",
    defaultTransportAllowance: "Transport Allowance",
    defaultMealAllowance: "Loan",
    defaultShiftAllowance: "Shift Allowance",
    defaultOtherAllowance: "Other Allowance",
    defaultHouseRentalAllowance: "House Rental Allowance",
    salaryAdjustment: "Salary Adjustment",
    salaryAdjustmentReason: "Adjustment Reason",
    role: "Role",
    password: "Password",
  };
  return labels[field] || field;
}

export default function AdminEmployeePayrollPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [urlParamProcessed, setUrlParamProcessed] = useState(false);
  const [returnToGenerate, setReturnToGenerate] = useState<string | null>(null);
  const [openedViaUrlParam, setOpenedViaUrlParam] = useState(false);

  const { data: employeeList, isLoading: isLoadingList, error: listError } = useQuery<{ employees: EmployeePayrollSummary[] }>({
    queryKey: ["/api/admin/employees/payroll-list"],
  });

  // Check for employeeId query parameter to auto-open edit dialog
  useEffect(() => {
    if (!urlParamProcessed && employeeList?.employees) {
      const urlParams = new URLSearchParams(window.location.search);
      const employeeId = urlParams.get('employeeId');
      const returnTo = urlParams.get('returnTo');
      const period = urlParams.get('period');
      
      if (employeeId) {
        // Verify the employee exists in the list
        const employee = employeeList.employees.find(emp => emp.id === employeeId);
        if (employee) {
          setSelectedEmployeeId(employeeId);
          setEditDialogOpen(true);
          setOpenedViaUrlParam(true);

          // Store return info if coming from generate page
          if (returnTo === 'generate' && period) {
            setReturnToGenerate(period);
          }
        }
        setUrlParamProcessed(true);
      }
    }
  }, [employeeList, urlParamProcessed]);
  
  // Handle dialog close - navigate back to the originating page
  const handleDialogClose = (open: boolean) => {
    setEditDialogOpen(open);
    if (!open) {
      if (returnToGenerate) {
        setLocation('/admin/payroll/generate');
        setReturnToGenerate(null);
      } else if (openedViaUrlParam) {
        setLocation('/admin/payroll');
        setOpenedViaUrlParam(false);
      }
    }
  };

  const filteredEmployees = (employeeList?.employees?.filter(emp => {
    const search = searchTerm.toLowerCase();
    return (
      (emp.name || "").toLowerCase().includes(search) ||
      (emp.email || "").toLowerCase().includes(search) ||
      (emp.employeeCode || "").toLowerCase().includes(search) ||
      (emp.department || "").toLowerCase().includes(search)
    );
  }) || []).sort((a, b) => {
    const nameA = (a.name || "").toLowerCase();
    const nameB = (b.name || "").toLowerCase();
    return nameA.localeCompare(nameB);
  });

  const handleEditEmployee = (employeeId: string) => {
    setSelectedEmployeeId(employeeId);
    setEditDialogOpen(true);
  };

  return (
    <div className="min-h-screen bg-muted/30 p-4 md:p-8">
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">Employee Payroll Settings</h1>
          <p className="text-sm md:text-base text-muted-foreground">
            Configure employee residency status, monthly salary, and allowances
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => setLocation("/admin/payroll")}
            data-testid="button-back"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Payroll Management
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-4">
          <CardTitle className="flex items-center gap-2">
            <Building className="h-5 w-5" />
            Employees ({filteredEmployees.length})
          </CardTitle>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search employees..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9 w-48"
                data-testid="input-search"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoadingList ? (
            <div className="flex items-center justify-center py-12">
              <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : listError ? (
            <div className="text-center py-12">
              <AlertCircle className="h-8 w-8 text-destructive mx-auto mb-2" />
              <p className="text-destructive font-medium">Failed to load employees</p>
              <p className="text-sm text-muted-foreground mt-1">
                {(listError as Error).message || "Please try refreshing the page"}
              </p>
            </div>
          ) : filteredEmployees.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              No employees found matching your criteria
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">#</TableHead>
                    <TableHead>Employee</TableHead>
                    <TableHead>Code</TableHead>
                    <TableHead>Department</TableHead>
                    <TableHead>Residency</TableHead>
                    <TableHead>Monthly Salary</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredEmployees.map((employee, index) => (
                    <TableRow key={employee.id} data-testid={`row-employee-${employee.id}`}>
                      <TableCell className="text-muted-foreground font-mono text-sm">
                        {index + 1}
                      </TableCell>
                      <TableCell>
                        <div>
                          <div className="font-medium">{toTitleCase(employee.name)}</div>
                          <div className="text-sm text-muted-foreground">{employee.email}</div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="font-mono text-sm">{employee.employeeCode || "-"}</span>
                      </TableCell>
                      <TableCell>{employee.department || "-"}</TableCell>
                      <TableCell>
                        <Badge variant={employee.residencyStatus ? "secondary" : "outline"}>
                          {getResidencyLabel(employee.residencyStatus)}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {employee.basicMonthlySalary
                          ? formatCurrency(employee.basicMonthlySalary)
                          : "-"}
                      </TableCell>
                      <TableCell>
                        {(() => {
                          const completion = calculateCompletionPercentage(employee);
                          if (completion === 100) {
                            return (
                              <Badge variant="default" className="bg-green-600">
                                <CheckCircle2 className="h-3 w-3 mr-1" />
                                Complete
                              </Badge>
                            );
                          } else if (completion > 0) {
                            return (
                              <Badge variant="outline" className="border-amber-500 text-amber-600">
                                {completion}% Complete
                              </Badge>
                            );
                          } else {
                            return (
                              <Badge variant="destructive">
                                <AlertCircle className="h-3 w-3 mr-1" />
                                Incomplete
                              </Badge>
                            );
                          }
                        })()}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleEditEmployee(employee.id)}
                          data-testid={`button-edit-${employee.id}`}
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <EditEmployeeDialog
        key={selectedEmployeeId || "empty"}
        employeeId={selectedEmployeeId}
        employeeName={employeeList?.employees?.find(e => e.id === selectedEmployeeId)?.name || null}
        employeeCode={employeeList?.employees?.find(e => e.id === selectedEmployeeId)?.employeeCode || null}
        open={editDialogOpen}
        onOpenChange={(open) => {
          handleDialogClose(open);
          if (!open) setSelectedEmployeeId(null);
        }}
      />
    </div>
    </div>
  );
}

interface EditEmployeeDialogProps {
  employeeId: string | null;
  employeeName: string | null;
  employeeCode: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function EditEmployeeDialog({ employeeId, employeeName, employeeCode, open, onOpenChange }: EditEmployeeDialogProps) {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("settings");

  const { data: settings, isLoading: isLoadingSettings } = useQuery<EmployeePayrollSettings>({
    queryKey: [`/api/admin/employees/${employeeId}/payroll-settings`],
    enabled: !!employeeId && open,
  });

  const { data: auditData, isLoading: isLoadingAudit } = useQuery<{ employee: { id: string; name: string; employeeCode: string | null }; auditLogs: AuditLog[] }>({
    queryKey: [`/api/admin/employees/${employeeId}/audit-logs`],
    enabled: !!employeeId && open && activeTab === "history",
  });

  const { data: adjustmentsData, isLoading: isLoadingAdjustments } = useQuery<{ adjustments: SalaryAdjustment[] }>({
    queryKey: [`/api/admin/employees/${employeeId}/salary-adjustments`],
    enabled: !!employeeId && open && activeTab === "adjustments",
  });

  const [newAdjustmentOpen, setNewAdjustmentOpen] = useState(false);
  const [editingAdjustment, setEditingAdjustment] = useState<SalaryAdjustment | null>(null);
  const [adjustmentForm, setAdjustmentForm] = useState({
    adjustmentType: "addition" as "addition" | "deduction",
    amount: "",
    description: "",
    showForEmployee: true,
  });

  const resetAdjustmentForm = () => {
    setAdjustmentForm({
      adjustmentType: "addition",
      amount: "",
      description: "",
      showForEmployee: true,
    });
    setEditingAdjustment(null);
    setNewAdjustmentOpen(false);
  };

  const createAdjustmentMutation = useMutation({
    mutationFn: async () => {
      const amount = parseFloat(adjustmentForm.amount);
      if (isNaN(amount) || amount <= 0) {
        throw new Error("Amount must be a positive number");
      }
      if (!adjustmentForm.description.trim()) {
        throw new Error("Description is required");
      }
      const response = await apiRequest("POST", `/api/admin/employees/${employeeId}/salary-adjustments`, {
        adjustmentType: adjustmentForm.adjustmentType,
        amount,
        description: adjustmentForm.description.trim(),
        showForEmployee: adjustmentForm.showForEmployee,
      });
      return response.json();
    },
    onSuccess: () => {
      toast({ title: "Success", description: "Salary adjustment created" });
      queryClient.invalidateQueries({ queryKey: [`/api/admin/employees/${employeeId}/salary-adjustments`] });
      queryClient.invalidateQueries({ queryKey: [`/api/admin/employees/${employeeId}/audit-logs`] });
      resetAdjustmentForm();
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to create adjustment", variant: "destructive" });
    },
  });

  const updateAdjustmentMutation = useMutation({
    mutationFn: async () => {
      if (!editingAdjustment) throw new Error("No adjustment selected");
      const amount = parseFloat(adjustmentForm.amount);
      if (isNaN(amount) || amount <= 0) {
        throw new Error("Amount must be a positive number");
      }
      if (!adjustmentForm.description.trim()) {
        throw new Error("Description is required");
      }
      const response = await apiRequest("PATCH", `/api/admin/employees/${employeeId}/salary-adjustments/${editingAdjustment.id}`, {
        adjustmentType: adjustmentForm.adjustmentType,
        amount,
        description: adjustmentForm.description.trim(),
        showForEmployee: adjustmentForm.showForEmployee,
      });
      return response.json();
    },
    onSuccess: () => {
      toast({ title: "Success", description: "Salary adjustment updated" });
      queryClient.invalidateQueries({ queryKey: [`/api/admin/employees/${employeeId}/salary-adjustments`] });
      queryClient.invalidateQueries({ queryKey: [`/api/admin/employees/${employeeId}/audit-logs`] });
      resetAdjustmentForm();
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to update adjustment", variant: "destructive" });
    },
  });

  const deleteAdjustmentMutation = useMutation({
    mutationFn: async (adjustmentId: string) => {
      const response = await apiRequest("DELETE", `/api/admin/employees/${employeeId}/salary-adjustments/${adjustmentId}`);
      return response.json();
    },
    onSuccess: () => {
      toast({ title: "Success", description: "Salary adjustment deleted" });
      queryClient.invalidateQueries({ queryKey: [`/api/admin/employees/${employeeId}/salary-adjustments`] });
      queryClient.invalidateQueries({ queryKey: [`/api/admin/employees/${employeeId}/audit-logs`] });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to delete adjustment", variant: "destructive" });
    },
  });

  const toggleAdjustmentActiveMutation = useMutation({
    mutationFn: async ({ adjustmentId, isActive }: { adjustmentId: string; isActive: boolean }) => {
      const response = await apiRequest("PATCH", `/api/admin/employees/${employeeId}/salary-adjustments/${adjustmentId}`, {
        isActive,
      });
      return response.json();
    },
    onSuccess: () => {
      toast({ title: "Success", description: "Adjustment status updated" });
      queryClient.invalidateQueries({ queryKey: [`/api/admin/employees/${employeeId}/salary-adjustments`] });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to update adjustment", variant: "destructive" });
    },
  });

  const handleEditAdjustment = (adjustment: SalaryAdjustment) => {
    setEditingAdjustment(adjustment);
    setAdjustmentForm({
      adjustmentType: adjustment.adjustmentType,
      amount: String(adjustment.amount),
      description: adjustment.description || "",
      showForEmployee: adjustment.showForEmployee,
    });
    setNewAdjustmentOpen(true);
  };

  const [formState, setFormState] = useState<Partial<EmployeePayrollSettings>>({});
  const [salaryInputText, setSalaryInputText] = useState<string>("");
  const [salaryInputDirty, setSalaryInputDirty] = useState(false);
  
  const [allowanceInputs, setAllowanceInputs] = useState({
    mobile: "",
    transport: "",
    meal: "",
    shift: "",
    other: "",
    houseRental: "",
  });
  const [allowancesDirty, setAllowancesDirty] = useState(false);

  useEffect(() => {
    if (!salaryInputDirty) {
      if (settings?.basicMonthlySalary !== undefined && settings.basicMonthlySalary !== null) {
        setSalaryInputText(dollarsToDisplay(settings.basicMonthlySalary));
      } else {
        setSalaryInputText("");
      }
    }
  }, [settings?.basicMonthlySalary, salaryInputDirty]);

  useEffect(() => {
    if (!open) {
      setSalaryInputDirty(false);
      setSalaryInputText("");
      setAllowancesDirty(false);
      setAllowanceInputs({ mobile: "", transport: "", meal: "", shift: "", other: "", houseRental: "" });
    }
  }, [open]);

  useEffect(() => {
    if (!allowancesDirty && settings) {
      setAllowanceInputs({
        mobile: dollarsToDisplay(settings.defaultMobileAllowance ?? null),
        transport: dollarsToDisplay(settings.defaultTransportAllowance ?? null),
        meal: dollarsToDisplay(settings.defaultMealAllowance ?? null),
        shift: dollarsToDisplay(settings.defaultShiftAllowance ?? null),
        other: dollarsToDisplay(settings.defaultOtherAllowance ?? null),
        houseRental: dollarsToDisplay(settings.defaultHouseRentalAllowance ?? null),
      });
    }
  }, [settings, allowancesDirty]);

  const updateField = (field: keyof EmployeePayrollSettings, value: any) => {
    setFormState(prev => ({ ...prev, [field]: value }));
  };

  const handleAllowanceChange = (key: keyof typeof allowanceInputs, value: string) => {
    if (value === "" || /^\d*\.?\d*$/.test(value)) {
      setAllowanceInputs(prev => ({ ...prev, [key]: value }));
      setAllowancesDirty(true);
    }
  };

  const handleAllowanceBlur = (key: keyof typeof allowanceInputs, field: keyof EmployeePayrollSettings) => {
    const value = allowanceInputs[key];
    if (value && !isNaN(parseFloat(value))) {
      const formatted = parseFloat(value).toFixed(2);
      setAllowanceInputs(prev => ({ ...prev, [key]: formatted }));
      updateField(field, displayToDollars(formatted));
    } else if (value === "") {
      updateField(field, null);
    }
  };

  const allowanceKeyDownHandler = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const allowedKeys = ['Backspace', 'Delete', 'Tab', 'Escape', 'Enter', 'ArrowLeft', 'ArrowRight', 'Home', 'End'];
    if (allowedKeys.includes(e.key)) return;
    if ((e.metaKey || e.ctrlKey) && ['a', 'c', 'v', 'x'].includes(e.key.toLowerCase())) return;
    if (!/[\d.]/.test(e.key)) {
      e.preventDefault();
    }
    if (e.key === '.' && e.currentTarget.value.includes('.')) {
      e.preventDefault();
    }
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const updates: Record<string, any> = {};
      
      if (formState.residencyStatus !== undefined) {
        updates.residencyStatus = formState.residencyStatus || null;
      }
      if (formState.birthDate !== undefined) {
        updates.birthDate = formState.birthDate || null;
      }
      if (formState.sprStartDate !== undefined) {
        updates.sprStartDate = formState.sprStartDate || null;
      }
      if (formState.basicMonthlySalary !== undefined) {
        updates.basicMonthlySalary = formState.basicMonthlySalary;
      }
      if (formState.defaultMobileAllowance !== undefined) {
        updates.defaultMobileAllowance = formState.defaultMobileAllowance;
      }
      if (formState.defaultTransportAllowance !== undefined) {
        updates.defaultTransportAllowance = formState.defaultTransportAllowance;
      }
      if (formState.defaultMealAllowance !== undefined) {
        updates.defaultMealAllowance = formState.defaultMealAllowance;
      }
      if (formState.defaultShiftAllowance !== undefined) {
        updates.defaultShiftAllowance = formState.defaultShiftAllowance;
      }
      if (formState.defaultOtherAllowance !== undefined) {
        updates.defaultOtherAllowance = formState.defaultOtherAllowance;
      }
      if (formState.defaultHouseRentalAllowance !== undefined) {
        updates.defaultHouseRentalAllowance = formState.defaultHouseRentalAllowance;
      }
      if (formState.ethnicity !== undefined) {
        updates.ethnicity = formState.ethnicity || null;
      }
      if (formState.religion !== undefined) {
        updates.religion = formState.religion || null;
      }
      if (formState.shgOptOut !== undefined) {
        updates.shgOptOut = formState.shgOptOut;
      }

      const response = await apiRequest("PATCH", `/api/admin/employees/${employeeId}/payroll-settings`, updates);
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Settings Saved",
        description: `Updated ${data.changesLogged} field(s) for ${settings?.name || "employee"}`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/employees/payroll-list"] });
      queryClient.invalidateQueries({ queryKey: [`/api/admin/employees/${employeeId}/payroll-settings`] });
      queryClient.invalidateQueries({ queryKey: [`/api/admin/employees/${employeeId}/audit-logs`] });
      setFormState({});
      onOpenChange(false);
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to save settings",
        variant: "destructive",
      });
    },
  });

  const handleSave = () => {
    if (Object.keys(formState).length === 0) {
      toast({
        title: "No Changes",
        description: "No changes have been made",
        variant: "default",
      });
      return;
    }
    saveMutation.mutate();
  };

  const getValue = <K extends keyof EmployeePayrollSettings>(field: K): EmployeePayrollSettings[K] | undefined => {
    if (field in formState) return formState[field] as EmployeePayrollSettings[K];
    return settings?.[field];
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <User className="h-5 w-5" />
            {employeeName || settings?.name || "Employee Settings"}
          </DialogTitle>
          <DialogDescription>
            {(employeeCode || settings?.employeeCode) && <span className="font-mono">{employeeCode || settings?.employeeCode}</span>}
            {(employeeCode || settings?.employeeCode) && settings?.department && " • "}
            {settings?.department}
          </DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="settings" data-testid="tab-settings">
              <DollarSign className="h-4 w-4 mr-2" />
              Settings
            </TabsTrigger>
            <TabsTrigger value="adjustments" data-testid="tab-adjustments">
              <PlusCircle className="h-4 w-4 mr-2" />
              Adjustments
            </TabsTrigger>
            <TabsTrigger value="history" data-testid="tab-history">
              <History className="h-4 w-4 mr-2" />
              History
            </TabsTrigger>
          </TabsList>

          <TabsContent value="settings" className="mt-4">
            {isLoadingSettings ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <ScrollArea className="h-[60vh]">
                <div className="space-y-6 pr-4">
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-lg">CPF & Residency</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <Label>Residency Status</Label>
                          <Select
                            value={normalizeResidencyStatus(getValue("residencyStatus"))}
                            onValueChange={(v) => updateField("residencyStatus", v || null)}
                          >
                            <SelectTrigger data-testid="select-residency">
                              <SelectValue placeholder="Select status" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="SC" data-testid="option-residency-singaporean">Singaporean</SelectItem>
                              <SelectItem value="SPR" data-testid="option-residency-spr">Singapore PR</SelectItem>
                              <SelectItem value="FOREIGNER" data-testid="option-residency-foreigner">Foreigner</SelectItem>
                            </SelectContent>
                          </Select>
                          <p className="text-xs text-muted-foreground mt-1">
                            {getValue("residencyStatus") === "FOREIGNER" && "No CPF contributions for foreigners"}
                            {getValue("residencyStatus") === "SPR" && "CPF rates depend on SPR tenure"}
                          </p>
                        </div>
                        <div>
                          <Label>Date of Birth</Label>
                          <Input
                            type="date"
                            value={getValue("birthDate") || ""}
                            onChange={(e) => updateField("birthDate", e.target.value || null)}
                            data-testid="input-birthdate"
                          />
                        </div>
                      </div>

                      {getValue("residencyStatus") === "SPR" && (
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <Label>SPR Start Date</Label>
                            <Input
                              type="date"
                              value={getValue("sprStartDate") || ""}
                              onChange={(e) => updateField("sprStartDate", e.target.value || null)}
                              data-testid="input-spr-start-date"
                            />
                            <p className="text-xs text-muted-foreground mt-1">
                              Used to determine graduated CPF rates
                            </p>
                          </div>
                        </div>
                      )}

                      {/* CPF Calculation Preview */}
                      {(() => {
                        const residency = getValue("residencyStatus") as ResidencyStatus | null;
                        const birthDate = getValue("birthDate");
                        const sprStartDate = getValue("sprStartDate");
                        const salary = formState.basicMonthlySalary !== undefined 
                          ? formState.basicMonthlySalary 
                          : settings?.basicMonthlySalary;
                        
                        if (!residency || !salary || salary <= 0) {
                          return (
                            <div className="mt-4 p-3 bg-muted rounded-lg">
                              <p className="text-sm text-muted-foreground">
                                Enter residency status and salary to see CPF calculations
                              </p>
                            </div>
                          );
                        }

                        if (residency !== "FOREIGNER" && !birthDate) {
                          return (
                            <div className="mt-4 p-3 bg-muted rounded-lg">
                              <p className="text-sm text-muted-foreground">
                                Enter date of birth to calculate CPF based on age bracket
                              </p>
                            </div>
                          );
                        }

                        if (residency === "SPR" && !sprStartDate) {
                          return (
                            <div className="mt-4 p-3 bg-muted rounded-lg">
                              <p className="text-sm text-muted-foreground">
                                Enter SPR start date to calculate graduated CPF rates
                              </p>
                            </div>
                          );
                        }
                        
                        const age = birthDate ? calculateAge(birthDate) : 0;
                        const sprYears = residency === "SPR" && sprStartDate ? calculateSPRYears(sprStartDate) : undefined;
                        const cpfResult = calculateCPF(salary, age, residency, sprYears);
                        
                        return (
                          <div className="mt-4 p-4 bg-muted rounded-lg space-y-3" data-testid="cpf-preview">
                            <div className="flex items-center justify-between flex-wrap gap-2">
                              <span className="text-sm font-medium">CPF Preview</span>
                              <div className="flex gap-2 flex-wrap">
                                {birthDate && (
                                  <Badge variant="outline" className="text-xs">
                                    Age: {age} ({getAgeBracketDescription(age)})
                                  </Badge>
                                )}
                                {residency === "SPR" && sprYears !== undefined && (
                                  <Badge variant="outline" className="text-xs">
                                    {getSPRYearDescription(sprYears)}
                                  </Badge>
                                )}
                              </div>
                            </div>
                            
                            {!cpfResult.isEligible ? (
                              <p className="text-sm text-muted-foreground">{cpfResult.reason}</p>
                            ) : (
                              <div className="grid grid-cols-2 gap-3 text-sm">
                                <div>
                                  <span className="text-muted-foreground">Employee Rate:</span>
                                  <span className="ml-2 font-medium">{formatPercentage(cpfResult.rates.employeeRate)}</span>
                                </div>
                                <div>
                                  <span className="text-muted-foreground">Employer Rate:</span>
                                  <span className="ml-2 font-medium">{formatPercentage(cpfResult.rates.employerRate)}</span>
                                </div>
                                <div>
                                  <span className="text-muted-foreground">Employee CPF:</span>
                                  <span className="ml-2 font-medium text-destructive">${cpfResult.employeeCPF.toFixed(2)}</span>
                                </div>
                                <div>
                                  <span className="text-muted-foreground">Employer CPF:</span>
                                  <span className="ml-2 font-medium">${cpfResult.employerCPF.toFixed(2)}</span>
                                </div>
                                <div className="col-span-2 pt-2 border-t">
                                  <span className="text-muted-foreground">Estimated Net Pay:</span>
                                  <span className="ml-2 font-semibold text-primary">${cpfResult.netPay.toFixed(2)}</span>
                                </div>
                                <div className="col-span-2">
                                  <p className="text-xs text-muted-foreground italic">
                                    Based on 2026 CPF rates. Actual payroll may vary with OT, allowances, and annual ceiling.
                                  </p>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-lg">SHG Contribution</CardTitle>
                      <CardDescription>Self-Help Group fund based on ethnicity/religion</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <Label>Ethnicity</Label>
                          <Select
                            value={getValue("ethnicity") || ""}
                            onValueChange={(v) => updateField("ethnicity", v || null)}
                          >
                            <SelectTrigger data-testid="select-ethnicity">
                              <SelectValue placeholder="Select ethnicity" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="chinese">Chinese</SelectItem>
                              <SelectItem value="indian">Indian</SelectItem>
                              <SelectItem value="malay">Malay</SelectItem>
                              <SelectItem value="eurasian">Eurasian</SelectItem>
                              <SelectItem value="other">Other</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <Label>Religion</Label>
                          <Select
                            value={getValue("religion") || ""}
                            onValueChange={(v) => updateField("religion", v || null)}
                          >
                            <SelectTrigger data-testid="select-religion">
                              <SelectValue placeholder="Select religion" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="muslim">Muslim</SelectItem>
                              <SelectItem value="other">Other / Non-Muslim</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <Switch
                          checked={getValue("shgOptOut") === true}
                          onCheckedChange={(v) => updateField("shgOptOut", v)}
                          data-testid="switch-shg-optout"
                        />
                        <div>
                          <Label>Opt out of SHG contribution</Label>
                          <p className="text-xs text-muted-foreground">
                            Does not apply to MBMF (mandatory for Muslim employees)
                          </p>
                        </div>
                      </div>
                      {(() => {
                        const eth = getValue("ethnicity") as string | null;
                        const rel = getValue("religion") as string | null;
                        const res = getValue("residencyStatus") as string | null;
                        const isSingaporean = res === 'SC' || res === 'SPR';
                        const isForeigner = !isSingaporean;
                        let fund = 'None';
                        if (rel === 'muslim') fund = 'MBMF';
                        else if (eth === 'chinese' && !isForeigner) fund = 'CDAC';
                        else if (eth === 'indian') fund = 'SINDA';
                        else if (eth === 'eurasian' && !isForeigner) fund = 'ECF';
                        const optOut = getValue("shgOptOut") === true && fund !== 'MBMF';
                        return fund !== 'None' ? (
                          <div className="p-3 bg-muted rounded-lg">
                            <p className="text-sm">
                              Applicable fund: <span className="font-semibold">{fund}</span>
                              {optOut && <span className="text-muted-foreground ml-2">(Opted out)</span>}
                            </p>
                          </div>
                        ) : (
                          <div className="p-3 bg-muted rounded-lg">
                            <p className="text-sm text-muted-foreground">
                              {!eth && !rel ? 'Set ethnicity/religion to determine SHG fund' : 'No SHG fund applicable'}
                            </p>
                          </div>
                        );
                      })()}
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-lg">Monthly Salary</CardTitle>
                      <CardDescription>Base monthly salary before allowances and adjustments</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div>
                        <Label>Basic Monthly Salary ($)</Label>
                        <Input
                          type="text"
                          inputMode="decimal"
                          placeholder="0.00"
                          value={salaryInputText}
                          onChange={(e) => {
                            const value = e.target.value;
                            if (value === "" || /^\d*\.?\d*$/.test(value)) {
                              setSalaryInputText(value);
                              setSalaryInputDirty(true);
                              // Also update formState on change so the save button knows there are changes
                              if (value && !isNaN(parseFloat(value))) {
                                updateField("basicMonthlySalary", displayToDollars(value));
                              } else if (value === "") {
                                updateField("basicMonthlySalary", null);
                              }
                            }
                          }}
                          onKeyDown={(e) => {
                            const allowedKeys = ['Backspace', 'Delete', 'Tab', 'Escape', 'Enter', 'ArrowLeft', 'ArrowRight', 'Home', 'End'];
                            if (allowedKeys.includes(e.key)) return;
                            if ((e.metaKey || e.ctrlKey) && ['a', 'c', 'v', 'x'].includes(e.key.toLowerCase())) return;
                            if (!/[\d.]/.test(e.key)) {
                              e.preventDefault();
                            }
                            if (e.key === '.' && e.currentTarget.value.includes('.')) {
                              e.preventDefault();
                            }
                          }}
                          onBlur={(e) => {
                            const value = e.target.value;
                            if (value && !isNaN(parseFloat(value))) {
                              const formatted = parseFloat(value).toFixed(2);
                              setSalaryInputText(formatted);
                              updateField("basicMonthlySalary", displayToDollars(formatted));
                            } else if (value === "") {
                              updateField("basicMonthlySalary", null);
                            }
                          }}
                          className="max-w-xs"
                          data-testid="input-monthly-salary"
                        />
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-lg">Default Allowances</CardTitle>
                      <CardDescription>These are applied automatically when generating payroll</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="grid grid-cols-3 gap-4">
                        <div>
                          <Label>Mobile Allowance ($)</Label>
                          <Input
                            type="text"
                            inputMode="decimal"
                            placeholder="0.00"
                            value={allowanceInputs.mobile}
                            onChange={(e) => handleAllowanceChange("mobile", e.target.value)}
                            onKeyDown={allowanceKeyDownHandler}
                            onBlur={() => handleAllowanceBlur("mobile", "defaultMobileAllowance")}
                            data-testid="input-mobile-allowance"
                          />
                        </div>
                        <div>
                          <Label>Transport Allowance ($)</Label>
                          <Input
                            type="text"
                            inputMode="decimal"
                            placeholder="0.00"
                            value={allowanceInputs.transport}
                            onChange={(e) => handleAllowanceChange("transport", e.target.value)}
                            onKeyDown={allowanceKeyDownHandler}
                            onBlur={() => handleAllowanceBlur("transport", "defaultTransportAllowance")}
                            data-testid="input-transport-allowance"
                          />
                        </div>
                        <div>
                          <Label>Loan ($)</Label>
                          <Input
                            type="text"
                            inputMode="decimal"
                            placeholder="0.00"
                            value={allowanceInputs.meal}
                            onChange={(e) => handleAllowanceChange("meal", e.target.value)}
                            onKeyDown={allowanceKeyDownHandler}
                            onBlur={() => handleAllowanceBlur("meal", "defaultMealAllowance")}
                            data-testid="input-loan"
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-3 gap-4">
                        <div>
                          <Label>Shift Allowance ($)</Label>
                          <Input
                            type="text"
                            inputMode="decimal"
                            placeholder="0.00"
                            value={allowanceInputs.shift}
                            onChange={(e) => handleAllowanceChange("shift", e.target.value)}
                            onKeyDown={allowanceKeyDownHandler}
                            onBlur={() => handleAllowanceBlur("shift", "defaultShiftAllowance")}
                            data-testid="input-shift-allowance"
                          />
                        </div>
                        <div>
                          <Label>Other Allowance ($)</Label>
                          <Input
                            type="text"
                            inputMode="decimal"
                            placeholder="0.00"
                            value={allowanceInputs.other}
                            onChange={(e) => handleAllowanceChange("other", e.target.value)}
                            onKeyDown={allowanceKeyDownHandler}
                            onBlur={() => handleAllowanceBlur("other", "defaultOtherAllowance")}
                            data-testid="input-other-allowance"
                          />
                        </div>
                        <div>
                          <Label>House Rental ($)</Label>
                          <Input
                            type="text"
                            inputMode="decimal"
                            placeholder="0.00"
                            value={allowanceInputs.houseRental}
                            onChange={(e) => handleAllowanceChange("houseRental", e.target.value)}
                            onKeyDown={allowanceKeyDownHandler}
                            onBlur={() => handleAllowanceBlur("houseRental", "defaultHouseRentalAllowance")}
                            data-testid="input-house-rental"
                          />
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </ScrollArea>
            )}

            <div className="flex justify-between gap-2 mt-4 pt-4 border-t">
              <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-cancel">
                <X className="h-4 w-4 mr-2" />
                Cancel
              </Button>
              <Button onClick={handleSave} disabled={saveMutation.isPending} data-testid="button-save">
                {saveMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Save className="h-4 w-4 mr-2" />
                )}
                Save Changes
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="adjustments" className="mt-4">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-medium">Salary Adjustments</h3>
                  <p className="text-sm text-muted-foreground">
                    Recurring additions or deductions applied to payroll
                  </p>
                </div>
                <Button
                  size="sm"
                  onClick={() => {
                    resetAdjustmentForm();
                    setNewAdjustmentOpen(true);
                  }}
                  data-testid="button-add-adjustment"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Add Adjustment
                </Button>
              </div>

              {newAdjustmentOpen && (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">
                      {editingAdjustment ? "Edit Adjustment" : "New Adjustment"}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label>Type</Label>
                        <Select
                          value={adjustmentForm.adjustmentType}
                          onValueChange={(v) => setAdjustmentForm(prev => ({ ...prev, adjustmentType: v as "addition" | "deduction" }))}
                        >
                          <SelectTrigger data-testid="select-adjustment-type">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="addition">
                              <span className="flex items-center gap-2">
                                <PlusCircle className="h-4 w-4 text-green-600" />
                                Addition (Increase)
                              </span>
                            </SelectItem>
                            <SelectItem value="deduction">
                              <span className="flex items-center gap-2">
                                <MinusCircle className="h-4 w-4 text-red-600" />
                                Deduction (Decrease)
                              </span>
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label>Amount ($)</Label>
                        <Input
                          type="text"
                          inputMode="decimal"
                          placeholder="0.00"
                          value={adjustmentForm.amount}
                          onChange={(e) => {
                            const value = e.target.value;
                            if (value === "" || /^\d*\.?\d*$/.test(value)) {
                              setAdjustmentForm(prev => ({ ...prev, amount: value }));
                            }
                          }}
                          data-testid="input-adjustment-amount"
                        />
                      </div>
                    </div>
                    <div>
                      <Label>Description / Reason</Label>
                      <Textarea
                        placeholder="e.g., Annual increment, Performance bonus, Loan deduction..."
                        value={adjustmentForm.description}
                        onChange={(e) => setAdjustmentForm(prev => ({ ...prev, description: e.target.value }))}
                        className="resize-none"
                        rows={2}
                        data-testid="input-adjustment-description"
                      />
                    </div>
                    <div className="flex items-center space-x-2">
                      <Switch
                        id="showForEmployee"
                        checked={adjustmentForm.showForEmployee}
                        onCheckedChange={(checked) => setAdjustmentForm(prev => ({ ...prev, showForEmployee: checked }))}
                        data-testid="switch-show-employee"
                      />
                      <Label htmlFor="showForEmployee" className="text-sm">
                        Show on employee payslip
                      </Label>
                    </div>
                    <div className="flex justify-end gap-2">
                      <Button variant="outline" size="sm" onClick={resetAdjustmentForm} data-testid="button-cancel-adjustment">
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => editingAdjustment ? updateAdjustmentMutation.mutate() : createAdjustmentMutation.mutate()}
                        disabled={createAdjustmentMutation.isPending || updateAdjustmentMutation.isPending}
                        data-testid="button-save-adjustment"
                      >
                        {(createAdjustmentMutation.isPending || updateAdjustmentMutation.isPending) && (
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        )}
                        {editingAdjustment ? "Update" : "Create"}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )}

              {isLoadingAdjustments ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : adjustmentsData?.adjustments && adjustmentsData.adjustments.length > 0 ? (
                <ScrollArea className="h-[50vh]">
                  <div className="space-y-2">
                    {adjustmentsData.adjustments.map((adj) => (
                      <Card key={adj.id} className={!adj.isActive ? "opacity-50" : ""} data-testid={`card-adjustment-${adj.id}`}>
                        <CardContent className="py-3 px-4">
                          <div className="flex items-center justify-between gap-4">
                            <div className="flex items-center gap-3 flex-1">
                              {adj.adjustmentType === "addition" ? (
                                <PlusCircle className="h-5 w-5 text-green-600 shrink-0" />
                              ) : (
                                <MinusCircle className="h-5 w-5 text-red-600 shrink-0" />
                              )}
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <span className={`font-semibold ${adj.adjustmentType === "addition" ? "text-green-600" : "text-red-600"}`}>
                                    {adj.adjustmentType === "addition" ? "+" : "-"}${Number(adj.amount).toFixed(2)}
                                  </span>
                                  {!adj.isActive && <Badge variant="outline" className="text-xs">Inactive</Badge>}
                                  {!adj.showForEmployee && <Badge variant="secondary" className="text-xs">Hidden</Badge>}
                                </div>
                                <p className="text-sm text-muted-foreground truncate">{adj.description}</p>
                                <p className="text-xs text-muted-foreground mt-1">
                                  Added by {adj.createdBy} on {format(new Date(adj.createdAt), "dd/MM/yyyy")}
                                </p>
                              </div>
                            </div>
                            <div className="flex items-center gap-1">
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => toggleAdjustmentActiveMutation.mutate({ adjustmentId: adj.id, isActive: !adj.isActive })}
                                title={adj.isActive ? "Deactivate" : "Activate"}
                                data-testid={`button-toggle-${adj.id}`}
                              >
                                {adj.isActive ? (
                                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                                ) : (
                                  <AlertCircle className="h-4 w-4 text-muted-foreground" />
                                )}
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => handleEditAdjustment(adj)}
                                data-testid={`button-edit-adjustment-${adj.id}`}
                              >
                                <Edit className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => deleteAdjustmentMutation.mutate(adj.id)}
                                disabled={deleteAdjustmentMutation.isPending}
                                data-testid={`button-delete-adjustment-${adj.id}`}
                              >
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </ScrollArea>
              ) : (
                <div className="text-center py-12 text-muted-foreground border rounded-lg">
                  <DollarSign className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>No salary adjustments configured</p>
                  <p className="text-sm mt-1">Add adjustments to increase or decrease payroll</p>
                </div>
              )}
            </div>
          </TabsContent>

          <TabsContent value="history" className="mt-4">
            {isLoadingAudit ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <ScrollArea className="h-[60vh]">
                {auditData?.auditLogs && auditData.auditLogs.length > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Field</TableHead>
                        <TableHead>Old Value</TableHead>
                        <TableHead>New Value</TableHead>
                        <TableHead>Changed By</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {auditData.auditLogs.map((log) => (
                        <TableRow key={log.id} data-testid={`row-audit-${log.id}`}>
                          <TableCell className="whitespace-nowrap">
                            {format(new Date(log.createdAt), "dd/MM/yyyy HH:mm")}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline">{getFieldLabel(log.fieldChanged)}</Badge>
                          </TableCell>
                          <TableCell className="max-w-32 truncate text-muted-foreground">
                            {log.oldValue || "-"}
                          </TableCell>
                          <TableCell className="max-w-32 truncate">
                            {log.newValue || "-"}
                          </TableCell>
                          <TableCell>
                            <span className="text-sm">{log.changedBy}</span>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <div className="text-center py-12 text-muted-foreground">
                    <History className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p>No audit history found for this employee</p>
                  </div>
                )}
              </ScrollArea>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

// Salary adjustments are now managed through Payroll Management page using PayrollAdjustmentsDialog
