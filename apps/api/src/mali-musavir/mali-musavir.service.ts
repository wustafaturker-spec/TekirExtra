import { Injectable } from "@nestjs/common";
import { PrismaService } from "../core/prisma.service";

@Injectable()
export class MaliMusavirService {
  constructor(private readonly prisma: PrismaService) {}

  async lucaFaturaXmlAktar(tenantId: string, baslangic?: Date | undefined, bitis?: Date | undefined) {
    const faturalar = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.fatura.findMany({
        where: {
          tenantId,
          durum: "kesin",
          ...(baslangic || bitis ? { tarih: { gte: baslangic, lte: bitis } } : {})
        },
        include: { cari: true, satirlar: true }
      })
    );

    let xml = `<?xml version="1.0" encoding="UTF-8"?>\n<LucaAktarim>\n`;
    for (const f of faturalar) {
      xml += `  <Fatura>\n`;
      xml += `    <No>${f.no || ""}</No>\n`;
      xml += `    <Tarih>${f.tarih.toISOString().split("T")[0]}</Tarih>\n`;
      xml += `    <Tip>${f.tip}</Tip>\n`;
      xml += `    <CariUnvan>${f.cari?.unvan || ""}</CariUnvan>\n`;
      xml += `    <VknTckn>${f.cari?.vknTckn || ""}</VknTckn>\n`;
      xml += `    <GenelToplam>${f.genelToplam}</GenelToplam>\n`;
      xml += `    <Kalemler>\n`;
      for (const s of f.satirlar) {
        xml += `      <Kalem>\n`;
        xml += `        <Tutar>${s.toplamTutar}</Tutar>\n`;
        xml += `        <KdvOrani>${s.kdvOrani}</KdvOrani>\n`;
        xml += `      </Kalem>\n`;
      }
      xml += `      </Kalemler>\n`;
      xml += `    </Fatura>\n`;
    }

    xml += `  </Faturalar>\n</LucaAktarim>`;
    return xml;
  }

  async zirveCsvAktar(tenantId: string, baslangic?: Date | undefined, bitis?: Date | undefined) {
    const hareketler = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.kasaBankaHareket.findMany({
        where: {
          tenantId,
          ...(baslangic || bitis ? { tarih: { gte: baslangic, lte: bitis } } : {})
        },
        include: { cari: true },
        orderBy: { tarih: "asc" }
      })
    );

    let csv = "Tarih;Fiş No;İşlem Tipi;Cari Unvan;VKN/TCKN;Tutar;Açıklama\n";
    for (const h of hareketler) {
      csv += `${h.tarih.toISOString().split("T")[0]};${h.id.slice(0, 8)};${h.tip};"${h.cari?.unvan || ""}";${h.cari?.vknTckn || ""};${h.tutar};"${h.aciklama || ""}"\n`;
    }
    return csv;
  }

  async kdvOzetRaporu(tenantId: string, baslangicTarihi: Date, bitisTarihi: Date) {
    const faturalar = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.fatura.findMany({
        where: {
          tenantId,
          tarih: { gte: baslangicTarihi, lte: bitisTarihi },
          durum: "kesin",
        }
      })
    );

    let hesaplananKdv = 0;
    let indirilecekKdv = 0;

    for (const f of faturalar) {
      if (f.tip === "satis") hesaplananKdv += Number(f.toplamKdv);
      else if (f.tip === "alis") indirilecekKdv += Number(f.toplamKdv);
    }

    const netKdv = hesaplananKdv - indirilecekKdv;

    return {
      baslangicTarihi,
      bitisTarihi,
      hesaplananKdv,
      indirilecekKdv,
      odenecekKdv: netKdv > 0 ? netKdv : 0,
      devredenKdv: netKdv < 0 ? Math.abs(netKdv) : 0,
    };
  }
}
