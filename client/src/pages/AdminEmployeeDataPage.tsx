import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { ArrowLeft, Search, Edit, History, Users, RefreshCw, X, Save, Filter, Calculator, UserPlus, AlertCircle, Download, Archive, ArchiveRestore, LogOut, FileUp, Trash2, Eye, FileText, AlertTriangle } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { useLocation } from "wouter";
import { useState, useMemo } from "react";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { User, EmployeeDataAuditLog, EmployeeDocument } from "@shared/schema";
import { toTitleCase } from "@/lib/utils";

interface EditableFields {
  name: string;
  email: string;
  designation: string;
  mobileNumber: string;
  gender: string;
  joinDate: string;
  resignDate: string;
  nricFin: string;
  birthday: string;
  workPermitNumber: string;
  workPermitExpiry: string;
  finNumber: string;
  finNumberExpiry: string;
  remarks1: string;
  remarks2: string;
  remarks3: string;
  remarks4: string;
  // Foreign employee fields
  passportNumber: string;
  passportExpiry: string;
  // Salary calculation fields
  basicMonthlySalary: string;
  weeklyContractHours: string;
  regularDaysPerWeek: string;
  hourlyRate: string;
  ot15Rate: string;
  ot20Rate: string;
  defaultMobileAllowance: string;
  defaultTransportAllowance: string;
  defaultMealAllowance: string;
  defaultShiftAllowance: string;
  defaultOtherAllowance: string;
  defaultHouseRentalAllowance: string;
}

