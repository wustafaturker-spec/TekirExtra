import { BadRequestException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { faturaStopajlari, type PesinVergiSatiri } from "./pesin-vergi-kaynaklari";
import { pesinVergiOzeti, type MahsupKaydi } from "./pesin-vergi.hesap";
import { pesinVergiMahsupSemasi } from "./pesin-vergi.semalar";
import { PesinVergiService } from "./pesin-vergi.service";

vi.mock("../core/istek-baglami", () => ({ aktifBaglam: () => ({ tenantId: "t1", userId: "u1", rol: "muhasebe" }) }));

const D = (d: number | string) => new Prisma.Decimal(d);
const satir = (id: string, tarih: string, tl: number, ek: Partial<PesinVergiSatiri> = {}): PesinVergiSatiri => ({
  kaynakTur: "gelir", kaynakId: id, tarih, belgeNo: id, cariId: null, cari: null, tur: "Temettü", matrah: D(1000), oran: "10", tutar: D(tl), dovizCinsi: "TRY", kur: D(1), tutarTry: D(tl), yol: "/panel/gelirler", ...ek,
});
const mahsup = (id: string, tl: number, ek: Partial<MahsupKaydi> = {}): MahsupKaydi => ({
  id: `m-${id}`, kaynakTur: "gelir", kaynakId: id, beyannameTuru: "gecici_vergi", yil: 2026, donem: 1, not: null, tutarTry: D(tl), belgeTarihi: new Date("2026-02-01"), etiket: `etiket ${id}`, ...ek,
});

describe("peşin vergi özeti (GLR-06)", () => {
  const SATIRLAR = [
    satir("a", "2025-12-20", 40),
    satir("b", "2026-02-01", 100),
    satir("c", "2026-03-15", 60, { kaynakTur: "fatura", tur: "Gelir Vergisi Stopajı" }),
    satir("d", "2026-03-20", -10, { kaynakTur: "pazaryeri", tur: "E-ticaret stopajı · trendyol", matrah: null }),
    satir("e", "2026-05-01", 500),
  ];

  it("dönem, mahsup edilen ve dönem sonuna kadarki bakiyeyi ayırır; eksi satırı netler", () => {
    const r = pesinVergiOzeti(SATIRLAR, [mahsup("b", 100)], "2026-01-01", "2026-03-31");
    expect(r.satirlar.map((s) => s.kaynakId)).toEqual(["b", "c", "d"]);
    expect(r.ozet).toEqual({ donemToplamTry: "150.00", mahsupEdilenTry: "100.00", mahsupEdilecekTry: "50.00", bakiyeTry: "90.00" });
  });

  it("kaynak ve tür kırılımı verir", () => {
    const r = pesinVergiOzeti(SATIRLAR, [], "2026-01-01", "2026-03-31");
    expect(r.kaynakKirilimi).toEqual([
      { baslik: "Faaliyet dışı gelir", adet: 1, tutarTry: "100.00" },
      { baslik: "Pazaryeri e-ticaret stopajı", adet: 1, tutarTry: "-10.00" },
      { baslik: "Satış faturası", adet: 1, tutarTry: "60.00" },
    ]);
    expect(r.turKirilimi.map((k) => k.baslik)).toContain("Temettü");
  });

  it("dönem dışı kaynağa bağlı işareti kopuk saymaz; silinen ve tutarı değişen kaynağı bildirir", () => {
    const r = pesinVergiOzeti(SATIRLAR, [mahsup("e", 500), mahsup("yok", 25), mahsup("c", 75, { kaynakTur: "fatura" })], "2026-01-01", "2026-03-31");
    expect(r.kopuklar.map((k) => [k.id, k.neden, k.guncelTutarTry])).toEqual([["m-yok", "kaynak_yok", null], ["m-c", "tutar_degisti", "60.00"]]);
  });

  it("beyannameye göre toplar", () => {
    const r = pesinVergiOzeti(SATIRLAR, [mahsup("a", 40, { yil: 2025, beyannameTuru: "yillik", donem: null }), mahsup("b", 100), mahsup("c", 60, { kaynakTur: "fatura" })], "2026-01-01", "2026-03-31");
    expect(r.beyanlar.map((b) => [b.yil, b.beyannameTuru, b.adet, b.tutarTry])).toEqual([[2026, "gecici_vergi", 2, "160.00"], [2025, "yillik", 1, "40.00"]]);
  });
});

describe("fatura stopajı okuma", () => {
  it("yalnız stopaj vergilerini fatura başına toplar, kesin satış faturasını sorar", async () => {
    const f = { id: "f1", no: null, tarih: new Date("2026-03-01T00:00:00Z"), kur: D(30), dovizCinsi: "EUR", cari: { id: "c1", unvan: "Alıcı" } };
    const findMany = vi.fn().mockResolvedValue([
      { matrah: D(100), fatura: f, ekVergiler: [{ ad: "Stopaj", oran: "20", matrah: null, tutar: "20.00", stopaj: true }, { ad: "ÖTV", oran: "5", matrah: null, tutar: "5.00", stopaj: false }] },
      { matrah: D(50), fatura: f, ekVergiler: [{ ad: "Stopaj", oran: "20", matrah: "50.00", tutar: "10.00", stopaj: true }] },
    ]);
    const [s] = await faturaStopajlari({ faturaSatir: { findMany } } as never, {});
    expect(findMany.mock.calls[0][0].where.fatura).toEqual({ durum: "kesin", tip: "satis" });
    expect(s).toMatchObject({ belgeNo: "Numarasız", tur: "Stopaj", oran: "20" });
    expect([s.matrah!.toFixed(2), s.tutar.toFixed(2), s.tutarTry.toFixed(2)]).toEqual(["150.00", "30.00", "900.00"]);
  });
});

describe("mahsup işareti", () => {
  const ID = "11111111-1111-4111-8111-111111111111";
  const servis = (createCount: number) => {
    const createMany = vi.fn().mockResolvedValue({ count: createCount });
    const tx = {
      gelirKaydi: { findMany: vi.fn().mockResolvedValue([{ id: ID, tarih: new Date("2026-02-01T00:00:00Z"), belgeNo: "D1", brutTutar: D(1000), stopajOrani: D(10), stopajTutari: D(100), dovizCinsi: "TRY", kur: D(1), kategori: { ad: "Temettü" }, cari: null }]) },
      faturaSatir: { findMany: vi.fn().mockResolvedValue([]) },
      pazaryeriKesinti: { findMany: vi.fn().mockResolvedValue([]) },
      pesinVergiMahsup: { createMany },
    };
    return { s: new PesinVergiService({ tenantIslem: (_: string, f: (t: unknown) => unknown) => f(tx) } as never), createMany };
  };
  const girdi = { kalemler: [{ kaynakTur: "gelir" as const, kaynakId: ID }], beyannameTuru: "gecici_vergi" as const, yil: 2026, donem: 1 };

  it("tutarı kaynaktan alır, işaret anının kopyasını saklar", async () => {
    const { s, createMany } = servis(1);
    await expect(s.mahsupEt(girdi)).resolves.toEqual({ isaretlenen: 1 });
    const kayit = createMany.mock.calls[0][0].data[0];
    expect(kayit).toMatchObject({ tenantId: "t1", kaynakId: ID, donem: 1, etiket: "Faaliyet dışı gelir · D1 · Temettü", isaretleyenId: "u1" });
    expect(kayit.tutarTry.toFixed(2)).toBe("100.00");
  });

  it("kaynağı kalmayan ya da zaten işaretli kaydı reddeder", async () => {
    await expect(servis(1).s.mahsupEt({ ...girdi, kalemler: [{ kaynakTur: "fatura", kaynakId: ID }] })).rejects.toBeInstanceOf(BadRequestException);
    await expect(servis(0).s.mahsupEt(girdi)).rejects.toBeInstanceOf(BadRequestException);
  });

  it("geçici vergide dönem zorunlu, yıllıkta yasak", () => {
    expect(pesinVergiMahsupSemasi.safeParse({ ...girdi, donem: undefined }).success).toBe(false);
    expect(pesinVergiMahsupSemasi.safeParse({ ...girdi, beyannameTuru: "yillik" }).success).toBe(false);
    expect(pesinVergiMahsupSemasi.safeParse({ ...girdi, beyannameTuru: "yillik", donem: null }).success).toBe(true);
  });
});
