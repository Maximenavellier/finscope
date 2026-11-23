import { StockDetailClient } from "@/components/stock/StockDetailClient";

export default async function StockPage({
  params,
}: {
  params: Promise<{ ticker: string }>;
}) {
  const { ticker } = await params;
  const decoded = decodeURIComponent(ticker).trim().toUpperCase();
  return <StockDetailClient key={decoded} ticker={decoded} />;
}
