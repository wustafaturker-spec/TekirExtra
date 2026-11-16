import { createHash } from "node:crypto";
import { AJAN_ARACLARI, aracTanimi } from "../ajan/araclar";
import { ARAC_GRUPLARI, GRUP_ARACLARI, grupAcmaTanimi, type AracGrubu } from "../ajan/araclar/gruplar";
import { asistanIstemi } from "../ajan/ai-ajan.service";
import { KATEGORILER, type Kategori } from "./senaryo";
import type { DenemeSonucu } from "./kosucu";

const ozet = (x: string) => createHash("sha256").update(x).digest("hex").slice(0, 12);

/**
 * İstem sürümü: web ve Telegram istemlerinin tarih çıkarılmış özeti. Kullanıcı
 * adı/rol değişkendir, sabit örnekle hesaplanır; metin değişince sürüm değişir.
 */
export function istemSurumu(): string {
  const metin = [false, true].map((telegram) => asistanIstemi({ adSoyad: "-", rol: "yonetici", ozelTalimatlar: null, telegram })).join("\n---\n");
  return ozet(metin.replace(/Bugün \d{4}-\d{2}-\d{2}/g, "Bugün -"));
}

/** Araç sürümü: bütün araç tanımları (ad, açıklama, şema) ve grup eşlemesi. */
export function aracSurumu(): string {
  return ozet(JSON.stringify({ araclar: AJAN_ARACLARI.map((a) => ({ ...aracTanimi(a), sinif: a.sinif })), gruplar: GRUP_ARACLARI, grupAcma: grupAcmaTanimi(Object.keys(ARAC_GRUPLARI) as AracGrubu[]) }));
}

export interface SenaryoRaporu {
  id: string;
  kategori: Kategori;
  kritik: boolean;
  tekrar: number;
  gecen: number;
  /** Çoğunluk geçti mi (kritikte 3'te 2, diğerlerinde 1'de 1). */
  gecti: boolean;
  denemeler: DenemeSonucu[];
}

export interface KosuRaporu {
  bicim: 1;
  tarih: string;
  saglayici: string;
  model: string | null;
  istemSurumu: string;
  aracSurumu: string;
  senaryoSetiSurumu: string;
  kodSurumu: string | null;
  tavanUsd: number;
  fiyat: { giris: number; cikis: number };
  harcananUsd: number;
  maliyetTahmini: boolean;
  cagriSayisi: number;
  girisToken: number;
  cikisToken: number;
  sureMs: number;
  /** Tavan ya da durdurma nedeniyle koşmayan senaryolar varsa false. */
  tamamlandi: boolean;
  kosmayanlar: string[];
  ozet: {
    senaryo: number;
    gecen: number;
    kritik: { senaryo: number; gecen: number };
    kategoriler: Record<Kategori, { senaryo: number; gecen: number }>;
    saglayiciHatasi: number;
  };
  senaryolar: SenaryoRaporu[];
}

export const gecmeEsigi = (tekrar: number) => Math.floor(tekrar / 2) + 1;

export function ozetCikar(senaryolar: SenaryoRaporu[]): KosuRaporu["ozet"] {
  const kategoriler = Object.fromEntries(KATEGORILER.map((k) => [k, { senaryo: 0, gecen: 0 }])) as KosuRaporu["ozet"]["kategoriler"];
  for (const s of senaryolar) { kategoriler[s.kategori].senaryo++; if (s.gecti) kategoriler[s.kategori].gecen++; }
  const kritik = senaryolar.filter((s) => s.kritik);
  return {
    senaryo: senaryolar.length,
    gecen: senaryolar.filter((s) => s.gecti).length,
    kritik: { senaryo: kritik.length, gecen: kritik.filter((s) => s.gecti).length },
    kategoriler,
    saglayiciHatasi: senaryolar.reduce((t, s) => t + s.denemeler.filter((d) => d.saglayiciHatasi).length, 0),
  };
}

export interface KapiSonucu {
  gecti: boolean;
  /** Temel çizgide geçen, şimdi geçmeyen kritik senaryolar. */
  kritikGerilemeler: string[];
  /** Temel çizgide olmayan ya da orada da geçmeyen, şimdi geçmeyen kritik senaryolar (bilgi). */
  kritikBasarisiz: string[];
  /** Kritik olmayan gerilemeler (bilgi). */
  digerGerilemeler: string[];
  iyilesmeler: string[];
  uyarilar: string[];
}

/**
 * P-15 (d) elle kapı: model, istem ya da araç tanımı değişikliğinden sonra
 * koşu temel çizgiyle karşılaştırılır. Kritik bir senaryo temel çizgide
 * geçip şimdi geçmiyorsa ya da koşu tamamlanmadıysa yayına çıkılmaz.
 */
