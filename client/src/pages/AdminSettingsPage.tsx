import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Upload, Building2, Image as ImageIcon, Clock, Mail, QrCode, Users, FileSpreadsheet, X, Check, AlertCircle, ArrowLeft, Camera, Shield, ShieldOff, UserPlus, Globe, KeyRound, Eye, Plus, UserCog, RefreshCw, History, MonitorSmartphone } from "lucide-react";
import { PasswordInput } from "@/components/ui/password-input";
import { Link } from "wouter";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { CompanySettings, User } from "@shared/schema";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { toTitleCase } from "@/lib/utils";

interface ParsedEmployee {
  code: string;
  name: string;
  email: string;
  shortName?: string;
  nricFin?: string;
  gender?: string;
  department?: string;
  section?: string;
  designation?: string;
  fingerId?: string;
  joinDate?: string;
  resignDate?: string;
  mobileNumber?: string;
}

interface LoginHistoryEntry {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  userDepartment: string | null;
  createdAt: string;
  lastSeen: string;
  ipAddress: string | null;
  userAgent: string | null;
  revokedAt: string | null;
}

function LoginHistoryCard() {
  const { data: history = [], isLoading, refetch } = useQuery<LoginHistoryEntry[]>({
    queryKey: ["/api/admin/login-history"],
  });

  function parseDevice(ua: string | null) {
    if (!ua) return "Unknown";
    if (/mobile/i.test(ua)) return "Mobile";
    if (/tablet|ipad/i.test(ua)) return "Tablet";
    return "Desktop";
  }

  function parseBrowser(ua: string | null) {
    if (!ua) return "";
    if (/edg/i.test(ua)) return "Edge";
    if (/chrome/i.test(ua)) return "Chrome";
    if (/safari/i.test(ua)) return "Safari";
    if (/firefox/i.test(ua)) return "Firefox";
    return "Browser";
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
        <CardTitle className="flex items-center gap-2">
          <History className="h-5 w-5" />
          Login History
        </CardTitle>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4 mr-1" />
          Refresh
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="text-center py-8 text-muted-foreground">Loading...</div>
        ) : history.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <History className="h-12 w-12 mx-auto mb-2 opacity-50" />
            <p>No login history yet</p>
          </div>
        ) : (
          <ScrollArea className="h-[400px]">
            <div className="border rounded-lg">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User</TableHead>
                    <TableHead>Department</TableHead>
                    <TableHead>Logged In</TableHead>
                    <TableHead>Last Seen</TableHead>
                    <TableHead>IP Address</TableHead>
                    <TableHead>Device</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {history.map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell>
                        <div className="font-medium">{toTitleCase(entry.userName)}</div>
                        <div className="text-xs text-muted-foreground">{entry.userEmail}</div>
                      </TableCell>
                      <TableCell className="text-sm">{entry.userDepartment || "-"}</TableCell>
                      <TableCell className="text-sm whitespace-nowrap">
                        {new Date(entry.createdAt).toLocaleString("en-SG", { dateStyle: "short", timeStyle: "short" })}
                      </TableCell>
                      <TableCell className="text-sm whitespace-nowrap">
                        {new Date(entry.lastSeen).toLocaleString("en-SG", { dateStyle: "short", timeStyle: "short" })}
                      </TableCell>
                      <TableCell className="text-sm font-mono">{entry.ipAddress || "-"}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1 text-sm">
                          <MonitorSmartphone className="h-3 w-3" />
                          {parseDevice(entry.userAgent)} · {parseBrowser(entry.userAgent)}
                        </div>
                      </TableCell>
                      <TableCell>
                        {entry.revokedAt ? (
                          <Badge variant="secondary">Ended</Badge>
                        ) : (
                          <Badge variant="default" className="bg-green-600">Active</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}

export default function AdminSettingsPage() {
  const { toast } = useToast();
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [faviconFile, setFaviconFile] = useState<File | null>(null);
  const [clockInLogoFile, setClockInLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [faviconPreview, setFaviconPreview] = useState<string | null>(null);
  const [clockInLogoPreview, setClockInLogoPreview] = useState<string | null>(null);
  const [attendanceBufferMinutes, setAttendanceBufferMinutes] = useState<number>(15);
  const [senderEmail, setSenderEmail] = useState<string>("");
  const [senderName, setSenderName] = useState<string>("");
  const [appUrl, setAppUrl] = useState<string>("https://app.nexahrms.com");
  const [defaultTimezone, setDefaultTimezone] = useState<string>("Asia/Singapore");
  const [companyName, setCompanyName] = useState<string>("");
  const [companyAddress, setCompanyAddress] = useState<string>("");
  const [companyUen, setCompanyUen] = useState<string>("");
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [parsedEmployees, setParsedEmployees] = useState<ParsedEmployee[]>([]);
  const [csvErrors, setCsvErrors] = useState<string[]>([]);
  const [showPreview, setShowPreview] = useState(false);
  
  // Admin users management state
  const [showAddAdminDialog, setShowAddAdminDialog] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState<string>("");
  const [adminSearchQuery, setAdminSearchQuery] = useState<string>("");
  const [selectedRoleType, setSelectedRoleType] = useState<"admin" | "viewonly_admin">("admin");
  
  // Password change state (for nexadmin only)
  const [showPasswordDialog, setShowPasswordDialog] = useState(false);
  const [passwordTargetUser, setPasswordTargetUser] = useState<User | null>(null);
  const [newPassword, setNewPassword] = useState<string>("");
  
  // Fetch session to check if current user is master admin or view-only admin
  const { data: sessionData } = useQuery<{ authenticated: boolean; isAdmin: boolean; isMasterAdmin?: boolean; isViewOnlyAdmin?: boolean }>({
    queryKey: ["/api/auth/session"],
  });
  
  const isMasterAdmin = sessionData?.isMasterAdmin === true;
  const isViewOnlyAdmin = sessionData?.isViewOnlyAdmin === true;
  
  // Check if current admin is a super admin (can manage attendance view admins)
  const { data: superAdminData } = useQuery<{ isSuperAdmin: boolean }>({
    queryKey: ['/api/admin/is-super-admin'],
  });
  const isSuperAdmin = superAdminData?.isSuperAdmin === true;
  
  // Attendance View Admin management state
  const [showAddAttendanceAdminDialog, setShowAddAttendanceAdminDialog] = useState(false);
  const [attendanceAdminSearchQuery, setAttendanceAdminSearchQuery] = useState<string>("");
  const [selectedAttendanceAdminUserId, setSelectedAttendanceAdminUserId] = useState<string>("");

  // Employee Data Admin management state
  const [showAddEmployeeDataAdminDialog, setShowAddEmployeeDataAdminDialog] = useState(false);
  const [employeeDataAdminSearchQuery, setEmployeeDataAdminSearchQuery] = useState<string>("");
  const [selectedEmployeeDataAdminUserId, setSelectedEmployeeDataAdminUserId] = useState<string>("");

  const { data: settings, isLoading } = useQuery<CompanySettings>({
    queryKey: ["/api/company/settings"],
  });

  // Update state when settings change
  useEffect(() => {
    if (settings?.attendanceBufferMinutes !== undefined) {
      setAttendanceBufferMinutes(settings.attendanceBufferMinutes);
    }
    if (settings?.senderEmail) {
      setSenderEmail(settings.senderEmail);
    }
    if (settings?.senderName) {
      setSenderName(settings.senderName);
    }
    if (settings?.appUrl) {
      setAppUrl(settings.appUrl);
    }
    if (settings?.defaultTimezone) {
      setDefaultTimezone(settings.defaultTimezone);
    }
    if (settings?.companyName) {
      setCompanyName(settings.companyName);
    }
    if (settings?.companyAddress) {
      setCompanyAddress(settings.companyAddress);
    }
    if (settings?.companyUen) {
      setCompanyUen(settings.companyUen);
    }
  }, [settings]);

  const { data: qrCodeData, isLoading: qrLoading, error: qrError } = useQuery<{ qrCode: string; appUrl: string }>({
    queryKey: ["/api/admin/qr-code"],
  });

  // Fetch admin users
  const { data: adminUsers = [], isLoading: adminsLoading } = useQuery<User[]>({
    queryKey: ["/api/admin/admins"],
  });

  // Fetch all users for adding new admins
  const { data: allUsers = [] } = useQuery<User[]>({
    queryKey: ["/api/admin/users"],
  });

  // Filter out users who are already admins (either full admin or view-only) for the add dialog
  const nonAdminUsers = allUsers.filter(u => u.role !== "admin" && u.role !== "viewonly_admin");
  
  // Filter non-admin users by search query
  const filteredNonAdminUsers = nonAdminUsers.filter(u => 
    adminSearchQuery.trim() === "" ? false :
    u.name.toLowerCase().includes(adminSearchQuery.toLowerCase()) ||
    u.email.toLowerCase().includes(adminSearchQuery.toLowerCase()) ||
    (u.employeeCode && u.employeeCode.toLowerCase().includes(adminSearchQuery.toLowerCase())) ||
    (u.username && u.username.toLowerCase().includes(adminSearchQuery.toLowerCase()))
  );
  
  // Fetch attendance view admins (super admin only)
  const { data: attendanceViewAdmins = [], isLoading: attendanceAdminsLoading } = useQuery<User[]>({
    queryKey: ['/api/admin/users/attendance-view-admins'],
    enabled: isSuperAdmin,
  });

  // Fetch employee data admins (super admin only)
  const { data: employeeDataAdmins = [], isLoading: employeeDataAdminsLoading } = useQuery<User[]>({
    queryKey: ['/api/admin/users/employee-data-admins'],
    enabled: isSuperAdmin,
  });
  
  // Filter users eligible for attendance view admin (regular users and attendance_view_admin, not full admin or viewonly_admin)
  const eligibleForAttendanceAdmin = allUsers.filter(u => u.role === "user");
  
  // Filter eligible users by search query for attendance view admin dialog
  const filteredEligibleForAttendanceAdmin = eligibleForAttendanceAdmin.filter(u =>
    attendanceAdminSearchQuery.trim() === "" ? false :
    u.name.toLowerCase().includes(attendanceAdminSearchQuery.toLowerCase()) ||
    u.email.toLowerCase().includes(attendanceAdminSearchQuery.toLowerCase()) ||
    (u.employeeCode && u.employeeCode.toLowerCase().includes(attendanceAdminSearchQuery.toLowerCase())) ||
    (u.username && u.username.toLowerCase().includes(attendanceAdminSearchQuery.toLowerCase()))
  );

  // Filter users eligible for employee data admin
  const eligibleForEmployeeDataAdmin = allUsers.filter(u => u.role === "user");
  
  // Filter eligible users by search query for employee data admin dialog
  const filteredEligibleForEmployeeDataAdmin = eligibleForEmployeeDataAdmin.filter(u =>
    employeeDataAdminSearchQuery.trim() === "" ? false :
    u.name.toLowerCase().includes(employeeDataAdminSearchQuery.toLowerCase()) ||
    u.email.toLowerCase().includes(employeeDataAdminSearchQuery.toLowerCase()) ||
    (u.employeeCode && u.employeeCode.toLowerCase().includes(employeeDataAdminSearchQuery.toLowerCase())) ||
    (u.username && u.username.toLowerCase().includes(employeeDataAdminSearchQuery.toLowerCase()))
  );

  // Mutation to update user role
  const updateRoleMutation = useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: "user" | "admin" | "viewonly_admin" }) => {
      await apiRequest("PATCH", `/api/admin/users/${userId}/role`, { role });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/admins"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({
        title: "Success",
        description: "User role updated successfully",
      });
      setShowAddAdminDialog(false);
      setSelectedUserId("");
      setAdminSearchQuery("");
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Mutation to change admin password (nexadmin only)
  const changePasswordMutation = useMutation({
    mutationFn: async ({ userId, newPassword }: { userId: string; newPassword: string }) => {
      await apiRequest("PATCH", `/api/admin/users/${userId}/password`, { newPassword });
    },
    onSuccess: () => {
      toast({
        title: "Password Changed",
        description: `Password updated successfully. The user will be required to change it on next login.`,
      });
      setShowPasswordDialog(false);
      setPasswordTargetUser(null);
      setNewPassword("");
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });
  
  // Mutation to promote user to attendance view admin (super admin only)
  const promoteToAttendanceViewAdminMutation = useMutation({
    mutationFn: async (userId: string) => {
      await apiRequest("POST", `/api/admin/users/${userId}/set-attendance-view-admin`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users/attendance-view-admins"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({
        title: "Success",
        description: "User is now an Attendance View-Only Admin",
      });
      setShowAddAttendanceAdminDialog(false);
      setSelectedAttendanceAdminUserId("");
      setAttendanceAdminSearchQuery("");
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });
  
  // Mutation to remove attendance view admin role (super admin only)
  const removeAttendanceViewAdminMutation = useMutation({
    mutationFn: async (userId: string) => {
      await apiRequest("POST", `/api/admin/users/${userId}/remove-attendance-view-admin`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users/attendance-view-admins"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({
        title: "Success",
        description: "User is no longer an Attendance View-Only Admin",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Mutation to promote user to employee data admin (super admin only)
  const promoteToEmployeeDataAdminMutation = useMutation({
    mutationFn: async (userId: string) => {
      await apiRequest("POST", `/api/admin/users/${userId}/set-employee-data-admin`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users/employee-data-admins"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({
        title: "Success",
        description: "User is now an Employee Data Admin",
      });
      setShowAddEmployeeDataAdminDialog(false);
      setSelectedEmployeeDataAdminUserId("");
      setEmployeeDataAdminSearchQuery("");
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });
  
  // Mutation to remove employee data admin role (super admin only)
  const removeEmployeeDataAdminMutation = useMutation({
    mutationFn: async (userId: string) => {
      await apiRequest("POST", `/api/admin/users/${userId}/remove-employee-data-admin`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users/employee-data-admins"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({
        title: "Success",
        description: "User is no longer an Employee Data Admin",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const uploadLogoMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      const uploadRes = await fetch("/api/company/upload-logo", {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (!uploadRes.ok) {
        const err = await uploadRes.json().catch(() => ({}));
        throw new Error(err.message || "Failed to upload logo");
      }
      const { fileUrl } = await uploadRes.json();
      await apiRequest("PUT", "/api/company/settings", { logoUrl: fileUrl });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/company/settings"] });
      setLogoFile(null);
      setLogoPreview(null);
      toast({
        title: "Success",
        description: "Logo uploaded successfully",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Upload Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const uploadFaviconMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      const uploadRes = await fetch("/api/company/upload-favicon", {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (!uploadRes.ok) {
        const err = await uploadRes.json().catch(() => ({}));
        throw new Error(err.message || "Failed to upload favicon");
      }
      const { fileUrl } = await uploadRes.json();
      await apiRequest("PUT", "/api/company/settings", { faviconUrl: fileUrl });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/company/settings"] });
      setFaviconFile(null);
      setFaviconPreview(null);
      toast({
        title: "Success",
        description: "Favicon uploaded successfully",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Upload Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (!file.type.startsWith("image/")) {
        toast({
          title: "Invalid File",
          description: "Please select an image file",
          variant: "destructive",
        });
        return;
      }

      if (file.size > 5 * 1024 * 1024) {
        toast({
          title: "File Too Large",
          description: "Logo must be less than 5MB",
          variant: "destructive",
        });
        return;
      }

      setLogoFile(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setLogoPreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleFaviconChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (!file.type.startsWith("image/")) {
        toast({
          title: "Invalid File",
          description: "Please select an image file",
          variant: "destructive",
        });
        return;
      }

      if (file.size > 1 * 1024 * 1024) {
        toast({
          title: "File Too Large",
          description: "Favicon must be less than 1MB",
          variant: "destructive",
        });
        return;
      }

      setFaviconFile(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setFaviconPreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleLogoUpload = () => {
    if (logoFile) {
      uploadLogoMutation.mutate(logoFile);
    }
  };

  const handleFaviconUpload = () => {
    if (faviconFile) {
      uploadFaviconMutation.mutate(faviconFile);
    }
  };

  const uploadClockInLogoMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      const uploadRes = await fetch("/api/company/upload-clockin-logo", {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (!uploadRes.ok) {
        const err = await uploadRes.json().catch(() => ({}));
        throw new Error(err.message || "Failed to upload clock-in logo");
      }
      const { fileUrl } = await uploadRes.json();
      await apiRequest("PUT", "/api/company/settings", { clockInLogoUrl: fileUrl });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/company/settings"] });
      setClockInLogoFile(null);
      setClockInLogoPreview(null);
      toast({
        title: "Success",
        description: "Clock-in logo uploaded successfully",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Upload Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleClockInLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const validTypes = ["image/png", "image/jpeg", "image/jpg"];
      if (!validTypes.includes(file.type)) {
        toast({
          title: "Invalid File",
          description: "Please select a PNG or JPEG image file",
          variant: "destructive",
        });
        return;
      }

      if (file.size > 5 * 1024 * 1024) {
        toast({
          title: "File Too Large",
          description: "Clock-in logo must be less than 5MB",
          variant: "destructive",
        });
        return;
      }

      setClockInLogoFile(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setClockInLogoPreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleClockInLogoUpload = () => {
    if (clockInLogoFile) {
      uploadClockInLogoMutation.mutate(clockInLogoFile);
    }
  };

  const updateAttendanceBufferMutation = useMutation({
    mutationFn: async (minutes: number) => {
      await apiRequest("PUT", "/api/admin/attendance/buffer", {
        attendanceBufferMinutes: minutes,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/company/settings"] });
      toast({
        title: "Success",
        description: "Attendance buffer updated successfully",
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

  const handleUpdateAttendanceBuffer = () => {
    updateAttendanceBufferMutation.mutate(attendanceBufferMinutes);
  };

  const updateEmailSettingsMutation = useMutation({
    mutationFn: async (data: { senderEmail?: string; senderName?: string; appUrl?: string }) => {
      await apiRequest("PUT", "/api/company/email-settings", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/company/settings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/qr-code"] });
      toast({
        title: "Success",
        description: "Email settings updated successfully",
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

  const handleUpdateEmailSettings = () => {
    updateEmailSettingsMutation.mutate({
      senderEmail: senderEmail || undefined,
      senderName: senderName || undefined,
      appUrl: appUrl || undefined,
    });
  };

  // Timezone mutation
  const updateTimezoneMutation = useMutation({
    mutationFn: async (timezone: string) => {
      await apiRequest("PUT", "/api/company/timezone", { defaultTimezone: timezone });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/company/settings"] });
      toast({
        title: "Success",
        description: "Company timezone updated successfully",
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

  const handleUpdateTimezone = () => {
    updateTimezoneMutation.mutate(defaultTimezone);
  };

  // Company info mutation
  const updateCompanyInfoMutation = useMutation({
    mutationFn: async (data: { companyName?: string; companyAddress?: string; companyUen?: string }) => {
      await apiRequest("PUT", "/api/company/info", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/company/settings"] });
      toast({
        title: "Success",
        description: "Company information updated successfully",
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

  const handleUpdateCompanyInfo = () => {
    updateCompanyInfoMutation.mutate({
      companyName: companyName || undefined,
      companyAddress: companyAddress || undefined,
      companyUen: companyUen || undefined,
    });
  };

  // Common timezones for dropdown
  const commonTimezones = [
    { value: "Asia/Singapore", label: "Singapore (GMT+8)" },
    { value: "Asia/Kuala_Lumpur", label: "Kuala Lumpur (GMT+8)" },
    { value: "Asia/Hong_Kong", label: "Hong Kong (GMT+8)" },
    { value: "Asia/Shanghai", label: "Shanghai (GMT+8)" },
    { value: "Asia/Tokyo", label: "Tokyo (GMT+9)" },
    { value: "Asia/Seoul", label: "Seoul (GMT+9)" },
    { value: "Asia/Bangkok", label: "Bangkok (GMT+7)" },
    { value: "Asia/Jakarta", label: "Jakarta (GMT+7)" },
    { value: "Asia/Manila", label: "Manila (GMT+8)" },
    { value: "Asia/Kolkata", label: "India (GMT+5:30)" },
    { value: "Asia/Dubai", label: "Dubai (GMT+4)" },
    { value: "Europe/London", label: "London (GMT+0/+1)" },
    { value: "Europe/Paris", label: "Paris (GMT+1/+2)" },
    { value: "America/New_York", label: "New York (GMT-5/-4)" },
    { value: "America/Los_Angeles", label: "Los Angeles (GMT-8/-7)" },
    { value: "Australia/Sydney", label: "Sydney (GMT+10/+11)" },
    { value: "Pacific/Auckland", label: "Auckland (GMT+12/+13)" },
  ];

  const parseCSV = (text: string): { employees: ParsedEmployee[]; errors: string[] } => {
    const lines = text.split('\n').filter(line => line.trim());
    if (lines.length < 2) {
      return { employees: [], errors: ['CSV file must have a header row and at least one data row'] };
    }

    const headerLine = lines[0];
    const headers = headerLine.split(',').map(h => h.trim().toLowerCase().replace(/['"]/g, ''));
    
    const columnMap: Record<string, string> = {
      'employee_code': 'code',
      'employeecode': 'code',
      'code': 'code',
      'emp_code': 'code',
      'name': 'name',
      'full_name': 'name',
      'fullname': 'name',
      'employee_name': 'name',
      'email': 'email',
      'email_address': 'email',
      'short_name': 'shortName',
      'shortname': 'shortName',
      'nickname': 'shortName',
      'nric_fin': 'nricFin',
      'nricfin': 'nricFin',
      'nric': 'nricFin',
      'ic': 'nricFin',
      'gender': 'gender',
      'sex': 'gender',
      'department': 'department',
      'dept': 'department',
      'section': 'section',
      'nationality': 'section',
      'designation': 'designation',
      'position': 'designation',
      'job_title': 'designation',
      'jobtitle': 'designation',
      'title': 'designation',
      'finger_id': 'fingerId',
      'fingerid': 'fingerId',
      'biometric_id': 'fingerId',
      'join_date': 'joinDate',
      'joindate': 'joinDate',
      'start_date': 'joinDate',
      'startdate': 'joinDate',
      'hire_date': 'joinDate',
      'resign_date': 'resignDate',
      'resigndate': 'resignDate',
      'end_date': 'resignDate',
      'mobile_number': 'mobileNumber',
      'mobilenumber': 'mobileNumber',
      'phone': 'mobileNumber',
      'mobile': 'mobileNumber',
    };

    const headerIndexMap: Record<string, number> = {};
    headers.forEach((header, index) => {
      const mappedField = columnMap[header];
      if (mappedField) {
        headerIndexMap[mappedField] = index;
      }
    });

    const employees: ParsedEmployee[] = [];
    const errors: string[] = [];

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const values: string[] = [];
      let current = '';
      let inQuotes = false;
      
      for (let j = 0; j < line.length; j++) {
        const char = line[j];
        if (char === '"') {
          inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
          values.push(current.trim().replace(/^["']|["']$/g, ''));
          current = '';
        } else {
          current += char;
        }
      }
      values.push(current.trim().replace(/^["']|["']$/g, ''));

      const getValue = (field: string): string => {
        const index = headerIndexMap[field];
        return index !== undefined ? (values[index] || '').trim() : '';
      };

      const code = getValue('code');
      const name = getValue('name');
      const email = getValue('email');

      if (!code && !name && !email) {
        continue;
      }

      if (!code) {
        errors.push(`Row ${i + 1}: Missing employee code`);
        continue;
      }
      if (!name) {
        errors.push(`Row ${i + 1}: Missing name`);
        continue;
      }
      if (!email) {
        errors.push(`Row ${i + 1}: Missing email`);
        continue;
      }

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        errors.push(`Row ${i + 1}: Invalid email format (${email})`);
        continue;
      }

      employees.push({
        code,
        name,
        email,
        shortName: getValue('shortName') || undefined,
        nricFin: getValue('nricFin') || undefined,
        gender: getValue('gender') || undefined,
        department: getValue('department') || undefined,
        section: getValue('section') || undefined,
        designation: getValue('designation') || undefined,
        fingerId: getValue('fingerId') || undefined,
        joinDate: getValue('joinDate') || undefined,
        resignDate: getValue('resignDate') || undefined,
        mobileNumber: getValue('mobileNumber') || undefined,
      });
    }

    return { employees, errors };
  };

  const handleCsvChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (!file.name.endsWith('.csv')) {
        toast({
          title: "Invalid File",
          description: "Please upload a CSV file",
          variant: "destructive",
        });
        return;
      }

      setCsvFile(file);
      
      const reader = new FileReader();
      reader.onload = (event) => {
        const text = event.target?.result as string;
        const { employees, errors } = parseCSV(text);
        setParsedEmployees(employees);
        setCsvErrors(errors);
        setShowPreview(true);
      };
      reader.readAsText(file);
    }
  };

  const importEmployeesMutation = useMutation({
    mutationFn: async (employees: ParsedEmployee[]) => {
      const response = await apiRequest("POST", "/api/admin/users/import", { employees });
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({
        title: "Import Successful",
        description: data.message || `Imported ${data.created} employees`,
      });
      setCsvFile(null);
      setParsedEmployees([]);
      setCsvErrors([]);
      setShowPreview(false);
    },
    onError: (error: Error) => {
      toast({
        title: "Import Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleImportEmployees = () => {
    if (parsedEmployees.length > 0) {
      importEmployeesMutation.mutate(parsedEmployees);
    }
  };

  const handleCancelImport = () => {
    setCsvFile(null);
    setParsedEmployees([]);
    setCsvErrors([]);
    setShowPreview(false);
  };

  if (isLoading) {
    return (
      <div className="container mx-auto p-6">
        <div className="text-center">Loading settings...</div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 max-w-4xl">
      <div className="mb-6">
        <Link href="/admin/dashboard">
          <Button variant="ghost" size="sm" className="mb-4" data-testid="button-back-to-dashboard">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Dashboard
          </Button>
        </Link>
        <h1 className="text-3xl font-bold">Company Settings</h1>
        <p className="text-muted-foreground">Manage your company branding and appearance</p>
      </div>

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Import Employees
            </CardTitle>
            <CardDescription>
              Upload a CSV file to bulk import employees. Required columns: employee_code, name, email
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!showPreview ? (
              <div className="space-y-4">
                <div className="border-2 border-dashed rounded-lg p-6 text-center">
                  <FileSpreadsheet className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
                  <Label htmlFor="csv-upload" className="cursor-pointer">
                    <span className="text-primary hover:underline">Click to upload CSV file</span>
                  </Label>
                  <Input
                    id="csv-upload"
                    type="file"
                    accept=".csv"
                    onChange={handleCsvChange}
                    className="hidden"
                    data-testid="input-csv-upload"
                  />
                  <p className="text-xs text-muted-foreground mt-2">
                    CSV with columns: employee_code, name, email, department, designation, etc.
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <FileSpreadsheet className="h-5 w-5 text-primary" />
                    <span className="font-medium">{csvFile?.name}</span>
                    <Badge variant="secondary">{parsedEmployees.length} employees</Badge>
                  </div>
                  <Button variant="ghost" size="sm" onClick={handleCancelImport} data-testid="button-cancel-import">
                    <X className="h-4 w-4 mr-1" />
                    Cancel
                  </Button>
                </div>

                {csvErrors.length > 0 && (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>
                      <p className="font-medium mb-1">{csvErrors.length} row(s) with errors:</p>
                      <ul className="list-disc list-inside text-sm">
                        {csvErrors.slice(0, 5).map((error, i) => (
                          <li key={i}>{error}</li>
                        ))}
                        {csvErrors.length > 5 && (
                          <li>...and {csvErrors.length - 5} more</li>
                        )}
                      </ul>
                    </AlertDescription>
                  </Alert>
                )}

                {parsedEmployees.length > 0 && (
                  <div className="border rounded-lg">
                    <div className="p-3 bg-muted/30 border-b">
                      <h4 className="font-medium">Preview (showing first 10 rows)</h4>
                    </div>
                    <ScrollArea className="h-[300px]">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-[100px]">Code</TableHead>
                            <TableHead>Name</TableHead>
                            <TableHead>Email</TableHead>
                            <TableHead>Department</TableHead>
                            <TableHead>Designation</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {parsedEmployees.slice(0, 10).map((emp, index) => (
                            <TableRow key={index} data-testid={`row-preview-${index}`}>
                              <TableCell className="font-mono text-sm">{emp.code}</TableCell>
                              <TableCell>{toTitleCase(emp.name)}</TableCell>
                              <TableCell className="text-sm">{emp.email}</TableCell>
                              <TableCell className="text-sm">{emp.department || '-'}</TableCell>
                              <TableCell className="text-sm">{emp.designation || '-'}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </ScrollArea>
                    {parsedEmployees.length > 10 && (
                      <div className="p-2 text-center text-sm text-muted-foreground border-t">
                        ...and {parsedEmployees.length - 10} more employees
                      </div>
                    )}
                  </div>
                )}

                <div className="flex gap-2 flex-wrap">
                  <Button
                    onClick={handleImportEmployees}
                    disabled={parsedEmployees.length === 0 || importEmployeesMutation.isPending}
                    data-testid="button-confirm-import"
                  >
                    <Check className="h-4 w-4 mr-2" />
                    {importEmployeesMutation.isPending 
                      ? "Importing..." 
                      : `Import ${parsedEmployees.length} Employees`}
                  </Button>
                  <Button variant="outline" onClick={handleCancelImport} data-testid="button-cancel-import-2">
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5" />
              Company Information
            </CardTitle>
            <CardDescription>
              Company details for official documents like payslips
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="company-name">Company Name</Label>
              <Input
                id="company-name"
                type="text"
                placeholder="e.g., ABC Company Pte Ltd"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                data-testid="input-company-name"
              />
              <p className="text-xs text-muted-foreground">
                Official company name displayed on payslips and documents
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="company-uen">Company UEN</Label>
                <Input
                  id="company-uen"
                  type="text"
                  placeholder="e.g., 202312345A"
                  value={companyUen}
                  onChange={(e) => setCompanyUen(e.target.value)}
                  data-testid="input-company-uen"
                />
                <p className="text-xs text-muted-foreground">
                  Unique Entity Number for Singapore companies
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="company-address">Company Address</Label>
                <Input
                  id="company-address"
                  type="text"
                  placeholder="e.g., 123 Main Street, Singapore 123456"
                  value={companyAddress}
                  onChange={(e) => setCompanyAddress(e.target.value)}
                  data-testid="input-company-address"
                />
                <p className="text-xs text-muted-foreground">
                  Full address shown on payslips
                </p>
              </div>
            </div>
            <Button
              onClick={handleUpdateCompanyInfo}
              disabled={updateCompanyInfoMutation.isPending || isViewOnlyAdmin}
              data-testid="button-update-company-info"
            >
              {updateCompanyInfoMutation.isPending ? "Updating..." : "Update Company Info"}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ImageIcon className="h-5 w-5" />
              App Logo
            </CardTitle>
            <CardDescription>
              Upload your app logo for header/branding (max 5MB, recommended: 200x200px)
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-start gap-6">
              <div className="flex-1 space-y-2">
                <Label htmlFor="logo-upload">Current App Logo</Label>
                <div className="border rounded-md p-4 bg-muted/20">
                  {settings?.logoUrl ? (
                    <img
                      src={settings.logoUrl}
                      alt="App Logo"
                      className="h-32 w-32 object-contain mx-auto"
                      data-testid="img-current-logo"
                    />
                  ) : (
                    <div className="h-32 w-32 flex items-center justify-center mx-auto text-muted-foreground">
                      <ImageIcon className="h-12 w-12" />
                    </div>
                  )}
                </div>
              </div>

              {logoPreview && (
                <div className="flex-1 space-y-2">
                  <Label>Preview</Label>
                  <div className="border rounded-md p-4 bg-muted/20">
                    <img
                      src={logoPreview}
                      alt="App Logo Preview"
                      className="h-32 w-32 object-contain mx-auto"
                      data-testid="img-logo-preview"
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="logo-upload">Upload New App Logo</Label>
              <Input
                id="logo-upload"
                type="file"
                accept="image/*"
                onChange={handleLogoChange}
                data-testid="input-logo-upload"
              />
            </div>

            <Button
              onClick={handleLogoUpload}
              disabled={!logoFile || uploadLogoMutation.isPending}
              data-testid="button-upload-logo"
            >
              <Upload className="h-4 w-4 mr-2" />
              {uploadLogoMutation.isPending ? "Uploading..." : "Upload App Logo"}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Camera className="h-5 w-5" />
              Company Logo (Clock-in)
            </CardTitle>
            <CardDescription>
              Upload your company logo to display on employee clock-in photos (max 5MB, recommended: 200x200px)
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-start gap-6">
              <div className="flex-1 space-y-2">
                <Label>Current Clock-in Logo</Label>
                <div className="border rounded-md p-4 bg-muted/20">
                  {settings?.clockInLogoUrl ? (
                    <img
                      src={settings.clockInLogoUrl}
                      alt="Clock-in Logo"
                      className="h-32 w-32 object-contain mx-auto"
                      data-testid="img-current-clockin-logo"
                    />
                  ) : (
                    <div className="h-32 w-32 flex items-center justify-center mx-auto text-muted-foreground">
                      <Camera className="h-12 w-12" />
                    </div>
                  )}
                </div>
              </div>

              {clockInLogoPreview && (
                <div className="flex-1 space-y-2">
                  <Label>Preview</Label>
                  <div className="border rounded-md p-4 bg-muted/20">
                    <img
                      src={clockInLogoPreview}
                      alt="Clock-in Logo Preview"
                      className="h-32 w-32 object-contain mx-auto"
                      data-testid="img-clockin-logo-preview"
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="clockin-logo-upload">Upload New Clock-in Logo (PNG or JPEG)</Label>
              <Input
                id="clockin-logo-upload"
                type="file"
                accept="image/png,image/jpeg,image/jpg"
                onChange={handleClockInLogoChange}
                data-testid="input-clockin-logo-upload"
              />
            </div>

            <Button
              onClick={handleClockInLogoUpload}
              disabled={!clockInLogoFile || uploadClockInLogoMutation.isPending}
              data-testid="button-upload-clockin-logo"
            >
              <Upload className="h-4 w-4 mr-2" />
              {uploadClockInLogoMutation.isPending ? "Uploading..." : "Upload Clock-in Logo"}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ImageIcon className="h-5 w-5" />
              Favicon
            </CardTitle>
            <CardDescription>
              Upload your favicon (max 1MB, recommended: 32x32px or 64x64px .ico or .png)
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-start gap-6">
              <div className="flex-1 space-y-2">
                <Label htmlFor="favicon-upload">Current Favicon</Label>
                <div className="border rounded-md p-4 bg-muted/20">
                  {settings?.faviconUrl ? (
                    <img
                      src={settings.faviconUrl}
                      alt="Favicon"
                      className="h-16 w-16 object-contain mx-auto"
                      data-testid="img-current-favicon"
                    />
                  ) : (
                    <div className="h-16 w-16 flex items-center justify-center mx-auto text-muted-foreground">
                      <ImageIcon className="h-8 w-8" />
                    </div>
                  )}
                </div>
              </div>

              {faviconPreview && (
                <div className="flex-1 space-y-2">
                  <Label>Preview</Label>
                  <div className="border rounded-md p-4 bg-muted/20">
                    <img
                      src={faviconPreview}
                      alt="Favicon Preview"
                      className="h-16 w-16 object-contain mx-auto"
                      data-testid="img-favicon-preview"
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="favicon-upload">Upload New Favicon</Label>
              <Input
                id="favicon-upload"
                type="file"
                accept="image/*"
                onChange={handleFaviconChange}
                data-testid="input-favicon-upload"
              />
            </div>

            <Button
              onClick={handleFaviconUpload}
              disabled={!faviconFile || uploadFaviconMutation.isPending}
              data-testid="button-upload-favicon"
            >
              <Upload className="h-4 w-4 mr-2" />
              {uploadFaviconMutation.isPending ? "Uploading..." : "Upload Favicon"}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5" />
              Attendance Settings
            </CardTitle>
            <CardDescription>
              Configure attendance tracking settings for your organization
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="attendance-buffer">
                Clock In/Out Buffer (minutes)
              </Label>
              <p className="text-sm text-muted-foreground">
                Maximum minutes allowance before/after scheduled time
              </p>
              <Input
                id="attendance-buffer"
                type="number"
                min="0"
                max="120"
                value={attendanceBufferMinutes}
                onChange={(e) => setAttendanceBufferMinutes(parseInt(e.target.value) || 0)}
                data-testid="input-attendance-buffer"
              />
              <p className="text-xs text-muted-foreground">
                Current buffer: {attendanceBufferMinutes} minutes (Range: 0-120)
              </p>
            </div>

            <Button
              onClick={handleUpdateAttendanceBuffer}
              disabled={updateAttendanceBufferMutation.isPending || isViewOnlyAdmin}
              data-testid="button-update-buffer"
            >
              {updateAttendanceBufferMutation.isPending ? "Updating..." : "Update Buffer"}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Mail className="h-5 w-5" />
              Email Settings
            </CardTitle>
            <CardDescription>
              Configure sender information for welcome emails to employees
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="sender-email">Sender Email</Label>
                <Input
                  id="sender-email"
                  type="email"
                  placeholder="hr@company.com"
                  value={senderEmail}
                  onChange={(e) => setSenderEmail(e.target.value)}
                  data-testid="input-sender-email"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="sender-name">Sender Name</Label>
                <Input
                  id="sender-name"
                  type="text"
                  placeholder="HR Department"
                  value={senderName}
                  onChange={(e) => setSenderName(e.target.value)}
                  data-testid="input-sender-name"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="app-url">App URL (for QR Code)</Label>
              <Input
                id="app-url"
                type="url"
                placeholder="https://app.nexahrms.com"
                value={appUrl}
                onChange={(e) => setAppUrl(e.target.value)}
                data-testid="input-app-url"
              />
              <p className="text-xs text-muted-foreground">
                This URL will be embedded in the QR code sent to employees
              </p>
            </div>
            <Button
              onClick={handleUpdateEmailSettings}
              disabled={updateEmailSettingsMutation.isPending || isViewOnlyAdmin}
              data-testid="button-update-email-settings"
            >
              {updateEmailSettingsMutation.isPending ? "Updating..." : "Update Email Settings"}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Globe className="h-5 w-5" />
              Timezone Settings
            </CardTitle>
            <CardDescription>
              Set the company timezone for attendance calculations
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="timezone">Company Timezone</Label>
              <Select value={defaultTimezone} onValueChange={setDefaultTimezone}>
                <SelectTrigger id="timezone" data-testid="select-timezone">
                  <SelectValue placeholder="Select timezone" />
                </SelectTrigger>
                <SelectContent>
                  {commonTimezones.map(tz => (
                    <SelectItem key={tz.value} value={tz.value}>{tz.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                This timezone is used for Today's attendance view and date calculations
              </p>
            </div>
            <Button
              onClick={handleUpdateTimezone}
              disabled={updateTimezoneMutation.isPending || isViewOnlyAdmin}
              data-testid="button-update-timezone"
            >
              {updateTimezoneMutation.isPending ? "Updating..." : "Update Timezone"}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <QrCode className="h-5 w-5" />
              App QR Code Preview
            </CardTitle>
            <CardDescription>
              This QR code will be included in welcome emails
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col items-center gap-4">
              {qrLoading ? (
                <div className="w-48 h-48 flex items-center justify-center border rounded-lg bg-muted/20">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                </div>
              ) : qrError ? (
                <div className="w-48 h-48 flex flex-col items-center justify-center border rounded-lg bg-destructive/10 text-destructive">
                  <QrCode className="h-12 w-12 mb-2" />
                  <p className="text-sm">Failed to load QR code</p>
                </div>
              ) : qrCodeData?.qrCode ? (
                <>
                  <img
                    src={qrCodeData.qrCode}
                    alt="App QR Code"
                    className="w-48 h-48"
                    data-testid="img-qr-code"
                  />
                  <p className="text-sm text-muted-foreground">
                    Scans to: {qrCodeData.appUrl}
                  </p>
                </>
              ) : (
                <div className="w-48 h-48 flex items-center justify-center border rounded-lg bg-muted/20">
                  <QrCode className="h-12 w-12 text-muted-foreground" />
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5" />
              Admin Users
            </CardTitle>
            <CardDescription>
              Manage users who have admin access to the system
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex justify-end">
              <Button
                onClick={() => setShowAddAdminDialog(true)}
                disabled={isViewOnlyAdmin}
                data-testid="button-add-admin"
              >
                <UserPlus className="h-4 w-4 mr-2" />
                Add Admin
              </Button>
            </div>

            {adminsLoading ? (
              <div className="text-center py-8 text-muted-foreground">
                Loading admin users...
              </div>
            ) : adminUsers.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Shield className="h-12 w-12 mx-auto mb-2 opacity-50" />
                <p>No admin users configured</p>
                <p className="text-sm">Only the master admin account has access</p>
              </div>
            ) : (
              <div className="border rounded-lg">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Username</TableHead>
                      <TableHead>Department</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {adminUsers.map((admin) => (
                      <TableRow key={admin.id} data-testid={`row-admin-${admin.id}`}>
                        <TableCell className="font-medium">
                          <div className="flex items-center gap-2">
                            <Shield className="h-4 w-4 text-primary" />
                            {toTitleCase(admin.name)}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant={admin.role === "admin" ? "default" : "secondary"}>
                            {admin.role === "admin" ? "Full Admin" : "View-Only"}
                          </Badge>
                        </TableCell>
                        <TableCell>{admin.email}</TableCell>
                        <TableCell className="font-mono text-sm">{admin.username}</TableCell>
                        <TableCell>{admin.department || "-"}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex gap-2 justify-end">
                            {isMasterAdmin && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  setPasswordTargetUser(admin);
                                  setShowPasswordDialog(true);
                                }}
                                data-testid={`button-change-password-${admin.id}`}
                              >
                                <KeyRound className="h-4 w-4 mr-1" />
                                Change Password
                              </Button>
                            )}
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => updateRoleMutation.mutate({ userId: admin.id, role: "user" })}
                              disabled={updateRoleMutation.isPending || isViewOnlyAdmin}
                              data-testid={`button-remove-admin-${admin.id}`}
                            >
                              <ShieldOff className="h-4 w-4 mr-1" />
                              Remove Admin
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                Admin users can log in through the Admin Login page using their username and password. 
                The master admin account (nexaadmin) always has access.
              </AlertDescription>
            </Alert>
          </CardContent>
        </Card>
        
        {/* Attendance View-Only Admins Card - Super Admin Only */}
        {isSuperAdmin && (
          <Card data-testid="card-attendance-view-admins">
            <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
              <CardTitle className="flex items-center gap-2">
                <Eye className="h-5 w-5" />
                Attendance View-Only Admins
              </CardTitle>
              <Button
                onClick={() => setShowAddAttendanceAdminDialog(true)}
                size="sm"
                data-testid="button-add-attendance-admin"
              >
                <Plus className="h-4 w-4 mr-1" />
                Add
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              {attendanceAdminsLoading ? (
                <p className="text-sm text-muted-foreground">Loading...</p>
              ) : attendanceViewAdmins.length === 0 ? (
                <p className="text-sm text-muted-foreground">No attendance view-only admins configured</p>
              ) : (
                <div className="border rounded-lg overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Email</TableHead>
                        <TableHead>Username</TableHead>
                        <TableHead>Department</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {attendanceViewAdmins.map((admin) => (
                        <TableRow key={admin.id} data-testid={`row-attendance-admin-${admin.id}`}>
                          <TableCell className="font-medium">
                            <div className="flex items-center gap-2">
                              <Eye className="h-4 w-4 text-blue-500" />
                              {toTitleCase(admin.name)}
                            </div>
                          </TableCell>
                          <TableCell>{admin.email}</TableCell>
                          <TableCell className="font-mono text-sm">{admin.username}</TableCell>
                          <TableCell>{admin.department || "-"}</TableCell>
                          <TableCell className="text-right">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => removeAttendanceViewAdminMutation.mutate(admin.id)}
                              disabled={removeAttendanceViewAdminMutation.isPending}
                              data-testid={`button-remove-attendance-admin-${admin.id}`}
                            >
                              <ShieldOff className="h-4 w-4 mr-1" />
                              Remove
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}

              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  Attendance view-only admins can only view attendance data. They cannot access payroll, settings, or other admin features.
                </AlertDescription>
              </Alert>
            </CardContent>
          </Card>
        )}

        {/* Employee Data Admins Card - Super Admin Only */}
        {isSuperAdmin && (
          <Card data-testid="card-employee-data-admins">
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
              <CardTitle className="flex items-center gap-2">
                <UserCog className="h-5 w-5" />
                Employee Data Admins
              </CardTitle>
              <Button 
                onClick={() => setShowAddEmployeeDataAdminDialog(true)}
                size="sm"
                data-testid="button-add-employee-data-admin"
              >
                <Plus className="h-4 w-4 mr-1" />
                Add Employee Data Admin
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              {employeeDataAdminsLoading ? (
                <div className="flex items-center justify-center py-4">
                  <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : employeeDataAdmins.length === 0 ? (
                <p className="text-sm text-muted-foreground">No employee data admins configured</p>
              ) : (
                <div className="border rounded-lg overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Email</TableHead>
                        <TableHead>Username</TableHead>
                        <TableHead>Department</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {employeeDataAdmins.map((admin) => (
                        <TableRow key={admin.id} data-testid={`row-employee-data-admin-${admin.id}`}>
                          <TableCell className="font-medium">
                            <div className="flex items-center gap-2">
                              <UserCog className="h-4 w-4 text-teal-500" />
                              {toTitleCase(admin.name)}
                            </div>
                          </TableCell>
                          <TableCell>{admin.email}</TableCell>
                          <TableCell className="font-mono text-sm">{admin.username}</TableCell>
                          <TableCell>{admin.department || "-"}</TableCell>
                          <TableCell className="text-right">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => removeEmployeeDataAdminMutation.mutate(admin.id)}
                              disabled={removeEmployeeDataAdminMutation.isPending}
                              data-testid={`button-remove-employee-data-admin-${admin.id}`}
                            >
                              <ShieldOff className="h-4 w-4 mr-1" />
                              Remove
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}

              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  Employee data admins can only access the Employee Data Management page. They cannot access attendance, payroll, settings, or other admin features.
                </AlertDescription>
              </Alert>
            </CardContent>
          </Card>
        )}

        {/* Login History Card */}
        <LoginHistoryCard />
      </div>

      {/* Add Admin Dialog */}
      <Dialog open={showAddAdminDialog} onOpenChange={(open) => {
        setShowAddAdminDialog(open);
        if (!open) {
          setAdminSearchQuery("");
          setSelectedUserId("");
        }
      }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add Admin User</DialogTitle>
            <DialogDescription>
              Search for an employee to grant admin access. They will be able to log in via the Admin Login page.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Search Employee</Label>
              <Input
                placeholder="Type name, email, or employee code..."
                value={adminSearchQuery}
                onChange={(e) => {
                  setAdminSearchQuery(e.target.value);
                  setSelectedUserId("");
                }}
                data-testid="input-search-admin-user"
              />
            </div>
            
            {adminSearchQuery.trim() !== "" && (
              <div className="border rounded-lg max-h-48 overflow-auto">
                {filteredNonAdminUsers.length === 0 ? (
                  <div className="p-3 text-sm text-muted-foreground text-center">
                    No matching employees found
                  </div>
                ) : (
                  <div className="divide-y">
                    {filteredNonAdminUsers.slice(0, 10).map((user) => (
                      <div
                        key={user.id}
                        className={`p-3 cursor-pointer hover-elevate ${selectedUserId === user.id ? "bg-primary/10" : ""}`}
                        onClick={() => setSelectedUserId(user.id)}
                        data-testid={`option-user-${user.id}`}
                      >
                        <div className="font-medium">{toTitleCase(user.name)}</div>
                        <div className="text-sm text-muted-foreground">
                          {user.email} {user.employeeCode && `· ${user.employeeCode}`}
                        </div>
                      </div>
                    ))}
                    {filteredNonAdminUsers.length > 10 && (
                      <div className="p-2 text-sm text-muted-foreground text-center">
                        +{filteredNonAdminUsers.length - 10} more results. Refine your search.
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
            
            {selectedUserId && (
              <div className="space-y-3">
                <div className="p-3 bg-primary/5 rounded-lg border border-primary/20">
                  <div className="text-sm text-muted-foreground">Selected:</div>
                  <div className="font-medium">
                    {toTitleCase(nonAdminUsers.find(u => u.id === selectedUserId)?.name)}
                  </div>
                </div>
                
                {/* Role type selection */}
                <div className="space-y-2">
                  <Label>Admin Type</Label>
                  <div className="flex gap-4">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="roleType"
                        value="admin"
                        checked={selectedRoleType === "admin"}
                        onChange={() => setSelectedRoleType("admin")}
                        className="w-4 h-4"
                        data-testid="radio-full-admin"
                      />
                      <div>
                        <div className="font-medium">Full Admin</div>
                        <div className="text-xs text-muted-foreground">Can view and edit all data</div>
                      </div>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="roleType"
                        value="viewonly_admin"
                        checked={selectedRoleType === "viewonly_admin"}
                        onChange={() => setSelectedRoleType("viewonly_admin")}
                        className="w-4 h-4"
                        data-testid="radio-viewonly-admin"
                      />
                      <div>
                        <div className="font-medium">View-Only Admin</div>
                        <div className="text-xs text-muted-foreground">Can view but not edit data</div>
                      </div>
                    </label>
                  </div>
                </div>
              </div>
            )}
            
            {nonAdminUsers.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No employees available to add as admin. All users are already admins.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddAdminDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (selectedUserId) {
                  updateRoleMutation.mutate({ userId: selectedUserId, role: selectedRoleType });
                }
              }}
              disabled={!selectedUserId || updateRoleMutation.isPending}
              data-testid="button-confirm-add-admin"
            >
              {updateRoleMutation.isPending ? "Adding..." : `Add as ${selectedRoleType === "admin" ? "Admin" : "View-Only Admin"}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Change Password Dialog (nexadmin only) */}
      <Dialog open={showPasswordDialog} onOpenChange={(open) => {
        setShowPasswordDialog(open);
        if (!open) {
          setPasswordTargetUser(null);
          setNewPassword("");
        }
      }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Change Admin Password</DialogTitle>
            <DialogDescription>
              Set a new password for {toTitleCase(passwordTargetUser?.name)}. They will be required to change it on their next login.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="new-password">New Password</Label>
              <PasswordInput
                id="new-password"
                placeholder="Enter new password (min 6 characters)"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                data-testid="input-new-password"
              />
            </div>
            {passwordTargetUser && (
              <div className="text-sm text-muted-foreground">
                Changing password for: <span className="font-medium text-foreground">{toTitleCase(passwordTargetUser.name)}</span> ({passwordTargetUser.email})
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPasswordDialog(false)} data-testid="button-cancel-password">
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (passwordTargetUser && newPassword.length >= 6) {
                  changePasswordMutation.mutate({ userId: passwordTargetUser.id, newPassword });
                }
              }}
              disabled={!passwordTargetUser || newPassword.length < 6 || changePasswordMutation.isPending}
              data-testid="button-confirm-password"
            >
              {changePasswordMutation.isPending ? "Changing..." : "Change Password"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Attendance View Admin Dialog (super admin only) */}
      <Dialog open={showAddAttendanceAdminDialog} onOpenChange={(open) => {
        setShowAddAttendanceAdminDialog(open);
        if (!open) {
          setAttendanceAdminSearchQuery("");
          setSelectedAttendanceAdminUserId("");
        }
      }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add Attendance View-Only Admin</DialogTitle>
            <DialogDescription>
              Search for an employee to grant attendance view-only access. They will only be able to view attendance data.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Search Employee</Label>
              <Input
                placeholder="Type name, email, or employee code..."
                value={attendanceAdminSearchQuery}
                onChange={(e) => {
                  setAttendanceAdminSearchQuery(e.target.value);
                  setSelectedAttendanceAdminUserId("");
                }}
                data-testid="input-search-attendance-admin"
              />
            </div>
            
            {attendanceAdminSearchQuery.trim() !== "" && (
              <div className="border rounded-lg max-h-48 overflow-auto">
                {filteredEligibleForAttendanceAdmin.length === 0 ? (
                  <div className="p-3 text-sm text-muted-foreground text-center">
                    No matching employees found
                  </div>
                ) : (
                  <div className="divide-y">
                    {filteredEligibleForAttendanceAdmin.slice(0, 10).map((user) => (
                      <div
                        key={user.id}
                        className={`p-3 cursor-pointer hover-elevate ${selectedAttendanceAdminUserId === user.id ? "bg-primary/10" : ""}`}
                        onClick={() => setSelectedAttendanceAdminUserId(user.id)}
                        data-testid={`option-attendance-admin-${user.id}`}
                      >
                        <div className="font-medium">{toTitleCase(user.name)}</div>
                        <div className="text-sm text-muted-foreground">
                          {user.email} {user.employeeCode && `· ${user.employeeCode}`}
                        </div>
                      </div>
                    ))}
                    {filteredEligibleForAttendanceAdmin.length > 10 && (
                      <div className="p-2 text-sm text-muted-foreground text-center">
                        +{filteredEligibleForAttendanceAdmin.length - 10} more results. Refine your search.
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
            
            {selectedAttendanceAdminUserId && (
              <div className="p-3 bg-primary/5 rounded-lg border border-primary/20">
                <div className="text-sm text-muted-foreground">Selected:</div>
                <div className="font-medium">
                  {toTitleCase(eligibleForAttendanceAdmin.find(u => u.id === selectedAttendanceAdminUserId)?.name)}
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddAttendanceAdminDialog(false)} data-testid="button-cancel-attendance-admin">
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (selectedAttendanceAdminUserId) {
                  promoteToAttendanceViewAdminMutation.mutate(selectedAttendanceAdminUserId);
                }
              }}
              disabled={!selectedAttendanceAdminUserId || promoteToAttendanceViewAdminMutation.isPending}
              data-testid="button-confirm-attendance-admin"
            >
              {promoteToAttendanceViewAdminMutation.isPending ? "Adding..." : "Add Attendance View Admin"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Employee Data Admin Dialog (super admin only) */}
      <Dialog open={showAddEmployeeDataAdminDialog} onOpenChange={(open) => {
        setShowAddEmployeeDataAdminDialog(open);
        if (!open) {
          setEmployeeDataAdminSearchQuery("");
          setSelectedEmployeeDataAdminUserId("");
        }
      }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add Employee Data Admin</DialogTitle>
            <DialogDescription>
              Search for an employee to grant employee data management access. They will only be able to view and manage employee data.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Search Employee</Label>
              <Input
                placeholder="Type name, email, or employee code..."
                value={employeeDataAdminSearchQuery}
                onChange={(e) => {
                  setEmployeeDataAdminSearchQuery(e.target.value);
                  setSelectedEmployeeDataAdminUserId("");
                }}
                data-testid="input-search-employee-data-admin"
              />
            </div>
            
            {employeeDataAdminSearchQuery.trim() !== "" && (
              <div className="border rounded-lg max-h-48 overflow-auto">
                {filteredEligibleForEmployeeDataAdmin.length === 0 ? (
                  <div className="p-3 text-sm text-muted-foreground text-center">
                    No matching employees found
                  </div>
                ) : (
                  <div className="divide-y">
                    {filteredEligibleForEmployeeDataAdmin.slice(0, 10).map((user) => (
                      <div
                        key={user.id}
                        className={`p-3 cursor-pointer hover-elevate ${selectedEmployeeDataAdminUserId === user.id ? "bg-primary/10" : ""}`}
                        onClick={() => setSelectedEmployeeDataAdminUserId(user.id)}
                        data-testid={`option-employee-data-admin-${user.id}`}
                      >
                        <div className="font-medium">{toTitleCase(user.name)}</div>
                        <div className="text-sm text-muted-foreground">
                          {user.email} {user.employeeCode && `· ${user.employeeCode}`}
                        </div>
                      </div>
                    ))}
                    {filteredEligibleForEmployeeDataAdmin.length > 10 && (
                      <div className="p-2 text-sm text-muted-foreground text-center">
                        +{filteredEligibleForEmployeeDataAdmin.length - 10} more results. Refine your search.
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
            
            {selectedEmployeeDataAdminUserId && (
              <div className="p-3 bg-primary/5 rounded-lg border border-primary/20">
                <div className="text-sm text-muted-foreground">Selected:</div>
                <div className="font-medium">
                  {toTitleCase(eligibleForEmployeeDataAdmin.find(u => u.id === selectedEmployeeDataAdminUserId)?.name)}
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddEmployeeDataAdminDialog(false)} data-testid="button-cancel-employee-data-admin">
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (selectedEmployeeDataAdminUserId) {
                  promoteToEmployeeDataAdminMutation.mutate(selectedEmployeeDataAdminUserId);
                }
              }}
              disabled={!selectedEmployeeDataAdminUserId || promoteToEmployeeDataAdminMutation.isPending}
              data-testid="button-confirm-employee-data-admin"
            >
              {promoteToEmployeeDataAdminMutation.isPending ? "Adding..." : "Add Employee Data Admin"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
