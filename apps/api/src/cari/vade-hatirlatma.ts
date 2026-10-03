import { Prisma } from "@prisma/client";
import { ayarTanimiAl } from "../core/ayarlar/ayar-kayit";
import { kacis } from "../core/pdf/pdf-sablon";
import { iptalCiftiMi, iptalEdilmisFaturalar } from "../fatura/iptal-cifti";
import { acikKalemler } from "./yaslandirma";

/**
 * CARI-38 (P2-5, karar 2026-10-04): vadesi geçmiş alacak için hatırlatma ve
 * ihtar e-postası. Elle, seçili carilere toplu gönderilir; şablon Ayarlar >
 * Cari'den düzenlenir. Fatura listesi kartın "vadesi geçmiş" hesabıyla aynı
 * kuraldan gelir: döviz başına FIFO, iptal çiftleri düşülmüş. Gönderim CRM
 * etkileşimine yazılır; aynı cariye 7 gün içinde ikincisi uyarıyla atlanır.
 */
export type Kademe = "hatirlatma" | "ihtar";
export const KADEME_ADI: Record<Kademe, string> = { hatirlatma: "Vade hatırlatması", ihtar: "Ödeme ihtarı" };
export const SIKLIK_SINIRI_GUN = 7;
const GUN_MS = 86_400_000;

export const VARSAYILAN_SABLONLAR = {
  vadeHatirlatmaKonusu: "Vadesi geçmiş ödeme hatırlatması — {firma}",
  vadeHatirlatmaMetni:
    "Sayın {unvan},\n\nKayıtlarımıza göre {enEskiVade} tarihinden bu yana vadesi geçmiş {toplam} tutarında ödemeniz bulunmaktadır. Ayrıntısı aşağıdadır:\n\n{faturalar}\n\nÖdemenizi yaptıysanız bu iletiyi dikkate almayınız. Sorularınız için bize ulaşabilirsiniz. Güncel hesap ekstreniz ektedir.\n\nSaygılarımızla,\n{firma}",
  ihtarKonusu: "Ödeme ihtarı — {firma}",
  ihtarMetni:
    "Sayın {unvan},\n\n{enEskiVade} tarihinden bu yana vadesi geçmiş {toplam} tutarındaki borcunuz önceki hatırlatmalarımıza rağmen ödenmemiştir. Ayrıntısı aşağıdadır:\n\n{faturalar}\n\nBorcunuzun bu iletinin tarihinden itibaren 7 gün içinde ödenmesini rica eder, aksi hâlde yasal haklarımızı kullanacağımızı bildiririz. Güncel hesap ekstreniz ektedir.\n\n{firma}",
};

export interface VadesiGecmisKalem {
  belgeNo: string | null;
  aciklama: string | null;
  tarih: Date;
  vade: Date;
  gecikmeGun: number;
  dovizCinsi: string;
  acik: number;
}

