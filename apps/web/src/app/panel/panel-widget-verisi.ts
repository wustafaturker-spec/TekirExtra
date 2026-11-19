import { tahsilatTrendiDonemeUygun, takvimGunuMu, type PanelWidget, type TahsilatDonemi, type VadeDonemi } from "@tekirextra/shared";
import { api } from "../../lib/api";
import { finansalOzetGorebilir, rolMenuYoluGorebilir } from "../../lib/rol-yetkileri";

export const WIDGET_KAYNAKLARI = {
  vade: {
    ad: "Fatura ve açılış vadeleri",
    filtreler: {
      alacak: "Gecikmiş alacaklar", borc: "Gecikmiş borçlar",
      alacak_bu_hafta: "Bu haftanın alacakları", borc_bu_hafta: "Bu haftanın borçları",
      alacak_bu_ay: "Bu ayın alacakları", borc_bu_ay: "Bu ayın borçları",
    },
    gorunumler: ["tutar", "sayi", "liste"],
  },
  tahsilat: {
    ad: "Tahsilat",
    filtreler: { bugun: "Bugün", dun: "Dün", bu_hafta: "Bu hafta", bu_ay: "Bu ay" },
    gorunumler: ["tutar", "sayi", "trend"],
  },
  stok: {
    ad: "Stok",
    filtreler: { kritik: "Kritik seviyedeki stok kartları" },
    gorunumler: ["sayi"],
  },
  sabah: {
    ad: "Sabah Onay",
    filtreler: { bekleyen: "Kullanıcı kapsamındaki bekleyenler" },
    gorunumler: ["sayi", "liste"],
  },
} as const;

export const WIDGET_GORUNUMLERI = { tutar: "TL tutarı", sayi: "Kayıt adedi", liste: "İlk 5 kayıt", trend: "Günlük trend" };

export function widgetGorunumleri(kaynak: PanelWidget["kaynak"], filtre: string) {
  return WIDGET_KAYNAKLARI[kaynak].gorunumler.filter(
    (gorunum) => gorunum !== "trend" || tahsilatTrendiDonemeUygun(filtre),
  );
}

export function widgetKaynagiGorunur(kaynak: PanelWidget["kaynak"], rol: string) {
  switch (kaynak) {
    case "vade":
      return finansalOzetGorebilir(rol) && rolMenuYoluGorebilir(rol, "/panel/fatura") && rolMenuYoluGorebilir(rol, "/panel/raporlar");
    case "tahsilat":
      return finansalOzetGorebilir(rol) && rolMenuYoluGorebilir(rol, "/panel/kasa-banka") && rolMenuYoluGorebilir(rol, "/panel/raporlar");
    case "stok":
      return rolMenuYoluGorebilir(rol, "/panel/stok");
    case "sabah":
      return ["yonetici", "muhasebe", "satis"].includes(rol) && rolMenuYoluGorebilir(rol, "/panel/ai/sabah-onay");
  }
}

type Satir = { id: string; baslik: string; detay?: string; tutar?: string; href?: string };
export type TrendGunu = { tarih: string; tutar: string };

type WidgetVerisi = {
  aciklama: string;
  href?: string;
  baglanti?: string;
} & ({ adet: number } | { tutar: string; gunler?: TrendGunu[] } | { satirlar: Satir[] });

type VadeSatiri = { faturaId: string; cariId: string; cariUnvan: string; gecikmeGun: number; vadeTarihi: string; kalanTry: string; acilis?: boolean };

function adetDogrula(adet: number): number {
  if (!Number.isSafeInteger(adet) || adet < 0) throw new Error("Geçersiz kayıt adedi.");
  return adet;
}

function tutarDogrula(tutar: string): string {
  if (typeof tutar !== "string" || !/^-?\d+\.\d{2}$/.test(tutar)) throw new Error("Geçersiz TL tutarı.");
  return tutar;
}

const TL_BICIMI = new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function widgetTutarBicimle(tutar: string): string {
  const [tam, kurus] = tutarDogrula(tutar).split(".");
  // Rapor tutarını Number'a dönüştürmeden kuruşları koru.
  return TL_BICIMI.formatToParts(tam === "-0" ? -0 : BigInt(tam))
    .map((parca) => parca.type === "fraction" ? kurus : parca.value)
    .join("");
}

function tarihBicimle(tarih: string) {
  return tarih.split("-").reverse().join(".");
}

function tarihAraligiBicimle(baslangic: string, bitis: string) {
  if (!takvimGunuMu(baslangic) || !takvimGunuMu(bitis) || baslangic > bitis) {
    throw new Error("Rapor tarih aralığı geçersiz.");
  }
  return baslangic === bitis ? tarihBicimle(bitis) : `${tarihBicimle(baslangic)} – ${tarihBicimle(bitis)}`;
}

