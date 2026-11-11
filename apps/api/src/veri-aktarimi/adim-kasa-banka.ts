import { Prisma } from "@prisma/client";
import { metinNormalize } from "@tekirextra/shared";
import { sayiCoz, tarihCoz } from "../cari/cari-ice-aktarma";
import type { SatirSonucu } from "./adim";
import type { SutunTanimi, TabloSatiri } from "./tablo";

type Tx = Prisma.TransactionClient;

/** VAK-05: kasa/banka açılış sütunları. Hesaplar önceden açılmış olmalı. */
export const KASA_BANKA_SUTUNLARI = [
  { anahtar: "hesap", baslik: "Hesap", aciklama: "Kasa ya da banka hesabının adı, IBAN'ı ya da hesap numarası", ornek: "Merkez Kasa", esanlamlilar: ["hesap adi", "kasa adi", "kasa", "banka hesabi", "banka", "iban", "hesap no", "hesap numarasi"] },
  { anahtar: "tutar", baslik: "Bakiye", aciklama: "Hesabın dövizinde; eksi değer borç bakiyesi (ör. kredili hesap)", ornek: "15000.00", esanlamlilar: ["tutar", "acilis bakiyesi", "bakiye tutari", "devir bakiyesi", "devir"] },
  { anahtar: "kur", baslik: "Kur", aciklama: "Döviz hesabında boşsa açılış tarihindeki TCMB kuru", ornek: "", esanlamlilar: ["doviz kuru"] },
  { anahtar: "tarih", baslik: "Açılış tarihi", aciklama: "Boşsa geçiş tarihi", ornek: "", esanlamlilar: ["tarih"] },
  { anahtar: "aciklama", baslik: "Açıklama", aciklama: "", ornek: "", esanlamlilar: [] },
] as const satisfies readonly SutunTanimi[];

export type KasaBankaAnahtari = (typeof KASA_BANKA_SUTUNLARI)[number]["anahtar"];

export interface KasaBankaPlani extends SatirSonucu {
  acilis: { tur: "kasa" | "banka"; hesapId: string; tutar: string; tarih: string; kur: string | null; aciklama: string | null } | null;
}

export type TarihDenetimi = (tarih: string) => Promise<string | null>;
/** Döviz hesabında kur boşsa o günün TCMB kuru var mı. */
export type KurVarMi = (doviz: string, tarih: string) => Promise<boolean>;

const ibanNormalize = (s: string) => s.replace(/\s/g, "").toUpperCase();