/** Carilerin vadesi geçmiş açık alacak kalemleri (en eski vadeden). */
export async function vadesiGecmisKalemler(tx: Prisma.TransactionClient, cariIdler: string[], bugun = new Date()): Promise<Map<string, VadesiGecmisKalem[]>> {
  if (cariIdler.length === 0) return new Map();
  const hareketler = await tx.cariHareket.findMany({
    where: { cariId: { in: cariIdler } },
    select: { cariId: true, tip: true, dovizCinsi: true, tutar: true, vadeTarihi: true, tarih: true, aciklama: true, kaynakTur: true, kaynakRef: true },
  });
  const iptaller = await iptalEdilmisFaturalar(tx, hareketler);
  const gecerli = hareketler.filter((h) => !iptalCiftiMi(h, iptaller));
  const gruplar = new Map<string, (typeof gecerli[number] & { tutar: number })[]>();
  for (const h of gecerli) {
    const anahtar = `${h.cariId}|${h.dovizCinsi}`;
    gruplar.set(anahtar, [...(gruplar.get(anahtar) ?? []), { ...h, tutar: Number(h.tutar) } as typeof gecerli[number] & { tutar: number }]);
  }
  const sonuc = new Map<string, VadesiGecmisKalem[]>(cariIdler.map((id) => [id, []]));
  const acik: (VadesiGecmisKalem & { cariId: string; kaynakTur: string; kaynakRef: string | null })[] = [];
  for (const liste of gruplar.values()) {
    for (const k of acikKalemler(liste)) {
      const vade = k.vadeTarihi ?? k.tarih;
      const gecikmeGun = Math.floor((bugun.getTime() - vade.getTime()) / GUN_MS);
      if (gecikmeGun <= 0) continue;
      acik.push({ cariId: k.cariId, kaynakTur: k.kaynakTur, kaynakRef: k.kaynakRef, belgeNo: null, aciklama: k.aciklama, tarih: k.tarih, vade, gecikmeGun, dovizCinsi: k.dovizCinsi, acik: Math.round(k.acik * 100) / 100 });
    }
  }
  const faturaIdler = [...new Set(acik.filter((k) => k.kaynakTur === "fatura" && k.kaynakRef).map((k) => k.kaynakRef!))];
  const numaralar = new Map((faturaIdler.length ? await tx.fatura.findMany({ where: { id: { in: faturaIdler } }, select: { id: true, no: true } }) : []).map((f) => [f.id, f.no]));
  for (const k of acik.sort((a, b) => a.vade.getTime() - b.vade.getTime())) {
    const { cariId, kaynakTur, kaynakRef, ...kalem } = k;
    const faturaMi = kaynakTur === "fatura" && kaynakRef;
    const belgeNo = faturaMi ? numaralar.get(kaynakRef) ?? null : null;
    // Kesin ama e-Belge numarası henüz verilmemiş fatura: iç açıklama ("Fatura hareketi") müşteriye gitmesin.
    sonuc.get(cariId)!.push({ ...kalem, belgeNo, aciklama: faturaMi && !belgeNo ? "Fatura (numara henüz verilmedi)" : kalem.aciklama });
  }
  return sonuc;
}

/** Son hatırlatma/ihtar tarihi (CRM etkileşiminden). */
export async function sonHatirlatmalar(tx: Prisma.TransactionClient, cariIdler: string[]): Promise<Map<string, Date>> {
  if (cariIdler.length === 0) return new Map();
  const kayitlar = await tx.crmEtkilesim.groupBy({
    by: ["cariId"],
    where: { cariId: { in: cariIdler }, tip: "eposta", OR: Object.values(KADEME_ADI).map((ad) => ({ konu: { startsWith: ad } })) },
    _max: { tarih: true },
  });
  return new Map(kayitlar.filter((k) => k._max.tarih).map((k) => [k.cariId, k._max.tarih!]));
}

export const siklikEngeli = (son: Date | undefined, simdi = new Date()) =>
  son !== undefined && simdi.getTime() - son.getTime() < SIKLIK_SINIRI_GUN * GUN_MS;

export async function hatirlatmaSablonlari(tx: Prisma.TransactionClient, tenantId: string) {
  const kayit = await tx.modulAyar.findUnique({ where: { tenantId_modul: { tenantId, modul: "cari" } } });
  const a = { ...ayarTanimiAl("cari")?.varsayilanlar, ...((kayit?.ayarlar as Record<string, unknown>) ?? {}) };
  const metin = (alan: keyof typeof VARSAYILAN_SABLONLAR) => (typeof a[alan] === "string" && (a[alan] as string).trim() ? (a[alan] as string) : VARSAYILAN_SABLONLAR[alan]);
  return {
    hatirlatma: { konu: metin("vadeHatirlatmaKonusu"), metin: metin("vadeHatirlatmaMetni") },
    ihtar: { konu: metin("ihtarKonusu"), metin: metin("ihtarMetni") },
  };
}

const para = (n: number, doviz: string) => `${n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${doviz === "TRY" ? "TL" : doviz}`;
const gun = (t: Date) => t.toISOString().slice(0, 10).split("-").reverse().join(".");

export interface HatirlatmaIletisi { konu: string; metin: string; html: string; toplam: string }

