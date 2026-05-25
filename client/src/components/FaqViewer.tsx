import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from "@/components/ui/accordion";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogTitle, DialogDescription, DialogHeader,
} from "@/components/ui/dialog";
import { HelpCircle, Image as ImageIcon } from "lucide-react";
import type { FaqCategory, FaqEntry, FaqEntryImage } from "@shared/schema";

type EntryWithImages = FaqEntry & { images?: FaqEntryImage[] };
type FaqGroup = { category: FaqCategory; entries: EntryWithImages[] };

interface FaqViewerProps {
  /** Optional category slug to scope the viewer to a single category. Omit to show all categories visible to the current user. */
  categorySlug?: string;
  /** Optional override for the card title. Defaults to "Frequently Asked Questions" or the category name. */
  title?: string;
  /** Optional Lucide icon override (defaults to HelpCircle). */
  icon?: React.ReactNode;
}

export function FaqViewer({ categorySlug, title, icon }: FaqViewerProps) {
  const [lightbox, setLightbox] = useState<{ url: string; caption: string | null } | null>(null);

  const { data, isLoading } = useQuery<{ groups: FaqGroup[] }>({
    queryKey: ["/api/faq", categorySlug ? { category: categorySlug } : {}],
  });

  const groups = data?.groups ?? [];
  const hasContent = groups.some(g => g.entries.length > 0);

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {icon ?? <HelpCircle className="h-5 w-5" />}
            {title ?? "Frequently Asked Questions"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-24 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (!hasContent) {
    return null;
  }

  const headerTitle = title ?? (categorySlug && groups[0]?.category ? `${groups[0].category.name} — FAQ` : "Frequently Asked Questions");

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {icon ?? <HelpCircle className="h-5 w-5" />}
            {headerTitle}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {groups.map((g) =>
            g.entries.length === 0 ? null : (
              <div key={g.category.id} className="space-y-3">
                {!categorySlug && (
                  <div className="space-y-1">
                    <h3 className="font-semibold text-base">{g.category.name}</h3>
                    {g.category.description && (
                      <p className="text-sm text-muted-foreground">{g.category.description}</p>
                    )}
                  </div>
                )}
                <Accordion type="multiple" className="space-y-2">
                  {g.entries.map((e) => (
                    <AccordionItem
                      key={e.id}
                      value={e.id}
                      className="border rounded-md px-3"
                      data-testid={`faq-entry-${e.id}`}
                    >
                      <AccordionTrigger className="hover:no-underline py-3">
                        <div className="flex items-center gap-2 flex-wrap text-left">
                          <span className="font-medium">{e.title}</span>
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
                          <p className="text-sm whitespace-pre-wrap">{e.body}</p>
                          {e.images && e.images.length > 0 && (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                              {e.images.map((img) => (
                                <figure key={img.id} className="border rounded-md overflow-hidden bg-muted/30">
                                  <button
                                    type="button"
                                    onClick={() => setLightbox({ url: img.imageUrl, caption: img.caption })}
                                    className="block w-full hover-elevate active-elevate-2"
                                  >
                                    <img
                                      src={img.imageUrl}
                                      alt={img.caption || e.title}
                                      className="w-full max-h-72 object-contain bg-white"
                                    />
                                  </button>
                                  {img.caption && (
                                    <figcaption className="text-xs text-muted-foreground p-2 border-t">
                                      {img.caption}
                                    </figcaption>
                                  )}
                                </figure>
                              ))}
                            </div>
                          )}
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  ))}
                </Accordion>
              </div>
            ),
          )}
        </CardContent>
      </Card>

      <Dialog open={!!lightbox} onOpenChange={(o) => { if (!o) setLightbox(null); }}>
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle>{lightbox?.caption || "Screenshot"}</DialogTitle>
            {lightbox?.caption && <DialogDescription className="sr-only">{lightbox.caption}</DialogDescription>}
          </DialogHeader>
          {lightbox && (
            <img
              src={lightbox.url}
              alt={lightbox.caption || "Screenshot"}
              className="w-full max-h-[80vh] object-contain bg-white rounded"
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
