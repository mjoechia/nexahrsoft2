import { useState } from "react";
import { Receipt, Clock, CheckCircle, XCircle, Eye, Filter, ArrowLeft, FileText, ExternalLink, Trash2, History, AlertTriangle, RefreshCw, CheckCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { Claim, TimesheetRow } from "@shared/schema";
import { claimTypeLabels } from "@shared/schema";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { useLocation } from "wouter";
import { toTitleCase } from "@/lib/utils";

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
];

function generatePeriodOptions() {
  const options: { value: string; label: string; month: number; year: number }[] = [];
  const currentDate = new Date();
  const currentYear = currentDate.getFullYear();
  const currentMonth = currentDate.getMonth();

  for (let i = 0; i < 24; i++) {
    let month = currentMonth - i;
    let year = currentYear;
    while (month < 0) { month += 12; year -= 1; }
    options.push({ value: `${month + 1}-${year}`, label: `${MONTH_NAMES[month]} ${year}`, month: month + 1, year });
  }
  return options;
}

interface ClaimsAuditLog {
  id: string;
  claimId: string;
  userId: string;
  employeeCode: string | null;
  employeeName: string | null;
  claimType: string;
  amount: string;
  description: string | null;
  claimMonth: number;
  claimYear: number;
  action: string;
  previousStatus: string | null;
  performedBy: string;
  performedByName: string | null;
  comments: string | null;
  performedAt: string;
}

