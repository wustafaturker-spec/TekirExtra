import type { CariAnalizSonucu, GecikmeEgilimi } from "./cari-analiz";

/**
 * CARI-43/44: Cari Durum Paneli kuralları. Saf fonksiyon: girdiler mevcut
 * hesaplardan (CARI-30 risk, CARI-20 davranış, CARI-06 yaşlandırma) gelir,
 * burada yeni bir finansal hesap yapılmaz; yalnız eşiklere göre bulgu üretilir.
 * Dil modeli kullanılmaz.
 */

export type BulguOnemi = "kritik" | "uyari" | "bilgi";

/** Cari kartının sekmeleri; panel kartın içinde olduğundan sekmeye geçilir. */
export type CariSekmesi = "genel" | "ekstre" | "crm" | "tahsilat";

/** Hedef ya kartın bir sekmesidir ya da başka bir ekran. */
export type BulguHedefi = { etiket: string; sekme: CariSekmesi } | { etiket: string; adres: string };

export interface DurumBulgusu {
  /** Kuralın kimliği; ekranda anahtar ve testlerde kullanılır. */
  kod: string;
  onem: BulguOnemi;
  mesaj: string;
  /** Kanıt: bulgunun dayandığı ekran (CARI-44). */
  kanit: BulguHedefi;
  /** Önerilen eylem: bulguyu çözecek mevcut akış (CARI-45). Panel kayıt yazmaz. */
  eylem?: BulguHedefi;
}

export interface FinansGirdisi {
  acikBakiyeTry: number;
  vadesiGecmisTry: number;
  enEskiGecikmeGun: number | null;
  mevcutRiskTry: number;
  /** Risk limiti + geçerli teminat (CARI-39); limit tanımsızsa null. */
  kullanilabilirLimitTry: number | null;
  davranis: CariAnalizSonucu;
  egilim: GecikmeEgilimi;
  /** Son 12 ayda karşılıksız çıkan ya da iade edilen alınan çek/senet sayısı. */
  sorunluCekSayisi: number;
  /** Vadesi önümüzdeki 7 gün içinde olan, tahsil edilmemiş alınan çek/senet. */
  yaklasanCek: { sayi: number; tutarTry: number; enYakinVade: string | null };
  /** Süresi 30 gün içinde dolacak geçerli teminatlar. */
  bitenTeminat: { sayi: number; enYakinBitis: string | null };
  acikItirazSayisi: number;
  sonEtkilesim: Date | null;
  /** Tedarikçi yönü: bizim ona borçlarımız. */
  borclarimiz: { vadesiGecmisTry: number; yakinVadeTry: number };
  /** END-19: açık alacağın endeks karşısında reel erimesi (fiyat–endeks plan özelliği açıksa). */
  alacakErimesi?: { kayipTry: number; endeksAdi: string; sonEndeksAyi: string | null } | null;
}

export interface SatisGirdisi {
  /** Geçerliliği 7 gün içinde biten onaylı ya da taslak teklifler. */
  bitenTeklifler: { id: string; no: string | null; gecerlilikTarihi: string }[];
  /** Teslimi tamamlanmamış onaylı satış siparişleri. */
  bekleyenSiparisler: { id: string; no: string | null }[];
}

export interface DurumGirdisi {
  bugun: Date;
  cari: { id: string; tip: string; karaListe: boolean; karaListeNotu: string | null };
  /** CARI-46: rol finansal özeti göremiyorsa yoktur. */
  finans?: FinansGirdisi;
  /** CARI-46: rol belge görmüyorsa yoktur. */
  satis?: SatisGirdisi;
}

export const DURUM_ESIKLERI = {
  /** En eski vadesi geçmiş kalem bu günden eskiyse kritik. */
  kritikGecikmeGun: 30,
  riskKritikOran: 1,
  riskUyariOran: 0.8,
  /** Son 3 ayın ortalama gecikmesi önceki 6 aya göre bu kadar gün artarsa uyarı. */
  kotulesmeGun: 10,
  /** Açık bakiye varken bu kadar gündür etkileşim yoksa bilgi. */
  sessizlikGun: 90,
  /** END-19: açık alacağın reel erimesi bakiyenin bu oranını aşınca bilgi. */
  erimeOrani: 0.005,
} as const;

/** Panel en çok bu kadar bulgu gösterir (CARI-43). */
export const GOSTERILEN_BULGU = 5;

const ONEM_SIRASI: Record<BulguOnemi, number> = { kritik: 0, uyari: 1, bilgi: 2 };
const GUN_MS = 86_400_000;

const tl = (n: number) => `${n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} TL`;
const tarihMetni = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("tr-TR", { timeZone: "UTC" });

