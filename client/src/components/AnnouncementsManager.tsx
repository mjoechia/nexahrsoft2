import { useState } from "react";
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
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Plus, Pencil, Trash2, Loader2, Megaphone } from "lucide-react";
import type { Announcement } from "@shared/schema";

export function AnnouncementsManager() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Announcement | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [isActive, setIsActive] = useState(true);

  const { data, isLoading } = useQuery<{ announcements: Announcement[] }>({
    queryKey: ["/api/admin/announcements"],
  });

  const resetForm = () => {
    setTitle("");
    setBody("");
    setIsActive(true);
    setEditing(null);
  };

  const openCreate = () => {
    resetForm();
    setDialogOpen(true);
  };

  const openEdit = (a: Announcement) => {
    setEditing(a);
    setTitle(a.title);
    setBody(a.body);
    setIsActive(a.isActive);
    setDialogOpen(true);
  };

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["/api/admin/announcements"] });
    qc.invalidateQueries({ queryKey: ["/api/announcements"] });
  };

  const createMutation = useMutation({
    mutationFn: async () => apiRequest("POST", "/api/admin/announcements", { title, body, isActive }),
    onSuccess: () => {
      toast({ title: "Announcement created" });
      setDialogOpen(false);
      resetForm();
      invalidate();
    },
    onError: (err: Error) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async () => {
      if (!editing) return;
      return apiRequest("PATCH", `/api/admin/announcements/${editing.id}`, { title, body, isActive });
    },
    onSuccess: () => {
      toast({ title: "Announcement updated" });
      setDialogOpen(false);
      resetForm();
      invalidate();
    },
    onError: (err: Error) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  const toggleActiveMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) =>
      apiRequest("PATCH", `/api/admin/announcements/${id}`, { isActive }),
    onSuccess: () => invalidate(),
    onError: (err: Error) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/admin/announcements/${id}`),
    onSuccess: () => {
      toast({ title: "Announcement deleted" });
      invalidate();
    },
    onError: (err: Error) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  const handleSave = () => {
    if (!title.trim() || !body.trim()) {
      toast({ title: "Missing fields", description: "Title and body are required", variant: "destructive" });
      return;
    }
    if (editing) updateMutation.mutate();
    else createMutation.mutate();
  };

  const handleDelete = (a: Announcement) => {
    if (confirm(`Delete announcement "${a.title}"? This cannot be undone.`)) {
      deleteMutation.mutate(a.id);
    }
  };

  const announcements = data?.announcements || [];
  const saving = createMutation.isPending || updateMutation.isPending;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <CardTitle className="flex items-center gap-2">
            <Megaphone className="h-5 w-5" />
            Announcements
          </CardTitle>
          <Button size="sm" onClick={openCreate} data-testid="button-new-announcement">
            <Plus className="h-4 w-4 mr-2" />
            New Announcement
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          Active announcements rotate on every user's dashboard. Toggle off to hide without deleting.
        </p>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="py-8 text-center text-sm text-muted-foreground">Loading…</div>
        ) : announcements.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            No announcements yet. Click <strong>New Announcement</strong> to post one.
          </div>
        ) : (
          <div className="space-y-3">
            {announcements.map((a) => (
              <div
                key={a.id}
                className="flex items-start gap-3 p-4 border rounded-md"
                data-testid={`row-announcement-${a.id}`}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <h4 className="font-medium truncate">{a.title}</h4>
                    {a.isActive ? (
                      <Badge variant="default">Active</Badge>
                    ) : (
                      <Badge variant="outline">Inactive</Badge>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap line-clamp-3">
                    {a.body}
                  </p>
                  <p className="text-xs text-muted-foreground mt-2">
                    {a.createdByName ? `Posted by ${a.createdByName} • ` : ""}
                    {new Date(a.createdAt).toLocaleString("en-SG", {
                      day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
                    })}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Switch
                    checked={a.isActive}
                    onCheckedChange={(v) => toggleActiveMutation.mutate({ id: a.id, isActive: v })}
                    data-testid={`switch-active-${a.id}`}
                  />
                  <Button variant="ghost" size="icon" onClick={() => openEdit(a)} data-testid={`button-edit-${a.id}`}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleDelete(a)}
                    className="text-destructive hover:text-destructive"
                    data-testid={`button-delete-${a.id}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>

      <Dialog open={dialogOpen} onOpenChange={(o) => { setDialogOpen(o); if (!o) resetForm(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Announcement" : "New Announcement"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="ann-title">Title</Label>
              <Input
                id="ann-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g., Office closure on Vesak Day"
                maxLength={200}
                data-testid="input-announcement-title"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ann-body">Message</Label>
              <Textarea
                id="ann-body"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Type the announcement message…"
                rows={5}
                maxLength={2000}
                data-testid="input-announcement-body"
              />
              <p className="text-xs text-muted-foreground">{body.length}/2000</p>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id="ann-active"
                checked={isActive}
                onCheckedChange={setIsActive}
                data-testid="switch-announcement-active"
              />
              <Label htmlFor="ann-active" className="font-normal cursor-pointer">
                Active (visible on user dashboards)
              </Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setDialogOpen(false); resetForm(); }} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving} data-testid="button-save-announcement">
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {editing ? "Save Changes" : "Post Announcement"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
