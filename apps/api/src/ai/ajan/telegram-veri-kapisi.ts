import { BadRequestException } from "@nestjs/common";
import type { AjanAraci } from "./araclar";

/**
 * CNL-05: Telegram kanalında maaş/bordro tutarı ve kişiye ödenen ücret dışarı çıkmaz. Bu sınır
 * modelin talimata uymasına bırakılmaz; araçlar Telegram'da bu kapıdan geçer:
 * - bordro toplamı ya da kişiye ödeme döndüren araçlar modele hiç sunulmaz,
 * - raporlar açık bir kararla süzülür (karar verilmemiş rapor kapalıdır),
 * - nakit pozisyonundan maaş ve bordro yasal ödemesi kalemleri çıkarılır,
 * - personel tipindeki cariler (ekstresi kişinin ücret geçmişidir) görünmez.
 * 2026-11-12 ölçümünde düşünmesiz model maaş sorusunda rapor kataloğunu kurcaladı; kapı bunun için.
 */
export const TELEGRAM_KAPALI_ARACLAR = new Set([
  "personel_ozeti", "personel_maliyet_raporu", "avans_ozeti",
  // Alıcı adı + tutar: personele yapılan ödeme kişinin ücretidir.
  "odeme_talimatlari",
]);

/**
 * Rapor başına Telegram kararı. Yeni rapor eklenince burada karar verilmeli; verilmezse rapor
 * Telegram'da kapalıdır ve `telegram-veri-kapisi.test.ts` kırılır.
 */
export const TELEGRAM_RAPOR_KARARI: Record<string, { acik: boolean; neden?: string }> = {
  "cari.babs": { acik: true },
  "cari.ekstre": { acik: false, neden: "personel carisinin ekstresi kişinin ücret ödemeleridir" },
  "cari.en-yuksek-bakiyeliler": { acik: false, neden: "personel carisinin bakiyesi ödenmemiş ücrettir" },
  "cari.satis-alis-ozeti": { acik: true },
  "cari.tahsilat-performansi": { acik: true },
  "cari.yaslandirma": { acik: true },
  "fatura.donemsel-ozet": { acik: true },
  "fatura.iade-oranlari": { acik: true },
  "fatura.iskonto-analizi": { acik: true },
  "fatura.kar-marji": { acik: true },
  "fatura.kdv-dokumu": { acik: true },
  "fatura.satis-kirilimlari": { acik: true },
  "fatura.taslaklar": { acik: true },
  "genel.kar-zarar-ozeti": { acik: true },
  "kasa_banka.bakiyeler": { acik: true },
  "kasa_banka.komisyonlar": { acik: true },
  "kasa_banka.mutabakat": { acik: false, neden: "banka satırları maaş havalelerini içerir" },
  "kasa_banka.nakit_akisi": { acik: false, neden: "hesap hareketleri maaş ödemelerini içerir" },
  "kasa_banka.tahsilat_odeme": { acik: false, neden: "personele yapılan ödemeleri içerir" },
  "stok.devir-hizi": { acik: true },
  "stok.eksi-stok": { acik: true },
  "stok.en-cok-satanlar": { acik: true },
  "stok.envanter": { acik: true },
  "stok.fire-zayi": { acik: true },
  "stok.hareket-ozeti": { acik: true },
  "stok.hareketsiz": { acik: true },
  "stok.kritik-stok": { acik: true },
  "stok.siparis-onerisi": { acik: true },
  "stok.urun-karlilik": { acik: true },
  "urun-hareket.alici-urun": { acik: true },
  "urun-hareket.hareketler": { acik: true },
  "urun-hareket.urun-satislari": { acik: true },
  "vergi.kdv-disi-ayrinti": { acik: true },
  "vergi.kdv-disi-ozet": { acik: true },
};

export const telegramdaAcikRapor = (kod: unknown) => typeof kod === "string" && TELEGRAM_RAPOR_KARARI[kod]?.acik === true;

/** Nakit akışı kaynak kodları ve ekrandaki adları (nakit-pozisyonu.service KAYNAK_ADI). */
const BORDRO_KAYNAKLARI = new Set(["bordro", "bordro_yasal", "Maaş"]);
const PERSONEL = "personel";

type Kayit = Record<string, unknown>;
const nesne = (x: unknown): x is Kayit => !!x && typeof x === "object" && !Array.isArray(x);

/** Nakit pozisyonunun 7/30 günlük vadelerinden maaş kalemleri çıkarılır; yerine panel notu düşülür. */
export function nakitPozisyonunuSuz(sonuc: unknown): unknown {
  if (!nesne(sonuc) || !nesne(sonuc.vadeler)) return sonuc;
  const vadeler: Kayit = {};
  let cikarildi = false;
  for (const [ufuk, v] of Object.entries(sonuc.vadeler)) {
    if (!nesne(v)) { vadeler[ufuk] = v; continue; }
    const suz = (liste: unknown, alan: string) => {
      if (!Array.isArray(liste)) return liste;
      const kalan = liste.filter((k) => !(nesne(k) && BORDRO_KAYNAKLARI.has(String(k[alan]))));
      if (kalan.length !== liste.length) cikarildi = true;
      return kalan;
    };
    vadeler[ufuk] = { ...v, kaynaklar: suz(v.kaynaklar, "ad"), kalemler: suz(v.kalemler, "kaynak") };
  }
  return { ...sonuc, vadeler, ...(cikarildi ? { not: "Maaş ve bordro ödemeleri Telegram'da gösterilmez; giriş/çıkış toplamlarına dahildir. Ayrıntı panelde." } : {}) };
}

function sar(a: AjanAraci): AjanAraci {
  switch (a.ad) {
    case "rapor_katalogu":
      return { ...a, async calistir(b, g) {
        const r = (await a.calistir(b, g)) as { raporlar?: Array<{ kod?: string }> };
        return { ...r, raporlar: (r.raporlar ?? []).filter((x) => telegramdaAcikRapor(x.kod)) };
      } };
    case "rapor_calistir":
      return { ...a, async calistir(b, g) {
        if (!telegramdaAcikRapor((g as { kod?: unknown })?.kod)) throw new BadRequestException("Bu rapor Telegram'da çalıştırılmaz; panelde Raporlar ekranından görüntüleyin.");
        return a.calistir(b, g);
      } };
    case "nakit_pozisyonu":
      return { ...a, async calistir(b, g) { return nakitPozisyonunuSuz(await a.calistir(b, g)); } };
    case "cari_ara":
      return { ...a, async calistir(b, g) {
        if ((g as { tip?: unknown })?.tip === PERSONEL) throw new BadRequestException("Personel carileri Telegram'da gösterilmez; panelde görüntüleyin.");
        const r = (await a.calistir(b, g)) as { kayitlar?: Kayit[] };
        return { ...r, kayitlar: (r.kayitlar ?? []).filter((k) => k.tip !== PERSONEL) };
      } };
    case "cari_getir":
      return { ...a, async calistir(b, g) {
        const r = (await a.calistir(b, g)) as Kayit;
        if (r?.tip === PERSONEL) throw new BadRequestException("Personel carileri Telegram'da gösterilmez; panelde görüntüleyin.");
        return r;
      } };
    default:
      return a;
  }
}

/** Telegram kanalında modele sunulan ve yürütülen araçlar. */
export function telegramAraclari(izinli: AjanAraci[]): AjanAraci[] {
  return izinli.filter((a) => !TELEGRAM_KAPALI_ARACLAR.has(a.ad)).map(sar);
}
