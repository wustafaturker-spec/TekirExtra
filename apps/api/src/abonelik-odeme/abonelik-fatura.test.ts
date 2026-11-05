import { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { AbonelikFaturaService, abonelikAciklamasi, abonelikKdvOrani, abonelikMatrahi, type FaturasizOdeme } from "./abonelik-fatura.service";
import { odemeFiyatFotografi } from "./odeme-fiyat-fotografi";
import { abonelikTutari } from "./abonelik-tutari";

describe("abonelik faturası kalemi (PLT-21)", () => {
  it("sağlayıcı ödemesinde kayıtlı matrah, elle ödemede toplamdan geri hesaplanan matrah kullanılır", () => {
    expect(abonelikMatrahi({ tutar: new Prisma.Decimal("478.80"), matrah: new Prisma.Decimal("399.00") }).toFixed(2)).toBe("399.00");
    expect(abonelikMatrahi({ tutar: new Prisma.Decimal("478.80"), matrah: null }).toFixed(2)).toBe("399.00");
    expect(abonelikMatrahi({ tutar: new Prisma.Decimal("1000"), matrah: null }).toFixed(2)).toBe("833.33");
  });

  it("açıklama plan, süre, dönem aralığı ve ödeme yolunu taşır; dönem eski dönem sonundan başlar", () => {
    const ortak = { plan_kodu: "v1", ay_sayisi: 3, yeni_donem_sonu: new Date("2027-02-28T21:00:00Z"), odeme_at: new Date("2026-10-29T10:00:00Z") };
    expect(abonelikAciklamasi({ ...ortak, onceki_donem_sonu: new Date("2026-11-30T21:00:00Z"), kaynak: "saglayici", saglayici: "paytr" }))
      .toBe("TekirExtra Profesyonel abonelik, 3 ay (01.12.2026–01.03.2027); ödeme 29.10.2026, kartla (PayTR)");
    expect(abonelikAciklamasi({ ...ortak, onceki_donem_sonu: null, kaynak: "elle", saglayici: null }))
      .toBe("TekirExtra Profesyonel abonelik, 3 ay (29.10.2026–01.03.2027); ödeme 29.10.2026, havale/elle");
  });
});

describe("faturada ödeme koşullarının korunması", () => {
  const fiyat = () => ({ ...odemeFiyatFotografi(abonelikTutari("baslangic", 1)!), planAdi: "Ödeme anındaki paket", kdvOrani: "10", kdv: "39.90", toplam: "438.90" });
  const o = { odeme_id: "o1", tenant_id: "odeyen", plan_kodu: "kurumsal", ay_sayisi: 1, odeme_at: new Date("2026-11-03T10:00:00Z"), onceki_donem_sonu: null, yeni_donem_sonu: new Date("2026-12-03T10:00:00Z"), kaynak: "saglayici", saglayici: "iyzico", tutar: new Prisma.Decimal("438.90"), matrah: new Prisma.Decimal("399.00"), kdv: new Prisma.Decimal("39.90") } as FaturasizOdeme;
  it("güncel paket adı ve vergi yerine ödeme fotoğrafını kullanır", () => {
    const g = { ...o, fiyat_fotografi: fiyat() };
    expect(abonelikAciklamasi(g)).toContain("Ödeme anındaki paket");
    expect(abonelikAciklamasi(g)).not.toContain("Kurumsal");
    expect(abonelikMatrahi(g).toFixed(2)).toBe("399.00");
    expect(abonelikKdvOrani(g)).toBe("10");
    expect(abonelikKdvOrani({})).toBe("20");
  });
  function kur(bozuk = false) {
    const tx = { abonelikOdemesi: { findUniqueOrThrow: vi.fn(async () => ({ aySayisi: 1, tutar: o.tutar, matrah: o.matrah, kdv: o.kdv, fiyatFotografi: bozuk ? { ...fiyat(), toplam: "1.00" } : fiyat() })) } };
    const bag = { findUnique: vi.fn(async () => null), upsert: vi.fn(), update: vi.fn() };
    const prisma = { tenantIslem: vi.fn(async (_id, fn) => fn(tx)), abonelikFaturasi: bag };
    const fatura = { olustur: vi.fn(async () => ({ id: "f1" })) };
    const s = new AbonelikFaturaService(prisma as never, {} as never, fatura as never, {} as never, {} as never, {} as never, {} as never, {} as never);
    vi.spyOn(s as never, "aktor").mockResolvedValue("k1" as never);
    vi.spyOn(s as never, "cariBul").mockResolvedValue("00000000-0000-4000-8000-000000000001" as never);
    vi.spyOn(s as never, "hizmetKarti").mockResolvedValue("00000000-0000-4000-8000-000000000002" as never);
    return { s, prisma, fatura, bag };
  }
  it("worker ödeme satırını ödeyen kiracı bağlamında okuyup faturaya aynı adı ve oranı yazar", async () => {
    const { s, prisma, fatura, bag } = kur();
    expect(await s.faturala(o, "faturalayan")).toBe(true);
    expect(prisma.tenantIslem).toHaveBeenCalledWith("odeyen", expect.any(Function));
    expect(fatura.olustur).toHaveBeenCalledWith(expect.objectContaining({ aciklama: expect.stringContaining("Ödeme anındaki paket"), satirlar: [expect.objectContaining({ birimFiyat: "399.00", kdvOrani: "10" })] }));
    expect(bag.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ durum: "taslak" }) }));
  });
  it("bozuk fotoğrafta fatura açmaz; hata kaydı yeniden denemeye bırakılır", async () => {
    const { s, fatura, bag } = kur(true);
    await expect(s.faturala(o, "faturalayan")).rejects.toThrow("fotoğraf");
    expect(fatura.olustur).not.toHaveBeenCalled();
    expect(bag.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ durum: "hata" }) }));
  });
});
