import { BadRequestException, Injectable } from "@nestjs/common";
import { bugunTR, gecerliTarihMi, mevzuatDegerHatalari, VERGI_TAKVIMI_TURU, VERGI_YUKUMLULUK_ADLARI, VERGI_YUKUMLULUKLERI, vergiDonemAylari, vergiTakvimAnahtari, vergiTakvimAnahtariCoz, vergiTarihUyarisi, vergiYukumlulukMu, type VergiTakvimSatiri, type VergiYukumlulugu } from "@tekirextra/shared";
import * as ExcelJS from "exceljs";
import { PlatformMevzuatService, type SatirGirdisi } from "./platform-mevzuat.service";
import { PlatformPrismaService } from "./platform-prisma.service";

const AZAMI_SATIR = 500;
const BASLIKLAR = ["Yıl", "Dönem", "Yükümlülük", "Son tarih", "Not"];
const gun = (d: Date) => d.toISOString().slice(0, 10);
const kucuk = (s: string) => s.toLocaleLowerCase("tr-TR").trim();

/** Excel hücresini düz değere indirger: formül sonucu, zengin metin ve köprü. */
function hucre(v: ExcelJS.CellValue): string | number | Date | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date || typeof v === "number" || typeof v === "string") return v;
  if (typeof v === "boolean") return String(v);
  if (typeof v === "object") {
    if ("result" in v) return hucre((v as ExcelJS.CellFormulaValue).result as ExcelJS.CellValue);
    if ("richText" in v) return (v as ExcelJS.CellRichTextValue).richText.map((p) => p.text).join("");
    if ("text" in v) return String((v as ExcelJS.CellHyperlinkValue).text);
  }
  return null;
}

/** Kabul edilen: Excel tarihi, YYYY-AA-GG, GG.AA.YYYY. Çözülemezse null. */
export function excelTarihi(v: string | number | Date | null): string | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : gun(v);
  if (typeof v !== "string") return null;
  const m = v.trim().match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/);
  const t = m ? `${m[3]}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}` : v.trim();
  return gecerliTarihMi(t) ? t : null;
}

export function excelYukumlulugu(v: string | number | Date | null): VergiYukumlulugu | null {
  if (typeof v !== "string") return null;
  const metin = kucuk(v);
  return VERGI_YUKUMLULUKLERI.find((y) => y === metin || kucuk(VERGI_YUKUMLULUK_ADLARI[y]) === metin) ?? null;
}

export interface OnizlemeSatiri extends VergiTakvimSatiri { satirNo: number; durum: "yeni" | "degisen" | "ayni"; eskiTarih: string | null; uyari: string | null }
export interface OnizlemeHatasi { satirNo: number; mesaj: string }

/** VTK-14: dosya satırlarını yıla göre denetler; yayınlanmış tarihlerle karşılaştırır. */
export function excelSatirlariniDenetle(ham: { satirNo: number; yil: unknown; ay: unknown; yukumluluk: string | number | Date | null; sonTarih: string | number | Date | null }[], yil: number, mevcut: ReadonlyMap<string, string>) {
  const satirlar: OnizlemeSatiri[] = [], hatalar: OnizlemeHatasi[] = [];
  const gorulen = new Map<string, number>();
  for (const s of ham) {
    if (s.sonTarih === null || s.sonTarih === "") continue;
    const hata = (mesaj: string) => hatalar.push({ satirNo: s.satirNo, mesaj });
    const y = excelYukumlulugu(s.yukumluluk);
    if (!y) { hata(`Bilinmeyen yükümlülük: ${String(s.yukumluluk ?? "(boş)")}`); continue; }
    if (Number(s.yil) !== yil) { hata(`Yıl ${yil} olmalıdır`); continue; }
    const ay = Number(s.ay);
    if (!Number.isInteger(ay) || ay < 1 || ay > 12) { hata("Dönem 1 ile 12 arasında olmalıdır"); continue; }
    if (!vergiDonemAylari(y).includes(ay)) { hata("Üç aylık muhtasar dönemi 3, 6, 9 ya da 12 olmalıdır"); continue; }
    const tarih = excelTarihi(s.sonTarih);
    if (!tarih) { hata(`Geçersiz tarih: ${String(s.sonTarih)}`); continue; }
    const anahtar = vergiTakvimAnahtari(y, yil, ay);
    const onceki = gorulen.get(anahtar);
    if (onceki) { hata(`Aynı kalem ${onceki}. satırda da var`); continue; }
    gorulen.set(anahtar, s.satirNo);
    const sorunlar = mevzuatDegerHatalari(VERGI_TAKVIMI_TURU, anahtar, { sonTarih: tarih });
    if (sorunlar.length) { hata(sorunlar.join("; ")); continue; }
    const eski = mevcut.get(anahtar) ?? null;
    satirlar.push({ satirNo: s.satirNo, yukumluluk: y, ay, sonTarih: tarih, eskiTarih: eski, durum: eski === null ? "yeni" : eski === tarih ? "ayni" : "degisen", uyari: vergiTarihUyarisi(tarih) });
  }
  return { satirlar, hatalar };
}

