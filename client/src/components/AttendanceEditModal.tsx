import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Loader2, Calendar, Clock, Trash2 } from "lucide-react";
import type { LeaveTypeRow } from "@shared/schema";

type LeaveType = string;  // codes are dynamic — populated from /api/leave-types
type AdjustmentType = "leave" | "hours";

interface AttendanceAdjustment {
  id: string;
  userId: string;
  date: string;
  adjustmentType: string; // "leave" | "hours" - comes from database as string
  leaveType: string | null;
  regularHours: number | null;
  otHours: number | null;
  clockInTime: string | null;
  clockOutTime: string | null;
  notes: string | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

interface AttendanceEditModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
  userName: string;
  date: string;
  actualHours: number;
  existingAdjustment?: AttendanceAdjustment | null;
  onSuccess?: () => void;
}

export function AttendanceEditModal({
  open,
  onOpenChange,
  userId,
  userName,
  date,
  actualHours,
  existingAdjustment,
  onSuccess,
}: AttendanceEditModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [adjustmentType, setAdjustmentType] = useState<AdjustmentType>("leave");
  const [leaveType, setLeaveType] = useState<LeaveType>("AL");

  // Active leave types for the dropdown
  const { data: leaveTypesData } = useQuery<{ leaveTypes: LeaveTypeRow[] }>({
    queryKey: ["/api/leave-types"],
  });
  const activeLeaveTypes = leaveTypesData?.leaveTypes || [];
  const [regularHours, setRegularHours] = useState<string>("9");
  const [otHours, setOtHours] = useState<string>("0");
  const [clockInTime, setClockInTime] = useState<string>("");
  const [clockOutTime, setClockOutTime] = useState<string>("");
  const [hoursManuallyEdited, setHoursManuallyEdited] = useState(false);
  const [notes, setNotes] = useState<string>("");

  const calcHoursFromTimes = (inTime: string, outTime: string): number | null => {
    if (!inTime || !outTime) return null;
    const [inH, inM] = inTime.split(":").map(Number);
    const [outH, outM] = outTime.split(":").map(Number);
    let mins = (outH * 60 + outM) - (inH * 60 + inM);
    if (mins <= 0) mins += 24 * 60; // crosses midnight
    return Math.round((mins / 60) * 2) / 2; // round to nearest 0.5
  };

  useEffect(() => {
    if (existingAdjustment) {
      setAdjustmentType((existingAdjustment.adjustmentType === "hours" ? "hours" : "leave") as AdjustmentType);
      // Accept any historical leave type code — preserves existing rows even if the type was later archived
      setLeaveType(existingAdjustment.leaveType || "AL");
      setRegularHours(existingAdjustment.regularHours?.toString() || "9");
      setOtHours(existingAdjustment.otHours?.toString() || "0");
      setClockInTime(existingAdjustment.clockInTime || "");
      setClockOutTime(existingAdjustment.clockOutTime || "");
      setHoursManuallyEdited(false);
      setNotes(existingAdjustment.notes || "");
    } else {
      setAdjustmentType("leave");
      setLeaveType("AL");
      setRegularHours("9");
      setOtHours("0");
      setClockInTime("");
      setClockOutTime("");
      setHoursManuallyEdited(false);
      setNotes("");
    }
  }, [existingAdjustment, open]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", "/api/admin/attendance/adjustments", {
        userId,
        date,
        adjustmentType,
        leaveType: adjustmentType === "leave" ? leaveType : null,
        regularHours: adjustmentType === "hours" ? parseFloat(regularHours) || 0 : null,
        otHours: adjustmentType === "hours" ? parseFloat(otHours) || 0 : null,
        clockInTime:  adjustmentType === "hours" && clockInTime  ? clockInTime  : null,
        clockOutTime: adjustmentType === "hours" && clockOutTime ? clockOutTime : null,
        notes: notes.trim() || null,
      });
    },
    onSuccess: () => {
      toast({
        title: "Adjustment saved",
        description: `Attendance adjustment for ${userName} on ${date} has been saved.`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/attendance"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/attendance/adjustments"] });
      onOpenChange(false);
      onSuccess?.();
    },
    onError: (error: any) => {
      toast({
        title: "Failed to save adjustment",
        description: error?.message || "An error occurred",
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!existingAdjustment) return;
      return await apiRequest("DELETE", `/api/admin/attendance/adjustments/${existingAdjustment.id}`);
    },
    onSuccess: () => {
      toast({
        title: "Adjustment removed",
        description: `Reverting to actual clock-in data for ${userName} on ${date}.`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/attendance"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/attendance/adjustments"] });
      onOpenChange(false);
      onSuccess?.();
    },
    onError: (error: any) => {
      toast({
        title: "Failed to remove adjustment",
        description: error?.message || "An error occurred",
        variant: "destructive",
      });
    },
  });

  const handleSave = () => {
    saveMutation.mutate();
  };

  const handleDelete = () => {
    deleteMutation.mutate();
  };

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString("en-SG", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            Edit Attendance
          </DialogTitle>
          <DialogDescription>
            Adjust attendance for {userName} on {formatDate(date)}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="bg-muted/50 p-3 rounded-md text-sm">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Clock className="h-4 w-4" />
              <span>Actual clocked hours: <strong className="text-foreground">{actualHours.toFixed(1)} hrs</strong></span>
            </div>
          </div>

          <div className="space-y-3">
            <Label>Adjustment Type</Label>
            <RadioGroup
              value={adjustmentType}
              onValueChange={(v) => setAdjustmentType(v as AdjustmentType)}
              className="flex gap-4"
            >
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="leave" id="leave" data-testid="radio-leave" />
                <Label htmlFor="leave" className="font-normal cursor-pointer">Leave (count as 9 hrs)</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="hours" id="hours" data-testid="radio-hours" />
                <Label htmlFor="hours" className="font-normal cursor-pointer">Override Hours</Label>
              </div>
            </RadioGroup>
          </div>

          {adjustmentType === "leave" && (
            <div className="space-y-2">
              <Label htmlFor="leaveType">Leave Type</Label>
              <Select value={leaveType} onValueChange={(v) => setLeaveType(v as LeaveType)}>
                <SelectTrigger data-testid="select-leave-type">
                  <SelectValue placeholder="Select leave type" />
                </SelectTrigger>
                <SelectContent>
                  {activeLeaveTypes.map((lt) => (
                    <SelectItem key={lt.code} value={lt.code}>
                      {lt.label} ({lt.code})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Leave counts as 9 regular hours for payroll (4.5 hrs for Half Day Leave).
              </p>
            </div>
          )}

          {adjustmentType === "hours" && (
            <div className="space-y-4">
              {/* Clock-in / Clock-out time inputs */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="clockInTime">Clock In Time</Label>
                  <Input
                    id="clockInTime"
                    type="time"
                    value={clockInTime}
                    onChange={(e) => {
                      setClockInTime(e.target.value);
                      if (!hoursManuallyEdited) {
                        const calculated = calcHoursFromTimes(e.target.value, clockOutTime);
                        if (calculated !== null) setRegularHours(String(calculated));
                      }
                    }}
                    data-testid="input-clock-in-time"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="clockOutTime">Clock Out Time</Label>
                  <Input
                    id="clockOutTime"
                    type="time"
                    value={clockOutTime}
                    onChange={(e) => {
                      setClockOutTime(e.target.value);
                      if (!hoursManuallyEdited) {
                        const calculated = calcHoursFromTimes(clockInTime, e.target.value);
                        if (calculated !== null) setRegularHours(String(calculated));
                      }
                    }}
                    data-testid="input-clock-out-time"
                  />
                </div>
                {clockInTime && clockOutTime && (() => {
                  const h = calcHoursFromTimes(clockInTime, clockOutTime);
                  return h !== null ? (
                    <p className="text-xs text-muted-foreground col-span-2">
                      Duration: <strong>{h} hrs</strong> (auto-filled below — edit to override)
                    </p>
                  ) : null;
                })()}
              </div>

              {/* Regular / OT hours */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="regularHours">Regular Hours</Label>
                  <Input
                    id="regularHours"
                    type="number"
                    min="0"
                    max="24"
                    step="0.5"
                    value={regularHours}
                    onChange={(e) => {
                      setRegularHours(e.target.value);
                      setHoursManuallyEdited(true);
                    }}
                    data-testid="input-regular-hours"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="otHours">OT Hours</Label>
                  <Input
                    id="otHours"
                    type="number"
                    min="0"
                    max="24"
                    step="0.5"
                    value={otHours}
                    onChange={(e) => setOtHours(e.target.value)}
                    data-testid="input-ot-hours"
                  />
                </div>
                <p className="text-xs text-muted-foreground col-span-2">
                  Overrides actual hours for payroll. Clock-in/out times are stored for reference.
                </p>
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="notes">Notes (optional)</Label>
            <Textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Reason for adjustment..."
              rows={2}
              data-testid="input-notes"
            />
          </div>
        </div>

        <div className="flex flex-row items-center justify-between gap-3 pt-4 border-t mt-2">
          <div className="flex-shrink-0">
            {existingAdjustment && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleDelete}
                disabled={deleteMutation.isPending || saveMutation.isPending}
                className="text-destructive hover:text-destructive"
                data-testid="button-delete-adjustment"
              >
                {deleteMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Trash2 className="h-4 w-4 mr-2" />
                )}
                Revert to Actual
              </Button>
            )}
          </div>
          <div className="flex gap-2 flex-shrink-0">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
              disabled={saveMutation.isPending || deleteMutation.isPending}
              data-testid="button-cancel"
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleSave}
              disabled={saveMutation.isPending || deleteMutation.isPending}
              data-testid="button-save-adjustment"
            >
              {saveMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Save Adjustment
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
