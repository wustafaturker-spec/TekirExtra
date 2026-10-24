/**
 * KSB-32: bankaların standart ekstre dosyaları — SWIFT MT940 ve ISO 20022
 * camt.053 (gün sonu) / camt.052 (gün içi). Sütun eşlemesi gerekmez; hesap,
 * döviz, açılış/kapanış bakiyesi ve satırlar dosyadan okunur.
 *
 * Her satıra yürüyen bakiye yazılır (açılış + satırlar). Böylece bakiye
 * mutabakatı ve bakiye farkı uyarısı bu dosyalarda da çalışır; hesaplanan
 * son bakiye dosyadaki kapanışı tutmazsa dosya eksik demektir, uyarı döner.
 */
import { createHash } from "node:crypto";
import { XMLParser } from "fast-xml-parser";
import type { EkstreSatiri } from "./ekstre-oku";

export type StandartBicim = "mt940" | "camt053" | "camt052";

export interface StandartEkstre {
  bicim: StandartBicim;
  /** Dosyadaki hesap(lar); IBAN yoksa banka hesap numarası. */
  hesaplar: { hesap: string; dovizCinsi: string | null }[];
  satirlar: EkstreSatiri[];
  acilis: number | null;
  kapanis: number | null;
  uyarilar: string[];
}

export class StandartEkstreHatasi extends Error {}

const IBAN = /TR\d{24}/;

/** Dosya MT940 ya da camt.052/053 mü? Tablo okuyucuya düşmeden önce bakılır. */
export function standartBicimBul(buffer: Buffer): StandartBicim | null {
  const bas = buffer.subarray(0, 64 * 1024).toString("latin1");
  if (/<\s*(\w+:)?BkToCstmrStmt\b/.test(bas)) return "camt053";
  if (/<\s*(\w+:)?BkToCstmrAcctRpt\b/.test(bas)) return "camt052";
  if (/(^|\n):20:/.test(bas) && /\n:61:/.test(bas) && /\n:60[FM]:/.test(bas)) return "mt940";
  return null;
}

/** UTF-8 değilse Türkçe Windows kod sayfası (bankaların MT940'ı çoğunlukla 1254/ISO-8859-9). */
function metneCevir(buffer: Buffer): string {
  const utf8 = buffer.toString("utf8");
  if (!utf8.includes("\uFFFD")) return utf8.replace(/^\uFEFF/, "");
  return new TextDecoder("windows-1254").decode(buffer);
}

/** Aynı dosya ikinci kez yüklenirse satırlar yinelenen sayılır (tablo okuyucuyla aynı özet). */
function ozetle(satirlar: Omit<EkstreSatiri, "satirOzeti">[]): EkstreSatiri[] {
  const sayac = new Map<string, number>();
  return satirlar.map((s) => {
    const temel = createHash("sha256").update([s.tarih.toISOString().slice(0, 10), s.tutar.toFixed(2), s.aciklama, s.dekontNo ?? ""].join("|")).digest("hex").slice(0, 32);
    const tekrar = (sayac.get(temel) ?? 0) + 1;
    sayac.set(temel, tekrar);
    return { ...s, satirOzeti: `${temel}#${tekrar}` };
  });
}

/** Kuruş hassasiyetinde yürüyen bakiye; kayan nokta birikmesin diye tam sayıyla. */
const kurus = (v: number) => Math.round(v * 100);

function yuruyenBakiye(satirlar: Omit<EkstreSatiri, "satirOzeti">[], acilis: number | null): void {
  if (acilis === null) return;
  let bakiye = kurus(acilis);
  for (const s of satirlar) {
    bakiye += kurus(s.tutar);
    s.bakiye = bakiye / 100;
  }
}

function kapanisDenetle(satirlar: Omit<EkstreSatiri, "satirOzeti">[], acilis: number | null, kapanis: number | null, etiket: string, uyarilar: string[]) {
  if (acilis === null || kapanis === null) return;
  const hesaplanan = kurus(acilis) + satirlar.reduce((t, s) => t + kurus(s.tutar), 0);
  if (hesaplanan !== kurus(kapanis)) {
    uyarilar.push(`${etiket}: açılış + hareketler ${(hesaplanan / 100).toFixed(2)}, dosyadaki kapanış ${kapanis.toFixed(2)}. Dosya eksik ya da kesilmiş olabilir.`);
  }
}

/* ─── MT940 ───────────────────────────────────────────────────────────── */

