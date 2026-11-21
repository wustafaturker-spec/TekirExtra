import { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

vi.mock("../core/istek-baglami", () => ({ aktifBaglam: () => ({ tenantId: "t1", userId: "u1", rol: "muhasebe" }) }));
vi.mock("../ai/saglayici/kiraci-saglayici", () => ({ kiraciSaglayicisi: vi.fn(async () => { throw new Error("model çağrılmamalı"); }) }));
const { EkstreEslestirmeService } = await import("./ekstre-eslestirme.service");

const D = (x: string) => new Prisma.Decimal(x);
const uuid = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;

/** Bilinmeyen her model yöntemi boş döner; yazma yöntemleri izlenir. */
function sahteTx(ozel: Record<string, Record<string, unknown>>) {
  const yazmalar = vi.fn();
  const tx = new Proxy({}, {
    get: (_h, model: string) => new Proxy({}, {
      get: (_m, yontem: string) => ozel[model]?.[yontem] ?? (/^(create|update|upsert|delete)/.test(yontem)
        ? vi.fn(async (...a: unknown[]) => { yazmalar(model, yontem, ...a); return {}; })
        : vi.fn(async () => (yontem.startsWith("findMany") || yontem === "groupBy" ? [] : null))),
    }),
  });
  return { tx, yazmalar };
}
function kur(satir: Record<string, unknown>, cariler: unknown[]) {
  const { tx, yazmalar } = sahteTx({
    bankaEkstreSatir: { findUnique: vi.fn(async () => ({ id: "s1", bankaHesapId: "b1", tarih: new Date("2026-11-10"), tutar: D("1500.00"), aciklama: "HAVALE", dekontNo: null, karsiIban: null, karsiUnvan: null, durum: "beklemede", eslesmeTuru: null, bankaHesap: { ad: "Vadesiz", dovizCinsi: "TRY" }, _count: { hareketler: 0 }, ...satir })), findMany: vi.fn(async () => []) },
    cariHesap: { findMany: vi.fn(async () => cariler), findFirst: vi.fn(async () => null), findUnique: vi.fn(async () => null) },
  });
  const prisma = { tenantIslem: (_t: string, fn: (x: unknown) => unknown) => fn(tx) };
  const service = new EkstreEslestirmeService(prisma as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never) as any;
  return { service, yazmalar };
}

describe("AI-119 öneri ekranı", () => {
  it("okuma isteği satıra skor yazmaz", async () => {
    const cariler = Array.from({ length: 757 }, (_, i) => ({ id: uuid(i + 1), kod: `C${i + 1}`, unvan: `Firma ${i + 1}`, vknTckn: String(1000000000 + i), iban: null, tip: "musteri" }));
    const { service, yazmalar } = kur({ aciklama: "ODEME 1000000756" }, cariler);
    const o = await service.oneriler("s1");
    expect(o.eslesmeSkoru).toBeGreaterThan(0);
    expect(yazmalar.mock.calls.filter((c) => c[0] === "bankaEkstreSatir")).toEqual([]);
  });

  it("yakın ikinci aday varsa cari kendiliğinden seçilmez; alternatifler döner", async () => {
    // Unvan kural yolunda (cariOner) aynı unvanlı iki kart çekimser kalır; motor da belirsiz döner.
    const cariler = [
      { id: uuid(1), kod: "C1", unvan: "Deneme Otomotiv Ltd", vknTckn: "1111111111", iban: null, tip: "musteri" },
      { id: uuid(2), kod: "C2", unvan: "Deneme Otomotiv Ltd", vknTckn: "2222222222", iban: null, tip: "musteri" },
    ];
    const { service } = kur({ aciklama: "HAVALE", karsiUnvan: "DENEME OTOMOTIV LTD" }, cariler);
    const o = await service.temelOneriler("t1", await service.satirGetir("t1", "s1"), true, D("1500.00"), "TRY");
    expect(o.onerilenCari).toBeNull();
    expect(o.alternatifAdaylar).toHaveLength(2);
  });
});
