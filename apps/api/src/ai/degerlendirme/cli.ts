import "reflect-metadata";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Logger } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { AiProviderFactory } from "../saglayici/ai-provider.factory";
import { platformFiyati, type TokenFiyati } from "../saglayici/ai-butce";
import type { IAiProvider } from "../saglayici/ai-provider.interface";
import { ayardanYapilandirma, DIS_SAGLAYICILAR, onayModelleri, ozellikModeli } from "../saglayici/kiraci-saglayici";
import { AI_AKTARIM_POLITIKA_SURUMU } from "../ayarlar/ai-aktarim-politikasi";
import { degerlendirmeKos } from "./kos";
import { OlculenSaglayici } from "./kosucu";
import { kapiDenetle, ozetMetni, type KosuRaporu } from "./rapor";
import { DEGERLENDIRME_SENARYOLARI } from "./senaryolar";

/**
 * AI-100 (P-15) değerlendirme komutu. Gerçek sağlayıcıyla, koşu başına
 * maliyet tavanıyla çalışır; CI'da koşmaz (elle kapı).
 *
 *   node dist/ai/degerlendirme/cli.js kos [--kiraci <uuid> | --saglayici openai --model <ad> [--adres <url>]]
 *        [--giris-fiyat <usd/M> --cikis-fiyat <usd/M>] [--tavan 2] [--paralel 2] [--senaryo a,b]
 *        [--cikti <dizin|dosya|->] [--temel <temel.json>]
 *   node dist/ai/degerlendirme/cli.js kapi <yeni.json> <temel.json>
 *
 * --kiraci: sağlayıcı, anahtar, asistan modeli ve token fiyatı firmanın yapay
 * zekâ ayarından okunur (anahtar ekrana/dosyaya yazılmaz); dış sağlayıcıda
 * firmanın yurt dışı aktarım onayı o modeli kapsamalıdır. Senaryo verisi
 * yapaydır; firmanın kaydı okunmaz/yazılmaz, kullanım sayacına girmez.
 * Çıkış kodu: 0 geçti, 1 kapı geçmedi ya da koşu tamamlanmadı, 2 kullanım hatası.
 */

const VARSAYILAN_TAVAN_USD = 2;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class KullanimHatasi extends Error {}

function argumanlar(liste: string[]): { komut: string; konum: string[]; secim: Record<string, string> } {
  const [komut = "", ...kalan] = liste;
  const konum: string[] = [];
  const secim: Record<string, string> = {};
  for (let i = 0; i < kalan.length; i++) {
    const a = kalan[i];
    if (!a.startsWith("--")) { konum.push(a); continue; }
    const [ad, deger] = a.slice(2).split("=", 2);
    if (deger !== undefined) secim[ad] = deger;
    else if (kalan[i + 1] !== undefined && !kalan[i + 1].startsWith("--")) secim[ad] = kalan[++i];
    else secim[ad] = "1";
  }
  return { komut, konum, secim };
}

const sayi = (deger: string | undefined, ad: string): number | null => {
  if (deger === undefined) return null;
  const n = Number(deger);
  if (!Number.isFinite(n) || n < 0) throw new KullanimHatasi(`--${ad} geçerli bir sayı olmalı.`);
  return n;
};

