import { BadRequestException, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { cariHareketKurTipi, MUHTELIF_MUSTERI_VKN, muhtelifMusteriMi, vknTcknGecerliMi } from "@tekirextra/shared";
import { aktifBaglam } from "../core/istek-baglami";
import { PrismaService } from "../core/prisma.service";
import { DonemKilidiService } from "../donem-kapatma/donem-kilidi.service";
import { kurCoz } from "../doviz/kur-coz";
import { ebelgeTestOrtamiMi, vknTcknKabulEdilebilirMi } from "../ebelge/vkn-kabulu";
import { gercekKisiUnvani } from "./ad-soyad";
import type { BaslikEslemeleri } from "../veri-aktarimi/tablo";
import {
  cariTablosunuOku, dovizCoz, EPOSTA_DESENI, hataliSatirlarDosyasi, kisiTipiCoz, sablonOlustur, sayiCoz, SUTUNLAR,
  tarihCoz, tipCoz, yonCoz, type Cozum, type HamSatir, type SutunAnahtari,
} from "./cari-ice-aktarma";

type Tx = Prisma.TransactionClient;
type Durum = "yeni" | "guncelle" | "degisiklik_yok" | "hatali";

interface KartVerisi {
  kod?: string; unvan?: string; tip?: string; kisiTipi?: string; ad?: string | null; soyad?: string | null; vknTckn?: string; vergiDairesi?: string;
  eposta?: string; telefon?: string; dovizCinsi?: string; varsayilanVadeGun?: number; varsayilanIskonto?: number; riskLimiti?: number;
}
interface Acilis { tip: "borc" | "alacak"; tutar: number; dovizCinsi: string; kur: Prisma.Decimal; tarih: string; vadeTarihi: string | null }
interface Adres { adres: string; il?: string; ilce?: string; postaKodu?: string; ulke: string }

export interface SatirPlani {
  satir: number;
  durum: Durum;
  kod: string;
  unvan: string;
  degisenAlanlar: string[];
  hatalar: string[];
  uyarilar: string[];
}
interface IcPlan extends SatirPlani {
  ham: HamSatir;
  eslesenId: string | null;
  kart: KartVerisi;
  adres: Adres | null;
  etiketler: string[];
  acilis: Acilis | null;
}

/** VAK-02/03: sihirbazdan gelen seçenekler; doğrudan cari ekranından boş gelir. */
export interface CariAktarimSecenegi {
  eslemeler?: BaslikEslemeleri;
  /** Açılış tutarı olup tarihi boş satırlarda kullanılır (geçiş tarihi). */
  varsayilanAcilisTarihi?: string | null;
}

const BASLIK = Object.fromEntries(SUTUNLAR.map((s) => [s.anahtar, s.baslik])) as Record<SutunAnahtari, string>;
const coz = <T>(c: Cozum<T>, hatalar: string[]): T | undefined => ("hata" in c ? (hatalar.push(c.hata), undefined) : c.deger);

/**
 * CARI-31 (karar 2026-10-03): cari Excel içe aktarma. Satır koda, kod boşsa
 * VKN/TCKN'ye göre eşleşir; eşleşen kartta yalnız dolu hücreler yazılır.
 * Önizleme yazmaz; onayda dosya yeniden doğrulanır ve hatasız satırlar yazılır.
 */
@Injectable()
export class CariIceAktarmaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly donemKilidi: DonemKilidiService,
  ) {}

  sablon() {
    return sablonOlustur();
  }

  async onizleme(buffer: Buffer, secenek: CariAktarimSecenegi = {}) {
    const { plan, basliklar, taninmayanlar } = await this.planla(buffer, secenek);
    return { ozet: this.ozet(plan), basliklar, taninmayanlar, satirlar: plan.map(({ satir, durum, kod, unvan, degisenAlanlar, hatalar, uyarilar }) => ({ satir, durum, kod, unvan, degisenAlanlar, hatalar, uyarilar })) };
  }

  async hataliSatirlar(buffer: Buffer, secenek: CariAktarimSecenegi = {}) {
    const { plan } = await this.planla(buffer, secenek);
    return hataliSatirlarDosyasi(plan.filter((p) => p.durum === "hatali").map((p) => ({ ...p.ham, hatalar: p.hatalar })));
  }

  /** VAK-07: yeni açılan kartların ve yazılan açılış hareketlerinin kimlikleri de döner (geri alma için). */
  async iceAktar(buffer: Buffer, secenek: CariAktarimSecenegi = {}, disTx?: Tx) {
    const { tenantId } = aktifBaglam();
    const { plan } = await this.planla(buffer, secenek);
    const yazilacak = plan.filter((p) => p.durum === "yeni" || p.durum === "guncelle");
    const olusturulanlar = { cariler: [] as string[], cariHareketler: [] as string[] };
    const yaz = async (tx: Tx) => {
      const etiketAdlari = [...new Set(yazilacak.flatMap((p) => p.etiketler))];
      const etiketler = new Map<string, string>();
      for (const ad of etiketAdlari) {
        const e = await tx.cariEtiket.upsert({ where: { tenantId_ad: { tenantId, ad } }, create: { tenantId, ad }, update: {} });
        etiketler.set(ad, e.id);
      }
      for (const p of yazilacak) {
        const veri = {
          ...p.kart,
          varsayilanIskonto: p.kart.varsayilanIskonto === undefined ? undefined : new Prisma.Decimal(p.kart.varsayilanIskonto),
          riskLimiti: p.kart.riskLimiti === undefined ? undefined : new Prisma.Decimal(p.kart.riskLimiti),
        } as Prisma.CariHesapUncheckedUpdateInput;
        const cariId = p.eslesenId
          ? (await tx.cariHesap.update({ where: { id: p.eslesenId }, data: veri, select: { id: true } })).id
          : (await tx.cariHesap.create({ data: { ...(veri as Prisma.CariHesapUncheckedCreateInput), tenantId }, select: { id: true } })).id;
        if (!p.eslesenId) olusturulanlar.cariler.push(cariId);
        if (p.adres) {
          const mevcut = p.eslesenId ? await tx.cariAdres.findFirst({ where: { cariId, tip: "fatura" }, orderBy: { id: "asc" } }) : null;
          if (mevcut) await tx.cariAdres.update({ where: { id: mevcut.id }, data: p.adres });
          else await tx.cariAdres.create({ data: { tenantId, cariId, tip: "fatura", baslik: "Fatura adresi", ...p.adres } });
        }
        if (p.etiketler.length) {
          await tx.cariEtiketAtama.createMany({ data: p.etiketler.map((ad) => ({ tenantId, cariId, etiketId: etiketler.get(ad)! })), skipDuplicates: true });
        }
        if (p.acilis) {
          const a = p.acilis;
          const tutar = new Prisma.Decimal(a.tutar);
          const hareket = await tx.cariHareket.create({
            select: { id: true },
            data: {
              tenantId, cariId, tip: a.tip, tutar, dovizCinsi: a.dovizCinsi as Prisma.CariHareketCreateInput["dovizCinsi"], kur: a.kur, tutarTry: tutar.mul(a.kur).toDecimalPlaces(2),
              tarih: new Date(a.tarih), vadeTarihi: a.vadeTarihi ? new Date(a.vadeTarihi) : null, aciklama: "Açılış bakiyesi (Excel)", kaynakTur: "acilis",
            },
          });
          olusturulanlar.cariHareketler.push(hareket.id);
        }
      }
    };
    if (disTx) await yaz(disTx);
    else await this.prisma.tenantIslem(tenantId, yaz, { timeout: 120_000 });
    return { ...this.ozet(plan), olusturulanlar };
  }

  private ozet(plan: IcPlan[]) {
    const say = (d: Durum) => plan.filter((p) => p.durum === d).length;
    return {
      toplam: plan.length, yeni: say("yeni"), guncelle: say("guncelle"), degisiklikYok: say("degisiklik_yok"), hatali: say("hatali"),
      acilis: plan.filter((p) => p.acilis && (p.durum === "yeni" || p.durum === "guncelle")).length,
    };
  }

  private async planla(buffer: Buffer, secenek: CariAktarimSecenegi = {}): Promise<{ plan: IcPlan[]; basliklar: { baslik: string; anahtar: string | null; elle: boolean }[]; taninmayanlar: string[] }> {
    const { tenantId } = aktifBaglam();
    let satirlar: HamSatir[];
    let basliklar: { baslik: string; anahtar: string | null; elle: boolean }[];
    let taninmayanlar: string[];
    try {
      ({ satirlar, basliklar, taninmayanlar } = await cariTablosunuOku(buffer, secenek.eslemeler));
    } catch (hata) {
      throw new BadRequestException(hata instanceof Error ? hata.message : "Excel dosyası okunamadı");
    }
    if (satirlar.length === 0) throw new BadRequestException("Dosyada başlık satırından sonra veri yok");
    const plan = await this.prisma.tenantIslem(tenantId, (tx) => this.satirlariPlanla(tx, tenantId, satirlar, secenek), { timeout: 120_000 });
    return { plan, basliklar, taninmayanlar };
  }

  private async satirlariPlanla(tx: Tx, tenantId: string, satirlar: HamSatir[], secenek: CariAktarimSecenegi = {}): Promise<IcPlan[]> {
    const [cariler, acilislar, etiketler] = await Promise.all([
      tx.cariHesap.findMany({
        select: {
          id: true, kod: true, unvan: true, tip: true, kisiTipi: true, ad: true, soyad: true, vknTckn: true, vergiDairesi: true, eposta: true, telefon: true,
          dovizCinsi: true, varsayilanVadeGun: true, varsayilanIskonto: true, riskLimiti: true,
          adresler: { where: { tip: "fatura" }, select: { adres: true, il: true, ilce: true, postaKodu: true, ulke: true }, orderBy: { id: "asc" }, take: 1 },
          etiketler: { select: { etiket: { select: { ad: true } } } },
        },
      }),
      tx.cariHareket.groupBy({ by: ["cariId"], where: { kaynakTur: { in: ["acilis", "mali_donem"] } } }),
      tx.cariEtiket.findMany({ select: { ad: true } }),
    ]);
    const kodla = new Map(cariler.map((c) => [c.kod, c]));
    const vknla = new Map<string, typeof cariler>();
    for (const c of cariler) if (c.vknTckn) vknla.set(c.vknTckn, [...(vknla.get(c.vknTckn) ?? []), c]);
    const acilisiVar = new Set(acilislar.map((a) => a.cariId));
    const mevcutEtiketler = new Set(etiketler.map((e) => e.ad));
    let testOrtami: boolean | undefined;
    const kullanilanKodlar = new Set(cariler.map((c) => c.kod));
    let sonNo = Math.max(0, ...cariler.map((c) => /^CARI-(\d+)$/.exec(c.kod)?.[1]).filter(Boolean).map(Number));
    const yeniKod = () => { let k: string; do { sonNo += 1; k = `CARI-${String(sonNo).padStart(3, "0")}`; } while (kullanilanKodlar.has(k)); kullanilanKodlar.add(k); return k; };
    const gorulen = new Map<string, number>();
    const plan: IcPlan[] = [];

    for (const ham of satirlar) {
      const h = ham.hucreler;
      const hatalar: string[] = [];
      const uyarilar: string[] = [];

      // VKN: Excel sayı hücresi baştaki sıfırı düşürür (0123456789 → 123456789).
      let vkn = h.vknTckn?.replace(/\s/g, "");
      if (vkn && /^\d{9}$/.test(vkn)) { vkn = `0${vkn}`; uyarilar.push("VKN 9 haneliydi, başına 0 eklendi"); }
      if (vkn && !/^\d{10,11}$/.test(vkn)) { hatalar.push(`VKN/TCKN 10 ya da 11 haneli olmalı: "${h.vknTckn}"`); vkn = undefined; }

      let eslesen: (typeof cariler)[number] | undefined;
      if (h.kod) {
        eslesen = kodla.get(h.kod);
        const ayniVkn = vkn ? (vknla.get(vkn) ?? []).filter((c) => c.id !== eslesen?.id) : [];
        if (!eslesen && ayniVkn.length) uyarilar.push(`Bu VKN ${ayniVkn.map((c) => c.kod).join(", ")} kartında da kayıtlı; yeni kart açılacak`);
      } else if (vkn) {
        const adaylar = vknla.get(vkn) ?? [];
        if (adaylar.length > 1) hatalar.push(`VKN ${adaylar.length} kartta kayıtlı (${adaylar.map((c) => c.kod).join(", ")}); Kod sütununu doldurun`);
        else eslesen = adaylar[0];
      }
      if (eslesen && muhtelifMusteriMi(eslesen)) hatalar.push("Muhtelif Müşteriler sistem carisi içe aktarmayla değiştirilemez");
      if (vkn === MUHTELIF_MUSTERI_VKN && !eslesen) hatalar.push(`${MUHTELIF_MUSTERI_VKN} GİB'in "Muhtelif Müşteriler" kimliğidir; cari olarak açılamaz`);

      const anahtar = eslesen ? `id:${eslesen.id}` : h.kod ? `kod:${h.kod}` : vkn ? `vkn:${vkn}` : null;
      if (anahtar && gorulen.has(anahtar)) hatalar.push(`Aynı cari dosyada ${gorulen.get(anahtar)}. satırda da var`);
      else if (anahtar) gorulen.set(anahtar, ham.satir);

      const kart: KartVerisi = {};
      if (h.tip) kart.tip = coz(tipCoz(h.tip), hatalar);
      else if (!eslesen) kart.tip = "musteri";
      const kisiTipi = h.kisiTipi ? coz(kisiTipiCoz(h.kisiTipi), hatalar) : eslesen?.kisiTipi ?? "tuzel";
      if (h.kisiTipi || !eslesen) kart.kisiTipi = kisiTipi;
      if (kisiTipi === "gercek") {
        const ad = h.ad ?? eslesen?.ad; const soyad = h.soyad ?? eslesen?.soyad;
        if (!ad || !soyad) hatalar.push("Gerçek kişide Ad ve Soyad zorunludur");
        else {
          if (h.ad || h.soyad || h.kisiTipi || !eslesen) { kart.ad = ad.trim(); kart.soyad = soyad.trim(); kart.unvan = gercekKisiUnvani(ad, soyad); }
          if (h.unvan && h.unvan !== gercekKisiUnvani(ad, soyad)) uyarilar.push("Gerçek kişide ünvan ad ve soyaddan türer; Ünvan sütunu kullanılmadı");
        }
      } else if (kisiTipi === "tuzel") {
        if (h.unvan) kart.unvan = h.unvan;
        else if (!eslesen) hatalar.push("Ünvan zorunludur");
        if (h.kisiTipi && eslesen?.kisiTipi === "gercek") { kart.ad = null; kart.soyad = null; }
      }
      if (kart.unvan && kart.unvan.length > 200) hatalar.push("Ünvan en fazla 200 karakter olabilir");
      if (vkn) {
        if (!vknTcknGecerliMi(vkn)) {
          testOrtami ??= await ebelgeTestOrtamiMi(tx, tenantId);
          if (!vknTcknKabulEdilebilirMi(vkn, testOrtami)) hatalar.push(`VKN/TCKN ${vkn} geçersiz (kontrol hanesi tutmuyor)`);
        }
        kart.vknTckn = vkn;
      }
      if (h.vergiDairesi) kart.vergiDairesi = h.vergiDairesi.slice(0, 120);
      if (h.eposta) { if (EPOSTA_DESENI.test(h.eposta)) kart.eposta = h.eposta; else hatalar.push(`E-posta geçersiz: "${h.eposta}"`); }
      if (h.telefon) { if (h.telefon.length <= 32) kart.telefon = h.telefon; else hatalar.push("Telefon en fazla 32 karakter olabilir"); }
      if (h.dovizCinsi) kart.dovizCinsi = coz(dovizCoz(h.dovizCinsi, "Döviz"), hatalar);
      if (h.varsayilanVadeGun) {
        const v = coz(sayiCoz(h.varsayilanVadeGun, "Vade (gün)", 0, 365), hatalar);
        if (v !== undefined) { if (Number.isInteger(v)) kart.varsayilanVadeGun = v; else hatalar.push("Vade (gün) tam sayı olmalı"); }
      }
      if (h.varsayilanIskonto) kart.varsayilanIskonto = coz(sayiCoz(h.varsayilanIskonto, "İskonto %", 0, 100), hatalar);
      if (h.riskLimiti) kart.riskLimiti = coz(sayiCoz(h.riskLimiti, "Risk limiti"), hatalar);

      let adres: Adres | null = null;
      if (h.adres) {
        const ulke = (h.ulke ?? "TR").toLocaleUpperCase("tr-TR");
        if (h.adres.length < 2 || h.adres.length > 500) hatalar.push("Adres 2–500 karakter olmalı");
        else if (!/^[A-Z]{2}$/.test(ulke)) hatalar.push(`Ülke iki harfli kod olmalı: "${h.ulke}"`);
        else adres = { adres: h.adres, ulke, ...(h.il ? { il: h.il.slice(0, 60) } : {}), ...(h.ilce ? { ilce: h.ilce.slice(0, 60) } : {}), ...(h.postaKodu ? { postaKodu: h.postaKodu.slice(0, 10) } : {}) };
      } else if (h.il || h.ilce || h.postaKodu) uyarilar.push("Adres boş; il, ilçe ve posta kodu yazılmadı");

      const etiketAdlari = [...new Set((h.etiketler ?? "").split(/[,;]/).map((e) => e.trim()).filter(Boolean))];
      if (etiketAdlari.some((e) => e.length > 60)) hatalar.push("Etiket adı en fazla 60 karakter olabilir");
      const yeniEtiketler = etiketAdlari.filter((e) => !mevcutEtiketler.has(e));
      if (yeniEtiketler.length) uyarilar.push(`Yeni etiket oluşturulacak: ${yeniEtiketler.join(", ")}`);
      const eksikEtiketler = etiketAdlari.filter((e) => !eslesen?.etiketler.some((a) => a.etiket.ad === e));

      let acilis: Acilis | null = null;
      const acilisAlanlari = [h.acilisYonu, h.acilisDovizi, h.acilisKuru, h.acilisTarihi, h.acilisVadesi].some(Boolean);
      if (h.acilisTutari) {
        const tutar = coz(sayiCoz(h.acilisTutari, "Açılış bakiyesi"), hatalar);
        if (tutar === 0) uyarilar.push("Açılış bakiyesi 0; yazılmadı");
        else if (tutar !== undefined) {
          const yon = h.acilisYonu ? coz(yonCoz(h.acilisYonu), hatalar) : (hatalar.push("Açılış yönü (Borç/Alacak) zorunludur"), undefined);
          const doviz = h.acilisDovizi ? coz(dovizCoz(h.acilisDovizi, "Açılış dövizi"), hatalar) : kart.dovizCinsi ?? eslesen?.dovizCinsi ?? "TRY";
          const tarih = h.acilisTarihi ? coz(tarihCoz(h.acilisTarihi, "Açılış tarihi"), hatalar)
            : secenek.varsayilanAcilisTarihi ? secenek.varsayilanAcilisTarihi
            : (hatalar.push("Açılış tarihi zorunludur"), undefined);
          const vade = h.acilisVadesi ? coz(tarihCoz(h.acilisVadesi, "Açılış vadesi"), hatalar) : null;
          if (tarih && vade && vade < tarih) hatalar.push("Açılış vadesi açılış tarihinden önce olamaz");
          if (tarih) {
            try { await this.donemKilidi.tarihDogrula(tenantId, tarih, "açılış bakiyesi yazma"); } catch (e) { hatalar.push(e instanceof Error ? e.message : "Mali dönem kapalı"); }
          }
          let kur: Prisma.Decimal | undefined;
          if (doviz === "TRY") kur = new Prisma.Decimal(1);
          else if (h.acilisKuru) {
            const k = coz(sayiCoz(h.acilisKuru, "Açılış kuru"), hatalar);
            if (k === 1 || k === 0) hatalar.push("Dövizli açılışta kur 1 ya da 0 olamaz");
            else if (k !== undefined) kur = new Prisma.Decimal(k);
          } else if (doviz && tarih && yon) {
            const k = await kurCoz(tx, tenantId, doviz, new Date(tarih), cariHareketKurTipi(yon));
            if (k) kur = k; else hatalar.push(`${doviz} için ${tarih} tarihinde TCMB kuru bulunamadı; Açılış kuru sütununu doldurun`);
          }
          if (eslesen && acilisiVar.has(eslesen.id)) uyarilar.push("Kartta açılış bakiyesi var; Excel'deki açılış yazılmadı");
          else if (yon && doviz && tarih && kur && vade !== undefined) acilis = { tip: yon, tutar, dovizCinsi: doviz, kur, tarih, vadeTarihi: vade };
        }
      } else if (acilisAlanlari) uyarilar.push("Açılış bakiyesi boş; açılış sütunları kullanılmadı");

      // Değişen alanlar: yeni kartta dolu olanlar, eşleşende değeri farklı olanlar.
      const degisenAlanlar: string[] = [];
      if (eslesen) {
        const esit = (a: unknown, b: unknown) => (a ?? null) === (b ?? null) || (a !== null && b !== null && a !== undefined && b !== undefined && String(a) === String(b));
        const sayisal = (d: Prisma.Decimal | null) => (d === null ? null : Number(d));
        const onceki: Record<string, unknown> = { ...eslesen, varsayilanIskonto: sayisal(eslesen.varsayilanIskonto), riskLimiti: sayisal(eslesen.riskLimiti) };
        for (const [alan, deger] of Object.entries(kart)) {
          if (deger === undefined || esit(onceki[alan], deger)) { delete (kart as Record<string, unknown>)[alan]; continue; }
          degisenAlanlar.push(BASLIK[alan as SutunAnahtari] ?? alan);
        }
        const eskiAdres = eslesen.adresler[0];
        if (adres && eskiAdres && (["adres", "il", "ilce", "postaKodu", "ulke"] as const).every((k) => adres![k] === undefined || esit(eskiAdres[k], adres![k]))) adres = null;
        if (adres) degisenAlanlar.push("Adres");
        if (eksikEtiketler.length) degisenAlanlar.push("Etiketler");
        if (acilis) degisenAlanlar.push("Açılış bakiyesi");
      } else {
        kart.kod = h.kod ?? yeniKod();
        if (h.kod) kullanilanKodlar.add(h.kod);
        if (!h.kod) uyarilar.push(`Kod verilmedi; ${kart.kod} verilecek`);
      }

      const durum: Durum = hatalar.length ? "hatali" : !eslesen ? "yeni" : degisenAlanlar.length ? "guncelle" : "degisiklik_yok";
      plan.push({
        satir: ham.satir, durum, kod: eslesen?.kod ?? kart.kod ?? h.kod ?? "", unvan: kart.unvan ?? eslesen?.unvan ?? h.unvan ?? "",
        degisenAlanlar, hatalar, uyarilar, ham, eslesenId: eslesen?.id ?? null, kart, adres, etiketler: eksikEtiketler, acilis,
      });
    }
    return plan;
  }
}
