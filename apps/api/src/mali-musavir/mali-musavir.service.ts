import { Injectable } from "@nestjs/common";
import { XMLBuilder } from "fast-xml-parser";
import { PrismaService } from "../core/prisma.service";

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
    const faturalar = await this.prisma.tenantIslem(tenantId, (tx) => tx.fatura.findMany({
      where: { tenantId, tarih: { gte: baslangicTarihi, lte: bitisTarihi }, durum: "kesin", tip: { in: ["satis", "alis", "satis_iade", "alis_iade"] } },
      select: { tip: true, toplamKdv: true, toplamNetKdv: true, toplamTevkifat: true, kur: true, ihracKayitliKodu: true },
    }));
    const t = { satisKdv: 0, alistanIadeKdv: 0, alisKdv: 0, satistanIadeKdv: 0, ihracKayitliAlisKdv: 0, ihracKayitliSatisKdv: 0, aliciTevkifati: 0, kestigimizTevkifat: 0 };
    for (const f of faturalar) {
      const tl = (deger: unknown) => Number(deger ?? 0) * Number(f.kur ?? 1);
      if (f.tip === "satis") {
        if (f.ihracKayitliKodu) t.ihracKayitliSatisKdv += tl(f.toplamKdv);
        t.satisKdv += tl(f.toplamNetKdv);
        t.aliciTevkifati += tl(f.toplamTevkifat);
      } else if (f.tip === "alis_iade") {
        t.alistanIadeKdv += tl(f.toplamNetKdv);
      } else if (f.tip === "satis_iade") {
        t.satistanIadeKdv += tl(f.toplamNetKdv);
      } else if (f.ihracKayitliKodu) {
        t.ihracKayitliAlisKdv += tl(f.toplamKdv);
      } else {
        t.alisKdv += tl(f.toplamNetKdv) + tl(f.toplamTevkifat);
        t.kestigimizTevkifat += tl(f.toplamTevkifat);
      }
    }
    const yuvarla = (n: number) => Math.round(n * 100) / 100;
    const hesaplananKdv = yuvarla(t.satisKdv + t.alistanIadeKdv);
    const indirilecekKdv = yuvarla(t.alisKdv + t.satistanIadeKdv);
    const netKdv = yuvarla(hesaplananKdv - indirilecekKdv);
    return {
      baslangicTarihi, bitisTarihi,
      ...(Object.fromEntries(Object.entries(t).map(([k, v]) => [k, yuvarla(v)])) as typeof t),
      hesaplananKdv, indirilecekKdv,
      odenecekKdv: netKdv > 0 ? netKdv : 0,
      devredenKdv: netKdv < 0 ? -netKdv : 0,
    };
  }
}