async function kiracidanSaglayici(tenantId: string, modelSecimi: string | undefined): Promise<{ saglayici: IAiProvider; fiyat: TokenFiyati | null }> {
  if (!UUID.test(tenantId)) throw new KullanimHatasi("--kiraci geçerli bir UUID olmalı.");
  const prisma = new PrismaClient();
  try {
    const ayar = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      return tx.tenantAiAyari.findUnique({ where: { tenantId } });
    });
    if (!ayar) throw new KullanimHatasi("Firmanın yapay zekâ ayarı yok.");
    const model = modelSecimi ?? ozellikModeli(ayar, "asistan") ?? ayar.modelAdi ?? undefined;
    const saglayici = AiProviderFactory.uret({ ...ayardanYapilandirma(ayar), ...(model ? { modelAdi: model } : {}) });
    if (saglayici.saglayiciAdi === "tanimsiz") throw new KullanimHatasi("Firmanın sağlayıcısı/anahtarı kullanılamıyor.");
    const onayli = Boolean(ayar.yurtDisiOnayAt && ayar.yurtDisiOnaySaglayici === saglayici.saglayiciAdi && saglayici.modelAdi
      && onayModelleri(ayar.yurtDisiOnayModel).has(saglayici.modelAdi) && ayar.yurtDisiOnayPolitika === AI_AKTARIM_POLITIKA_SURUMU);
    if (DIS_SAGLAYICILAR.includes(saglayici.saglayiciAdi) && !onayli) throw new KullanimHatasi(`Firmanın yurt dışı aktarım onayı ${saglayici.modelAdi} modelini kapsamıyor.`);
    const giris = ayar.girisTokenMilyonUsd == null ? null : Number(ayar.girisTokenMilyonUsd);
    const cikis = ayar.cikisTokenMilyonUsd == null ? null : Number(ayar.cikisTokenMilyonUsd);
    const kendiAnahtari = Boolean(ayar.apiKey?.trim());
    return { saglayici, fiyat: giris !== null && cikis !== null ? { giris, cikis } : kendiAnahtari ? null : platformFiyati() };
  } finally {
    await prisma.$disconnect();
  }
}

