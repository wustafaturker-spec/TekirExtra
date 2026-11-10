import { Injectable, Logger } from "@nestjs/common";
import { DepoService } from "../ekler/depo.service";
import { gelenXmlAc, gelenXmlAnahtari, gelenXmlOzeti, gelenXmlSikistir, type GelenXmlKaydi } from "./gelen-xml-kurallari";

/**
 * Gelen e-Fatura XML'i nesne deposunda tutulur. Geçiş boyunca veritabanı kopyası da yazılır
 * (`GELEN_XML_DB_KOPYASI=0` ile kapanır); kopya varken depo hatası belge alımını durdurmaz,
 * taşıma betiği eksiği sonradan tamamlar.
 */
@Injectable()
export class GelenXmlDeposu {
  private readonly logger = new Logger(GelenXmlDeposu.name);
  constructor(private readonly depo: DepoService) {}

  private get dbKopyasi() { return process.env.GELEN_XML_DB_KOPYASI !== "0"; }

  /** Veritabanı işleminden önce çağrılır; dönen alanlar kayda yazılır. */
  async yaz(tenantId: string, uuid: string, xml: string): Promise<GelenXmlKaydi> {
    const xmlAnahtar = gelenXmlAnahtari(tenantId, uuid);
    try {
      await this.depo.yukle(xmlAnahtar, gelenXmlSikistir(xml), "application/gzip");
    } catch (hata) {
      if (!this.dbKopyasi) throw hata;
      this.logger.warn(JSON.stringify({ event: "inbound_xml_store_failed", tenantId, error: hata instanceof Error ? hata.message : String(hata) }));
      return { xmlIcerik: xml, xmlAnahtar: null, xmlOzet: null };
    }
    return { xmlIcerik: this.dbKopyasi ? xml : null, xmlAnahtar, xmlOzet: gelenXmlOzeti(xml) };
  }

  async oku(k: GelenXmlKaydi): Promise<string> {
    if (k.xmlIcerik !== null) return k.xmlIcerik;
    if (!k.xmlAnahtar || !k.xmlOzet) throw new Error("Gelen belgenin XML'i bulunamadı");
    return gelenXmlAc(await this.depo.indir(k.xmlAnahtar), k.xmlOzet);
  }
}

/** Depo bağlanmamışsa veritabanı kopyasıyla çalışır, kopya da yoksa açıkça hata verir. */
export function gelenXmlOku(k: GelenXmlKaydi, depo?: GelenXmlDeposu): Promise<string> {
  if (depo) return depo.oku(k);
  if (k.xmlIcerik === null) throw new Error("Gelen belge XML deposu bağlı değil");
  return Promise.resolve(k.xmlIcerik);
}
export const gelenXmlYaz = (depo: GelenXmlDeposu | undefined, tenantId: string, uuid: string, xml: string): Promise<Partial<GelenXmlKaydi>> =>
  depo ? depo.yaz(tenantId, uuid, xml) : Promise.resolve({ xmlIcerik: xml });
