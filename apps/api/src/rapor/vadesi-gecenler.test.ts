import { describe, expect, it, vi } from "vitest";
import { bugunTR } from "@tekirextra/shared";
import { Prisma } from "@prisma/client";
import { istekBaglami } from "../core/istek-baglami";
import { vadeDonemAraligi } from "./vade-donemi";
import { RaporService, vadesiGecenleriHesapla } from "./rapor.service";

const D = (v: number) => new Prisma.Decimal(v);
const GUN = 86_400_000;
const bugun = new Date(`${bugunTR()}T00:00:00Z`);
const gunOnce = (n: number) => new Date(bugun.getTime() - n * GUN);
const fatura = (id: string, tip: string, tarihGunOnce: number, vadeGunOnce: number | null, toplam: number) => ({
  id, no: id, tip, durum: "kesin", tarih: gunOnce(tarihGunOnce), vadeTarihi: vadeGunOnce === null ? null : gunOnce(vadeGunOnce),
  genelToplam: D(toplam), kur: D(1), cari: { id: `c-${id}`, unvan: id }, kapamalar: [], iadeKapamalari: [],
});

describe("vadesi geçenler (RPR-17) — vadesiz fatura", () => {
  it("vadesiz fatura fatura tarihinde vadesi gelmiş sayılır; liste hesaplanan vadeye göre en eskiden", async () => {
    const findMany = vi.fn().mockResolvedValue([fatura("vadeli", "satis", 30, 5, 100), fatura("vadesiz", "satis", 20, null, 300), fatura("alis", "alis", 10, null, 50)]);
    const s = new RaporService({ tenantIslem: (_t: string, fn: (tx: unknown) => unknown) => fn({ fatura: { findMany }, kasaBankaHareket: { findMany: async () => [] }, cariHareket: { findMany: async () => [] } }) } as never);
    const r = await istekBaglami.run({ deger: { tenantId: "t", userId: "u", rol: "muhasebe" } }, () => s.vadesiGecenler());
    expect(findMany.mock.calls[0][0].where.OR).toEqual([{ vadeTarihi: { lt: bugun } }, { vadeTarihi: null, tarih: { lt: bugun } }]);
    expect(r.alacaklar.map((x) => [x.faturaId, x.gecikmeGun])).toEqual([["vadesiz", 20], ["vadeli", 5]]);
    expect(r).toMatchObject({ toplamAlacak: "400.00", alacakSayisi: 2, toplamBorc: "50.00", borcSayisi: 1 });
    expect(r.borclar[0]).toMatchObject({ faturaId: "alis", vadeTarihi: gunOnce(10).toISOString().slice(0, 10) });
  });
});

describe("vade dönemi", () => {
  it("Türkiye takviminde haftanın ve ayın tamamını kapsar", () => {
    const an = new Date("2026-12-31T21:01:00Z");
    expect(vadeDonemAraligi("bu_hafta", an)).toMatchObject({ baslangic: "2026-12-28", bitis: "2027-01-03" });
    expect(vadeDonemAraligi("bu_ay", an)).toMatchObject({ baslangic: "2027-01-01", bitis: "2027-01-31" });
  });

  it("kalanı kapama ve iadelerden sonra fatura kuruyla TL’ye çevirir", async () => {
    const { aralik, bugunBaslangic } = vadeDonemAraligi("bu_hafta", new Date("2026-11-19T12:00:00Z"));
    const findMany = vi.fn().mockResolvedValue([
      { ...fatura("kismi", "satis", 10, 1, 100), kur: D(2.5), vadeTarihi: new Date("2026-11-21"), kapamalar: [{ tutar: D(25) }], iadeKapamalari: [{ tutar: D(10) }] },
      { ...fatura("kapali", "satis", 10, 1, 100), vadeTarihi: new Date("2026-11-20"), kapamalar: [{ tutar: D(100) }] },
      { ...fatura("vadesiz", "alis", 10, null, 12.34), tarih: new Date("2026-11-22") },
    ]);
    const tx = { fatura: { findMany }, kasaBankaHareket: { findMany: async () => [] }, cariHareket: { findMany: async () => [] } };
    const sonuc = await vadesiGecenleriHesapla(tx as never, "t", { aralik, bugunBaslangic });
    const sinir = { gte: new Date("2026-11-16"), lt: new Date("2026-11-23") };
    expect(findMany.mock.calls[0][0].where.OR).toEqual([{ vadeTarihi: sinir }, { vadeTarihi: null, tarih: sinir }]);
    expect(sonuc).toMatchObject({ toplamAlacak: "162.50", alacakSayisi: 1, toplamBorc: "12.34", borcSayisi: 1 });
    expect(sonuc.alacaklar[0]).toMatchObject({ faturaId: "kismi", gecikmeGun: 0, vadeTarihi: "2026-11-21" });
  });
});
