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

  async kdvOzetRaporu(tenantId: string, baslangicTarihi: Date, bitisTarihi: Date) {
    const faturalar = await this.prisma.tenantIslem(tenantId, (tx) => tx.fatura.findMany({ where: { tenantId, tarih: { gte: baslangicTarihi, lte: bitisTarihi }, durum: "kesin" } }));
    let hesaplananKdv = 0, indirilecekKdv = 0, ihracKayitliAlisKdv = 0;
    for (const f of faturalar) {
      if (f.tip === "satis") hesaplananKdv += Number(f.toplamKdv);
      // EBLG-114: ihraç kayıtlı alışta KDV satıcıya ödenmez, indirilemez.
      else if (f.tip === "alis" && f.ihracKayitliKodu) ihracKayitliAlisKdv += Number(f.toplamKdv);
      else if (f.tip === "alis") indirilecekKdv += Number(f.toplamKdv);
    }
    const netKdv = hesaplananKdv - indirilecekKdv;
    return { baslangicTarihi, bitisTarihi, hesaplananKdv, indirilecekKdv, ihracKayitliAlisKdv, odenecekKdv: netKdv > 0 ? netKdv : 0, devredenKdv: netKdv < 0 ? Math.abs(netKdv) : 0 };
  }
}
