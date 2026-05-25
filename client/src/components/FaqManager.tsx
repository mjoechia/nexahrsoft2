import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Plus, Pencil, Trash2, Loader2, HelpCircle, Image as ImageIcon, Upload, FolderPlus,
} from "lucide-react";
import type { FaqCategory, FaqEntry, FaqEntryImage, FaqAudience } from "@shared/schema";

type EntryWithImages = FaqEntry & { images?: FaqEntryImage[] };

const audienceLabel: Record<FaqAudience, string> = {
  admin: "Admins only",
  employee: "Employees only",
  both: "Everyone",
};

export function FaqManager() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [categoryDialogOpen, setCategoryDialogOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<FaqCategory | null>(null);
  const [catSlug, setCatSlug] = useState("");
  const [catName, setCatName] = useState("");
  const [catDescription, setCatDescription] = useState("");

  const [entryDialogOpen, setEntryDialogOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<EntryWithImages | null>(null);
  const [entryTitle, setEntryTitle] = useState("");
  const [entryBody, setEntryBody] = useState("");
  const [entryAudience, setEntryAudience] = useState<FaqAudience>("both");
  const [entryActive, setEntryActive] = useState(true);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: catsData, isLoading: catsLoading } = useQuery<{ categories: FaqCategory[] }>({
    queryKey: ["/api/admin/faq/categories"],
  });
  const categories = catsData?.categories ?? [];

  // auto-select first category when list loads
  const activeCategoryId = useMemo(() => {
    if (selectedCategoryId && categories.some(c => c.id === selectedCategoryId)) return selectedCategoryId;
    return categories[0]?.id ?? null;
  }, [selectedCategoryId, categories]);

  const { data: entriesData, isLoading: entriesLoading } = useQuery<{ entries: EntryWithImages[] }>({
    queryKey: ["/api/admin/faq/entries", { categoryId: activeCategoryId }],
    enabled: !!activeCategoryId,
  });
  const entries = entriesData?.entries ?? [];

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["/api/admin/faq/categories"] });
    qc.invalidateQueries({ queryKey: ["/api/admin/faq/entries"] });
    qc.invalidateQueries({ queryKey: ["/api/faq"] });
  };

  // ── Category mutations ─────────────────────────────────────────────────
  const resetCategoryForm = () => {
    setCatSlug("");
    setCatName("");
    setCatDescription("");
    setEditingCategory(null);
  };

  const openCreateCategory = () => {
    resetCategoryForm();
    setCategoryDialogOpen(true);
  };

  const openEditCategory = (c: FaqCategory) => {
    setEditingCategory(c);
    setCatSlug(c.slug);
    setCatName(c.name);
    setCatDescription(c.description || "");
    setCategoryDialogOpen(true);
  };

  const saveCategoryMutation = useMutation({
    mutationFn: async () => {
      if (editingCategory) {
        return apiRequest("PATCH", `/api/admin/faq/categories/${editingCategory.id}`, {
          name: catName,
          description: catDescription || null,
        });
      }
      return apiRequest("POST", "/api/admin/faq/categories", {
        slug: catSlug,
        name: catName,
        description: catDescription || null,
      });
    },
    onSuccess: async (res) => {
      toast({ title: editingCategory ? "Category updated" : "Category created" });
      setCategoryDialogOpen(false);
      const json = await res.json().catch(() => null);
      if (!editingCategory && json?.category?.id) {
        setSelectedCategoryId(json.category.id);
      }
      resetCategoryForm();
      invalidate();
    },
    onError: (err: Error) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  const deleteCategoryMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/admin/faq/categories/${id}`),
    onSuccess: () => {
      toast({ title: "Category deleted" });
      setSelectedCategoryId(null);
      invalidate();
    },
    onError: (err: Error) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  const handleDeleteCategory = (c: FaqCategory) => {
    if (confirm(`Delete category "${c.name}"? This also deletes all of its FAQ entries and screenshots.`)) {
      deleteCategoryMutation.mutate(c.id);
    }
  };

  // ── Entry mutations ────────────────────────────────────────────────────
  const resetEntryForm = () => {
    setEntryTitle("");
    setEntryBody("");
    setEntryAudience("both");
    setEntryActive(true);
    setEditingEntry(null);
  };

  const openCreateEntry = () => {
    if (!activeCategoryId) {
      toast({ title: "Create a category first", variant: "destructive" });
      return;
    }
    resetEntryForm();
    setEntryDialogOpen(true);
  };

  const openEditEntry = (e: EntryWithImages) => {
    setEditingEntry(e);
    setEntryTitle(e.title);
    setEntryBody(e.body);
    setEntryAudience(e.audience as FaqAudience);
    setEntryActive(e.isActive);
    setEntryDialogOpen(true);
  };

  const saveEntryMutation = useMutation({
    mutationFn: async () => {
      if (editingEntry) {
        return apiRequest("PATCH", `/api/admin/faq/entries/${editingEntry.id}`, {
          title: entryTitle,
          body: entryBody,
          audience: entryAudience,
          isActive: entryActive,
        });
      }
      return apiRequest("POST", "/api/admin/faq/entries", {
        categoryId: activeCategoryId,
        title: entryTitle,
        body: entryBody,
        audience: entryAudience,
        isActive: entryActive,
      });
    },
    onSuccess: () => {
      toast({ title: editingEntry ? "Entry updated" : "Entry created" });
      setEntryDialogOpen(false);
      resetEntryForm();
      invalidate();
    },
    onError: (err: Error) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  const toggleEntryActiveMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) =>
      apiRequest("PATCH", `/api/admin/faq/entries/${id}`, { isActive }),
    onSuccess: () => invalidate(),
    onError: (err: Error) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  const deleteEntryMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/admin/faq/entries/${id}`),
    onSuccess: () => {
      toast({ title: "Entry deleted" });
      invalidate();
    },
    onError: (err: Error) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  const handleDeleteEntry = (e: FaqEntry) => {
    if (confirm(`Delete FAQ entry "${e.title}"? This also deletes its screenshots.`)) {
      deleteEntryMutation.mutate(e.id);
    }
  };

  // ── Image mutations ────────────────────────────────────────────────────
  const uploadImageMutation = useMutation({
    mutationFn: async ({ entryId, file, caption }: { entryId: string; file: File; caption?: string }) => {
      const fd = new FormData();
      fd.append("file", file);
      if (caption) fd.append("caption", caption);
      const res = await fetch(`/api/admin/faq/entries/${entryId}/images`, {
        method: "POST",
        body: fd,
        credentials: "include",
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `Upload failed (${res.status})`);
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Screenshot uploaded" });
      invalidate();
    },
    onError: (err: Error) => toast({ title: "Upload failed", description: err.message, variant: "destructive" }),
  });

  const deleteImageMutation = useMutation({
    mutationFn: async (imageId: string) => apiRequest("DELETE", `/api/admin/faq/images/${imageId}`),
    onSuccess: () => {
      toast({ title: "Screenshot removed" });
      invalidate();
    },
    onError: (err: Error) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  const updateImageCaptionMutation = useMutation({
    mutationFn: async ({ imageId, caption }: { imageId: string; caption: string }) =>
      apiRequest("PATCH", `/api/admin/faq/images/${imageId}`, { caption: caption || null }),
    onSuccess: () => invalidate(),
    onError: (err: Error) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  const handleFilePick = (entryId: string) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    uploadImageMutation.mutate({ entryId, file });
  };

  const saving = saveEntryMutation.isPending;
  const savingCategory = saveCategoryMutation.isPending;
  const activeCategory = categories.find(c => c.id === activeCategoryId) ?? null;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <CardTitle className="flex items-center gap-2">
            <HelpCircle className="h-5 w-5" />
            FAQ
          </CardTitle>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={openCreateCategory} data-testid="button-new-faq-category">
              <FolderPlus className="h-4 w-4 mr-2" />
              New Category
            </Button>
            <Button size="sm" onClick={openCreateEntry} disabled={!activeCategoryId} data-testid="button-new-faq-entry">
              <Plus className="h-4 w-4 mr-2" />
              New Entry
            </Button>
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          Author FAQ entries grouped by category. Pick an audience to control which users see each entry, and upload screenshots to illustrate the flow.
        </p>
      </CardHeader>
      <CardContent>
        {catsLoading ? (
          <div className="py-8 text-center text-sm text-muted-foreground">Loading…</div>
        ) : categories.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            No FAQ categories yet. Click <strong>New Category</strong> to create one (e.g., "Leave").
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              {categories.map(c => (
                <div
                  key={c.id}
                  className={`flex items-center gap-1 rounded-md border px-2 py-1 text-sm ${c.id === activeCategoryId ? "bg-primary text-primary-foreground border-primary" : "bg-muted/30"}`}
                >
                  <button
                    onClick={() => setSelectedCategoryId(c.id)}
                    className="font-medium hover-elevate active-elevate-2 px-2 py-1 -mx-2 -my-1 rounded"
                    data-testid={`button-select-category-${c.slug}`}
                  >
                    {c.name}
                  </button>
                  <button
                    onClick={() => openEditCategory(c)}
                    className="opacity-70 hover:opacity-100 p-1"
                    title="Edit category"
                    data-testid={`button-edit-category-${c.slug}`}
                  >
                    <Pencil className="h-3 w-3" />
                  </button>
                  <button
                    onClick={() => handleDeleteCategory(c)}
                    className="opacity-70 hover:opacity-100 p-1"
                    title="Delete category"
                    data-testid={`button-delete-category-${c.slug}`}
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>

            {activeCategory && activeCategory.description && (
              <p className="text-sm text-muted-foreground italic">{activeCategory.description}</p>
            )}

            {entriesLoading ? (
              <div className="py-8 text-center text-sm text-muted-foreground">Loading entries…</div>
            ) : entries.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                No entries in this category yet. Click <strong>New Entry</strong> to add one.
              </div>
            ) : (
              <Accordion type="multiple" className="space-y-2">
                {entries.map((e) => (
                  <AccordionItem key={e.id} value={e.id} className="border rounded-md px-3" data-testid={`row-faq-entry-${e.id}`}>
                    <AccordionTrigger className="hover:no-underline py-3">
                      <div className="flex items-center gap-2 flex-wrap text-left">
                        <span className="font-medium">{e.title}</span>
                        <Badge variant="outline" className="text-xs">{audienceLabel[e.audience as FaqAudience]}</Badge>
                        {!e.isActive && <Badge variant="secondary" className="text-xs">Hidden</Badge>}
                        {e.images && e.images.length > 0 && (
                          <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
                            <ImageIcon className="h-3 w-3" />
                            {e.images.length}
                          </span>
                        )}
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="pb-4">
                      <div className="space-y-3">
                        <p className="text-sm whitespace-pre-wrap text-muted-foreground">{e.body}</p>

                        {e.images && e.images.length > 0 && (
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            {e.images.map(img => (
                              <div key={img.id} className="border rounded-md overflow-hidden bg-muted/30">
                                <img src={img.imageUrl} alt={img.caption || e.title} className="w-full max-h-64 object-contain bg-white" />
                                <div className="p-2 space-y-2">
                                  <Input
                                    defaultValue={img.caption || ""}
                                    placeholder="Caption (optional)"
                                    onBlur={(ev) => {
                                      const next = ev.target.value;
                                      if (next !== (img.caption || "")) {
                                        updateImageCaptionMutation.mutate({ imageId: img.id, caption: next });
                                      }
                                    }}
                                    data-testid={`input-caption-${img.id}`}
                                  />
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="text-destructive hover:text-destructive"
                                    onClick={() => {
                                      if (confirm("Remove this screenshot?")) deleteImageMutation.mutate(img.id);
                                    }}
                                    data-testid={`button-delete-image-${img.id}`}
                                  >
                                    <Trash2 className="h-3 w-3 mr-1" />
                                    Remove
                                  </Button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}

                        <div className="flex items-center gap-2 flex-wrap pt-2 border-t">
                          <input
                            type="file"
                            accept="image/png,image/jpeg,image/gif,image/webp"
                            className="hidden"
                            ref={fileInputRef}
                          />
                          <label className="inline-flex">
                            <input
                              type="file"
                              accept="image/png,image/jpeg,image/gif,image/webp"
                              className="hidden"
                              onChange={handleFilePick(e.id)}
                              data-testid={`input-upload-image-${e.id}`}
                            />
                            <Button size="sm" variant="outline" asChild>
                              <span className="cursor-pointer inline-flex items-center">
                                <Upload className="h-4 w-4 mr-2" />
                                Upload Screenshot
                              </span>
                            </Button>
                          </label>
                          <div className="ml-auto flex items-center gap-2">
                            <span className="text-xs text-muted-foreground">Visible</span>
                            <Switch
                              checked={e.isActive}
                              onCheckedChange={(v) => toggleEntryActiveMutation.mutate({ id: e.id, isActive: v })}
                              data-testid={`switch-faq-active-${e.id}`}
                            />
                            <Button variant="ghost" size="icon" onClick={() => openEditEntry(e)} data-testid={`button-edit-entry-${e.id}`}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="text-destructive hover:text-destructive"
                              onClick={() => handleDeleteEntry(e)}
                              data-testid={`button-delete-entry-${e.id}`}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            )}
          </div>
        )}
      </CardContent>

      {/* Category dialog */}
      <Dialog open={categoryDialogOpen} onOpenChange={(o) => { setCategoryDialogOpen(o); if (!o) resetCategoryForm(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingCategory ? "Edit Category" : "New Category"}</DialogTitle>
            <DialogDescription>
              {editingCategory ? "Slug cannot be changed after creation." : "Slug is the URL-friendly id (e.g., \"leave\"). Lowercase letters, digits, and dashes only."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="cat-slug">Slug</Label>
              <Input
                id="cat-slug"
                value={catSlug}
                onChange={(e) => setCatSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                placeholder="leave"
                disabled={!!editingCategory}
                data-testid="input-faq-category-slug"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cat-name">Name</Label>
              <Input
                id="cat-name"
                value={catName}
                onChange={(e) => setCatName(e.target.value)}
                placeholder="Leave"
                maxLength={120}
                data-testid="input-faq-category-name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cat-desc">Description (optional)</Label>
              <Textarea
                id="cat-desc"
                value={catDescription}
                onChange={(e) => setCatDescription(e.target.value)}
                placeholder="A short blurb shown under the category name."
                rows={2}
                maxLength={500}
                data-testid="input-faq-category-description"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setCategoryDialogOpen(false); resetCategoryForm(); }} disabled={savingCategory}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!catName.trim()) {
                  toast({ title: "Name is required", variant: "destructive" });
                  return;
                }
                if (!editingCategory && !catSlug.trim()) {
                  toast({ title: "Slug is required", variant: "destructive" });
                  return;
                }
                saveCategoryMutation.mutate();
              }}
              disabled={savingCategory}
              data-testid="button-save-faq-category"
            >
              {savingCategory && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {editingCategory ? "Save Changes" : "Create Category"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Entry dialog */}
      <Dialog open={entryDialogOpen} onOpenChange={(o) => { setEntryDialogOpen(o); if (!o) resetEntryForm(); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editingEntry ? "Edit FAQ Entry" : "New FAQ Entry"}</DialogTitle>
            <DialogDescription>
              {activeCategory && <>Category: <strong>{activeCategory.name}</strong>. </>}
              Use the audience selector to control who sees this entry.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="entry-title">Title</Label>
              <Input
                id="entry-title"
                value={entryTitle}
                onChange={(e) => setEntryTitle(e.target.value)}
                placeholder="e.g., How do I apply for annual leave?"
                maxLength={200}
                data-testid="input-faq-entry-title"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="entry-body">Body</Label>
              <Textarea
                id="entry-body"
                value={entryBody}
                onChange={(e) => setEntryBody(e.target.value)}
                placeholder="Walk through the steps. Use plain text — line breaks are preserved."
                rows={8}
                maxLength={10000}
                data-testid="input-faq-entry-body"
              />
              <p className="text-xs text-muted-foreground">{entryBody.length}/10000</p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Audience</Label>
                <Select value={entryAudience} onValueChange={(v) => setEntryAudience(v as FaqAudience)}>
                  <SelectTrigger data-testid="select-faq-entry-audience">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="both">Everyone (admins + employees)</SelectItem>
                    <SelectItem value="employee">Employees only</SelectItem>
                    <SelectItem value="admin">Admins only</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Visible</Label>
                <div className="flex items-center gap-2 h-10">
                  <Switch
                    checked={entryActive}
                    onCheckedChange={setEntryActive}
                    data-testid="switch-faq-entry-active"
                  />
                  <span className="text-sm text-muted-foreground">
                    {entryActive ? "Showing to its audience" : "Hidden"}
                  </span>
                </div>
              </div>
            </div>
            {!editingEntry && (
              <p className="text-xs text-muted-foreground border-t pt-3">
                Tip: create the entry first, then expand it in the list to upload screenshots one at a time.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setEntryDialogOpen(false); resetEntryForm(); }} disabled={saving}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!entryTitle.trim() || !entryBody.trim()) {
                  toast({ title: "Missing fields", description: "Title and body are required", variant: "destructive" });
                  return;
                }
                saveEntryMutation.mutate();
              }}
              disabled={saving}
              data-testid="button-save-faq-entry"
            >
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {editingEntry ? "Save Changes" : "Create Entry"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
