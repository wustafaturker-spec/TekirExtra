import { tabloMetniGuvenli } from "@tekirextra/shared";
/**
 * ENT-07: toplu ödeme dosyası (saf). Bankaların internet şubesine yüklenen
 * toplu EFT/havale dosyası; biçim kaynak banka hesabının profilinden gelir:
 * - xlsx / csv: sütun sırası, başlıklar, ayraç, ondalık ve tarih biçimi ayarlanır.
 * - pain001: ISO 20022 pain.001.001.03 (kurumsal toplu ödeme standardı).
 */
import { z } from "zod";

export const ODEME_DOSYASI_ALANLARI = {
  sira: "Sıra",
  aliciUnvan: "Alıcı adı",
  aliciIban: "IBAN",
  tutar: "Tutar",
  doviz: "Döviz",
  aciklama: "Açıklama",
  referans: "Referans",
  odemeTarihi: "Ödeme tarihi",
  aliciVkn: "Alıcı VKN/TCKN",
  aliciBanka: "Alıcı banka",
} as const;
export type OdemeDosyasiAlani = keyof typeof ODEME_DOSYASI_ALANLARI;

export const odemeDosyaProfiliSemasi = z.object({
  bicim: z.enum(["xlsx", "csv", "pain001"]),
  sutunlar: z.array(z.object({
    alan: z.enum(Object.keys(ODEME_DOSYASI_ALANLARI) as [OdemeDosyasiAlani, ...OdemeDosyasiAlani[]]),
    baslik: z.string().trim().max(60),
  })).max(20).default([]),
  baslikSatiri: z.boolean().default(true),
  ayrac: z.enum([";", ",", "\t", "|"]).default(";"),
  ondalik: z.enum([",", "."]).default(","),
  tarihBicimi: z.enum(["GG.AA.YYYY", "YYYY-AA-GG", "GGAAYYYY", "YYYYAAGG"]).default("GG.AA.YYYY"),
  /** Açıklama sütununun en çok uzunluğu (EFT açıklaması bankaya göre sınırlıdır). */
  aciklamaUzunlugu: z.number().int().min(10).max(140).default(140),
  /** pain.001: kaynak bankanın BIC kodu (boşsa NOTPROVIDED). */
  bic: z.string().trim().max(11).optional().nullable(),
}).superRefine((p, ctx) => {
  if (p.bicim !== "pain001" && !p.sutunlar.length) ctx.addIssue({ code: "custom", path: ["sutunlar"], message: "Excel/CSV profili için en az bir sütun seçin" });
});
export type OdemeDosyaProfili = z.infer<typeof odemeDosyaProfiliSemasi>;

/** Profil tanımlanmamış hesapta kullanılan "Genel Excel". */
export const VARSAYILAN_PROFIL: OdemeDosyaProfili = {
  bicim: "xlsx",
  sutunlar: (["sira", "aliciUnvan", "aliciIban", "tutar", "doviz", "aciklama", "referans", "odemeTarihi"] as const).map((alan) => ({ alan, baslik: ODEME_DOSYASI_ALANLARI[alan] })),
  baslikSatiri: true, ayrac: ";", ondalik: ",", tarihBicimi: "GG.AA.YYYY", aciklamaUzunlugu: 140, bic: null,
};

export interface DosyaTalimati {
  no: string;
  aliciUnvan: string;
  aliciIban: string;
  tutar: string;
  dovizCinsi: string;
  aciklama: string;
  odemeTarihi: string;
  aliciVkn: string | null;
  aliciBanka: string | null;
}

export function tarihBicimle(gun: string, bicim: OdemeDosyaProfili["tarihBicimi"]): string {
  const [y, a, g] = gun.slice(0, 10).split("-");
  return { "GG.AA.YYYY": `${g}.${a}.${y}`, "YYYY-AA-GG": `${y}-${a}-${g}`, GGAAYYYY: `${g}${a}${y}`, YYYYAAGG: `${y}${a}${g}` }[bicim];
}

/** Açıklama: referans başa yazılır (ekstre eşleşmesi için), satır sonları atılır, sınırda kesilir. */
export function dosyaAciklamasi(t: DosyaTalimati, sinir: number): string {
  const metin = `${t.no} ${t.aciklama}`.replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").trim();
  return metin.slice(0, sinir);
}

/** Profil sütunlarına göre metin hücreleri (Excel ve CSV ortak). */
export function dosyaSatirlari(talimatlar: DosyaTalimati[], profil: OdemeDosyaProfili): string[][] {
  const tutarMetni = (t: string) => {
    const [tam, kesir = "00"] = Number(t).toFixed(2).split(".");
    return `${tam}${profil.ondalik}${kesir}`;
  };
  const satirlar = talimatlar.map((t, i) => profil.sutunlar.map(({ alan }) => {
    switch (alan) {
      case "sira": return String(i + 1);
      case "aliciUnvan": return t.aliciUnvan;
      case "aliciIban": return t.aliciIban.replace(/\s/g, "").toUpperCase();
      case "tutar": return tutarMetni(t.tutar);
      case "doviz": return t.dovizCinsi === "TRY" ? "TL" : t.dovizCinsi;
      case "aciklama": return dosyaAciklamasi(t, profil.aciklamaUzunlugu);
      case "referans": return t.no;
      case "odemeTarihi": return tarihBicimle(t.odemeTarihi, profil.tarihBicimi);
      case "aliciVkn": return t.aliciVkn ?? "";
      case "aliciBanka": return t.aliciBanka ?? "";
    }
  }));
  return profil.baslikSatiri ? [profil.sutunlar.map((s) => s.baslik || ODEME_DOSYASI_ALANLARI[s.alan]), ...satirlar] : satirlar;
}

