import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toTitleCase } from "@/lib/utils";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  ArrowLeft, AlertOctagon, AlertTriangle, Hourglass, Users, ArrowRight,
  CheckCircle, XCircle, MoreVertical, Plus,
} from "lucide-react";
import { Link } from "wouter";
import type { User, LeaveBalance, LeaveApplication, LeaveTypeRow } from "@shared/schema";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

// ─── Helpers ────────────────────────────────────────────────────────────
function isoToday(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function timeAgo(date: string | Date): string {
  const then = new Date(date).getTime();
  const ms = Date.now() - then;
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function formatDateShort(iso: string): string {
  return new Date(iso).toLocaleDateString("en-SG", { day: "numeric", month: "short" });
}

// ─── Page ───────────────────────────────────────────────────────────────
export default function AdminLeavePage() {
  const { toast } = useToast();

  // Dialog state
  const [balanceDialogOpen, setBalanceDialogOpen] = useState(false);
  const [reviewDialogOpen, setReviewDialogOpen] = useState(false);
  const [pendingQueueOpen, setPendingQueueOpen] = useState(false);

  // Set Balance form state
  const [selectedUserId, setSelectedUserId] = useState("");
  const [leaveType, setLeaveType] = useState("");
  const [totalDays, setTotalDays] = useState("");

  // Review form state
  const [selectedApplication, setSelectedApplication] = useState<LeaveApplication | null>(null);
  const [reviewComments, setReviewComments] = useState("");
  const [approvedDays, setApprovedDays] = useState<string>("");

  // Prefill approvedDays whenever review modal opens for a new application
  useEffect(() => {
    if (selectedApplication) setApprovedDays(String(selectedApplication.totalDays));
    else setApprovedDays("");
  }, [selectedApplication]);

  // ─── Data ────────────────────────────────────────────────────────────
  const { data: usersData } = useQuery<User[] | { users: User[] }>({
    queryKey: ["/api/admin/users"],
  });
  const { data: balancesData, isLoading: balancesLoading } = useQuery<{ balances: LeaveBalance[] }>({
    queryKey: ["/api/admin/leave/balances"],
  });
  const { data: applicationsData, isLoading: applicationsLoading } = useQuery<{ applications: LeaveApplication[] }>({
    queryKey: ["/api/admin/leave/applications"],
  });
  const { data: leaveTypesData } = useQuery<{ leaveTypes: LeaveTypeRow[] }>({
    queryKey: ["/api/leave-types"],
  });
  const { data: sessionData } = useQuery<{ authenticated: boolean; isAdmin: boolean; isViewOnlyAdmin?: boolean }>({
    queryKey: ["/api/auth/session"],
  });
  const isViewOnlyAdmin = sessionData?.isViewOnlyAdmin === true;

  // Server returns bare array; older code expected { users: [] } — accept either shape.
  const allUsers: User[] = Array.isArray(usersData) ? usersData : (usersData?.users || []);
  // Filtered list for selects / snapshot rows (excludes admins, archived, unapproved).
  // For NAME LOOKUPS use `allUsers` instead so applicants are never shown as "Unknown".
  const users = allUsers.filter(u => u.isApproved && !u.isArchived && !u.role?.includes("admin"));
  const balances = balancesData?.balances || [];
  const applications = applicationsData?.applications || [];
  const leaveTypeOptions = leaveTypesData?.leaveTypes || [];

  // ─── Mutations ───────────────────────────────────────────────────────
  const setBalanceMutation = useMutation({
    mutationFn: async () => apiRequest("POST", "/api/admin/leave/balances", {
      userId: selectedUserId,
      leaveType,
      totalDays: parseFloat(totalDays),
    }),
    onSuccess: () => {
      toast({ title: "Leave balance updated" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/leave/balances"] });
      setBalanceDialogOpen(false);
      setSelectedUserId(""); setLeaveType(""); setTotalDays("");
    },
    onError: (err: Error) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  const reviewMutation = useMutation({
    mutationFn: async ({ applicationId, status, approvedDays }: { applicationId: string; status: "approved" | "rejected"; approvedDays?: number }) =>
      apiRequest("PATCH", `/api/admin/leave/applications/${applicationId}`, {
        status,
        reviewComments: reviewComments || undefined,
        approvedDays,
      }),
    onSuccess: () => {
      toast({ title: "Leave application reviewed" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/leave/applications"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/leave/balances"] });
      setReviewDialogOpen(false);
      setSelectedApplication(null);
      setReviewComments("");
    },
    onError: (err: Error) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  const handleSetBalance = () => {
    if (!selectedUserId || !leaveType || !totalDays) {
      toast({ title: "Fill all fields", variant: "destructive" });
      return;
    }
    setBalanceMutation.mutate();
  };

  const handleReviewApplication = (status: "approved" | "rejected") => {
    if (!selectedApplication) return;
    if (status === "approved") {
      const days = parseFloat(approvedDays);
      if (Number.isNaN(days) || days < 0) {
        toast({ title: "Invalid approved days", description: "Enter a non-negative number.", variant: "destructive" });
        return;
      }
      reviewMutation.mutate({ applicationId: selectedApplication.id, status, approvedDays: days });
    } else {
      reviewMutation.mutate({ applicationId: selectedApplication.id, status });
    }
  };

  // ─── Helpers ─────────────────────────────────────────────────────────
  const getUserName = (userId: string) => {
    const u = allUsers.find(x => x.id === userId);
    return toTitleCase(u?.name) || u?.username || "Unknown";
  };

  const openReview = (app: LeaveApplication) => {
    setSelectedApplication(app);
    setReviewDialogOpen(true);
  };

  // ─── Derived KPIs ────────────────────────────────────────────────────
  const today = isoToday();

  const pendingApplications = applications.filter(a => a.status === "pending");
  const onLeaveTodayApps = applications.filter(a =>
    a.status === "approved" && a.startDate <= today && a.endDate >= today
  );
  const lowBalances = balances
    .map(b => {
      const remaining = parseFloat(b.balance || "0");
      const eligible = parseFloat(b.eligible || "0");
      const pct = eligible > 0 ? (remaining / eligible) * 100 : 100;
      return { ...b, remaining, eligible, pct, isOverdrawn: remaining < 0 };
    })
    .filter(b => b.pct <= 20)
    .sort((a, b) => a.remaining - b.remaining);

  // ─── Urgent Action Queue ─────────────────────────────────────────────
  type UrgentItem = {
    id: string;
    severity: "high" | "med";
    title: string;
    subtitle: string;
    primaryLabel: string;
    onPrimary: () => void;
    secondaryLabel?: string;
    onSecondary?: () => void;
  };

  const urgentItems: UrgentItem[] = [];
  // Pending applications, oldest first
  [...pendingApplications]
    .sort((a, b) => new Date(a.createdAt as any).getTime() - new Date(b.createdAt as any).getTime())
    .slice(0, 3)
    .forEach(app => {
      urgentItems.push({
        id: `app-${app.id}`,
        severity: "high",
        title: `${getUserName(app.userId)} — ${app.leaveType} ${app.totalDays}d`,
        subtitle: `${formatDateShort(app.startDate)} → ${formatDateShort(app.endDate)} · Submitted ${timeAgo(app.createdAt as any)}`,
        primaryLabel: "Review",
        onPrimary: () => openReview(app),
      });
    });
  // Overdrawn balances
  lowBalances
    .filter(b => b.isOverdrawn)
    .slice(0, 3)
    .forEach(b => {
      urgentItems.push({
        id: `bal-${b.id}`,
        severity: "high",
        title: `${toTitleCase(b.employeeName) || getUserName(b.userId)} ${b.leaveType} balance < 0`,
        subtitle: `Overdrafted · Balance: ${b.remaining.toFixed(1)} days`,
        primaryLabel: "Adjust",
        onPrimary: () => {
          setSelectedUserId(b.userId);
          setLeaveType(b.leaveType);
          setTotalDays(String(b.eligible || ""));
          setBalanceDialogOpen(true);
        },
      });
    });
  // Low-but-not-overdrawn balances
  lowBalances
    .filter(b => !b.isOverdrawn)
    .slice(0, 2)
    .forEach(b => {
      urgentItems.push({
        id: `low-${b.id}`,
        severity: "med",
        title: `${toTitleCase(b.employeeName) || getUserName(b.userId)} ${b.leaveType} low`,
        subtitle: `${b.remaining.toFixed(1)} of ${b.eligible.toFixed(1)} days remaining (${Math.round(b.pct)}%)`,
        primaryLabel: "View",
        onPrimary: () => {
          setSelectedUserId(b.userId);
          setLeaveType(b.leaveType);
          setTotalDays(String(b.eligible || ""));
          setBalanceDialogOpen(true);
        },
      });
    });

  // ─── Team Snapshot table data ────────────────────────────────────────
  // For each employee: AL balance, MC balance, current status, next leave
  type SnapshotRow = {
    user: User;
    al: string;
    alOverdrawn: boolean;
    alLow: boolean;
    mc: string;
    status: { label: string; tone: "active" | "on_leave" | "archived" };
    nextLeave: string;
  };

  const snapshotRows: SnapshotRow[] = users.map(u => {
    const userBalances = balances.filter(b => b.userId === u.id);
    const alRow = userBalances.find(b => b.leaveType === "AL");
    const mcRow = userBalances.find(b => b.leaveType === "MC");
    const alNum = alRow ? parseFloat(alRow.balance || "0") : NaN;
    const alElig = alRow ? parseFloat(alRow.eligible || "0") : 0;
    const al = alRow ? `${alNum.toFixed(1)} Days` : "—";
    const mc = mcRow ? `${parseFloat(mcRow.balance || "0").toFixed(1)} Days` : "—";

    const onLeave = onLeaveTodayApps.find(a => a.userId === u.id);
    const status = onLeave
      ? { label: `On Leave (${onLeave.leaveType})`, tone: "on_leave" as const }
      : { label: "Active", tone: "active" as const };

    const future = applications
      .filter(a => a.userId === u.id && a.status === "approved" && a.startDate > today)
      .sort((a, b) => a.startDate.localeCompare(b.startDate))[0];
    const nextLeave = future
      ? `${formatDateShort(future.startDate)} (${future.totalDays}d)`
      : onLeave
        ? `Returns ${formatDateShort(onLeave.endDate)}`
        : "None Scheduled";

    return {
      user: u,
      al,
      alOverdrawn: !isNaN(alNum) && alNum < 0,
      alLow: !isNaN(alNum) && alElig > 0 && alNum / alElig <= 0.2 && alNum >= 0,
      mc,
      status,
      nextLeave,
    };
  });

  const [snapshotPage, setSnapshotPage] = useState(0);
  const pageSize = 10;
  const totalSnapshotPages = Math.max(1, Math.ceil(snapshotRows.length / pageSize));
  const visibleRows = snapshotRows.slice(snapshotPage * pageSize, (snapshotPage + 1) * pageSize);

  // ─── Render ──────────────────────────────────────────────────────────
  return (
    <div className="p-4 md:p-6 space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-semibold mb-1" data-testid="text-admin-leave-title">
            Leave Console
          </h1>
          <p className="text-sm text-muted-foreground">Operations overview for the HR admin</p>
        </div>
        <div className="flex items-center gap-2">
          <Dialog open={balanceDialogOpen} onOpenChange={setBalanceDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" data-testid="button-adjust-balance">
                <Plus className="h-4 w-4 mr-2" />
                Adjust Balance
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Set Employee Leave Balance</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="user-select">Employee</Label>
                  <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                    <SelectTrigger id="user-select" data-testid="select-user">
                      <SelectValue placeholder="Select employee" />
                    </SelectTrigger>
                    <SelectContent>
                      {users.map((u) => (
                        <SelectItem key={u.id} value={u.id}>
                          {toTitleCase(u.name) || u.username} ({u.email})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="leave-type">Leave Type</Label>
                  <Select value={leaveType} onValueChange={setLeaveType}>
                    <SelectTrigger id="leave-type" data-testid="select-leave-type">
                      <SelectValue placeholder="Select leave type" />
                    </SelectTrigger>
                    <SelectContent>
                      {leaveTypeOptions.map((lt) => (
                        <SelectItem key={lt.id} value={lt.code}>
                          {lt.label} ({lt.code})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="total-days">Total Days (eligible)</Label>
                  <Input id="total-days" type="number" min="0" step="0.5" placeholder="14"
                    value={totalDays} onChange={(e) => setTotalDays(e.target.value)} data-testid="input-total-days" />
                </div>
                <Button onClick={handleSetBalance} disabled={setBalanceMutation.isPending || isViewOnlyAdmin}
                  data-testid="button-submit-balance" className="w-full">
                  {setBalanceMutation.isPending ? "Saving…" : "Save Balance"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
          <Link href="/admin/dashboard">
            <Button variant="ghost" data-testid="button-back-dashboard">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Dashboard
            </Button>
          </Link>
        </div>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <KpiCard
          tone="destructive"
          label="Pending Approvals"
          value={pendingApplications.length}
          icon={<AlertOctagon className="h-5 w-5" />}
          ctaLabel="Review"
          onCta={() => {
            if (pendingApplications.length === 0) {
              toast({ title: "No pending applications" });
            } else {
              setPendingQueueOpen(true);
            }
          }}
          loading={applicationsLoading}
        />
        <KpiCard
          tone="warning"
          label="Low Balances"
          value={lowBalances.length}
          icon={<AlertTriangle className="h-5 w-5" />}
          ctaLabel="View All"
          onCta={() => {
            document.getElementById("team-snapshot")?.scrollIntoView({ behavior: "smooth" });
          }}
          loading={balancesLoading}
        />
        <KpiCard
          tone="neutral"
          label="Expiring Carry Forward"
          value="—"
          subtitle="Coming soon"
          icon={<Hourglass className="h-5 w-5" />}
          ctaLabel=""
          onCta={() => { }}
          loading={false}
        />
        <KpiCard
          tone="primary"
          label="On Leave Today"
          value={onLeaveTodayApps.length}
          icon={<Users className="h-5 w-5" />}
          ctaLabel="See List"
          onCta={() => {
            document.getElementById("team-snapshot")?.scrollIntoView({ behavior: "smooth" });
          }}
          loading={applicationsLoading}
        />
      </div>

      {/* Mid section: Urgent Queue + Heatmap placeholder */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
        {/* Urgent Action Queue */}
        <Card className="lg:col-span-7">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
            <CardTitle className="text-lg">Urgent Action Queue</CardTitle>
            <Badge variant="destructive">
              {urgentItems.filter(i => i.severity === "high").length} High Priority
            </Badge>
          </CardHeader>
          <CardContent className="p-0">
            {applicationsLoading || balancesLoading ? (
              <div className="p-4 space-y-3">
                {[1, 2, 3].map(i => <Skeleton key={i} className="h-14 w-full" />)}
              </div>
            ) : urgentItems.length === 0 ? (
              <div className="py-12 text-center text-sm text-muted-foreground">
                Nothing urgent right now — well done.
              </div>
            ) : (
              <div className="divide-y">
                {urgentItems.map(item => (
                  <div key={item.id} className="px-4 py-3 flex items-center justify-between gap-3 hover:bg-muted/40 transition-colors">
                    <div className="flex items-center gap-3 min-w-0">
                      <span className={`h-2 w-2 rounded-full shrink-0 ${item.severity === "high" ? "bg-destructive" : "bg-amber-500"}`} />
                      <div className="min-w-0">
                        <p className="text-sm font-semibold truncate">{item.title}</p>
                        <p className="text-xs text-muted-foreground truncate">{item.subtitle}</p>
                      </div>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      {item.secondaryLabel && (
                        <Button size="sm" variant="outline" onClick={item.onSecondary}>
                          {item.secondaryLabel}
                        </Button>
                      )}
                      <Button size="sm" onClick={item.onPrimary} data-testid={`button-urgent-${item.id}`}>
                        {item.primaryLabel}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Staffing Risk placeholder */}
        <Card className="lg:col-span-5">
          <CardHeader>
            <CardTitle className="text-lg">Staffing Risk Heatmap</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center gap-2">
            <Hourglass className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm font-medium">Coming soon</p>
            <p className="text-xs text-muted-foreground max-w-xs">
              Needs department data on each employee. Once <code>users.department</code> is populated, this panel will show weekly leave coverage by team.
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Team Snapshot table */}
      <Card id="team-snapshot">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
          <CardTitle className="text-lg">Team Snapshot</CardTitle>
          <p className="text-xs text-muted-foreground">
            Showing {visibleRows.length === 0 ? 0 : snapshotPage * pageSize + 1}–{snapshotPage * pageSize + visibleRows.length} of {snapshotRows.length}
          </p>
        </CardHeader>
        <CardContent className="p-0">
          {balancesLoading ? (
            <div className="p-4 space-y-3">
              {[1, 2, 3].map(i => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead className="text-right">AL Balance</TableHead>
                  <TableHead className="text-right">MC Balance</TableHead>
                  <TableHead>Current Status</TableHead>
                  <TableHead>Next Leave</TableHead>
                  <TableHead className="w-10"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleRows.map(r => (
                  <TableRow key={r.user.id} className="group">
                    <TableCell>
                      <div>
                        <p className="font-medium text-sm">{toTitleCase(r.user.name) || r.user.username}</p>
                        <p className="text-xs text-muted-foreground">{r.user.email}</p>
                      </div>
                    </TableCell>
                    <TableCell className={`text-right font-medium ${r.alOverdrawn ? "text-destructive" : r.alLow ? "text-amber-600" : ""}`}>
                      {r.al}
                    </TableCell>
                    <TableCell className="text-right">{r.mc}</TableCell>
                    <TableCell>
                      {r.status.tone === "on_leave" ? (
                        <Badge variant="outline">{r.status.label}</Badge>
                      ) : (
                        <Badge>{r.status.label}</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{r.nextLeave}</TableCell>
                    <TableCell className="text-right opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button variant="ghost" size="icon" onClick={() => {
                        setSelectedUserId(r.user.id);
                        setBalanceDialogOpen(true);
                      }}>
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {visibleRows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-12">
                      No employees to display.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
        {snapshotRows.length > pageSize && (
          <div className="px-4 py-3 border-t flex items-center justify-end gap-2">
            <Button size="sm" variant="outline" disabled={snapshotPage === 0}
              onClick={() => setSnapshotPage(p => Math.max(0, p - 1))}>
              Prev
            </Button>
            <Button size="sm" variant="outline" disabled={snapshotPage >= totalSnapshotPages - 1}
              onClick={() => setSnapshotPage(p => Math.min(totalSnapshotPages - 1, p + 1))}>
              Next
            </Button>
          </div>
        )}
      </Card>

      {/* ─── Pending Queue Dialog ─── */}
      <Dialog open={pendingQueueOpen} onOpenChange={setPendingQueueOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              Pending Leave Applications ({pendingApplications.length})
            </DialogTitle>
          </DialogHeader>
          {pendingApplications.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              No pending applications.
            </div>
          ) : (
            <div className="divide-y">
              {[...pendingApplications]
                .sort((a, b) => new Date(a.createdAt as any).getTime() - new Date(b.createdAt as any).getTime())
                .map(app => (
                  <div
                    key={app.id}
                    className="py-3 flex items-center justify-between gap-3"
                    data-testid={`queue-row-${app.id}`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold truncate">
                          {getUserName(app.userId)}
                        </p>
                        <Badge variant="secondary">{app.leaveType}</Badge>
                        {app.leaveType === "MC" && app.submissionTiming && (
                          <Badge variant="outline">
                            {app.submissionTiming === "pre_event" ? "Planned" : "Post-event"}
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {new Date(app.startDate).toLocaleDateString("en-SG", { day: "numeric", month: "short" })}
                        {" – "}
                        {new Date(app.endDate).toLocaleDateString("en-SG", { day: "numeric", month: "short", year: "numeric" })}
                        {" · "}
                        {app.totalDays} day{parseFloat(String(app.totalDays)) === 1 ? "" : "s"}
                        {app.createdAt && ` · Submitted ${timeAgo(app.createdAt as any)}`}
                      </p>
                      {app.reason && (
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-1">
                          {app.reason}
                        </p>
                      )}
                    </div>
                    <Button
                      size="sm"
                      onClick={() => {
                        setPendingQueueOpen(false);
                        openReview(app);
                      }}
                      data-testid={`button-queue-review-${app.id}`}
                    >
                      Review
                    </Button>
                  </div>
                ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ─── Review Dialog (preserved from previous version) ─── */}
      <Dialog open={reviewDialogOpen} onOpenChange={setReviewDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Review Leave Application</DialogTitle>
          </DialogHeader>
          {selectedApplication && (
            <div className="space-y-4">
              <div className="space-y-2">
                <div>
                  <p className="text-sm text-muted-foreground">Employee</p>
                  <p className="font-medium">{getUserName(selectedApplication.userId)}</p>
                </div>
                <div className="flex items-center gap-2">
                  <p className="font-medium">{selectedApplication.leaveType}</p>
                  {selectedApplication.leaveType === "MC" && selectedApplication.submissionTiming && (
                    <Badge variant="outline">
                      {selectedApplication.submissionTiming === "pre_event" ? "Planned" : "Post-event"}
                    </Badge>
                  )}
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Duration</p>
                  <p className="font-medium">
                    {new Date(selectedApplication.startDate).toLocaleDateString("en-SG", { day: "numeric", month: "short", year: "numeric" })} – {new Date(selectedApplication.endDate).toLocaleDateString("en-SG", { day: "numeric", month: "short", year: "numeric" })} ({selectedApplication.totalDays} days)
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Reason</p>
                  <p className="text-sm">{selectedApplication.reason}</p>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="approved-days">Approved Leave Days (deducted from balance on approve)</Label>
                <div className="flex gap-2">
                  <Input id="approved-days" type="number" min="0" step="0.5" value={approvedDays}
                    onChange={(e) => setApprovedDays(e.target.value)} className="flex-1" data-testid="input-approved-days" />
                  <Button type="button" variant="outline" size="sm"
                    onClick={() => setApprovedDays(String(selectedApplication.totalDays))} data-testid="button-approved-full">
                    Full
                  </Button>
                  <Button type="button" variant="outline" size="sm"
                    onClick={() => setApprovedDays(String(parseFloat(String(selectedApplication.totalDays)) / 2))} data-testid="button-approved-half">
                    Half
                  </Button>
                  <Button type="button" variant="outline" size="sm"
                    onClick={() => setApprovedDays("0")} data-testid="button-approved-none">
                    None
                  </Button>
                </div>
                {parseFloat(approvedDays) > parseFloat(String(selectedApplication.totalDays)) && (
                  <p className="text-xs text-amber-600">
                    Exceeds requested ({selectedApplication.totalDays}) — allowed but unusual
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="review-comments">Comments (Optional)</Label>
                <Textarea id="review-comments" placeholder="Add review comments..." value={reviewComments}
                  onChange={(e) => setReviewComments(e.target.value)} data-testid="textarea-review-comments" />
              </div>

              <div className="flex gap-2">
                <Button onClick={() => handleReviewApplication("approved")}
                  disabled={reviewMutation.isPending || isViewOnlyAdmin}
                  data-testid="button-approve-application" className="flex-1">
                  <CheckCircle className="mr-2 h-4 w-4" />
                  Approve
                </Button>
                <Button variant="destructive" onClick={() => handleReviewApplication("rejected")}
                  disabled={reviewMutation.isPending || isViewOnlyAdmin}
                  data-testid="button-reject-application" className="flex-1">
                  <XCircle className="mr-2 h-4 w-4" />
                  Reject
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── KPI card ────────────────────────────────────────────────────────────
function KpiCard({
  tone, label, value, subtitle, icon, ctaLabel, onCta, loading,
}: {
  tone: "destructive" | "warning" | "neutral" | "primary";
  label: string;
  value: number | string;
  subtitle?: string;
  icon: React.ReactNode;
  ctaLabel: string;
  onCta: () => void;
  loading: boolean;
}) {
  const toneClasses = {
    destructive: "border-destructive/40 [&_.kpi-label]:text-destructive [&_.kpi-icon]:text-destructive",
    warning: "border-amber-500/50 [&_.kpi-label]:text-amber-600 [&_.kpi-icon]:text-amber-600",
    neutral: "border-border [&_.kpi-label]:text-muted-foreground [&_.kpi-icon]:text-muted-foreground",
    primary: "border-primary/40 [&_.kpi-label]:text-primary [&_.kpi-icon]:text-primary",
  }[tone];

  return (
    <Card className={`${toneClasses}`}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div>
            <p className="kpi-label text-xs font-semibold uppercase tracking-wide">{label}</p>
            {loading ? (
              <Skeleton className="h-9 w-16 mt-1" />
            ) : (
              <h2 className="text-3xl font-bold mt-1">{value}</h2>
            )}
            {subtitle && <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>}
          </div>
          <span className="kpi-icon">{icon}</span>
        </div>
        {ctaLabel && (
          <div className="mt-3 flex justify-end">
            <button onClick={onCta} className="text-xs font-semibold text-primary hover:underline inline-flex items-center gap-1">
              {ctaLabel}
              <ArrowRight className="h-3 w-3" />
            </button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
