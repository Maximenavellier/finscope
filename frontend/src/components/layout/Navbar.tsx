"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, Briefcase, Filter, Home, Scale, Search, TrendingUp } from "lucide-react";
import { ApiStatusPopover } from "@/components/layout/ApiStatusPopover";
import { CommandSearch } from "@/components/layout/CommandSearch";
import { useDisplayCurrency } from "@/components/layout/CurrencyProvider";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { cn } from "@/lib/utils";

export function Navbar() {
  const pathname = usePathname();
  const [searchOpen, setSearchOpen] = useState(false);
  const { displayCurrency, setDisplayCurrency } = useDisplayCurrency();

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen((prev) => !prev);
      }
    };
    const onCustomOpen = () => setSearchOpen(true);

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("finscope:open-search", onCustomOpen);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("finscope:open-search", onCustomOpen);
    };
  }, []);

  const navLinks = [
    { href: "/", label: "Accueil", icon: Home },
    { href: "/portfolio", label: "Portefeuille", icon: Briefcase },
    { href: "/projections", label: "Projections", icon: TrendingUp },
    { href: "/compare", label: "Comparateur", icon: Scale },
    { href: "/screener", label: "Screener", icon: Filter },
  ];

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/90 backdrop-blur-md dark:border-slate-800/80 dark:bg-slate-900/90">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-6">
            <Link href="/" className="flex items-center gap-2 font-bold tracking-tight text-slate-900 dark:text-white">
              <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-blue-600 text-white shadow-xs">
                <BarChart3 className="h-4 w-4" />
              </span>
              <span className="text-base">FinScope</span>
            </Link>

            <nav className="hidden items-center gap-1 md:flex">
              {navLinks.map(({ href, label, icon: Icon }) => {
                const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
                return (
                  <Link
                    key={href}
                    href={href}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-sm font-medium transition-colors",
                      active
                        ? "bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300"
                        : "text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    <span>{label}</span>
                  </Link>
                );
              })}
            </nav>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2">
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              className="flex h-9 items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-2.5 text-sm text-slate-500 transition-colors hover:border-slate-300 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800/80 dark:text-slate-400 dark:hover:border-slate-600 dark:hover:bg-slate-800 sm:w-64 sm:px-3 md:w-72 cursor-pointer"
              aria-label="Rechercher un titre"
            >
              <Search className="h-4 w-4 shrink-0 text-slate-400" />
              <span className="hidden truncate sm:inline">Rechercher action ou ETF...</span>
              <kbd className="ml-auto hidden rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-semibold text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400 sm:inline-block">
                Ctrl+K
              </kbd>
            </button>

            <div
              className="flex items-center rounded-xl border border-slate-200 bg-slate-50 p-0.5 dark:border-slate-700 dark:bg-slate-800"
              title="Devise d'affichage globale"
            >
              {(["EUR", "USD"] as const).map((cur) => (
                <button
                  key={cur}
                  type="button"
                  onClick={() => setDisplayCurrency(cur)}
                  className={cn(
                    "rounded-lg px-2 py-1 text-xs font-bold transition-colors cursor-pointer",
                    displayCurrency === cur
                      ? "bg-white text-blue-600 shadow-xs dark:bg-slate-900 dark:text-blue-400"
                      : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100"
                  )}
                >
                  {cur === "EUR" ? "€" : "$"}
                </button>
              ))}
            </div>

            <ApiStatusPopover />
            <ThemeToggle />
          </div>
        </div>
      </header>

      <CommandSearch open={searchOpen} onOpenChange={setSearchOpen} />
    </>
  );
}
