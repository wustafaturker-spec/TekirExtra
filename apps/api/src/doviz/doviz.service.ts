import { BadGatewayException, BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma } from "@prisma/client";
import { XMLParser } from "fast-xml-parser";
import { aktifBaglam } from "../core/istek-baglami";
import { PrismaService } from "../core/prisma.service";
import { YABANCI_DOVIZLER, type YabanciDoviz } from "@tekirextra/shared";
import { KUR_GERI_BAKIS_GUN, KurTipi, kurlariBul, kurPenceresiBasi } from "./kur-coz";

type Doviz = YabanciDoviz;
/** DVZ-10: TCMB'nin gösterge kuru yayımladığı bütün dövizler; günlük XML hepsini taşır. */
const DOVIZLER: readonly Doviz[] = YABANCI_DOVIZLER;
/** Bir günün kullanılabilir sayılması için bunların kuru şarttır; EVDS yalnız bunları verir (yedek kaynak). */
const TEMEL_DOVIZLER: readonly Doviz[] = ["USD", "EUR"];
const SERILER = TEMEL_DOVIZLER.flatMap((d) => [`TP.DK.${d}.A`, `TP.DK.${d}.S`]);
const GUN_MS = 24 * 60 * 60 * 1000;
/** Aynı gün için TCMB'ye bu süre dolmadan yeniden gidilmez; yayım öncesi her ekran açılışı istek atmasın. */
const TEKRAR_DENEME_MS = 15 * 60 * 1000;
/** Tek seferde çekilebilecek ve listelenebilecek en uzun aralık. */
const EN_UZUN_CEKIM_GUN = 370;
const EN_UZUN_LISTE_GUN = 93;

interface TcmbGunu {
  tarih: Date;
  kaynak: "TCMB_EVDS" | "TCMB_XML";
  degerler: { doviz: Doviz; alis: number; satis: number }[];
}
interface EvdsSatiri { TARIH?: string; Tarih?: string; [anahtar: string]: unknown }

