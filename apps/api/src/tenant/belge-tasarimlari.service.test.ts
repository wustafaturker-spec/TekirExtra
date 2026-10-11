import { BadRequestException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { istekBaglami } from "../core/istek-baglami";
import { coz, sifrele } from "../core/kripto";
import { BelgeTasarimlariService, tasarimYukleSemasi, xsltDenetle } from "./belge-tasarimlari.service";

process.env.BAGLANTI_SIFRELEME_ANAHTARI ??= "0".repeat(64);

const baglamda = <T>(fn: () => Promise<T>) => istekBaglami.run({ deger: { tenantId: "tenant-1", userId: "user-1", rol: "yonetici" } }, fn);

const XSLT = `<?xml version="1.0" encoding="UTF-8"?>
<!-- firma tasarımı -->
<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform"><xsl:template match="/"><html/></xsl:template></xsl:stylesheet>`;

function kurulum(config: Record<string, unknown> = {}, ornek: { xml: string; no: string } | null = null) {
  const adapter = {
    tasarimlariListele: vi.fn().mockResolvedValue([{ id: "t-1", baslik: "EMSA_EFATURA", varsayilan: true }, { id: "t-2", baslik: "TEKIR_EFATURA", varsayilan: false }]),
    tasarimYukle: vi.fn().mockResolvedValue({ id: "t-3", baslik: "Yeni", varsayilan: false }),
    tasarimOnizle: vi.fn().mockResolvedValue({ basarili: true, html: "<html/>" }),
  };
  const update = vi.fn();
  // Son yazılan ayar okunur (seçimden sonra imza yazımı güncel ayarın üstüne yapılmalı).
  const ilkAyar = sifrele(JSON.stringify({ saglayici: "nes", apiAnahtari: "a", ...config }));
  const tx = {
    baglanti: {
      findUnique: vi.fn(async () => ({ id: "b1", tenantId: "tenant-1", aile: "ebelge", saglayici: "nes", durum: "aktif", sifreliConfig: update.mock.calls.at(-1)?.[0].data.sifreliConfig ?? ilkAyar })),
      update,
    },
    tenant: { findUnique: vi.fn().mockResolvedValue({ unvan: "Tekir A.Ş.", vkn: "1234567801", eposta: null, telefon: null, webSitesi: null, belgeMarkaAdi: null, belgeMarkaAlt: null, belgeEkBilgi: null, belgeRozetleri: [] }) },
    bankaHesap: { findMany: vi.fn().mockResolvedValue([]) },
    ebelgeArsiv: { findFirst: vi.fn().mockResolvedValue(ornek ? { xmlIcerik: ornek.xml, ebelge: { fatura: { no: ornek.no } } } : null) },
    eirsaliyeKayit: { findFirst: vi.fn().mockResolvedValue(null) },
  };
  const prisma = { tenantIslem: (_t: string, fn: (t: typeof tx) => unknown) => fn(tx) };
  const servis = new BelgeTasarimlariService(prisma as never, { adapterCoz: () => adapter } as never, { firmaLogoDataUri: async () => null } as never);
  const saklanan = () => JSON.parse(coz(update.mock.calls[0][0].data.sifreliConfig)) as Record<string, unknown>;
  return { servis, adapter, update, saklanan };
}

describe("BelgeTasarimlariService (EBLG-99)", () => {
  it("listeyi entegratörden, seçimi bağlantıdan okur", async () => {
    const { servis } = kurulum({ efaturaTasarimi: "TEKIR_EFATURA" });
    const sonuc = await baglamda(() => servis.listele("b1", "efatura"));
    expect(sonuc).toMatchObject({ destekleniyor: true, secili: "TEKIR_EFATURA" });
    expect(sonuc.tasarimlar).toHaveLength(2);
  });

  it("seçili firma tasarımı eski vergi listesiyle üretildiyse uyarır (EBLG-133)", async () => {
    const eski = kurulum({ efaturaTasarimi: "TX1234567801-EFATURA-v9", tasarimVergiImzalari: { "TX1234567801-EFATURA-v9": "stopaj=0003;dahil=" } });
    expect((await baglamda(() => eski.servis.listele("b1", "efatura"))).vergiKodlariEski).toBe(true);
    // İmzasız firma tasarımı ilk dolum listesiyle üretilmiş sayılır; Mevzuat'sız ortamda liste odur.
    const imzasiz = kurulum({ efaturaTasarimi: "TX1234567801-EFATURA-v9" });
    expect((await baglamda(() => imzasiz.servis.listele("b1", "efatura"))).vergiKodlariEski).toBe(false);
    // Elle yüklenen tasarım ve e-İrsaliye denetlenmez.
    const elle = kurulum({ efaturaTasarimi: "TEKIR_EFATURA", tasarimVergiImzalari: { TEKIR_EFATURA: "x" } });
    expect((await baglamda(() => elle.servis.listele("b1", "efatura"))).vergiKodlariEski).toBe(false);
  });

  it("firma tasarımını o günkü vergi listesiyle üretir, seçer ve imzasını yazar (EBLG-133)", async () => {
    const { servis, adapter, update } = kurulum();
    const yuklenen: { baslik: string; xslt: string }[] = [];
    adapter.tasarimYukle.mockImplementation(async (_cfg: unknown, _tur: unknown, t: { baslik: string; xslt: string }) => { yuklenen.push(t); return { id: "t-9", baslik: t.baslik, varsayilan: false }; });
    adapter.tasarimlariListele.mockImplementation(async () => yuklenen.map((t, i) => ({ id: `y${i}`, baslik: t.baslik, varsayilan: false })));

    await baglamda(() => servis.firmaTasarimiOlustur("b1", "efatura"));

    expect(yuklenen[0].baslik).toBe("TX1234567801-EFATURA-v1");
    expect(yuklenen[0].xslt).toContain("contains(' 0003 0011 ',");
    expect(yuklenen[0].xslt).not.toContain("@@");
    const son = JSON.parse(coz(update.mock.calls.at(-1)![0].data.sifreliConfig));
    expect(son.efaturaTasarimi).toBe("TX1234567801-EFATURA-v1");
    expect(son.tasarimVergiImzalari).toEqual({ "TX1234567801-EFATURA-v1": "stopaj=0003,0011;dahil=0061,0071,0073,0074,8005,9077" });
    expect((await baglamda(() => servis.listele("b1", "efatura"))).vergiKodlariEski).toBe(false);
  });

  it("seçimi bağlantıyı pasife çekmeden yazar; boş seçim entegratörün varsayılanına döner", async () => {
    const { servis, update, saklanan } = kurulum({ earsivTasarimi: "ESKI" });
    const sonuc = await baglamda(() => servis.sec("b1", { efatura: "TEKIR_EFATURA", earsiv: "" }));
    expect(sonuc).toEqual({ efatura: "TEKIR_EFATURA", earsiv: null, eirsaliye: null });
    expect(update.mock.calls[0][0].data.durum).toBeUndefined();
    expect(saklanan()).toMatchObject({ apiAnahtari: "a", efaturaTasarimi: "TEKIR_EFATURA" });
    expect(saklanan().earsivTasarimi).toBeUndefined();
  });

  it("entegratörde olmayan tasarım seçilemez", async () => {
    const { servis, update } = kurulum();
    await expect(baglamda(() => servis.sec("b1", { efatura: "YOK" }))).rejects.toThrow(/bulunamadı/);
    expect(update).not.toHaveBeenCalled();
  });

  it("aynı adda tasarım varsa ikincisini yüklemez", async () => {
    const { servis, adapter } = kurulum();
    await expect(baglamda(() => servis.yukle("b1", { tur: "efatura", baslik: "tekir_efatura", xslt: XSLT }))).rejects.toThrow(/zaten var/);
    expect(adapter.tasarimYukle).not.toHaveBeenCalled();
  });

  it("geçerli XSLT'yi yükler", async () => {
    const { servis, adapter } = kurulum();
    await baglamda(() => servis.yukle("b1", { tur: "efatura", baslik: "Yeni", xslt: XSLT }));
    expect(adapter.tasarimYukle).toHaveBeenCalledWith(expect.anything(), "efatura", { baslik: "Yeni", xslt: XSLT });
  });

  it("önizlemeyi firmanın son gönderdiği belgeyle yapar; belge yoksa sebebini söyler", async () => {
    const { servis, adapter } = kurulum({}, { xml: "<Invoice>son</Invoice>", no: "K072026000000098" });
    expect(await baglamda(() => servis.onizle("b1", { tur: "efatura", tasarimId: "11111111-1111-4111-8111-111111111111" }))).toEqual({ html: "<html/>", belgeNo: "K072026000000098" });
    expect(adapter.tasarimOnizle).toHaveBeenCalledWith(expect.anything(), "efatura", "11111111-1111-4111-8111-111111111111", "<Invoice>son</Invoice>");

    const bos = kurulum();
    await expect(baglamda(() => bos.servis.onizle("b1", { tur: "eirsaliye", tasarimId: "11111111-1111-4111-8111-111111111111" }))).rejects.toThrow(BadRequestException);
  });

  it("XSLT olmayan ya da bozuk dosyayı reddeder", () => {
    expect(xsltDenetle(XSLT)).toBeNull();
    expect(xsltDenetle("<html><body></html>")).toMatch(/geçerli bir XML değil/);
    expect(xsltDenetle("<Invoice xmlns='urn:x'/>")).toMatch(/XSLT değil/);
  });

  it("tasarım adını 3–30 karakterle sınırlar (NES sınırı)", () => {
    expect(tasarimYukleSemasi.safeParse({ tur: "efatura", baslik: "ab", xslt: XSLT }).success).toBe(false);
    expect(tasarimYukleSemasi.safeParse({ tur: "efatura", baslik: "Firma e-Fatura", xslt: XSLT }).success).toBe(true);
    expect(tasarimYukleSemasi.safeParse({ tur: "efatura", baslik: "x".repeat(31), xslt: XSLT }).success).toBe(false);
  });
});
