import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowLeft, Download, Printer, FileText, Users, Calendar, Clock, MapPin } from "lucide-react";
import { useLocation } from "wouter";
import { useState, useEffect } from "react";
import { format, startOfMonth, endOfMonth, subMonths } from "date-fns";
import type { User, AttendanceRecord } from "@shared/schema";
import { toTitleCase } from "@/lib/utils";

// Address cache to avoid repeated API calls
const addressCache: Record<string, string> = {};

async function reverseGeocode(lat: string, lng: string): Promise<string> {
  const cacheKey = `${lat},${lng}`;
  if (addressCache[cacheKey]) {
    return addressCache[cacheKey];
  }
  
  try {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`,
      {
        headers: {
          'Accept-Language': 'en',
          'User-Agent': 'NexaHR-HRMS/1.0'
        }
      }
    );
    
    if (!response.ok) {
      throw new Error('Geocoding failed');
    }
    
    const data = await response.json();
    
    // Build a short address from components
    const address = data.address || {};
    const parts: string[] = [];
    
    // Add building/road info
    if (address.road || address.street) {
      parts.push(address.road || address.street);
    }
    if (address.suburb || address.neighbourhood) {
      parts.push(address.suburb || address.neighbourhood);
    }
    if (address.city || address.town || address.village) {
      parts.push(address.city || address.town || address.village);
    }
    
    const shortAddress = parts.length > 0 ? parts.join(', ') : data.display_name?.split(',').slice(0, 3).join(',') || 'Unknown location';
    addressCache[cacheKey] = shortAddress;
    return shortAddress;
  } catch (error) {
    console.error('Reverse geocoding error:', error);
    const fallback = `${parseFloat(lat).toFixed(4)}, ${parseFloat(lng).toFixed(4)}`;
    addressCache[cacheKey] = fallback;
    return fallback;
  }
}

interface AttendanceWithUser extends AttendanceRecord {
  user?: User;
}

export default function AdminReportsPage() {
  const [, setLocation] = useLocation();
  const [reportType, setReportType] = useState<string>("attendance");
  const [startDate, setStartDate] = useState(format(startOfMonth(new Date()), "yyyy-MM-dd"));
  const [endDate, setEndDate] = useState(format(endOfMonth(new Date()), "yyyy-MM-dd"));
  const [addresses, setAddresses] = useState<Record<string, string>>({});

  const { data: usersData, isLoading: usersLoading } = useQuery<User[]>({
    queryKey: ["/api/admin/users"],
  });

  const { data: attendanceData, isLoading: attendanceLoading, error: attendanceError } = useQuery<{ records: AttendanceRecord[] }>({
    queryKey: ["/api/admin/attendance/records", startDate, endDate],
    queryFn: async () => {
      const response = await fetch(`/api/admin/attendance/records?startDate=${startDate}&endDate=${endDate}`, {
        credentials: 'include',
      });
      if (!response.ok) {
        throw new Error('Failed to fetch attendance records');
      }
      return response.json();
    },
  });

  const users = (usersData || []).filter(u => !u.isArchived);
  const attendanceRecords = attendanceData?.records || [];

  // Fetch addresses for clock-in/out locations
  useEffect(() => {
    const fetchAddresses = async () => {
      for (const record of attendanceRecords) {
        // Fetch clock-in address
        if (record.latitude && record.longitude) {
          const key = `in-${record.id}`;
          if (!addresses[key]) {
            const address = await reverseGeocode(record.latitude, record.longitude);
            setAddresses(prev => ({ ...prev, [key]: address }));
          }
        }
        // Fetch clock-out address
        if (record.clockOutLatitude && record.clockOutLongitude) {
          const key = `out-${record.id}`;
          if (!addresses[key]) {
            const address = await reverseGeocode(record.clockOutLatitude, record.clockOutLongitude);
            setAddresses(prev => ({ ...prev, [key]: address }));
          }
        }
      }
    };
    
    if (reportType === "detailed-attendance" && attendanceRecords.length > 0) {
      fetchAddresses();
    }
  }, [attendanceRecords, reportType]);

  const getUserById = (userId: string | number): User | undefined => {
    const userIdStr = String(userId);
    return users.find(u => String(u.id) === userIdStr);
  };

  const calculateHours = (clockIn: string | Date, clockOut: string | Date | null): number => {
    if (!clockOut) return 0;
    const start = new Date(clockIn);
    const end = new Date(clockOut);
    return (end.getTime() - start.getTime()) / (1000 * 60 * 60);
  };

  const getAttendanceSummary = () => {
    const summary: Record<string, { totalHours: number; daysPresent: number; user: User }> = {};
    
    for (const record of attendanceRecords) {
      const user = getUserById(record.userId);
      if (!user) continue;
      
      if (!summary[record.userId]) {
        summary[record.userId] = { totalHours: 0, daysPresent: 0, user };
      }
      
      summary[record.userId].daysPresent++;
      summary[record.userId].totalHours += calculateHours(record.clockInTime, record.clockOutTime);
    }
    
    return Object.values(summary);
  };

  const getEmployeeReport = () => {
    return users.map(user => ({
      employeeCode: user.employeeCode || "",
      name: toTitleCase(user.name),
      email: user.email,
      department: user.department || "",
      designation: user.designation || "",
      section: user.section || "",
      joinDate: user.joinDate || "",
      status: user.isApproved ? "Active" : "Pending",
    }));
  };

  const exportToCSV = () => {
    let csvContent = "";
    let filename = "";

    if (reportType === "attendance") {
      const summary = getAttendanceSummary();
      csvContent = "Employee Code,Name,Department,Designation,Days Present,Total Hours\n";
      summary.forEach(s => {
        csvContent += `"${s.user.employeeCode || ""}","${toTitleCase(s.user.name)}","${s.user.department || ""}","${s.user.designation || ""}",${s.daysPresent},${s.totalHours.toFixed(2)}\n`;
      });
      filename = `attendance_report_${startDate}_${endDate}.csv`;
    } else if (reportType === "employees") {
      const employees = getEmployeeReport();
      csvContent = "Employee Code,Name,Email,Department,Designation,Section,Join Date,Status\n";
      employees.forEach(e => {
        csvContent += `"${e.employeeCode}","${toTitleCase(e.name)}","${e.email}","${e.department}","${e.designation}","${e.section}","${e.joinDate}","${e.status}"\n`;
      });
      filename = `employee_report_${format(new Date(), "yyyy-MM-dd")}.csv`;
    } else if (reportType === "detailed-attendance") {
      csvContent = "Date,Employee Code,Name,Department,Clock In,Clock In Address,Clock Out,Clock Out Address,Hours\n";
      attendanceRecords.forEach(record => {
        const user = getUserById(record.userId);
        if (user) {
          const hours = calculateHours(record.clockInTime, record.clockOutTime);
          const clockInAddress = addresses[`in-${record.id}`] || (record.latitude && record.longitude ? `${record.latitude}, ${record.longitude}` : "");
          const clockOutAddress = addresses[`out-${record.id}`] || (record.clockOutLatitude && record.clockOutLongitude ? `${record.clockOutLatitude}, ${record.clockOutLongitude}` : "");
          csvContent += `"${record.date}","${user.employeeCode || ""}","${toTitleCase(user.name)}","${user.department || ""}","${format(new Date(record.clockInTime), "HH:mm")}","${clockInAddress}","${record.clockOutTime ? format(new Date(record.clockOutTime), "HH:mm") : "N/A"}","${clockOutAddress}",${hours.toFixed(2)}\n`;
        }
      });
      filename = `detailed_attendance_${startDate}_${endDate}.csv`;
    }

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
  };

  const handlePrint = () => {
    window.print();
  };

  const renderReportContent = () => {
    if (reportType === "attendance") {
      const summary = getAttendanceSummary();
      return (
        <div className="space-y-4 print:space-y-2">
          <h2 className="text-lg font-semibold print:text-base">
            Attendance Summary Report ({startDate} to {endDate})
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse border print:text-sm" data-testid="table-attendance-summary">
              <thead>
                <tr className="bg-muted">
                  <th className="border p-2 text-left">Employee Code</th>
                  <th className="border p-2 text-left">Name</th>
                  <th className="border p-2 text-left">Department</th>
                  <th className="border p-2 text-left">Designation</th>
                  <th className="border p-2 text-center">Days Present</th>
                  <th className="border p-2 text-center">Total Hours</th>
                </tr>
              </thead>
              <tbody>
                {[...summary].sort((a, b) => (a.user.name || "").localeCompare(b.user.name || "")).map(s => (
                  <tr key={s.user.id} data-testid={`row-attendance-${s.user.id}`}>
                    <td className="border p-2">{s.user.employeeCode || "-"}</td>
                    <td className="border p-2">{toTitleCase(s.user.name)}</td>
                    <td className="border p-2">{s.user.department || "-"}</td>
                    <td className="border p-2">{s.user.designation || "-"}</td>
                    <td className="border p-2 text-center">{s.daysPresent}</td>
                    <td className="border p-2 text-center">{s.totalHours.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      );
    } else if (reportType === "employees") {
      const employees = getEmployeeReport();
      return (
        <div className="space-y-4 print:space-y-2">
          <h2 className="text-lg font-semibold print:text-base">Employee Directory Report</h2>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse border print:text-sm" data-testid="table-employee-report">
              <thead>
                <tr className="bg-muted">
                  <th className="border p-2 text-left">Employee Code</th>
                  <th className="border p-2 text-left">Name</th>
                  <th className="border p-2 text-left">Email</th>
                  <th className="border p-2 text-left">Department</th>
                  <th className="border p-2 text-left">Designation</th>
                  <th className="border p-2 text-left">Section</th>
                  <th className="border p-2 text-left">Join Date</th>
                  <th className="border p-2 text-center">Status</th>
                </tr>
              </thead>
              <tbody>
                {[...employees].sort((a, b) => (a.name || "").localeCompare(b.name || "")).map((e, index) => (
                  <tr key={index} data-testid={`row-employee-${index}`}>
                    <td className="border p-2">{e.employeeCode || "-"}</td>
                    <td className="border p-2">{toTitleCase(e.name)}</td>
                    <td className="border p-2">{e.email}</td>
                    <td className="border p-2">{e.department || "-"}</td>
                    <td className="border p-2">{e.designation || "-"}</td>
                    <td className="border p-2">{e.section || "-"}</td>
                    <td className="border p-2">{e.joinDate || "-"}</td>
                    <td className="border p-2 text-center">
                      <span className={`px-2 py-1 rounded text-xs ${e.status === "Active" ? "bg-green-100 text-green-800" : "bg-yellow-100 text-yellow-800"}`}>
                        {e.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      );
    } else if (reportType === "detailed-attendance") {
      return (
        <div className="space-y-4 print:space-y-2">
          <h2 className="text-lg font-semibold print:text-base">
            Detailed Attendance Report ({startDate} to {endDate})
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse border print:text-sm" data-testid="table-detailed-attendance">
              <thead>
                <tr className="bg-muted">
                  <th className="border p-2 text-left">Date</th>
                  <th className="border p-2 text-left">Employee Code</th>
                  <th className="border p-2 text-left">Name</th>
                  <th className="border p-2 text-left">Department</th>
                  <th className="border p-2 text-center">Clock In</th>
                  <th className="border p-2 text-left">Clock In Address</th>
                  <th className="border p-2 text-center">Clock Out</th>
                  <th className="border p-2 text-left">Clock Out Address</th>
                  <th className="border p-2 text-center">Hours</th>
                </tr>
              </thead>
              <tbody>
                {[...attendanceRecords].sort((a, b) => {
                  const userA = getUserById(a.userId);
                  const userB = getUserById(b.userId);
                  return (userA?.name || "").localeCompare(userB?.name || "");
                }).map(record => {
                  const user = getUserById(record.userId);
                  const hours = calculateHours(record.clockInTime, record.clockOutTime);
                  const clockInAddress = addresses[`in-${record.id}`];
                  const clockOutAddress = addresses[`out-${record.id}`];
                  return (
                    <tr key={record.id} data-testid={`row-detail-${record.id}`}>
                      <td className="border p-2">{record.date}</td>
                      <td className="border p-2">{user?.employeeCode || "-"}</td>
                      <td className="border p-2">{toTitleCase(user?.name) || `User ${record.userId}`}</td>
                      <td className="border p-2">{user?.department || "-"}</td>
                      <td className="border p-2 text-center">{format(new Date(record.clockInTime), "HH:mm")}</td>
                      <td className="border p-2 text-sm">
                        {record.latitude && record.longitude ? (
                          <div className="flex items-start gap-1">
                            <MapPin className="h-3 w-3 text-muted-foreground mt-0.5 flex-shrink-0" />
                            <span className="text-muted-foreground">
                              {clockInAddress || "Loading..."}
                            </span>
                          </div>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </td>
                      <td className="border p-2 text-center">{record.clockOutTime ? format(new Date(record.clockOutTime), "HH:mm") : "N/A"}</td>
                      <td className="border p-2 text-sm">
                        {record.clockOutLatitude && record.clockOutLongitude ? (
                          <div className="flex items-start gap-1">
                            <MapPin className="h-3 w-3 text-muted-foreground mt-0.5 flex-shrink-0" />
                            <span className="text-muted-foreground">
                              {clockOutAddress || "Loading..."}
                            </span>
                          </div>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </td>
                      <td className="border p-2 text-center">{hours.toFixed(2)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      );
    }
    return null;
  };

  const isLoading = usersLoading || attendanceLoading;

  return (
    <div className="min-h-screen bg-muted/30 p-4 md:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex items-center gap-4 flex-wrap print:hidden">
          <div className="flex-1">
            <h1 className="text-2xl md:text-3xl font-bold" data-testid="text-page-title">
              Reports
            </h1>
            <p className="text-sm md:text-base text-muted-foreground">
              Generate and export HR reports
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

        <Card className="print:shadow-none print:border-none">
          <CardHeader className="print:hidden">
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Report Configuration
            </CardTitle>
          </CardHeader>
          <CardContent className="print:p-0">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6 print:hidden">
              <div className="space-y-2">
                <Label>Report Type</Label>
                <Select value={reportType} onValueChange={setReportType}>
                  <SelectTrigger data-testid="select-report-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="attendance">Attendance Summary</SelectItem>
                    <SelectItem value="detailed-attendance">Detailed Attendance</SelectItem>
                    <SelectItem value="employees">Employee Directory</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {reportType !== "employees" && (
                <>
                  <div className="space-y-2">
                    <Label>Start Date</Label>
                    <Input
                      type="date"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      data-testid="input-start-date"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>End Date</Label>
                    <Input
                      type="date"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      data-testid="input-end-date"
                    />
                  </div>
                </>
              )}

              <div className="flex items-end gap-2">
                <Button onClick={exportToCSV} className="flex-1" data-testid="button-export-csv">
                  <Download className="mr-2 h-4 w-4" />
                  Export CSV
                </Button>
                <Button variant="outline" onClick={handlePrint} data-testid="button-print">
                  <Printer className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
              </div>
            ) : (
              renderReportContent()
            )}
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 print:hidden">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-blue-500/10 rounded-lg">
                  <Users className="h-6 w-6 text-blue-500" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Total Employees</p>
                  <p className="text-2xl font-bold" data-testid="text-total-employees">{users.length}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-green-500/10 rounded-lg">
                  <Calendar className="h-6 w-6 text-green-500" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Attendance Records</p>
                  <p className="text-2xl font-bold" data-testid="text-total-records">{attendanceRecords.length}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-purple-500/10 rounded-lg">
                  <Clock className="h-6 w-6 text-purple-500" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Total Hours (Period)</p>
                  <p className="text-2xl font-bold" data-testid="text-total-hours">
                    {getAttendanceSummary().reduce((sum, s) => sum + s.totalHours, 0).toFixed(1)}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <style>{`
        @media print {
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .print\\:hidden { display: none !important; }
        }
      `}</style>
    </div>
  );
}
