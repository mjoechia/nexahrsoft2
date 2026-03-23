import { useState, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ArrowLeft, Upload, FileSpreadsheet, Check, X, AlertTriangle, Loader2, History, Calendar, UserCheck, UserX, CheckCircle } from "lucide-react";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface ParsedRecord {
  employeeCode: string;
  employeeName: string;
  deptCode?: string;
  deptName?: string;
  secCode?: string;
  secName?: string;
  catCode?: string;
  catName?: string;
  nric?: string;
  joinDate?: string;
  totSalary: string;
  basicSalary: string;
  monthlyVariablesComponent: string;
  flat: string;
  ot10: string;
  ot15: string;
  ot20: string;
  ot30: string;
  shiftAllowance: string;
  totRestPhAmount: string;
  transportAllowance: string;
  annualLeaveEncashment: string;
  serviceCallAllowances: string;
  otherAllowance: string;
  houseRentalAllowances: string;
  noPayDay: string;
  cc: string;
  cdac: string;
  ecf: string;
  mbmf: string;
  sinda: string;
  bonus: string;
  grossWages: string;
  cpfWages: string;
  sdf: string;
  fwl: string;
  employerCpf: string;
  employeeCpf: string;
  totalCpf: string;
  nett: string;
  payMode?: string;
  chequeNo?: string;
  userId?: string | null;
  matchedEmployee?: { id: string; name: string } | null;
  rowNumber: number;
}

interface ParseResponse {
  payPeriod: {
    year: number | null;
    month: number | null;
    text: string;
  };
  records: ParsedRecord[];
  summary: {
    total: number;
    valid: number;
    errors: number;
    skipped: number;
  };
  validationErrors: string[];
  headers: string[];
}

interface ImportBatch {
  id: string;
  fileName: string;
  payPeriodYear: number;
  payPeriodMonth: number;
  totalRecords: number;
  successfulRecords: number;
  failedRecords: number;
  skippedRecords: number;
  status: string;
  importedBy: string;
  importedAt: string;
  completedAt?: string;
}

function formatAmount(value: string | number): string {
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (isNaN(num)) return "$0.00";
  return `$${num.toFixed(2)}`;
}

