import type { Metadata } from "next";
import { IpdMonitor } from "@/components/ipd-monitor";
import "./ipd.css";
export const metadata: Metadata = {
  title: "IPD · Miden availability",
  description: "Read-only, exact-order IPD fill estimates on Miden mainnet.",
};
export default function IpdPage() {
  return <IpdMonitor />;
}
