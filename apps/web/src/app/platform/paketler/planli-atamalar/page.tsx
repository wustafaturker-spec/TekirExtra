"use client";
import Link from "next/link";
import { Suspense } from "react";
import { PageHeader } from "@/components/ui";
import { PlatformPlanliPaketAtamalari } from "@/components/platform-planli-paket-atamalari";
export default function PlanliAtamalar() {
  return <div className="stack"><PageHeader title="Planlı paket atamaları" subtitle="Gelecek fiyat geçişlerini ve inceleme bekleyen planları yönetin." /><Link href="/platform/paketler">Paket kataloğuna dön</Link><Suspense fallback={<p role="status">Planlar yükleniyor…</p>}><PlatformPlanliPaketAtamalari /></Suspense></div>;
}
