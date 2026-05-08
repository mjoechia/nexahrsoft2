import { useState, useRef, useEffect, useCallback } from "react";
import { Receipt, Plus, Upload, X, FileText, Clock, CheckCircle, XCircle, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import type { Claim, TimesheetRow } from "@shared/schema";
import { claimTypeLabels } from "@shared/schema";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

const CLAIM_TYPES = [
  { value: "transport", label: "Transport" },
  { value: "material_purchase", label: "Material Purchase" },
  { value: "other", label: "Other" },
  { value: "overtime", label: "Overtime (OT)" },
  { value: "ot_timesheet", label: "OT Timesheet (Monthly)" },
];

const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const DAY_NAMES   = ["SUN","MON","TUE","WED","THU","FRI","SAT"];

const ALLOWED_FILE_TYPES = ".pdf,.jpg,.jpeg,.png";
const MAX_FILE_SIZE_MB = 5;
const MAX_OT_FILES = 5;
const MAX_RECEIPT_FILES = 3;

export default function ClaimsPage() {
  const [open, setOpen] = useState(false);
  const [claimType, setClaimType] = useState("");
  // Non-OT fields
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [receiptFiles, setReceiptFiles] = useState<File[]>([]);
  // OT fields
  const [workDate, setWorkDate] = useState("");
  const [hours1_5, setHours1_5] = useState("");
  const [hours2, setHours2] = useState("");
  const [otNotes, setOtNotes] = useState("");
  const [otFiles, setOtFiles] = useState<File[]>([]);

  // OT Timesheet state
  const [timesheetMonth, setTimesheetMonth] = useState(new Date().getMonth() + 1);
  const [timesheetYear, setTimesheetYear]   = useState(new Date().getFullYear());
  const [timesheetRows, setTimesheetRows]   = useState<TimesheetRow[]>([]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const otFilesInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const currentDate = new Date();
  const currentMonth = currentDate.getMonth() + 1;
  const currentYear = currentDate.getFullYear();

  const isOTSheet = claimType === "ot_timesheet";

  const generateTimesheetRows = useCallback((month: number, year: number): TimesheetRow[] => {
    const daysInMonth = new Date(year, month, 0).getDate();
    return Array.from({ length: daysInMonth }, (_, i) => {
      const d = new Date(year, month - 1, i + 1);
      return {
        date: `${String(i + 1).padStart(2, "0")}/${String(month).padStart(2, "0")}/${year}`,
        dayName: DAY_NAMES[d.getDay()],
        customerName: "",
        projectNumber: "",
        timeIn: "",
        timeOut: "",
        hours1_5: 0,
        hours2: 0,
      };
    });
  }, []);

  useEffect(() => {
    if (!isOTSheet) return;
    setTimesheetRows(generateTimesheetRows(timesheetMonth, timesheetYear));
  }, [isOTSheet, timesheetMonth, timesheetYear, generateTimesheetRows]);

  const updateTimesheetRow = (idx: number, field: keyof TimesheetRow, value: string | number) => {
    setTimesheetRows(prev => prev.map((r, i) => i === idx ? { ...r, [field]: value } : r));
  };

  const timesheetTotal1_5 = timesheetRows.reduce((s, r) => s + (Number(r.hours1_5) || 0), 0);
  const timesheetTotal2   = timesheetRows.reduce((s, r) => s + (Number(r.hours2)   || 0), 0);

  const yearOptions = Array.from({ length: 5 }, (_, i) => currentYear - 2 + i);

  const { data: claimsData, isLoading } = useQuery<{ claims: Claim[] }>({
    queryKey: ["/api/claims"],
  });

  const isOT = claimType === "overtime";

  const resetForm = () => {
    setClaimType("");
    setAmount("");
    setDescription("");
    setReceiptFiles([]);
    setWorkDate("");
    setHours1_5("");
    setHours2("");
    setOtNotes("");
    setOtFiles([]);
    setTimesheetMonth(new Date().getMonth() + 1);
    setTimesheetYear(new Date().getFullYear());
    setTimesheetRows([]);
  };

  const submitMutation = useMutation({
    mutationFn: async () => {
      const formData = new FormData();
      formData.append("claimType", claimType);
      formData.append("claimMonth", currentMonth.toString());
      formData.append("claimYear", currentYear.toString());

      if (isOTSheet) {
        formData.append("timesheetRows", JSON.stringify(timesheetRows));
        formData.append("claimMonth", timesheetMonth.toString());
        formData.append("claimYear", timesheetYear.toString());
        formData.append("notes", otNotes);
        for (const f of otFiles) {
          formData.append("files", f);
        }
      } else if (isOT) {
        formData.append("workDate", workDate);
        formData.append("hours1_5", hours1_5 || "0");
        formData.append("hours2", hours2 || "0");
        formData.append("notes", otNotes);
        for (const f of otFiles) {
          formData.append("files", f);
        }
      } else {
        formData.append("amount", amount);
        formData.append("description", description);
        receiptFiles.forEach(f => formData.append("receipt", f));
      }

      const response = await fetch("/api/claims", {
        method: "POST",
        body: formData,
        credentials: "include",
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to submit claim");
      }

      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Claim Submitted",
        description: "Your claim has been submitted for review.",
      });
      setOpen(false);
      resetForm();
      queryClient.invalidateQueries({ queryKey: ["/api/claims"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Submission Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleReceiptFilesChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files || []);
    const remaining = MAX_RECEIPT_FILES - receiptFiles.length;
    if (remaining <= 0) {
      toast({ title: "Max 3 receipts allowed", variant: "destructive" });
      return;
    }
    const toAdd = selected.slice(0, remaining);
    const oversized = toAdd.filter(f => f.size > MAX_FILE_SIZE_MB * 1024 * 1024);
    if (oversized.length > 0) {
      toast({ title: "File Too Large", description: `Each file must be under ${MAX_FILE_SIZE_MB}MB`, variant: "destructive" });
      return;
    }
    const deduped = toAdd.filter(nf => !receiptFiles.some(ef => ef.name === nf.name && ef.size === nf.size));
    setReceiptFiles(prev => [...prev, ...deduped]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeReceiptFile = (idx: number) => {
    setReceiptFiles(prev => prev.filter((_, i) => i !== idx));
  };

  const handleOtFilesChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files || []);
    const remaining = MAX_OT_FILES - otFiles.length;
    if (remaining <= 0) {
      toast({ title: "File Limit", description: `Maximum ${MAX_OT_FILES} files allowed`, variant: "destructive" });
      return;
    }
    const toAdd = selected.slice(0, remaining);
    const oversized = toAdd.filter(f => f.size > MAX_FILE_SIZE_MB * 1024 * 1024);
    if (oversized.length > 0) {
      toast({ title: "File Too Large", description: `Each file must be under ${MAX_FILE_SIZE_MB}MB`, variant: "destructive" });
      return;
    }
    setOtFiles(prev => [...prev, ...toAdd]);
    if (otFilesInputRef.current) otFilesInputRef.current.value = "";
  };

  const removeOtFile = (idx: number) => {
    setOtFiles(prev => prev.filter((_, i) => i !== idx));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!claimType) {
      toast({ title: "Missing Fields", description: "Please select a claim type", variant: "destructive" });
      return;
    }
    if (isOTSheet) {
      if (timesheetTotal1_5 === 0 && timesheetTotal2 === 0) {
        toast({ title: "Missing Hours", description: "Please enter overtime hours for at least one day.", variant: "destructive" });
        return;
      }
    } else if (isOT) {
      if (!workDate) {
        toast({ title: "Missing Fields", description: "Please select a work date", variant: "destructive" });
        return;
      }
      const h1 = parseFloat(hours1_5 || "0");
      const h2 = parseFloat(hours2 || "0");
      if (h1 < 0 || h2 < 0) {
        toast({ title: "Invalid Hours", description: "Please enter valid overtime hours.", variant: "destructive" });
        return;
      }
      if (h1 === 0 && h2 === 0) {
        toast({ title: "Missing Hours", description: "Please enter overtime hours.", variant: "destructive" });
        return;
      }
      if (h1 + h2 > 16) {
        toast({ title: "Limit Exceeded", description: "Total overtime cannot exceed 16 hours per day.", variant: "destructive" });
        return;
      }
    } else {
      if (!amount) {
        toast({ title: "Missing Fields", description: "Please fill in claim type and amount", variant: "destructive" });
        return;
      }
    }
    submitMutation.mutate();
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "pending":
        return <Badge variant="secondary" className="gap-1"><Clock className="h-3 w-3" /> Pending</Badge>;
      case "approved":
        return <Badge variant="default" className="gap-1 bg-green-500"><CheckCircle className="h-3 w-3" /> Approved</Badge>;
      case "processed":
        return <Badge className="gap-1 bg-blue-500"><CheckCircle className="h-3 w-3" /> Processed</Badge>;
      case "rejected":
        return <Badge variant="destructive" className="gap-1"><XCircle className="h-3 w-3" /> Rejected</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const claims = claimsData?.claims || [];

  return (
    <div className="min-h-screen bg-muted/30 p-4 md:p-8">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold" data-testid="text-page-title">Claims</h1>
            <p className="text-muted-foreground">Submit and track your expense claims</p>
          </div>
          <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) resetForm(); }}>
            <DialogTrigger asChild>
              <Button data-testid="button-new-claim">
                <Plus className="h-4 w-4 mr-2" />
                New Claim
              </Button>
            </DialogTrigger>
            <DialogContent className={isOTSheet ? "sm:max-w-5xl max-h-[90vh] overflow-y-auto" : "sm:max-w-md max-h-[90vh] overflow-y-auto"}>
              <DialogHeader>
                <DialogTitle>Submit New Claim</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4">
                {/* Claim Type */}
                <div className="space-y-2">
                  <Label htmlFor="claimType">Claim Type *</Label>
                  <Select value={claimType} onValueChange={(v) => { setClaimType(v); }}>
                    <SelectTrigger data-testid="select-claim-type">
                      <SelectValue placeholder="Select claim type" />
                    </SelectTrigger>
                    <SelectContent>
                      {CLAIM_TYPES.map((type) => (
                        <SelectItem key={type.value} value={type.value}>{type.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* ── OT FORM ── */}
                {isOT && (
                  <>
                    <div className="p-3 bg-muted/60 rounded-md flex items-start gap-2 text-sm text-muted-foreground">
                      <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                      <span>Enter overtime hours worked. Overtime pay will be calculated and verified by Admin.</span>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="workDate">Work Date *</Label>
                      <Input
                        type="date"
                        id="workDate"
                        value={workDate}
                        onChange={(e) => setWorkDate(e.target.value)}
                        max={format(new Date(), "yyyy-MM-dd")}
                        data-testid="input-work-date"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="hours1_5">OT Hours (1.5×)</Label>
                        <Input
                          type="number"
                          id="hours1_5"
                          step="0.5"
                          min="0"
                          max="16"
                          value={hours1_5}
                          onChange={(e) => setHours1_5(e.target.value)}
                          placeholder="0"
                          data-testid="input-hours-1-5"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="hours2">OT Hours (2×)</Label>
                        <Input
                          type="number"
                          id="hours2"
                          step="0.5"
                          min="0"
                          max="16"
                          value={hours2}
                          onChange={(e) => setHours2(e.target.value)}
                          placeholder="0"
                          data-testid="input-hours-2"
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="otNotes">Notes (Optional)</Label>
                      <Textarea
                        id="otNotes"
                        value={otNotes}
                        onChange={(e) => setOtNotes(e.target.value)}
                        placeholder="e.g. Project name, supervisor name..."
                        rows={2}
                        data-testid="input-ot-notes"
                      />
                    </div>

                    {/* Multi-file upload */}
                    <div className="space-y-2">
                      <Label>Supporting Documents (Optional, up to {MAX_OT_FILES} files)</Label>
                      <input
                        ref={otFilesInputRef}
                        type="file"
                        accept={ALLOWED_FILE_TYPES}
                        multiple
                        onChange={handleOtFilesChange}
                        className="hidden"
                        data-testid="input-ot-files"
                      />
                      {otFiles.length < MAX_OT_FILES && (
                        <Button
                          type="button"
                          variant="outline"
                          className="w-full"
                          onClick={() => otFilesInputRef.current?.click()}
                          data-testid="button-upload-ot-files"
                        >
                          <Upload className="h-4 w-4 mr-2" />
                          Add File ({otFiles.length}/{MAX_OT_FILES})
                        </Button>
                      )}
                      {otFiles.map((f, idx) => (
                        <div key={idx} className="flex items-center gap-2 p-2 bg-muted rounded-md text-sm">
                          <FileText className="h-4 w-4 shrink-0" />
                          <span className="flex-1 truncate">{f.name}</span>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            onClick={() => removeOtFile(idx)}
                            data-testid={`button-remove-ot-file-${idx}`}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      ))}
                      <p className="text-xs text-muted-foreground">PDF, JPG, PNG — max {MAX_FILE_SIZE_MB}MB each</p>
                    </div>
                  </>
                )}

                {/* ── OT TIMESHEET FORM ── */}
                {isOTSheet && (
                  <>
                    <div className="p-3 bg-muted/60 rounded-md flex items-start gap-2 text-sm text-muted-foreground">
                      <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                      <span>Fill in daily OT hours for the selected month. Rows with OT hours require Customer Name and Project Number.</span>
                    </div>

                    {/* Month / Year selectors */}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label>Month</Label>
                        <Select
                          value={String(timesheetMonth)}
                          onValueChange={(v) => {
                            const hasData = timesheetRows.some(r => r.customerName || r.timeIn || r.hours1_5 > 0 || r.hours2 > 0);
                            if (hasData && !window.confirm("Changing month will reset all entered data. Continue?")) return;
                            setTimesheetMonth(Number(v));
                          }}
                        >
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {MONTH_NAMES.map((name, i) => (
                              <SelectItem key={i + 1} value={String(i + 1)}>{name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label>Year</Label>
                        <Select
                          value={String(timesheetYear)}
                          onValueChange={(v) => {
                            const hasData = timesheetRows.some(r => r.customerName || r.timeIn || r.hours1_5 > 0 || r.hours2 > 0);
                            if (hasData && !window.confirm("Changing year will reset all entered data. Continue?")) return;
                            setTimesheetYear(Number(v));
                          }}
                        >
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {yearOptions.map(y => (
                              <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    {/* Timesheet table */}
                    <div className="overflow-auto max-h-96 border rounded-md">
                      <table className="w-full text-sm border-collapse">
                        <thead className="bg-muted sticky top-0">
                          <tr>
                            <th className="px-2 py-2 text-left font-medium border-b w-16">Date</th>
                            <th className="px-2 py-2 text-left font-medium border-b w-12">Day</th>
                            <th className="px-2 py-2 text-left font-medium border-b">Customer Name</th>
                            <th className="px-2 py-2 text-left font-medium border-b w-24">Proj #</th>
                            <th className="px-2 py-2 text-left font-medium border-b w-20">Time-In</th>
                            <th className="px-2 py-2 text-left font-medium border-b w-20">Time-Out</th>
                            <th className="px-2 py-2 text-center font-medium border-b w-16">1.5×h</th>
                            <th className="px-2 py-2 text-center font-medium border-b w-16">2×h</th>
                          </tr>
                        </thead>
                        <tbody>
                          {timesheetRows.map((row, idx) => {
                            const isWeekend = row.dayName === "SAT" || row.dayName === "SUN";
                            return (
                              <tr key={idx} className={isWeekend ? "bg-muted/40" : ""}>
                                <td className="px-2 py-1 border-b text-xs text-muted-foreground whitespace-nowrap">{row.date}</td>
                                <td className="px-2 py-1 border-b text-xs font-medium">{row.dayName}</td>
                                <td className="px-1 py-1 border-b">
                                  <Input
                                    className="h-7 text-xs px-1"
                                    value={row.customerName}
                                    onChange={e => updateTimesheetRow(idx, "customerName", e.target.value)}
                                    placeholder="Customer / Location"
                                  />
                                </td>
                                <td className="px-1 py-1 border-b">
                                  <Input
                                    className="h-7 text-xs px-1"
                                    value={row.projectNumber}
                                    onChange={e => updateTimesheetRow(idx, "projectNumber", e.target.value)}
                                    placeholder="Proj #"
                                  />
                                </td>
                                <td className="px-1 py-1 border-b">
                                  <Input
                                    className="h-7 text-xs px-1"
                                    value={row.timeIn}
                                    onChange={e => updateTimesheetRow(idx, "timeIn", e.target.value)}
                                    placeholder="09:00"
                                  />
                                </td>
                                <td className="px-1 py-1 border-b">
                                  <Input
                                    className="h-7 text-xs px-1"
                                    value={row.timeOut}
                                    onChange={e => updateTimesheetRow(idx, "timeOut", e.target.value)}
                                    placeholder="18:00"
                                  />
                                </td>
                                <td className="px-1 py-1 border-b">
                                  <Input
                                    type="number"
                                    className="h-7 text-xs px-1 text-center"
                                    step="0.5"
                                    min="0"
                                    value={row.hours1_5 || ""}
                                    onChange={e => updateTimesheetRow(idx, "hours1_5", parseFloat(e.target.value) || 0)}
                                    placeholder="0"
                                  />
                                </td>
                                <td className="px-1 py-1 border-b">
                                  <Input
                                    type="number"
                                    className="h-7 text-xs px-1 text-center"
                                    step="0.5"
                                    min="0"
                                    value={row.hours2 || ""}
                                    onChange={e => updateTimesheetRow(idx, "hours2", parseFloat(e.target.value) || 0)}
                                    placeholder="0"
                                  />
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                        <tfoot className="bg-muted sticky bottom-0">
                          <tr>
                            <td colSpan={6} className="px-2 py-2 text-right font-semibold text-sm border-t">TOTAL</td>
                            <td className="px-2 py-2 text-center font-semibold border-t">{timesheetTotal1_5 || ""}</td>
                            <td className="px-2 py-2 text-center font-semibold border-t">{timesheetTotal2 || ""}</td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>

                    {/* Notes */}
                    <div className="space-y-2">
                      <Label>Notes (Optional)</Label>
                      <Textarea
                        value={otNotes}
                        onChange={(e) => setOtNotes(e.target.value)}
                        placeholder="Additional remarks..."
                        rows={2}
                      />
                    </div>

                    {/* File upload (reuse OT file logic) */}
                    <div className="space-y-2">
                      <Label>Supporting Documents (Optional, up to {MAX_OT_FILES} files)</Label>
                      <input
                        ref={otFilesInputRef}
                        type="file"
                        accept={ALLOWED_FILE_TYPES}
                        multiple
                        onChange={handleOtFilesChange}
                        className="hidden"
                      />
                      {otFiles.length < MAX_OT_FILES && (
                        <Button type="button" variant="outline" className="w-full" onClick={() => otFilesInputRef.current?.click()}>
                          <Upload className="h-4 w-4 mr-2" />
                          Add File ({otFiles.length}/{MAX_OT_FILES})
                        </Button>
                      )}
                      {otFiles.map((f, idx) => (
                        <div key={idx} className="flex items-center gap-2 p-2 bg-muted rounded-md text-sm">
                          <FileText className="h-4 w-4 shrink-0" />
                          <span className="flex-1 truncate">{f.name}</span>
                          <Button type="button" variant="ghost" size="icon" className="h-6 w-6" onClick={() => removeOtFile(idx)}>
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      ))}
                      <p className="text-xs text-muted-foreground">PDF, JPG, PNG — max {MAX_FILE_SIZE_MB}MB each</p>
                    </div>
                  </>
                )}

                {/* ── NON-OT FORM ── */}
                {claimType && !isOT && !isOTSheet && (
                  <>
                    <div className="space-y-2">
                      <Label htmlFor="amount">Amount ($) *</Label>
                      <Input
                        id="amount"
                        type="number"
                        step="0.01"
                        min="0"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        placeholder="0.00"
                        data-testid="input-amount"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="description">Description</Label>
                      <Textarea
                        id="description"
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        placeholder="Brief description of the expense..."
                        rows={3}
                        data-testid="input-description"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label>Receipt(s) (Optional, up to {MAX_RECEIPT_FILES} files)</Label>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept={ALLOWED_FILE_TYPES}
                        multiple
                        onChange={handleReceiptFilesChange}
                        className="hidden"
                        data-testid="input-receipt-file"
                      />
                      {receiptFiles.length < MAX_RECEIPT_FILES && (
                        <Button
                          type="button"
                          variant="outline"
                          className="w-full"
                          onClick={() => fileInputRef.current?.click()}
                          data-testid="button-upload-receipt"
                        >
                          <Upload className="h-4 w-4 mr-2" />
                          Add Receipt ({receiptFiles.length}/{MAX_RECEIPT_FILES})
                        </Button>
                      )}
                      {receiptFiles.map((f, idx) => (
                        <div key={idx} className="flex items-center gap-2 p-2 bg-muted rounded-md text-sm">
                          <FileText className="h-4 w-4 shrink-0" />
                          <span className="flex-1 truncate">{f.name}</span>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            onClick={() => removeReceiptFile(idx)}
                            data-testid={`button-remove-receipt-${idx}`}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      ))}
                      <p className="text-xs text-muted-foreground">
                        PDF, JPG, PNG — max {MAX_FILE_SIZE_MB}MB each
                      </p>
                    </div>
                  </>
                )}

                <div className="flex gap-2 pt-4">
                  <Button
                    type="button"
                    variant="outline"
                    className="flex-1"
                    onClick={() => { setOpen(false); resetForm(); }}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    className="flex-1"
                    disabled={submitMutation.isPending || !claimType}
                    data-testid="button-submit-claim"
                  >
                    {submitMutation.isPending ? "Submitting..." : "Submit Claim"}
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Receipt className="h-5 w-5" />
              My Claims
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-16 w-full" />
                ))}
              </div>
            ) : claims.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Receipt className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>No claims submitted yet</p>
                <p className="text-sm">Click "New Claim" to submit your first expense claim</p>
              </div>
            ) : (
              <div className="space-y-3">
                {claims.map((claim) => (
                  <div
                    key={claim.id}
                    className="flex items-center justify-between p-4 border rounded-lg hover-elevate"
                    data-testid={`claim-item-${claim.id}`}
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">
                          {claimTypeLabels[claim.claimType as keyof typeof claimTypeLabels] || claim.claimType}
                        </span>
                        {getStatusBadge(claim.status)}
                      </div>
                      {claim.claimType === "ot_timesheet" ? (
                        <p className="text-sm text-muted-foreground">
                          {MONTH_NAMES[(claim.claimMonth ?? 1) - 1]} {claim.claimYear}
                          {(claim as any).totalHours1_5 && parseFloat(String((claim as any).totalHours1_5)) > 0 && ` • 1.5× ${(claim as any).totalHours1_5}h`}
                          {(claim as any).totalHours2 && parseFloat(String((claim as any).totalHours2)) > 0 && ` • 2× ${(claim as any).totalHours2}h`}
                        </p>
                      ) : claim.claimType === "overtime" && claim.workDate ? (
                        <p className="text-sm text-muted-foreground">
                          Work Date: {format(new Date(claim.workDate + 'T00:00:00'), "dd MMM yyyy")}
                          {claim.hours1_5 && parseFloat(String(claim.hours1_5)) > 0 && ` • 1.5× ${claim.hours1_5}h`}
                          {claim.hours2 && parseFloat(String(claim.hours2)) > 0 && ` • 2× ${claim.hours2}h`}
                        </p>
                      ) : (
                        <p className="text-sm text-muted-foreground">
                          {claim.description || "No description"}
                        </p>
                      )}
                      <p className="text-xs text-muted-foreground">
                        Submitted: {format(new Date(claim.submittedAt), "dd MMM yyyy")}
                        {" • "}
                        Period: {claim.claimMonth}/{claim.claimYear}
                      </p>
                      {claim.reviewComments && (
                        <p className="text-xs text-muted-foreground italic">
                          Comment: {claim.reviewComments}
                        </p>
                      )}
                    </div>
                    <div className="text-right">
                      {claim.claimType === "overtime" || claim.claimType === "ot_timesheet" ? (
                        <p className="text-sm text-muted-foreground italic">Pending calculation</p>
                      ) : (
                        <p className="text-lg font-semibold">
                          ${parseFloat(claim.amount).toFixed(2)}
                        </p>
                      )}
                      {claim.receiptFileName && (
                        <p className="text-xs text-muted-foreground flex items-center gap-1 justify-end">
                          <FileText className="h-3 w-3" />
                          Receipt attached
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
