import { BadGatewayException, Injectable, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma } from "@prisma/client";
import { XMLParser } from "fast-xml-parser";
import { aktifBaglam } from "../core/istek-baglami";
import { PrismaService } from "../core/prisma.service";

type KurTipi = "alis" | "satis";
type Doviz = "USD" | "EUR";
interface EvdsSatiri { TARIH?: string; Tarih?: string; [anahtar: string]: unknown }

const SERILER = ["TP.DK.USD.A", "TP.DK.USD.S", "TP.DK.EUR.A", "TP.DK.EUR.S"];
const alan = (doviz: Doviz, tip: KurTipi) => `TP_DK_${doviz}_${tip === "alis" ? "A" : "S"}`;
const ddmmyyyy = (tarih: Date) => `${String(tarih.getUTCDate()).padStart(2, "0")}-${String(tarih.getUTCMonth() + 1).padStart(2, "0")}-${tarih.getUTCFullYear()}`;
const iso = (tarih: Date) => tarih.toISOString().slice(0, 10);
const tarihCoz = (deger: string) => {
  const [gun, ay, yil] = deger.split(/[./-]/).map(Number);
  return yil && ay && gun ? new Date(Date.UTC(yil, ay - 1, gun)) : null;
};
const sayi = (deger: unknown) => {
  if (deger == null || deger === "") return null;
  const n = Number(String(deger).replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
};

@Injectable()
export class DovizService {
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService) {}

  private apiKey() {
    const key = this.config.get<string>("TCMB_EVDS_API_KEY")?.trim();
    if (!key) throw new ServiceUnavailableException("TCMB EVDS API anahtarı sunucuda tanımlı değil");
    return key;
  }

  async baglantiTesti() {
    const kurlar = await this.kurlariGetir(undefined, "alis", true);
    return { basarili: true, kaynak: "TCMB_EVDS", kurTarihi: kurlar.kurTarihi };
  }

  async kurlariGetir(tarihMetni?: string, tip: KurTipi = "alis", zorla = false) {
    const hedef = new Date(`${tarihMetni ?? new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
    const { tenantId } = aktifBaglam();
    if (!zorla) {
      const kayitlar = await this.prisma.tenantIslem(tenantId, (tx) => tx.dovizKuru.findMany({
        where: { tenantId, tarih: { lte: hedef }, dovizCinsi: { in: ["USD", "EUR"] } }, orderBy: { tarih: "desc" }, take: 2,
      }));
      const ayniTarih = kayitlar.filter((k) => iso(k.tarih) === iso(kayitlar[0]?.tarih ?? new Date(0)));
      if (ayniTarih.length === 2 && iso(kayitlar[0].tarih) === iso(hedef)) return this.gorunum(ayniTarih, tip, iso(hedef));
    }

    const baslangic = new Date(hedef); baslangic.setUTCDate(baslangic.getUTCDate() - 10);
    const url = `https://evds3.tcmb.gov.tr/service/evds/series=${SERILER.join("-")}&startDate=${ddmmyyyy(baslangic)}&endDate=${ddmmyyyy(hedef)}&type=json`;
    let yanit: Response;
    try { yanit = await fetch(url, { headers: { key: this.apiKey(), Accept: "application/json" }, signal: AbortSignal.timeout(10000) }); }
    catch { return this.tcmbXmlGetir(tenantId, hedef, tip); }
    if (!yanit.ok) return this.tcmbXmlGetir(tenantId, hedef, tip);
    const icerikTipi = yanit.headers.get("content-type") ?? "";
    if (!icerikTipi.includes("json")) return this.tcmbXmlGetir(tenantId, hedef, tip);
    const govde = await yanit.json() as { items?: EvdsSatiri[] } | EvdsSatiri[];
    const satirlar = Array.isArray(govde) ? govde : govde.items ?? [];
    const uygun = satirlar.map((s) => ({ s, t: tarihCoz(String(s.TARIH ?? s.Tarih ?? "")) })).filter((x) => x.t && x.t <= hedef).sort((a, b) => b.t!.getTime() - a.t!.getTime()).find(({ s }) => sayi(s[alan("USD", "alis")]) && sayi(s[alan("EUR", "alis")]));
    if (!uygun?.t) return this.tcmbXmlGetir(tenantId, hedef, tip);

    const kayitlar = await this.prisma.tenantIslem(tenantId, async (tx) => Promise.all((["USD", "EUR"] as Doviz[]).map((doviz) => tx.dovizKuru.upsert({
      where: { tenantId_tarih_dovizCinsi: { tenantId, tarih: uygun.t!, dovizCinsi: doviz } },
      create: { tenantId, tarih: uygun.t!, dovizCinsi: doviz, dovizAlis: new Prisma.Decimal(sayi(uygun.s[alan(doviz, "alis")])!), dovizSatis: new Prisma.Decimal(sayi(uygun.s[alan(doviz, "satis")])!) },
      update: { dovizAlis: new Prisma.Decimal(sayi(uygun.s[alan(doviz, "alis")])!), dovizSatis: new Prisma.Decimal(sayi(uygun.s[alan(doviz, "satis")])!), alindiAt: new Date() },
    }))));
    return this.gorunum(kayitlar, tip, iso(hedef));
  }

  private async tcmbXmlGetir(tenantId: string, hedef: Date, tip: KurTipi) {
    for (let geri = 0; geri <= 10; geri++) {
      const gun = new Date(hedef); gun.setUTCDate(gun.getUTCDate() - geri);
      const yil = gun.getUTCFullYear(); const ay = String(gun.getUTCMonth() + 1).padStart(2, "0");
      const tarihKod = `${String(gun.getUTCDate()).padStart(2, "0")}${ay}${yil}`;
      const url = `https://www.tcmb.gov.tr/kurlar/${yil}${ay}/${tarihKod}.xml`;
      try {
        const yanit = await fetch(url, { headers: { Accept: "application/xml" }, signal: AbortSignal.timeout(10000) });
        if (!yanit.ok) continue;
        const xml = new XMLParser({ ignoreAttributes: false }).parse(await yanit.text()) as { Tarih_Date?: { Currency?: Array<{ "@_CurrencyCode"?: string; ForexBuying?: unknown; ForexSelling?: unknown }> | { "@_CurrencyCode"?: string; ForexBuying?: unknown; ForexSelling?: unknown } } };
        const ham = xml.Tarih_Date?.Currency; const paraBirimleri = Array.isArray(ham) ? ham : ham ? [ham] : [];
        const degerler = (["USD", "EUR"] as Doviz[]).map((doviz) => {
          const k = paraBirimleri.find((x) => x["@_CurrencyCode"] === doviz);
          return { doviz, alis: sayi(k?.ForexBuying), satis: sayi(k?.ForexSelling) };
        });
        if (degerler.some((x) => !x.alis || !x.satis)) continue;
        const kayitlar = await this.prisma.tenantIslem(tenantId, async (tx) => Promise.all(degerler.map((x) => tx.dovizKuru.upsert({
          where: { tenantId_tarih_dovizCinsi: { tenantId, tarih: gun, dovizCinsi: x.doviz } },
          create: { tenantId, tarih: gun, dovizCinsi: x.doviz, dovizAlis: new Prisma.Decimal(x.alis!), dovizSatis: new Prisma.Decimal(x.satis!), kaynak: "TCMB_XML" },
          update: { dovizAlis: new Prisma.Decimal(x.alis!), dovizSatis: new Prisma.Decimal(x.satis!), kaynak: "TCMB_XML", alindiAt: new Date() },
        }))));
        return this.gorunum(kayitlar, tip, iso(hedef));
      } catch { /* yayımlanmamış/tatil günü için önceki güne ilerle */ }
    }
    throw new BadGatewayException("TCMB seçilen tarih için geçerli USD/EUR kuru döndürmedi");
  }

  private gorunum(kayitlar: Array<{ tarih: Date; dovizCinsi: string; dovizAlis: Prisma.Decimal; dovizSatis: Prisma.Decimal; kaynak: string; alindiAt: Date }>, tip: KurTipi, istenenTarih: string) {
    const kurTarihi = iso(kayitlar[0].tarih);
    return { istenenTarih, kurTarihi, tip, kaynak: kayitlar[0].kaynak, oncekiIsGunuKullanildi: kurTarihi !== istenenTarih, alindiAt: kayitlar[0].alindiAt.toISOString(), kurlar: Object.fromEntries(kayitlar.map((k) => [k.dovizCinsi, Number(tip === "alis" ? k.dovizAlis : k.dovizSatis)])) };
  }
}
