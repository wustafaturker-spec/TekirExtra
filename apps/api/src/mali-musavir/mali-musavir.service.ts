import { Injectable } from "@nestjs/common";
import { XMLBuilder } from "fast-xml-parser";
import { PrismaService } from "../core/prisma.service";
import { kdvBeyanFaturalari, kdvBeyanSatirlari, kdvBeyanToplami } from "../fatura/kdv-beyan";

const xmlBuilder = new XMLBuilder({ format: true, indentBy: "  ", ignoreAttributes: false, suppressEmptyNode: false });

function csvHucre(deger: unknown, guvenilmeyenMetin = false): string {
  let metin = deger === null || deger === undefined ? "" : String(deger);
  // Excel ve benzeri tablo uygulamalarında formül olarak çalıştırılmasını engeller.
  if (guvenilmeyenMetin && /^[\t\r\n ]*[=+\-@]/.test(metin)) metin = `'${metin}`;
  return `"${metin.replace(/"/g, '""')}"`;
}

@Injectable()
export class MaliMusavirService {
  constructor(private readonly prisma: PrismaService) {}

  async lucaFaturaXmlAktar(tenantId: string, baslangic?: Date, bitis?: Date) {
    const faturalar = await this.prisma.tenantIslem(tenantId, (tx) => tx.fatura.findMany({
      where: { tenantId, durum: "kesin", ...(baslangic || bitis ? { tarih: { gte: baslangic, lte: bitis } } : {}) },
      include: { cari: true, satirlar: true }, orderBy: [{ tarih: "asc" }, { no: "asc" }],
    }));
    const faturaKayitlari = faturalar.map((f) => ({
      No: f.no ?? "",
      Tarih: f.tarih.toISOString().slice(0, 10),
      Tip: f.tip,
      CariUnvan: f.cari?.unvan ?? "",
      VknTckn: f.cari?.vknTckn ?? "",
      GenelToplam: String(f.genelToplam),
      Kalemler: { Kalem: f.satirlar.map((s) => ({ Tutar: String(s.toplamTutar), KdvOrani: String(s.kdvOrani) })) },
    }));
    const govde = { LucaAktarim: { "@_formatSurumu": "tekirextra-luca-1", Faturalar: faturaKayitlari.length ? { Fatura: faturaKayitlari } : "" } };
    return `<?xml version="1.0" encoding="UTF-8"?>\n${xmlBuilder.build(govde)}`;
  }

  async zirveCsvAktar(tenantId: string, baslangic?: Date, bitis?: Date) {
    const hareketler = await this.prisma.tenantIslem(tenantId, (tx) => tx.kasaBankaHareket.findMany({
      where: { tenantId, ...(baslangic || bitis ? { tarih: { gte: baslangic, lte: bitis } } : {}) },
      include: { cari: true }, orderBy: [{ tarih: "asc" }, { id: "asc" }],
    }));
    const satirlar = hareketler.map((h) => [
      csvHucre(h.tarih.toISOString().slice(0, 10)), csvHucre(h.id.slice(0, 8)), csvHucre(h.tip),
      csvHucre(h.cari?.unvan ?? "", true), csvHucre(h.cari?.vknTckn ?? "", true),
      csvHucre(h.tutar), csvHucre(h.aciklama ?? "", true),
    ].join(";"));
    return `\uFEFF"Tarih";"Fiş No";"İşlem Tipi";"Cari Unvan";"VKN/TCKN";"Tutar";"Açıklama"\r\n${satirlar.length ? `${satirlar.join("\r\n")}\r\n` : ""}`;
  }

  /**
   * RPR-02: KDV-1 ön analizi; tutarlar fatura kuruyla TL. Beyannamedeki gibi:
   * - Hesaplanan: satışın KDV'si (tevkifatlıda yalnız satıcının payı — kalanı
   *   alıcı KDV-2 ile beyan eder) + alıştan iade faturasında hesapladığımız KDV.
   * - İndirimler: alışın KDV'sinin tamamı (tevkifatlıda kestiğimiz kısım da;
   *   onu KDV-2 ile beyan edip ödediğimiz için indiririz) + satıştan iadede
   *   müşteriye geri verdiğimiz KDV.
   * - İhraç kayıtlı alışın KDV'si ödenmez, indirilmez (EBLG-114); ihraç
   *   kayıtlı satışın KDV'si tahsil edilmez, ödenecek tutara girmez (tecil).
   * Kestiğimiz tevkifat ayrıca KDV-2 ile beyan edilip ödenir.
   */
  async kdvOzetRaporu(tenantId: string, baslangicTarihi: Date, bitisTarihi: Date) {
    const faturalar = await this.prisma.tenantIslem(tenantId, (tx) => kdvBeyanFaturalari(tx, { gte: baslangicTarihi, lte: bitisTarihi }));
    // RPR-13: KDV Dökümü raporuyla aynı hesap (kdv-beyan.ts).
    const satirlar = kdvBeyanSatirlari(faturalar);
    const t = (yon: Parameters<typeof kdvBeyanToplami>[1]) => kdvBeyanToplami(satirlar, yon);
    const satisKdv = t("hesaplanan_satis"), alistanIadeKdv = t("hesaplanan_alis_iade");
    const alisKdv = t("indirilecek_alis"), satistanIadeKdv = t("indirilecek_satis_iade");
    const yuvarla = (n: number) => Math.round(n * 100) / 100;
    const hesaplananKdv = yuvarla(satisKdv + alistanIadeKdv);
    const indirilecekKdv = yuvarla(alisKdv + satistanIadeKdv);
    const netKdv = yuvarla(hesaplananKdv - indirilecekKdv);
    return {
      baslangicTarihi, bitisTarihi,
      satisKdv, alistanIadeKdv, alisKdv, satistanIadeKdv,
      ihracKayitliAlisKdv: t("bilgi_ihrac_kayitli_alis"),
      ihracKayitliSatisKdv: t("bilgi_ihrac_kayitli_satis"),
      aliciTevkifati: t("bilgi_alici_tevkifati"),
      kestigimizTevkifat: t("kdv2_tevkifat"),
      hesaplananKdv, indirilecekKdv,
      odenecekKdv: netKdv > 0 ? netKdv : 0,
      devredenKdv: netKdv < 0 ? -netKdv : 0,
    };
  }

}
