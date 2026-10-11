import * as ExcelJS from "exceljs";
import { type DisaAktarimBilgisi, hucreDovizi, toplamSatiri } from "./rapor-disa-aktarim";
import type { RaporKolon, RaporSatiri, RaporTanimi } from "./rapor-kayit";

/** Para hücresi biçimi; dövizli sütunda birim hücrenin yanında yazar (EUR ile TL karışmasın). */
const paraBicimi = (doviz?: string) => (doviz ? `#,##0.00 "${doviz === "TRY" ? "TL" : doviz}"` : "#,##0.00");
const argb = (renk?: string) => (renk && /^#[0-9a-f]{6}$/i.test(renk) ? renk.slice(1).toUpperCase() : "EA580C");

/**
 * Ortak rapor Excel yazıcısı (RPR-04/06): kolon tanımlarından başlık ve
 * sayı biçimlerini üretir; tüm raporlar aynı görsel dille dışa aktarılır.
 */
export async function raporExcelYaz(
  tanim: RaporTanimi,
  satirlar: RaporSatiri[],
  bilgi?: DisaAktarimBilgisi,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  raporSayfasiEkle(workbook, tanim, satirlar, bilgi);
  return (await workbook.xlsx.writeBuffer()) as unknown as Buffer;
}

/** Çok sayfalı dışa aktarımlar için (ör. MUHSGK hizmet listesi + özet): tek rapor sayfası ekler. */
export function raporSayfasiEkle(
  workbook: ExcelJS.Workbook,
  tanim: Pick<RaporTanimi, "ad" | "kolonlar">,
  satirlar: RaporSatiri[],
  bilgi?: DisaAktarimBilgisi,
): void {
  // Excel sayfa adında * ? : \ / [ ] yasak ve en çok 31 karakter ("Form BA / BS" gibi adlar için).
  const sayfa = workbook.addWorksheet(tanim.ad.replace(/[*?:\\/[\]]/g, "-").slice(0, 31));
  const kolonSayisi = Math.max(tanim.kolonlar.length, 1);
  const vurgu = argb(bilgi?.vurguRengi);

  // RPR-16: sayısal birleştirme 26'dan fazla sütunda da doğru; başlıkta firma adı.
  sayfa.mergeCells(1, 1, 1, kolonSayisi);
  const baslik = sayfa.getCell(1, 1);
  baslik.value = [bilgi?.firma, tanim.ad].filter(Boolean).join(" — ");
  baslik.font = { name: "Arial", size: 14, bold: true, color: { argb: "FFFFFF" } };
  baslik.fill = { type: "pattern", pattern: "solid", fgColor: { argb: vurgu } };
  baslik.alignment = { horizontal: "center", vertical: "middle" };
  sayfa.getRow(1).height = 32;

  const bilgiSatirlari = [...(bilgi?.bilgiler ?? []), `Rapor tarihi: ${new Date().toLocaleDateString("tr-TR")}`];
  bilgiSatirlari.forEach((yazi, i) => {
    const hucre = sayfa.getCell(2 + i, 1);
    hucre.value = yazi;
    hucre.font = { size: 9, color: { argb: "6B7280" } };
  });

  const baslikSatiri = sayfa.getRow(3 + bilgiSatirlari.length);
  baslikSatiri.values = tanim.kolonlar.map((k) => k.baslik);
  baslikSatiri.font = { bold: true, color: { argb: "FFFFFF" } };
  baslikSatiri.height = 22;
  for (let i = 1; i <= tanim.kolonlar.length; i++) {
    baslikSatiri.getCell(i).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "1F2937" } };
  }

  const yaz = (hucre: ExcelJS.Cell, k: RaporKolon, deger: RaporSatiri[string], doviz?: string) => {
    switch (k.tip) {
      case "para":
        hucre.value = deger === null || deger === undefined ? null : Number(deger);
        hucre.numFmt = paraBicimi(doviz);
        hucre.alignment = { horizontal: "right" };
        break;
      case "sayi":
        hucre.value = deger === null || deger === undefined ? null : Number(deger);
        hucre.numFmt = "#,##0.###";
        hucre.alignment = { horizontal: "right" };
        break;
      case "yuzde":
        hucre.value = deger === null || deger === undefined ? null : Number(deger) / 100;
        hucre.numFmt = "0.00%";
        hucre.alignment = { horizontal: "right" };
        break;
      case "tarih":
        hucre.value = typeof deger === "string" && deger ? new Date(deger) : null;
        hucre.numFmt = "dd.mm.yyyy";
        hucre.alignment = { horizontal: "center" };
        break;
      default:
        hucre.value = deger === null || deger === undefined ? "" : String(deger);
    }
  };

  let satirNo = baslikSatiri.number + 1;
  for (const satir of satirlar) {
    const excelSatiri = sayfa.getRow(satirNo);
    tanim.kolonlar.forEach((k, i) => yaz(excelSatiri.getCell(i + 1), k, satir[k.alan], hucreDovizi(k, satir)));
    satirNo++;
  }

  // RPR-16: ekrandaki toplam satırı (aynı kural); karışık dövizli sütun boş kalır.
  const toplamlar = toplamSatiri(tanim.kolonlar, satirlar);
  if (toplamlar) {
    const satir = sayfa.getRow(satirNo);
    tanim.kolonlar.forEach((k, i) => {
      const hucre = satir.getCell(i + 1);
      const t = toplamlar.get(k.alan);
      if (t && t !== "karisik") yaz(hucre, k, t.deger, t.doviz);
      else if (t === "karisik") { hucre.value = "—"; hucre.alignment = { horizontal: "right" }; }
      else if (i === 0) hucre.value = "Toplam";
    });
    satir.font = { bold: true };
    satir.eachCell({ includeEmpty: true }, (h) => { h.border = { top: { style: "thin" } }; });
  }

  sayfa.columns.forEach((kolon, i) => {
    let enGenis = 12;
    kolon.eachCell?.({ includeEmpty: false }, (hucre) => {
      // Başlık ve bilgi satırları ilk sütunu gereksiz genişletmesin.
      if (Number(hucre.row) <= bilgiSatirlari.length + 1) return;
      const uzunluk = hucre.value ? hucre.value.toString().length : 0;
      if (uzunluk > enGenis) enGenis = uzunluk;
    });
    kolon.width = Math.min(enGenis + (tanim.kolonlar[i]?.dovizAlani ? 7 : 3), 50);
  });
}
