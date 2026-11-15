import { existsSync, readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative, resolve } from "node:path";
import { PrismaClient } from "@prisma/client";

/**
 * AI-93 (P-00): yapay zekâ başlangıç ölçümü. Yeniden çalıştırılabilir; salt
 * okunur işlemde yalnız sayım ve oran üretir. Firma adı, kişi, tutar, mesaj
 * ve belge içeriği raporlanmaz; firmalar yalnız sayılır.
 *
 *   node scripts/ai-olcum.mjs                 # Markdown stdout
 *   node scripts/ai-olcum.mjs --yaz           # docs/ai-olcum/<tarih>.md
 */
const KOK = fileURLToPath(new URL("..", import.meta.url));
const envDosyasi = join(KOK, ".env");
if (existsSync(envDosyasi)) process.loadEnvFile(envDosyasi);

const yuzde = (pay, payda) => (Number(payda) > 0 ? `%${((Number(pay) / Number(payda)) * 100).toFixed(1).replace(".", ",")}` : "—");
const sayi = (v) => Number(v ?? 0).toLocaleString("tr-TR");
const usd = (v) => (v === null || v === undefined ? "—" : `${Number(v).toFixed(4)} USD`);

async function olc(tx) {
  const pencere = async (gun) => tx.$queryRawUnsafe(`
    SELECT ozellik, saglayici, coalesce(model, '-') AS model, count(*)::int AS cagri,
      count(*) FILTER (WHERE basarili)::int AS basarili, count(DISTINCT tenant_id)::int AS firma,
      sum(maliyet_usd)::text AS maliyet, (count(*) FILTER (WHERE maliyet_tahmini))::int AS tahmini,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY sure_ms)::int AS sure_p50,
      percentile_cont(0.95) WITHIN GROUP (ORDER BY sure_ms)::int AS sure_p95
    FROM ai_cagri_izleri WHERE created_at >= now() - interval '${gun} days'
    GROUP BY 1, 2, 3 ORDER BY cagri DESC`);
  const hatalar = await tx.$queryRawUnsafe(`
    SELECT ozellik, coalesce(hata_sinifi, 'belirtilmemis') AS sinif, count(*)::int AS adet
    FROM ai_cagri_izleri WHERE NOT basarili AND created_at >= now() - interval '90 days'
    GROUP BY 1, 2 ORDER BY adet DESC LIMIT 25`);
  const geriBildirim = await tx.$queryRawUnsafe(`
    SELECT kanal, count(*) FILTER (WHERE rol = 'assistant')::int AS yanit,
      count(*) FILTER (WHERE rol = 'assistant' AND geri_bildirim IS NOT NULL)::int AS bildirimli,
      count(*) FILTER (WHERE rol = 'assistant' AND geri_bildirim IN ('yanlis', 'eksik'))::int AS olumsuz,
      count(*) FILTER (WHERE rol = 'assistant' AND geri_bildirim = 'dogru')::int AS olumlu
    FROM ajan_mesaj_gecmisi GROUP BY 1 ORDER BY 2 DESC`);
  const geriBildirimDegerleri = await tx.$queryRawUnsafe(`SELECT geri_bildirim AS deger, count(*)::int AS adet FROM ajan_mesaj_gecmisi WHERE geri_bildirim IS NOT NULL GROUP BY 1`);
  const ekstre = await tx.$queryRawUnsafe(`
    SELECT durum::text, coalesce(eslesme_turu::text, '-') AS tur, count(*)::int AS adet, count(DISTINCT tenant_id)::int AS firma
    FROM banka_ekstre_satirlari GROUP BY 1, 2 ORDER BY adet DESC`);
  const ocr = await tx.$queryRawUnsafe(`
    SELECT durum, coalesce(hata_sinifi, '-') AS sinif, count(*)::int AS adet,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY sure_ms)::int AS sure_p50
    FROM ai_ocr_denetimleri GROUP BY 1, 2 ORDER BY adet DESC`);
  // AI-102: yeniden deneme / yedek model / boş yanıt / şema onarımı denemeleri ve sonuçları.
  const denemeler = await tx.$queryRawUnsafe(`
    SELECT deneme_nedeni AS neden, count(*)::int AS adet, count(*) FILTER (WHERE basarili)::int AS basarili
    FROM ai_cagri_izleri WHERE deneme_nedeni IS NOT NULL AND created_at >= now() - interval '30 days'
    GROUP BY 1 ORDER BY 2 DESC`);
  const aktarim = await tx.$queryRawUnsafe(`SELECT count(*)::int AS parti, count(*) FILTER (WHERE geri_alindi_at IS NOT NULL)::int AS geri_alinan FROM veri_aktarimlari`);
  return { p30: await pencere(30), p90: await pencere(90), hatalar, denemeler, geriBildirim, geriBildirimDegerleri, ekstre, ocr, aktarim: aktarim[0] };
}

