import { kacis, sayfaSablonu, tarihBicim } from "../core/pdf/pdf-sablon";

/**
 * EBLG-93: giden e-İrsaliye serisinde boşta kalan numaralar. Numaralar
 * kesintisiz olmalıdır (213 VUK, 509 Sıra No'lu Tebliğ); boşluk için GİB'e
 * dilekçe verilir ve numara atlama tespit tutanağı düzenlenir (mali müşavir,
 * 2026-09-24).
 */
export type BoslukNedeni = "atlanmis" | "iptal_gonderilmedi";

export interface NumaraBosluklari {
  seriOneki: string;
  yil: number;
  /** İncelenen aralık: yılın ilk kullanılan numarasından sayacın son değerine. */
  ilk: string | null;
  son: string | null;
  bosluklar: { no: string; neden: BoslukNedeni; belgeId?: string; tarih?: string }[];
  /** Numara almış ama GİB'e ulaşmamış, hâlâ açık belgeler: gönderilmezse boşluk olur. */
  bekleyenler: { no: string; belgeId: string; tarih: string; durum: string }[];
}

type SeriBelgesi = { id: string; no: string; durum: string; tarih: Date; eirsaliye: { durum: string } | null };

/** GİB numarası: 3 harf önek + 4 hane yıl + 9 hane sıra. */
const numara = (onek: string, yil: number, sira: number) => `${onek}${yil}${String(sira).padStart(9, "0")}`;

export function numaraBosluklariniBul(girdi: { seriOneki: string; yil: number; sayacSonSira: number | null; belgeler: SeriBelgesi[] }): NumaraBosluklari {
  const { seriOneki, yil } = girdi;
  const onEk = `${seriOneki}${yil}`;
  const seridekiler = girdi.belgeler.filter((b) => b.no.length === 16 && b.no.startsWith(onEk));
  const siraOf = (no: string) => Number(no.slice(onEk.length));
  const kullanilan = new Map(seridekiler.map((b) => [siraOf(b.no), b]));
  const siralar = [...kullanilan.keys()];
  if (siralar.length === 0) return { seriOneki, yil, ilk: null, son: null, bosluklar: [], bekleyenler: [] };

  // Aralık yılın ilk kullanılan numarasından başlar: seri devralınmış ya da
  // sayaç ileri alınmış olabilir (dev'de 800000), öncesi bizim serimiz değildir.
  const ilk = Math.min(...siralar);
  const son = Math.max(girdi.sayacSonSira ?? 0, ...siralar);
  const gibeUlasmadi = (b: SeriBelgesi) => !b.eirsaliye || b.eirsaliye.durum === "hata";
  const bosluklar: NumaraBosluklari["bosluklar"] = [];
  const bekleyenler: NumaraBosluklari["bekleyenler"] = [];
  for (let sira = ilk; sira <= son; sira++) {
    const b = kullanilan.get(sira);
    const tarih = b?.tarih.toISOString().slice(0, 10);
    if (!b) bosluklar.push({ no: numara(seriOneki, yil, sira), neden: "atlanmis" });
    else if (!gibeUlasmadi(b)) continue;
    else if (b.durum === "iptal") bosluklar.push({ no: b.no, neden: "iptal_gonderilmedi", belgeId: b.id, tarih });
    else bekleyenler.push({ no: b.no, belgeId: b.id, tarih: tarih!, durum: b.eirsaliye ? "hata" : "gonderilmedi" });
  }
  return { seriOneki, yil, ilk: numara(seriOneki, yil, ilk), son: numara(seriOneki, yil, son), bosluklar, bekleyenler };
}

const NEDEN_ACIKLAMASI: Record<BoslukNedeni, string> = {
  atlanmis: "Numara serimizde üretilmiş ancak hiçbir belgede kullanılmamıştır.",
  iptal_gonderilmedi: "Belge GİB'e iletilmeden iptal edilmiş, sevkiyatta kullanılmamıştır.",
};

