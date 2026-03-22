import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { LogOut, Users, Calendar, FileText, DollarSign, Receipt, Settings, Wrench, Mail, UserCog } from "lucide-react";
import { useLocation } from "wouter";
import { MenuCard } from "@/components/MenuCard";
import { useMemo, useEffect } from "react";

interface SessionData {
  authenticated: boolean;
  isAdmin: boolean;
  isViewOnlyAdmin?: boolean;
  isAttendanceViewAdmin?: boolean;
  isEmployeeDataAdmin?: boolean;
  user?: { id: string; name: string; email: string };
}

export default function AdminDashboardPage() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const { data: sessionData } = useQuery<SessionData>({
    queryKey: ["/api/auth/session"],
  });

  const logoutMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", "/api/admin/logout");
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/auth/session"] });
      setLocation("/admin/login");
    },
  });

  const isEmployeeDataAdmin = sessionData?.isEmployeeDataAdmin || false;

  // Redirect employee_data_admin directly to Employee Data page
  useEffect(() => {
    if (isEmployeeDataAdmin) {
      setLocation("/admin/employee-data");
    }
  }, [isEmployeeDataAdmin, setLocation]);

  const menuItems = useMemo(() => {
    const allMenuItems = [
      {
        title: "All Attendance",
        icon: Users,
        href: "/admin/attendance",
        iconColor: "bg-blue-500/10",
        restrictedRoles: [] as string[],
      },
      {
        title: "All Leave",
        icon: Calendar,
        href: "/admin/leave",
        iconColor: "bg-green-500/10",
        restrictedRoles: [],
      },
      {
        title: "All Claims",
        icon: Receipt,
        href: "/admin/claims",
        iconColor: "bg-purple-500/10",
        restrictedRoles: [],
      },
      {
        title: "Payroll Management",
        icon: DollarSign,
        href: "/admin/payroll",
        iconColor: "bg-emerald-500/10",
        restrictedRoles: [],
      },
      {
        title: "All Income Tax",
        icon: FileText,
        href: "/admin/income-tax",
        iconColor: "bg-orange-500/10",
        restrictedRoles: [],
      },
      {
        title: "Tools",
        icon: Wrench,
        href: "/admin/reports",
        iconColor: "bg-indigo-500/10",
        restrictedRoles: [],
      },
      {
        title: "Employee Data",
        icon: UserCog,
        href: "/admin/employee-data",
        iconColor: "bg-teal-500/10",
        restrictedRoles: ["employee_data_admin"],
      },
      {
        title: "Send Emails",
        icon: Mail,
        href: "/admin/emails",
        iconColor: "bg-cyan-500/10",
        restrictedRoles: [],
      },
      {
        title: "Settings",
        icon: Settings,
        href: "/admin/settings",
        iconColor: "bg-gray-500/10",
        restrictedRoles: [],
      },
    ];

    // If user is employee_data_admin, only show Employee Data menu
    if (isEmployeeDataAdmin) {
      return allMenuItems.filter(item => item.restrictedRoles.includes("employee_data_admin"));
    }

    return allMenuItems;
  }, [isEmployeeDataAdmin]);

  return (
    <div className="min-h-screen bg-muted/30 p-4 md:p-8">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold" data-testid="text-page-title">
              Admin DashBoard 2
            </h1>
            <p className="text-sm md:text-base text-muted-foreground">
              Manage HR operations and system settings
            </p>
          </div>
          <Button
            variant="outline"
            onClick={() => logoutMutation.mutate()}
            data-testid="button-logout"
          >
            <LogOut className="mr-2 h-4 w-4" />
            <span className="hidden md:inline">Logout</span>
          </Button>
        </div>

        <div className="grid grid-cols-3 gap-2 md:gap-6">
          {menuItems.map((item) => (
            <MenuCard
              key={item.title}
              title={item.title}
              icon={item.icon}
              iconColor={item.iconColor}
              onClick={() => setLocation(item.href)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
