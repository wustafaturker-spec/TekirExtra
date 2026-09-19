import {
  type YolcuBeraberiBilgisi,
  type YolcuBeraberiEngeli,
  yolcuBeraberiEngelleri,
} from "@tekirextra/shared";

/**
 * Yolcu beraberi (tax-free) alanlarını tek yerde çözer. Sihirbaz önizlemesi ile
 * gönderim aynı işlevi çağırır; işaret konmuş fatura ihracat kanalına düşmez
 * ve alıcının VKN'si aranmaz (satış genel bir cariye kesilir, yolcunun kimliği
 * belgeye yazılır).
 */

export interface YolcuBeraberiFaturaGirdisi {
  tip: string;
  tarih: Date;
  yolcuBeraberi: unknown;
  satirlar: { kdvOrani: unknown; tevkifatKodu?: string | null }[];
}

export interface YolcuBeraberiOzeti {
  yolcuBeraberi: boolean;
  bilgi?: YolcuBeraberiBilgisi;
  engeller: YolcuBeraberiEngeli[];
}

/** Faturaya JSON olarak yazılan bilgiyi okur; bozuk ya da boş kayıt "işaretsiz"dir. */
export function yolcuBeraberiOku(deger: unknown): YolcuBeraberiBilgisi | undefined {
  if (!deger || typeof deger !== "object") return undefined;
  const kayit = deger as { yolcu?: unknown; araciKurum?: unknown };
  if (!kayit.yolcu || typeof kayit.yolcu !== "object") return undefined;
  return {
    yolcu: kayit.yolcu as YolcuBeraberiBilgisi["yolcu"],
    araciKurum: (kayit.araciKurum ?? {}) as YolcuBeraberiBilgisi["araciKurum"],
  };
}

export function yolcuBeraberiOzeti(fatura: YolcuBeraberiFaturaGirdisi): YolcuBeraberiOzeti {
  const bilgi = yolcuBeraberiOku(fatura.yolcuBeraberi);
  if (!bilgi) return { yolcuBeraberi: false, engeller: [] };
  return {
    yolcuBeraberi: true,
    bilgi,
    engeller: yolcuBeraberiEngelleri(bilgi, {
      tip: fatura.tip,
      tarih: fatura.tarih,
      satirlar: fatura.satirlar.map((s) => ({ kdvOrani: Number(s.kdvOrani), tevkifatKodu: s.tevkifatKodu })),
    }),
  };
}
