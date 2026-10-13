import { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { istekBaglami } from "../core/istek-baglami";
import { beklenenOdemeTarihi, oncelikPuani, TahsilatRiskiService } from "./tahsilat-riski";

const GUN = 86_400_000;
const bugun = new Date(`${new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Istanbul" })}T00:00:00Z`);
const gunOnce = (n: number) => new Date(bugun.getTime() - n * GUN);
const D = (x: number) => new Prisma.Decimal(x);

describe("öncelik puanı ve beklenen ödeme (AI-17/18)", () => {
  it("kalan × katsayı × (1 + gecikme/30); vadesi gelmemişte gecikme 0", () => {
    expect(oncelikPuani(1000, "yuksek", 30)).toBe(4000);
    expect(oncelikPuani(1000, "dusuk", -5)).toBe(1000);
    expect(oncelikPuani(1000, "orta", 0)).toBe(1500);
  });

  it("beklenen ödeme vade + tahmini gecikme, bugünden önce olamaz", () => {
    expect(beklenenOdemeTarihi(gunOnce(-10), 5, bugun)).toBe(gunOnce(-15).toISOString().slice(0, 10));
    expect(beklenenOdemeTarihi(gunOnce(40), 5, bugun)).toBe(bugun.toISOString().slice(0, 10));
    expect(beklenenOdemeTarihi(gunOnce(-10), null, bugun)).toBe(gunOnce(-10).toISOString().slice(0, 10));
  });
});

describe("TahsilatRiskiService — risk cari kartındaki analizden", () => {
  function kur(faturalar: unknown[], hareketler: Record<string, unknown[]>) {
    const tx = {
      fatura: { findMany: vi.fn().mockResolvedValue(faturalar) },
      cariHesap: { findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) => where.id.in.map((id) => ({ id, riskLimiti: null, hareketler: hareketler[id] ?? [] }))) },
    };
    const s = new TahsilatRiskiService({ tenantIslem: (_t: string, fn: (x: typeof tx) => unknown) => fn(tx) } as never);
    return { s, tx, olarak: <T>(fn: () => Promise<T>) => istekBaglami.run({ deger: { tenantId: "t", userId: "u", rol: "muhasebe" } }, fn) };
  }
  const fatura = (id: string, cariId: string, vadeGunOnce: number, toplam: number, odenen = 0) => ({
    id, no: id, durum: "kesin", vadeTarihi: gunOnce(vadeGunOnce), genelToplam: D(toplam), kur: D(1),
    cari: { id: cariId, unvan: cariId }, kapamalar: odenen ? [{ tutar: D(odenen) }] : [], iadeKapamalari: [],
  });
  // Geç ödeyen cari: borç vadesinden 40 gün sonra kapanıyor, açık bakiyesi vadesi geçmiş.
  const gecOdeyen = [
    { tip: "borc", tutarTry: D(1000), tarih: gunOnce(200), vadeTarihi: gunOnce(190) },
    { tip: "alacak", tutarTry: D(1000), tarih: gunOnce(150), vadeTarihi: null },
    { tip: "borc", tutarTry: D(1000), tarih: gunOnce(100), vadeTarihi: gunOnce(60) },
  ];

  it("risk ve tahmini gecikme cariDavranisAnalizi'nden; ödenmiş kısım kalandan düşülür", async () => {
    const k = kur([fatura("f1", "geç", 60, 1000, 400)], { "geç": gecOdeyen });
    const r = await k.olarak(() => k.s.cariRiski("geç"));
    expect(r.tahminiGecikmeGun).toBe(40);
    expect(r.riskSeviyesi).toBe("yuksek");
    expect(r.acikFaturalar[0]).toMatchObject({ faturaId: "f1", kalanTry: 600, gecikmeGun: 60 });
  });

  it("öncelik listesi vadesi geçmiş/7 gün içindekileri alır, puana göre sıralar", async () => {
    const k = kur([fatura("a", "geç", 60, 1000), fatura("b", "yeni", -3, 1000)], { "geç": gecOdeyen });
    const l = await k.olarak(() => k.s.oncelikler());
    expect(l.map((x) => x.cariId)).toEqual(["geç", "yeni"]);
    expect(l[0]).toMatchObject({ risk: "yuksek", riskKatsayisi: 2, enEskiGecikmeGun: 60, faturaSayisi: 1 });
    expect(k.tx.fatura.findMany.mock.calls[0][0].where.vadeTarihi.lte.getTime()).toBe(bugun.getTime() + 7 * GUN);
  });
});
