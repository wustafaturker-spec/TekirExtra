/**
 * CNL-09 kuralları (saf işlevler). Asistan emin olmadığı yerde tahmin yürütmez, sorar; soru metni
 * kayıttan belirlenimci kurulur (model kullanılmaz). Seçenek kodu yanıtta işlemi belirler.
 */

export type SoruTuru = "banka_satiri" | "eposta_gonderen" | "taslak_kosul";
export interface Secenek { kod: string; etiket: string }

/** CNL-09: bir kişiye aynı anda en çok bu kadar açık soru gider (Telegram). */
export const ACIK_SORU_SINIRI = 3;
/** CNL-09: bu süreden eski soru Telegram'a gönderilmez; panelde "Sorular" kutusunda kalır. */
export const TELEGRAM_SORU_OMRU_MS = 3 * 24 * 60 * 60 * 1000;
/** Tek taramada firma başına en çok bu kadar yeni soru açılır (seli önler). */
export const TARAMA_SORU_SINIRI = 5;

export const PANEL_SECENEGI: Secenek = { kod: "panel", etiket: "Panelde bakacağım" };

const tl = (n: number | string, doviz = "TRY") => `${Number(n).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${doviz === "TRY" ? "TL" : doviz}`;
const tarihTr = (g: string) => `${g.slice(8, 10)}.${g.slice(5, 7)}.${g.slice(0, 4)}`;
const kisalt = (m: string, n: number) => (m.length > n ? `${m.slice(0, n - 1)}…` : m);

/** Maaş/ücret ödemesi gibi görünen banka satırı Telegram'da sorulmaz (CNL-05). */
export function maasSatiriMi(aciklama: string, karsiUnvan: string | null): boolean {
  return /maa[sş]|ücret|ucret|bordro|avans|prim ödeme|sgk|ikramiye/i.test(`${aciklama} ${karsiUnvan ?? ""}`);
}

export function bankaSorusu(s: { tarih: string; tutar: string; dovizCinsi: string; aciklama: string; karsiUnvan: string | null; onerilenCari: { id: string; unvan: string } | null }): { soru: string; secenekler: Secenek[] } {
  const giris = !s.tutar.startsWith("-");
  const hareket = `${tarihTr(s.tarih)} tarihli ${tl(s.tutar.replace(/^-/, ""), s.dovizCinsi)} ${giris ? "giriş" : "çıkış"}`;
  const aciklama = kisalt(`${s.karsiUnvan ? `${s.karsiUnvan} — ` : ""}${s.aciklama}`.replace(/\s+/g, " ").trim(), 160);
  if (s.onerilenCari) {
    return {
      soru: `Bankada eşleşmeyen bir hareket var: ${hareket}, “${aciklama}”. Bu hareket ${s.onerilenCari.unvan} carisine mi ait?\nBaşka bir cariyse unvanını yanıt olarak yazabilirsiniz.`,
      secenekler: [{ kod: "evet", etiket: `Evet, ${kisalt(s.onerilenCari.unvan, 40)}` }, { kod: "hayir", etiket: "Hayır, bu cari değil" }, PANEL_SECENEGI],
    };
  }
  return {
    soru: `Bankada eşleşmeyen bir hareket var: ${hareket}, “${aciklama}”. Hangi cariye ait olduğunu bulamadım.\nCarinin unvanını ya da kodunu yanıt olarak yazın.`,
    secenekler: [PANEL_SECENEGI],
  };
}

export function epostaSorusu(e: { gonderenAdi: string | null; gonderenEposta: string; konu: string | null; adaylar: Array<{ cariId: string; unvan: string }> }): { soru: string; secenekler: Secenek[] } {
  const kim = e.gonderenAdi ? `${e.gonderenAdi} <${e.gonderenEposta}>` : e.gonderenEposta;
  const konu = e.konu ? `, konu “${kisalt(e.konu.replace(/\s+/g, " "), 80)}”` : "";
  return {
    soru: `Tanımadığım bir gönderenden e-posta geldi: ${kim}${konu}. Hangi cariye ait?\nListede yoksa carinin unvanını yanıt olarak yazabilirsiniz.`,
    secenekler: [
      ...e.adaylar.slice(0, 3).map((a, i) => ({ kod: `cari${i}`, etiket: kisalt(a.unvan, 40) })),
      { kod: "ilgisiz", etiket: "Cari değil / ilgisiz" },
      PANEL_SECENEGI,
    ],
  };
}

