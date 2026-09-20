import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Plus, Pencil, Trash2, Loader2, Tag, Users, History, Play } from "lucide-react";
import type { LeaveTypeRow, EmployeeLeaveAccrualOverride, LeaveAccrualRun, User } from "@shared/schema";

const STRATEGY_LABELS: Record<string, string> = {
  monthly_fixed: "Flat",
  monthly_tenure: "AL Tenure",
  annual_reset: "Annual Reset",
  manual_only: "Manual Only",
};

export function LeaveTypesManager() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: typesData, isLoading: typesLoading } = useQuery<{ leaveTypes: LeaveTypeRow[] }>({
    queryKey: ["/api/admin/leave-types"],
  });
  const { data: overridesData, isLoading: overridesLoading } = useQuery<{ overrides: EmployeeLeaveAccrualOverride[] }>({
    queryKey: ["/api/admin/leave-overrides"],
  });
  const { data: runsData } = useQuery<{ runs: LeaveAccrualRun[] }>({
    queryKey: ["/api/admin/accrual-runs"],
  });
  const { data: usersData } = useQuery<{ users: User[] }>({
    queryKey: ["/api/admin/users"],
  });

  const types = typesData?.leaveTypes || [];
  const overrides = overridesData?.overrides || [];
  const runs = runsData?.runs || [];
  const usersList = usersData?.users || [];

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["/api/admin/leave-types"] });
    qc.invalidateQueries({ queryKey: ["/api/leave-types"] });
    qc.invalidateQueries({ queryKey: ["/api/admin/leave-overrides"] });
    qc.invalidateQueries({ queryKey: ["/api/admin/accrual-runs"] });
  };

  // ─── Type dialog state ───────────────────────────────────────────
  const [typeDialogOpen, setTypeDialogOpen] = useState(false);
  const [editingType, setEditingType] = useState<LeaveTypeRow | null>(null);
  const [tCode, setTCode] = useState("");
  const [tLabel, setTLabel] = useState("");
  const [tActive, setTActive] = useState(true);
  const [tInitial, setTInitial] = useState("0");
  const [tMonthly, setTMonthly] = useState("0");
  type AccrualStrategy = "monthly_fixed" | "monthly_tenure" | "annual_reset" | "manual_only";
  const [tStrategy, setTStrategy] = useState<AccrualStrategy>("monthly_fixed");

  const resetTypeForm = () => {
    setTCode(""); setTLabel(""); setTActive(true); setTInitial("0");
    setTMonthly("0"); setTStrategy("monthly_fixed"); setEditingType(null);
  };

  const openCreateType = () => { resetTypeForm(); setTypeDialogOpen(true); };
  const openEditType = (t: LeaveTypeRow) => {
    setEditingType(t);
    setTCode(t.code);
    setTLabel(t.label);
    setTActive(t.isActive);
    setTInitial(String(t.initialBalance));
    setTMonthly(String(t.monthlyAccrual));
    setTStrategy(t.accrualStrategy as AccrualStrategy);
    setTypeDialogOpen(true);
  };

  const saveTypeMutation = useMutation({
    mutationFn: async () => {
      const payload: any = {
        label: tLabel,
        isActive: tActive,
        initialBalance: parseFloat(tInitial) || 0,
        monthlyAccrual: parseFloat(tMonthly) || 0,
        accrualStrategy: tStrategy,
      };
      if (editingType) {
        return apiRequest("PATCH", `/api/admin/leave-types/${editingType.id}`, payload);
      } else {
        return apiRequest("POST", "/api/admin/leave-types", { code: tCode, ...payload });
      }
    },
    onSuccess: () => {
      toast({ title: editingType ? "Leave type updated" : "Leave type created" });
      setTypeDialogOpen(false); resetTypeForm(); invalidate();
    },
    onError: (err: Error) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  const handleSaveType = () => {
    if (!editingType) {
      const code = tCode.trim().toUpperCase();
      if (!/^[A-Z0-9_]{2,10}$/.test(code)) {
        toast({ title: "Invalid code", description: "2-10 chars, A-Z, 0-9, _ only", variant: "destructive" });
        return;
      }
    }
    if (!tLabel.trim()) {
      toast({ title: "Label required", variant: "destructive" });
      return;
    }
    saveTypeMutation.mutate();
  };

  // ─── Override dialog state ───────────────────────────────────────
  const [ovDialogOpen, setOvDialogOpen] = useState(false);
  const [editingOv, setEditingOv] = useState<EmployeeLeaveAccrualOverride | null>(null);
  const [ovUserId, setOvUserId] = useState("");
  const [ovTypeCode, setOvTypeCode] = useState("");
  const [ovExtra, setOvExtra] = useState("0");
  const [ovNotes, setOvNotes] = useState("");

  const resetOvForm = () => {
    setOvUserId(""); setOvTypeCode(""); setOvExtra("0"); setOvNotes(""); setEditingOv(null);
  };

  const openCreateOv = () => { resetOvForm(); setOvDialogOpen(true); };
  const openEditOv = (o: EmployeeLeaveAccrualOverride) => {
    setEditingOv(o);
    setOvUserId(o.userId);
    setOvTypeCode(o.leaveTypeCode);
    setOvExtra(String(o.extraMonthlyAccrual));
    setOvNotes(o.notes || "");
    setOvDialogOpen(true);
  };

  const saveOvMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        extraMonthlyAccrual: parseFloat(ovExtra) || 0,
        notes: ovNotes.trim() || null,
      };
      if (editingOv) {
        return apiRequest("PATCH", `/api/admin/leave-overrides/${editingOv.id}`, payload);
      } else {
        return apiRequest("POST", "/api/admin/leave-overrides", {
          userId: ovUserId,
          leaveTypeCode: ovTypeCode,
          ...payload,
        });
      }
    },
    onSuccess: () => {
      toast({ title: editingOv ? "Override updated" : "Override created" });
      setOvDialogOpen(false); resetOvForm(); invalidate();
    },
    onError: (err: Error) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  const deleteOvMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/admin/leave-overrides/${id}`),
    onSuccess: () => { toast({ title: "Override removed" }); invalidate(); },
    onError: (err: Error) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  const handleSaveOv = () => {
    if (!editingOv && (!ovUserId || !ovTypeCode)) {
      toast({ title: "Pick employee and leave type", variant: "destructive" });
      return;
    }
    saveOvMutation.mutate();
  };

  // ─── Manual trigger ──────────────────────────────────────────────
  const triggerMutation = useMutation({
    mutationFn: async () => apiRequest("POST", "/api/admin/accrual-runs/trigger", {}),
    onSuccess: (res: any) => {
      if (res?.skipped) {
        toast({ title: "Already accrued this month", description: res.reason });
      } else {
        toast({ title: "Accrual run complete", description: `Touched ${res.rowsTouched} rows; cleared ${res.negativesCleared} negatives` });
      }
      invalidate();
    },
    onError: (err: Error) => toast({ title: "Run failed", description: err.message, variant: "destructive" }),
  });

  const userById = (id: string) => usersList.find(u => u.id === id)?.name || id.slice(0, 8);
  const activeTypes = types.filter(t => t.isActive);

  return (
    <div className="space-y-6">
      {/* ─── Section 1: Leave Types ─── */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <CardTitle className="flex items-center gap-2">
              <Tag className="h-5 w-5" />
              Leave Types
            </CardTitle>
            <Button size="sm" onClick={openCreateType} data-testid="button-new-leave-type">
              <Plus className="h-4 w-4 mr-2" /> New Leave Type
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">
            Active types appear in employee leave-application dropdowns. Codes are immutable after creation.
          </p>
        </CardHeader>
        <CardContent>
          {typesLoading ? (
            <div className="py-8 text-center text-sm text-muted-foreground">Loading…</div>
          ) : types.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">No leave types yet.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Label</TableHead>
                  <TableHead>Active</TableHead>
                  <TableHead className="text-right">Initial</TableHead>
                  <TableHead className="text-right">Monthly</TableHead>
                  <TableHead>Strategy</TableHead>
                  <TableHead className="w-20"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {types.map(t => (
                  <TableRow key={t.id} data-testid={`row-type-${t.code}`}>
                    <TableCell className="font-mono">{t.code}</TableCell>
                    <TableCell>{t.label}</TableCell>
                    <TableCell>
                      {t.isActive ? <Badge>Active</Badge> : <Badge variant="outline">Archived</Badge>}
                    </TableCell>
                    <TableCell className="text-right">{Number(t.initialBalance).toFixed(2)}</TableCell>
                    <TableCell className="text-right">
                      {t.accrualStrategy === "monthly_tenure" ? "auto" : Number(t.monthlyAccrual).toFixed(2)}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{STRATEGY_LABELS[t.accrualStrategy] || t.accrualStrategy}</Badge>
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" onClick={() => openEditType(t)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* ─── Section 2: Per-Employee Overrides ─── */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Per-Employee Overrides
            </CardTitle>
            <Button size="sm" onClick={openCreateOv} data-testid="button-new-override">
              <Plus className="h-4 w-4 mr-2" /> New Override
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">
            Adds (or subtracts, if negative) extra days per month on top of the leave type's base accrual for a specific employee.
          </p>
        </CardHeader>
        <CardContent>
          {overridesLoading ? (
            <div className="py-8 text-center text-sm text-muted-foreground">Loading…</div>
          ) : overrides.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">No overrides set.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Leave Type</TableHead>
                  <TableHead className="text-right">Extra/Month</TableHead>
                  <TableHead>Notes</TableHead>
                  <TableHead className="w-28"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {overrides.map(o => (
                  <TableRow key={o.id} data-testid={`row-override-${o.id}`}>
                    <TableCell>{userById(o.userId)}</TableCell>
                    <TableCell className="font-mono">{o.leaveTypeCode}</TableCell>
                    <TableCell className="text-right">{Number(o.extraMonthlyAccrual).toFixed(2)}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{o.notes || "—"}</TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" onClick={() => openEditOv(o)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive"
                        onClick={() => { if (confirm("Delete this override?")) deleteOvMutation.mutate(o.id); }}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* ─── Section 3: Accrual Run Log ─── */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <CardTitle className="flex items-center gap-2">
              <History className="h-5 w-5" />
              Accrual Run History
            </CardTitle>
            <Button size="sm" variant="outline" onClick={() => triggerMutation.mutate()} disabled={triggerMutation.isPending}
              data-testid="button-trigger-accrual">
              {triggerMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Play className="h-4 w-4 mr-2" />}
              Run accrual now
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">
            Last 12 monthly runs. The "Run now" button is idempotent — it's a no-op if this month's run already completed.
          </p>
        </CardHeader>
        <CardContent>
          {runs.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">No accrual runs yet.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Period</TableHead>
                  <TableHead>Started</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Rows touched</TableHead>
                  <TableHead>Triggered by</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.map(r => (
                  <TableRow key={r.id}>
                    <TableCell>{r.year}-{String(r.month).padStart(2, "0")}</TableCell>
                    <TableCell className="text-sm">
                      {new Date(r.startedAt).toLocaleString("en-SG", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                    </TableCell>
                    <TableCell>
                      {r.status === "completed" ? <Badge>Completed</Badge> :
                        r.status === "failed" ? <Badge variant="destructive">Failed</Badge> :
                          <Badge variant="outline">Running</Badge>}
                    </TableCell>
                    <TableCell className="text-right">{r.rowsTouched}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{r.triggeredBy}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* ─── Type create/edit dialog ─── */}
      <Dialog open={typeDialogOpen} onOpenChange={(o) => { setTypeDialogOpen(o); if (!o) resetTypeForm(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingType ? `Edit ${editingType.code}` : "New Leave Type"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="t-code">Code (immutable after creation)</Label>
              <Input id="t-code" value={tCode} onChange={(e) => setTCode(e.target.value.toUpperCase())}
                disabled={!!editingType} placeholder="e.g., AL, MC, PAT" maxLength={10}
                data-testid="input-type-code" />
              <p className="text-xs text-muted-foreground">2-10 chars, A-Z 0-9 _ only</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="t-label">Label</Label>
              <Input id="t-label" value={tLabel} onChange={(e) => setTLabel(e.target.value)}
                placeholder="e.g., Annual Leave" maxLength={100} data-testid="input-type-label" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="t-initial">Initial Balance</Label>
                <Input id="t-initial" type="number" step="0.5" min="0" value={tInitial} onChange={(e) => setTInitial(e.target.value)} />
                <p className="text-xs text-muted-foreground">Granted to new employees on first accrual</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="t-monthly">Monthly Accrual</Label>
                <Input id="t-monthly" type="number" step="0.01" min="0" value={tMonthly} onChange={(e) => setTMonthly(e.target.value)}
                  disabled={tStrategy === "monthly_tenure"} />
                <p className="text-xs text-muted-foreground">{tStrategy === "monthly_tenure" ? "Auto from join_date" : "Days added per month"}</p>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="t-strategy">Accrual Strategy</Label>
              <Select value={tStrategy} onValueChange={(v) => setTStrategy(v as AccrualStrategy)}>
                <SelectTrigger id="t-strategy"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="monthly_fixed">Flat (use Monthly Accrual value)</SelectItem>
                  <SelectItem value="monthly_tenure">AL Tenure (auto from join_date, 7→14)</SelectItem>
                  <SelectItem value="annual_reset">Annual Reset (set once in January)</SelectItem>
                  <SelectItem value="manual_only">Manual Only (no auto-accrual)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Switch id="t-active" checked={tActive} onCheckedChange={setTActive} />
              <Label htmlFor="t-active" className="font-normal cursor-pointer">Active (visible to employees)</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setTypeDialogOpen(false); resetTypeForm(); }}>Cancel</Button>
            <Button onClick={handleSaveType} disabled={saveTypeMutation.isPending}>
              {saveTypeMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {editingType ? "Save Changes" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Override create/edit dialog ─── */}
      <Dialog open={ovDialogOpen} onOpenChange={(o) => { setOvDialogOpen(o); if (!o) resetOvForm(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingOv ? "Edit Override" : "New Override"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {!editingOv && (
              <>
                <div className="space-y-2">
                  <Label>Employee</Label>
                  <Select value={ovUserId} onValueChange={setOvUserId}>
                    <SelectTrigger><SelectValue placeholder="Select employee…" /></SelectTrigger>
                    <SelectContent>
                      {usersList.filter(u => !u.isArchived).map(u => (
                        <SelectItem key={u.id} value={u.id}>{u.name} ({u.email})</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Leave Type</Label>
                  <Select value={ovTypeCode} onValueChange={setOvTypeCode}>
                    <SelectTrigger><SelectValue placeholder="Select type…" /></SelectTrigger>
                    <SelectContent>
                      {activeTypes.map(t => (
                        <SelectItem key={t.id} value={t.code}>{t.label} ({t.code})</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}
            {editingOv && (
              <div className="text-sm text-muted-foreground">
                <strong>{userById(editingOv.userId)}</strong> · <span className="font-mono">{editingOv.leaveTypeCode}</span>
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="ov-extra">Extra Monthly Accrual</Label>
              <Input id="ov-extra" type="number" step="0.01" value={ovExtra} onChange={(e) => setOvExtra(e.target.value)} />
              <p className="text-xs text-muted-foreground">Negative values reduce the base accrual.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="ov-notes">Notes (optional)</Label>
              <Input id="ov-notes" value={ovNotes} onChange={(e) => setOvNotes(e.target.value)} placeholder="Reason for override…" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setOvDialogOpen(false); resetOvForm(); }}>Cancel</Button>
            <Button onClick={handleSaveOv} disabled={saveOvMutation.isPending}>
              {saveOvMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {editingOv ? "Save Changes" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
