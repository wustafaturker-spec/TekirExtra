import type { Route } from "@playwright/test";

/** Eski ödeme/yönetim senaryolarının firma verilerini yeni liste sözleşmesiyle sunar. */
export function firmaSayfasi<T extends { tenantId: string; unvan: string; vkn: string; planKodu?: string; durum?: string; askiyaAlinacak?: boolean; bekleyenTalep?: unknown }>(route: Route, firmalar: T[]) {
  const p = new URL(route.request().url()).searchParams;
  const arama = (p.get("arama") ?? "").toLocaleLowerCase("tr-TR");
  const kayitlar = firmalar.filter((f) =>
    (!p.get("firma") || f.tenantId === p.get("firma")) &&
    (!p.get("plan") || f.planKodu === p.get("plan")) &&
    (`${f.unvan} ${f.vkn}`.toLocaleLowerCase("tr-TR").includes(arama)) &&
    (p.get("goster") === "askiyaAlinacak" ? f.askiyaAlinacak : p.get("goster") === "talep" ? f.bekleyenTalep : !p.get("goster") || p.get("goster") === "hepsi" || f.durum === p.get("goster")));
  return route.fulfill({ json: {
    kayitlar, toplam: kayitlar.length, sayfa: 1, sayfaBoyutu: 25,
    sayilar: { toplam: firmalar.length, talep: firmalar.filter((f) => f.bekleyenTalep).length, askiyaAlinacak: firmalar.filter((f) => f.askiyaAlinacak).length, askida: firmalar.filter((f) => f.durum === "askida").length, iptal: firmalar.filter((f) => f.durum === "iptal").length },
  } });
}
