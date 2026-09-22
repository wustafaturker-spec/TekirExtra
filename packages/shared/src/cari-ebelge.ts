/**
 * CARI-23: alıcının hangi e-belgeyle faturalanacağı, cari kartında gösterilmek
 * üzere. Kaynak yerel GİB mükellef listesidir (EBLG-10).
 *
 * e-Fatura mükellefi olmayan alıcı, kaydı olsun olmasın, otomatik olarak
 * e-Arşiv'dir; VKN/TCKN'si olmayan cari de öyle. Liste güncel değilse
 * "bilinmiyor" döner: listeye güvenip sessizce e-Arşiv demek, mükellef alıcıya
 * yanlış belge kesmek olurdu (EBLG-77 ile aynı ilke).
 */

/** `yurtdisi`: EBLG-80 — mal ihracatı ihracat e-Faturasıyla, hizmet e-Arşiv istisna ile kesilir. */
export type CariEbelgeTuru = "efatura" | "earsiv" | "yurtdisi" | "bilinmiyor";

export interface CariEbelgeDurumu {
  tur: CariEbelgeTuru;
  /** e-Fatura'ya ilk kayıt (`FirstCreationTime`), `YYYY-MM-DD`. */
  efaturaKayitTarihi: string | null;
  /** e-İrsaliye mükellefi mi; liste güncel değilse `null`. */
  eirsaliye: boolean | null;
  eirsaliyeKayitTarihi: string | null;
  kamu: boolean;
}

/** Listedeki bir mükellefin kaydı; aynı VKN'nin birden çok etiketi tek kayda indirgenmiştir. */
export interface ListeKaydi {
  ilkKayitZamani: Date | string | null;
  tur?: string | null;
}

const gun = (an: Date | string | null | undefined): string | null => {
  if (!an) return null;
  const tarih = new Date(an);
  return Number.isNaN(tarih.getTime()) ? null : new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul" }).format(tarih);
};

export function cariEbelgeDurumu(girdi: {
  vknTckn: string | null | undefined;
  /** Alıcı yurt dışı mı (`yurtDisiAliciMi`, EBLG-80); GİB listesinden önce gelir. */
  yurtDisi?: boolean;
  efatura: ListeKaydi | null;
  eirsaliye: ListeKaydi | null;
  listeGuncel: boolean;
}): CariEbelgeDurumu {
  if (girdi.yurtDisi) {
    return { tur: "yurtdisi", efaturaKayitTarihi: null, eirsaliye: false, eirsaliyeKayitTarihi: null, kamu: false };
  }
  if (!girdi.vknTckn?.trim()) {
    return { tur: "earsiv", efaturaKayitTarihi: null, eirsaliye: false, eirsaliyeKayitTarihi: null, kamu: false };
  }
  if (!girdi.listeGuncel) {
    return { tur: "bilinmiyor", efaturaKayitTarihi: null, eirsaliye: null, eirsaliyeKayitTarihi: null, kamu: false };
  }
  return {
    tur: girdi.efatura ? "efatura" : "earsiv",
    efaturaKayitTarihi: gun(girdi.efatura?.ilkKayitZamani),
    eirsaliye: Boolean(girdi.eirsaliye),
    eirsaliyeKayitTarihi: gun(girdi.eirsaliye?.ilkKayitZamani),
    kamu: girdi.efatura?.tur === "KAMU",
  };
}

/** Listedeki kısa etiket. */
export const CARI_EBELGE_ETIKETI: Record<CariEbelgeTuru, string> = {
  efatura: "e-Fatura",
  earsiv: "e-Arşiv",
  yurtdisi: "Yurt dışı",
  bilinmiyor: "?",
};