export function durumBulgulari(g: DurumGirdisi): DurumBulgusu[] {
  const bulgular: DurumBulgusu[] = [];

  if (g.cari.karaListe) {
    bulgular.push({
      kod: "kara_liste", onem: "kritik",
      mesaj: g.cari.karaListeNotu ? `Cari kara listede: ${g.cari.karaListeNotu}` : "Cari kara listede; yeni belge kesilmeden önce blokajı değerlendirin.",
      kanit: { etiket: "Cari kartı", sekme: "genel" },
    });
  }

  const f = g.finans;
  if (f) {
    if (f.vadesiGecmisTry > 0) {
      const gun = f.enEskiGecikmeGun ?? 0;
      bulgular.push({
        kod: "vadesi_gecmis", onem: gun > DURUM_ESIKLERI.kritikGecikmeGun ? "kritik" : "uyari",
        mesaj: `${tl(f.vadesiGecmisTry)} alacağın vadesi geçti; en eskisi ${gun} gündür bekliyor.`,
        kanit: { etiket: "Ekstre", sekme: "ekstre" },
        eylem: { etiket: "Vade hatırlatması gönder", adres: "/panel/cari/vade-hatirlatma" },
      });
    }

    if (f.kullanilabilirLimitTry !== null && f.kullanilabilirLimitTry > 0) {
      const oran = f.mevcutRiskTry / f.kullanilabilirLimitTry;
      if (oran >= DURUM_ESIKLERI.riskUyariOran) {
        bulgular.push({
          kod: "risk_limiti", onem: oran >= DURUM_ESIKLERI.riskKritikOran ? "kritik" : "uyari",
          mesaj: oran >= DURUM_ESIKLERI.riskKritikOran
            ? `Risk limiti aşıldı: risk ${tl(f.mevcutRiskTry)}, limit ${tl(f.kullanilabilirLimitTry)} (%${Math.round(oran * 100)}).`
            : `Risk limitinin %${Math.round(oran * 100)} kadarı kullanılıyor (${tl(f.mevcutRiskTry)} / ${tl(f.kullanilabilirLimitTry)}).`,
          kanit: { etiket: "Risk özeti", sekme: "genel" },
          eylem: { etiket: `Limiti gözden geçir (öneri ${tl(Number(f.davranis.onerilenRiskLimiti))})`, sekme: "genel" },
        });
      }
    }

    if (f.sorunluCekSayisi > 0) {
      bulgular.push({
        kod: "sorunlu_cek", onem: "uyari",
        mesaj: `Son 12 ayda ${f.sorunluCekSayisi} çek/senet karşılıksız çıktı ya da iade edildi.`,
        kanit: { etiket: "Çek/senet portföyü", adres: "/panel/kasa-banka/cek-senet" },
      });
    }

    const { sonUcAy, oncekiAltiAy } = f.egilim;
    if (sonUcAy !== null && oncekiAltiAy !== null && sonUcAy - oncekiAltiAy > DURUM_ESIKLERI.kotulesmeGun) {
      bulgular.push({
        kod: "davranis_kotulesiyor", onem: "uyari",
        mesaj: `Ödemeler gecikmeye başladı: son 3 ayda ortalama ${Math.round(sonUcAy)} gün, önceki 6 ayda ${Math.round(oncekiAltiAy)} gün gecikme.`,
        kanit: { etiket: "Ödeme davranışı analizi", sekme: "crm" },
        eylem: { etiket: "CRM görevi aç", sekme: "crm" },
      });
    }

    if (f.bitenTeminat.sayi > 0 && f.bitenTeminat.enYakinBitis) {
      bulgular.push({
        kod: "teminat_bitiyor", onem: "uyari",
        mesaj: `${f.bitenTeminat.sayi} teminatın süresi doluyor; ilki ${tarihMetni(f.bitenTeminat.enYakinBitis)}.`,
        kanit: { etiket: "Teminatlar", sekme: "genel" },
      });
    }

    if (f.acikItirazSayisi > 0) {
      bulgular.push({
        kod: "mutabakat_itirazi", onem: "uyari",
        mesaj: `${f.acikItirazSayisi} mutabakata itiraz edildi ve kapatılmadı.`,
        kanit: { etiket: "Mutabakatlar", adres: "/panel/cari/mutabakatlar?durum=itiraz" },
      });
    }

    if (f.borclarimiz.vadesiGecmisTry > 0) {
      bulgular.push({
        kod: "odememiz_gecikti", onem: "uyari",
        mesaj: `Bu cariye ${tl(f.borclarimiz.vadesiGecmisTry)} ödememizin vadesi geçti.`,
        kanit: { etiket: "Ekstre", sekme: "ekstre" },
      });
    } else if (f.borclarimiz.yakinVadeTry > 0) {
      bulgular.push({
        kod: "odememiz_yaklasiyor", onem: "bilgi",
        mesaj: `Önümüzdeki 7 gün içinde bu cariye ${tl(f.borclarimiz.yakinVadeTry)} ödememiz var.`,
        kanit: { etiket: "Ekstre", sekme: "ekstre" },
      });
    }

    if (f.yaklasanCek.sayi > 0 && f.yaklasanCek.enYakinVade) {
      bulgular.push({
        kod: "cek_vadesi", onem: "bilgi",
        mesaj: `${f.yaklasanCek.sayi} çek/senedin (${tl(f.yaklasanCek.tutarTry)}) vadesi 7 gün içinde; ilki ${tarihMetni(f.yaklasanCek.enYakinVade)}.`,
        kanit: { etiket: "Çek/senet portföyü", adres: "/panel/kasa-banka/cek-senet" },
      });
    }

    // END-19: erime açık bakiyenin %0,5'inden azsa gösterilmez (bilgi kirliliği).
    const erime = f.alacakErimesi;
    if (erime && f.acikBakiyeTry > 0 && erime.kayipTry >= Math.max(1, f.acikBakiyeTry * DURUM_ESIKLERI.erimeOrani)) {
      bulgular.push({
        kod: "alacak_erimesi", onem: "bilgi",
        mesaj: `Açık alacak (${tl(f.acikBakiyeTry)}) doğduğu aydan bu yana ${erime.endeksAdi} karşısında reel olarak yaklaşık ${tl(erime.kayipTry)} eridi${erime.sonEndeksAyi ? ` (son açıklanan ay ${erime.sonEndeksAyi.slice(0, 7)})` : ""}.`,
        kanit: { etiket: "Tahsilat performansı raporu", adres: "/panel/raporlar?rapor=cari.tahsilat-performansi&f.erimeEndeksi=TUFE" },
        eylem: { etiket: "Vade hatırlatması gönder", adres: "/panel/cari/vade-hatirlatma" },
      });
    }

    const sessizGun = f.sonEtkilesim ? Math.floor((g.bugun.getTime() - f.sonEtkilesim.getTime()) / GUN_MS) : null;
    if (f.acikBakiyeTry > 0 && (sessizGun === null || sessizGun > DURUM_ESIKLERI.sessizlikGun)) {
      bulgular.push({
        kod: "etkilesim_yok", onem: "bilgi",
        mesaj: sessizGun === null
          ? `${tl(f.acikBakiyeTry)} açık bakiye var ama hiç görüşme kaydı yok.`
          : `${tl(f.acikBakiyeTry)} açık bakiye var; son görüşme ${sessizGun} gün önce.`,
        kanit: { etiket: "CRM", sekme: "crm" },
        eylem: { etiket: "Görüşme kaydet", sekme: "crm" },
      });
    }
  }

  const s = g.satis;
  if (s) {
    if (s.bitenTeklifler.length > 0) {
      const ilk = s.bitenTeklifler[0];
      bulgular.push({
        kod: "teklif_bitiyor", onem: "bilgi",
        mesaj: s.bitenTeklifler.length === 1
          ? `${ilk.no ?? "Taslak teklifin"} geçerliliği ${tarihMetni(ilk.gecerlilikTarihi)} tarihinde bitiyor.`
          : `${s.bitenTeklifler.length} teklifin geçerliliği 7 gün içinde bitiyor; ilki ${tarihMetni(ilk.gecerlilikTarihi)}.`,
        kanit: { etiket: "Teklif", adres: `/panel/belgeler?yon=satis&tur=teklif&odak=${ilk.id}` },
      });
    }
    if (s.bekleyenSiparisler.length > 0) {
      const ilk = s.bekleyenSiparisler[0];
      bulgular.push({
        kod: "teslim_bekliyor", onem: "bilgi",
        mesaj: s.bekleyenSiparisler.length === 1
          ? `${ilk.no ?? "Sipariş"} teslim bekliyor.`
          : `${s.bekleyenSiparisler.length} sipariş teslim bekliyor.`,
        kanit: { etiket: "Sipariş", adres: `/panel/belgeler?yon=satis&tur=siparis&odak=${ilk.id}` },
      });
    }
  }

  // Sıralama kararlı: önce önem, aynı önemde kuralların yukarıdaki sırası.
  return bulgular.map((b, i) => ({ b, i })).sort((x, y) => ONEM_SIRASI[x.b.onem] - ONEM_SIRASI[y.b.onem] || x.i - y.i).map(({ b }) => b);
}

/**
 * CARI-46 (2026-10-17): finansın yalnız özetini gören rol (satış) kara liste,
 * vadesi geçmiş ve risk limiti bulgularını alır; risk limitini değiştirme
 * eylemi finans rolünündür. Satış bulguları (teklif, sipariş) aynen kalır.
 */
const OZET_FINANS_BULGULARI = new Set(["kara_liste", "vadesi_gecmis", "risk_limiti", "teklif_bitiyor", "teslim_bekliyor"]);
export function ozetFinansBulgulari(bulgular: DurumBulgusu[]): DurumBulgusu[] {
  return bulgular
    .filter((b) => OZET_FINANS_BULGULARI.has(b.kod))
    .map((b) => (b.kod === "risk_limiti" ? { ...b, eylem: undefined } : b));
}