const MONTH_NAMES = ["", "JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

export default function AdminHistoricalPayrollImportPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [step, setStep] = useState<"upload" | "preview" | "importing" | "complete">("upload");
  const [file, setFile] = useState<File | null>(null);
  const [parseResult, setParseResult] = useState<ParseResponse | null>(null);
  const [importResult, setImportResult] = useState<{ successful: number; failed: number; skipped: number } | null>(null);
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [selectedMonth, setSelectedMonth] = useState<number | null>(null);
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);

  const { data: batchesData } = useQuery<{ batches: ImportBatch[] }>({
    queryKey: ["/api/admin/payroll/import-batches"],
  });

  const parseMutation = useMutation({
    mutationFn: async (fileData: { fileBase64: string; fileName: string }) => {
      const response = await apiRequest("POST", "/api/admin/payroll/historical-import/parse", fileData);
      return response.json();
    },
    onSuccess: (data: ParseResponse) => {
      setParseResult(data);
      setSelectedYear(data.payPeriod.year);
      setSelectedMonth(data.payPeriod.month);
      setStep("preview");
    },
    onError: (error: Error) => {
      toast({
        title: "Parse Failed",
        description: error.message || "Failed to parse payroll file",
        variant: "destructive",
      });
    },
  });

  const importMutation = useMutation({
    mutationFn: async (data: { fileName: string; payPeriodYear: number; payPeriodMonth: number; records: ParsedRecord[] }) => {
      const response = await apiRequest("POST", "/api/admin/payroll/historical-import/execute", data);
      return response.json();
    },
    onSuccess: (data) => {
      setImportResult(data.summary);
      setStep("complete");
      queryClient.invalidateQueries({ queryKey: ["/api/admin/payroll/import-batches"] });
      toast({
        title: "Import Complete",
        description: `Successfully imported ${data.summary.successful} records`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Import Failed",
        description: error.message || "Failed to import payroll records",
        variant: "destructive",
      });
      setStep("preview");
    },
  });

  const processFile = useCallback((selectedFile: File) => {
    if (!selectedFile) return;
    
    // Validate file type
    const validExtensions = ['.xlsx', '.xls'];
    const fileExtension = selectedFile.name.toLowerCase().slice(selectedFile.name.lastIndexOf('.'));
    if (!validExtensions.includes(fileExtension)) {
      toast({
        title: "Invalid File Type",
        description: "Please upload an Excel file (.xlsx or .xls)",
        variant: "destructive",
      });
      return;
    }
    
    setFile(selectedFile);
    
    const reader = new FileReader();
    reader.onload = async (event) => {
      const base64 = event.target?.result as string;
      const base64Data = base64.split(",")[1] || base64;
      parseMutation.mutate({ fileBase64: base64Data, fileName: selectedFile.name });
    };
    reader.onerror = () => {
      toast({
        title: "File Read Error",
        description: "Failed to read the file. Please try again.",
        variant: "destructive",
      });
    };
    reader.readAsDataURL(selectedFile);
  }, [parseMutation, toast]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      processFile(selectedFile);
    }
  }, [processFile]);

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    
    const droppedFile = e.dataTransfer.files?.[0];
    if (droppedFile) {
      processFile(droppedFile);
    }
  }, [processFile]);

  const handleImport = () => {
    if (!parseResult || !selectedYear || !selectedMonth) return;
    setConfirmDialogOpen(true);
  };

  const confirmImport = () => {
    if (!parseResult || !selectedYear || !selectedMonth || !file) return;
    setConfirmDialogOpen(false);
    setStep("importing");
    importMutation.mutate({
      fileName: file.name,
      payPeriodYear: selectedYear,
      payPeriodMonth: selectedMonth,
      records: parseResult.records,
    });
  };

  const handleReset = () => {
    setFile(null);
    setParseResult(null);
    setImportResult(null);
    setSelectedYear(null);
    setSelectedMonth(null);
    setStep("upload");
  };

  const renderUploadStep = () => (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="h-5 w-5" />
            Historical Payroll Import
          </CardTitle>
          <CardDescription>
            Import legacy payroll data from Excel files. This feature is for migrating historical records only.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Alert className="mb-6">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Master Admin Only</AlertTitle>
            <AlertDescription>
              This feature imports historical payroll data that will be marked as finalized and cannot be recalculated.
              Records are linked to existing employees by their employee code when possible.
            </AlertDescription>
          </Alert>
          
          <div 
            className="border-2 border-dashed border-muted-foreground/25 rounded-lg p-12 text-center hover:border-primary/50 transition-colors"
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            data-testid="drop-zone"
          >
            <input
              type="file"
              accept=".xlsx,.xls"
              onChange={handleFileSelect}
              className="hidden"
              id="file-upload"
              data-testid="input-file-upload"
            />
            <label
              htmlFor="file-upload"
              className="cursor-pointer flex flex-col items-center gap-4"
            >
              <div className="p-4 rounded-full bg-muted">
                <FileSpreadsheet className="h-10 w-10 text-muted-foreground" />
              </div>
              <div>
                <p className="text-lg font-medium">Drop Excel file here or click to browse</p>
                <p className="text-sm text-muted-foreground">Supports .xlsx and .xls files</p>
              </div>
              {parseMutation.isPending && (
                <div className="flex items-center gap-2 text-primary">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Parsing file...
                </div>
              )}
            </label>
          </div>
        </CardContent>
      </Card>
      
      {batchesData?.batches && batchesData.batches.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Recent Import Batches</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {batchesData.batches.slice(0, 5).map((batch: ImportBatch) => (
                <div key={batch.id} className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                  <div className="flex items-center gap-3">
                    <FileSpreadsheet className="h-5 w-5 text-muted-foreground" />
                    <div>
                      <p className="font-medium text-sm">{batch.fileName}</p>
                      <p className="text-xs text-muted-foreground">
                        {MONTH_NAMES[batch.payPeriodMonth]} {batch.payPeriodYear}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge variant={batch.status === "completed" ? "default" : "secondary"}>
                      {batch.status}
                    </Badge>
                    <span className="text-sm text-muted-foreground">
                      {batch.successfulRecords}/{batch.totalRecords} imported
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );

  const renderPreviewStep = () => {
    if (!parseResult) return null;
    
    const matchedCount = parseResult.records.filter(r => r.matchedEmployee).length;
    const unmatchedCount = parseResult.records.length - matchedCount;
    
    return (
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Preview Import</CardTitle>
                <CardDescription>
                  Review the data before importing. {file?.name}
                </CardDescription>
              </div>
              <Button variant="ghost" onClick={handleReset} data-testid="button-reset">
                <ArrowLeft className="h-4 w-4 mr-2" />
                Start Over
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex flex-wrap gap-4">
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm">Pay Period:</span>
                <div className="flex gap-2">
                  <Select
                    value={selectedMonth?.toString() || ""}
                    onValueChange={(v) => setSelectedMonth(parseInt(v))}
                  >
                    <SelectTrigger className="w-32" data-testid="select-month">
                      <SelectValue placeholder="Month" />
                    </SelectTrigger>
                    <SelectContent>
                      {MONTH_NAMES.slice(1).map((m, i) => (
                        <SelectItem key={i + 1} value={(i + 1).toString()}>{m}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select
                    value={selectedYear?.toString() || ""}
                    onValueChange={(v) => setSelectedYear(parseInt(v))}
                  >
                    <SelectTrigger className="w-24" data-testid="select-year">
                      <SelectValue placeholder="Year" />
                    </SelectTrigger>
                    <SelectContent>
                      {Array.from({ length: 10 }, (_, i) => 2020 + i).map((y) => (
                        <SelectItem key={y} value={y.toString()}>{y}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
            
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="p-4 rounded-lg bg-muted/50 text-center">
                <p className="text-2xl font-bold">{parseResult.summary.total}</p>
                <p className="text-sm text-muted-foreground">Total Records</p>
              </div>
              <div className="p-4 rounded-lg bg-green-500/10 text-center">
                <p className="text-2xl font-bold text-green-600">{parseResult.summary.valid}</p>
                <p className="text-sm text-muted-foreground">Valid to Import</p>
              </div>
              <div className="p-4 rounded-lg bg-yellow-500/10 text-center">
                <p className="text-2xl font-bold text-yellow-600">{parseResult.summary.skipped}</p>
                <p className="text-sm text-muted-foreground">Will Skip (Duplicates)</p>
              </div>
              <div className="p-4 rounded-lg bg-red-500/10 text-center">
                <p className="text-2xl font-bold text-red-600">{parseResult.summary.errors}</p>
                <p className="text-sm text-muted-foreground">Errors</p>
              </div>
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div className="p-4 rounded-lg bg-blue-500/10 flex items-center gap-3">
                <UserCheck className="h-6 w-6 text-blue-600" />
                <div>
                  <p className="font-medium">{matchedCount} Matched</p>
                  <p className="text-sm text-muted-foreground">Linked to existing employees</p>
                </div>
              </div>
              <div className="p-4 rounded-lg bg-orange-500/10 flex items-center gap-3">
                <UserX className="h-6 w-6 text-orange-600" />
                <div>
                  <p className="font-medium">{unmatchedCount} Unmatched</p>
                  <p className="text-sm text-muted-foreground">No matching employee found</p>
                </div>
              </div>
            </div>
            
            {parseResult.validationErrors.length > 0 && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Validation Issues</AlertTitle>
                <AlertDescription>
                  <ScrollArea className="h-32 mt-2">
                    <ul className="list-disc pl-4 space-y-1 text-sm">
                      {parseResult.validationErrors.map((err, i) => (
                        <li key={i}>{err}</li>
                      ))}
                    </ul>
                  </ScrollArea>
                </AlertDescription>
              </Alert>
            )}
            
            <Separator />
            
            <div>
              <h3 className="font-medium mb-3">Records Preview</h3>
              <ScrollArea className="h-[400px] border rounded-lg">
                <table className="w-full text-sm">
                  <thead className="bg-muted sticky top-0">
                    <tr>
                      <th className="p-2 text-left">Row</th>
                      <th className="p-2 text-left">Employee Code</th>
                      <th className="p-2 text-left">Name</th>
                      <th className="p-2 text-right">Gross</th>
                      <th className="p-2 text-right">CPF (EE)</th>
                      <th className="p-2 text-right">Net</th>
                      <th className="p-2 text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parseResult.records.map((record, i) => (
                      <tr key={i} className="border-b hover:bg-muted/50">
                        <td className="p-2">{record.rowNumber}</td>
                        <td className="p-2 font-mono text-xs">{record.employeeCode}</td>
                        <td className="p-2">{record.employeeName}</td>
                        <td className="p-2 text-right font-mono">{formatAmount(record.grossWages)}</td>
                        <td className="p-2 text-right font-mono">{formatAmount(record.employeeCpf)}</td>
                        <td className="p-2 text-right font-mono">{formatAmount(record.nett)}</td>
                        <td className="p-2 text-center">
                          {record.matchedEmployee ? (
                            <Badge variant="outline" className="text-green-600 border-green-600">
                              <Check className="h-3 w-3 mr-1" /> Matched
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-orange-600 border-orange-600">
                              <X className="h-3 w-3 mr-1" /> No Match
                            </Badge>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ScrollArea>
            </div>
          </CardContent>
        </Card>
        
        <div className="flex justify-end gap-3">
          <Button variant="outline" onClick={handleReset} data-testid="button-cancel">
            Cancel
          </Button>
          <Button
            onClick={handleImport}
            disabled={!selectedYear || !selectedMonth || parseResult.records.length === 0}
            data-testid="button-import"
          >
            <Upload className="h-4 w-4 mr-2" />
            Import {parseResult.records.length} Records
          </Button>
        </div>
      </div>
    );
  };

  const renderImportingStep = () => (
    <Card>
      <CardContent className="py-12">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-12 w-12 animate-spin text-primary" />
          <p className="text-lg font-medium">Importing payroll records...</p>
          <p className="text-sm text-muted-foreground">This may take a few moments</p>
        </div>
      </CardContent>
    </Card>
  );

  const renderCompleteStep = () => (
    <Card>
      <CardContent className="py-12">
        <div className="flex flex-col items-center gap-4">
          <div className="p-4 rounded-full bg-green-500/10">
            <CheckCircle className="h-12 w-12 text-green-600" />
          </div>
          <p className="text-lg font-medium">Import Complete</p>
          {importResult && (
            <div className="grid grid-cols-3 gap-8 text-center mt-4">
              <div>
                <p className="text-3xl font-bold text-green-600">{importResult.successful}</p>
                <p className="text-sm text-muted-foreground">Imported</p>
              </div>
              <div>
                <p className="text-3xl font-bold text-yellow-600">{importResult.skipped}</p>
                <p className="text-sm text-muted-foreground">Skipped</p>
              </div>
              <div>
                <p className="text-3xl font-bold text-red-600">{importResult.failed}</p>
                <p className="text-sm text-muted-foreground">Failed</p>
              </div>
            </div>
          )}
          <div className="flex gap-3 mt-6">
            <Button variant="outline" onClick={handleReset} data-testid="button-import-another">
              Import Another File
            </Button>
            <Button onClick={() => setLocation("/admin/payroll/reports")} data-testid="button-view-reports">
              View Payroll Reports
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b bg-card">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h1 className="text-xl font-semibold">Historical Payroll Import</h1>
              <p className="text-sm text-muted-foreground">Master Admin Only</p>
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
        </div>
      </div>
      
      <div className="max-w-5xl mx-auto px-4 py-8">
        {step === "upload" && renderUploadStep()}
        {step === "preview" && renderPreviewStep()}
        {step === "importing" && renderImportingStep()}
        {step === "complete" && renderCompleteStep()}
      </div>
      
      <Dialog open={confirmDialogOpen} onOpenChange={setConfirmDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Import</DialogTitle>
            <DialogDescription>
              You are about to import {parseResult?.records.length} payroll records for {MONTH_NAMES[selectedMonth || 0]} {selectedYear}.
              This action will create finalized historical payroll records that cannot be recalculated.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={confirmImport} data-testid="button-confirm-import">
              Confirm Import
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