export function csvUret(talimatlar: DosyaTalimati[], profil: OdemeDosyaProfili): string {
  // SEC-09: dosya Excel'de de açılır; alıcı ünvanı/açıklama formül olarak çalışmasın.
  const kacis = (ham: string) => { const h = tabloMetniGuvenli(ham); return h.includes(profil.ayrac) || h.includes('"') ? `"${h.replace(/"/g, '""')}"` : h; };
  return dosyaSatirlari(talimatlar, profil).map((s) => s.map(kacis).join(profil.ayrac)).join("\r\n") + "\r\n";
}

const xml = (deger: string) => deger.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
/** ISO 20022 metin alanları Latin karakter seti ister; Türkçe harfler sadeleştirilir. */
export const latinlestir = (m: string) => m
  .replace(/[çÇ]/g, (c) => (c === "ç" ? "c" : "C")).replace(/[ğĞ]/g, (c) => (c === "ğ" ? "g" : "G"))
  .replace(/[ıİ]/g, (c) => (c === "ı" ? "i" : "I")).replace(/[öÖ]/g, (c) => (c === "ö" ? "o" : "O"))
  .replace(/[şŞ]/g, (c) => (c === "ş" ? "s" : "S")).replace(/[üÜ]/g, (c) => (c === "ü" ? "u" : "U"))
  .replace(/[^A-Za-z0-9/\-?:().,'+ ]/g, " ").replace(/\s{2,}/g, " ").trim();

/**
 * pain.001.001.03: talimatlar ödeme tarihine göre PmtInf bloklarına ayrılır;
 * EndToEndId talimat numarasıdır (banka ekstresinde geri gelir).
 */
export function pain001Uret(g: {
  paketNo: string;
  olusturma: Date;
  firmaUnvan: string;
  firmaVkn: string | null;
  borcluIban: string;
  bic: string | null | undefined;
  talimatlar: DosyaTalimati[];
}): string {
  const tutar = (t: string) => Number(t).toFixed(2);
  const toplam = (liste: DosyaTalimati[]) => liste.reduce((s, t) => s + Math.round(Number(t.tutar) * 100), 0) / 100;
  const tarihler = [...new Set(g.talimatlar.map((t) => t.odemeTarihi.slice(0, 10)))].sort();
  const ad = (m: string) => xml(latinlestir(m).slice(0, 70));
  const banka = g.bic ? `<FinInstnId><BIC>${xml(g.bic.toUpperCase())}</BIC></FinInstnId>` : "<FinInstnId><Othr><Id>NOTPROVIDED</Id></Othr></FinInstnId>";
  const bloklar = tarihler.map((tarih, i) => {
    const liste = g.talimatlar.filter((t) => t.odemeTarihi.slice(0, 10) === tarih);
    return `
    <PmtInf>
      <PmtInfId>${xml(`${g.paketNo}-${i + 1}`)}</PmtInfId>
      <PmtMtd>TRF</PmtMtd>
      <BtchBookg>false</BtchBookg>
      <NbOfTxs>${liste.length}</NbOfTxs>
      <CtrlSum>${toplam(liste).toFixed(2)}</CtrlSum>
      <ReqdExctnDt>${tarih}</ReqdExctnDt>
      <Dbtr><Nm>${ad(g.firmaUnvan)}</Nm></Dbtr>
      <DbtrAcct><Id><IBAN>${xml(g.borcluIban.replace(/\s/g, "").toUpperCase())}</IBAN></Id></DbtrAcct>
      <DbtrAgt>${banka}</DbtrAgt>
      <ChrgBr>SLEV</ChrgBr>${liste.map((t) => `
      <CdtTrfTxInf>
        <PmtId><EndToEndId>${xml(t.no)}</EndToEndId></PmtId>
        <Amt><InstdAmt Ccy="${xml(t.dovizCinsi)}">${tutar(t.tutar)}</InstdAmt></Amt>
        <Cdtr><Nm>${ad(t.aliciUnvan)}</Nm></Cdtr>
        <CdtrAcct><Id><IBAN>${xml(t.aliciIban.replace(/\s/g, "").toUpperCase())}</IBAN></Id></CdtrAcct>
        <RmtInf><Ustrd>${xml(latinlestir(dosyaAciklamasi(t, 140)))}</Ustrd></RmtInf>
      </CdtTrfTxInf>`).join("")}
    </PmtInf>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.03" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <CstmrCdtTrfInitn>
    <GrpHdr>
      <MsgId>${xml(g.paketNo)}</MsgId>
      <CreDtTm>${g.olusturma.toISOString().slice(0, 19)}</CreDtTm>
      <NbOfTxs>${g.talimatlar.length}</NbOfTxs>
      <CtrlSum>${toplam(g.talimatlar).toFixed(2)}</CtrlSum>
      <InitgPty><Nm>${ad(g.firmaUnvan)}</Nm>${g.firmaVkn ? `<Id><OrgId><Othr><Id>${xml(g.firmaVkn)}</Id><SchmeNm><Cd>TXID</Cd></SchmeNm></Othr></OrgId></Id>` : ""}</InitgPty>
    </GrpHdr>${bloklar}
  </CstmrCdtTrfInitn>
</Document>
`;
}
