import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { ArrowLeft, Mail, Send, RefreshCw, Search, Users, CheckCircle2, UserPlus, Copy, Check, AlertTriangle, Settings, Clock, FileText, Pencil, History, Key } from "lucide-react";
import { useLocation, Link } from "wouter";
import { useState } from "react";
import { format } from "date-fns";
import { toTitleCase } from "@/lib/utils";
import type { User, CompanySettings, EmailLog, AuditLog, PasswordOverrideLog } from "@shared/schema";

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

export default function AdminEmailsPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [selectedUsers, setSelectedUsers] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState("");
  const [showAddForm, setShowAddForm] = useState(false);
  const [newUserForm, setNewUserForm] = useState<NewUserForm>(initialFormState);
  const [createdUserInfo, setCreatedUserInfo] = useState<{ username: string; password: string } | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [editForm, setEditForm] = useState<Partial<User>>({});
  const [resetPasswordUser, setResetPasswordUser] = useState<User | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [resetReason, setResetReason] = useState("");

  const { data: usersData, isLoading, refetch: refetchUsers } = useQuery<User[]>({
    queryKey: ["/api/admin/users"],
  });

  const { data: settingsData } = useQuery<CompanySettings>({
    queryKey: ["/api/company/settings"],
  });

  const { data: emailLogsData, isLoading: isLoadingLogs, refetch: refetchLogs } = useQuery<{ logs: EmailLog[] }>({
    queryKey: ["/api/admin/email-logs"],
  });

  const { data: auditLogsData, isLoading: isLoadingAuditLogs, refetch: refetchAuditLogs } = useQuery<{ logs: AuditLog[] }>({
    queryKey: ["/api/admin/audit-logs"],
  });
  
  // Fetch session to check if current user is view-only admin
  const { data: sessionData } = useQuery<{ authenticated: boolean; isAdmin: boolean; isViewOnlyAdmin?: boolean }>({
    queryKey: ["/api/auth/session"],
  });
  
  const isViewOnlyAdmin = sessionData?.isViewOnlyAdmin === true;

  const { data: passwordOverrideLogsData, isLoading: isLoadingOverrideLogs, refetch: refetchOverrideLogs } = useQuery<{ logs: PasswordOverrideLog[] }>({
    queryKey: ["/api/admin/password-override-logs"],
  });

  const users = (usersData || []).filter(u => !u.isArchived);
  const passwordOverrideLogs = passwordOverrideLogsData?.logs || [];
  const emailLogs = emailLogsData?.logs || [];
  const emailConfigured = settingsData?.senderEmail && settingsData?.senderName;

  const filteredUsers = users.filter(user => 
    user.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    user.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (user.employeeCode && user.employeeCode.toLowerCase().includes(searchQuery.toLowerCase())) ||
    (user.department && user.department.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const sendEmailMutation = useMutation({
    mutationFn: async (userIds: string[]) => {
      const response = await apiRequest("POST", "/api/admin/users/send-welcome-email", { userIds });
      return await response.json();
    },
    onSuccess: (data: { message?: string; sent?: number }) => {
      toast({
        title: "Emails Sent",
        description: data.message || `Successfully sent welcome emails to ${data.sent || 0} users.`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      setSelectedUsers(new Set());
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to send emails",
        variant: "destructive",
      });
    },
  });

  const resendEmailMutation = useMutation({
    mutationFn: async (userId: string) => {
      const response = await apiRequest("POST", "/api/admin/users/resend-welcome-email", { userId });
      return await response.json();
    },
    onSuccess: (data: { message?: string }) => {
      toast({
        title: "Email Resent",
        description: data.message || "Welcome email has been resent with a new password.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to resend email",
        variant: "destructive",
      });
    },
  });

  const createUserMutation = useMutation({
    mutationFn: async (data: NewUserForm) => {
      const response = await apiRequest("POST", "/api/admin/users/create", data);
      return await response.json();
    },
    onSuccess: (data: { success: boolean; user: User; initialPassword: string; message: string }) => {
      toast({
        title: "User Created",
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
        description: error.message || "Failed to create user",
        variant: "destructive",
      });
    },
  });

  const updateUserMutation = useMutation({
    mutationFn: async ({ userId, updates }: { userId: string; updates: Partial<User> }) => {
      const response = await apiRequest("PUT", `/api/admin/users/${userId}`, updates);
      return await response.json();
    },
    onSuccess: () => {
      toast({
        title: "Employee Updated",
        description: "Employee details have been updated successfully.",
      });
      setEditingUser(null);
      setEditForm({});
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/audit-logs"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update employee",
        variant: "destructive",
      });
    },
  });

  const resetPasswordMutation = useMutation({
    mutationFn: async ({ userId, reason }: { userId: string; reason?: string }) => {
      const response = await apiRequest("POST", `/api/admin/users/${userId}/reset-password`, { reason });
      return await response.json();
    },
    onSuccess: (data: { message?: string; password?: string }) => {
      if (data.password) {
        setNewPassword(data.password);
        toast({
          title: "Password Reset",
          description: "Password has been reset. The new password is shown below.",
        });
      } else {
        toast({
          title: "Password Reset",
          description: data.message || "Password has been reset. User will be required to change password on next login.",
        });
        setResetPasswordUser(null);
        setResetReason("");
      }
      queryClient.invalidateQueries({ queryKey: ["/api/admin/password-override-logs"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to reset password",
        variant: "destructive",
      });
    },
  });

  const handleResetPassword = () => {
    if (!resetPasswordUser) {
      return;
    }
    resetPasswordMutation.mutate({ 
      userId: resetPasswordUser.id, 
      reason: resetReason || undefined 
    });
  };

  const handleFormChange = (field: keyof NewUserForm, value: string) => {
    setNewUserForm(prev => ({ ...prev, [field]: value }));
  };

  const handleEditFormChange = (field: keyof User, value: string) => {
    setEditForm(prev => ({ ...prev, [field]: value }));
  };

  const handleOpenEdit = (user: User) => {
    setEditingUser(user);
    setEditForm({
      name: user.name,
      email: user.email,
      employeeCode: user.employeeCode || "",
      department: user.department || "",
      designation: user.designation || "",
      section: user.section || "",
      mobileNumber: user.mobileNumber || "",
      gender: user.gender || "",
      joinDate: user.joinDate || "",
    });
  };

  const handleSaveEdit = () => {
    if (!editingUser) return;
    
    // Validate required fields
    if (!editForm.name || editForm.name.trim().length === 0) {
      toast({
        title: "Validation Error",
        description: "Name is required",
        variant: "destructive",
      });
      return;
    }
    
    if (!editForm.email || !editForm.email.includes("@")) {
      toast({
        title: "Validation Error",
        description: "Valid email is required",
        variant: "destructive",
      });
      return;
    }
    
    updateUserMutation.mutate({ userId: editingUser.id, updates: editForm });
  };

  const auditLogs = auditLogsData?.logs || [];

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

  const handleSelectAll = () => {
    if (selectedUsers.size === filteredUsers.length) {
      setSelectedUsers(new Set());
    } else {
      setSelectedUsers(new Set(filteredUsers.map(u => u.id)));
    }
  };

  const handleSelectUser = (userId: string) => {
    const newSelected = new Set(selectedUsers);
    if (newSelected.has(userId)) {
      newSelected.delete(userId);
    } else {
      newSelected.add(userId);
    }
    setSelectedUsers(newSelected);
  };

  const handleBatchSend = () => {
    if (selectedUsers.size === 0) {
      toast({
        title: "No users selected",
        description: "Please select at least one user to send emails.",
        variant: "destructive",
      });
      return;
    }
    sendEmailMutation.mutate(Array.from(selectedUsers));
  };

  const handleResend = (userId: string) => {
    resendEmailMutation.mutate(userId);
  };

  const usersWithEmail = users.filter(u => !u.welcomeEmailSentAt).length;
  const usersWithEmailSent = users.filter(u => u.welcomeEmailSentAt).length;

  return (
    <div className="min-h-screen bg-muted/30 p-4 md:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex-1">
            <h1 className="text-2xl md:text-3xl font-bold" data-testid="text-page-title">
              Send Welcome Emails
            </h1>
            <p className="text-sm md:text-base text-muted-foreground">
              Send initialization emails to employees with login credentials and QR code
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

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-blue-500/10 rounded-lg">
                  <Users className="h-6 w-6 text-blue-500" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Total Employees</p>
                  <p className="text-2xl font-bold" data-testid="text-total-users">{users.length}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-yellow-500/10 rounded-lg">
                  <Mail className="h-6 w-6 text-yellow-500" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Pending Emails</p>
                  <p className="text-2xl font-bold" data-testid="text-pending-emails">{usersWithEmail}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-green-500/10 rounded-lg">
                  <CheckCircle2 className="h-6 w-6 text-green-500" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Emails Sent</p>
                  <p className="text-2xl font-bold" data-testid="text-emails-sent">{usersWithEmailSent}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
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
                disabled={isViewOnlyAdmin}
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

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="role">Account Type</Label>
                      <Select
                        value={newUserForm.role}
                        onValueChange={(value) => handleFormChange("role", value)}
                      >
                        <SelectTrigger data-testid="select-employee-role">
                          <SelectValue placeholder="Select role" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="user">Employee</SelectItem>
                          <SelectItem value="admin">Administrator</SelectItem>
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">
                        Administrators have full access to admin panel and settings
                      </p>
                    </div>
                  </div>

                  <div className="flex justify-end pt-4">
                    <Button
                      onClick={handleCreateUser}
                      disabled={createUserMutation.isPending}
                      data-testid="button-create-employee"
                    >
                      <UserPlus className="mr-2 h-4 w-4" />
                      {createUserMutation.isPending ? "Creating..." : "Create Employee"}
                    </Button>
                  </div>
                </>
              )}
            </CardContent>
          )}
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Mail className="h-5 w-5" />
              Welcome Email Preview
            </CardTitle>
            <CardDescription>
              This is the message that will be sent to employees
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="bg-muted/50 rounded-lg p-4 space-y-4 text-sm">
              <p className="font-semibold">Welcome to our NexaHRMS!</p>
              <p>
                We're excited to provide you with a seamless, efficient, and user-friendly 
                experience for managing all your HR needs. From attendance and leave management 
                to performance, payroll, and beyond—everything you need is right here at your fingertips.
              </p>
              <p className="font-semibold">Let's get started!</p>
              <div className="border-t pt-4 space-y-2">
                <p><strong>App Link:</strong> https://app.nexahrms.com/</p>
                <p><strong>Username:</strong> [Employee Code]</p>
                <p><strong>Password:</strong> [Generated Password]</p>
                <p className="text-muted-foreground text-xs">A QR code linking to the app will also be included.</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Tabs defaultValue="employees" className="w-full">
          <TabsList className="grid w-full grid-cols-3 max-w-xl">
            <TabsTrigger value="employees" data-testid="tab-employees">
              <Users className="h-4 w-4 mr-2" />
              Employee List
            </TabsTrigger>
            <TabsTrigger value="logs" data-testid="tab-email-logs">
              <FileText className="h-4 w-4 mr-2" />
              Email Logs
            </TabsTrigger>
            <TabsTrigger value="audit" data-testid="tab-audit-logs">
              <History className="h-4 w-4 mr-2" />
              Audit Logs
            </TabsTrigger>
            <TabsTrigger value="overrides" data-testid="tab-password-overrides">
              <Key className="h-4 w-4 mr-2" />
              Manual Overrides
            </TabsTrigger>
          </TabsList>
          
          <TabsContent value="employees" className="mt-4">
            <Card>
              <CardHeader>
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <CardTitle>Employee List</CardTitle>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => refetchUsers()}
                        data-testid="button-refresh-employees"
                      >
                        <RefreshCw className="h-4 w-4" />
                      </Button>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Select employees to send or resend welcome emails. Resending will generate a new password.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="relative flex-1 md:w-64">
                      <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        placeholder="Search employees..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="pl-9"
                        data-testid="input-search"
                      />
                    </div>
                    <Button
                      onClick={handleBatchSend}
                      disabled={selectedUsers.size === 0 || sendEmailMutation.isPending || !emailConfigured || isViewOnlyAdmin}
                      data-testid="button-batch-send"
                    >
                      <Send className="mr-2 h-4 w-4" />
                      {sendEmailMutation.isPending ? "Sending..." : `Send/Resend to ${selectedUsers.size} Selected`}
                    </Button>
                  </div>
                </div>
                {!emailConfigured && (
                  <Alert className="mt-4">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertDescription className="flex items-center justify-between">
                      <span>Email settings are not configured. Please set up sender email in settings before sending emails.</span>
                      <Link href="/admin/settings">
                        <Button variant="outline" size="sm">
                          <Settings className="h-4 w-4 mr-2" />
                          Go to Settings
                        </Button>
                      </Link>
                    </AlertDescription>
                  </Alert>
                )}
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full" data-testid="table-employees">
                      <thead>
                        <tr className="border-b">
                          <th className="p-3 text-left">
                            <Checkbox
                              checked={selectedUsers.size === filteredUsers.length && filteredUsers.length > 0}
                              onCheckedChange={handleSelectAll}
                              data-testid="checkbox-select-all"
                            />
                          </th>
                          <th className="p-3 text-left font-medium">Employee Code</th>
                          <th className="p-3 text-left font-medium">Name</th>
                          <th className="p-3 text-left font-medium">Email</th>
                          <th className="p-3 text-left font-medium">Department</th>
                          <th className="p-3 text-center font-medium">Email Status</th>
                          <th className="p-3 text-center font-medium">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredUsers.sort((a, b) => (a.name || '').localeCompare(b.name || '')).map(user => (
                          <tr key={user.id} className="border-b hover:bg-muted/50" data-testid={`row-user-${user.id}`}>
                            <td className="p-3">
                              <Checkbox
                                checked={selectedUsers.has(user.id)}
                                onCheckedChange={() => handleSelectUser(user.id)}
                                data-testid={`checkbox-user-${user.id}`}
                              />
                            </td>
                            <td className="p-3">{user.employeeCode || "-"}</td>
                            <td className="p-3">{toTitleCase(user.name)}</td>
                            <td className="p-3 text-sm">{user.email}</td>
                            <td className="p-3">{user.department || "-"}</td>
                            <td className="p-3 text-center">
                              {user.welcomeEmailSentAt ? (
                                <Badge variant="secondary" className="bg-green-100 text-green-800">
                                  Sent {format(new Date(user.welcomeEmailSentAt), "dd/MM/yy")}
                                </Badge>
                              ) : (
                                <Badge variant="outline">Not Sent</Badge>
                              )}
                            </td>
                            <td className="p-3 text-center">
                              <div className="flex items-center justify-center gap-1">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => handleOpenEdit(user)}
                                  disabled={isViewOnlyAdmin}
                                  title={isViewOnlyAdmin ? "View-only admins cannot edit" : "Edit employee"}
                                  data-testid={`button-edit-${user.id}`}
                                >
                                  <Pencil className="h-4 w-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => setResetPasswordUser(user)}
                                  disabled={isViewOnlyAdmin}
                                  title={isViewOnlyAdmin ? "View-only admins cannot reset passwords" : "Reset password"}
                                  data-testid={`button-reset-password-${user.id}`}
                                >
                                  <Key className="h-4 w-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleResend(user.id)}
                                  disabled={resendEmailMutation.isPending || !emailConfigured || isViewOnlyAdmin}
                                  data-testid={`button-resend-${user.id}`}
                                >
                                  <RefreshCw className={`mr-1 h-4 w-4 ${resendEmailMutation.isPending ? 'animate-spin' : ''}`} />
                                  {user.welcomeEmailSentAt ? 'Resend' : 'Send'}
                                </Button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {filteredUsers.length === 0 && (
                      <div className="text-center py-8 text-muted-foreground">
                        No employees found matching your search.
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
          
          <TabsContent value="logs" className="mt-4">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-2">
                    <CardTitle>Email Logs</CardTitle>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => refetchLogs()}
                      data-testid="button-refresh-logs"
                    >
                      <RefreshCw className="h-4 w-4" />
                    </Button>
                  </div>
                  <Badge variant="outline">
                    {emailLogs.length} {emailLogs.length === 1 ? 'email' : 'emails'} sent
                  </Badge>
                </div>
                <CardDescription>
                  View history of all welcome emails sent to employees
                </CardDescription>
              </CardHeader>
              <CardContent>
                {isLoadingLogs ? (
                  <div className="flex items-center justify-center py-12">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                  </div>
                ) : emailLogs.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <Mail className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p>No emails have been sent yet.</p>
                    <p className="text-sm">Start by sending welcome emails to employees.</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full" data-testid="table-email-logs">
                      <thead>
                        <tr className="border-b">
                          <th className="p-3 text-left font-medium">Recipient</th>
                          <th className="p-3 text-left font-medium">Subject</th>
                          <th className="p-3 text-left font-medium">Type</th>
                          <th className="p-3 text-center font-medium">Status</th>
                          <th className="p-3 text-left font-medium">Sent At</th>
                        </tr>
                      </thead>
                      <tbody>
                        {emailLogs.map((log) => (
                          <tr key={log.id} className="border-b hover:bg-muted/50" data-testid={`row-log-${log.id}`}>
                            <td className="p-3 text-sm">{log.recipientEmail}</td>
                            <td className="p-3 text-sm max-w-xs truncate">{log.subject}</td>
                            <td className="p-3">
                              <Badge variant="outline" className="capitalize">
                                {log.emailType}
                              </Badge>
                            </td>
                            <td className="p-3 text-center">
                              {log.status === 'sent' ? (
                                <Badge variant="secondary" className="bg-green-100 text-green-800">
                                  <CheckCircle2 className="h-3 w-3 mr-1" />
                                  Sent
                                </Badge>
                              ) : log.status === 'failed' ? (
                                <Badge variant="destructive">
                                  Failed
                                </Badge>
                              ) : (
                                <Badge variant="outline">
                                  <Clock className="h-3 w-3 mr-1" />
                                  Pending
                                </Badge>
                              )}
                            </td>
                            <td className="p-3 text-sm text-muted-foreground">
                              {log.sentAt ? format(new Date(log.sentAt), "dd MMM yyyy, HH:mm") : "-"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="audit" className="mt-4">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-2">
                    <CardTitle>Audit Logs</CardTitle>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => refetchAuditLogs()}
                      data-testid="button-refresh-audit-logs"
                    >
                      <RefreshCw className="h-4 w-4" />
                    </Button>
                  </div>
                  <Badge variant="outline">
                    {auditLogs.length} {auditLogs.length === 1 ? 'change' : 'changes'} logged
                  </Badge>
                </div>
                <CardDescription>
                  View history of all changes made to employee data by administrators
                </CardDescription>
              </CardHeader>
              <CardContent>
                {isLoadingAuditLogs ? (
                  <div className="flex items-center justify-center py-12">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                  </div>
                ) : auditLogs.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <History className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p>No changes have been logged yet.</p>
                    <p className="text-sm">Audit logs will appear when employee data is modified.</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full" data-testid="table-audit-logs">
                      <thead>
                        <tr className="border-b">
                          <th className="p-3 text-left font-medium">Employee</th>
                          <th className="p-3 text-left font-medium">Field Changed</th>
                          <th className="p-3 text-left font-medium">Old Value</th>
                          <th className="p-3 text-left font-medium">New Value</th>
                          <th className="p-3 text-left font-medium">Changed By</th>
                          <th className="p-3 text-left font-medium">Date/Time</th>
                        </tr>
                      </thead>
                      <tbody>
                        {auditLogs.map((log) => {
                          const employee = users.find(u => u.id === log.userId);
                          return (
                            <tr key={log.id} className="border-b hover:bg-muted/50" data-testid={`row-audit-${log.id}`}>
                              <td className="p-3 text-sm">
                                <div>
                                  <p className="font-medium">{toTitleCase(employee?.name) || 'Unknown'}</p>
                                  <p className="text-xs text-muted-foreground">{employee?.employeeCode || '-'}</p>
                                </div>
                              </td>
                              <td className="p-3">
                                <Badge variant="outline" className="capitalize">
                                  {log.fieldChanged.replace(/([A-Z])/g, ' $1').trim()}
                                </Badge>
                              </td>
                              <td className="p-3 text-sm text-muted-foreground max-w-xs truncate">
                                {log.oldValue || <span className="italic">empty</span>}
                              </td>
                              <td className="p-3 text-sm max-w-xs truncate">
                                {log.newValue || <span className="italic text-muted-foreground">empty</span>}
                              </td>
                              <td className="p-3 text-sm">
                                <Badge variant="secondary">{log.changedBy}</Badge>
                              </td>
                              <td className="p-3 text-sm text-muted-foreground">
                                {format(new Date(log.createdAt), "dd MMM yyyy, HH:mm")}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="overrides" className="mt-4">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-2">
                    <CardTitle>Manual Password Overrides</CardTitle>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => refetchOverrideLogs()}
                      data-testid="button-refresh-override-logs"
                    >
                      <RefreshCw className="h-4 w-4" />
                    </Button>
                  </div>
                  <Badge variant="outline">
                    {passwordOverrideLogs.length} {passwordOverrideLogs.length === 1 ? 'override' : 'overrides'} logged
                  </Badge>
                </div>
                <CardDescription>
                  View history of all password resets performed by administrators
                </CardDescription>
              </CardHeader>
              <CardContent>
                {isLoadingOverrideLogs ? (
                  <div className="flex items-center justify-center py-12">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                  </div>
                ) : passwordOverrideLogs.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <Key className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p>No password overrides have been logged yet.</p>
                    <p className="text-sm">Override logs will appear when admin resets a user's password.</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full" data-testid="table-password-overrides">
                      <thead>
                        <tr className="border-b">
                          <th className="p-3 text-left font-medium">Employee</th>
                          <th className="p-3 text-left font-medium">Email</th>
                          <th className="p-3 text-left font-medium">Reason</th>
                          <th className="p-3 text-left font-medium">Changed By</th>
                          <th className="p-3 text-left font-medium">Date/Time</th>
                        </tr>
                      </thead>
                      <tbody>
                        {passwordOverrideLogs.map((log) => {
                          const employee = users.find(u => u.id === log.userId);
                          return (
                            <tr key={log.id} className="border-b hover:bg-muted/50" data-testid={`row-override-${log.id}`}>
                              <td className="p-3 text-sm">
                                <div>
                                  <p className="font-medium">{toTitleCase(employee?.name) || 'Unknown'}</p>
                                  <p className="text-xs text-muted-foreground">{employee?.employeeCode || '-'}</p>
                                </div>
                              </td>
                              <td className="p-3 text-sm text-muted-foreground">
                                {employee?.email || '-'}
                              </td>
                              <td className="p-3 text-sm max-w-xs truncate">
                                {log.reason || <span className="italic text-muted-foreground">No reason provided</span>}
                              </td>
                              <td className="p-3 text-sm">
                                <Badge variant="secondary">{log.changedBy}</Badge>
                              </td>
                              <td className="p-3 text-sm text-muted-foreground">
                                {format(new Date(log.createdAt), "dd MMM yyyy, HH:mm")}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <Dialog open={!!editingUser} onOpenChange={(open) => !open && setEditingUser(null)}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Edit Employee</DialogTitle>
              <DialogDescription>
                Update employee details. Changes will be logged for audit purposes.
              </DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="edit-employeeCode">Employee Code</Label>
                <Input
                  id="edit-employeeCode"
                  value={editForm.employeeCode || ""}
                  onChange={(e) => handleEditFormChange("employeeCode", e.target.value)}
                  data-testid="input-edit-employee-code"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-name">Full Name *</Label>
                <Input
                  id="edit-name"
                  value={editForm.name || ""}
                  onChange={(e) => handleEditFormChange("name", e.target.value)}
                  data-testid="input-edit-name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-email">Email Address *</Label>
                <Input
                  id="edit-email"
                  type="email"
                  value={editForm.email || ""}
                  onChange={(e) => handleEditFormChange("email", e.target.value)}
                  data-testid="input-edit-email"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-department">Department</Label>
                <Input
                  id="edit-department"
                  value={editForm.department || ""}
                  onChange={(e) => handleEditFormChange("department", e.target.value)}
                  data-testid="input-edit-department"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-designation">Designation</Label>
                <Input
                  id="edit-designation"
                  value={editForm.designation || ""}
                  onChange={(e) => handleEditFormChange("designation", e.target.value)}
                  data-testid="input-edit-designation"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-section">Section</Label>
                <Input
                  id="edit-section"
                  value={editForm.section || ""}
                  onChange={(e) => handleEditFormChange("section", e.target.value)}
                  data-testid="input-edit-section"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-mobileNumber">Mobile Number</Label>
                <Input
                  id="edit-mobileNumber"
                  value={editForm.mobileNumber || ""}
                  onChange={(e) => handleEditFormChange("mobileNumber", e.target.value)}
                  data-testid="input-edit-mobile"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-gender">Gender</Label>
                <Select
                  value={editForm.gender || ""}
                  onValueChange={(value) => handleEditFormChange("gender", value)}
                >
                  <SelectTrigger data-testid="select-edit-gender">
                    <SelectValue placeholder="Select gender" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="MALE">Male</SelectItem>
                    <SelectItem value="FEMALE">Female</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-joinDate">Join Date</Label>
                <Input
                  id="edit-joinDate"
                  type="date"
                  value={editForm.joinDate || ""}
                  onChange={(e) => handleEditFormChange("joinDate", e.target.value)}
                  data-testid="input-edit-join-date"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditingUser(null)} data-testid="button-cancel-edit">
                Cancel
              </Button>
              <Button onClick={handleSaveEdit} disabled={updateUserMutation.isPending} data-testid="button-save-edit">
                {updateUserMutation.isPending ? "Saving..." : "Save Changes"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={!!resetPasswordUser} onOpenChange={(open) => !open && setResetPasswordUser(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Reset Password</DialogTitle>
              <DialogDescription>
                Reset password for {resetPasswordUser?.name}. A new random password will be generated.
              </DialogDescription>
            </DialogHeader>
            <div className="py-4 space-y-4">
              <div className="flex items-center gap-2 p-3 bg-muted rounded-lg">
                <AlertTriangle className="h-5 w-5 text-amber-500" />
                <p className="text-sm">
                  The user will be required to change their password on next login.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="reset-reason">Reason for reset (optional)</Label>
                <Input
                  id="reset-reason"
                  value={resetReason}
                  onChange={(e) => setResetReason(e.target.value)}
                  placeholder="e.g., User forgot password, Account recovery"
                  data-testid="input-reset-reason"
                />
              </div>
              {newPassword && (
                <div className="space-y-2">
                  <Label>New Password</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      value={newPassword}
                      readOnly
                      className="font-mono"
                      data-testid="input-new-password"
                    />
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => {
                        navigator.clipboard.writeText(newPassword);
                        toast({ title: "Password copied to clipboard" });
                      }}
                      data-testid="button-copy-password"
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Make sure to provide this password to the user securely.
                  </p>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button 
                variant="outline" 
                onClick={() => {
                  setResetPasswordUser(null);
                  setResetReason("");
                  setNewPassword("");
                }}
                data-testid="button-cancel-reset"
              >
                {newPassword ? "Close" : "Cancel"}
              </Button>
              {!newPassword && (
                <Button 
                  onClick={handleResetPassword} 
                  disabled={resetPasswordMutation.isPending}
                  data-testid="button-confirm-reset"
                >
                  {resetPasswordMutation.isPending ? "Resetting..." : "Reset Password"}
                </Button>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