const alan = (doviz: Doviz, tip: KurTipi) => `TP_DK_${doviz}_${tip === "alis" ? "A" : "S"}`;
const ddmmyyyy = (tarih: Date) => `${String(tarih.getUTCDate()).padStart(2, "0")}-${String(tarih.getUTCMonth() + 1).padStart(2, "0")}-${tarih.getUTCFullYear()}`;
const iso = (tarih: Date) => tarih.toISOString().slice(0, 10);
const gun = (metin: string) => new Date(`${metin}T00:00:00.000Z`);
const gunBasi = (tarih: Date) => new Date(Date.UTC(tarih.getUTCFullYear(), tarih.getUTCMonth(), tarih.getUTCDate()));
const gunEkle = (tarih: Date, fark: number) => new Date(tarih.getTime() + fark * GUN_MS);
/** TCMB hafta sonu kur yayımlamaz; tatiller önceden bilinmediği için eksik sayılır ama "yayımlanmadı" diye raporlanır. */
const isGunu = (tarih: Date) => tarih.getUTCDay() !== 0 && tarih.getUTCDay() !== 6;
const tarihCoz = (deger: string) => {
  const [g, a, y] = deger.split(/[./-]/).map(Number);
  return y && a && g ? new Date(Date.UTC(y, a - 1, g)) : null;
};
const sayi = (deger: unknown) => {
  if (deger == null || deger === "") return null;
  const n = Number(String(deger).replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
};
const D = (deger: string | number) => new Prisma.Decimal(deger);

/**
 * TCMB gösterge kurları (DVZ). TCMB kuru ortak tablodadır ve kiracı bağlamı
 * olmadan yazılır; elle kur kiracıya özeldir. TCMB'ye gitmek veritabanı
 * işleminin içinde yapılmaz.
 */
@Injectable()
export class DovizService {
  private readonly logger = new Logger(DovizService.name);
  private readonly sonDeneme = new Map<string, number>();

  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService) {}

  // ─── TCMB (ağ) ──────────────────────────────────────────────────────────

  /** EVDS aralık sorgusu; anahtar yoksa ya da yanıt kullanılamazsa `null`. */
  private async evdsAralik(baslangic: Date, bitis: Date): Promise<TcmbGunu[] | null> {
    const anahtar = this.config.get<string>("TCMB_EVDS_API_KEY")?.trim();
    if (!anahtar) return null;
    const url = `https://evds3.tcmb.gov.tr/service/evds/series=${SERILER.join("-")}&startDate=${ddmmyyyy(baslangic)}&endDate=${ddmmyyyy(bitis)}&type=json`;
    try {
      const yanit = await fetch(url, { headers: { key: anahtar, Accept: "application/json" }, signal: AbortSignal.timeout(10000) });
      if (!yanit.ok || !(yanit.headers.get("content-type") ?? "").includes("json")) return null;
      const govde = (await yanit.json()) as { items?: EvdsSatiri[] } | EvdsSatiri[];
      const satirlar = Array.isArray(govde) ? govde : govde.items ?? [];
      const gunler: TcmbGunu[] = [];
      for (const s of satirlar) {
        const tarih = tarihCoz(String(s.TARIH ?? s.Tarih ?? ""));
        if (!tarih) continue;
        const degerler = TEMEL_DOVIZLER.map((doviz) => ({ doviz, alis: sayi(s[alan(doviz, "alis")]), satis: sayi(s[alan(doviz, "satis")]) }));
        if (degerler.some((d) => !d.alis || !d.satis)) continue;
        gunler.push({ tarih, kaynak: "TCMB_EVDS", degerler: degerler as TcmbGunu["degerler"] });
      }
      return gunler;
    } catch {
      return null;
    }
  }

  /** TCMB'nin o güne ait XML dosyası; yayımlanmamış gün (hafta sonu, tatil, yayım saati öncesi) `null`. */
  private async xmlGun(tarih: Date): Promise<TcmbGunu | null> {
    const yil = tarih.getUTCFullYear();
    const ay = String(tarih.getUTCMonth() + 1).padStart(2, "0");
    const url = `https://www.tcmb.gov.tr/kurlar/${yil}${ay}/${String(tarih.getUTCDate()).padStart(2, "0")}${ay}${yil}.xml`;
    try {
      const yanit = await fetch(url, { headers: { Accept: "application/xml" }, signal: AbortSignal.timeout(10000) });
      if (!yanit.ok) return null;
      type XmlDoviz = { "@_CurrencyCode"?: string; Unit?: unknown; ForexBuying?: unknown; ForexSelling?: unknown };
      const xml = new XMLParser({ ignoreAttributes: false }).parse(await yanit.text()) as { Tarih_Date?: { Currency?: XmlDoviz[] | XmlDoviz } };
      const ham = xml.Tarih_Date?.Currency;
      const paraBirimleri = Array.isArray(ham) ? ham : ham ? [ham] : [];
      // DVZ-10: yayımlanan her döviz alınır; JPY gibi 100 birim için verilenler birime bölünür.
      const degerler = DOVIZLER.flatMap((doviz) => {
        const k = paraBirimleri.find((x) => x["@_CurrencyCode"] === doviz);
        const birim = sayi(k?.Unit) ?? 1;
        const alis = sayi(k?.ForexBuying);
        const satis = sayi(k?.ForexSelling);
        return alis && satis ? [{ doviz, alis: Number((alis / birim).toFixed(6)), satis: Number((satis / birim).toFixed(6)) }] : [];
      });
      if (TEMEL_DOVIZLER.some((d) => !degerler.some((x) => x.doviz === d))) return null;
      return { tarih, kaynak: "TCMB_XML", degerler };
    } catch {
      return null;
    }
  }

  // ─── Ortak tablo ────────────────────────────────────────────────────────

  private async tcmbKaydet(gunler: TcmbGunu[]) {
    for (const g of gunler) {
      for (const d of g.degerler) {
        await this.prisma.tcmbKuru.upsert({
          where: { tarih_dovizCinsi: { tarih: g.tarih, dovizCinsi: d.doviz } },
          create: { tarih: g.tarih, dovizCinsi: d.doviz, dovizAlis: D(d.alis), dovizSatis: D(d.satis), kaynak: g.kaynak },
          update: { dovizAlis: D(d.alis), dovizSatis: D(d.satis), kaynak: g.kaynak, alindiAt: new Date() },
        });
      }
    }
  }

  /**
   * Günlük XML'den çekilmiş, yani bütün listesi kayıtlı günler. EVDS yalnız
   * USD/EUR verir (2 kayıt); DVZ-10 öncesi XML de yalnız onları kaydediyordu.
   * Böyle günler eksik sayılır ve XML'den yeniden çekilir. Sayı tam liste
   * yerine "ikiden fazla" ile sınanır: TCMB bir dövizi yayımlamayı bırakırsa
   * (ya da eski bir tarihte henüz yayımlamıyorsa) gün sonsuza dek eksik kalmasın.
   */
  private async tamGunler(baslangic: Date, bitis: Date): Promise<Set<string>> {
    const gruplar = await this.prisma.tcmbKuru.groupBy({
      by: ["tarih"],
      where: { tarih: { gte: baslangic, lte: bitis }, dovizCinsi: { in: [...DOVIZLER] } },
      _count: { _all: true },
    });
    return new Set(gruplar.filter((g) => g._count._all > TEMEL_DOVIZLER.length).map((g) => iso(g.tarih)));
  }

  /** Pencerede USD ve EUR kurunun (EVDS'den de olabilir) bulunduğu en az bir gün var mı. */
  private async temelKurVar(baslangic: Date, bitis: Date): Promise<boolean> {
    const gruplar = await this.prisma.tcmbKuru.groupBy({
      by: ["tarih"],
      where: { tarih: { gte: baslangic, lte: bitis }, dovizCinsi: { in: [...TEMEL_DOVIZLER] } },
      _count: { _all: true },
    });
    return gruplar.some((g) => g._count._all === TEMEL_DOVIZLER.length);
  }

  /**
   * Tarihin geriye bakış penceresinde TCMB kuru olmasını sağlamaya çalışır.
   * Hedef günün kuru zaten varsa ağa çıkılmaz; yoksa EVDS, olmazsa hedef
   * günden geriye XML denenir. Aynı gün 15 dakikada bir kez denenir.
   */
  async kurGarantile(tarih: Date, zorla = false): Promise<boolean> {
    const hedef = gunBasi(tarih);
    const pencereBasi = kurPenceresiBasi(hedef);
    if (!zorla && (await this.tamGunler(hedef, hedef)).size) return true;
    const anahtar = iso(hedef);
    const pencereDolu = async () => (await this.tamGunler(pencereBasi, hedef)).size > 0 || (await this.temelKurVar(pencereBasi, hedef));
    if (!zorla && Date.now() - (this.sonDeneme.get(anahtar) ?? 0) < TEKRAR_DENEME_MS) return pencereDolu();
    this.sonDeneme.set(anahtar, Date.now());

    // DVZ-10: tam liste yalnız XML'de; EVDS yalnız XML hiç kur vermezse USD/EUR için yedektir.
    const mevcut = await this.tamGunler(pencereBasi, hedef);
    let xmlBulundu = false;
    for (let geri = 0; geri <= KUR_GERI_BAKIS_GUN; geri++) {
      const d = gunEkle(hedef, -geri);
      if (mevcut.has(iso(d))) { xmlBulundu = true; break; } // daha yeni bir gün yayımlanmamış, bu gün zaten elde
      if (!isGunu(d)) continue;
      const xml = await this.xmlGun(d);
      if (xml) {
        await this.tcmbKaydet([xml]);
        xmlBulundu = true;
        break;
      }
    }
    if (!xmlBulundu) {
      const evds = await this.evdsAralik(pencereBasi, hedef);
      if (evds?.length) await this.tcmbKaydet(evds);
    }
    return pencereDolu();
  }

  /**
   * DVZ-03: aralıktaki eksik iş günlerini çeker. Önce tek EVDS sorgusu, kalan
   * günler için gün gün XML. Yayımlanmayan günler (tatil, yayım öncesi) ayrıca döner.
   */
  async eksikleriCek(baslangic: Date, bitis: Date) {
    const bugun = gunBasi(new Date());
    const son = bitis > bugun ? bugun : gunBasi(bitis);
    const bas = gunBasi(baslangic);
    if (bas > son) throw new BadRequestException("Başlangıç tarihi bitiş tarihinden sonra olamaz");
    if ((son.getTime() - bas.getTime()) / GUN_MS > EN_UZUN_CEKIM_GUN) {
      throw new BadRequestException(`Tek seferde en fazla ${EN_UZUN_CEKIM_GUN} günlük aralık çekilebilir`);
    }
    const mevcut = await this.tamGunler(bas, son);
    const adaylar: Date[] = [];
    for (let d = bas; d <= son; d = gunEkle(d, 1)) if (isGunu(d) && !mevcut.has(iso(d))) adaylar.push(d);
    if (!adaylar.length) return { aday: 0, cekilen: 0, yayimlanmayan: [] as string[] };

    // DVZ-10: önce gün gün XML (bütün liste); kalan günler için USD/EUR'u EVDS'den tamamla.
    let cekilen = 0;
    const kalan: Date[] = [];
    for (const d of adaylar) {
      const xml = await this.xmlGun(d);
      if (xml) {
        await this.tcmbKaydet([xml]);
        cekilen += 1;
      } else {
        kalan.push(d);
      }
    }
    const yayimlanmayan = new Set(kalan.map(iso));
    if (kalan.length) {
      const evds = await this.evdsAralik(kalan[0], kalan[kalan.length - 1]);
      const uygun = (evds ?? []).filter((g) => yayimlanmayan.has(iso(g.tarih)));
      await this.tcmbKaydet(uygun);
      for (const g of uygun) yayimlanmayan.delete(iso(g.tarih));
      cekilen += uygun.length;
    }
    return { aday: adaylar.length, cekilen, yayimlanmayan: [...yayimlanmayan] };
  }

  /** DVZ-02: worker'ın günlük işi — bugün ve geriye bakış penceresindeki eksikler. */
  async gunlukCek() {
    const bugun = gunBasi(new Date());
    const sonuc = await this.eksikleriCek(gunEkle(bugun, -KUR_GERI_BAKIS_GUN), bugun);
    this.logger.log(`TCMB kurları: ${sonuc.aday} eksik iş günü, ${sonuc.cekilen} çekildi${sonuc.yayimlanmayan.length ? `, yayımlanmamış: ${sonuc.yayimlanmayan.join(", ")}` : ""}`);
    return sonuc;
  }

  // ─── Kiracıya dönük okuma ──────────────────────────────────────────────

  async baglantiTesti() {
    const bugun = gunBasi(new Date());
    const evds = await this.evdsAralik(gunEkle(bugun, -KUR_GERI_BAKIS_GUN), bugun);
    if (evds?.length) return { basarili: true, kaynak: "TCMB_EVDS", kurTarihi: iso(evds[evds.length - 1].tarih) };
    for (let geri = 0; geri <= KUR_GERI_BAKIS_GUN; geri++) {
      const xml = await this.xmlGun(gunEkle(bugun, -geri));
      if (xml) return { basarili: true, kaynak: "TCMB_XML", kurTarihi: iso(xml.tarih) };
    }
    throw new BadGatewayException("TCMB'ye ulaşılamadı: EVDS ve günlük XML kur döndürmedi");
  }

  /**
   * Ekranların kur isteği (fatura, belge, masraf, pano). Kiracının o tarihte
   * geçerli kurunu döner; hedef günün TCMB kuru yoksa önce çekmeyi dener.
   */
  async kurlariGetir(tarihMetni?: string, tip: KurTipi = "alis", zorla = false) {
    const hedef = gun(tarihMetni ?? new Date().toISOString().slice(0, 10));
    const { tenantId } = aktifBaglam();
    const oku = () => this.prisma.tenantIslem(tenantId, (tx) => kurlariBul(tx, tenantId, DOVIZLER, hedef));
    let kurlar = await oku();
    const guncel = (d: string) => kurlar.has(d) && iso(kurlar.get(d)!.kurTarihi) === iso(hedef);
    if (zorla || !TEMEL_DOVIZLER.every(guncel) || kurlar.size < DOVIZLER.length) {
      await this.kurGarantile(hedef, zorla);
      kurlar = await oku();
    }
    if (TEMEL_DOVIZLER.some((d) => !kurlar.has(d))) {
      throw new BadGatewayException(`${iso(hedef)} tarihi ve öncesindeki ${KUR_GERI_BAKIS_GUN} gün için USD/EUR kuru bulunamadı; Ayarlar > Döviz Kurları ekranından çekin ya da elle girin`);
    }
    // DVZ-10: penceresinde kuru olmayan döviz (ör. o tarihte TCMB'nin yayımlamadığı) yanıtta yer almaz.
    const bulunan = DOVIZLER.filter((d) => kurlar.has(d)).map((d) => [d, kurlar.get(d)!] as const);
    const kaynaklar = Object.fromEntries(bulunan.map(([d, k]) => [d, k.kaynak]));
    return {
      istenenTarih: iso(hedef),
      kurTarihi: iso(new Date(Math.max(...bulunan.map(([, k]) => k.kurTarihi.getTime())))),
      tip,
      kaynak: [...new Set(Object.values(kaynaklar))].join("+"),
      kaynaklar,
      oncekiIsGunuKullanildi: bulunan.some(([, k]) => iso(k.kurTarihi) !== iso(hedef)),
      alindiAt: new Date(Math.max(...bulunan.map(([, k]) => k.alindiAt.getTime()))).toISOString(),
      kurlar: Object.fromEntries(bulunan.map(([d, k]) => [d, Number(tip === "alis" ? k.alis : k.satis)])),
    };
  }

  /** DVZ-06: aralıktaki günler — TCMB kuru, kiracının elle kuru ve eksik iş günleri. */
  async liste(baslangicMetni: string, bitisMetni: string) {
    const bas = gun(baslangicMetni);
    const son = gun(bitisMetni);
    if (bas > son) throw new BadRequestException("Başlangıç tarihi bitiş tarihinden sonra olamaz");
    if ((son.getTime() - bas.getTime()) / GUN_MS > EN_UZUN_LISTE_GUN) {
      throw new BadRequestException(`En fazla ${EN_UZUN_LISTE_GUN} günlük aralık listelenebilir`);
    }
    const { tenantId } = aktifBaglam();
    const [tcmb, elle] = await Promise.all([
      this.prisma.tcmbKuru.findMany({ where: { tarih: { gte: bas, lte: son } } }),
      this.prisma.tenantIslem(tenantId, (tx) =>
        tx.elleKur.findMany({ where: { tenantId, tarih: { gte: bas, lte: son } }, include: { kullanici: { select: { adSoyad: true } } } }),
      ),
    ]);
    const bugun = gunBasi(new Date());
    const gunler = [];
    const eksikGunler: string[] = [];
    for (let d = son; d >= bas; d = gunEkle(d, -1)) {
      const anahtar = iso(d);
      const kurlar = DOVIZLER.map((doviz) => {
        const t = tcmb.find((x) => iso(x.tarih) === anahtar && x.dovizCinsi === doviz);
        const e = elle.find((x) => iso(x.tarih) === anahtar && x.dovizCinsi === doviz);
        return {
          dovizCinsi: doviz,
          tcmb: t ? { alis: t.dovizAlis.toString(), satis: t.dovizSatis.toString(), kaynak: t.kaynak, alindiAt: t.alindiAt.toISOString() } : null,
          elle: e ? { alis: e.dovizAlis.toString(), satis: e.dovizSatis.toString(), gerekce: e.gerekce, kullanici: e.kullanici.adSoyad, guncellendi: e.updatedAt.toISOString() } : null,
          /** Elle kurun aynı günün TCMB kurundan farkı (satış). */
          satisFarki: t && e ? e.dovizSatis.sub(t.dovizSatis).toString() : null,
        };
      });
      // tamGunler ile aynı tanım: XML'den bütün liste gelmemişse gün eksiktir.
      const eksik = isGunu(d) && d <= bugun && kurlar.filter((k) => k.tcmb).length <= TEMEL_DOVIZLER.length;
      if (eksik) eksikGunler.push(anahtar);
      gunler.push({ tarih: anahtar, isGunu: isGunu(d), eksik, kurlar });
    }
    return { baslangic: iso(bas), bitis: iso(son), geriBakisGun: KUR_GERI_BAKIS_GUN, eksikGunler, gunler };
  }

  // ─── Elle kur (DVZ-05) ─────────────────────────────────────────────────

  async elleKurKaydet(girdi: { tarih: string; dovizCinsi: Doviz; alis: string; satis: string; gerekce: string }) {
    const { tenantId, userId } = aktifBaglam();
    const tarih = gun(girdi.tarih);
    if (tarih > gunBasi(new Date())) throw new BadRequestException("Gelecek bir tarih için kur girilemez");
    const alis = D(girdi.alis);
    const satis = D(girdi.satis);
    if (alis.lte(0) || satis.lte(0)) throw new BadRequestException("Kur sıfırdan büyük olmalıdır");
    if (satis.lt(alis)) throw new BadRequestException("Satış kuru alış kurundan küçük olamaz");
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const anahtar = { tenantId_tarih_dovizCinsi: { tenantId, tarih, dovizCinsi: girdi.dovizCinsi } };
      const onceki = await tx.elleKur.findUnique({ where: anahtar });
      const kayit = await tx.elleKur.upsert({
        where: anahtar,
        create: { tenantId, tarih, dovizCinsi: girdi.dovizCinsi, dovizAlis: alis, dovizSatis: satis, gerekce: girdi.gerekce, userId },
        update: { dovizAlis: alis, dovizSatis: satis, gerekce: girdi.gerekce, userId },
      });
      await tx.elleKurOlayi.create({
        data: {
          tenantId, tarih, dovizCinsi: girdi.dovizCinsi, tur: onceki ? "degistirildi" : "girildi",
          eskiAlis: onceki?.dovizAlis ?? null, eskiSatis: onceki?.dovizSatis ?? null, yeniAlis: alis, yeniSatis: satis,
          gerekce: girdi.gerekce, userId,
        },
      });
      return { tarih: iso(kayit.tarih), dovizCinsi: kayit.dovizCinsi, alis: kayit.dovizAlis.toString(), satis: kayit.dovizSatis.toString(), tur: onceki ? "degistirildi" : "girildi" };
    });
  }

  /** Silinen elle kurun yerine o gün yine TCMB kuru geçer. */
  async elleKurSil(girdi: { tarih: string; dovizCinsi: Doviz; gerekce: string }) {
    const { tenantId, userId } = aktifBaglam();
    const tarih = gun(girdi.tarih);
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const anahtar = { tenantId_tarih_dovizCinsi: { tenantId, tarih, dovizCinsi: girdi.dovizCinsi } };
      const onceki = await tx.elleKur.findUnique({ where: anahtar });
      if (!onceki) throw new NotFoundException("Bu gün ve para birimi için elle kur yok");
      await tx.elleKur.delete({ where: anahtar });
      await tx.elleKurOlayi.create({
        data: { tenantId, tarih, dovizCinsi: girdi.dovizCinsi, tur: "silindi", eskiAlis: onceki.dovizAlis, eskiSatis: onceki.dovizSatis, gerekce: girdi.gerekce, userId },
      });
      return { tarih: girdi.tarih, dovizCinsi: girdi.dovizCinsi, silindi: true };
    });
  }

  async olaylar(limit = 100) {
    const { tenantId } = aktifBaglam();
    const kayitlar = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.elleKurOlayi.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" }, take: limit, include: { kullanici: { select: { adSoyad: true } } } }),
    );
    return kayitlar.map((o) => ({
      tarih: iso(o.tarih), dovizCinsi: o.dovizCinsi, tur: o.tur,
      eskiAlis: o.eskiAlis?.toString() ?? null, eskiSatis: o.eskiSatis?.toString() ?? null,
      yeniAlis: o.yeniAlis?.toString() ?? null, yeniSatis: o.yeniSatis?.toString() ?? null,
      gerekce: o.gerekce, kullanici: o.kullanici.adSoyad, zaman: o.createdAt.toISOString(),
    }));
  }
}
