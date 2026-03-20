import { Users, DollarSign, FileSpreadsheet, BarChart3, CreditCard, Calculator, Settings, ArrowLeft, ClipboardEdit } from "lucide-react";
import { StatCard } from "@/components/StatCard";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { toTitleCase } from "@/lib/utils";
import type { User, PayrollRecord } from "@shared/schema";

export default function HRAdminPage() {
  const [, setLocation] = useLocation();
  const { data: usersData } = useQuery<User[]>({
    queryKey: ['/api/admin/users'],
  });
  
  const { data: payrollData } = useQuery<{ records: PayrollRecord[] }>({
    queryKey: ['/api/admin/payroll/records', String(new Date().getFullYear()), null],
  });
  
  const employees = usersData?.filter(u => u.isApproved && !u.isArchived && u.role !== 'admin') || [];
  const payrollRecords = payrollData?.records || [];
  const totalPayroll = payrollRecords.reduce((sum, r) => sum + parseFloat(String(r.nett || 0)), 0) / 100;

  return (
    <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold" data-testid="text-page-title">
              Payroll Management
            </h1>
            <p className="text-sm md:text-base text-muted-foreground">
              Manage employees and process payroll
            </p>
          </div>
          <Button
            variant="outline"
            onClick={() => setLocation("/admin/dashboard")}
            data-testid="button-back"
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Dashboard
          </Button>
        </div>

      <div className="grid gap-4 md:grid-cols-3">
        <StatCard
          title="Total Employees"
          value={String(employees.length)}
          icon={Users}
        />
        <StatCard
          title="Payroll Records"
          value={String(payrollRecords.length)}
          icon={DollarSign}
        />
        <StatCard
          title="Total Payroll"
          value={`$${totalPayroll.toLocaleString()}`}
          icon={DollarSign}
        />
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span className="flex items-center gap-2">
                <Users className="h-5 w-5" />
                Employee Directory
              </span>
              <Link href="/admin/employees">
                <Button size="sm" variant="outline" data-testid="button-view-employees">
                  View All
                </Button>
              </Link>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {employees.slice(0, 5).map((employee) => (
                <div
                  key={employee.id}
                  className="flex items-center justify-between p-3 rounded-md bg-muted/50"
                  data-testid={`row-employee-${employee.id}`}
                >
                  <div className="flex items-center gap-3">
                    <Avatar className="h-10 w-10">
                      <AvatarFallback>
                        {employee.name
                          ?.split(" ")
                          .map((n: string) => n[0])
                          .join("") || "?"}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <p className="font-medium" data-testid={`text-employee-name-${employee.id}`}>
                        {toTitleCase(employee.name)}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {employee.designation || "Staff"} • {employee.department || "Unassigned"}
                      </p>
                    </div>
                  </div>
                  <Badge variant="default" data-testid={`badge-employee-status-${employee.id}`}>
                    Active
                  </Badge>
                </div>
              ))}
              {employees.length === 0 && (
                <p className="text-muted-foreground text-center py-4">No employees found</p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <DollarSign className="h-5 w-5" />
              Payroll Management
            </CardTitle>
            <CardDescription>
              Import payroll data and view reports
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">Current Year</p>
              <p className="text-lg font-semibold">{new Date().getFullYear()}</p>
            </div>
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">Records Imported</p>
              <Badge variant="secondary">{payrollRecords.length} records</Badge>
            </div>
            <div className="flex flex-col gap-2 pt-4">
              <Link href="/admin/payroll/import">
                <Button className="w-full" data-testid="button-import-payroll">
                  <FileSpreadsheet className="mr-2 h-4 w-4" />
                  Import Payroll Data
                </Button>
              </Link>
              <Link href="/admin/payroll/reports">
                <Button variant="outline" className="w-full" data-testid="button-view-reports">
                  <BarChart3 className="mr-2 h-4 w-4" />
                  View Payroll Reports
                </Button>
              </Link>
              <Link href="/admin/payroll/loans">
                <Button variant="outline" className="w-full" data-testid="button-manage-loans">
                  <CreditCard className="mr-2 h-4 w-4" />
                  Manage Loans
                </Button>
              </Link>
              <Link href="/admin/payroll/generate">
                <Button variant="outline" className="w-full" data-testid="button-generate-payroll">
                  <Calculator className="mr-2 h-4 w-4" />
                  Generate from Attendance
                </Button>
              </Link>
              <Link href="/admin/payroll/adjustments">
                <Button variant="outline" className="w-full" data-testid="button-payroll-adjustments">
                  <ClipboardEdit className="mr-2 h-4 w-4" />
                  Payroll Adjustments
                </Button>
              </Link>
              <Link href="/admin/payroll/employees">
                <Button variant="outline" className="w-full" data-testid="button-employee-payroll">
                  <Settings className="mr-2 h-4 w-4" />
                  Employee Payroll Settings
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