/**
 * Şablonu doldurur. Alanlar: {unvan} {firma} {toplam} {enEskiVade}
 * {gecikmeGun} {faturaSayisi} {faturalar}; {faturalar} metinde yoksa sona eklenir.
 * Serbest not varsa tablodan sonra gelir.
 */
export function hatirlatmaIletisi(sablon: { konu: string; metin: string }, d: { unvan: string; firma: string; kalemler: VadesiGecmisKalem[]; not?: string | null }): HatirlatmaIletisi {
  const dovizToplam = new Map<string, number>();
  for (const k of d.kalemler) dovizToplam.set(k.dovizCinsi, Math.round(((dovizToplam.get(k.dovizCinsi) ?? 0) + k.acik) * 100) / 100);
  const toplam = [...dovizToplam].map(([doviz, t]) => para(t, doviz)).join(" + ");
  const enEski = d.kalemler.reduce<VadesiGecmisKalem | null>((e, k) => (!e || k.vade < e.vade ? k : e), null);
  const alanlar: Record<string, string> = {
    unvan: d.unvan, firma: d.firma, toplam,
    enEskiVade: enEski ? gun(enEski.vade) : "", gecikmeGun: String(enEski?.gecikmeGun ?? 0), faturaSayisi: String(d.kalemler.length),
  };
  const doldur = (s: string, kacisla: boolean) => s.replace(/\{(\w+)\}/g, (tam, ad: string) => (ad in alanlar ? (kacisla ? kacis(alanlar[ad]) : alanlar[ad]) : tam));
  const belgeAdi = (k: VadesiGecmisKalem) => k.belgeNo ?? k.aciklama ?? "Cari hareket";
  const duzListe = d.kalemler.map((k) => `- ${belgeAdi(k)} · tarih ${gun(k.tarih)} · vade ${gun(k.vade)} · ${k.gecikmeGun} gün gecikmiş · ${para(k.acik, k.dovizCinsi)}`).join("\n");
  const tablo = `<table style="border-collapse:collapse;font-size:13px;margin:8px 0"><thead><tr style="background:#f3f4f6">${["Belge", "Tarih", "Vade", "Gecikme", "Açık tutar"].map((b, i) => `<th style="padding:6px 10px;border:1px solid #e5e7eb;text-align:${i > 2 ? "right" : "left"}">${b}</th>`).join("")}</tr></thead><tbody>${
    d.kalemler.map((k) => `<tr><td style="padding:6px 10px;border:1px solid #e5e7eb">${kacis(belgeAdi(k))}</td><td style="padding:6px 10px;border:1px solid #e5e7eb">${gun(k.tarih)}</td><td style="padding:6px 10px;border:1px solid #e5e7eb">${gun(k.vade)}</td><td style="padding:6px 10px;border:1px solid #e5e7eb;text-align:right">${k.gecikmeGun} gün</td><td style="padding:6px 10px;border:1px solid #e5e7eb;text-align:right">${para(k.acik, k.dovizCinsi)}</td></tr>`).join("")
  }</tbody><tfoot><tr><td colspan="4" style="padding:6px 10px;border:1px solid #e5e7eb"><b>Toplam</b></td><td style="padding:6px 10px;border:1px solid #e5e7eb;text-align:right"><b>${kacis(toplam)}</b></td></tr></tfoot></table>`;
  const sablonMetni = sablon.metin.includes("{faturalar}") ? sablon.metin : `${sablon.metin}\n\n{faturalar}`;
  const not = d.not?.trim();
  const [once, sonra = ""] = sablonMetni.split("{faturalar}");
  const metin = `${doldur(once, false)}${duzListe}${not ? `\n\nNot: ${not}` : ""}${doldur(sonra, false)}`;
  // Şablon metni de kullanıcı girdisidir; alanlarla birlikte kaçışlanır.
  const paragraf = (s: string) => doldur(kacis(s), true).split(/\n{2,}/).filter((p) => p.trim()).map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`).join("");
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#111827;line-height:1.5">${paragraf(once)}${tablo}${not ? `<p><b>Not:</b> ${kacis(not).replace(/\n/g, "<br>")}</p>` : ""}${paragraf(sonra)}</div>`;
  return { konu: doldur(sablon.konu, false), metin, html, toplam };
}