export async function kasaBankaPlanla(tx: Tx, satirlar: TabloSatiri<KasaBankaAnahtari>[], gecisTarihi: string | null, tarihDenetle: TarihDenetimi, kurVarMi: KurVarMi): Promise<KasaBankaPlani[]> {
  const [kasalar, bankalar] = await Promise.all([
    tx.kasa.findMany({ where: { aktif: true }, select: { id: true, ad: true, dovizCinsi: true } }),
    tx.bankaHesap.findMany({ where: { aktif: true }, select: { id: true, ad: true, iban: true, hesapNo: true, dovizCinsi: true } }),
  ]);
  const hesapKosulu = { OR: [{ kasaId: { in: kasalar.map((k) => k.id) } }, { bankaHesapId: { in: bankalar.map((b) => b.id) } }] };
  const [acilislar, ilkler] = await Promise.all([
    tx.kasaBankaHareket.findMany({ where: { kaynakTur: "acilis", OR: [{ kasaId: { in: kasalar.map((k) => k.id) } }, { bankaHesapId: { in: bankalar.map((b) => b.id) } }] }, select: { kasaId: true, bankaHesapId: true } }),
    tx.kasaBankaHareket.groupBy({ by: ["kasaId", "bankaHesapId"], where: { kaynakTur: { not: "acilis" }, ...hesapKosulu }, _min: { tarih: true } }),
  ]);
  const acilisli = new Set(acilislar.map((a) => a.kasaId ?? a.bankaHesapId));
  const ilkHareket = new Map(ilkler.map((i) => [i.kasaId ?? i.bankaHesapId, i._min.tarih]));
  const adaylar = [
    ...kasalar.map((k) => ({ tur: "kasa" as const, id: k.id, ad: k.ad, doviz: k.dovizCinsi, anahtarlar: [metinNormalize(k.ad)] })),
    ...bankalar.map((b) => ({ tur: "banka" as const, id: b.id, ad: b.ad, doviz: b.dovizCinsi, anahtarlar: [metinNormalize(b.ad), ...(b.iban ? [ibanNormalize(b.iban)] : []), ...(b.hesapNo ? [b.hesapNo.replace(/\s/g, "")] : [])] })),
  ];
  const gorulen = new Map<string, number>();
  const tarihSonuclari = new Map<string, string | null>();
  const plan: KasaBankaPlani[] = [];
  for (const ham of satirlar) {
    const h = ham.hucreler;
    const hatalar: string[] = [];
    const uyarilar: string[] = [];
    let hesap: (typeof adaylar)[number] | undefined;
    if (!h.hesap) hatalar.push("Hesap zorunludur");
    else {
      const aranan = [metinNormalize(h.hesap), ibanNormalize(h.hesap), h.hesap.replace(/\s/g, "")];
      const bulunan = adaylar.filter((a) => a.anahtarlar.some((k) => aranan.includes(k)));
      if (bulunan.length > 1) hatalar.push(`"${h.hesap}" birden çok hesapla eşleşiyor (${bulunan.map((b) => b.ad).join(", ")}); IBAN yazın`);
      else if (!bulunan.length) hatalar.push(`Hesap bulunamadı: ${h.hesap} (sihirbaz hesap açmaz; önce Kasa & Banka ekranında açın)`);
      else hesap = bulunan[0];
    }
    if (hesap && gorulen.has(hesap.id)) hatalar.push(`Aynı hesap dosyada ${gorulen.get(hesap.id)}. satırda da var`);
    else if (hesap) gorulen.set(hesap.id, ham.satir);
    if (hesap && acilisli.has(hesap.id)) hatalar.push("Hesabın açılış fişi zaten var; değiştirmek için hesap ekranını kullanın");
    let tutar: string | undefined;
    if (!h.tutar) hatalar.push("Bakiye zorunludur");
    else {
      const eksi = /^\s*-/.test(h.tutar) || /\(.*\)/.test(h.tutar);
      const t = sayiCoz(h.tutar.replace(/[-()]/g, ""), "Bakiye", 0);
      if ("hata" in t) hatalar.push(t.hata);
      else if (t.deger === 0) hatalar.push("Bakiye sıfır; açılış gerekmez");
      else tutar = (eksi ? -t.deger : t.deger).toFixed(2);
    }
    let kur: string | null = null;
    if (h.kur) {
      if (hesap?.doviz === "TRY") uyarilar.push("TL hesapta kur kullanılmaz");
      else { const k = sayiCoz(h.kur, "Kur", 0); if ("hata" in k) hatalar.push(k.hata); else if (k.deger === 0 || k.deger === 1) hatalar.push("Döviz hesabında kur 0 ya da 1 olamaz"); else kur = String(k.deger); }
    } else if (hesap && hesap.doviz !== "TRY") uyarilar.push(`${hesap.doviz} hesabı; açılış tarihindeki TCMB kuru kullanılacak`);
    let tarih: string | undefined;
    if (h.tarih) { const t = tarihCoz(h.tarih, "Açılış tarihi"); if ("hata" in t) hatalar.push(t.hata); else tarih = t.deger; }
    else if (gecisTarihi) tarih = gecisTarihi;
    else hatalar.push("Açılış tarihi boş ve geçiş tarihi seçilmemiş");
    if (tarih) {
      if (!tarihSonuclari.has(tarih)) tarihSonuclari.set(tarih, await tarihDenetle(tarih));
      const t = tarihSonuclari.get(tarih);
      if (t) hatalar.push(t);
      const ilk = hesap ? ilkHareket.get(hesap.id) : null;
      if (ilk && ilk < new Date(tarih)) hatalar.push(`Hesabın ${ilk.toISOString().slice(0, 10)} tarihli hareketi var; açılış ondan sonra olamaz`);
      if (hesap && hesap.doviz !== "TRY" && !kur && !h.kur && !(await kurVarMi(hesap.doviz, tarih))) hatalar.push(`${hesap.doviz} için ${tarih} tarihinde TCMB kuru bulunamadı; Kur sütununu doldurun`);
    }
    plan.push({
      satir: ham.satir,
      durum: (!hatalar.length && hesap && tutar && tarih) ? "yeni" : "hatali",
      etiket: hesap?.ad ?? h.hesap ?? "",
      aciklama: tutar ? `${tutar} ${hesap?.doviz ?? ""}` : "",
      hatalar, uyarilar,
      acilis: (!hatalar.length && hesap && tutar && tarih) ? { tur: hesap.tur, hesapId: hesap.id, tutar, tarih, kur, aciklama: h.aciklama?.slice(0, 500) ?? null } : null,
    });
  }
  return plan;
}
