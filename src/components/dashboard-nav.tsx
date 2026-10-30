import Link from "next/link";
import styles from "./dashboard-nav.module.css";
export function DashboardNav({ active }: { active: "epoch" | "ipd" }) {
  return (
    <nav className={styles.nav} aria-label="Monitors">
      <Link href="/" aria-current={active === "epoch" ? "page" : undefined}>
        Epoch
      </Link>
      <Link href="/ipd" aria-current={active === "ipd" ? "page" : undefined}>
        IPD
      </Link>
    </nav>
  );
}
