import { describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { istekBaglami } from "../core/istek-baglami";
import { RaporService } from "./rapor.service";

const D = (v: number) => new Prisma.Decimal(v);
const GUN = 86_400_000;
const bugun = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()));
const gunOnce = (n: number) => new Date(bugun.getTime() - n * GUN);
const fatura = (id: string, tip: string, tarihGunOnce: number, vadeGunOnce: number | null, toplam: number) => ({
  id, no: id, tip, durum: "kesin", tarih: gunOnce(tarihGunOnce), vadeTarihi: vadeGunOnce === null ? null : gunOnce(vadeGunOnce),
  genelToplam: D(toplam), kur: D(1), cari: { id: `c-${id}`, unvan: id }, kapamalar: [], iadeKapamalari: [],
});

describe("vadesi geçenler (RPR-17) — vadesiz fatura", () => {
  it("vadesiz fatura fatura tarihinde vadesi gelmiş sayılır; liste hesaplanan vadeye göre en eskiden", async () => {
    const findMany = vi.fn().mockResolvedValue([fatura("vadeli", "satis", 30, 5, 100), fatura("vadesiz", "satis", 20, null, 300), fatura("alis", "alis", 10, null, 50)]);
    const s = new RaporService({ tenantIslem: (_t: string, fn: (tx: unknown) => unknown) => fn({ fatura: { findMany } }) } as never);
    const r = await istekBaglami.run({ deger: { tenantId: "t", userId: "u", rol: "muhasebe" } }, () => s.vadesiGecenler());
    expect(findMany.mock.calls[0][0].where.OR).toEqual([{ vadeTarihi: { lt: bugun } }, { vadeTarihi: null, tarih: { lt: bugun } }]);
    expect(r.alacaklar.map((x) => [x.faturaId, x.gecikmeGun])).toEqual([["vadesiz", 20], ["vadeli", 5]]);
    expect(r).toMatchObject({ toplamAlacak: "400.00", alacakSayisi: 2, toplamBorc: "50.00", borcSayisi: 1 });
    expect(r.borclar[0]).toMatchObject({ faturaId: "alis", vadeTarihi: gunOnce(10).toISOString().slice(0, 10) });
  });
});