/**
 * GİB'e verilecek dilekçenin ve iç tutanağın taslağı; tek PDF, iki sayfa.
 * Taslaktır: firma ve mali müşavir kontrol edip imzalar.
 */
export function numaraBoslukTaslakHtml(veri: NumaraBosluklari, firma: { unvan: string; vkn: string; vergiDairesi?: string | null; adres?: string | null; ilce?: string | null; il?: string | null }, bugun: Date): string {
  const liste = veri.bosluklar
    .map((b) => `<tr><td>${kacis(b.no)}</td><td>${b.tarih ? tarihBicim(b.tarih) : "—"}</td><td>${kacis(NEDEN_ACIKLAMASI[b.neden])}</td></tr>`)
    .join("");
  const tablo = `<table style="width:100%;border-collapse:collapse;font-size:9pt" border="1" cellpadding="4">
<thead><tr><th>Belge No</th><th>Belge Tarihi</th><th>Açıklama</th></tr></thead><tbody>${liste}</tbody></table>`;
  // Kartta "DAVUTPAŞA VD" gibi ekiyle yazılmış daireye ek yeniden eklenmez.
  const daire = firma.vergiDairesi?.trim();
  const daireMetni = daire ? (/\b(V\.?D\.?|VERG[İI] DA[İI]RES[İI])$/iu.test(daire) ? daire : `${daire} V.D.`) : "";
  const firmaSatiri = `${kacis(firma.unvan)}<br>VKN: ${kacis(firma.vkn)}${daireMetni ? ` — ${kacis(daireMetni)}` : ""}<br>${kacis([firma.adres, firma.ilce, firma.il].filter(Boolean).join(" "))}`;
  const tarih = tarihBicim(bugun.toISOString().slice(0, 10));
  const icerik = `
<p style="text-align:right">${tarih}</p>
<p><strong>GELİR İDARESİ BAŞKANLIĞINA</strong></p>
<p>Firmamız adına GİB e-İrsaliye uygulaması kapsamında kullanılan <strong>${kacis(veri.seriOneki)}</strong> serisinde ${veri.yil} yılına ait aşağıdaki belge numaraları teknik/sistemsel nedenlerle atlanmış ve boşta kalmıştır. İlgili numaralar herhangi bir sevkiyatta kullanılmamış, alıcıya herhangi bir belge düzenlenmemiştir.</p>
${tablo}
<p>Bilgilerinize arz ederiz.</p>
<p style="margin-top:28px">${firmaSatiri}<br><br>Yetkili adı soyadı / imza / kaşe</p>
<div style="page-break-before:always"></div>
<p><strong>NUMARA ATLAMA TESPİT TUTANAĞI</strong></p>
<p>${kacis(firma.unvan)} (VKN ${kacis(firma.vkn)}) tarafından kullanılan <strong>${kacis(veri.seriOneki)}</strong> e-İrsaliye serisinin ${veri.yil} yılı kayıtları ${tarih} tarihinde incelenmiş; aşağıdaki numaraların atlandığı ve hiçbir sevkiyatta kullanılmadığı tespit edilmiştir. İşbu tutanak olası bir vergi incelemesinde ibraz edilmek üzere düzenlenmiştir.</p>
${tablo}
<table style="width:100%;margin-top:36px;font-size:9pt"><tr>
<td style="width:50%">Şirket yetkilisi<br><br>Ad soyad / imza</td>
<td style="width:50%">Mali müşavir<br><br>Ad soyad / imza / mühür</td>
</tr></table>
<p style="margin-top:14px;color:#6b7280;font-size:8pt">Bu belge TekirExtra tarafından taslak olarak üretilmiştir; göndermeden ve imzalamadan önce mali müşavirinizle kontrol edin.</p>`;
  return sayfaSablonu({ baslik: "e-İRSALİYE NUMARA ATLAMA", altBaslik: `${firma.unvan} — ${veri.seriOneki} ${veri.yil}`, icerik });
}