function trendDogrula(gunler: TrendGunu[], baslangic: string, bitis: string, toplam: string) {
  const ilkGun = Date.parse(`${baslangic}T00:00:00Z`);
  const sonGun = Date.parse(`${bitis}T00:00:00Z`);
  const gunSayisi = (sonGun - ilkGun) / 86_400_000 + 1;
  if (!Array.isArray(gunler) || gunSayisi > 31 || gunler.length !== gunSayisi) {
    throw new Error("Günlük tahsilat verisi eksik.");
  }
  let kurus = BigInt(0);
  for (const [sira, gun] of gunler.entries()) {
    const beklenen = new Date(ilkGun + sira * 86_400_000).toISOString().slice(0, 10);
    if (gun.tarih !== beklenen) throw new Error("Günlük tahsilat tarihleri uyuşmuyor.");
    kurus += BigInt(tutarDogrula(gun.tutar).replace(".", ""));
  }
  if (kurus !== BigInt(toplam.replace(".", ""))) throw new Error("Günlük tahsilat toplamı uyuşmuyor.");
  return gunler;
}

export async function widgetVerisiniAl(widget: PanelWidget, sinyal: AbortSignal): Promise<WidgetVerisi> {
  const secenek = { signal: sinyal };
  switch (widget.kaynak) {
    case "vade": {
      const alacak = widget.filtre.startsWith("alacak");
      const donem = widget.filtre.endsWith("bu_hafta") ? "bu_hafta" : widget.filtre.endsWith("bu_ay") ? "bu_ay" : null;
      type VadeOzeti = {
        toplamAlacak: string; toplamBorc: string; alacakSayisi: number; borcSayisi: number;
        alacaklar: VadeSatiri[]; borclar: VadeSatiri[];
      };
      const yon = alacak ? "açık alacaklar" : "açık borçlar";
      let veri: VadeOzeti;
      let aciklama: string;
      if (donem) {
        const sonuc = await api<VadeOzeti & { donem: VadeDonemi; baslangic: string; bitis: string }>(
          `/rapor/vade-donemi?donem=${donem}`, secenek,
        );
        if (sonuc.donem !== donem) throw new Error("Rapor dönemi uyuşmuyor.");
        veri = sonuc;
        aciklama = `${tarihAraligiBicimle(sonuc.baslangic, sonuc.bitis)} · Vadesi bu aralıkta olan ${yon}`;
      } else {
        veri = await api<VadeOzeti>("/rapor/vadesi-gecenler", secenek);
        aciklama = `Vadesi geçmiş ${yon}`;
      }
      if (widget.gorunum === "tutar") return { aciklama, tutar: tutarDogrula(alacak ? veri.toplamAlacak : veri.toplamBorc) };
      if (widget.gorunum === "sayi") return { aciklama, adet: adetDogrula(alacak ? veri.alacakSayisi : veri.borcSayisi) };
      const satirlar = (alacak ? veri.alacaklar : veri.borclar).slice(0, 5).map((satir) => ({
        id: satir.faturaId,
        baslik: satir.cariUnvan,
        detay: donem ? `Vade ${tarihBicimle(satir.vadeTarihi)}` : `${satir.gecikmeGun} gün gecikti`,
        tutar: tutarDogrula(satir.kalanTry),
        href: satir.acilis ? `/panel/cari/${encodeURIComponent(satir.cariId)}` : `/panel/fatura?faturaId=${encodeURIComponent(satir.faturaId)}&panel=odeme`,
      }));
      return { aciklama, satirlar };
    }
    case "tahsilat": {
      const veri = await api<{ donem: TahsilatDonemi; baslangic: string; bitis: string; toplam: string; adet: number; gunler: TrendGunu[] }>(
        `/rapor/tahsilat-donemi?donem=${widget.filtre}`, secenek,
      );
      if (veri.donem !== widget.filtre) throw new Error("Rapor dönemi uyuşmuyor.");
      const aralik = tarihAraligiBicimle(veri.baslangic, veri.bitis);
      const aciklama = `${aralik} · Çek ve senet dahil`;
      if (widget.gorunum === "sayi") return { aciklama, adet: adetDogrula(veri.adet) };
      const tutar = tutarDogrula(veri.toplam);
      const gunler = widget.gorunum === "trend" ? trendDogrula(veri.gunler, veri.baslangic, veri.bitis, tutar) : undefined;
      return { aciklama, tutar, ...(gunler && { gunler }) };
    }
    case "stok": {
      const veri = await api<{ kritikStok: number }>("/stok/kritik-ozeti", secenek);
      return { aciklama: "Mevcut miktarı kritik seviyeye eşit veya altında olan kartlar", adet: adetDogrula(veri.kritikStok), href: "/panel/stok", baglanti: "Stok kartlarını aç" };
    }
    case "sabah": {
      const ortak = { aciklama: "Kullanıcıya ait ve ortak bekleyen hazırlıklar", href: "/panel/ai/sabah-onay", baglanti: "Sabah Onay Kutusu’nu aç" };
      if (widget.gorunum === "sayi") {
        const veri = await api<{ adet: number }>("/ai/hazirlik/bekleyen-sayisi", secenek);
        return { ...ortak, adet: adetDogrula(veri.adet) };
      }
      const veri = await api<{ id: string; baslik: string; turBasligi: string }[]>("/ai/hazirlik?kapsam=bana&durum=hazir&limit=5", secenek);
      return { ...ortak, satirlar: veri.map((satir) => ({ id: satir.id, baslik: satir.baslik, detay: satir.turBasligi })) };
    }
  }
}
