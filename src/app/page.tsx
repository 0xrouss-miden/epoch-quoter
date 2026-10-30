import { getCatalog } from "@/lib/catalog";
import { QuoteMonitor } from "@/components/quote-monitor";
import { connection } from "next/server";
export default async function Home() {
  await connection();
  return <QuoteMonitor catalog={getCatalog()} />;
}