/** `:TAG:` blokları; devam satırları önceki etikete eklenir. */
function etiketler(metin: string): { etiket: string; deger: string }[] {
  const sonuc: { etiket: string; deger: string }[] = [];
  for (const satir of metin.replace(/\r\n?/g, "\n").split("\n")) {
    const m = /^:(\d{2}[A-Z]?):(.*)$/.exec(satir);
    if (m) sonuc.push({ etiket: m[1], deger: m[2] });
    else if (sonuc.length && satir.trim() && !/^-}?$/.test(satir.trim()) && !satir.startsWith("{")) sonuc[sonuc.length - 1].deger += `\n${satir}`;
  }
  return sonuc;
}

/** YYMMDD → Date (UTC gece yarısı; ekstre satırları gün olarak tutulur). */
function mtTarih(yymmdd: string): Date {
  const yil = 2000 + Number(yymmdd.slice(0, 2));
  return new Date(Date.UTC(yil, Number(yymmdd.slice(2, 4)) - 1, Number(yymmdd.slice(4, 6))));
}
const mtTutar = (s: string) => Number(s.replace(",", "."));

/** :60F:/:62F: C/D + YYMMDD + döviz + tutar. */
function mtBakiye(deger: string): { tutar: number; doviz: string } | null {
  const m = /^([CD])(\d{6})([A-Z]{3})([\d,]+)/.exec(deger.trim());
  if (!m) return null;
  return { tutar: (m[1] === "D" ? -1 : 1) * mtTutar(m[4]), doviz: m[3] };
}

/**
 * :61: tarih[valör günü/ay] işaret [fon kodu] tutar işlem türü müşteri ref [//banka ref] [\n ek bilgi].
 * RC (alacak iptali) çıkış, RD (borç iptali) giriştir.
 */
const SATIR_61 = /^(\d{6})(\d{4})?(RC|RD|C|D)([A-Z])?(\d+,\d*|\d+)([A-Z][A-Z0-9]{3})?((?:(?!\/\/)[^\n])*)(?:\/\/([^\n]*))?(?:\n([\s\S]*))?$/;

/** :86: yapılandırılmış alt alanları (?20…?29 açıklama, ?32/?33 karşı taraf) düz metne indirir. */
function mt86(deger: string): { aciklama: string; karsiUnvan?: string } {
  const tek = deger.replace(/\n/g, "");
  if (!/\?\d{2}/.test(tek)) return { aciklama: deger.replace(/\s*\n\s*/g, " ").trim() };
  const alanlar = new Map<string, string[]>();
  for (const m of tek.matchAll(/\?(\d{2})([^?]*)/g)) alanlar.set(m[1], [...(alanlar.get(m[1]) ?? []), m[2]]);
  const aciklama = [...alanlar.entries()].filter(([k]) => Number(k) >= 20 && Number(k) <= 29 || Number(k) >= 60 && Number(k) <= 63).map(([, v]) => v.join("")).join(" ").trim();
  const unvan = [...(alanlar.get("32") ?? []), ...(alanlar.get("33") ?? [])].join("").trim();
  return { aciklama: aciklama || tek.replace(/\?\d{2}/g, " ").trim(), ...(unvan ? { karsiUnvan: unvan } : {}) };
}

