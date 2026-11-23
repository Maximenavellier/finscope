"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Briefcase, Filter, Home, Scale, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";

const MOBILE_TABS = [
  { href: "/", label: "Radar", icon: Home },
  { href: "/portfolio", label: "Portefeuille", icon: Briefcase },
  { href: "/projections", label: "Objectifs", icon: TrendingUp },
  { href: "/compare", label: "Duel", icon: Scale },
  { href: "/screener", label: "Screener", icon: Filter },
];

export function MobileBottomNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Navigation mobile"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200/90 bg-white/95 backdrop-blur-md pb-[env(safe-area-inset-bottom)] md:hidden dark:border-slate-800/90 dark:bg-slate-950/95"
    >
      <div className="mx-auto grid max-w-lg grid-cols-5 px-1 py-1.5">
        {MOBILE_TABS.map(({ href, label, icon: Icon }) => {
          const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex flex-col items-center justify-center gap-0.5 rounded-xl py-1 text-[10px] font-semibold transition-colors",
                active
                  ? "text-blue-600 dark:text-blue-400"
                  : "text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
              )}
            >
              <span
                className={cn(
                  "flex h-7 w-11 items-center justify-center rounded-full transition-colors",
                  active && "bg-blue-50 dark:bg-blue-950/70"
                )}
              >
                <Icon className="h-4 w-4" />
              </span>
              <span className="truncate">{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
