import { Prisma } from "@prisma/client";
import { faturaHesapla } from "@tekirextra/shared";
import { describe, expect, it, vi } from "vitest";
import { hesapGirdisi, maktuBirimleriniBagla, type EkVergi } from "./ek-vergi";

/** EBLG-131: maktu vergi kartın ana birimi başınadır; ek birimli satırda katsayıyla ölçeklenir. */
describe("maktu vergi ve ek birim (EBLG-131)", () => {
  const maktu = (): EkVergi => ({ kod: "0071", ad: "ÖTV I. Liste", hesap: "birim", oran: null, birimTutar: "12.5", matrah: null, tutar: "0", stopaj: false, kdvMatrahinaDahil: true });
  const oranli = (): EkVergi => ({ kod: "0074", ad: "ÖTV IV. Liste", hesap: "oran", oran: "25", birimTutar: null, matrah: null, tutar: "0", stopaj: false, kdvMatrahinaDahil: true });
  const tx = () => ({
    stokKart: { findMany: vi.fn().mockResolvedValue([{ id: "s1", anaBirim: "lt", birimler: [{ ad: "bidon", katsayi: new Prisma.Decimal(20) }] }]) },
  }) as never;

  it("ek birimli satıra katsayı ve ana birim yazılır; ana birimli satırda katsayı yok; oranlı vergiye dokunulmaz", async () => {
    const vergiler = [[maktu(), oranli()], [maktu()]];
    await maktuBirimleriniBagla(tx(), [{ stokId: "s1", birim: "bidon" }, { stokId: "s1", birim: "lt" }], vergiler);
    expect(vergiler[0][0]).toMatchObject({ anaBirim: "lt", katsayi: "20" });
    expect(vergiler[0][1].katsayi).toBeUndefined();
    expect(vergiler[1][0]).toMatchObject({ anaBirim: "lt", katsayi: null });
  });

  it("2 bidon (40 lt) × 12,50 = 500 TL; aynı miktar litreyle girilince de 500 TL", async () => {
    const bidon = [maktu()]; const litre = [maktu()];
    await maktuBirimleriniBagla(tx(), [{ stokId: "s1", birim: "bidon" }, { stokId: "s1", birim: "lt" }], [bidon, litre]);
    const h = faturaHesapla({ satirlar: [
      { stokId: "s1", miktar: 2, birimFiyat: 2000, iskontoOrani: 0, kdvOrani: 20, ekVergiler: bidon.map(hesapGirdisi) },
      { stokId: "s1", miktar: 40, birimFiyat: 100, iskontoOrani: 0, kdvOrani: 20, ekVergiler: litre.map(hesapGirdisi) },
    ] });
    expect(h.satirlar.map((s) => s.ekVergiTutarlari[0])).toEqual([500, 500]);
  });

  it("maktu vergisi olmayan faturada veritabanına gidilmez", async () => {
    const t = tx();
    await maktuBirimleriniBagla(t, [{ stokId: "s1", birim: "bidon" }], [[oranli()]]);
    expect((t as unknown as { stokKart: { findMany: ReturnType<typeof vi.fn> } }).stokKart.findMany).not.toHaveBeenCalled();
  });
});
