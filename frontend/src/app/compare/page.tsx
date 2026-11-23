import { Suspense } from "react";
import type { Metadata } from "next";
import { CompareClient } from "@/components/compare/CompareClient";
import { Skeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = {
  title: "Comparateur Face-à-Face | FinScope",
  description:
    "Comparez deux actions ou ETF côte à côte : cours, piliers /100, croissance, marges, rentabilité et valorisation.",
};

export default function ComparePage() {
  return (
    <Suspense
      fallback={
        <div className="space-y-4">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-28 w-full" />
          <div className="grid gap-4 md:grid-cols-2">
            <Skeleton className="h-36 w-full" />
            <Skeleton className="h-36 w-full" />
          </div>
        </div>
      }
    >
      <CompareClient />
    </Suspense>
  );
}
