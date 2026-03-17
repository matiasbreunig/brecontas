"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import {
  LayoutDashboard,
  Wallet,
  ArrowLeftRight,
  Settings,
  LogOut,
  ChevronLeft,
  ChevronRight,
  CalendarDays,
  Inbox,
  Upload,
  BarChart3,
  CreditCard,
  Repeat,
  Menu,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useMonth } from "@/hooks/use-month";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { useState, useEffect } from "react";

const navItems = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/inbox", label: "Inbox", icon: Inbox },
  { href: "/contas", label: "Contas", icon: Wallet },
  { href: "/transacoes", label: "Transações", icon: ArrowLeftRight },
  { href: "/importar", label: "Importar", icon: Upload },
  { href: "/faturas", label: "Faturas", icon: CreditCard },
  { href: "/recorrentes", label: "Recorrentes", icon: Repeat },
  { href: "/relatorios", label: "Relatórios", icon: BarChart3 },
  { href: "/configuracoes", label: "Configurações", icon: Settings },
];

interface AppSidebarProps {
  user: { name?: string | null; email?: string | null };
}

/** Sidebar navigation content — shared between desktop and mobile drawer */
function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { month, prevMonth, nextMonth, goToToday, isCurrentMonth } = useMonth();

  const monthLabel = format(month, "MMMM", { locale: ptBR });
  const yearLabel = format(month, "yyyy");

  return (
    <>
      {/* Logo */}
      <div className="flex items-center gap-3 px-5 py-5">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold text-base">
          B
        </div>
        <span className="font-semibold text-lg tracking-tight text-sidebar-foreground">Brecontas</span>
      </div>

      {/* Month Selector */}
      <div className="mx-3 mb-4 rounded-lg border border-sidebar-border p-3">
        <div className="flex items-center justify-between mb-1">
          <button
            onClick={prevMonth}
            className="rounded-md p-1.5 hover:bg-sidebar-accent transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <div className="text-center">
            <p className="text-sm font-semibold capitalize">{monthLabel}</p>
            <p className="text-xs text-sidebar-foreground/50">{yearLabel}</p>
          </div>
          <button
            onClick={nextMonth}
            className="rounded-md p-1.5 hover:bg-sidebar-accent transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        {!isCurrentMonth && (
          <button
            onClick={goToToday}
            className="w-full mt-1 text-[11px] text-primary hover:text-primary/80 font-medium transition-colors flex items-center justify-center gap-1"
          >
            <CalendarDays className="h-3 w-3" />
            Ir para mês atual
          </button>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-0.5 px-3">
        {navItems.map((item) => {
          const isActive = item.href === "/"
            ? pathname === "/"
            : pathname.startsWith(item.href);

          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-all duration-150 min-h-[44px]",
                isActive
                  ? "bg-primary/10 text-primary font-medium"
                  : "text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground"
              )}
            >
              <item.icon className="h-[18px] w-[18px]" />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </>
  );
}

export function AppSidebar({ user }: AppSidebarProps) {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Close drawer on route change
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  const userSection = (
    <div className="border-t border-sidebar-border p-3">
      <div className="flex items-center gap-3 rounded-lg px-3 py-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary text-sm font-semibold">
          {user.name?.charAt(0)?.toUpperCase() ?? "?"}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate text-sidebar-foreground">{user.name}</p>
        </div>
        <button
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="rounded-md p-1.5 hover:bg-sidebar-accent transition-colors text-sidebar-foreground/40 hover:text-sidebar-foreground min-h-[44px] min-w-[44px] flex items-center justify-center"
          title="Sair"
        >
          <LogOut className="h-4 w-4" />
        </button>
      </div>
    </div>
  );

  // Mobile: hamburger + sheet drawer
  if (isMobile) {
    return (
      <>
        {/* Mobile top bar */}
        <header className="fixed top-0 inset-x-0 z-40 flex h-14 items-center gap-3 border-b bg-background/95 backdrop-blur-sm px-4 supports-backdrop-filter:bg-background/80">
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger render={<Button variant="ghost" size="icon" className="shrink-0" />}>
              <Menu className="h-5 w-5" />
              <span className="sr-only">Menu</span>
            </SheetTrigger>
            <SheetContent side="left" className="w-72 p-0 bg-sidebar text-sidebar-foreground border-r border-sidebar-border" showCloseButton={false}>
              <div className="flex h-full flex-col">
                <SidebarNav onNavigate={() => setOpen(false)} />
                {userSection}
              </div>
            </SheetContent>
          </Sheet>
          <MobileMonthNav />
        </header>
        {/* Spacer to push content below the fixed header */}
        <div className="h-14 shrink-0" />
      </>
    );
  }

  // Desktop: fixed sidebar
  return (
    <aside className="flex h-screen w-64 flex-col bg-sidebar text-sidebar-foreground sticky top-0 shrink-0 border-r border-sidebar-border">
      <SidebarNav />
      {userSection}
    </aside>
  );
}

/** Compact month nav for mobile header */
function MobileMonthNav() {
  const { month, prevMonth, nextMonth } = useMonth();
  const monthLabel = format(month, "MMM yyyy", { locale: ptBR });

  return (
    <div className="flex items-center gap-1 ml-auto">
      <button onClick={prevMonth} className="rounded-lg p-2 hover:bg-muted transition-colors">
        <ChevronLeft className="h-4 w-4" />
      </button>
      <span className="text-sm font-medium capitalize min-w-[80px] text-center">{monthLabel}</span>
      <button onClick={nextMonth} className="rounded-lg p-2 hover:bg-muted transition-colors">
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );
}