function getStatusBadge(status: string) {
  switch (status) {
    case "pending":
      return <Badge variant="secondary" className="gap-1"><Clock className="h-3 w-3" /> Pending</Badge>;
    case "approved":
      return <Badge className="gap-1 bg-green-500 hover:bg-green-600"><CheckCircle className="h-3 w-3" /> Approved</Badge>;
    case "processed":
      return <Badge className="gap-1 bg-blue-500 hover:bg-blue-600"><CheckCheck className="h-3 w-3" /> Processed</Badge>;
    case "rejected":
      return <Badge variant="destructive" className="gap-1"><XCircle className="h-3 w-3" /> Rejected</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

export default function AdminClaimsPage() {
  const [, setLocation] = useLocation();
  const periodOptions = generatePeriodOptions();
  const [selectedPeriod, setSelectedPeriod] = useState(periodOptions[0]?.value || "1-2026");
  const [selectedClaim, setSelectedClaim] = useState<Claim | null>(null);
  const [reviewComments, setReviewComments] = useState("");
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [claimToDelete, setClaimToDelete] = useState<Claim | null>(null);
  const [deleteReason, setDeleteReason] = useState("");
  const [activeTab, setActiveTab] = useState("pending");
  const [pendingSearch, setPendingSearch] = useState("");
  const { toast } = useToast();

  const [selectedMonth, selectedYear] = selectedPeriod.split("-").map(Number);
  const selectedMonthStr = String(selectedMonth);
  const selectedYearStr = String(selectedYear);

  const { data: claimsData, isLoading } = useQuery<{ claims: Claim[] }>({
    queryKey: ["/api/admin/claims", selectedYearStr, selectedMonthStr],
    queryFn: async () => {
      const res = await fetch(`/api/admin/claims?year=${selectedYearStr}&month=${selectedMonthStr}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch claims");
      return res.json();
    },
  });

  const { data: pendingCountData } = useQuery<{ count: number }>({
    queryKey: ["/api/admin/claims/pending-count"],
  });

  const { data: auditLogsData, isLoading: auditLogsLoading } = useQuery<ClaimsAuditLog[]>({
    queryKey: ["/api/admin/claims/audit-log", selectedYearStr, selectedMonthStr],
    queryFn: async () => {
      const res = await fetch(`/api/admin/claims/audit-log?year=${selectedYearStr}&month=${selectedMonthStr}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch audit logs");
      return res.json();
    },
    enabled: activeTab === "audit",
  });

  const invalidateClaims = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/admin/claims"] });
    queryClient.invalidateQueries({ queryKey: ["/api/admin/claims/pending-count"] });
    queryClient.invalidateQueries({ queryKey: ["/api/admin/claims/audit-log"] });
  };

  const deleteClaimMutation = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) =>
      apiRequest("DELETE", `/api/admin/claims/${id}`, { reason }),
    onSuccess: () => {
      toast({ title: "Claim Deleted", description: "The claim has been permanently deleted." });
      setDeleteConfirmOpen(false);
      setClaimToDelete(null);
      setDeleteReason("");
      setSelectedClaim(null);
      invalidateClaims();
    },
    onError: (error: Error) => {
      toast({ title: "Delete Failed", description: error.message, variant: "destructive" });
    },
  });

  const updateClaimMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) =>
      apiRequest("PATCH", `/api/admin/claims/${id}`, { status, reviewComments: reviewComments || null }),
    onSuccess: (_, { status }) => {
      const labels: Record<string, string> = {
        approved: "Claim Approved",
        rejected: "Claim Rejected",
        processed: "Claim Processed",
        pending: "Claim Reversed to Pending",
      };
      toast({ title: labels[status] || "Updated", description: `The claim has been ${status}.` });
      setSelectedClaim(null);
      setReviewComments("");
      invalidateClaims();
    },
    onError: (error: Error) => {
      toast({ title: "Action Failed", description: error.message, variant: "destructive" });
    },
  });

  const quickUpdate = (claim: Claim, status: string) => {
    setReviewComments("");
    updateClaimMutation.mutate({ id: claim.id, status });
  };

  const handleViewReceipt = (claimId: string) => {
    window.open(`/api/claims/${claimId}/receipt`, "_blank");
  };

  const handleDeleteClick = (claim: Claim) => {
    setClaimToDelete(claim);
    setDeleteConfirmOpen(true);
  };

  const claims = claimsData?.claims || [];
  const pendingClaimsAll = claims.filter(c => c.status === "pending").sort((a, b) => (a.employeeName || "").localeCompare(b.employeeName || ""));
  const pendingClaims = pendingSearch.trim()
    ? pendingClaimsAll.filter(c =>
        (c.employeeName || "").toLowerCase().includes(pendingSearch.toLowerCase()) ||
        (c.employeeCode || "").toLowerCase().includes(pendingSearch.toLowerCase())
      )
    : pendingClaimsAll;
  const approvedClaims = claims.filter(c => c.status === "approved").sort((a, b) => (a.employeeName || "").localeCompare(b.employeeName || ""));
  const processedClaims = claims.filter(c => c.status === "processed").sort((a, b) => (a.employeeName || "").localeCompare(b.employeeName || ""));
  const rejectedClaims = claims.filter(c => c.status === "rejected").sort((a, b) => (a.employeeName || "").localeCompare(b.employeeName || ""));
  const pendingCount = pendingCountData?.count || 0;

  const PeriodSelector = () => (
    <div className="flex items-center gap-2">
      <Select value={selectedPeriod} onValueChange={setSelectedPeriod}>
        <SelectTrigger className="w-40" data-testid="select-period">
          <SelectValue placeholder="Select period" />
        </SelectTrigger>
        <SelectContent>
          {periodOptions.map((p) => (
            <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button variant="outline" size="icon" onClick={invalidateClaims} data-testid="button-refresh-claims">
        <RefreshCw className="h-4 w-4" />
      </Button>
    </div>
  );

  const EmptyState = ({ label }: { label: string }) => (
    <div className="text-center py-10 text-muted-foreground">
      <Receipt className="h-12 w-12 mx-auto mb-4 opacity-50" />
      <p>No {label} claims for this period</p>
    </div>
  );

  return (
    <div className="min-h-screen bg-muted/30 p-4 md:p-8">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div>
              <h1 className="text-2xl font-bold" data-testid="text-page-title">All Claims</h1>
              <p className="text-muted-foreground">Review and manage employee expense claims</p>
            </div>
            {pendingCount > 0 && (
              <Badge
                variant="destructive"
                className="text-sm cursor-pointer"
                onClick={() => setActiveTab("pending")}
                data-testid="badge-pending-count"
              >
                {pendingCount} Pending
              </Badge>
            )}
          </div>
          <Button variant="outline" onClick={() => setLocation("/admin/dashboard")} data-testid="button-back">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Dashboard
          </Button>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-5">
            <TabsTrigger value="pending" data-testid="tab-pending">
              <Clock className="h-4 w-4 mr-1" />
              Pending {pendingClaims.length > 0 && `(${pendingClaims.length})`}
            </TabsTrigger>
            <TabsTrigger value="approved" data-testid="tab-approved">
              <CheckCircle className="h-4 w-4 mr-1" />
              Approved {approvedClaims.length > 0 && `(${approvedClaims.length})`}
            </TabsTrigger>
            <TabsTrigger value="processed" data-testid="tab-processed">
              <CheckCheck className="h-4 w-4 mr-1" />
              Processed {processedClaims.length > 0 && `(${processedClaims.length})`}
            </TabsTrigger>
            <TabsTrigger value="rejected" data-testid="tab-rejected">
              <XCircle className="h-4 w-4 mr-1" />
              Rejected {rejectedClaims.length > 0 && `(${rejectedClaims.length})`}
            </TabsTrigger>
            <TabsTrigger value="audit" data-testid="tab-audit">
              <History className="h-4 w-4 mr-1" />
              Audit Trail
            </TabsTrigger>
          </TabsList>

          {/* ── PENDING ── */}
          <TabsContent value="pending" className="space-y-4 mt-6">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between flex-wrap gap-4">
                  <CardTitle className="flex items-center gap-2">
                    <Filter className="h-5 w-5" />
                    Pending Claims
                  </CardTitle>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Input
                      placeholder="Search by name or code..."
                      value={pendingSearch}
                      onChange={e => setPendingSearch(e.target.value)}
                      className="w-52"
                      data-testid="input-pending-search"
                    />
                    <PeriodSelector />
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <div className="space-y-3">{[1,2,3].map(i => <Skeleton key={i} className="h-20 w-full" />)}</div>
                ) : pendingClaims.length === 0 ? (
                  <EmptyState label="pending" />
                ) : (
                  <div className="space-y-3">
                    {pendingClaims.map(claim => (
                      <ClaimRow
                        key={claim.id}
                        claim={claim}
                        onView={() => setSelectedClaim(claim)}
                        onViewReceipt={() => handleViewReceipt(claim.id)}
                        actions={
                          <div className="flex items-center gap-2">
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={() => quickUpdate(claim, "rejected")}
                              disabled={updateClaimMutation.isPending}
                              data-testid={`button-reject-${claim.id}`}
                            >
                              <XCircle className="h-3 w-3 mr-1" />
                              Reject
                            </Button>
                            <Button
                              size="sm"
                              className="bg-green-600 hover:bg-green-700"
                              onClick={() => quickUpdate(claim, "approved")}
                              disabled={updateClaimMutation.isPending}
                              data-testid={`button-approve-${claim.id}`}
                            >
                              <CheckCircle className="h-3 w-3 mr-1" />
                              Approve
                            </Button>
                          </div>
                        }
                      />
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── APPROVED ── */}
          <TabsContent value="approved" className="space-y-4 mt-6">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between flex-wrap gap-4">
                  <CardTitle className="flex items-center gap-2">
                    <Filter className="h-5 w-5" />
                    Approved Claims
                  </CardTitle>
                  <PeriodSelector />
                </div>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <div className="space-y-3">{[1,2,3].map(i => <Skeleton key={i} className="h-20 w-full" />)}</div>
                ) : approvedClaims.length === 0 ? (
                  <EmptyState label="approved" />
                ) : (
                  <div className="space-y-3">
                    {approvedClaims.map(claim => (
                      <ClaimRow
                        key={claim.id}
                        claim={claim}
                        onView={() => setSelectedClaim(claim)}
                        onViewReceipt={() => handleViewReceipt(claim.id)}
                        actions={
                          <div className="flex items-center gap-2">
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={() => quickUpdate(claim, "rejected")}
                              disabled={updateClaimMutation.isPending}
                              data-testid={`button-reject-${claim.id}`}
                            >
                              <XCircle className="h-3 w-3 mr-1" />
                              Reject
                            </Button>
                            <Button
                              size="sm"
                              className="bg-blue-600 hover:bg-blue-700"
                              onClick={() => quickUpdate(claim, "processed")}
                              disabled={updateClaimMutation.isPending}
                              data-testid={`button-process-${claim.id}`}
                            >
                              <CheckCheck className="h-3 w-3 mr-1" />
                              Processed
                            </Button>
                          </div>
                        }
                      />
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── PROCESSED ── */}
          <TabsContent value="processed" className="space-y-4 mt-6">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between flex-wrap gap-4">
                  <CardTitle className="flex items-center gap-2">
                    <Filter className="h-5 w-5" />
                    Processed Claims
                  </CardTitle>
                  <PeriodSelector />
                </div>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <div className="space-y-3">{[1,2,3].map(i => <Skeleton key={i} className="h-20 w-full" />)}</div>
                ) : processedClaims.length === 0 ? (
                  <EmptyState label="processed" />
                ) : (
                  <div className="space-y-3">
                    {processedClaims.map(claim => (
                      <ClaimRow
                        key={claim.id}
                        claim={claim}
                        onView={() => setSelectedClaim(claim)}
                        onViewReceipt={() => handleViewReceipt(claim.id)}
                      />
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── REJECTED ── */}
          <TabsContent value="rejected" className="space-y-4 mt-6">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between flex-wrap gap-4">
                  <CardTitle className="flex items-center gap-2">
                    <Filter className="h-5 w-5" />
                    Rejected Claims
                  </CardTitle>
                  <PeriodSelector />
                </div>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <div className="space-y-3">{[1,2,3].map(i => <Skeleton key={i} className="h-20 w-full" />)}</div>
                ) : rejectedClaims.length === 0 ? (
                  <EmptyState label="rejected" />
                ) : (
                  <div className="space-y-3">
                    {rejectedClaims.map(claim => (
                      <ClaimRow
                        key={claim.id}
                        claim={claim}
                        onView={() => setSelectedClaim(claim)}
                        onViewReceipt={() => handleViewReceipt(claim.id)}
                        actions={
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => quickUpdate(claim, "pending")}
                            disabled={updateClaimMutation.isPending}
                            data-testid={`button-reverse-${claim.id}`}
                          >
                            <History className="h-3 w-3 mr-1" />
                            Reverse
                          </Button>
                        }
                      />
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── AUDIT TRAIL ── */}
          <TabsContent value="audit" className="space-y-4 mt-6">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between flex-wrap gap-4">
                  <CardTitle className="flex items-center gap-2">
                    <History className="h-5 w-5" />
                    Claims Activity Log
                  </CardTitle>
                  <PeriodSelector />
                </div>
              </CardHeader>
              <CardContent>
                {auditLogsLoading ? (
                  <div className="space-y-3">{[1,2,3].map(i => <Skeleton key={i} className="h-16 w-full" />)}</div>
                ) : !auditLogsData || auditLogsData.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <History className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p>No audit logs for this period</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {auditLogsData.map(log => (
                      <div key={log.id} className="p-4 border rounded-lg" data-testid={`audit-log-${log.id}`}>
                        <div className="flex items-center justify-between flex-wrap gap-2">
                          <div className="flex items-center gap-2">
                            {log.action === "approved"  && <Badge className="bg-green-500"><CheckCircle className="h-3 w-3 mr-1" /> Approved</Badge>}
                            {log.action === "processed" && <Badge className="bg-blue-500"><CheckCheck className="h-3 w-3 mr-1" /> Processed</Badge>}
                            {log.action === "rejected"  && <Badge variant="destructive"><XCircle className="h-3 w-3 mr-1" /> Rejected</Badge>}
                            {log.action === "deleted"   && <Badge variant="outline" className="text-destructive border-destructive"><Trash2 className="h-3 w-3 mr-1" /> Deleted</Badge>}
                            {log.action === "reversed"  && <Badge variant="outline" className="text-orange-500 border-orange-500"><History className="h-3 w-3 mr-1" /> Reversed</Badge>}
                            <span className="font-medium">{toTitleCase(log.employeeName)}</span>
                            {log.employeeCode && <span className="text-sm text-muted-foreground">({log.employeeCode})</span>}
                          </div>
                          <span className="text-lg font-semibold">${parseFloat(log.amount).toFixed(2)}</span>
                        </div>
                        <div className="mt-2 text-sm text-muted-foreground">
                          <span>{claimTypeLabels[log.claimType as keyof typeof claimTypeLabels] || log.claimType}</span>
                          {log.description && <span> - {log.description}</span>}
                        </div>
                        <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                          <span>By: {log.performedByName || "Admin"}</span>
                          <span>{format(new Date(log.performedAt), "dd MMM yyyy HH:mm")}</span>
                        </div>
                        {log.comments && (
                          <div className="mt-2 text-sm bg-muted p-2 rounded">
                            <span className="font-medium">Comments:</span> {log.comments}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* ── CLAIM DETAIL DIALOG ── */}
        <Dialog open={!!selectedClaim} onOpenChange={() => { setSelectedClaim(null); setReviewComments(""); }}>
          <DialogContent className={selectedClaim?.claimType === "ot_timesheet" ? "sm:max-w-4xl max-h-[90vh] overflow-y-auto" : "sm:max-w-lg"}>
            <DialogHeader>
              <DialogTitle>Claim Details</DialogTitle>
            </DialogHeader>
            {selectedClaim && (() => {
              const isOT = selectedClaim.claimType === "overtime" || selectedClaim.claimType === "ot_timesheet";
              const isOTSheet = selectedClaim.claimType === "ot_timesheet";
              const otFiles: { url: string; name: string }[] = (() => {
                try { return selectedClaim.otFiles ? JSON.parse(selectedClaim.otFiles) : []; }
                catch { return []; }
              })();
              const timesheetRows: TimesheetRow[] = (() => {
                try { return (selectedClaim as any).timesheetRows ? JSON.parse((selectedClaim as any).timesheetRows) : []; }
                catch { return []; }
              })();
              return (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-muted-foreground text-xs">Employee</Label>
                    <p className="font-medium">{toTitleCase(selectedClaim.employeeName)}</p>
                  </div>
                  <div>
                    <Label className="text-muted-foreground text-xs">Employee Code</Label>
                    <p className="font-medium">{selectedClaim.employeeCode || "-"}</p>
                  </div>
                  <div>
                    <Label className="text-muted-foreground text-xs">Claim Type</Label>
                    <p className="font-medium">{claimTypeLabels[selectedClaim.claimType as keyof typeof claimTypeLabels] || selectedClaim.claimType}</p>
                  </div>
                  <div>
                    <Label className="text-muted-foreground text-xs">Period</Label>
                    <p className="font-medium">{MONTH_NAMES[selectedClaim.claimMonth - 1]} {selectedClaim.claimYear}</p>
                  </div>
                  <div>
                    <Label className="text-muted-foreground text-xs">Submitted</Label>
                    <p className="font-medium">{format(new Date(selectedClaim.submittedAt), "dd MMM yyyy HH:mm")}</p>
                  </div>
                  {!isOT && (
                    <div>
                      <Label className="text-muted-foreground text-xs">Amount</Label>
                      <p className="font-medium text-lg">${parseFloat(selectedClaim.amount).toFixed(2)}</p>
                    </div>
                  )}
                </div>

                {/* OT Timesheet table — admin only */}
                {isOTSheet && timesheetRows.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-sm font-semibold">Timesheet — {MONTH_NAMES[(selectedClaim.claimMonth ?? 1) - 1]} {selectedClaim.claimYear}</p>
                    <div className="overflow-auto max-h-72 border rounded-md">
                      <table className="w-full text-xs border-collapse">
                        <thead className="bg-muted sticky top-0">
                          <tr>
                            <th className="px-2 py-1 text-left font-medium border-b">Date</th>
                            <th className="px-2 py-1 text-left font-medium border-b">Day</th>
                            <th className="px-2 py-1 text-left font-medium border-b">Customer</th>
                            <th className="px-2 py-1 text-left font-medium border-b">Proj #</th>
                            <th className="px-2 py-1 text-left font-medium border-b">Time-In</th>
                            <th className="px-2 py-1 text-left font-medium border-b">Time-Out</th>
                            <th className="px-2 py-1 text-center font-medium border-b">1.5×h</th>
                            <th className="px-2 py-1 text-center font-medium border-b">2×h</th>
                          </tr>
                        </thead>
                        <tbody>
                          {timesheetRows.map((row, i) => {
                            const isWeekend = row.dayName === "SAT" || row.dayName === "SUN";
                            return (
                              <tr key={i} className={isWeekend ? "bg-muted/40" : ""}>
                                <td className="px-2 py-1 border-b whitespace-nowrap">{row.date}</td>
                                <td className="px-2 py-1 border-b font-medium">{row.dayName}</td>
                                <td className="px-2 py-1 border-b">{row.customerName}</td>
                                <td className="px-2 py-1 border-b">{row.projectNumber}</td>
                                <td className="px-2 py-1 border-b">{row.timeIn}</td>
                                <td className="px-2 py-1 border-b">{row.timeOut}</td>
                                <td className="px-2 py-1 border-b text-center">{row.hours1_5 > 0 ? row.hours1_5 : ""}</td>
                                <td className="px-2 py-1 border-b text-center">{row.hours2 > 0 ? row.hours2 : ""}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                        <tfoot className="bg-muted sticky bottom-0">
                          <tr>
                            <td colSpan={6} className="px-2 py-1 text-right font-semibold border-t">TOTAL</td>
                            <td className="px-2 py-1 text-center font-semibold border-t">
                              {(selectedClaim as any).totalHours1_5 ? parseFloat(String((selectedClaim as any).totalHours1_5)) : ""}
                            </td>
                            <td className="px-2 py-1 text-center font-semibold border-t">
                              {(selectedClaim as any).totalHours2 ? parseFloat(String((selectedClaim as any).totalHours2)) : ""}
                            </td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                    <div className="bg-muted/50 rounded-lg p-3 flex justify-between text-sm font-semibold">
                      <span>Calculated OT Pay</span>
                      {selectedClaim.calculatedAmount
                        ? <span className="text-lg">${parseFloat(selectedClaim.calculatedAmount).toFixed(2)}</span>
                        : <span className="text-destructive text-sm">⚠️ Set hourly rate to calculate</span>
                      }
                    </div>
                  </div>
                )}

                {/* Single-day OT breakdown — admin only */}
                {isOT && !isOTSheet && (
                  <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                    <p className="text-sm font-semibold">OT Breakdown</p>
                    {selectedClaim.workDate && (
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Work Date</span>
                        <span className="font-medium">{selectedClaim.workDate}</span>
                      </div>
                    )}
                    {selectedClaim.hours1_5 && parseFloat(String(selectedClaim.hours1_5)) > 0 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">1.5× Hours</span>
                        <span className="font-medium">{selectedClaim.hours1_5}h</span>
                      </div>
                    )}
                    {selectedClaim.hours2 && parseFloat(String(selectedClaim.hours2)) > 0 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">2× Hours</span>
                        <span className="font-medium">{selectedClaim.hours2}h</span>
                      </div>
                    )}
                    <div className="border-t pt-2 flex justify-between text-sm font-semibold">
                      <span>Calculated OT Pay</span>
                      {selectedClaim.calculatedAmount
                        ? <span className="text-lg">${parseFloat(selectedClaim.calculatedAmount).toFixed(2)}</span>
                        : <span className="text-destructive text-sm">⚠️ Set hourly rate to calculate</span>
                      }
                    </div>
                  </div>
                )}

                {selectedClaim.description && (
                  <div>
                    <Label className="text-muted-foreground text-xs">{isOT ? "Notes" : "Description"}</Label>
                    <p className="text-sm bg-muted p-3 rounded-md">{selectedClaim.description}</p>
                  </div>
                )}

                {/* OT proof files */}
                {isOT && otFiles.length > 0 && (
                  <div className="space-y-2">
                    <Label className="text-muted-foreground text-xs">Supporting Documents</Label>
                    {otFiles.map((f, idx) => (
                      <Button key={idx} variant="outline" className="w-full mt-1 justify-start" asChild>
                        <a href={f.url} target="_blank" rel="noreferrer">
                          <FileText className="h-4 w-4 mr-2" />
                          {f.name}
                          <ExternalLink className="h-4 w-4 ml-auto" />
                        </a>
                      </Button>
                    ))}
                  </div>
                )}

                {/* Non-OT receipt */}
                {!isOT && selectedClaim.receiptFileName && (
                  <div>
                    <Label className="text-muted-foreground text-xs">Receipt</Label>
                    <Button variant="outline" className="w-full mt-1" onClick={() => handleViewReceipt(selectedClaim.id)} data-testid="button-view-receipt">
                      <FileText className="h-4 w-4 mr-2" />
                      {selectedClaim.receiptFileName}
                      <ExternalLink className="h-4 w-4 ml-auto" />
                    </Button>
                  </div>
                )}

                <div className="flex items-center gap-2">
                  <Label className="text-muted-foreground text-xs">Status</Label>
                  {getStatusBadge(selectedClaim.status)}
                </div>

                {/* Pending: Approve / Reject */}
                {selectedClaim.status === "pending" && (
                  <>
                    <div>
                      <Label htmlFor="comments">Review Comments (Optional)</Label>
                      <Textarea id="comments" value={reviewComments} onChange={e => setReviewComments(e.target.value)} placeholder="Add any comments..." rows={3} data-testid="input-review-comments" />
                    </div>
                    <div className="flex gap-2 pt-2">
                      <Button variant="destructive" className="flex-1" onClick={() => updateClaimMutation.mutate({ id: selectedClaim.id, status: "rejected" })} disabled={updateClaimMutation.isPending} data-testid="button-reject-claim">
                        <XCircle className="h-4 w-4 mr-2" /> Reject
                      </Button>
                      <Button className="flex-1 bg-green-600 hover:bg-green-700" onClick={() => updateClaimMutation.mutate({ id: selectedClaim.id, status: "approved" })} disabled={updateClaimMutation.isPending} data-testid="button-approve-claim">
                        <CheckCircle className="h-4 w-4 mr-2" /> Approve
                      </Button>
                    </div>
                  </>
                )}

                {/* Approved: Reject / Processed */}
                {selectedClaim.status === "approved" && (
                  <>
                    <div>
                      <Label htmlFor="comments">Comments (Optional)</Label>
                      <Textarea id="comments" value={reviewComments} onChange={e => setReviewComments(e.target.value)} placeholder="Add any comments..." rows={3} data-testid="input-review-comments" />
                    </div>
                    <div className="flex gap-2 pt-2">
                      <Button variant="destructive" className="flex-1" onClick={() => updateClaimMutation.mutate({ id: selectedClaim.id, status: "rejected" })} disabled={updateClaimMutation.isPending} data-testid="button-reject-claim">
                        <XCircle className="h-4 w-4 mr-2" /> Reject
                      </Button>
                      <Button className="flex-1 bg-blue-600 hover:bg-blue-700" onClick={() => updateClaimMutation.mutate({ id: selectedClaim.id, status: "processed" })} disabled={updateClaimMutation.isPending} data-testid="button-process-claim">
                        <CheckCheck className="h-4 w-4 mr-2" /> Mark Processed
                      </Button>
                    </div>
                  </>
                )}

                {/* Processed / Rejected: Reverse to Pending */}
                {(selectedClaim.status === "processed" || selectedClaim.status === "rejected") && (
                  <div className="pt-2">
                    <Button variant="outline" className="w-full" onClick={() => updateClaimMutation.mutate({ id: selectedClaim.id, status: "pending" })} disabled={updateClaimMutation.isPending} data-testid="button-reverse-claim">
                      <History className="h-4 w-4 mr-2" /> Reverse to Pending
                    </Button>
                  </div>
                )}

                <div className="border-t pt-4 mt-2">
                  <Button variant="ghost" className="w-full text-destructive" onClick={() => { setSelectedClaim(null); handleDeleteClick(selectedClaim); }} data-testid="button-delete-claim">
                    <Trash2 className="h-4 w-4 mr-2" /> Delete Claim
                  </Button>
                </div>
              </div>
              );
            })()}
          </DialogContent>
        </Dialog>

        {/* Delete Confirmation */}
        <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-destructive" />
                Delete Claim
              </AlertDialogTitle>
              <AlertDialogDescription>
                This action cannot be undone. This will permanently delete the claim
                {claimToDelete && ` from ${toTitleCase(claimToDelete.employeeName)} for $${parseFloat(claimToDelete.amount).toFixed(2)}`}.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="py-4">
              <Label htmlFor="delete-reason">Reason for deletion (optional)</Label>
              <Input id="delete-reason" value={deleteReason} onChange={e => setDeleteReason(e.target.value)} placeholder="Enter reason for deleting this claim..." className="mt-2" data-testid="input-delete-reason" />
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => claimToDelete && deleteClaimMutation.mutate({ id: claimToDelete.id, reason: deleteReason })} className="bg-destructive text-destructive-foreground" disabled={deleteClaimMutation.isPending} data-testid="button-confirm-delete">
                {deleteClaimMutation.isPending ? "Deleting..." : "Delete"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}

interface ClaimRowProps {
  claim: Claim;
  onView: () => void;
  onViewReceipt: () => void;
  actions?: React.ReactNode;
}

function ClaimRow({ claim, onView, onViewReceipt, actions }: ClaimRowProps) {
  const isOT = claim.claimType === "overtime";
  const isOTSheet = claim.claimType === "ot_timesheet";
  return (
    <div className="flex items-center justify-between p-4 border rounded-lg hover-elevate gap-4" data-testid={`claim-row-${claim.id}`}>
      <div className="space-y-1 flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium">{toTitleCase(claim.employeeName)}</span>
          {claim.employeeCode && <span className="text-sm text-muted-foreground">({claim.employeeCode})</span>}
        </div>
        <div className="flex items-center gap-2 text-sm flex-wrap">
          <Badge variant="outline">{claimTypeLabels[claim.claimType as keyof typeof claimTypeLabels] || claim.claimType}</Badge>
          {isOTSheet
            ? <span className="text-muted-foreground">{MONTH_NAMES[(claim.claimMonth ?? 1) - 1]} {claim.claimYear}</span>
            : isOT && claim.workDate
              ? <span className="text-muted-foreground">Work date: {claim.workDate}</span>
              : claim.description && <span className="text-muted-foreground truncate max-w-xs">{claim.description}</span>}
        </div>
        {isOTSheet && (
          <p className="text-xs text-muted-foreground">
            {(claim as any).totalHours1_5 && parseFloat(String((claim as any).totalHours1_5)) > 0 && `1.5× ${(claim as any).totalHours1_5}h`}
            {(claim as any).totalHours1_5 && parseFloat(String((claim as any).totalHours1_5)) > 0 && (claim as any).totalHours2 && parseFloat(String((claim as any).totalHours2)) > 0 && " · "}
            {(claim as any).totalHours2 && parseFloat(String((claim as any).totalHours2)) > 0 && `2× ${(claim as any).totalHours2}h`}
          </p>
        )}
        {isOT && !isOTSheet && (
          <p className="text-xs text-muted-foreground">
            {claim.hours1_5 && parseFloat(String(claim.hours1_5)) > 0 && `1.5× ${claim.hours1_5}h`}
            {claim.hours1_5 && parseFloat(String(claim.hours1_5)) > 0 && claim.hours2 && parseFloat(String(claim.hours2)) > 0 && " · "}
            {claim.hours2 && parseFloat(String(claim.hours2)) > 0 && `2× ${claim.hours2}h`}
          </p>
        )}
        <p className="text-xs text-muted-foreground">Submitted: {format(new Date(claim.submittedAt), "dd MMM yyyy")}</p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <p className="text-lg font-semibold">${parseFloat(claim.amount).toFixed(2)}</p>
        {claim.receiptFileName && (
          <Button variant="ghost" size="icon" onClick={e => { e.stopPropagation(); onViewReceipt(); }} data-testid={`button-receipt-${claim.id}`}>
            <FileText className="h-4 w-4" />
          </Button>
        )}
        <Button variant="outline" size="sm" onClick={onView} data-testid={`button-view-${claim.id}`}>
          <Eye className="h-4 w-4 mr-1" />
          View
        </Button>
        {actions}
      </div>
    </div>
  );
}
