import { Prisma } from "@prisma/client";
import { sayiCoz, tarihCoz } from "../cari/cari-ice-aktarma";
import type { SatirSonucu } from "./adim";
import type { SutunTanimi, TabloSatiri } from "./tablo";

type Tx = Prisma.TransactionClient;
const D = (d: Prisma.Decimal.Value) => new Prisma.Decimal(d);

/** VAK-04: açılış stoğu sütunları. */
export const ACILIS_STOK_SUTUNLARI = [
  { anahtar: "stokKodu", baslik: "Stok kodu", aciklama: "Zorunlu; kart önce Stok kartları adımında açılmış olmalı", ornek: "URN-001", esanlamlilar: ["kod", "malzeme kodu", "urun kodu", "mal kodu"] },
  { anahtar: "varyantKodu", baslik: "Varyant kodu", aciklama: "Varyantlı kartta zorunlu", ornek: "", esanlamlilar: ["varyant", "varyant kod"] },
  { anahtar: "depoKodu", baslik: "Depo kodu", aciklama: "Boşsa varsayılan depo", ornek: "", esanlamlilar: ["depo", "ambar", "ambar kodu", "ambar no", "depo no"] },
  { anahtar: "miktar", baslik: "Miktar", aciklama: "Kartın ana biriminde, sıfırdan büyük", ornek: "10", esanlamlilar: ["eldeki miktar", "mevcut", "stok miktari", "fiili stok", "bakiye miktar", "kalan miktar"] },
  { anahtar: "birimMaliyet", baslik: "Birim maliyet", aciklama: "TL, KDV hariç; ortalama maliyet bununla başlar", ornek: "125.50", esanlamlilar: ["maliyet", "birim fiyat", "ortalama maliyet", "birim maliyet tl", "alis fiyati"] },
  { anahtar: "lotNo", baslik: "Lot no", aciklama: "Lot takipli kartta zorunlu", ornek: "", esanlamlilar: ["lot", "parti no", "parti"] },
  { anahtar: "seriNo", baslik: "Seri no", aciklama: "Seri takipli kartta zorunlu; satır başına 1 adet", ornek: "", esanlamlilar: ["seri", "seri numarasi"] },
  { anahtar: "sonKullanma", baslik: "Son kullanma tarihi", aciklama: "gg.aa.yyyy", ornek: "", esanlamlilar: ["skt", "son kullanma"] },
  { anahtar: "tarih", baslik: "Açılış tarihi", aciklama: "Boşsa geçiş tarihi", ornek: "", esanlamlilar: ["tarih"] },
] as const satisfies readonly SutunTanimi[];

export type AcilisStokAnahtari = (typeof ACILIS_STOK_SUTUNLARI)[number]["anahtar"];

export interface AcilisStokPlani extends SatirSonucu {
  hareket: {
    stokId: string; varyantId: string | null; depoId: string; miktar: Prisma.Decimal; birimMaliyet: Prisma.Decimal; anaBirim: string; tarih: string;
    parti: { lotNo: string; seriNo: string | null; sonKullanmaTarihi: string | null } | null;
  } | null;
}

export type TarihDenetimi = (tarih: string) => Promise<string | null>;

