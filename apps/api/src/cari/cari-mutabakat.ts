import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { DOVIZ_CINSLERI } from "@tekirextra/shared";

/**
 * CARI-42 (P3-1, karar 2026-10-04): bakiye mutabakatı. Talep anında bakiye
 * ve ekstre PDF'i dondurulur; karşı taraf girişsiz bağlantıdan "mutabıkız" ya
 * da bakiyesiyle itiraz eder. Bu dosya saf kuralları taşır.
 */

/** Varsayılan yanıt süresi (gün). */
export const VARSAYILAN_YANIT_GUNU = 15;
/** Yanıtsız talebe son tarihten bu kadar gün önce bir kez hatırlatma gider. */
export const HATIRLATMA_GUNU = 3;
/** İtiraz eki: en çok 5 MB, PDF / Excel / CSV. */
export const EK_EN_BUYUK = 5 * 1024 * 1024;
export const EK_MIMELERI = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "text/csv",
]);

export type MutabakatDurumu = "gonderildi" | "goruldu" | "mutabik" | "itiraz" | "iptal";
export type MutabakatGorunenDurum = MutabakatDurumu | "suresi_doldu";

export const DURUM_ADLARI: Record<MutabakatGorunenDurum, string> = {
  gonderildi: "Gönderildi",
  goruldu: "Görüldü",
  mutabik: "Mutabık",
  itiraz: "İtiraz",
  iptal: "İptal",
  suresi_doldu: "Süresi doldu",
};

export interface DovizBakiyesi { dovizCinsi: string; bakiye: string }

const tarih = z.iso.date("Tarih YYYY-AA-GG olmalıdır");

export const mutabakatTalepSemasi = z.object({
  mutabakatTarihi: tarih,
  baslangicTarihi: tarih.optional().nullable(),
  /** Boşsa mutabakat tarihinden değil bugünden itibaren 15 gün. */
  sonYanitTarihi: tarih.optional().nullable(),
  /** Boşsa cari kartındaki e-posta. */
  alici: z.email("Geçerli bir e-posta adresi girin").optional().nullable(),
  tur: z.enum(["standart", "ayrintili"]).optional(),
}).refine((g) => !g.baslangicTarihi || g.baslangicTarihi <= g.mutabakatTarihi, { message: "Başlangıç tarihi mutabakat tarihinden sonra olamaz", path: ["baslangicTarihi"] });

export const topluMutabakatSemasi = z.object({
  cariIdler: z.array(z.uuid()).min(1, "En az bir cari seçin").max(100, "Tek seferde en çok 100 cariye mutabakat gönderilir"),
  mutabakatTarihi: tarih,
  sonYanitTarihi: tarih.optional().nullable(),
  tur: z.enum(["standart", "ayrintili"]).optional(),
});

export const itirazKapatSemasi = z.object({ not: z.string().trim().min(1, "Kapatma notu yazın").max(1000) });

const tutar = z.string().trim().regex(/^\d{1,13}([.,]\d{1,2})?$/, "Tutar sayı olmalıdır (en çok 2 ondalık)");

/** Portal yanıtı (multipart alanları metin gelir; karsiBakiyeler JSON metnidir). */
export const portalYanitSemasi = z.discriminatedUnion("yanit", [
  z.object({
    yanit: z.literal("mutabik"),
    ad: z.string({ error: "Ad soyad yazın" }).trim().min(2, "Ad soyad yazın").max(120),
    gorev: z.string({ error: "Görev / unvan yazın" }).trim().min(2, "Görev / unvan yazın").max(120),
    eposta: z.email("Geçerli bir e-posta adresi girin").optional().or(z.literal("")),
    aciklama: z.string().trim().max(2000).optional(),
  }),
  z.object({
    yanit: z.literal("itiraz"),
    ad: z.string({ error: "Ad soyad yazın" }).trim().min(2, "Ad soyad yazın").max(120),
    gorev: z.string({ error: "Görev / unvan yazın" }).trim().min(2, "Görev / unvan yazın").max(120),
    eposta: z.email("Geçerli bir e-posta adresi girin").optional().or(z.literal("")),
    aciklama: z.string({ error: "İtirazın nedenini yazın" }).trim().min(5, "İtirazın nedenini yazın").max(2000),
    karsiBakiyeler: z.array(z.object({
      dovizCinsi: z.enum(DOVIZ_CINSLERI),
      tutar,
      /** Karşı tarafın gözünden: "borcluyuz" bize borçlu, "alacakliyiz" bizden alacaklı. */
      yon: z.enum(["borcluyuz", "alacakliyiz", "sifir"]),
    }), { error: "Kayıtlarınızdaki bakiyeyi girin" }).min(1, "Kayıtlarınızdaki bakiyeyi girin").max(25),
  }),
]);

export type PortalYaniti = z.infer<typeof portalYanitSemasi>;

/** Bağlantı anahtarı: 32 bayt rastgele; veritabanına yalnız özeti yazılır. */
export function anahtarUret(): { anahtar: string; ozet: string } {
  const anahtar = randomBytes(32).toString("base64url");
  return { anahtar, ozet: anahtarOzeti(anahtar) };
}

export function anahtarOzeti(anahtar: string): string {
  return createHash("sha256").update(anahtar).digest("hex");
}

/** Bağlantıda yalnız base64url karakterleri; uzunluk 43. */
export const anahtarBicimiGecerli = (anahtar: string) => /^[A-Za-z0-9_-]{43}$/.test(anahtar);

export function portalAdresi(tenantId: string, anahtar: string): string {
  return `${(process.env.APP_URL ?? "http://localhost:3100").replace(/\/$/, "")}/mutabakat/${tenantId}/${anahtar}`;
}