export function mt940Oku(buffer: Buffer): StandartEkstre {
  const metin = metneCevir(buffer);
  const uyarilar: string[] = [];
  const hesaplar: StandartEkstre["hesaplar"] = [];
  const tumSatirlar: Omit<EkstreSatiri, "satirOzeti">[] = [];
  let ilkAcilis: number | null = null;
  let sonKapanis: number | null = null;

  // Dosya birden çok ekstre (her biri :20: ile başlar) taşıyabilir.
  let hesap = "";
  let doviz: string | null = null;
  let acilis: number | null = null;
  let satirlar: Omit<EkstreSatiri, "satirOzeti">[] = [];
  let etiketNo = 0;
  const bitir = (kapanis: number | null) => {
    yuruyenBakiye(satirlar, acilis);
    kapanisDenetle(satirlar, acilis, kapanis, `${++etiketNo}. ekstre (${hesap || "hesap?"})`, uyarilar);
    tumSatirlar.push(...satirlar);
    if (ilkAcilis === null) ilkAcilis = acilis;
    sonKapanis = kapanis ?? sonKapanis;
    satirlar = [];
  };

  for (const { etiket, deger } of etiketler(metin)) {
    if (etiket === "25") {
      hesap = (IBAN.exec(deger.replace(/\s/g, ""))?.[0] ?? deger.trim()).slice(0, 64);
      if (!hesaplar.some((h) => h.hesap === hesap)) hesaplar.push({ hesap, dovizCinsi: null });
    } else if (etiket === "60F" || etiket === "60M") {
      const b = mtBakiye(deger);
      acilis = b?.tutar ?? null;
      doviz = b?.doviz ?? doviz;
      const kayit = hesaplar.find((h) => h.hesap === hesap);
      if (kayit && doviz) kayit.dovizCinsi = doviz === "TRL" ? "TRY" : doviz;
    } else if (etiket === "61") {
      const m = SATIR_61.exec(deger);
      if (!m) { uyarilar.push(`Okunamayan :61: satırı atlandı: ${deger.split("\n")[0].slice(0, 60)}`); continue; }
      const isaret = m[3] === "C" || m[3] === "RD" ? 1 : -1;
      const musteriRef = m[7]?.trim();
      const bankaRef = m[8]?.trim();
      tumSatirlarEkle(satirlar, {
        tarih: mtTarih(m[1]),
        tutar: isaret * mtTutar(m[5]),
        aciklama: (m[9] ?? "").replace(/\s*\n\s*/g, " ").trim(),
        dekontNo: (bankaRef || (musteriRef && musteriRef !== "NONREF" ? musteriRef : "")) || undefined,
      });
    } else if (etiket === "86") {
      const son = satirlar.at(-1);
      if (!son) continue;
      const { aciklama, karsiUnvan } = mt86(deger);
      son.aciklama = [aciklama, son.aciklama].filter(Boolean).join(" ").slice(0, 500);
      const iban = IBAN.exec(deger.replace(/\s/g, ""))?.[0];
      if (iban && iban !== hesap) son.karsiIban = iban;
      if (karsiUnvan) son.karsiUnvan = karsiUnvan.slice(0, 255);
    } else if (etiket === "62F" || etiket === "62M") {
      bitir(mtBakiye(deger)?.tutar ?? null);
    }
  }
  if (satirlar.length) bitir(null);
  for (const s of tumSatirlar) if (!s.aciklama) s.aciklama = "Banka hareketi";
  if (!tumSatirlar.length) throw new StandartEkstreHatasi("MT940 dosyasında hareket (:61:) bulunamadı");
  return { bicim: "mt940", hesaplar, satirlar: ozetle(tumSatirlar), acilis: ilkAcilis, kapanis: sonKapanis, uyarilar };
}

function tumSatirlarEkle(satirlar: Omit<EkstreSatiri, "satirOzeti">[], s: Omit<EkstreSatiri, "satirOzeti">) {
  if (s.tutar !== 0) satirlar.push(s);
}

/* ─── camt.053 / camt.052 ─────────────────────────────────────────────── */

const dizi = <T>(v: T | T[] | undefined | null): T[] => (v == null ? [] : Array.isArray(v) ? v : [v]);
const metinDeger = (v: unknown): string => (v == null ? "" : typeof v === "object" ? String((v as Record<string, unknown>)["#text"] ?? "") : String(v)).trim();
const sayiDeger = (v: unknown) => Number(metinDeger(v));

/** Bakiye kodu: OPBD açılış (yoksa PRCD önceki kapanış), CLBD kapanış (camt.052'de ITBD gün içi). */
function camtBakiye(bakiyeler: Record<string, unknown>[], kodlar: string[]): number | null {
  for (const kod of kodlar) {
    const b = bakiyeler.find((x) => metinDeger((x.Tp as any)?.CdOrPrtry?.Cd) === kod);
    if (b) return (metinDeger(b.CdtDbtInd) === "DBIT" ? -1 : 1) * sayiDeger(b.Amt);
  }
  return null;
}