/** AI-96 için: `SISTEM_USER_ID` kullanan kaynak dosyaları (test hariç). */
function sistemKimligiEnvanteri() {
  const kok = join(KOK, "src"), sonuc = [];
  const gez = (d) => {
    for (const ad of readdirSync(d)) {
      const yol = join(d, ad);
      if (statSync(yol).isDirectory()) { gez(yol); continue; }
      if (!ad.endsWith(".ts") || ad.endsWith(".test.ts")) continue;
      const metin = readFileSync(yol, "utf8");
      if (yol.endsWith("core/sistem-kimligi.ts")) continue;
      const adet = (metin.match(/SISTEM_USER_ID|00000000-0000-4000-8000-000000000000/g) ?? []).length;
      if (adet) sonuc.push({ dosya: relative(KOK, yol), adet, sinif: metin.includes("baglamlaCalistir") ? "bağlam kuruyor" : "yalnız kayıt kimliği" });
    }
  };
  gez(kok);
  return sonuc.sort((a, b) => a.dosya.localeCompare(b.dosya));
}

function rapor(o, envanter) {
  const tarih = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Istanbul" });
  const s = [];
  s.push(`# Yapay zekâ başlangıç ölçümü — ${tarih}`, "", "AI-93 (birleşik plan 3.2, P-00). `node apps/api/scripts/ai-olcum.mjs` ile üretildi; salt okunur, yalnız sayım ve oran. Firma adı, kişi, tutar ve içerik yoktur.", "");
  for (const [baslik, satirlar] of [["Son 30 gün", o.p30], ["Son 90 gün", o.p90]]) {
    s.push(`## (a) AI çağrıları — ${baslik}`, "", "| Özellik | Sağlayıcı | Model | Çağrı | Başarı | Firma | Süre p50 / p95 (ms) | Maliyet | Tahmini maliyetli |", "|---|---|---|---|---|---|---|---|---|");
    for (const r of satirlar) s.push(`| ${r.ozellik} | ${r.saglayici} | ${r.model} | ${sayi(r.cagri)} | ${yuzde(r.basarili, r.cagri)} | ${r.firma} | ${sayi(r.sure_p50)} / ${sayi(r.sure_p95)} | ${usd(r.maliyet)} | ${sayi(r.tahmini)} |`);
    if (!satirlar.length) s.push("| — | | | 0 | | | | | |");
    s.push("");
  }
  s.push("### Başarısız çağrıların hata sınıfları (90 gün, en sık 25)", "", "| Özellik | Hata sınıfı | Adet |", "|---|---|---|");
  for (const r of o.hatalar) s.push(`| ${r.ozellik} | ${r.sinif} | ${sayi(r.adet)} |`);
  s.push("", "### Yeniden denemeler (AI-102, 30 gün)", "", "| Neden | Deneme | Başarılı |", "|---|---|---|");
  for (const r of o.denemeler) s.push(`| ${r.neden} | ${sayi(r.adet)} | ${yuzde(r.basarili, r.adet)} |`);
  if (!o.denemeler.length) s.push("| — | 0 | |");
  s.push("", "Not: 2026-11-15 öncesi izlerde `HTTP_503`, sağlayıcıya ulaşılamayan her durumu (ağ, zaman aşımı, 4xx/5xx) kapsar; sonrasında `SAGLAYICI_*` sınıfları ayrıdır.");
  s.push("", "## (b) Asistan yanıtlarında kullanıcı geri bildirimi", "", "| Kanal | Asistan yanıtı | Geri bildirimli | Olumsuz (yanlış + eksik) | Olumlu (doğru) | Olumsuz / bildirimli |", "|---|---|---|---|---|---|");
  for (const r of o.geriBildirim) s.push(`| ${r.kanal} | ${sayi(r.yanit)} | ${sayi(r.bildirimli)} | ${sayi(r.olumsuz)} | ${sayi(r.olumlu)} | ${yuzde(r.olumsuz, r.bildirimli)} |`);
  s.push("", `Kayıtlı geri bildirim değerleri: ${o.geriBildirimDegerleri.map((g) => `\`${g.deger}\` ${g.adet}`).join(", ") || "yok"}.`, "");
  s.push("## (c) Banka ekstre satırları", "", "| Durum | Eşleşme türü | Satır | Firma |", "|---|---|---|---|");
  for (const r of o.ekstre) s.push(`| ${r.durum} | ${r.tur} | ${sayi(r.adet)} | ${r.firma} |`);
  const toplam = o.ekstre.reduce((t, r) => t + r.adet, 0), eslesen = o.ekstre.filter((r) => r.durum === "eslesti").reduce((t, r) => t + r.adet, 0);
  s.push("", `Eşleşen: ${yuzde(eslesen, toplam)} (${sayi(eslesen)} / ${sayi(toplam)}). **Kendiliğinden / elle ayrımı ölçülemiyor:** satırda eşleşmenin öneriden mi elle mi yapıldığı ve önerinin kabul edilip edilmediği tutulmuyor. D2-2 (P-05) öneri ve karar izini ekler.`, "");
  s.push("## (d) OCR", "", "| Durum | Hata sınıfı | Adet | Süre p50 (ms) |", "|---|---|---|---|");
  for (const r of o.ocr) s.push(`| ${r.durum} | ${r.sinif} | ${sayi(r.adet)} | ${sayi(r.sure_p50)} |`);
  s.push("", "**Kullanıcı düzeltme oranı ölçülemiyor:** OCR denetim kaydı içerik ve düzeltme tutmuyor (tasarım gereği). D2-1 (P-09) ilk çıkarım ile kullanıcı düzeltmesini alan düzeyinde ayrı tutar.", "");
  s.push("## (e) Veri aktarımı", "", `${sayi(o.aktarim.parti)} aktarım partisi, ${sayi(o.aktarim.geri_alinan)} geri alındı. **Tanınmayan başlık oranı ölçülemiyor:** başlık eşleme sonucu kaydedilmiyor. P-13 kararı için önce eşleme sonucunun (tanınan/tanınmayan başlık sayısı) partiye yazılması gerekir.`, "");
  s.push("## (f) Sistem kimliğiyle çalışan kod (AI-96 girdisi)", "", "| Dosya | Kullanım | Tür |", "|---|---|---|");
  for (const e of envanter) s.push(`| \`${e.dosya}\` | ${e.adet} | ${e.sinif} |`);
  s.push("", "\"bağlam kuruyor\": dosya `SISTEM_USER_ID` ile `baglamlaCalistir` kullanıyor; sınıflar `src/core/sistem-kimligi.ts` içindedir (AI-96).", "");
  return s.join("\n");
}

async function main() {
  const yaz = process.argv.includes("--yaz");
  const db = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_MIGRATE ?? process.env.DATABASE_URL });
  try {
    const olcum = await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      return olc(tx);
    }, { timeout: 120_000 });
    const metin = rapor(olcum, sistemKimligiEnvanteri());
    if (!yaz) { console.log(metin); return; }
    const klasor = resolve(KOK, "../../docs/ai-olcum");
    mkdirSync(klasor, { recursive: true });
    const dosya = join(klasor, `${new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Istanbul" })}.md`);
    writeFileSync(dosya, metin + "\n");
    console.log(`yazıldı: ${relative(resolve(KOK, "../.."), dosya)}`);
  } finally { await db.$disconnect(); }
}

main().catch((hata) => {
  // Hata metni içerik taşıyabilir; yalnız sınıf yazılır.
  console.error(JSON.stringify({ durum: "hata", sinif: hata?.code ?? "OLCUM_OKUNAMADI" }));
  process.exitCode = 1;
});