export interface TaslakGirdisi { yil: number; dayanak: string; baslik?: string | null; kaynakDosya?: string | null; satirlar: VergiTakvimSatiri[] }

/** VTK-06/07/14: takvimi hazırlar; yayın yalnız Mevzuat Merkezi'nin dört göz akışından geçer. */
@Injectable()
export class PlatformVergiTakvimiService {
  constructor(private readonly platform: PlatformPrismaService, private readonly mevzuat: PlatformMevzuatService) {}

  private kayitlar(yil: number) {
    return this.platform.db.mevzuatKayit.findMany({ where: { tur: VERGI_TAKVIMI_TURU, anahtar: { contains: `:${yil}-` } }, orderBy: { yururlukBaslangic: "asc" }, select: { anahtar: true, deger: true, yururlukBaslangic: true, yururlukBitis: true } });
  }

  private async yayinlanan(yil: number) {
    const liste = await this.kayitlar(yil);
    const son = new Map<string, string>(), onceki = new Map<string, string>(), baslangic = new Map<string, string>();
    for (const k of liste) {
      const t = (k.deger as { sonTarih?: string }).sonTarih;
      baslangic.set(k.anahtar, gun(k.yururlukBaslangic));
      if (!t) continue;
      const eski = son.get(k.anahtar);
      if (eski && eski !== t) onceki.set(k.anahtar, eski);
      son.set(k.anahtar, t);
    }
    for (const k of liste) if (k.yururlukBitis !== null && !liste.some((x) => x.anahtar === k.anahtar && x.yururlukBitis === null)) son.delete(k.anahtar);
    return { son, onceki, baslangic };
  }

  private satirlara(son: ReadonlyMap<string, string>): VergiTakvimSatiri[] {
    return [...son.entries()].flatMap(([anahtar, sonTarih]) => { const c = vergiTakvimAnahtariCoz(anahtar); return c ? [{ yukumluluk: c.yukumluluk, ay: c.ay, sonTarih }] : []; });
  }

  async takvim(yil: number) {
    const [buYil, gecen, degisiklikler] = await Promise.all([
      this.yayinlanan(yil), this.yayinlanan(yil - 1),
      this.platform.db.mevzuatDegisiklik.findMany({ where: { durum: { not: "yayinlandi" }, satirlar: { some: { tur: VERGI_TAKVIMI_TURU, anahtar: { contains: `:${yil}-` } } } }, orderBy: { no: "desc" }, select: { id: true, no: true, baslik: true, durum: true } }),
    ]);
    return { yil, bugun: bugunTR(), yayinlanan: this.satirlara(buYil.son).map((s) => ({ ...s, oncekiSonTarih: buYil.onceki.get(vergiTakvimAnahtari(s.yukumluluk, yil, s.ay)) ?? null })), oncekiYil: this.satirlara(gecen.son), acikDegisiklikler: degisiklikler };
  }

  async sablon(yil: number): Promise<Buffer> {
    const { son } = await this.yayinlanan(yil);
    const kitap = new ExcelJS.Workbook();
    const sayfa = kitap.addWorksheet("Vergi Takvimi");
    sayfa.columns = [{ width: 8 }, { width: 8 }, { width: 22 }, { width: 14 }, { width: 40 }];
    sayfa.addRow(BASLIKLAR).font = { bold: true };
    sayfa.views = [{ state: "frozen", ySplit: 1 }];
    for (const y of VERGI_YUKUMLULUKLERI) for (const ay of vergiDonemAylari(y)) {
      const t = son.get(vergiTakvimAnahtari(y, yil, ay));
      const satir = sayfa.addRow([yil, ay, VERGI_YUKUMLULUK_ADLARI[y], t ? new Date(`${t}T00:00:00Z`) : null, null]);
      satir.getCell(3).dataValidation = { type: "list", allowBlank: false, formulae: [`"${VERGI_YUKUMLULUKLERI.map((x) => VERGI_YUKUMLULUK_ADLARI[x]).join(",")}"`] };
      satir.getCell(4).numFmt = "dd.mm.yyyy";
    }
    const bilgi = kitap.addWorksheet("Açıklamalar");
    bilgi.addRows([
      ["Alan", "Açıklama"],
      ["Dönem", "Verginin ait olduğu ay (1-12). Ekim dönemi için 10 yazılır; son tarih izleyen aydadır."],
      ["Son tarih", "Boş satır dikkate alınmaz. GG.AA.YYYY ya da Excel tarihi."],
      ["Üç aylık muhtasar", "Yalnız 3, 6, 9 ve 12. dönemler."],
      ["Yayın", "Yükleme yalnız taslak oluşturur; yayın için ikinci yetkilinin onayı gerekir."],
    ]);
    bilgi.getColumn(1).width = 20; bilgi.getColumn(2).width = 80;
    return Buffer.from(await kitap.xlsx.writeBuffer());
  }

