import { createHash } from "node:crypto";
import ExcelJS from "exceljs";
import type { AktarimAlani, AktarimProfili } from "@tekirextra/shared";
import { kacis, paraBicim, tarihBicim } from "../../core/pdf/pdf-sablon";
import type { Fis } from "./fis-uretici";

/** MUH-06: fiş satırları düz tabloya açılır; fiş numarası dönem içinde sıralıdır. */
export interface DuzSatir {
  fisNo: number;
  fisTarihi: string;
  fisTuru: string;
  fisAciklama: string;
  satirNo: number;
  hesapKodu: string;
  aciklama: string;
  borc: number;
  alacak: number;
  belgeNo: string;
  belgeTarihi: string;
  dovizCinsi: string;
  dovizTutar: number | null;
  kur: number | null;
  kaynak: string;
}

const FIS_TURU_ADI = { mahsup: "Mahsup", tahsil: "Tahsil", tediye: "Tediye" } as const;

export function duzSatirlar(fisler: Fis[]): DuzSatir[] {
  return fisler.flatMap((f, i) =>
    f.satirlar.map((s, j) => ({
      fisNo: i + 1,
      fisTarihi: f.tarih,
      fisTuru: FIS_TURU_ADI[f.tur],
      fisAciklama: f.aciklama.slice(0, 250),
      satirNo: j + 1,
      hesapKodu: s.hesapKodu,
      aciklama: s.aciklama.slice(0, 250),
      borc: Number(s.borc.toFixed(2)),
      alacak: Number(s.alacak.toFixed(2)),
      belgeNo: f.belgeNo ?? "",
      belgeTarihi: f.tarih,
      dovizCinsi: s.doviz?.cins ?? "",
      dovizTutar: s.doviz ? Number(s.doviz.tutar.toFixed(2)) : null,
      kur: s.doviz ? Number(s.doviz.kur.toFixed(6)) : null,
      kaynak: f.kaynak.etiket,
    })),
  );
}

/**
 * MUH-07: aktarımın parmak izi. Fiş numaraları ve açıklamalar dışarıda;
 * yalnız tarih, hesap ve tutar değişimi "aktarımdan sonra değişti" sayılır.
 */
export function parmakIzi(fisler: Fis[]): string {
  const ozet = fisler.map((f) => [f.tarih, f.kaynak.tur, f.kaynak.id, f.satirlar.map((s) => [s.hesapKodu, s.borc.toFixed(2), s.alacak.toFixed(2)])]);
  return createHash("sha256").update(JSON.stringify(ozet)).digest("hex");
}

const tarihMetni = (iso: string, bicim: AktarimProfili["tarihBicimi"]) => (bicim === "GG.AA.YYYY" ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : iso);
const TARIH_ALANLARI: AktarimAlani[] = ["fisTarihi", "belgeTarihi"];
const SAYI_ALANLARI: AktarimAlani[] = ["borc", "alacak", "dovizTutar", "kur"];

export async function excelDosyasi(satirlar: DuzSatir[], profil: AktarimProfili): Promise<Buffer> {
  const kitap = new ExcelJS.Workbook();
  const sayfa = kitap.addWorksheet("Fişler");
  sayfa.columns = profil.sutunlar.map((s) => ({ header: s.baslik, key: s.alan, width: s.alan.includes("ciklama") ? 40 : 14 }));
  for (const r of satirlar) {
    sayfa.addRow(Object.fromEntries(profil.sutunlar.map((s) => {
      const deger = r[s.alan];
      if (TARIH_ALANLARI.includes(s.alan)) return [s.alan, tarihMetni(String(deger), profil.tarihBicimi)];
      return [s.alan, deger ?? ""];
    })));
  }
  profil.sutunlar.forEach((s, i) => {
    if (SAYI_ALANLARI.includes(s.alan)) sayfa.getColumn(i + 1).numFmt = s.alan === "kur" ? "0.000000" : "#,##0.00";
  });
  sayfa.getRow(1).font = { bold: true };
  sayfa.views = [{ state: "frozen", ySplit: 1 }];
  return Buffer.from(await kitap.xlsx.writeBuffer());
}

