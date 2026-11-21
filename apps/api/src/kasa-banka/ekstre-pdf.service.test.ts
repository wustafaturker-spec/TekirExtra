import { beforeAll, describe, expect, it, vi } from "vitest";
import { EkstreService } from "./ekstre.service";
import { pdfjsIsit, pdfUret, sagaYasla, type Yazi } from "./ekstre-pdf.test-veri";

// PDF ayrıştırma tam test koşusunda yük altında 5 sn varsayılanını aşabiliyor.
vi.setConfig({ testTimeout: 20_000 });
// pdf.js'in ilk yüklenmesi testlere değil hazırlığa yazılır (tam koşuda 40 sn'yi bulabiliyor).
beforeAll(pdfjsIsit, 120_000);

vi.mock("../core/istek-baglami", () => ({ aktifBaglam: () => ({ tenantId: "t1", userId: "u1", rol: "muhasebe" }) }));

const H = "11111111-1111-4111-8111-111111111111";
const IBAN = "TR790006200006200006691698";

function ekstre(iban = "TR79 0006 2000 0620 0006 6916 98"): Buffer {
  const y: Yazi[] = [
    { x: 30, y: 60, metin: "IBAN" }, { x: 109, y: 60, metin: `: ${iban}` },
    { x: 31, y: 120, metin: "Tarih" }, { x: 88, y: 120, metin: "Aciklama" }, { x: 460, y: 120, metin: "Tutar" }, { x: 541, y: 120, metin: "Bakiye" },
  ];
  ([["27.09.2026", "QR ILE P.CEKME", "-2.000,00 TL", "6,42 TL"], ["26.09.2026", "AHMET YILMAZ-FAST", "+2.000,00 TL", "2.006,42 TL"], ["25.09.2026", "KAYIT HATASI", "+10,00 TL", "999,00 TL"]] as const)
    .forEach(([tarih, aciklama, tutar, bakiye], i) => {
      const sy = 136 + i * 14;
      y.push({ x: 31, y: sy, metin: tarih }, { x: 88, y: sy, metin: aciklama }, { x: sagaYasla(tutar, 479), y: sy, metin: tutar }, { x: sagaYasla(bakiye, 564), y: sy, metin: bakiye });
    });
  return pdfUret([y]);
}

function kur(hesap: Record<string, unknown> = {}, mevcutSatir = 0) {
  const tx = {
    bankaHesap: {
      findUnique: vi.fn(async () => ({ id: H, ad: "Garanti TL", iban: IBAN, dovizCinsi: "TRY", ekstreEslemesi: null, ekstrePdfEslemesi: null, ...hesap })),
      update: vi.fn(async () => ({})),
    },
    bankaEkstreSatir: { count: vi.fn(async () => mevcutSatir), findMany: vi.fn(async () => []), create: vi.fn(async () => ({})) },
    bankaEkstre: { create: vi.fn(async () => ({ id: "e1" })) },
  };
  const prisma = { tenantIslem: vi.fn(async (_t: string, fn: (t: typeof tx) => unknown) => fn(tx)) };
  return { service: new EkstreService(prisma as never), tx };
}

describe("KSB-34 PDF ekstre yükleme", () => {
  it("önizleme tahmini eşlemeyi, bakiye sağlamasını ve tarih çakışmasını döner", async () => {
    const { service } = kur({}, 4);
    const sonuc = await service.onizle(H, ekstre());
    expect(sonuc).toMatchObject({
      basliklar: ["Tarih", "Aciklama", "Tutar", "Bakiye"],
      esleme: { tarih: 0, aciklama: 1, tutar: 2, bakiye: 3 },
      eslemeKayitli: false,
      pdf: {
        sayfaSayisi: 1,
        bakiyeSaglamasi: { denetlenen: 2, tutarsizSayisi: 1, tutarsizlar: [{ tarih: "2026-09-25", bakiye: "999.00" }] },
        cakisma: { mevcutSatir: 4, ilkTarih: "2026-09-25", sonTarih: "2026-09-27" },
      },
    });
  });

  it("hesap bilgisindeki IBAN seçilen hesabınkinden farklıysa yükleme reddedilir", async () => {
    const { service } = kur();
    await expect(service.onizle(H, ekstre("TR73 0020 5000 0030 0123 9000 12"))).rejects.toThrow("TR730020500000300123900012 hesabına ait");
  });

  it("PDF eşlemesi CSV eşlemesinden ayrı saklanır ve başlıklar aynıysa yeniden sorulmaz", async () => {
    const { service, tx } = kur();
    const esleme = { baslikSatiri: 0, tarih: 0, aciklama: 1, tutar: 2, bakiye: 3 };
    const sonuc = await service.yukle(H, ekstre(), "ekstre.pdf", esleme, true);
    expect(sonuc).toMatchObject({ okunanSatir: 3, yeniSatir: 3, bicim: "pdf", pdf: { bakiyeSaglamasi: { tutarsizSayisi: 1 } } });
    expect(tx.bankaHesap.update).toHaveBeenCalledWith({ where: { id: H }, data: { ekstrePdfEslemesi: { esleme, basliklar: ["Tarih", "Aciklama", "Tutar", "Bakiye"] } } });

    const kayitli = kur({ ekstrePdfEslemesi: { esleme: { ...esleme, bakiye: null }, basliklar: ["Tarih", "Aciklama", "Tutar", "Bakiye"] } });
    expect(await kayitli.service.onizle(H, ekstre())).toMatchObject({ eslemeKayitli: true, esleme: { bakiye: null } });
    const degisti = kur({ ekstrePdfEslemesi: { esleme, basliklar: ["Tarih", "Aciklama", "Tutar"] } });
    expect(await degisti.service.onizle(H, ekstre())).toMatchObject({ eslemeKayitli: false });
  });
});