export async function acilisStokPlanla(tx: Tx, satirlar: TabloSatiri<AcilisStokAnahtari>[], gecisTarihi: string | null, tarihDenetle: TarihDenetimi): Promise<AcilisStokPlani[]> {
  const kodlar = [...new Set(satirlar.map((s) => s.hucreler.stokKodu).filter((k): k is string => Boolean(k)))];
  const [kartlar, depolar] = await Promise.all([
    kodlar.length
      ? tx.stokKart.findMany({ where: { kod: { in: kodlar } }, select: { id: true, kod: true, ad: true, tip: true, anaBirim: true, takipTipi: true, varyantlar: { where: { aktif: true }, select: { id: true, kod: true } } } })
      : Promise.resolve([]),
    tx.depo.findMany({ where: { aktif: true }, select: { id: true, kod: true, varsayilan: true }, orderBy: { createdAt: "asc" } }),
  ]);
  const kodla = new Map(kartlar.map((k) => [k.kod, k]));
  const depoKodla = new Map(depolar.map((d) => [d.kod.toLocaleUpperCase("tr-TR"), d]));
  const varsayilanDepo = depolar.find((d) => d.varsayilan) ?? depolar[0];
  const kartIdler = kartlar.map((k) => k.id);
  // Kartta ilk hareketin tarihi ve var olan açılışlar (depo + varyant + lot/seri).
  const [ilkler, mevcutAcilislar] = await Promise.all([
    kartIdler.length ? tx.stokHareket.groupBy({ by: ["stokId"], where: { stokId: { in: kartIdler }, tip: { not: "acilis" } }, _min: { tarih: true } }) : Promise.resolve([]),
    kartIdler.length ? tx.stokHareket.findMany({ where: { stokId: { in: kartIdler }, tip: "acilis" }, select: { stokId: true, varyantId: true, depoId: true } }) : Promise.resolve([]),
  ]);
  const ilkHareket = new Map(ilkler.map((i) => [i.stokId, i._min.tarih]));
  const acilisVar = new Set(mevcutAcilislar.map((a) => `${a.stokId}|${a.varyantId ?? ""}|${a.depoId}`));
  const gorulen = new Map<string, number>();
  const tarihSonuclari = new Map<string, string | null>();
  const plan: AcilisStokPlani[] = [];
  for (const ham of satirlar) {
    const h = ham.hucreler;
    const hatalar: string[] = [];
    const uyarilar: string[] = [];
    const kart = h.stokKodu ? kodla.get(h.stokKodu) : undefined;
    if (!h.stokKodu) hatalar.push("Stok kodu zorunludur");
    else if (!kart) hatalar.push(`Stok kartı bulunamadı: ${h.stokKodu} (önce Stok kartları adımını uygulayın)`);
    else if (kart.tip === "hizmet") hatalar.push(`${kart.kod} bir hizmet kartı; stok tutmaz`);
    let varyantId: string | null = null;
    if (kart?.varyantlar.length) {
      const v = h.varyantKodu ? kart.varyantlar.find((x) => x.kod === h.varyantKodu) : undefined;
      if (!h.varyantKodu) hatalar.push(`${kart.kod} varyantlı bir kart; Varyant kodu zorunludur`);
      else if (!v) hatalar.push(`Varyant bulunamadı: ${h.varyantKodu}`);
      else varyantId = v.id;
    } else if (h.varyantKodu && kart) uyarilar.push("Kartın varyantı yok; Varyant kodu kullanılmadı");
    const depo = h.depoKodu ? depoKodla.get(h.depoKodu.toLocaleUpperCase("tr-TR")) : varsayilanDepo;
    if (!depo) hatalar.push(h.depoKodu ? `Depo bulunamadı: ${h.depoKodu}` : "Firmada depo yok; önce bir depo açın");
    const miktarC = h.miktar ? sayiCoz(h.miktar, "Miktar", 0) : { hata: "Miktar zorunludur" };
    const miktar = "hata" in miktarC ? (hatalar.push(miktarC.hata), undefined) : miktarC.deger;
    if (miktar === 0) hatalar.push("Miktar sıfırdan büyük olmalı");
    const maliyetC = h.birimMaliyet ? sayiCoz(h.birimMaliyet, "Birim maliyet", 0) : { hata: "Birim maliyet zorunludur" };
    const maliyet = "hata" in maliyetC ? (hatalar.push(maliyetC.hata), undefined) : maliyetC.deger;
    let tarih: string | undefined;
    if (h.tarih) { const t = tarihCoz(h.tarih, "Açılış tarihi"); if ("hata" in t) hatalar.push(t.hata); else tarih = t.deger; }
    else if (gecisTarihi) tarih = gecisTarihi;
    else hatalar.push("Açılış tarihi boş ve geçiş tarihi seçilmemiş");
    if (tarih) {
      if (!tarihSonuclari.has(tarih)) tarihSonuclari.set(tarih, await tarihDenetle(tarih));
      const t = tarihSonuclari.get(tarih);
      if (t) hatalar.push(t);
      const ilk = kart ? ilkHareket.get(kart.id) : null;
      if (ilk && ilk < new Date(tarih)) hatalar.push(`Kartın ${ilk.toISOString().slice(0, 10)} tarihli hareketi var; açılış ondan sonra olamaz`);
    }
    let parti: NonNullable<AcilisStokPlani["hareket"]>["parti"] = null;
    if (kart?.takipTipi === "lot" || kart?.takipTipi === "seri") {
      const seri = kart.takipTipi === "seri";
      if (seri && !h.seriNo) hatalar.push("Seri takipli kartta Seri no zorunludur");
      if (!seri && !h.lotNo) hatalar.push("Lot takipli kartta Lot no zorunludur");
      if (seri && miktar !== undefined && miktar !== 1) hatalar.push("Seri takipte her satır 1 adet olmalı");
      let skt: string | null = null;
      if (h.sonKullanma) { const s = tarihCoz(h.sonKullanma, "Son kullanma tarihi"); if ("hata" in s) hatalar.push(s.hata); else skt = s.deger; }
      parti = { lotNo: h.lotNo ?? h.seriNo ?? "", seriNo: seri ? h.seriNo ?? null : null, sonKullanmaTarihi: skt };
    } else if ((h.lotNo || h.seriNo) && kart) uyarilar.push("Kartta lot/seri takibi açık değil; Lot ve Seri no kullanılmadı");
    const yer = kart && depo ? `${kart.id}|${varyantId ?? ""}|${depo.id}` : null;
    if (yer && acilisVar.has(yer)) hatalar.push("Bu kart, varyant ve depo için açılış stoğu zaten var");
    const satirAnahtari = yer ? `${yer}|${parti?.lotNo ?? ""}|${parti?.seriNo ?? ""}` : null;
    if (satirAnahtari && gorulen.has(satirAnahtari)) hatalar.push(`Aynı kart, depo ve lot/seri dosyada ${gorulen.get(satirAnahtari)}. satırda da var`);
    else if (satirAnahtari) gorulen.set(satirAnahtari, ham.satir);
    plan.push({
      satir: ham.satir,
      durum: (!hatalar.length && kart && depo && miktar !== undefined && maliyet !== undefined && tarih) ? "yeni" : "hatali",
      etiket: h.stokKodu ?? "",
      aciklama: kart ? `${kart.ad} · ${h.miktar ?? ""} ${kart.anaBirim}` : "",
      hatalar, uyarilar,
      hareket: (!hatalar.length && kart && depo && miktar !== undefined && maliyet !== undefined && tarih) ? { stokId: kart.id, varyantId, depoId: depo.id, miktar: D(miktar), birimMaliyet: D(maliyet), anaBirim: kart.anaBirim, tarih, parti } : null,
    });
  }
  return plan;
}