  async onizle(tampon: Buffer, yil: number, dosyaAdi: string) {
    const kitap = new ExcelJS.Workbook();
    try { await kitap.xlsx.load(tampon as never); } catch { throw new BadRequestException("Excel dosyası okunamadı"); }
    const sayfa = kitap.worksheets[0];
    if (!sayfa) throw new BadRequestException("Çalışma sayfası bulunamadı");
    const baslik = BASLIKLAR.slice(0, 4).map((_, i) => kucuk(String(hucre(sayfa.getRow(1).getCell(i + 1).value) ?? "")));
    if (baslik.join("|") !== BASLIKLAR.slice(0, 4).map(kucuk).join("|")) throw new BadRequestException(`Şablon başlıkları eksik: ilk satır ${BASLIKLAR.slice(0, 4).join(", ")} olmalıdır. Şablonu indirip kullanın.`);
    if (sayfa.actualRowCount > AZAMI_SATIR + 1) throw new BadRequestException(`Dosyada en çok ${AZAMI_SATIR} satır olabilir`);
    const ham: Parameters<typeof excelSatirlariniDenetle>[0] = [];
    sayfa.eachRow((r, n) => { if (n > 1) ham.push({ satirNo: n, yil: hucre(r.getCell(1).value), ay: hucre(r.getCell(2).value), yukumluluk: hucre(r.getCell(3).value), sonTarih: hucre(r.getCell(4).value) }); });
    const { son } = await this.yayinlanan(yil);
    return { dosyaAdi, ...excelSatirlariniDenetle(ham, yil, son) };
  }

  /** Yalnız değişen satırlar taslağa yazılır; ilk yayın "ekle", sonraki tarih "değiştir"dir. */
  async taslakOlustur(g: TaslakGirdisi) {
    const { son, baslangic } = await this.yayinlanan(g.yil);
    const satirlar: SatirGirdisi[] = [];
    const hatalar: string[] = [];
    for (const s of g.satirlar) {
      const anahtar = vergiTakvimAnahtari(s.yukumluluk, g.yil, s.ay);
      const eski = son.get(anahtar);
      if (eski === s.sonTarih) continue;
      for (const h of mevzuatDegerHatalari(VERGI_TAKVIMI_TURU, anahtar, { sonTarih: s.sonTarih })) hatalar.push(`${VERGI_YUKUMLULUK_ADLARI[s.yukumluluk]} ${s.ay}. dönem: ${h}`);
      satirlar.push({ tur: VERGI_TAKVIMI_TURU, anahtar, islem: eski ? "degistir" : "ekle", deger: { sonTarih: s.sonTarih } });
    }
    if (hatalar.length) throw new BadRequestException(hatalar.join("; "));
    if (!satirlar.length) throw new BadRequestException("Yayınlanmış takvimden farklı tarih yok");
    // MVZ-02: yeni yürürlük, kalemin son kaydından sonra olmalıdır; aynı gün ikinci düzeltme ertesi güne yazılır.
    const bugun = bugunTR();
    const enGec = satirlar.reduce((en, s) => { const b = baslangic.get(s.anahtar); return b && b > en ? b : en; }, "");
    const yururluk = enGec >= bugun ? gunEkle(enGec) : bugun;
    // Yükleyen kullanıcı değişikliğin hazırlayanı olarak yazılır.
    const aciklama = g.kaynakDosya ? `Excel içe aktarma: ${g.kaynakDosya} · ${g.satirlar.length} satır` : null;
    const { id, no } = await this.mevzuat.olustur({ baslik: g.baslik?.trim() || `${g.yil} vergi ve SGK takvimi`, dayanak: g.dayanak, aciklama, yururlukBaslangic: yururluk });
    await this.mevzuat.satirlariYaz(id, satirlar, 1);
    return { id, no, satirSayisi: satirlar.length, yururluk };
  }
}

const gunEkle = (t: string) => new Date(Date.parse(`${t}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