export interface TaslakSapmasi { alan: "vade" | "iskonto"; taslak: number; olagan: number }

const ortanca = (l: number[]) => { const s = [...l].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

/**
 * CNL-09: taslağın vadesi ya da iskontosu bu carideki alışkanlığın dışında mı? Karşılaştırma son
 * kesin satış faturalarıyla yapılır (en az 3); geçmiş yoksa vade için carinin varsayılan vadesi.
 * Vade: farkı en az 15 gün ve olağanın yarısı. İskonto: olağanın en yükseğini 5 puan aşan.
 */
export function taslakSapmasi(taslak: { vadeGun: number | null; iskontoYuzde: number }, gecmis: Array<{ vadeGun: number | null; iskontoYuzde: number }>, varsayilanVadeGun: number | null): TaslakSapmasi | null {
  const vadeler = gecmis.map((g) => g.vadeGun).filter((v): v is number => v !== null);
  const olaganVade = vadeler.length >= 3 ? ortanca(vadeler) : varsayilanVadeGun;
  if (taslak.vadeGun !== null && olaganVade !== null) {
    const fark = Math.abs(taslak.vadeGun - olaganVade);
    if (fark >= Math.max(15, olaganVade * 0.5)) return { alan: "vade", taslak: taslak.vadeGun, olagan: Math.round(olaganVade) };
  }
  if (gecmis.length >= 3 && taslak.iskontoYuzde > 0) {
    const enYuksek = Math.max(...gecmis.map((g) => g.iskontoYuzde));
    if (taslak.iskontoYuzde > enYuksek + 5) return { alan: "iskonto", taslak: Math.round(taslak.iskontoYuzde * 100) / 100, olagan: Math.round(enYuksek * 100) / 100 };
  }
  return null;
}

export function taslakSorusu(t: { cariUnvan: string; tutar: string; dovizCinsi: string; sapma: TaslakSapmasi }): { soru: string; secenekler: Secenek[] } {
  const { sapma } = t;
  const fatura = `${t.cariUnvan} için ${tl(t.tutar, t.dovizCinsi)} tutarındaki satış taslağında`;
  if (sapma.alan === "vade") {
    return {
      soru: `${fatura} vade ${sapma.taslak} gün; bu caride alışılmış vade ${sapma.olagan} gün. Doğru mu?`,
      secenekler: [{ kod: "dogru", etiket: `Doğru, ${sapma.taslak} gün kalsın` }, { kod: "olagan", etiket: `${sapma.olagan} güne çek` }, PANEL_SECENEGI],
    };
  }
  return {
    soru: `${fatura} iskonto %${sapma.taslak}; bu caride şimdiye dek en çok %${sapma.olagan} iskonto yapılmış. Doğru mu?`,
    secenekler: [{ kod: "dogru", etiket: "Doğru, böyle kalsın" }, PANEL_SECENEGI],
  };
}

/** Telegram düğme verisi en çok 64 bayt: "s:<uuid>:<kod>". */
export const dugmeVerisi = (soruId: string, kod: string) => `s:${soruId}:${kod}`;
export function dugmeCoz(veri: string): { soruId: string; kod: string } | null {
  const m = /^s:([0-9a-f-]{36}):([a-z0-9_]{1,16})$/.exec(veri);
  return m ? { soruId: m[1], kod: m[2] } : null;
}

export const gunFarki = (bas: string, son: string) => Math.round((Date.parse(son) - Date.parse(bas)) / 86_400_000);
