import { useEffect, useState } from "react";
import { Clock, Calendar, FileText, Mail, Calculator, Gift, Megaphone, ChevronLeft, ChevronRight } from "lucide-react";
import { MenuCard } from "@/components/MenuCard";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import type { Announcement } from "@shared/schema";

const ROTATE_INTERVAL_MS = 6000;

function AnnouncementCarousel() {
  const { data, isLoading } = useQuery<{ announcements: Announcement[] }>({
    queryKey: ["/api/announcements"],
  });
  const [idx, setIdx] = useState(0);

  const list = data?.announcements || [];

  useEffect(() => {
    if (list.length <= 1) return;
    const t = setInterval(() => setIdx((i) => (i + 1) % list.length), ROTATE_INTERVAL_MS);
    return () => clearInterval(t);
  }, [list.length]);

  // Reset index if the list shrinks below current index
  useEffect(() => {
    if (idx >= list.length && list.length > 0) setIdx(0);
  }, [list.length, idx]);

  if (isLoading || list.length === 0) {
    // Hide the card entirely when there's nothing to show
    return null;
  }

  const current = list[idx];
  const prev = () => setIdx((i) => (i - 1 + list.length) % list.length);
  const next = () => setIdx((i) => (i + 1) % list.length);

  return (
    <Card className="bg-primary text-primary-foreground overflow-hidden">
      <CardContent className="p-6">
        <div className="flex items-start gap-4">
          <Megaphone className="h-6 w-6 shrink-0 mt-1" />
          <div className="flex-1 min-w-0">
            <h3 className="text-xl font-semibold mb-2" data-testid="text-announcement-title">
              {current.title}
            </h3>
            <p className="text-sm opacity-90 whitespace-pre-wrap" data-testid="text-announcement-body">
              {current.body}
            </p>
            {list.length > 1 && (
              <div className="flex items-center gap-2 mt-4">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={prev}
                  className="h-7 w-7 text-primary-foreground hover:bg-primary-foreground/20"
                  data-testid="button-announcement-prev"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <div className="flex gap-1">
                  {list.map((_, i) => (
                    <span
                      key={i}
                      className={`h-1.5 w-1.5 rounded-full transition-opacity ${i === idx ? "opacity-100" : "opacity-40"} bg-primary-foreground`}
                    />
                  ))}
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={next}
                  className="h-7 w-7 text-primary-foreground hover:bg-primary-foreground/20"
                  data-testid="button-announcement-next"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
                <span className="text-xs opacity-70 ml-1">{idx + 1} / {list.length}</span>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function Dashboard() {
  const [, setLocation] = useLocation();

  const menuItems = [
    { title: "Attendance", icon: Clock, path: "/attendance" },
    { title: "Leave", icon: Calendar, path: "/leave" },
    { title: "Claims", icon: FileText, path: "/claims" },
    { title: "Payslip", icon: Mail, path: "/my-payslips" },
    { title: "Income Tax", icon: Calculator, path: "/income-tax" },
    { title: "Rewards", icon: Gift, path: "/rewards" },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl md:text-3xl font-semibold mb-3 md:mb-6" data-testid="text-dashboard-title">
          What do you want to do today?
        </h2>
        <div className="grid grid-cols-3 gap-2 md:gap-6">
          {menuItems.map((item) => (
            <MenuCard
              key={item.title}
              title={item.title}
              icon={item.icon}
              onClick={() => setLocation(item.path)}
            />
          ))}
        </div>
      </div>

      <AnnouncementCarousel />
    </div>
  );
}