export function kapiDenetle(yeni: KosuRaporu, temel: KosuRaporu): KapiSonucu {
  const uyarilar: string[] = [];
  if (yeni.senaryoSetiSurumu !== temel.senaryoSetiSurumu) uyarilar.push(`Senaryo seti farklı (${temel.senaryoSetiSurumu} → ${yeni.senaryoSetiSurumu}); yalnız ortak senaryolar karşılaştırıldı. Yeni set için temel çizgiyi yenileyin.`);
  if (!yeni.tamamlandi) uyarilar.push(`Koşu tamamlanmadı (${yeni.kosmayanlar.length} senaryo koşmadı); kapı geçilemez.`);
  if (yeni.ozet.saglayiciHatasi) uyarilar.push(`${yeni.ozet.saglayiciHatasi} deneme sağlayıcı hatasıyla bitti; gerileme gibi görünen sonuçları kontrol edin.`);
  for (const [alan, ad] of [["model", "Model"], ["istemSurumu", "İstem"], ["aracSurumu", "Araç tanımı"]] as const) {
    if (yeni[alan] !== temel[alan]) uyarilar.push(`${ad} değişti: ${temel[alan]} → ${yeni[alan]}`);
  }
  const temelHarita = new Map(temel.senaryolar.map((s) => [s.id, s]));
  const kritikGerilemeler: string[] = [], kritikBasarisiz: string[] = [], digerGerilemeler: string[] = [], iyilesmeler: string[] = [];
  for (const s of yeni.senaryolar) {
    const t = temelHarita.get(s.id);
    if (t?.gecti && !s.gecti) (s.kritik ? kritikGerilemeler : digerGerilemeler).push(s.id);
    else if (!s.gecti && s.kritik) kritikBasarisiz.push(s.id);
    else if (t && !t.gecti && s.gecti) iyilesmeler.push(s.id);
  }
  return { gecti: yeni.tamamlandi && kritikGerilemeler.length === 0, kritikGerilemeler, kritikBasarisiz, digerGerilemeler, iyilesmeler, uyarilar };
}

const yuzde = (a: number, b: number) => (b ? `%${Math.round((a / b) * 100)}` : "—");

/** İnsan okunur kısa özet (konsol ve markdown). */
export function ozetMetni(r: KosuRaporu, kapi?: KapiSonucu): string {
  const s = r.ozet;
  const satirlar = [
    `# Asistan değerlendirmesi — ${r.tarih.slice(0, 16).replace("T", " ")}`,
    "",
    `Sağlayıcı/model: ${r.saglayici} / ${r.model ?? "—"} · istem ${r.istemSurumu} · araç ${r.aracSurumu} · set ${r.senaryoSetiSurumu}${r.kodSurumu ? ` · kod ${r.kodSurumu}` : ""}`,
    `Maliyet: ${r.harcananUsd.toFixed(4)} USD${r.maliyetTahmini ? " (tahmini)" : ""} / tavan ${r.tavanUsd} USD · ${r.cagriSayisi} çağrı · ${Math.round(r.sureMs / 1000)} sn${r.tamamlandi ? "" : ` · TAMAMLANMADI (${r.kosmayanlar.length} senaryo koşmadı)`}`,
    "",
    `Geçen: ${s.gecen}/${s.senaryo} (${yuzde(s.gecen, s.senaryo)}) · kritik ${s.kritik.gecen}/${s.kritik.senaryo}${s.saglayiciHatasi ? ` · sağlayıcı hatası ${s.saglayiciHatasi} deneme` : ""}`,
    "",
    "| Kategori | Geçen |",
    "|---|---|",
    ...KATEGORILER.map((k) => `| ${k} | ${s.kategoriler[k].gecen}/${s.kategoriler[k].senaryo} |`),
    "",
    "## Geçmeyenler",
    "",
    ...r.senaryolar.filter((x) => !x.gecti).map((x) => `- **${x.id}**${x.kritik ? " (kritik)" : ""} ${x.gecen}/${x.tekrar}: ${[...new Set(x.denemeler.flatMap((d) => d.saglayiciHatasi ? [`sağlayıcı: ${d.saglayiciHatasi}`] : d.hatalar))].slice(0, 4).join("; ")}`),
  ];
  if (kapi) {
    satirlar.push("", `## Kapı: ${kapi.gecti ? "GEÇTİ" : "GEÇMEDİ"}`, "");
    if (kapi.kritikGerilemeler.length) satirlar.push(`- Kritik gerileme: ${kapi.kritikGerilemeler.join(", ")}`);
    if (kapi.digerGerilemeler.length) satirlar.push(`- Diğer gerileme: ${kapi.digerGerilemeler.join(", ")}`);
    if (kapi.kritikBasarisiz.length) satirlar.push(`- Temelde de geçmeyen kritik: ${kapi.kritikBasarisiz.join(", ")}`);
    if (kapi.iyilesmeler.length) satirlar.push(`- İyileşme: ${kapi.iyilesmeler.join(", ")}`);
    for (const u of kapi.uyarilar) satirlar.push(`- Uyarı: ${u}`);
  }
  return satirlar.join("\n") + "\n";
}