/** Bugünün tarihi (TR) YYYY-AA-GG; son yanıt günü bu günün sonuna kadar geçerlidir. */
export function suresiDoldu(sonYanitTarihi: string, bugun: string): boolean {
  return sonYanitTarihi < bugun;
}

export function gorunenDurum(k: { durum: string; sonYanitTarihi: Date | string }, bugun: string): MutabakatGorunenDurum {
  const son = typeof k.sonYanitTarihi === "string" ? k.sonYanitTarihi : k.sonYanitTarihi.toISOString().slice(0, 10);
  if ((k.durum === "gonderildi" || k.durum === "goruldu") && suresiDoldu(son, bugun)) return "suresi_doldu";
  return k.durum as MutabakatDurumu;
}

/** Karşı tarafın girdiğini bizim işaretimize çevirir (artı: cari bize borçlu). */
export function karsiBakiyeleri(girdi: Extract<PortalYaniti, { yanit: "itiraz" }>["karsiBakiyeler"]): DovizBakiyesi[] {
  const birlesik = new Map<string, number>();
  for (const b of girdi) {
    const deger = Number(b.tutar.replace(",", "."));
    const isaretli = b.yon === "sifir" ? 0 : b.yon === "borcluyuz" ? deger : -deger;
    birlesik.set(b.dovizCinsi, Math.round(((birlesik.get(b.dovizCinsi) ?? 0) + isaretli) * 100) / 100);
  }
  return [...birlesik].map(([dovizCinsi, bakiye]) => ({ dovizCinsi, bakiye: bakiye.toFixed(2) }));
}

/** Döviz başına fark = karşı taraf − biz; yalnız sıfırdan farklı olanlar. */
export function bakiyeFarklari(bizim: DovizBakiyesi[], karsi: DovizBakiyesi[]): DovizBakiyesi[] {
  const dovizler = new Set([...bizim, ...karsi].map((b) => b.dovizCinsi));
  const deger = (liste: DovizBakiyesi[], d: string) => Number(liste.find((b) => b.dovizCinsi === d)?.bakiye ?? 0);
  return [...dovizler]
    .map((d) => ({ dovizCinsi: d, bakiye: (Math.round((deger(karsi, d) - deger(bizim, d)) * 100) / 100).toFixed(2) }))
    .filter((f) => Number(f.bakiye) !== 0);
}

const para = (deger: number) => Math.abs(deger).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const birim = (d: string) => (d === "TRY" ? "TL" : d);

/** Portal ve e-postadaki cümle: "firmamıza 12.500,00 TL borçlusunuz". */
export function bakiyeCumlesi(bakiyeler: DovizBakiyesi[]): string {
  const dolu = bakiyeler.filter((b) => Math.abs(Number(b.bakiye)) >= 0.005);
  if (!dolu.length) return "hesabınız bakiyesizdir (0,00)";
  const borc = dolu.filter((b) => Number(b.bakiye) > 0).map((b) => `${para(Number(b.bakiye))} ${birim(b.dovizCinsi)}`);
  const alacak = dolu.filter((b) => Number(b.bakiye) < 0).map((b) => `${para(Number(b.bakiye))} ${birim(b.dovizCinsi)}`);
  return [borc.length ? `firmamıza ${borc.join(" ve ")} borçlusunuz` : "", alacak.length ? `firmamızdan ${alacak.join(" ve ")} alacaklısınız` : ""].filter(Boolean).join("; ");
}

export const trTarih = (iso: string) => iso.slice(0, 10).split("-").reverse().join(".");

/** Gün ekler (UTC tarih üzerinde, saat dilimi kaymadan). */
export function gunEkle(iso: string, gun: number): string {
  const t = new Date(`${iso}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + gun);
  return t.toISOString().slice(0, 10);
}

/** Yanıtsız, iptal edilmemiş, süresi dolmamış ve son tarihe en çok 3 gün kalmış talep hatırlatılır. */
export function hatirlatmaZamani(k: { durum: string; sonYanitTarihi: string; hatirlatmaAt: Date | null }, bugun: string): boolean {
  if (k.hatirlatmaAt || (k.durum !== "gonderildi" && k.durum !== "goruldu")) return false;
  return bugun <= k.sonYanitTarihi && gunEkle(bugun, HATIRLATMA_GUNU) >= k.sonYanitTarihi;
}

/** Anlık üretim ve tarama aynı anahtarı kullanır; itiraz kapatılınca tarama bildirimi kapatır. */
export function mutabakatItirazBildirimi(k: { id: string; cariId: string; cari: { unvan: string; kod: string }; mutabakatTarihi: Date; yanitlayanAd: string | null; farklar: DovizBakiyesi[] }) {
  return {
    tur: "vade" as const,
    onem: "uyari" as const,
    baslik: "Mutabakata itiraz geldi",
    aciklama: `${k.cari.unvan} (${k.cari.kod}) ${trTarih(k.mutabakatTarihi.toISOString())} tarihli mutabakata itiraz etti${k.yanitlayanAd ? ` (${k.yanitlayanAd})` : ""}${k.farklar.length ? `; fark ${k.farklar.map((f) => `${Number(f.bakiye).toLocaleString("tr-TR", { minimumFractionDigits: 2 })} ${f.dovizCinsi}`).join(", ")}` : ""}. Kayıtları karşılaştırıp itirazı kapatın.`,
    birlesimAnahtari: `vade:mutabakat:${k.id}:itiraz`,
    kaynakTur: "cari_mutabakat",
    kaynakRef: k.id,
    hedefYol: "/panel/cari/mutabakatlar?durum=itiraz",
    roller: ["yonetici", "muhasebe"] as ("yonetici" | "muhasebe")[],
  };
}
