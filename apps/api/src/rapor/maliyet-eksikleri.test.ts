import "reflect-metadata";
import { Prisma } from "@prisma/client";
import { Reflector } from "@nestjs/core";
import { describe, expect, it, vi } from "vitest";
import { maliyetEksigiListesi, maliyetEksigiSorgusu, maliyetEksikleriniOku } from "./maliyet-eksikleri";
import { karZararHesapla } from "./kar-zarar";
import { RaporController } from "./rapor.controller";
import { RollerGuard } from "../auth/roller.guard";
import { baglamlaCalistir } from "../core/istek-baglami";
import type { SatisSatiri } from "../stok/satis-ozeti";

const D = (v: string | number) => new Prisma.Decimal(v);
const sorgu = { baslangic: "2026-10-01", bitis: "2026-10-15" };
const satir = (ek: Partial<SatisSatiri> = {}): SatisSatiri => ({
  faturaSatirId: "s1", faturaId: "f1", faturaNo: "F1", tarih: new Date("2026-10-01"),
  cariId: "c1", cariKod: "C1", cariUnvan: "Cari", tip: "satis", stokId: "u1", kod: "U1", ad: "Ürün",
  mevcutMiktar: D(-1), stokTip: "urun", miktar: D(1), ciro: D("0.10"), maliyet: D(0), hareketPaylari: [], ...ek,
});

describe("satış maliyet kontrolü", () => {
  it.each([
    { baslangic: "2026-02-30" }, { bitis: "2026-10-00" }, { baslangic: "2026-10-16" },
    { baslangic: "2025-01-01" }, { sayfa: "0" }, { sayfaBoyutu: "101" }, { stokId: "başka" },
    { neden: "tahmini_neden" }, { sayfa: ["1", "2"] },
  ])("geçersiz dönem/filtre kabul edilmez: %j", (ek) => {
    expect(() => maliyetEksigiSorgusu({ ...sorgu, ...ek })).toThrow();
  });
  it("artık günü ve 366 günlük dönemi kabul eder", () => {
    expect(maliyetEksigiSorgusu({ baslangic: "2024-02-29", bitis: "2025-02-28" }).sayfa).toBe(1);
  });
  it("hizmet, iade, maliyetli ve sıfır/eksi cirolu satırları uyarıdan ayırır", () => {
    const kaynak = [satir(), satir({ ciro: D("0.20"), hareketPaylari: [{ hareketId: "h", oran: D(1) }] }),
      satir({ stokTip: "hizmet" }), satir({ tip: "satis_iade" }), satir({ maliyet: D(1) }), satir({ ciro: D(0) }), satir({ ciro: D(-1) })];
    const r = maliyetEksigiListesi(kaynak, maliyetEksigiSorgusu({ ...sorgu, sayfaBoyutu: 1, sayfa: 2 }));
    expect(r.donemOzeti).toEqual({ satir: 2, ciro: "0.30" });
    expect(r.donemOzeti.satir).toBe(karZararHesapla([], kaynak).maliyetsizSatis.satir);
    expect(Number(r.donemOzeti.ciro)).toBe(karZararHesapla([], kaynak).maliyetsizSatis.ciro);
    expect(r.satirlar).toHaveLength(1);
    expect(r.satirlar[0]).toMatchObject({ neden: "sifir_maliyet", guncelStokEksi: true });
    const filtre = maliyetEksigiListesi(kaynak, maliyetEksigiSorgusu({ ...sorgu, neden: "hareket_yok" }));
    expect(filtre.donemOzeti).toEqual(r.donemOzeti);
    expect(filtre.filtreOzeti).toEqual({ satir: 1, ciro: "0.10" });
    expect(filtre.satirlar[0].neden).toBe("hareket_yok");
  });
  it("yük sınırında tam veri yerine yanıltıcı kısmi rapor döndürmez", async () => {
    const count = vi.fn().mockResolvedValue(20001), findMany = vi.fn();
    for (const kapsam of ["sayfa", "tum"] as const) {
      await expect(maliyetEksikleriniOku({ faturaSatir: { count }, fatura: { findMany } } as never, "t1", maliyetEksigiSorgusu(sorgu), kapsam)).rejects.toThrow("Tarih aralığını daraltın");
    }
    expect(findMany).not.toHaveBeenCalled();
  });
  it.each(["satis", "depo", "uretim_planlama", "b2b_bayi", "calisan"])("%s doğrudan endpoint'e erişemez", async (rol) => {
    const guard = new RollerGuard(new Reflector());
    for (const handler of [RaporController.prototype.maliyetEksikleri, RaporController.prototype.maliyetEksikleriExcel]) {
      const context = { getHandler: () => handler, getClass: () => RaporController,
        switchToHttp: () => ({ getRequest: () => ({ path: "/rapor/maliyet-eksikleri" }) }) };
      await expect(baglamlaCalistir({ tenantId: "t", userId: "u", rol: rol as never }, async () => guard.canActivate(context as never))).rejects.toThrow("yetkiniz yok");
    }
  });
  it.each(["yonetici", "muhasebe", "salt_okunur", "mali_musavir", "maliyet_muhasebesi"])("%s listeyi okuyabilir", async (rol) => {
    const guard = new RollerGuard(new Reflector());
    for (const handler of [RaporController.prototype.maliyetEksikleri, RaporController.prototype.maliyetEksikleriExcel]) {
      expect(await baglamlaCalistir({ tenantId: "t", userId: "u", rol: rol as never }, async () => guard.canActivate({
        getHandler: () => handler, getClass: () => RaporController,
      } as never))).toBe(true);
    }
  });
});
