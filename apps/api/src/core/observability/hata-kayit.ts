import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma.service";

/**
 * PLT-118/119: uygulama hatalarının gruplu kaydı. Kendi veritabanımızda tutulur (dış
 * servis yok; mesajlarda firma verisi olabilir). Kayıt hiçbir zaman isteği düşürmez.
 */
/** PLT-123: worker, Telegram ve ödeme sözü süreçleri de yazar (ödeme sözü "worker" sayılır). */
export type HataKaynagi = "api" | "web" | "worker" | "telegram";

export interface HataGirdisi {
  kaynak: HataKaynagi;
  ad: string;
  mesaj: string;
  yigin?: string | null;
  /** API'de rota kalıbı (`/fatura/:id`), web'de sorgu dizesiz sayfa yolu. */
  konum: string;
  tenantId?: string | null;
  istekId?: string | null;
}

const E_POSTA = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const IBAN = /\bTR\s?\d{2}(?:\s?\d{4}){5}\s?\d{2}\b/gi;
const TELEFON = /(?:\+?90[\s-]?)?\(?0?5\d{2}\)?[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}\b/g;
/** VKN (10) ve TCKN (11) gibi uzun sayılar; kimlik ve tutar ayrımı yapılmadan gizlenir. */
const UZUN_SAYI = /\b\d{10,11}\b/g;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

/** Mesajdaki kişisel veri ve kimlikler gizlenir; kimlikler gruplamayı da bozmasın diye `:id` olur. */
export function maskele(metin: string): string {
  return metin
    .replace(E_POSTA, "***@***")
    .replace(IBAN, "TR** ****")
    .replace(UUID, ":id")
    .replace(TELEFON, "***")
    .replace(UZUN_SAYI, "***");
}

/** Yığının uygulamaya ait ilk satırı (konum bilgisi olmadan); yoksa ilk satır. */
export function ilkUygulamaSatiri(yigin: string | null | undefined): string {
  const satirlar = (yigin ?? "").split("\n").map((s) => s.trim()).filter((s) => s.startsWith("at "));
  const uygulama = satirlar.find((s) => !s.includes("node_modules") && !s.includes("node:internal") && !s.includes("<anonymous>"));
  // Satır/sütun numarası her derlemede kayar; dosya ve işlev adı yeter.
  return (uygulama ?? satirlar[0] ?? "").replace(/:\d+:\d+\)?$/, "").replace(/\?[^)\s]*/, "");
}

/** Aynı hata aynı yerden geliyorsa aynı gruba düşer; mesajdaki değişken kısımlar (sayı, kimlik) gruplamayı bölmez. */
export function parmakIzi(g: Pick<HataGirdisi, "kaynak" | "ad" | "mesaj" | "yigin" | "konum">): string {
  const mesajKalibi = maskele(g.mesaj).replace(/\d+/g, "#").slice(0, 200);
  return createHash("sha256").update([g.kaynak, g.ad, mesajKalibi, ilkUygulamaSatiri(g.yigin), g.konum].join("|")).digest("hex").slice(0, 64);
}

/** Pilot yayını paketin adını `SURUM` dosyasına yazar; yerelde "yerel". */
let surum: string | null = null;
export function calisanSurum(): string {
  if (surum === null) {
    try { surum = readFileSync(resolve(__dirname, "../../../../../SURUM"), "utf8").trim().slice(0, 120) || "yerel"; } catch { surum = "yerel"; }
  }
  return surum;
}

/** Sayaç bir saatlik pencerede tutulur (PLT-121 sıçrama alarmı); pencere geçince 1'den başlar. */
@Injectable()
export class HataKayitService {
  private readonly logger = new Logger(HataKayitService.name);

  constructor(private readonly prisma: PrismaService) {}

  async kaydet(g: HataGirdisi): Promise<void> {
    if (process.env.NODE_ENV === "test" && process.env.HATA_KAYDI_TESTTE !== "1") return;
    try {
      const mesaj = maskele(g.mesaj || g.ad).slice(0, 1000);
      const yigin = g.yigin ? maskele(g.yigin).slice(0, 4000) : null;
      const ad = g.ad.slice(0, 200) || "Error";
      const konum = g.konum.slice(0, 300) || "?";
      const iz = parmakIzi({ ...g, ad, konum });
      const firma = g.tenantId && /^[0-9a-f-]{36}$/i.test(g.tenantId) ? [g.tenantId] : [];
      await this.prisma.$executeRaw`
        INSERT INTO sistem_hatalari (parmak_izi, kaynak, ad, mesaj, yigin, konum, son_istek_id, surum, firmalar)
        VALUES (${iz}, ${g.kaynak}, ${ad}, ${mesaj}, ${yigin}, ${konum}, ${g.istekId?.slice(0, 100) ?? null}, ${calisanSurum()}, ${firma}::uuid[])
        ON CONFLICT (parmak_izi) DO UPDATE SET
          sayi = sistem_hatalari.sayi + 1,
          saat_sayi = CASE WHEN sistem_hatalari.saat_baslangic < now() - interval '1 hour' THEN 1 ELSE sistem_hatalari.saat_sayi + 1 END,
          saat_baslangic = CASE WHEN sistem_hatalari.saat_baslangic < now() - interval '1 hour' THEN now() ELSE sistem_hatalari.saat_baslangic END,
          son_gorulme = now(),
          mesaj = EXCLUDED.mesaj,
          yigin = COALESCE(EXCLUDED.yigin, sistem_hatalari.yigin),
          son_istek_id = EXCLUDED.son_istek_id,
          surum = EXCLUDED.surum,
          firmalar = CASE
            WHEN cardinality(EXCLUDED.firmalar) = 0 OR EXCLUDED.firmalar[1] = ANY(sistem_hatalari.firmalar) OR cardinality(sistem_hatalari.firmalar) >= 50 THEN sistem_hatalari.firmalar
            ELSE sistem_hatalari.firmalar || EXCLUDED.firmalar END`;
    } catch (hata) {
      // Hata kaydı düşerse yalnız günlüğe yazılır; kayıt yüzünden istek ya da kayıt döngüsü bozulmaz.
      this.logger.warn(`Hata kaydı yazılamadı: ${hata instanceof Error ? hata.message : String(hata)}`);
    }
  }
}