export function camtOku(buffer: Buffer, bicim: "camt053" | "camt052"): StandartEkstre {
  const ayristirici = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    removeNSPrefix: true,
    // Harici varlık yok; yalnız XML'in beş temel varlığı çözülür.
    processEntities: true,
    htmlEntities: false,
    parseTagValue: false,
    isArray: (ad) => ["Stmt", "Rpt", "Ntry", "Bal", "TxDtls", "Ustrd", "NtryDtls"].includes(ad),
  });
  let kok: any;
  try {
    kok = ayristirici.parse(metneCevir(buffer));
  } catch (hata) {
    throw new StandartEkstreHatasi(`XML okunamadı: ${hata instanceof Error ? hata.message : String(hata)}`);
  }
  const govde = bicim === "camt053" ? kok?.Document?.BkToCstmrStmt : kok?.Document?.BkToCstmrAcctRpt;
  const ekstreler: any[] = dizi(bicim === "camt053" ? govde?.Stmt : govde?.Rpt);
  if (!ekstreler.length) throw new StandartEkstreHatasi("camt dosyasında ekstre (Stmt/Rpt) bulunamadı");

  const uyarilar: string[] = [];
  const hesaplar: StandartEkstre["hesaplar"] = [];
  const tumSatirlar: Omit<EkstreSatiri, "satirOzeti">[] = [];
  let ilkAcilis: number | null = null;
  let sonKapanis: number | null = null;

  ekstreler.forEach((st, i) => {
    const hesap = metinDeger(st.Acct?.Id?.IBAN) || metinDeger(st.Acct?.Id?.Othr?.Id);
    const doviz = metinDeger(st.Acct?.Ccy) || null;
    if (!hesaplar.some((h) => h.hesap === hesap)) hesaplar.push({ hesap, dovizCinsi: doviz === "TRL" ? "TRY" : doviz });
    const bakiyeler = dizi(st.Bal) as Record<string, unknown>[];
    const acilis = camtBakiye(bakiyeler, ["OPBD", "PRCD"]);
    const kapanis = camtBakiye(bakiyeler, bicim === "camt053" ? ["CLBD"] : ["CLBD", "ITBD"]);
    const satirlar: Omit<EkstreSatiri, "satirOzeti">[] = [];
    let bekleyen = 0;
    for (const n of dizi(st.Ntry) as any[]) {
      // Yalnız kesinleşmiş (BOOK) hareketler; bekleyen (PDNG) bakiyeye girmez.
      const durum = metinDeger(n.Sts?.Cd ?? n.Sts);
      if (durum && durum !== "BOOK") { bekleyen++; continue; }
      const giris = metinDeger(n.CdtDbtInd) === "CRDT";
      const iptal = metinDeger(n.RvslInd) === "true";
      const tutar = (giris !== iptal ? 1 : -1) * sayiDeger(n.Amt);
      const tarih = metinDeger(n.BookgDt?.Dt) || metinDeger(n.BookgDt?.DtTm).slice(0, 10) || metinDeger(n.ValDt?.Dt);
      const tx = dizi(n.NtryDtls).flatMap((d: any) => dizi(d.TxDtls))[0] ?? {};
      // Karşı taraf: girişte borçlu (gönderen), çıkışta alacaklı (alıcı). camt v8+ adı Pty altında taşır.
      const taraf = giris ? tx.RltdPties?.Dbtr : tx.RltdPties?.Cdtr;
      const tarafHesap = giris ? tx.RltdPties?.DbtrAcct : tx.RltdPties?.CdtrAcct;
      const endToEnd = metinDeger(tx.Refs?.EndToEndId);
      const aciklama = [
        dizi(tx.RmtInf?.Ustrd).map(metinDeger).join(" "),
        metinDeger(tx.AddtlTxInf),
        metinDeger(n.AddtlNtryInf),
      ].filter(Boolean).join(" ").trim();
      // EndToEndId (ödeme dosyasında talimat no) açıklamada yoksa eklenir: talimat eşleşmesi buna bakar.
      const ref = endToEnd && endToEnd !== "NOTPROVIDED" && !aciklama.includes(endToEnd) ? ` Ref: ${endToEnd}` : "";
      if (!tarih || !Number.isFinite(tutar) || tutar === 0) { uyarilar.push(`${i + 1}. ekstrede okunamayan hareket atlandı`); continue; }
      satirlar.push({
        tarih: new Date(`${tarih}T00:00:00.000Z`),
        tutar,
        aciklama: (`${aciklama || "Banka hareketi"}${ref}`).slice(0, 500),
        dekontNo: (metinDeger(n.AcctSvcrRef) || metinDeger(tx.Refs?.AcctSvcrRef) || endToEnd || "").slice(0, 100) || undefined,
        karsiIban: (metinDeger(tarafHesap?.Id?.IBAN) || "").replace(/\s/g, "").slice(0, 34) || undefined,
        karsiUnvan: (metinDeger(taraf?.Nm) || metinDeger(taraf?.Pty?.Nm)).slice(0, 255) || undefined,
      });
    }
    if (bekleyen) uyarilar.push(`${i + 1}. ekstrede ${bekleyen} bekleyen (kesinleşmemiş) hareket alınmadı`);
    yuruyenBakiye(satirlar, acilis);
    kapanisDenetle(satirlar, acilis, kapanis, `${i + 1}. ekstre (${hesap || "hesap?"})`, uyarilar);
    tumSatirlar.push(...satirlar);
    if (ilkAcilis === null) ilkAcilis = acilis;
    sonKapanis = kapanis ?? sonKapanis;
  });
  if (!tumSatirlar.length) throw new StandartEkstreHatasi("camt dosyasında kesinleşmiş hareket bulunamadı");
  return { bicim, hesaplar, satirlar: ozetle(tumSatirlar), acilis: ilkAcilis, kapanis: sonKapanis, uyarilar };
}

export function standartEkstreOku(buffer: Buffer): StandartEkstre | null {
  const bicim = standartBicimBul(buffer);
  if (!bicim) return null;
  return bicim === "mt940" ? mt940Oku(buffer) : camtOku(buffer, bicim);
}