export default function AdminEmployeeDataPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedDepartment, setSelectedDepartment] = useState<string>("all");
  const [showIncompleteOnly, setShowIncompleteOnly] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [selectedArchivedIds, setSelectedArchivedIds] = useState<string[]>([]);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [viewingAuditUser, setViewingAuditUser] = useState<User | null>(null);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [newEmployeeData, setNewEmployeeData] = useState({
    employeeCode: "",
    name: "",
    email: "",
    department: "",
    designation: "",
    mobileNumber: "",
    gender: "",
    joinDate: "",
  });
  const [editFormData, setEditFormData] = useState<EditableFields>({
    name: "",
    email: "",
    designation: "",
    mobileNumber: "",
    gender: "",
    joinDate: "",
    resignDate: "",
    nricFin: "",
    birthday: "",
    workPermitNumber: "",
    workPermitExpiry: "",
    finNumber: "",
    finNumberExpiry: "",
    remarks1: "",
    remarks2: "",
    remarks3: "",
    remarks4: "",
    passportNumber: "",
    passportExpiry: "",
    basicMonthlySalary: "",
    weeklyContractHours: "44",
    regularDaysPerWeek: "5",
    hourlyRate: "",
    ot15Rate: "",
    ot20Rate: "",
    defaultMobileAllowance: "",
    defaultTransportAllowance: "",
    defaultMealAllowance: "",
    defaultShiftAllowance: "",
    defaultOtherAllowance: "",
    defaultHouseRentalAllowance: "",
  });

  const { data: usersData, isLoading: usersLoading, refetch: refetchUsers } = useQuery<User[]>({
    queryKey: ["/api/admin/users"],
  });

  const { data: sessionData } = useQuery<{ isEmployeeDataAdmin?: boolean }>({
    queryKey: ["/api/auth/session"],
  });

  const isEmployeeDataAdmin = sessionData?.isEmployeeDataAdmin || false;

  const { data: superAdminData } = useQuery<{ isSuperAdmin: boolean }>({
    queryKey: ['/api/admin/is-super-admin'],
  });
  const isSuperAdmin = superAdminData?.isSuperAdmin === true;

  const [showDeleteEmployeeDialog, setShowDeleteEmployeeDialog] = useState(false);
  const [employeeToDelete, setEmployeeToDelete] = useState<User | null>(null);
  const [deleteReason, setDeleteReason] = useState("");

  // Document upload state
  const [documentUploadState, setDocumentUploadState] = useState({
    isUploading: false,
    documentType: "other" as string,
    documentName: "",
    expiryDate: "",
    notes: "",
  });

  // Fetch employee documents when editing - uses constructed queryKey for proper cache invalidation
  const documentQueryKey = editingUser?.id ? `/api/admin/employees/${editingUser.id}/documents` : null;
  const { data: employeeDocuments } = useQuery<EmployeeDocument[]>({
    queryKey: [documentQueryKey],
    enabled: !!editingUser?.id && !!documentQueryKey,
  });

  const logoutMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", "/api/admin/logout");
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/auth/session"] });
      setLocation("/admin");
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
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete employee",
        variant: "destructive",
      });
    },
  });

  const { data: archivedUsersData, isLoading: archivedLoading, refetch: refetchArchivedUsers } = useQuery<User[]>({
    queryKey: ["/api/admin/users/archived"],
    enabled: showArchived && !isEmployeeDataAdmin,
  });

  const { data: auditLogsData, isLoading: auditLoading } = useQuery<{ employee: { id: string; name: string; employeeCode: string }; auditLogs: EmployeeDataAuditLog[] }>({
    queryKey: ["/api/admin/employees", viewingAuditUser?.id, "data-audit-logs"],
    queryFn: async () => {
      if (!viewingAuditUser?.id) return { employee: { id: "", name: "", employeeCode: "" }, auditLogs: [] };
      const response = await fetch(`/api/admin/employees/${viewingAuditUser.id}/data-audit-logs`, {
        credentials: 'include',
      });
      if (!response.ok) throw new Error('Failed to fetch audit logs');
      return response.json();
    },
    enabled: !!viewingAuditUser?.id,
  });

  const updateUserMutation = useMutation({
    mutationFn: async (data: { userId: string; updates: Partial<EditableFields> }) => {
      return await apiRequest("PUT", `/api/admin/users/${data.userId}`, data.updates);
    },
    onSuccess: async () => {
      toast({
        title: "Success",
        description: "Employee data updated successfully",
      });
      setEditingUser(null);
      await queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update employee data",
        variant: "destructive",
      });
    },
  });

  const createUserMutation = useMutation({
    mutationFn: async (data: typeof newEmployeeData) => {
      const response = await apiRequest("POST", "/api/admin/users/create", data);
      return response.json() as Promise<{ initialPassword?: string; user?: { name?: string } }>;
    },
    onSuccess: async (response) => {
      toast({
        title: "Employee Created",
        description: `${response.user?.name || "Employee"} created successfully. Initial password: ${response.initialPassword}`,
      });
      setIsAddDialogOpen(false);
      setNewEmployeeData({
        employeeCode: "",
        name: "",
        email: "",
        department: "",
        designation: "",
        mobileNumber: "",
        gender: "",
        joinDate: "",
      });
      await queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create employee",
        variant: "destructive",
      });
    },
  });

  const deleteDocumentMutation = useMutation({
    mutationFn: async (docId: string) => {
      if (!editingUser?.id) throw new Error("No employee selected");
      return await apiRequest("DELETE", `/api/admin/employees/${editingUser.id}/documents/${docId}`);
    },
    onSuccess: async () => {
      toast({
        title: "Success",
        description: "Document deleted successfully",
      });
      // Invalidate documents cache for this employee
      if (documentQueryKey) {
        await queryClient.invalidateQueries({ queryKey: [documentQueryKey] });
      }
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete document",
        variant: "destructive",
      });
    },
  });

  const handleDocumentUpload = async (file: File) => {
    if (!editingUser?.id) return;
    
    setDocumentUploadState(prev => ({ ...prev, isUploading: true }));
    
    const formData = new FormData();
    formData.append('file', file);
    formData.append('documentType', documentUploadState.documentType);
    formData.append('documentName', documentUploadState.documentName || file.name);
    if (documentUploadState.expiryDate) {
      formData.append('expiryDate', documentUploadState.expiryDate);
    }
    if (documentUploadState.notes) {
      formData.append('notes', documentUploadState.notes);
    }
    
    try {
      const response = await fetch(`/api/admin/employees/${editingUser.id}/documents`, {
        method: 'POST',
        credentials: 'include',
        body: formData,
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to upload document');
      }
      
      toast({
        title: "Success",
        description: "Document uploaded successfully",
      });
      
      // Reset form
      setDocumentUploadState({
        isUploading: false,
        documentType: "other",
        documentName: "",
        expiryDate: "",
        notes: "",
      });
      
      // Invalidate documents cache for this employee
      if (documentQueryKey) {
        await queryClient.invalidateQueries({ queryKey: [documentQueryKey] });
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to upload document",
        variant: "destructive",
      });
      setDocumentUploadState(prev => ({ ...prev, isUploading: false }));
    }
  };

  const archiveMutation = useMutation({
    mutationFn: async (userIds: string[]) => {
      return await apiRequest("POST", "/api/admin/users/archive", { userIds });
    },
    onSuccess: async () => {
      toast({
        title: "Success",
        description: "Employee archived successfully",
      });
      await queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/admin/users/archived"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to archive employee",
        variant: "destructive",
      });
    },
  });

  const unarchiveMutation = useMutation({
    mutationFn: async (userIds: string[]) => {
      return await apiRequest("POST", "/api/admin/users/unarchive", { userIds });
    },
    onSuccess: async () => {
      toast({
        title: "Success",
        description: "Employee restored successfully",
      });
      await queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/admin/users/archived"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to restore employee",
        variant: "destructive",
      });
    },
  });

  const isIncompleteRecord = (user: User): boolean => {
    return !user.employeeCode || !user.department || !user.basicMonthlySalary;
  };

  const users = usersData || [];

  const departments = useMemo(() => {
    const deptSet = new Set<string>();
    users.forEach(u => {
      if (u.department) deptSet.add(u.department);
    });
    return Array.from(deptSet).sort();
  }, [users]);

  const incompleteCount = useMemo(() => {
    return users.filter(u => !u.isArchived && isIncompleteRecord(u)).length;
  }, [users]);

  const filteredUsers = useMemo(() => {
    return users
      .filter(u => !u.isArchived)
      .filter(u => {
        const matchesSearch = searchTerm === "" || 
          u.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
          (u.employeeCode?.toLowerCase().includes(searchTerm.toLowerCase())) ||
          (u.email?.toLowerCase().includes(searchTerm.toLowerCase()));
        
        const matchesDepartment = selectedDepartment === "all" || u.department === selectedDepartment;
        
        const matchesIncomplete = !showIncompleteOnly || isIncompleteRecord(u);
        
        return matchesSearch && matchesDepartment && matchesIncomplete;
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [users, searchTerm, selectedDepartment, showIncompleteOnly]);

  const archivedUsers = useMemo(() => {
    const archived = archivedUsersData || [];
    return archived
      .filter(u => {
        const matchesSearch = searchTerm === "" || 
          u.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
          (u.employeeCode?.toLowerCase().includes(searchTerm.toLowerCase())) ||
          (u.email?.toLowerCase().includes(searchTerm.toLowerCase()));
        return matchesSearch;
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [archivedUsersData, searchTerm]);

  const handleEditClick = (user: User) => {
    setEditingUser(user);
    setEditFormData({
      name: user.name || "",
      email: user.email || "",
      designation: user.designation || "",
      mobileNumber: user.mobileNumber || "",
      gender: user.gender || "",
      joinDate: user.joinDate || "",
      resignDate: user.resignDate || "",
      nricFin: user.nricFin || "",
      birthday: user.birthday || "",
      workPermitNumber: user.workPermitNumber || "",
      workPermitExpiry: user.workPermitExpiry || "",
      finNumber: user.finNumber || "",
      finNumberExpiry: user.finNumberExpiry || "",
      remarks1: user.remarks1 || "",
      remarks2: user.remarks2 || "",
      remarks3: user.remarks3 || "",
      remarks4: user.remarks4 || "",
      passportNumber: user.passportNumber || "",
      passportExpiry: user.passportExpiry || "",
      basicMonthlySalary: user.basicMonthlySalary || "",
      weeklyContractHours: user.weeklyContractHours?.toString() || "44",
      regularDaysPerWeek: user.regularDaysPerWeek?.toString() || "5",
      hourlyRate: user.hourlyRate || "",
      ot15Rate: user.ot15Rate || "",
      ot20Rate: user.ot20Rate || "",
      defaultMobileAllowance: user.defaultMobileAllowance || "",
      defaultTransportAllowance: user.defaultTransportAllowance || "",
      defaultMealAllowance: user.defaultMealAllowance || "",
      defaultShiftAllowance: user.defaultShiftAllowance || "",
      defaultOtherAllowance: user.defaultOtherAllowance || "",
      defaultHouseRentalAllowance: user.defaultHouseRentalAllowance || "",
    });
  };

  const handleSaveEdit = () => {
    if (!editingUser) return;
    updateUserMutation.mutate({
      userId: editingUser.id,
      updates: editFormData,
    });
  };

  const handleViewAuditLog = (user: User) => {
    setViewingAuditUser(user);
  };

  const auditLogs = auditLogsData?.auditLogs || [];

  const getFieldLabel = (field: string): string => {
    const labels: Record<string, string> = {
      name: "Name",
      email: "Email",
      designation: "Designation",
      mobileNumber: "Mobile Number",
      gender: "Gender",
      joinDate: "Join Date",
      resignDate: "Resign Date",
      nricFin: "NRIC/FIN",
      employeeCode: "Employee Code",
      birthday: "Birthday",
      workPermitNumber: "Work Permit Number",
      workPermitExpiry: "Work Permit Expiry",
      finNumber: "FIN Number",
      finNumberExpiry: "FIN Number Expiry",
      remarks1: "Remarks 1",
      remarks2: "Remarks 2",
      remarks3: "Remarks 3",
      remarks4: "Remarks 4",
      basicMonthlySalary: "Monthly Salary",
      hourlyRate: "Hourly Rate",
      ot15Rate: "OT 1.5x Rate",
      ot20Rate: "OT 2.0x Rate",
      defaultMobileAllowance: "Mobile Allowance",
      defaultTransportAllowance: "Transport Allowance",
      defaultMealAllowance: "Loan",
      defaultShiftAllowance: "Shift Allowance",
      defaultOtherAllowance: "Other Allowance",
      defaultHouseRentalAllowance: "House Rental Allowance",
    };
    return labels[field] || field;
  };

  const calculateMOMRates = (monthlySalary: number, weeklyHours: number) => {
    if (monthlySalary <= 0 || weeklyHours <= 0) return null;
    // MOM-compliant formula: (Monthly Salary × 12) ÷ (52 × Weekly Hours)
    const hourly = (monthlySalary * 12) / (52 * weeklyHours);
    const ot15 = hourly * 1.5;
    const ot20 = hourly * 2.0;
    return { hourly, ot15, ot20 };
  };

  const calculateRates = () => {
    const monthlySalary = parseFloat(editFormData.basicMonthlySalary) || 0;
    const weeklyHours = parseFloat(editFormData.weeklyContractHours) || 44;
    
    if (monthlySalary <= 0) {
      toast({
        title: "Error",
        description: "Please enter a valid monthly salary first",
        variant: "destructive",
      });
      return;
    }
    if (weeklyHours <= 0) {
      toast({
        title: "Error",
        description: "Please enter valid weekly contract hours",
        variant: "destructive",
      });
      return;
    }
    
    const rates = calculateMOMRates(monthlySalary, weeklyHours);
    if (!rates) return;
    
    setEditFormData(prev => ({
      ...prev,
      hourlyRate: rates.hourly.toFixed(2),
      ot15Rate: rates.ot15.toFixed(2),
      ot20Rate: rates.ot20.toFixed(2),
    }));
    
    toast({
      title: "MOM-Compliant Rates Calculated",
      description: `Hourly: $${rates.hourly.toFixed(2)}, OT 1.5x: $${rates.ot15.toFixed(2)}, OT 2.0x: $${rates.ot20.toFixed(2)}`,
    });
  };

  const handleExportEmployees = () => {
    if (!users || users.length === 0) {
      toast({
        title: "No Data",
        description: "No employee data to export",
        variant: "destructive",
      });
      return;
    }

    const headers = [
      "Employee Code",
      "Name",
      "Email",
      "Department",
      "Designation",
      "Mobile Number",
      "Gender",
      "NRIC/FIN",
      "Birthday",
      "Join Date",
      "Resign Date",
      "Work Permit Number",
      "Work Permit Expiry",
      "FIN Number",
      "Role",
      "Is Approved",
      "Monthly Salary",
      "Hourly Rate",
      "OT 1.5x Rate",
      "OT 2.0x Rate",
      "Mobile Allowance",
      "Transport Allowance",
      "Meal Allowance",
      "Shift Allowance",
      "Other Allowance",
      "House Rental Allowance",
      "Remarks 1",
      "Remarks 2",
      "Remarks 3",
      "Remarks 4",
    ];

    const csvContent = [
      headers.join(","),
      ...users.map((u) => [
        u.employeeCode || "",
        `"${(toTitleCase(u.name || "")).replace(/"/g, '""')}"`,
        u.email || "",
        u.department || "",
        `"${(u.designation || "").replace(/"/g, '""')}"`,
        u.mobileNumber || "",
        u.gender || "",
        u.nricFin || "",
        u.birthday || "",
        u.joinDate || "",
        u.resignDate || "",
        u.workPermitNumber || "",
        u.workPermitExpiry || "",
        u.finNumber || "",
        u.role || "",
        u.isApproved ? "Yes" : "No",
        u.basicMonthlySalary || "",
        u.hourlyRate || "",
        u.ot15Rate || "",
        u.ot20Rate || "",
        u.defaultMobileAllowance || "",
        u.defaultTransportAllowance || "",
        u.defaultMealAllowance || "",
        u.defaultShiftAllowance || "",
        u.defaultOtherAllowance || "",
        u.defaultHouseRentalAllowance || "",
        `"${(u.remarks1 || "").replace(/"/g, '""')}"`,
        `"${(u.remarks2 || "").replace(/"/g, '""')}"`,
        `"${(u.remarks3 || "").replace(/"/g, '""')}"`,
        `"${(u.remarks4 || "").replace(/"/g, '""')}"`,
      ].join(","))
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", `employees_export_${format(new Date(), "yyyy-MM-dd")}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    toast({
      title: "Export Complete",
      description: `Exported ${users.length} employee records`,
    });
  };

  return (
    <div className="min-h-screen bg-muted/30 p-4 md:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold" data-testid="text-page-title">
              Employee Data Management
            </h1>
            <p className="text-sm md:text-base text-muted-foreground">
              View and edit employee information with full audit trail
            </p>
          </div>
          <div className="flex items-center gap-2">
            {!isEmployeeDataAdmin && (
              <Button
                variant="outline"
                onClick={() => setLocation("/admin/dashboard")}
                data-testid="button-back"
              >
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back to Dashboard
              </Button>
            )}
            <Button
              variant="outline"
              onClick={() => refetchUsers()}
              data-testid="button-refresh"
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              Refresh
            </Button>
            {!isEmployeeDataAdmin && (
              <Button
                variant="outline"
                onClick={handleExportEmployees}
                data-testid="button-export-employees"
              >
                <Download className="h-4 w-4 mr-2" />
                Export
              </Button>
            )}
            {isSuperAdmin && (
              <Button
                variant="outline"
                onClick={() => {
                  setEmployeeToDelete(null);
                  setDeleteReason("");
                  setShowDeleteEmployeeDialog(true);
                }}
                data-testid="button-delete-employee"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Delete Employee
              </Button>
            )}
            <Button
              onClick={() => setIsAddDialogOpen(true)}
              data-testid="button-add-employee"
            >
              <UserPlus className="h-4 w-4 mr-2" />
              Add Employee
            </Button>
            {isEmployeeDataAdmin && (
              <Button
                variant="outline"
                onClick={() => logoutMutation.mutate()}
                data-testid="button-logout"
              >
                <LogOut className="h-4 w-4 mr-2" />
                Logout
              </Button>
            )}
          </div>
        </div>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-4">
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Employees ({filteredUsers.length})
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
              <Select value={selectedDepartment} onValueChange={setSelectedDepartment}>
                <SelectTrigger className="w-40" data-testid="select-department">
                  <Filter className="h-4 w-4 mr-2" />
                  <SelectValue placeholder="Department" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Departments</SelectItem>
                  {departments.map((dept) => (
                    <SelectItem key={dept} value={dept}>{dept}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant={showIncompleteOnly ? "default" : "outline"}
                onClick={() => setShowIncompleteOnly(!showIncompleteOnly)}
                className="gap-2"
                data-testid="button-show-incomplete"
              >
                <AlertCircle className="h-4 w-4" />
                Incomplete
                {incompleteCount > 0 && (
                  <Badge variant="secondary" className="ml-1" data-testid="badge-incomplete-count">
                    {incompleteCount}
                  </Badge>
                )}
              </Button>
              {!isEmployeeDataAdmin && (
                <Button
                  variant={showArchived ? "default" : "outline"}
                  onClick={() => {
                    if (showArchived) {
                      setSelectedArchivedIds([]);
                    } else {
                      refetchArchivedUsers();
                    }
                    setShowArchived(!showArchived);
                  }}
                  className="gap-2"
                  data-testid="button-show-archived"
                >
                  <Archive className="h-4 w-4" />
                  Archived
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {usersLoading ? (
              <div className="flex items-center justify-center py-8">
                <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : filteredUsers.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                No employees found matching your criteria
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-16">S/N</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Department</TableHead>
                      <TableHead>Designation</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Join Date</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredUsers.map((user, index) => (
                      <TableRow key={user.id} data-testid={`row-employee-${user.id}`}>
                        <TableCell className="font-mono text-muted-foreground">
                          <div className="flex items-center gap-2">
                            {index + 1}
                            {isIncompleteRecord(user) && (
                              <AlertCircle className="h-4 w-4 text-amber-500" />
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="font-medium">
                          <div className="flex items-center gap-2 flex-wrap">
                            {toTitleCase(user.name)}
                            {user.passportExpiry && new Date(user.passportExpiry) < new Date() && (
                              <Badge variant="destructive" className="text-xs flex items-center gap-1" title="Passport expired">
                                <AlertTriangle className="h-3 w-3" />
                                Passport
                              </Badge>
                            )}
                            {user.passportExpiry && new Date(user.passportExpiry) >= new Date() && new Date(user.passportExpiry) <= new Date(Date.now() + 90 * 24 * 60 * 60 * 1000) && (
                              <Badge variant="secondary" className="text-xs flex items-center gap-1 bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200" title="Passport expiring soon">
                                <AlertTriangle className="h-3 w-3" />
                                Passport
                              </Badge>
                            )}
                            {user.workPermitExpiry && new Date(user.workPermitExpiry) < new Date() && (
                              <Badge variant="destructive" className="text-xs flex items-center gap-1" title="Work Pass expired">
                                <AlertTriangle className="h-3 w-3" />
                                Work Pass
                              </Badge>
                            )}
                            {user.workPermitExpiry && new Date(user.workPermitExpiry) >= new Date() && new Date(user.workPermitExpiry) <= new Date(Date.now() + 90 * 24 * 60 * 60 * 1000) && (
                              <Badge variant="secondary" className="text-xs flex items-center gap-1 bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200" title="Work Pass expiring soon">
                                <AlertTriangle className="h-3 w-3" />
                                Work Pass
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>{user.department || "-"}</TableCell>
                        <TableCell>{user.designation || "-"}</TableCell>
                        <TableCell className="text-muted-foreground">{user.email || "-"}</TableCell>
                        <TableCell>{user.joinDate || "-"}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleEditClick(user)}
                              data-testid={`button-edit-${user.id}`}
                            >
                              <Edit className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleViewAuditLog(user)}
                              data-testid={`button-audit-${user.id}`}
                            >
                              <History className="h-4 w-4" />
                            </Button>
                            {!isEmployeeDataAdmin && (
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => archiveMutation.mutate([user.id])}
                                disabled={archiveMutation.isPending}
                                data-testid={`button-archive-${user.id}`}
                                title="Archive employee"
                              >
                                <Archive className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {showArchived && !isEmployeeDataAdmin && (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-4">
              <CardTitle className="flex items-center gap-2">
                <Archive className="h-5 w-5" />
                Archived Employees ({archivedUsers.length})
              </CardTitle>
              {selectedArchivedIds.length > 0 && (
                <Button
                  onClick={() => {
                    unarchiveMutation.mutate(selectedArchivedIds);
                    setSelectedArchivedIds([]);
                  }}
                  disabled={unarchiveMutation.isPending}
                  data-testid="button-restore-selected"
                >
                  <ArchiveRestore className="h-4 w-4 mr-2" />
                  Restore Selected ({selectedArchivedIds.length})
                </Button>
              )}
            </CardHeader>
            <CardContent>
              {archivedLoading ? (
                <div className="flex items-center justify-center py-8">
                  <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : archivedUsers.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  No archived employees
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-12">
                          <Checkbox
                            checked={selectedArchivedIds.length === archivedUsers.length && archivedUsers.length > 0}
                            onCheckedChange={(checked) => {
                              if (checked) {
                                setSelectedArchivedIds(archivedUsers.map(u => u.id));
                              } else {
                                setSelectedArchivedIds([]);
                              }
                            }}
                            data-testid="checkbox-select-all-archived"
                          />
                        </TableHead>
                        <TableHead className="w-16">S/N</TableHead>
                        <TableHead>Name</TableHead>
                        <TableHead>Department</TableHead>
                        <TableHead>Designation</TableHead>
                        <TableHead>Email</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {archivedUsers.map((user, index) => (
                        <TableRow key={user.id} className="opacity-70" data-testid={`row-archived-${user.id}`}>
                          <TableCell>
                            <Checkbox
                              checked={selectedArchivedIds.includes(user.id)}
                              onCheckedChange={(checked) => {
                                if (checked) {
                                  setSelectedArchivedIds(prev => [...prev, user.id]);
                                } else {
                                  setSelectedArchivedIds(prev => prev.filter(id => id !== user.id));
                                }
                              }}
                              data-testid={`checkbox-archived-${user.id}`}
                            />
                          </TableCell>
                          <TableCell className="font-mono text-muted-foreground">
                            {index + 1}
                          </TableCell>
                          <TableCell className="font-medium">{toTitleCase(user.name)}</TableCell>
                          <TableCell>{user.department || "-"}</TableCell>
                          <TableCell>{user.designation || "-"}</TableCell>
                          <TableCell className="text-muted-foreground">{user.email || "-"}</TableCell>
                          <TableCell className="text-right">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => unarchiveMutation.mutate([user.id])}
                              disabled={unarchiveMutation.isPending}
                              data-testid={`button-restore-${user.id}`}
                            >
                              <ArchiveRestore className="h-4 w-4 mr-2" />
                              Restore
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
        )}

        <Dialog open={!!editingUser} onOpenChange={(open) => !open && setEditingUser(null)}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Edit className="h-5 w-5" />
                Edit Employee: {editingUser?.name}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-6 py-4">
              {/* Basic Information */}
              <div>
                <h3 className="text-sm font-medium text-muted-foreground mb-3">Basic Information</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="edit-name">Name</Label>
                    <Input
                      id="edit-name"
                      value={editFormData.name}
                      onChange={(e) => setEditFormData(prev => ({ ...prev, name: e.target.value }))}
                      data-testid="input-edit-name"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="edit-email">Email</Label>
                    <Input
                      id="edit-email"
                      type="email"
                      value={editFormData.email}
                      onChange={(e) => setEditFormData(prev => ({ ...prev, email: e.target.value }))}
                      data-testid="input-edit-email"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="edit-designation">Designation</Label>
                    <Input
                      id="edit-designation"
                      value={editFormData.designation}
                      onChange={(e) => setEditFormData(prev => ({ ...prev, designation: e.target.value }))}
                      data-testid="input-edit-designation"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="edit-mobileNumber">Mobile Number</Label>
                    <Input
                      id="edit-mobileNumber"
                      value={editFormData.mobileNumber}
                      onChange={(e) => setEditFormData(prev => ({ ...prev, mobileNumber: e.target.value }))}
                      data-testid="input-edit-mobileNumber"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="edit-gender">Gender</Label>
                    <Select 
                      value={editFormData.gender} 
                      onValueChange={(value) => setEditFormData(prev => ({ ...prev, gender: value }))}
                    >
                      <SelectTrigger data-testid="select-edit-gender">
                        <SelectValue placeholder="Select gender" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="male">Male</SelectItem>
                        <SelectItem value="female">Female</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="edit-birthday">Birthday</Label>
                    <Input
                      id="edit-birthday"
                      type="date"
                      value={editFormData.birthday}
                      onChange={(e) => setEditFormData(prev => ({ ...prev, birthday: e.target.value }))}
                      data-testid="input-edit-birthday"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="edit-joinDate">Join Date</Label>
                    <Input
                      id="edit-joinDate"
                      type="date"
                      value={editFormData.joinDate}
                      onChange={(e) => setEditFormData(prev => ({ ...prev, joinDate: e.target.value }))}
                      data-testid="input-edit-joinDate"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="edit-resignDate">Resign Date</Label>
                    <Input
                      id="edit-resignDate"
                      type="date"
                      value={editFormData.resignDate}
                      onChange={(e) => setEditFormData(prev => ({ ...prev, resignDate: e.target.value }))}
                      data-testid="input-edit-resignDate"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="edit-nricFin">NRIC/FIN</Label>
                    <Input
                      id="edit-nricFin"
                      value={editFormData.nricFin}
                      onChange={(e) => setEditFormData(prev => ({ ...prev, nricFin: e.target.value }))}
                      data-testid="input-edit-nricFin"
                    />
                  </div>
                </div>
              </div>

              <Separator />

              {/* Passport & Work Pass Details - Optional fields for any employee */}
              <div>
                <h3 className="text-sm font-medium text-muted-foreground mb-3">Passport & Work Pass Details (Optional)</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="edit-passportNumber">Passport Number</Label>
                    <Input
                      id="edit-passportNumber"
                      value={editFormData.passportNumber}
                      onChange={(e) => setEditFormData(prev => ({ ...prev, passportNumber: e.target.value }))}
                      placeholder="Enter passport number"
                      data-testid="input-edit-passportNumber"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="edit-passportExpiry">Passport Expiry</Label>
                    <Input
                      id="edit-passportExpiry"
                      type="date"
                      value={editFormData.passportExpiry}
                      onChange={(e) => setEditFormData(prev => ({ ...prev, passportExpiry: e.target.value }))}
                      data-testid="input-edit-passportExpiry"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="edit-workPermitNumber">Work Permit / Pass Number</Label>
                    <Input
                      id="edit-workPermitNumber"
                      value={editFormData.workPermitNumber}
                      onChange={(e) => setEditFormData(prev => ({ ...prev, workPermitNumber: e.target.value }))}
                      placeholder="WP / EP / SP number"
                      data-testid="input-edit-workPermitNumber"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="edit-workPermitExpiry">Work Permit / Pass Expiry</Label>
                    <Input
                      id="edit-workPermitExpiry"
                      type="date"
                      value={editFormData.workPermitExpiry}
                      onChange={(e) => setEditFormData(prev => ({ ...prev, workPermitExpiry: e.target.value }))}
                      data-testid="input-edit-workPermitExpiry"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="edit-finNumber">FIN Number</Label>
                    <Input
                      id="edit-finNumber"
                      value={editFormData.finNumber}
                      onChange={(e) => setEditFormData(prev => ({ ...prev, finNumber: e.target.value }))}
                      data-testid="input-edit-finNumber"
                    />
                  </div>
                                  </div>
              </div>

              <Separator />

              {/* Salary Calculation - MOM Compliant */}
              <div>
                <h3 className="text-sm font-medium text-muted-foreground mb-3">Salary Settings (MOM-Compliant)</h3>
                <p className="text-xs text-muted-foreground mb-4">
                  Hourly and OT rates are calculated using MOM formula: (Monthly Salary × 12) ÷ (52 × Weekly Hours)
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="edit-basicMonthlySalary">Monthly Salary ($)</Label>
                    <Input
                      id="edit-basicMonthlySalary"
                      type="number"
                      step="0.01"
                      value={editFormData.basicMonthlySalary}
                      onChange={(e) => setEditFormData(prev => ({ ...prev, basicMonthlySalary: e.target.value }))}
                      data-testid="input-edit-basicMonthlySalary"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="edit-weeklyContractHours">Weekly Contract Hours</Label>
                    <div className="flex gap-2">
                      <Input
                        id="edit-weeklyContractHours"
                        type="number"
                        step="0.5"
                        min="1"
                        max="60"
                        value={editFormData.weeklyContractHours}
                        onChange={(e) => setEditFormData(prev => ({ ...prev, weeklyContractHours: e.target.value }))}
                        data-testid="input-edit-weeklyContractHours"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        onClick={calculateRates}
                        data-testid="button-calculate-rates"
                      >
                        <Calculator className="h-4 w-4 mr-1" />
                        Calculate
                      </Button>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="edit-regularDaysPerWeek">Working Days Per Week</Label>
                    <Input
                      id="edit-regularDaysPerWeek"
                      type="text"
                      inputMode="decimal"
                      placeholder="5"
                      value={editFormData.regularDaysPerWeek}
                      onChange={(e) => setEditFormData(prev => ({ ...prev, regularDaysPerWeek: e.target.value }))}
                      data-testid="input-edit-regularDaysPerWeek"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="edit-hourlyRate">Hourly Basic Rate (MOM-compliant)</Label>
                    <Input
                      id="edit-hourlyRate"
                      type="number"
                      step="0.01"
                      value={editFormData.hourlyRate}
                      readOnly
                      className="bg-muted"
                      data-testid="input-edit-hourlyRate"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="edit-ot15Rate">OT 1.5x Rate ($)</Label>
                    <Input
                      id="edit-ot15Rate"
                      type="number"
                      step="0.01"
                      value={editFormData.ot15Rate}
                      readOnly
                      className="bg-muted"
                      data-testid="input-edit-ot15Rate"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="edit-ot20Rate">OT 2.0x Rate (Rest Day/PH)</Label>
                    <Input
                      id="edit-ot20Rate"
                      type="number"
                      step="0.01"
                      value={editFormData.ot20Rate}
                      readOnly
                      className="bg-muted"
                      data-testid="input-edit-ot20Rate"
                    />
                  </div>
                </div>
              </div>

              <Separator />

              {/* Allowances */}
              <div>
                <h3 className="text-sm font-medium text-muted-foreground mb-3">Allowances</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="edit-defaultMobileAllowance">Mobile Allowance ($)</Label>
                    <Input
                      id="edit-defaultMobileAllowance"
                      type="number"
                      step="0.01"
                      value={editFormData.defaultMobileAllowance}
                      onChange={(e) => setEditFormData(prev => ({ ...prev, defaultMobileAllowance: e.target.value }))}
                      data-testid="input-edit-defaultMobileAllowance"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="edit-defaultTransportAllowance">Transport Allowance ($)</Label>
                    <Input
                      id="edit-defaultTransportAllowance"
                      type="number"
                      step="0.01"
                      value={editFormData.defaultTransportAllowance}
                      onChange={(e) => setEditFormData(prev => ({ ...prev, defaultTransportAllowance: e.target.value }))}
                      data-testid="input-edit-defaultTransportAllowance"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="edit-defaultMealAllowance">Loan ($)</Label>
                    <Input
                      id="edit-defaultMealAllowance"
                      type="number"
                      step="0.01"
                      value={editFormData.defaultMealAllowance}
                      onChange={(e) => setEditFormData(prev => ({ ...prev, defaultMealAllowance: e.target.value }))}
                      data-testid="input-edit-loan"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="edit-defaultShiftAllowance">Shift Allowance ($)</Label>
                    <Input
                      id="edit-defaultShiftAllowance"
                      type="number"
                      step="0.01"
                      value={editFormData.defaultShiftAllowance}
                      onChange={(e) => setEditFormData(prev => ({ ...prev, defaultShiftAllowance: e.target.value }))}
                      data-testid="input-edit-defaultShiftAllowance"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="edit-defaultOtherAllowance">Other Allowance ($)</Label>
                    <Input
                      id="edit-defaultOtherAllowance"
                      type="number"
                      step="0.01"
                      value={editFormData.defaultOtherAllowance}
                      onChange={(e) => setEditFormData(prev => ({ ...prev, defaultOtherAllowance: e.target.value }))}
                      data-testid="input-edit-defaultOtherAllowance"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="edit-defaultHouseRentalAllowance">House Rental ($)</Label>
                    <Input
                      id="edit-defaultHouseRentalAllowance"
                      type="number"
                      step="0.01"
                      value={editFormData.defaultHouseRentalAllowance}
                      onChange={(e) => setEditFormData(prev => ({ ...prev, defaultHouseRentalAllowance: e.target.value }))}
                      data-testid="input-edit-defaultHouseRentalAllowance"
                    />
                  </div>
                </div>
              </div>

              <Separator />

              {/* Remarks */}
              <div>
                <h3 className="text-sm font-medium text-muted-foreground mb-3">Remarks</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="edit-remarks1">Remarks 1</Label>
                    <Textarea
                      id="edit-remarks1"
                      value={editFormData.remarks1}
                      onChange={(e) => setEditFormData(prev => ({ ...prev, remarks1: e.target.value }))}
                      rows={2}
                      data-testid="input-edit-remarks1"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="edit-remarks2">Remarks 2</Label>
                    <Textarea
                      id="edit-remarks2"
                      value={editFormData.remarks2}
                      onChange={(e) => setEditFormData(prev => ({ ...prev, remarks2: e.target.value }))}
                      rows={2}
                      data-testid="input-edit-remarks2"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="edit-remarks3">Remarks 3</Label>
                    <Textarea
                      id="edit-remarks3"
                      value={editFormData.remarks3}
                      onChange={(e) => setEditFormData(prev => ({ ...prev, remarks3: e.target.value }))}
                      rows={2}
                      data-testid="input-edit-remarks3"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="edit-remarks4">Remarks 4</Label>
                    <Textarea
                      id="edit-remarks4"
                      value={editFormData.remarks4}
                      onChange={(e) => setEditFormData(prev => ({ ...prev, remarks4: e.target.value }))}
                      rows={2}
                      data-testid="input-edit-remarks4"
                    />
                  </div>
                </div>
              </div>

              {/* Compliance Documents Section - Optional for any employee */}
              <div className="mt-6">
                  <Separator className="mb-4" />
                  <h3 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-2">
                    <FileText className="h-4 w-4" />
                    Compliance Documents
                  </h3>
                  
                  {/* Existing Documents */}
                  {employeeDocuments && employeeDocuments.length > 0 && (
                    <div className="mb-4">
                      <Label className="text-xs text-muted-foreground mb-2 block">Uploaded Documents</Label>
                      <div className="space-y-2">
                        {employeeDocuments.map((doc) => {
                          const isExpiringSoon = doc.expiryDate && new Date(doc.expiryDate) <= new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
                          const isExpired = doc.expiryDate && new Date(doc.expiryDate) < new Date();
                          return (
                            <div 
                              key={doc.id} 
                              className="flex items-center justify-between p-3 rounded-md border bg-muted/30"
                              data-testid={`doc-row-${doc.id}`}
                            >
                              <div className="flex items-center gap-3">
                                <FileText className="h-4 w-4 text-muted-foreground" />
                                <div>
                                  <div className="flex items-center gap-2">
                                    <span className="font-medium text-sm">{doc.documentName}</span>
                                    <Badge variant="outline" className="text-xs">
                                      {doc.documentType === 'passport' ? 'Passport' :
                                       doc.documentType === 'work_pass' ? 'Work Pass' :
                                       doc.documentType === 'certificate' ? 'Certificate' : 'Other'}
                                    </Badge>
                                    {isExpired && (
                                      <Badge variant="destructive" className="text-xs flex items-center gap-1">
                                        <AlertTriangle className="h-3 w-3" />
                                        Expired
                                      </Badge>
                                    )}
                                    {!isExpired && isExpiringSoon && (
                                      <Badge variant="secondary" className="text-xs flex items-center gap-1 bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200">
                                        <AlertTriangle className="h-3 w-3" />
                                        Expires Soon
                                      </Badge>
                                    )}
                                  </div>
                                  <div className="text-xs text-muted-foreground">
                                    {doc.expiryDate ? `Expires: ${format(new Date(doc.expiryDate), "dd MMM yyyy")}` : 'No expiry'}
                                    {doc.notes && ` | ${doc.notes}`}
                                  </div>
                                </div>
                              </div>
                              <div className="flex items-center gap-2">
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  onClick={() => window.open(`/api/admin/employees/${editingUser?.id}/documents/${doc.id}/file`, '_blank')}
                                  data-testid={`btn-view-doc-${doc.id}`}
                                >
                                  <Eye className="h-4 w-4" />
                                </Button>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  onClick={() => {
                                    if (confirm('Are you sure you want to delete this document?')) {
                                      deleteDocumentMutation.mutate(doc.id);
                                    }
                                  }}
                                  disabled={deleteDocumentMutation.isPending}
                                  data-testid={`btn-delete-doc-${doc.id}`}
                                >
                                  <Trash2 className="h-4 w-4 text-destructive" />
                                </Button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Upload New Document */}
                  <div className="border rounded-md p-4 bg-muted/20">
                    <Label className="text-sm font-medium mb-3 block">Upload New Document</Label>
                    <div className="grid grid-cols-2 gap-3 mb-3">
                      <div className="space-y-2">
                        <Label htmlFor="doc-type" className="text-xs">Document Type</Label>
                        <Select 
                          value={documentUploadState.documentType}
                          onValueChange={(value) => setDocumentUploadState(prev => ({ ...prev, documentType: value }))}
                        >
                          <SelectTrigger id="doc-type" data-testid="select-doc-type">
                            <SelectValue placeholder="Select type" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="passport">Passport</SelectItem>
                            <SelectItem value="work_pass">Work Pass</SelectItem>
                            <SelectItem value="certificate">Certificate</SelectItem>
                            <SelectItem value="other">Other</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="doc-name" className="text-xs">Document Name</Label>
                        <Input
                          id="doc-name"
                          placeholder="e.g., Passport Scan 2025"
                          value={documentUploadState.documentName}
                          onChange={(e) => setDocumentUploadState(prev => ({ ...prev, documentName: e.target.value }))}
                          data-testid="input-doc-name"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="doc-expiry" className="text-xs">Expiry Date (optional)</Label>
                        <Input
                          id="doc-expiry"
                          type="date"
                          value={documentUploadState.expiryDate}
                          onChange={(e) => setDocumentUploadState(prev => ({ ...prev, expiryDate: e.target.value }))}
                          data-testid="input-doc-expiry"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="doc-notes" className="text-xs">Notes (optional)</Label>
                        <Input
                          id="doc-notes"
                          placeholder="Additional notes..."
                          value={documentUploadState.notes}
                          onChange={(e) => setDocumentUploadState(prev => ({ ...prev, notes: e.target.value }))}
                          data-testid="input-doc-notes"
                        />
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <Input
                        type="file"
                        accept=".pdf,.jpg,.jpeg,.png"
                        className="flex-1"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) {
                            handleDocumentUpload(file);
                            e.target.value = '';
                          }
                        }}
                        disabled={documentUploadState.isUploading}
                        data-testid="input-doc-file"
                      />
                      {documentUploadState.isUploading && (
                        <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-2">
                      Accepted formats: PDF, JPEG, PNG (max 10MB)
                    </p>
                  </div>
                </div>
              </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setEditingUser(null)}
                data-testid="button-cancel-edit"
              >
                <X className="h-4 w-4 mr-2" />
                Cancel
              </Button>
              <Button
                onClick={handleSaveEdit}
                disabled={updateUserMutation.isPending}
                data-testid="button-save-edit"
              >
                {updateUserMutation.isPending ? (
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Save className="h-4 w-4 mr-2" />
                )}
                Save Changes
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={!!viewingAuditUser} onOpenChange={(open) => !open && setViewingAuditUser(null)}>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <History className="h-5 w-5" />
                Change History: {viewingAuditUser?.name}
              </DialogTitle>
            </DialogHeader>
            <div className="py-4">
              {auditLoading ? (
                <div className="flex items-center justify-center py-8">
                  <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : auditLogs.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  No changes have been recorded for this employee
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date & Time</TableHead>
                      <TableHead>Field</TableHead>
                      <TableHead>Old Value</TableHead>
                      <TableHead>New Value</TableHead>
                      <TableHead>Changed By</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {auditLogs.map((log) => (
                      <TableRow key={log.id} data-testid={`row-audit-${log.id}`}>
                        <TableCell className="text-muted-foreground whitespace-nowrap">
                          {format(new Date(log.changedAt), "dd MMM yyyy HH:mm")}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{getFieldLabel(log.fieldName || "")}</Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {log.oldValue || <span className="italic">empty</span>}
                        </TableCell>
                        <TableCell className="font-medium">
                          {log.newValue || <span className="italic text-muted-foreground">empty</span>}
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary">{log.changedBy}</Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setViewingAuditUser(null)}
                data-testid="button-close-audit"
              >
                <X className="h-4 w-4 mr-2" />
                Close
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <UserPlus className="h-5 w-5" />
                Add New Employee
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="new-employeeCode">Employee Code</Label>
                  <Input
                    id="new-employeeCode"
                    value={newEmployeeData.employeeCode}
                    onChange={(e) => setNewEmployeeData(prev => ({ ...prev, employeeCode: e.target.value }))}
                    placeholder="e.g., EMP001"
                    data-testid="input-new-employeeCode"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="new-name">Name *</Label>
                  <Input
                    id="new-name"
                    value={newEmployeeData.name}
                    onChange={(e) => setNewEmployeeData(prev => ({ ...prev, name: e.target.value }))}
                    placeholder="Full name"
                    data-testid="input-new-name"
                  />
                </div>
                <div className="space-y-2 col-span-2">
                  <Label htmlFor="new-email">Email *</Label>
                  <Input
                    id="new-email"
                    type="email"
                    value={newEmployeeData.email}
                    onChange={(e) => setNewEmployeeData(prev => ({ ...prev, email: e.target.value }))}
                    placeholder="email@company.com"
                    data-testid="input-new-email"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="new-department">Department</Label>
                  <Input
                    id="new-department"
                    value={newEmployeeData.department}
                    onChange={(e) => setNewEmployeeData(prev => ({ ...prev, department: e.target.value }))}
                    placeholder="e.g., Operations"
                    data-testid="input-new-department"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="new-designation">Designation</Label>
                  <Input
                    id="new-designation"
                    value={newEmployeeData.designation}
                    onChange={(e) => setNewEmployeeData(prev => ({ ...prev, designation: e.target.value }))}
                    placeholder="e.g., Engineer"
                    data-testid="input-new-designation"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="new-mobileNumber">Mobile Number</Label>
                  <Input
                    id="new-mobileNumber"
                    value={newEmployeeData.mobileNumber}
                    onChange={(e) => setNewEmployeeData(prev => ({ ...prev, mobileNumber: e.target.value }))}
                    placeholder="e.g., 91234567"
                    data-testid="input-new-mobileNumber"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="new-gender">Gender</Label>
                  <Select 
                    value={newEmployeeData.gender} 
                    onValueChange={(value) => setNewEmployeeData(prev => ({ ...prev, gender: value }))}
                  >
                    <SelectTrigger data-testid="select-new-gender">
                      <SelectValue placeholder="Select gender" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="male">Male</SelectItem>
                      <SelectItem value="female">Female</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2 col-span-2">
                  <Label htmlFor="new-joinDate">Join Date</Label>
                  <Input
                    id="new-joinDate"
                    type="date"
                    value={newEmployeeData.joinDate}
                    onChange={(e) => setNewEmployeeData(prev => ({ ...prev, joinDate: e.target.value }))}
                    data-testid="input-new-joinDate"
                  />
                </div>
              </div>
              <p className="text-sm text-muted-foreground">
                * Required fields. An initial password will be generated automatically.
              </p>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setIsAddDialogOpen(false)}
                data-testid="button-cancel-add"
              >
                <X className="h-4 w-4 mr-2" />
                Cancel
              </Button>
              <Button
                onClick={() => createUserMutation.mutate(newEmployeeData)}
                disabled={createUserMutation.isPending || !newEmployeeData.name || !newEmployeeData.email}
                data-testid="button-create-employee"
              >
                {createUserMutation.isPending ? (
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <UserPlus className="h-4 w-4 mr-2" />
                )}
                Create Employee
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Delete Employee Dialog */}
      <AlertDialog open={showDeleteEmployeeDialog} onOpenChange={(open) => {
        if (!open && !deleteEmployeeMutation.isPending) {
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
              {!employeeToDelete ? (
                <span className="block">Select an employee to permanently delete.</span>
              ) : (
                <>
                  <span className="block">
                    This will permanently delete <strong>{toTitleCase(employeeToDelete.name)}</strong> ({employeeToDelete.employeeCode || 'No code'}) and all associated data including:
                  </span>
                  <span className="block text-sm">
                    Attendance records, leave data, payroll records, claims, documents, and audit logs.
                  </span>
                  <span className="block font-semibold text-destructive">
                    This action cannot be undone. A record of the deletion will be kept in the audit trail.
                  </span>
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-2">
              <Label>Select Employee</Label>
              <Select
                value={employeeToDelete?.id || ""}
                onValueChange={(val) => {
                  const user = users.find((u: User) => u.id === val);
                  setEmployeeToDelete(user || null);
                }}
              >
                <SelectTrigger data-testid="select-delete-employee">
                  <SelectValue placeholder="Choose an employee..." />
                </SelectTrigger>
                <SelectContent>
                  {users
                    .filter((u: User) => u.role !== 'admin')
                    .sort((a: User, b: User) => (a.name || '').localeCompare(b.name || ''))
                    .map((u: User) => (
                      <SelectItem key={u.id} value={u.id} data-testid={`select-item-employee-${u.id}`}>
                        {toTitleCase(u.name)} {u.employeeCode ? `(${u.employeeCode})` : ''} - {u.department || 'No dept'}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            {employeeToDelete && (
              <div className="space-y-2">
                <Label htmlFor="delete-reason-emp">Reason for Deletion (optional)</Label>
                <Textarea
                  id="delete-reason-emp"
                  placeholder="Enter reason for deleting this employee..."
                  value={deleteReason}
                  onChange={(e) => setDeleteReason(e.target.value)}
                  className="resize-none"
                  rows={3}
                  data-testid="input-delete-reason"
                />
              </div>
            )}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteEmployeeMutation.isPending} data-testid="button-cancel-delete-employee">Cancel</AlertDialogCancel>
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
              disabled={!employeeToDelete || deleteEmployeeMutation.isPending}
              data-testid="button-confirm-delete-employee"
            >
              {deleteEmployeeMutation.isPending ? "Deleting..." : "Permanently Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
