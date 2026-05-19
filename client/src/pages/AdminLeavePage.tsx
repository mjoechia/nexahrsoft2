import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toTitleCase } from "@/lib/utils";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  ArrowLeft, AlertOctagon, AlertTriangle, Hourglass, Users, ArrowRight,
  CheckCircle, XCircle,
} from "lucide-react";
import { Link } from "wouter";
import type { User, LeaveBalance, LeaveApplication, LeaveTypeRow, EmployeeLeaveTypeConfig } from "@shared/schema";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
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
  const [totalDays, setTotalDays] = useState(""); // legacy — kept for places that still reference it
  // Adjust Balance dialog — full per-(user, type) breakdown
  const [bfDays, setBfDays] = useState("");
  const [earnedDays, setEarnedDays] = useState("");
  const [eligibleDays, setEligibleDays] = useState("");
  const [takenDays, setTakenDays] = useState("");
  const [balanceDays, setBalanceDays] = useState("");

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
  // Combined save: balance fields + accrual config. Independent endpoints, so we use
  // Promise.allSettled and explicitly report partial-success failures.
  const setBalanceMutation = useMutation({
    mutationFn: async () => {
      const balPromise = apiRequest("POST", "/api/admin/leave/balances", {
        userId: selectedUserId,
        leaveType,
        broughtForward: parseFloat(bfDays) || 0,
        earned:         parseFloat(earnedDays) || 0,
        eligible:       parseFloat(eligibleDays) || 0,
        taken:          parseFloat(takenDays) || 0,
        balance:        parseFloat(balanceDays) || 0,
      });
      const cfgPromise = apiRequest("POST", "/api/admin/leave/configs", {
        userId: selectedUserId,
        leaveTypeCode: leaveType,
        monthlyIncrement: cfgMonthlyIncrement === "" ? null : (parseFloat(cfgMonthlyIncrement) || 0),
        annualAllowance:  cfgAnnualAllowance  === "" ? null : (parseFloat(cfgAnnualAllowance)  || 0),
        maxBalance:       cfgMaxBalance       === "" ? null : (parseFloat(cfgMaxBalance)       || 0),
        notes:            "Edited via Team Snapshot Adjust",
      });
      const [balRes, cfgRes] = await Promise.allSettled([balPromise, cfgPromise]);
      return { balRes, cfgRes };
    },
    onSuccess: ({ balRes, cfgRes }) => {
      const balOk = balRes.status === "fulfilled";
      const cfgOk = cfgRes.status === "fulfilled";

      if (balOk) {
        queryClient.invalidateQueries({ queryKey: ["/api/admin/leave/balances"] });
      }
      if (cfgOk) {
        queryClient.invalidateQueries({ queryKey: ["/api/admin/users", selectedUserId, "leave-configs"] });
        queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      }

      if (balOk && cfgOk) {
        toast({ title: "Saved" });
        setBalanceDialogOpen(false);
        resetAdjustFields();
        setSelectedUserId("");
      } else if (balOk) {
        toast({ title: "Partial save", description: "Balance saved, but accrual config did not. Try saving again.", variant: "destructive" });
      } else if (cfgOk) {
        toast({ title: "Partial save", description: "Accrual config saved, but balance did not. Try saving again.", variant: "destructive" });
      } else {
        toast({ title: "Save failed", description: "Neither balance nor config was saved.", variant: "destructive" });
      }
    },
    onError: (err: Error) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  // Prefill the 5 balance fields from the existing row whenever (userId, leaveType) is set
  useEffect(() => {
    if (!selectedUserId || !leaveType) {
      setBfDays(""); setEarnedDays(""); setEligibleDays(""); setTakenDays(""); setBalanceDays("");
      return;
    }
    const yr = new Date().getFullYear();
    const existing = balances.find(b => b.userId === selectedUserId && b.leaveType === leaveType && b.year === yr);
    if (existing) {
      setBfDays(String(existing.broughtForward ?? "0"));
      setEarnedDays(String(existing.earned ?? "0"));
      setEligibleDays(String(existing.eligible ?? "0"));
      setTakenDays(String(existing.taken ?? "0"));
      setBalanceDays(String(existing.balance ?? "0"));
    } else {
      setBfDays("0"); setEarnedDays("0"); setEligibleDays("0"); setTakenDays("0"); setBalanceDays("0");
    }
  }, [selectedUserId, leaveType, balances]);

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
    if (!selectedUserId || !leaveType) {
      toast({ title: "Pick an employee and leave type", variant: "destructive" });
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

  // Compute Mon-Sun ISO range for the current week
  const weekRange = (() => {
    const d = new Date(today + "T00:00:00");
    const dow = d.getDay(); // 0=Sun
    const daysFromMonday = (dow + 6) % 7; // Mon=0, Sun=6
    const monday = new Date(d);
    monday.setDate(d.getDate() - daysFromMonday);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    const fmt = (x: Date) => x.toISOString().slice(0, 10);
    return { start: fmt(monday), end: fmt(sunday) };
  })();

  // Applications whose date range overlaps the current week
  const onLeaveThisWeekApps = applications.filter(a =>
    a.status === "approved" && a.startDate <= weekRange.end && a.endDate >= weekRange.start
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
    primaryLabel?: string;
    onPrimary?: () => void;
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
  // Overdrawn balances — informational only (cron auto-clears on 1st of next month)
  const nextMonthLabel = (() => {
    const d = new Date();
    d.setMonth(d.getMonth() + 1, 1);
    return d.toLocaleDateString("en-SG", { day: "numeric", month: "short" });
  })();
  lowBalances
    .filter(b => b.isOverdrawn)
    .slice(0, 3)
    .forEach(b => {
      urgentItems.push({
        id: `bal-${b.id}`,
        severity: "med",
        title: `${toTitleCase(b.employeeName) || getUserName(b.userId)} ${b.leaveType} balance < 0`,
        subtitle: `${b.remaining.toFixed(1)} days · Auto-resets to 0 on ${nextMonthLabel}`,
        // No primary action — handled automatically by monthly cron
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
  const [snapshotSearch, setSnapshotSearch] = useState("");
  const pageSize = 10;

  const filteredSnapshotRows = (() => {
    const q = snapshotSearch.trim().toLowerCase();
    if (!q) return snapshotRows;
    return snapshotRows.filter(r => {
      const name = (r.user.name || "").toLowerCase();
      const email = (r.user.email || "").toLowerCase();
      const code = (r.user.employeeCode || "").toLowerCase();
      return name.includes(q) || email.includes(q) || code.includes(q);
    });
  })();

  const totalSnapshotPages = Math.max(1, Math.ceil(filteredSnapshotRows.length / pageSize));
  const safePage = Math.min(snapshotPage, totalSnapshotPages - 1);
  const visibleRows = filteredSnapshotRows.slice(safePage * pageSize, (safePage + 1) * pageSize);

  // Adjust dialog — accrual config fields (added alongside the 5 balance fields)
  const [cfgMonthlyIncrement, setCfgMonthlyIncrement] = useState("");
  const [cfgAnnualAllowance, setCfgAnnualAllowance]   = useState("");
  const [cfgMaxBalance, setCfgMaxBalance]             = useState("");

  // Resign dialog state
  const [resignOpen, setResignOpen] = useState(false);
  const [resignUser, setResignUser] = useState<User | null>(null);
  const [resignDate, setResignDate] = useState("");

  // Reset every Adjust-dialog field (8 total) — used on open + on successful save
  const resetAdjustFields = () => {
    setLeaveType("");
    setBfDays(""); setEarnedDays(""); setEligibleDays(""); setTakenDays(""); setBalanceDays("");
    setCfgMonthlyIncrement(""); setCfgAnnualAllowance(""); setCfgMaxBalance("");
  };

  // Per-row Adjust button → wipes prior selection then opens dialog
  const openAdjust = (userId: string) => {
    resetAdjustFields();
    setSelectedUserId(userId);
    setBalanceDialogOpen(true);
  };

  const openResign = (u: User) => {
    setResignUser(u);
    setResignDate(u.resignDate || "");
    setResignOpen(true);
  };

  // Fetch the user's full configs array once (cached by React Query).
  // Picking a leave type then derives the right config locally — no per-type fetches.
  const { data: userConfigsData } = useQuery<{ configs: EmployeeLeaveTypeConfig[] }>({
    queryKey: ["/api/admin/users", selectedUserId, "leave-configs"],
    enabled: !!selectedUserId,
  });
  const userConfigs = userConfigsData?.configs || [];

  // Prefill 3 config fields from the cached configs array whenever (userConfigs, leaveType) changes.
  // Local derivation — no per-type fetch, so rapid type-switching is race-free.
  useEffect(() => {
    if (!selectedUserId || !leaveType) {
      setCfgMonthlyIncrement(""); setCfgAnnualAllowance(""); setCfgMaxBalance("");
      return;
    }
    const cfg = userConfigs.find(c => c.leaveTypeCode === leaveType);
    setCfgMonthlyIncrement(cfg?.monthlyIncrement ?? "");
    setCfgAnnualAllowance(cfg?.annualAllowance ?? "");
    setCfgMaxBalance(cfg?.maxBalance ?? "");
  }, [selectedUserId, leaveType, userConfigs]);

  const resignMutation = useMutation({
    mutationFn: async () => {
      if (!resignUser) return;
      return apiRequest("PATCH", `/api/admin/users/${resignUser.id}/resign`, {
        resignDate: resignDate.trim() === "" ? null : resignDate,
      });
    },
    onSuccess: () => {
      toast({ title: resignDate ? "Resign date set" : "Resign date cleared" });
      setResignOpen(false);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
    },
    onError: (err: Error) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

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
          {/* Adjust Balance dialog (opened from per-row buttons in Team Snapshot) */}
          <Dialog open={balanceDialogOpen} onOpenChange={(o) => { setBalanceDialogOpen(o); if (!o) { resetAdjustFields(); setSelectedUserId(""); } }}>
            <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>
                  Set Employee Leave{(() => {
                    const u = allUsers.find(x => x.id === selectedUserId);
                    return u ? ` — ${toTitleCase(u.name) || u.username}` : "";
                  })()}
                </DialogTitle>
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
                <div className="space-y-1">
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
                  {(() => {
                    const strat = leaveTypeOptions.find(t => t.code === leaveType)?.accrualStrategy;
                    if (!strat) return null;
                    const hint: Record<string, string> = {
                      monthly_fixed:  "Monthly Increment + Max Balance apply",
                      monthly_tenure: "Tenure formula + Max Balance apply",
                      annual_reset:   "Annual Allowance + Max Balance apply (resets every January)",
                      manual_only:    "No automatic accrual",
                    };
                    return (
                      <p className="text-[11px] text-muted-foreground">
                        Strategy: <code className="text-[10px]">{strat}</code> — {hint[strat] || ""}
                      </p>
                    );
                  })()}
                </div>
                {/* All 5 balance fields editable. Values are prefilled from the existing row when present. */}
                <div className="rounded-md border bg-muted/30 p-3 space-y-3">
                  <p className="text-xs text-muted-foreground">
                    <strong>Eligible</strong> = Brought Forward + Earned. <strong>Balance</strong> = Eligible − Taken. Edit any field directly — the app does not auto-recompute.
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label htmlFor="bf-days" className="text-xs">Brought Forward</Label>
                      <Input id="bf-days" type="number" step="0.5" placeholder="0"
                        value={bfDays} onChange={(e) => setBfDays(e.target.value)} data-testid="input-bf-days" />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="earned-days" className="text-xs">Earned</Label>
                      <Input id="earned-days" type="number" step="0.5" placeholder="0"
                        value={earnedDays} onChange={(e) => setEarnedDays(e.target.value)} data-testid="input-earned-days" />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="eligible-days" className="text-xs">Eligible</Label>
                      <Input id="eligible-days" type="number" step="0.5" placeholder="0"
                        value={eligibleDays} onChange={(e) => setEligibleDays(e.target.value)} data-testid="input-eligible-days" />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="taken-days" className="text-xs">Taken</Label>
                      <Input id="taken-days" type="number" step="0.5" placeholder="0"
                        value={takenDays} onChange={(e) => setTakenDays(e.target.value)} data-testid="input-taken-days" />
                    </div>
                    <div className="space-y-1 col-span-2">
                      <Label htmlFor="balance-days" className="text-xs">Current Balance (days remaining)</Label>
                      <Input id="balance-days" type="number" step="0.5" placeholder="0"
                        value={balanceDays} onChange={(e) => setBalanceDays(e.target.value)} data-testid="input-balance-days" />
                    </div>
                  </div>
                  <Button type="button" variant="outline" size="sm" className="w-full"
                    onClick={() => {
                      const bf = parseFloat(bfDays) || 0;
                      const earned = parseFloat(earnedDays) || 0;
                      const taken = parseFloat(takenDays) || 0;
                      const eligible = bf + earned;
                      setEligibleDays(String(eligible));
                      setBalanceDays(String(eligible - taken));
                    }}
                    data-testid="button-auto-fill">
                    Recalculate: Eligible = BF + Earned, Balance = Eligible − Taken
                  </Button>
                </div>

                {/* Accrual Config (per-employee, per-leave-type). Blank = inherit leave-type default. */}
                <div className="rounded-md border bg-muted/30 p-3 space-y-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Accrual Config
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label htmlFor="cfg-monthly" className="text-xs">Monthly Increment</Label>
                      <Input id="cfg-monthly" type="number" min="0" step="0.5" placeholder="—"
                        value={cfgMonthlyIncrement} onChange={(e) => setCfgMonthlyIncrement(e.target.value)}
                        data-testid="input-cfg-monthly" />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="cfg-annual" className="text-xs">Annual Allowance</Label>
                      <Input id="cfg-annual" type="number" min="0" step="0.5" placeholder="—"
                        value={cfgAnnualAllowance} onChange={(e) => setCfgAnnualAllowance(e.target.value)}
                        data-testid="input-cfg-annual" />
                    </div>
                    <div className="space-y-1 col-span-2">
                      <Label htmlFor="cfg-max" className="text-xs">Max Balance (caps the balance)</Label>
                      <Input id="cfg-max" type="number" min="0" step="0.5" placeholder="—"
                        value={cfgMaxBalance} onChange={(e) => setCfgMaxBalance(e.target.value)}
                        data-testid="input-cfg-max" />
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Leave a field blank to inherit the leave-type default.
                  </p>
                </div>

                <Button onClick={handleSetBalance} disabled={setBalanceMutation.isPending || isViewOnlyAdmin || !selectedUserId || !leaveType}
                  data-testid="button-submit-balance" className="w-full">
                  {setBalanceMutation.isPending ? "Saving…" : "Save"}
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
                      {item.primaryLabel && (
                        <Button size="sm" onClick={item.onPrimary} data-testid={`button-urgent-${item.id}`}>
                          {item.primaryLabel}
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Staff on Leave — today + this week */}
        <Card className="lg:col-span-5">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">Staff on Leave</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="grid grid-cols-2 divide-x">
              {/* Today */}
              <div className="p-4">
                <div className="flex items-baseline justify-between mb-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Today</p>
                  <span className="text-2xl font-semibold">{onLeaveTodayApps.length}</span>
                </div>
                {onLeaveTodayApps.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Nobody on leave</p>
                ) : (
                  <ul className="space-y-1 max-h-44 overflow-y-auto">
                    {onLeaveTodayApps.slice(0, 8).map(a => (
                      <li key={a.id} className="text-xs flex items-center gap-2">
                        <span className="h-1.5 w-1.5 rounded-full bg-amber-500 shrink-0" />
                        <span className="truncate font-medium">{getUserName(a.userId)}</span>
                        <Badge variant="outline" className="text-[10px] px-1 py-0">{a.leaveType}</Badge>
                        <span className="text-muted-foreground truncate ml-auto">→ {formatDateShort(a.endDate)}</span>
                      </li>
                    ))}
                    {onLeaveTodayApps.length > 8 && (
                      <li className="text-xs text-muted-foreground italic">+{onLeaveTodayApps.length - 8} more</li>
                    )}
                  </ul>
                )}
              </div>
              {/* This week */}
              <div className="p-4">
                <div className="flex items-baseline justify-between mb-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">This Week</p>
                  <span className="text-2xl font-semibold">{onLeaveThisWeekApps.length}</span>
                </div>
                {onLeaveThisWeekApps.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No leave this week</p>
                ) : (
                  <ul className="space-y-1 max-h-44 overflow-y-auto">
                    {onLeaveThisWeekApps.slice(0, 8).map(a => (
                      <li key={a.id} className="text-xs flex items-center gap-2">
                        <span className="h-1.5 w-1.5 rounded-full bg-blue-500 shrink-0" />
                        <span className="truncate font-medium">{getUserName(a.userId)}</span>
                        <Badge variant="outline" className="text-[10px] px-1 py-0">{a.leaveType}</Badge>
                        <span className="text-muted-foreground truncate ml-auto">
                          {formatDateShort(a.startDate)}–{formatDateShort(a.endDate)}
                        </span>
                      </li>
                    ))}
                    {onLeaveThisWeekApps.length > 8 && (
                      <li className="text-xs text-muted-foreground italic">+{onLeaveThisWeekApps.length - 8} more</li>
                    )}
                  </ul>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Team Snapshot table */}
      <Card id="team-snapshot">
        <CardHeader className="space-y-3 pb-3">
          <div className="flex flex-row items-center justify-between gap-3 flex-wrap">
            <CardTitle className="text-lg">Team Snapshot</CardTitle>
            <p className="text-xs text-muted-foreground">
              Showing {visibleRows.length === 0 ? 0 : safePage * pageSize + 1}–{safePage * pageSize + visibleRows.length} of {filteredSnapshotRows.length}
              {snapshotSearch && ` (filtered from ${snapshotRows.length})`}
            </p>
          </div>
          <Input
            type="search"
            placeholder="Search by name, email, or employee code…"
            value={snapshotSearch}
            onChange={(e) => { setSnapshotSearch(e.target.value); setSnapshotPage(0); }}
            className="max-w-sm"
            data-testid="input-snapshot-search"
          />
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
                  <TableHead className="text-right">Max / Monthly</TableHead>
                  <TableHead className="text-right">MC Balance</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Next Leave</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleRows.map(r => {
                  const maxLv = r.user.alMaxLeave != null ? Number(r.user.alMaxLeave).toFixed(1) : "—";
                  const incr  = r.user.alMonthlyIncrement != null ? Number(r.user.alMonthlyIncrement).toFixed(1) : "—";
                  return (
                  <TableRow key={r.user.id}>
                    <TableCell>
                      <div>
                        <p className="font-medium text-sm">{toTitleCase(r.user.name) || r.user.username}</p>
                        <p className="text-xs text-muted-foreground">{r.user.email}</p>
                      </div>
                    </TableCell>
                    <TableCell className={`text-right font-medium ${r.alOverdrawn ? "text-destructive" : r.alLow ? "text-amber-600" : ""}`}>
                      {r.al}
                    </TableCell>
                    <TableCell className="text-right text-xs text-muted-foreground">
                      <span className="tabular-nums">{maxLv}</span> / <span className="tabular-nums">{incr}</span>/mo
                    </TableCell>
                    <TableCell className="text-right">{r.mc}</TableCell>
                    <TableCell>
                      {r.user.resignDate ? (
                        <Badge variant="destructive" title={`Resigning ${r.user.resignDate}`}>
                          Resigning {r.user.resignDate}
                        </Badge>
                      ) : r.status.tone === "on_leave" ? (
                        <Badge variant="outline">{r.status.label}</Badge>
                      ) : (
                        <Badge>{r.status.label}</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{r.nextLeave}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="outline" onClick={() => openResign(r.user)}
                          data-testid={`button-resign-${r.user.id}`}>
                          Resign…
                        </Button>
                        <Button size="sm" onClick={() => openAdjust(r.user.id)}
                          data-testid={`button-adjust-${r.user.id}`}>
                          Adjust
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );})}
                {visibleRows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-12">
                      {snapshotSearch ? "No employees match your search." : "No employees to display."}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
        {filteredSnapshotRows.length > pageSize && (
          <div className="px-4 py-3 border-t flex items-center justify-end gap-2">
            <Button size="sm" variant="outline" disabled={safePage === 0}
              onClick={() => setSnapshotPage(p => Math.max(0, p - 1))}>
              Prev
            </Button>
            <span className="text-xs text-muted-foreground">{safePage + 1} / {totalSnapshotPages}</span>
            <Button size="sm" variant="outline" disabled={safePage >= totalSnapshotPages - 1}
              onClick={() => setSnapshotPage(p => Math.min(totalSnapshotPages - 1, p + 1))}>
              Next
            </Button>
          </div>
        )}
      </Card>

      {/* AL Settings dialog removed — folded into Adjust (per-row Adjust button opens the combined editor). */}

      {/* ─── Resign Date Dialog ─── */}
      <Dialog open={resignOpen} onOpenChange={setResignOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Set Resignation Date — {resignUser ? (toTitleCase(resignUser.name) || resignUser.username) : ""}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="resign-date">Resign Date</Label>
              <Input
                id="resign-date" type="date"
                value={resignDate}
                onChange={(e) => setResignDate(e.target.value)}
                data-testid="input-resign-date"
              />
              <p className="text-xs text-muted-foreground">
                Employee will be auto-archived by the daily cron on or after this date. Leave blank to clear.
              </p>
            </div>
            <div className="flex justify-between items-center pt-2 gap-2">
              <div>
                {resignUser?.resignDate && (
                  <Button variant="ghost" className="text-destructive" onClick={() => { setResignDate(""); resignMutation.mutate(); }}
                    disabled={resignMutation.isPending}>
                    Clear
                  </Button>
                )}
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setResignOpen(false)} disabled={resignMutation.isPending}>
                  Cancel
                </Button>
                <Button onClick={() => resignMutation.mutate()} disabled={resignMutation.isPending || !resignDate} data-testid="button-save-resign">
                  {resignMutation.isPending ? "Saving…" : "Save"}
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

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

                {/* All current leave balances for this applicant */}
                {(() => {
                  const yr = new Date(selectedApplication.startDate).getFullYear() || new Date().getFullYear();
                  const userBalances = balances
                    .filter(b => b.userId === selectedApplication.userId && b.year === yr)
                    .sort((a, b) => a.leaveType.localeCompare(b.leaveType));
                  return (
                    <div className="rounded-md border border-blue-200 dark:border-blue-900 bg-blue-50 dark:bg-blue-950/30 p-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-blue-900 dark:text-blue-200 mb-2">
                        Current Leave Balances ({yr})
                      </p>
                      {userBalances.length === 0 ? (
                        <p className="text-xs text-blue-900/70 dark:text-blue-200/70">
                          No balance records on file for this employee.
                        </p>
                      ) : (
                        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                          {userBalances.map(b => {
                            const isRelevant = b.leaveType === selectedApplication.leaveType;
                            const bal = parseFloat(b.balance || '0');
                            const elig = parseFloat(b.eligible || '0');
                            return (
                              <div
                                key={b.id}
                                className={`flex items-baseline justify-between text-blue-900 dark:text-blue-200 ${isRelevant ? "font-bold underline underline-offset-2" : ""}`}
                                data-testid={`balance-${b.leaveType}`}
                              >
                                <span className="text-xs uppercase">{b.leaveType}</span>
                                <span className={bal < 0 ? "text-destructive font-semibold" : ""}>
                                  {bal.toFixed(1)} / {elig.toFixed(1)}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })()}
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
