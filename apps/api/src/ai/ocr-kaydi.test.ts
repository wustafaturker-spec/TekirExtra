import { describe, expect, it, vi } from "vitest";
import { fisFaturaDogrula } from "./ai.dogrulama";
import { ocrKaydiYaz, ocrSonucSemasi, ocrSonucuBagla } from "./ocr-kaydi";

const M1 = "00000000-0000-4000-8000-0000000000a1";
const M2 = "00000000-0000-4000-8000-0000000000a2";
const C1 = "00000000-0000-4000-8000-0000000000c1";

function tx(olusan: unknown = null) {
  return {
    belgeOcrKaydi: {
      create: vi.fn(async () => ({ id: "k1" })),
      findUnique: vi.fn(async () => ({ olusanKayitlar: olusan, belgeTuru: "FIS_FATURA" })),
      update: vi.fn(async () => ({})),
    },
    masraf: { count: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) => where.id.in.filter((x) => x !== "yok").length) },
    cariHesap: { findUnique: vi.fn(async () => ({ id: C1 })) },
  };
}

describe("tarama kaydı (AI-13)", () => {
  it("kim, kanal, sağlayıcı ve çıkarılan veriyle yazılır; ham metin sınırlanır", async () => {
    const t = tx();
    await ocrKaydiYaz(t as never, { tenantId: "t", kullaniciId: "u", belgeTuru: "KARTVIZIT", kanal: "WEB", saglayici: "gemini", model: "g-2", hamMetin: "x".repeat(30_000), cikarilanVeri: { a: 1 } });
    const data = (t.belgeOcrKaydi.create.mock.calls[0] as unknown as [{ data: Record<string, unknown> }])[0].data;
    expect(data).toMatchObject({ tenantId: "t", kullaniciId: "u", belgeTuru: "KARTVIZIT", kanal: "WEB", saglayici: "gemini", model: "g-2", cikarilanVeri: { a: 1 } });
    expect((data.hamMetin as string).length).toBe(20_000);
  });

  it("oluşan masraflar önceki bağa eklenir, kayıt işlendi olur", async () => {
    const t = tx({ masrafIdler: [M1] });
    await ocrSonucuBagla(t as never, "k1", { masrafIdler: [M2] });
    expect(t.belgeOcrKaydi.update).toHaveBeenCalledWith({ where: { id: "k1" }, data: expect.objectContaining({ durum: "ISLENDI", olusanKayitlar: { masrafIdler: [M1, M2] }, islendiAt: expect.any(Date) }) });
  });

  it("firmada bulunmayan masraf bağlanmaz; boş sonuç reddedilir", async () => {
    await expect(ocrSonucuBagla(tx() as never, "k1", { masrafIdler: ["yok"] })).rejects.toThrow(/bulunamadı/);
    expect(ocrSonucSemasi.safeParse({}).success).toBe(false);
    expect(ocrSonucSemasi.safeParse({ cariId: C1 }).success).toBe(true);
  });
});

describe("fiş doğrulaması: döviz ve kırılım (AI-13)", () => {
  const fis = (ek: Record<string, unknown>) => ({
    belgeTuru: "FIS" as const, belgeNo: "1", tarih: "2026-11-01", saticiUnvan: "Market", saticiVknTckn: null, saticiVergiDairesi: null, saticiAdres: null,
    saticiTelefon: null, saticiEposta: null, saticiIban: null, paraBirimi: "TRY", toplamMatrah: 1000, toplamKdv: 170, genelToplam: 1170,
    kdvKirilimi: [{ oran: 10, matrah: 300, kdvTutari: 30 }, { oran: 20, matrah: 700, kdvTutari: 140 }], kalemler: [], guvenSkoru: 0.9, ...ek,
  });

  it("belge dövizi aktarılır; TL/₺ TRY olur, tanınmayan kod uyarıyla TRY'ye düşer", () => {
    expect(fisFaturaDogrula(fis({ paraBirimi: "eur" })).veri.paraBirimi).toBe("EUR");
    expect(fisFaturaDogrula(fis({ paraBirimi: "₺" })).veri.paraBirimi).toBe("TRY");
    const r = fisFaturaDogrula(fis({ paraBirimi: "XYZ" }));
    expect(r.veri.paraBirimi).toBe("TRY");
    expect(r.uyarilar.join(" ")).toMatch(/tanınmadı/);
  });

  it("kırılım matrahı belge matrahını tutmuyorsa uyarır", () => {
    expect(fisFaturaDogrula(fis({})).uyarilar.join(" ")).not.toMatch(/kırılımı/);
    expect(fisFaturaDogrula(fis({ toplamMatrah: 1100, genelToplam: 1270 })).uyarilar.join(" ")).toMatch(/KDV kırılımı matrahı/);
  });
});