function kodSurumu(): string | null {
  if (process.env.GIT_COMMIT) return process.env.GIT_COMMIT.slice(0, 12);
  try { return execSync("git rev-parse --short=8 HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim() || null; } catch { return null; }
}

function raporOku(yol: string): KosuRaporu {
  const r = JSON.parse(readFileSync(yol, "utf8")) as KosuRaporu;
  if (r.bicim !== 1 || !Array.isArray(r.senaryolar)) throw new KullanimHatasi(`${yol} bir değerlendirme raporu değil.`);
  return r;
}

/** Boruya yazılan büyük çıktı process.exit'ten önce boşaltılmalı (ilk koşuda ~64 KB'de kesildi). */
const stdoutYaz = (veri: string) => new Promise<void>((tamam, hata) => process.stdout.write(veri, (e) => (e ? hata(e) : tamam())));

async function yaz(cikti: string, rapor: KosuRaporu, metin: string): Promise<string | null> {
  if (cikti === "-") { await stdoutYaz(JSON.stringify(rapor, null, 1) + "\n"); return null; }
  const dizinMi = cikti.endsWith("/") || (existsSync(cikti) && statSync(cikti).isDirectory());
  const ad = `${rapor.tarih.slice(0, 16).replace(/[:T]/g, "-")}-${rapor.saglayici}-${(rapor.model ?? "model").replace(/[^a-z0-9.-]+/gi, "_")}`;
  const json = dizinMi ? join(cikti, `${ad}.json`) : cikti;
  if (dizinMi) mkdirSync(cikti, { recursive: true });
  writeFileSync(json, JSON.stringify(rapor, null, 1) + "\n");
  writeFileSync(json.replace(/\.json$/, "") + ".md", metin);
  return json;
}

async function kos(secim: Record<string, string>): Promise<number> {
  let saglayici: IAiProvider;
  let fiyat: TokenFiyati | null;
  if (secim.kiraci) ({ saglayici, fiyat } = await kiracidanSaglayici(secim.kiraci, secim.model));
  else {
    if (!secim.saglayici || !secim.model) throw new KullanimHatasi("--kiraci ya da --saglayici ve --model verilmeli.");
    saglayici = AiProviderFactory.uret({ saglayici: secim.saglayici, modelAdi: secim.model, apiKey: process.env.AI_DEGERLENDIRME_ANAHTARI ?? null, baseUrl: secim.adres ?? null });
    if (saglayici.saglayiciAdi === "tanimsiz") throw new KullanimHatasi("Sağlayıcı anahtarı tanımlı değil (ortamdaki sağlayıcı anahtarı ya da AI_DEGERLENDIRME_ANAHTARI).");
    fiyat = null;
  }
  const giris = sayi(secim["giris-fiyat"], "giris-fiyat"), cikis = sayi(secim["cikis-fiyat"], "cikis-fiyat");
  if (giris !== null && cikis !== null) fiyat = { giris, cikis };
  if (!fiyat) throw new KullanimHatasi("Token fiyatı bilinmiyor; maliyet tavanı ölçülemez. --giris-fiyat ve --cikis-fiyat (USD / milyon token) verin.");
  const tavan = sayi(secim.tavan, "tavan") ?? VARSAYILAN_TAVAN_USD;
  const secilen = secim.senaryo ? secim.senaryo.split(",").map((x) => x.trim()).filter(Boolean) : null;
  const senaryolar = secilen ? DEGERLENDIRME_SENARYOLARI.filter((s) => secilen.includes(s.id)) : DEGERLENDIRME_SENARYOLARI;
  if (secilen && senaryolar.length !== secilen.length) throw new KullanimHatasi(`Bilinmeyen senaryo: ${secilen.filter((x) => !senaryolar.some((s) => s.id === x)).join(", ")}`);
  const temel = secim.temel ? raporOku(secim.temel) : null;

  const olculen = new OlculenSaglayici(saglayici, fiyat, tavan);
  process.stderr.write(`Değerlendirme: ${olculen.saglayiciAdi}/${olculen.modelAdi ?? "—"} · ${senaryolar.length} senaryo · tavan ${tavan} USD\n`);
  const rapor = await degerlendirmeKos(olculen, senaryolar, fiyat, { paralel: Number(secim.paralel ?? 1), kodSurumu: kodSurumu(), ilerleme: (s) => process.stderr.write(`${s}\n`) });
  const kapi = temel ? kapiDenetle(rapor, temel) : undefined;
  const metin = ozetMetni(rapor, kapi);
  const dosya = await yaz(secim.cikti ?? "-", rapor, metin);
  process.stderr.write(`\n${metin}${dosya ? `\nRapor: ${dosya}\n` : ""}`);
  return rapor.tamamlandi && (!kapi || kapi.gecti) ? 0 : 1;
}

/** Nest günlükleri stdout'a yazar; `--cikti -` JSON'u bozulmasın diye stderr'e alınır. */
function gunlukleriStderreAl(): void {
  const yaz = (duzey: string) => (mesaj: unknown, ...ek: unknown[]) => process.stderr.write(`[${duzey}] ${String(mesaj)}${ek.length ? ` ${ek.map(String).join(" ")}` : ""}\n`);
  Logger.overrideLogger({ log: yaz("log"), warn: yaz("uyarı"), error: yaz("hata"), debug: () => undefined, verbose: () => undefined, fatal: yaz("hata") });
}

async function main(): Promise<number> {
  gunlukleriStderreAl();
  const { komut, konum, secim } = argumanlar(process.argv.slice(2));
  if (komut === "kos") return kos(secim);
  if (komut === "kapi") {
    if (konum.length !== 2) throw new KullanimHatasi("Kullanım: kapi <yeni.json> <temel.json>");
    const yeni = raporOku(konum[0]), kapi = kapiDenetle(yeni, raporOku(konum[1]));
    await stdoutYaz(ozetMetni(yeni, kapi));
    return kapi.gecti ? 0 : 1;
  }
  throw new KullanimHatasi("Komut: kos | kapi (ayrıntı dosya başında).");
}

if (require.main === module) {
  main().then((kod) => process.exit(kod), (hata) => {
    process.stderr.write(`${hata instanceof Error ? hata.message : String(hata)}\n`);
    process.exit(hata instanceof KullanimHatasi ? 2 : 1);
  });
}