export function csvDosyasi(satirlar: DuzSatir[], profil: AktarimProfili): Buffer {
  const ayirici = profil.csvAyirici;
  const hucre = (deger: unknown) => {
    let metin = deger === null || deger === undefined ? "" : String(deger);
    // Tablo uygulamasında formül olarak çalışmasın (dışarıdan gelen metin: cari unvanı, açıklama).
    if (/^[\t\r\n ]*[=+\-@]/.test(metin) && !/^-?\d/.test(metin)) metin = `'${metin}`;
    return `"${metin.replace(/"/g, '""')}"`;
  };
  const deger = (r: DuzSatir, alan: AktarimAlani) => {
    const v = r[alan];
    if (TARIH_ALANLARI.includes(alan)) return tarihMetni(String(v), profil.tarihBicimi);
    if (SAYI_ALANLARI.includes(alan) && typeof v === "number") {
      const metin = alan === "kur" ? v.toFixed(6) : v.toFixed(2);
      return profil.ondalik === "," ? metin.replace(".", ",") : metin;
    }
    return v;
  };
  const basliklar = profil.sutunlar.map((s) => hucre(s.baslik)).join(ayirici);
  const govde = satirlar.map((r) => profil.sutunlar.map((s) => hucre(deger(r, s.alan))).join(ayirici));
  return Buffer.from(`﻿${[basliklar, ...govde].join("\r\n")}\r\n`, "utf8");
}

/** MUH-06: yazdırılabilir yevmiye dökümü (yatay A4). */
export function yevmiyeHtml(fisler: Fis[], firma: { unvan: string; vkn: string }, baslangic: string, bitis: string): string {
  let borcToplami = 0;
  let alacakToplami = 0;
  const govde = fisler.map((f, i) => {
    const satirlar = f.satirlar.map((s) => {
      borcToplami += Number(s.borc);
      alacakToplami += Number(s.alacak);
      return `<tr><td class="kod">${kacis(s.hesapKodu || "—")}</td><td>${kacis(s.aciklama)}${s.doviz ? ` <span class="dv">${kacis(paraBicim(s.doviz.tutar.toString()))} ${kacis(s.doviz.cins)} × ${kacis(s.doviz.kur.toString())}</span>` : ""}</td><td class="sag">${s.borc.isZero() ? "" : paraBicim(s.borc.toString())}</td><td class="sag">${s.alacak.isZero() ? "" : paraBicim(s.alacak.toString())}</td></tr>`;
    }).join("");
    return `<tbody class="fis"><tr class="fb"><td colspan="4"><strong>${i + 1}</strong> · ${kacis(tarihBicim(f.tarih))} · ${kacis(FIS_TURU_ADI[f.tur])} · ${kacis(f.aciklama)}${f.belgeNo ? ` · Belge ${kacis(f.belgeNo)}` : ""}</td></tr>${satirlar}</tbody>`;
  }).join("");
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: "DejaVu Sans", Arial, sans-serif; font-size: 7.4pt; color: #111827; padding: 4px; }
    h1 { font-size: 13pt; margin-bottom: 2px; } .alt { color: #4b5563; margin-bottom: 8px; }
    table { width: 100%; border-collapse: collapse; }
    th { text-align: left; border-bottom: 1.5px solid #111827; padding: 3px 4px; font-size: 7pt; text-transform: uppercase; color: #374151; }
    td { padding: 2px 4px; border-bottom: 1px solid #f1f5f9; vertical-align: top; }
    .fb td { background: #f8fafc; border-top: 1px solid #cbd5e1; padding-top: 4px; }
    .fis { page-break-inside: avoid; } .kod { font-family: monospace; width: 110px; } .sag { text-align: right; width: 95px; white-space: nowrap; }
    .dv { color: #6b7280; } .toplam td { border-top: 1.5px solid #111827; font-weight: bold; }
  </style></head><body>
    <h1>Yevmiye dökümü</h1>
    <div class="alt">${kacis(firma.unvan)} · VKN ${kacis(firma.vkn)} · ${kacis(tarihBicim(baslangic))} – ${kacis(tarihBicim(bitis))} · ${fisler.length} fiş</div>
    <table><thead><tr><th>Hesap</th><th>Açıklama</th><th class="sag">Borç</th><th class="sag">Alacak</th></tr></thead>
    ${govde}
    <tbody class="toplam"><tr><td colspan="2">Dönem toplamı</td><td class="sag">${paraBicim(borcToplami.toFixed(2))}</td><td class="sag">${paraBicim(alacakToplami.toFixed(2))}</td></tr></tbody></table>
  </body></html>`;
}
