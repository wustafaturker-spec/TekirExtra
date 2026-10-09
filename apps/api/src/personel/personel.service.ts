import { Injectable, NotFoundException, BadRequestException, Optional } from "@nestjs/common";
import { PrismaService } from "../core/prisma.service";
import { DonemKilidiService } from "../donem-kapatma/donem-kilidi.service";
import { 
  personelOlusturSemasi, 
  personelGuncelleSemasi, 
  bordroTahakkukSemasi, 
  bordroOdeSemasi, 
  avansOlusturSemasi 
} from "./personel.semalar";
import { personelIstenCikarSemasi, personelYenidenBaslatSemasi } from "./personel.semalar";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { bordroKalemOlusturSemasi } from "./personel.semalar";
import { avansMahsupSemasi, avansOdeSemasi } from "./personel.semalar";
import { hassasCoz, hassasSifrele, personelMaskele } from "./personel-hassas";
import { metinNormalize } from "@tekirextra/shared";
import { puantajOku, puantajSablonu } from "./puantaj-excel";
import { bordroHesapla } from "./bordro-hesaplama";
import { donemBordroMevzuati, mevzuatYokMesaji, type DonemBordroMevzuati } from "./bordro-mevzuati";
import { hesapOzetiTutari } from "./personel-rapor-yardimci";
import { donemCalismaSemasi, personelUcretSemasi } from "./personel.semalar";
import { sgkDevirleriniDonemeTasi, type SgkMatrahDevirKalemi } from "./sgk-matrah-devri";
import { donemSinirlari, istihdamGunu, izinliPrimGunu, tahakkukKapsamiKosulu, type UcretsizIzin } from "./tahakkuk-kapsami";
import { donemUcreti, nettenBrute } from "./ucret-donemi";
import { CIKIS_NEDENLERI, cikisHesapla, KidemTavaniYokHatasi, type IhbarDurumu } from "./cikis-hesabi";
import { kidemTavaniOku } from "../mevzuat/kanuni-deger";
import { cikisOnizlemeSemasi } from "./personel.semalar";
import { CIKIS_NEDENI_SGK_KODU } from "./sgk-kodlari";

const PERSONEL_GUVENLI_SECIM = { id: true, personelNo: true, ad: true, soyad: true, departman: true, unvan: true, calismaTipi: true, durum: true, netMaas: true, brutMaas: true, engellilikDerecesi: true, sgkTesvikOrani: true, cariId: true } as const;

function hesapOzetindenSgkDevirleri(ozet: Prisma.JsonValue | null, kaynakYil: number, kaynakAy: number, hedefYil: number, hedefAy: number) {
  if (!ozet || typeof ozet !== "object" || Array.isArray(ozet)) return [];
  const ham = (ozet as Record<string, Prisma.JsonValue>).sgkMatrahDevirleri;
  if (!Array.isArray(ham)) return [];
  const devirler = ham.flatMap((kalem): SgkMatrahDevirKalemi[] => {
    if (!kalem || typeof kalem !== "object" || Array.isArray(kalem)) return [];
    const kayit = kalem as Record<string, Prisma.JsonValue>;
    const tutar = kayit.tutar;
    const kalanAy = kayit.kalanAy;
    return (typeof tutar === "string" || typeof tutar === "number") && (kalanAy === 1 || kalanAy === 2)
      ? [{ tutar, kalanAy }]
      : [];
  });
  return sgkDevirleriniDonemeTasi(devirler, kaynakYil, kaynakAy, hedefYil, hedefAy);
}

/**
 * PRS-04 (P0-2, karar 2026-10-04): cariye yazılan tahakkuk, avans mahsubu
 * öncesi net ücrettir. Avans ödemesi cariye ayrıca borç yazıldığı için
 * avans + maaş ödemesi tahakkuku tam kapatır.
 */
/** PRS-23: gönderilen SGK kart alanları; boş metin null olur. */
function sgkKartAlanlari(v: Partial<Pick<z.infer<typeof personelOlusturSemasi>, "meslekKodu" | "sgkBelgeTuru" | "ogrenimDurumu" | "mezuniyetYili" | "mezuniyetBolumu" | "eskiHukumlu" | "tesvikKanunNo">>) {
  return {
    ...(v.meslekKodu !== undefined && { meslekKodu: v.meslekKodu || null }),
    ...(v.sgkBelgeTuru !== undefined && { sgkBelgeTuru: v.sgkBelgeTuru }),
    ...(v.ogrenimDurumu !== undefined && { ogrenimDurumu: v.ogrenimDurumu }),
    ...(v.mezuniyetYili !== undefined && { mezuniyetYili: v.mezuniyetYili }),
    ...(v.mezuniyetBolumu !== undefined && { mezuniyetBolumu: v.mezuniyetBolumu || null }),
    ...(v.eskiHukumlu !== undefined && { eskiHukumlu: v.eskiHukumlu }),
    ...(v.tesvikKanunNo !== undefined && { tesvikKanunNo: v.tesvikKanunNo || null }),
  };
}

export function cariTahakkukTutari(b: { odenecekTutar: Prisma.Decimal; kalemler: { avansId: string | null; tutar: Prisma.Decimal }[] }): Prisma.Decimal {
  return b.kalemler.filter((k) => k.avansId).reduce((t, k) => t.add(k.tutar), new Prisma.Decimal(b.odenecekTutar));
}

const donemSonu = (yil: number, ay: number) => new Date(Date.UTC(yil, ay, 0));

@Injectable()
export class PersonelService {
  constructor(private readonly prisma: PrismaService, @Optional() private readonly donemKilidi?: DonemKilidiService) {}

  /**
   * P2-3 (PRS-14): aksansız Türkçe arama (ad, soyad, personel no, departman,
   * unvan) ve durum/departman süzgeci. `adet` verilirse sayfalı yanıt
   * ({ kayitlar, sonrakiImlec, toplam }); verilmezse diğer ekranlar için dizi.
   * KOBİ kadroları küçük olduğundan süzme bellekte yapılır.
   */
  async listele(tenantId: string, arama?: string, secenekler: { durum?: string; departmanId?: string; adet?: number; imlec?: string } = {}) {
    const durumlar = ["taslak", "aktif", "askida", "uzun_sureli_izin", "isten_ayrildi"] as const;
    const durum = durumlar.find((d) => d === secenekler.durum);
    const personeller = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.personel.findMany({
        where: { tenantId, ...(durum ? { durum } : secenekler.durum === "calisan" ? { durum: { not: "isten_ayrildi" } } : {}), ...(secenekler.departmanId ? { departmanId: secenekler.departmanId } : {}) },
        include: { cari: { select: { id: true, kod: true, unvan: true } } },
        orderBy: [{ ad: "asc" }, { soyad: "asc" }, { id: "asc" }],
      })
    );
    const aranan = arama ? metinNormalize(arama) : "";
    // Veritabanı harmanlaması Türkçe değil (Ç, İ, Ş yanlış yerde); sıra bellekte.
    personeller.sort((x, y) => `${x.ad} ${x.soyad}`.localeCompare(`${y.ad} ${y.soyad}`, "tr") || x.id.localeCompare(y.id));
    const suzulmus = aranan ? personeller.filter((p) => metinNormalize([p.ad, p.soyad, p.personelNo, p.departman, p.unvan].filter(Boolean).join(" ")).includes(aranan)) : personeller;
    const maskeli = suzulmus.map(personelMaskele);
    if (!secenekler.adet) return maskeli;
    const bas = secenekler.imlec ? maskeli.findIndex((p) => p.id === secenekler.imlec) + 1 : 0;
    const dilim = maskeli.slice(bas, bas + secenekler.adet);
    return { kayitlar: dilim, sonrakiImlec: maskeli.length > bas + secenekler.adet ? dilim.at(-1)!.id : null, toplam: maskeli.length };
  }

  async getir(tenantId: string, id: string) {
    const personel = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.personel.findFirst({
        where: { id, tenantId },
        include: {
          cari: true,
          bordrolar: { orderBy: [{ donemYil: "desc" }, { donemAy: "desc" }] },
          avanslar: { orderBy: { tarih: "desc" } },
          istihdamDonemleri: { orderBy: { baslangicTarihi: "desc" } },
          ucretler: { orderBy: { yururlukTarihi: "desc" } },
        }
      })
    );
    if (!personel) throw new NotFoundException("Personel bulunamadı");
    return personelMaskele(personel);
  }

  async bordroListele(tenantId: string, donemYil?: number, donemAy?: number) {
    return this.prisma.tenantIslem(tenantId, (tx) => tx.personelBordro.findMany({
      where: {
        tenantId,
        ...(donemYil ? { donemYil } : {}),
        ...(donemAy ? { donemAy } : {}),
      },
      include: { personel: { select: { id: true, personelNo: true, ad: true, soyad: true } } },
      orderBy: [{ donemYil: "desc" }, { donemAy: "desc" }, { personel: { ad: "asc" } }],
    }));
  }

  /** PRS-09: dönemle kesişen onaylı ücretsiz izinler, personel başına. */
  private async ucretsizIzinler(tx: Prisma.TransactionClient, tenantId: string, personelIdler: string[], yil: number, ay: number): Promise<Map<string, UcretsizIzin[]>> {
    const bas = new Date(Date.UTC(yil, ay - 1, 1)), son = new Date(Date.UTC(yil, ay, 0));
    const talepler = personelIdler.length ? await tx.personelIzinTalebi.findMany({
      where: { tenantId, personelId: { in: personelIdler }, durum: "onaylandi", izinTuru: { ucretli: false }, baslangicTarihi: { lte: son }, bitisTarihi: { gte: bas } },
      select: { personelId: true, baslangicTarihi: true, bitisTarihi: true, izinTuru: { select: { kod: true } } },
    }) : [];
    const harita = new Map<string, UcretsizIzin[]>();
    for (const t of talepler) harita.set(t.personelId, [...(harita.get(t.personelId) ?? []), { baslangicTarihi: t.baslangicTarihi, bitisTarihi: t.bitisTarihi, turKod: t.izinTuru.kod }]);
    return harita;
  }

  /** PRS-02: dönemle kesişen istihdamı olan herkes; `istihdamGunu` puantajın varsayılan prim günüdür. */
  async donemCalismaListele(tenantId: string, yil: number, ay: number) {
    const personeller = await this.prisma.tenantIslem(tenantId, (tx) => tx.personel.findMany({
      where: tahakkukKapsamiKosulu(tenantId, yil, ay),
      select: { id: true, personelNo: true, ad: true, soyad: true, durum: true, sgkTesvikOrani: true, donemCalismalari: { where: { yil, ay }, take: 1 }, istihdamDonemleri: { select: { baslangicTarihi: true, bitisTarihi: true } } },
      orderBy: { ad: "asc" },
    }));
    const izinler = await this.prisma.tenantIslem(tenantId, (tx) => this.ucretsizIzinler(tx, tenantId, personeller.map((p) => p.id), yil, ay));
    // PRS-09: puantaj girilmemişse prim günü ve eksik gün nedeni onaylı ücretsiz izinlerden önerilir.
    return personeller.map(({ istihdamDonemleri, ...p }) => {
      const oneri = izinliPrimGunu(istihdamDonemleri, izinler.get(p.id) ?? [], yil, ay);
      return { ...p, istihdamGunu: oneri.istihdamGunu, ucretsizIzinGunu: oneri.ucretsizIzinGunu, onerilenPrimGunu: oneri.primGunu, onerilenEksikGunNedeni: oneri.eksikGunNedeni };
    });
  }

  async donemCalismaKaydet(tenantId: string, girdi: z.infer<typeof donemCalismaSemasi>) {
    const v = donemCalismaSemasi.parse(girdi);
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const personel = await tx.personel.findFirst({ where: { id: v.personelId, ...tahakkukKapsamiKosulu(tenantId, v.yil, v.ay) }, select: { id: true, istihdamDonemleri: { select: { baslangicTarihi: true, bitisTarihi: true } } } });
      if (!personel) throw new NotFoundException("Personelin bu dönemde istihdamı yok");
      // Eksik gün nedeni istihdam içinde çalışılmayan gün içindir; ay içi giriş/çıkış günleri neden istemez.
      const gun = istihdamGunu(personel.istihdamDonemleri, v.yil, v.ay);
      if (v.primGunu > gun) throw new BadRequestException(`Prim günü bu dönemdeki istihdam gününü (${gun}) aşamaz`);
      if (v.primGunu < gun && !v.eksikGunNedeni) throw new BadRequestException(`İstihdam günü ${gun}; daha az bildirimde eksik gün nedeni zorunludur`);
      if (v.primGunu === gun && v.eksikGunNedeni) throw new BadRequestException("İstihdam süresinin tamamında çalışmada eksik gün nedeni seçilemez");
      const bordro = await tx.personelBordro.findUnique({ where: { tenantId_personelId_donemYil_donemAy: { tenantId, personelId: v.personelId, donemYil: v.yil, donemAy: v.ay } }, select: { id: true } });
      if (bordro) throw new BadRequestException("Tahakkuk oluşturulduktan sonra çalışma günü değiştirilemez");
      return tx.personelDonemCalisma.upsert({ where: { tenantId_personelId_yil_ay: { tenantId, personelId: v.personelId, yil: v.yil, ay: v.ay } }, create: { tenantId, ...v }, update: { primGunu: v.primGunu, eksikGunNedeni: v.eksikGunNedeni ?? null, aciklama: v.aciklama ?? null, sgkTesvikOrani: v.sgkTesvikOrani ?? null, sahisSigortaPrimi:v.sahisSigortaPrimi, hayatSigortaPrimi:v.hayatSigortaPrimi, sendikaAidati:v.sendikaAidati, fazlaMesaiBrut:v.fazlaMesaiBrut, primIkramiyeBrut:v.primIkramiyeBrut, nakitYemekYardimi:v.nakitYemekYardimi, fiiliCalismaGunu:v.fiiliCalismaGunu } });
    });
  }

  async bordroGetir(tenantId: string, id: string) {
    const bordro = await this.prisma.tenantIslem(tenantId, (tx) => tx.personelBordro.findFirst({
      where: { id, tenantId },
      include: {
        personel: { select: PERSONEL_GUVENLI_SECIM },
        kalemler: { orderBy: [{ tip: "asc" }, { createdAt: "asc" }] },
        odemeler: { orderBy: [{ tarih: "desc" }, { createdAt: "desc" }] },
        mevzuatKaydi: { select: { id: true, yururlukBaslangic: true, yururlukBitis: true, degisiklik: { select: { no: true, baslik: true, dayanak: true } } } },
      },
    }));
    if (!bordro) throw new NotFoundException("Bordro bulunamadı");
    return bordro;
  }

  async olustur(tenantId: string, girdi: z.infer<typeof personelOlusturSemasi>) {
    const veri = personelOlusturSemasi.parse(girdi);

    return this.prisma.tenantIslem(tenantId, async (tx) => {
      let cariId: string | undefined = undefined;
      const sayac = await tx.personelSayac.upsert({
        where: { tenantId },
        create: { tenantId, sonSira: 1 },
        update: { sonSira: { increment: 1 } },
      });
      const personelNo = `PRS-${String(sayac.sonSira).padStart(6, "0")}`;

      if (veri.cariOlustur) {
        const yeniCari = await tx.cariHesap.create({
          data: {
            tenantId,
            kod: personelNo,
            unvan: `${veri.ad} ${veri.soyad}`,
            tip: "personel",
            kisiTipi: "gercek",
            ad: veri.ad,
            soyad: veri.soyad,
            eposta: veri.eposta || null,
            telefon: veri.telefon || null,
            iban: veri.iban || null,
            vknTckn: veri.tckn || null,
          }
        });
        cariId = yeniCari.id;
      }

      const personel = await tx.personel.create({
        data: {
          tenantId,
          personelNo,
          ad: veri.ad,
          soyad: veri.soyad,
          tckn: hassasSifrele(veri.tckn),
          eposta: veri.eposta || null,
          telefon: veri.telefon || null,
          adres: veri.adres || null,
          departman: veri.departman || null,
          unvan: veri.unvan || null,
          calismaTipi: veri.calismaTipi,
          girisTarihi: veri.girisTarihi,
          cikisTarihi: veri.cikisTarihi || null,
          netMaas: veri.netMaas,
          brutMaas: veri.brutMaas ?? null,
          engellilikDerecesi: veri.engellilikDerecesi ?? null,
          dogumTarihi: veri.dogumTarihi ?? null,
          sgkTesvikOrani: veri.sgkTesvikOrani,
          ...sgkKartAlanlari(veri),
          iban: hassasSifrele(veri.iban),
          cariId: cariId || null,
          istihdamDonemleri: {
            create: { tenantId, baslangicTarihi: veri.girisTarihi },
          },
          // PRS-06: işe giriş tarihli ilk ücret kaydı.
          ucretler: {
            create: { tenantId, yururlukTarihi: veri.girisTarihi, tip: veri.brutMaas ? "brut" : "net", tutar: veri.brutMaas ?? veri.netMaas, neden: "İşe giriş ücreti" },
          },
        },
        include: { cari: true }
      });
      return personelMaskele(personel);
    });
  }

  /**
   * PRS-18: çıkış hesabı önizlemesi. Hak önerisi çıkış nedeninden; son brüt
   * ücret geçmişinden (net ücretli personelde mevzuatla brüte çevrilir), yan
   * ödeme önerisi son puantajın nakit yemek yardımı, izin günü yıllık izin bakiyesi.
   */
  async cikisOnizleme(tenantId: string, id: string, girdi: unknown) {
    const veri = cikisOnizlemeSemasi.parse(girdi);
    return this.prisma.tenantIslem(tenantId, (tx) => this.cikisHesabiKur(tx, tenantId, id, veri.cikisTarihi, veri));
  }

  private async cikisHesabiKur(tx: Prisma.TransactionClient, tenantId: string, id: string, cikisTarihi: Date, veri: z.infer<typeof cikisOnizlemeSemasi> | NonNullable<z.infer<typeof personelIstenCikarSemasi>["cikisHesabi"]>) {
    const personel = await tx.personel.findFirst({ where: { tenantId, id }, select: { girisTarihi: true, engellilikDerecesi: true, sgkTesvikOrani: true, istihdamDonemleri: { where: { OR: [{ bitisTarihi: null }, { bitisTarihi: { gte: cikisTarihi } }] }, orderBy: { baslangicTarihi: "desc" }, take: 1, select: { baslangicTarihi: true } }, ucretler: { where: { yururlukTarihi: { lte: cikisTarihi } }, orderBy: { yururlukTarihi: "desc" }, take: 1, select: { tip: true, tutar: true } } } });
    if (!personel) throw new NotFoundException("Personel bulunamadı");
    const kural = CIKIS_NEDENLERI[veri.cikisNedeni];
    const oneri = { kidemHakki: kural.kidem as boolean, ihbarDurumu: kural.ihbar as IhbarDurumu };
    const kidemHakki = veri.kidemHakki ?? oneri.kidemHakki;
    const ihbarDurumu = veri.ihbarDurumu ?? oneri.ihbarDurumu;
    const girisTarihi = personel.istihdamDonemleri[0]?.baslangicTarihi ?? personel.girisTarihi;
    const ucret = personel.ucretler[0];
    let sonBrutOnerisi = 0;
    if (ucret) {
      const tutar = ucret.tutar.toNumber();
      const yil = cikisTarihi.getUTCFullYear(), ay = cikisTarihi.getUTCMonth() + 1;
      const mevzuat = ucret.tip === "net" ? await this.donemMevzuatiVarsa(tx, tenantId, yil, ay) : null;
      sonBrutOnerisi = mevzuat ? nettenBrute(mevzuat.parametreler, tutar, { primGunu: 30, engellilikDerecesi: personel.engellilikDerecesi ?? undefined, sgkTesvikOrani: Number(personel.sgkTesvikOrani ?? 0), oncekiKumulatifMatrah: 0, oncekiAsgariKumulatifMatrah: 0 }) : tutar;
    }
    const sonPuantaj = await tx.personelDonemCalisma.findFirst({ where: { tenantId, personelId: id }, orderBy: [{ yil: "desc" }, { ay: "desc" }], select: { nakitYemekYardimi: true } });
    const yillik = await tx.personelIzinTuru.findFirst({ where: { tenantId, kod: "yillik" }, select: { id: true } });
    const hareketler = yillik ? await tx.personelIzinBakiyeHareketi.findMany({ where: { tenantId, personelId: id, izinTuruId: yillik.id }, select: { tip: true, gun: true } }) : [];
    const izinBakiyesi = Math.max(0, hareketler.reduce((t, h) => (["kullanim", "duzeltme_azalis"].includes(h.tip) ? t - h.gun.toNumber() : t + h.gun.toNumber()), 0));
    const sonBrut = veri.sonBrut ?? sonBrutOnerisi;
    const izinGunu = veri.izinGunu ?? izinBakiyesi;
    let hesap;
    try {
      hesap = cikisHesapla({ girisTarihi, cikisTarihi, kidemHakki, ihbarDurumu, sonBrut, yanOdemeler: veri.yanOdemeler, izinGunu, kidemTavani: await kidemTavaniOku(tx, cikisTarihi) });
    } catch (e) {
      if (e instanceof KidemTavaniYokHatasi) throw new BadRequestException(e.message);
      throw e;
    }
    return {
      cikisNedeni: veri.cikisNedeni,
      cikisNedeniAdi: kural.ad,
      oneri: { ...oneri, sonBrut: sonBrutOnerisi, yanOdemeler: sonPuantaj?.nakitYemekYardimi.toNumber() ?? 0, izinGunu: izinBakiyesi },
      girdiler: { girisTarihi: girisTarihi.toISOString().slice(0, 10), cikisTarihi: cikisTarihi.toISOString().slice(0, 10), kidemHakki, ihbarDurumu, sonBrut, yanOdemeler: veri.yanOdemeler, izinGunu },
      oneridenFarkli: kidemHakki !== oneri.kidemHakki || ihbarDurumu !== oneri.ihbarDurumu,
      gerekce: veri.gerekce || null,
      ...hesap,
    };
  }

  async istenCikar(tenantId: string, id: string, girdi: z.infer<typeof personelIstenCikarSemasi>, userId?: string) {
    const veri = personelIstenCikarSemasi.parse(girdi);
    const personel = await this.getir(tenantId, id);
    if (personel.durum === "isten_ayrildi") {
      throw new BadRequestException("Personel zaten işten ayrılmıştır");
    }
    if (veri.cikisTarihi < personel.girisTarihi) {
      throw new BadRequestException("Çıkış tarihi işe giriş tarihinden önce olamaz");
    }

    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const cikis = veri.cikisHesabi ? await this.cikisHesabiKur(tx, tenantId, id, veri.cikisTarihi, veri.cikisHesabi) : null;
      if (cikis?.oneridenFarkli && (cikis.gerekce ?? "").length < 3) throw new BadRequestException("Kıdem/ihbar hakkı çıkış nedeninin önerisinden farklı; gerekçe yazın (en az 3 karakter)");
      await tx.personelIstihdamDonemi.updateMany({
        where: { tenantId, personelId: id, bitisTarihi: null },
        data: { bitisTarihi: veri.cikisTarihi, ayrilisNedeni: veri.ayrilisNedeni, sgkCikisKodu: veri.sgkCikisKodu || (cikis ? CIKIS_NEDENI_SGK_KODU[cikis.cikisNedeni] : null), ...(cikis && { cikisNedeni: cikis.cikisNedeni, cikisHesabi: cikis as unknown as Prisma.InputJsonValue }) },
      });
      const personel = await tx.personel.update({
        where: { id },
        data: { durum: "isten_ayrildi", aktif: false, cikisTarihi: veri.cikisTarihi, ayrilisNedeni: veri.ayrilisNedeni },
        include: { cari: true },
      });
      // PRS-21: işten çıkışta çalışanın self-servis hesabı kapanır.
      await tx.user.updateMany({ where: { personelId: id, aktif: true }, data: { aktif: false, davetAnahtarOzeti: null, davetSonGecerlilik: null } });
      if (cikis) await tx.auditLog.create({ data: { tenantId, userId: userId ?? null, islem: "personel_cikis_hesabi", varlik: "personel", varlikId: id, detay: { cikisNedeni: cikis.cikisNedeni, girdiler: cikis.girdiler, oneri: cikis.oneri, oneridenFarkli: cikis.oneridenFarkli, gerekce: cikis.gerekce, kidem: cikis.kidemTutari, ihbar: cikis.ihbarTutari, izinUcreti: cikis.izinUcreti } as Prisma.InputJsonValue } });
      const ay = veri.cikisTarihi.getUTCMonth() + 1, yil = veri.cikisTarihi.getUTCFullYear();
      const cikisBordrosu = await tx.personelBordro.findFirst({ where: { tenantId, personelId: id, donemYil: yil, donemAy: ay }, select: { durum: true } });
      const uyari = !cikisBordrosu ? null : ["hesaplandi", "onay_bekliyor"].includes(cikisBordrosu.durum) ? `${yil}/${String(ay).padStart(2, "0")} bordrosu çıkıştan önce hesaplanmış; çıkış tarihini ve tazminatları almak için yeniden hesaplayın` : `${yil}/${String(ay).padStart(2, "0")} bordrosu onaylı; çıkışı yansıtmak için onayı geri alıp yeniden hesaplayın`;
      return { ...personelMaskele(personel), cikisHesabi: cikis, uyari };
    });
  }

  async yenidenBaslat(tenantId: string, id: string, girdi: z.infer<typeof personelYenidenBaslatSemasi>) {
    const veri = personelYenidenBaslatSemasi.parse(girdi);
    const personel = await this.getir(tenantId, id);
    if (personel.durum !== "isten_ayrildi") {
      throw new BadRequestException("Yalnızca işten ayrılmış personel yeniden başlatılabilir");
    }
    if (personel.cikisTarihi && veri.girisTarihi <= personel.cikisTarihi) {
      throw new BadRequestException("Yeni işe giriş tarihi önceki çıkış tarihinden sonra olmalıdır");
    }

    return this.prisma.tenantIslem(tenantId, async (tx) => {
      await tx.personelIstihdamDonemi.create({
        data: { tenantId, personelId: id, baslangicTarihi: veri.girisTarihi },
      });
      const personel = await tx.personel.update({
        where: { id },
        data: { durum: "aktif", aktif: true, girisTarihi: veri.girisTarihi, cikisTarihi: null, ayrilisNedeni: null },
        include: { cari: true },
      });
      return personelMaskele(personel);
    });
  }

  /**
   * P0-6: kart düzenleme. Bağlı cari (ad, iletişim, IBAN, TCKN) eşitlenir; işe
   * giriş tarihi açık istihdam dönemine de yazılır; değişen alanlar denetim
   * kaydına geçer (TCKN/IBAN değerleri yazılmaz, yalnız değiştiği; ücretin eski
   * ve yeni değeri yazılır). Ücret değişikliği sonraki tahakkuklarda geçerlidir.
   */
  async guncelle(tenantId: string, id: string, girdi: z.infer<typeof personelGuncelleSemasi>, userId?: string) {
    const veri = personelGuncelleSemasi.parse(girdi);

    const personel = await this.prisma.tenantIslem(tenantId, async (tx) => {
      const mevcut = await tx.personel.findFirst({ where: { id, tenantId } });
      if (!mevcut) throw new NotFoundException("Personel bulunamadı");
      if (veri.girisTarihi && mevcut.cikisTarihi && veri.girisTarihi > mevcut.cikisTarihi) throw new BadRequestException("İşe giriş tarihi çıkış tarihinden sonra olamaz");
      const tckn = veri.tckn !== undefined ? hassasSifrele(veri.tckn) : undefined;
      const iban = veri.iban !== undefined ? hassasSifrele(veri.iban) : undefined;
      const guncel = await tx.personel.update({
        where: { id },
        data: {
          ...(veri.ad && { ad: veri.ad }),
          ...(veri.soyad && { soyad: veri.soyad }),
          ...(tckn !== undefined && { tckn }),
          ...(veri.eposta !== undefined && { eposta: veri.eposta || null }),
          ...(veri.telefon !== undefined && { telefon: veri.telefon || null }),
          ...(veri.adres !== undefined && { adres: veri.adres || null }),
          ...(veri.departman !== undefined && { departman: veri.departman || null }),
          ...(veri.unvan !== undefined && { unvan: veri.unvan || null }),
          ...(veri.calismaTipi && { calismaTipi: veri.calismaTipi }),
          ...(veri.girisTarihi && { girisTarihi: veri.girisTarihi }),
          ...(veri.cikisTarihi !== undefined && { cikisTarihi: veri.cikisTarihi || null }),
          ...(veri.netMaas && { netMaas: veri.netMaas }),
          ...(veri.brutMaas !== undefined && { brutMaas: veri.brutMaas }),
          ...(veri.engellilikDerecesi !== undefined && { engellilikDerecesi: veri.engellilikDerecesi }),
          ...(veri.dogumTarihi !== undefined && { dogumTarihi: veri.dogumTarihi }),
          ...(veri.sgkTesvikOrani !== undefined && { sgkTesvikOrani: veri.sgkTesvikOrani }),
          ...sgkKartAlanlari(veri),
          ...(iban !== undefined && { iban }),
        },
        include: { cari: true },
      });
      if (veri.netMaas || veri.brutMaas) {
        // Eski uç uyumluluğu: maaş bu uçtan gelirse bugünden geçerli ücret kaydı (yeni ekran /ucretler kullanır).
        const bugun = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
        const tip = veri.brutMaas ? "brut" : "net";
        const tutar = veri.brutMaas ?? veri.netMaas!;
        await tx.personelUcret.upsert({ where: { tenantId_personelId_yururlukTarihi: { tenantId, personelId: id, yururlukTarihi: bugun } }, create: { tenantId, personelId: id, yururlukTarihi: bugun, tip, tutar, neden: "Kart düzenleme", olusturanUserId: userId ?? null }, update: { tip, tutar } });
      }
      if (veri.girisTarihi && veri.girisTarihi.getTime() !== mevcut.girisTarihi.getTime()) {
        await tx.personelIstihdamDonemi.updateMany({ where: { tenantId, personelId: id, bitisTarihi: null }, data: { baslangicTarihi: veri.girisTarihi } });
      }
      if (guncel.cariId) {
        await tx.cariHesap.update({
          where: { id: guncel.cariId },
          data: {
            ...((veri.ad || veri.soyad) && { ad: guncel.ad, soyad: guncel.soyad, unvan: `${guncel.ad} ${guncel.soyad}` }),
            ...(veri.eposta !== undefined && { eposta: guncel.eposta }),
            ...(veri.telefon !== undefined && { telefon: guncel.telefon }),
            ...(veri.iban !== undefined && { iban: veri.iban || null }),
            ...(veri.tckn !== undefined && { vknTckn: veri.tckn || null }),
          },
        });
      }
      const alanlar = (Object.keys(veri) as (keyof typeof veri)[]).filter((k) => veri[k] !== undefined && k !== "cariOlustur");
      const ucret = (deger: Prisma.Decimal | null) => deger?.toFixed(2) ?? null;
      await tx.auditLog.create({
        data: {
          tenantId, userId: userId ?? null, islem: "personel_guncelle", varlik: "personel", varlikId: id,
          detay: {
            alanlar,
            ...(veri.netMaas && { netMaas: { onceki: ucret(mevcut.netMaas), yeni: ucret(guncel.netMaas) } }),
            ...(veri.brutMaas !== undefined && { brutMaas: { onceki: ucret(mevcut.brutMaas), yeni: ucret(guncel.brutMaas) } }),
          },
        },
      });
      return guncel;
    });
    return personelMaskele(personel);
  }

  async hassasVeriGetir(tenantId: string, id: string, userId: string) {
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const personel = await tx.personel.findFirst({ where: { id, tenantId }, select: { tckn: true, iban: true } });
      if (!personel) throw new NotFoundException("Personel bulunamadı");
      await tx.auditLog.create({ data: { tenantId, userId, islem: "HASSAS_VERI_GORUNTULE", varlik: "personel", varlikId: id, detay: { alanlar: ["tckn", "iban"] } } });
      return { tckn: hassasCoz(personel.tckn), iban: hassasCoz(personel.iban) };
    });
  }

  async hassasVerileriSifrele(tenantId: string, userId: string) {
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const kayitlar = await tx.personel.findMany({ where: { OR: [{ tckn: { not: null } }, { iban: { not: null } }] }, select: { id: true, tckn: true, iban: true } });
      let donusturulen = 0;
      for (const kayit of kayitlar) {
        const tckn = hassasSifrele(kayit.tckn); const iban = hassasSifrele(kayit.iban);
        if (tckn !== kayit.tckn || iban !== kayit.iban) { await tx.personel.update({ where: { id: kayit.id }, data: { tckn, iban } }); donusturulen++; }
      }
      await tx.auditLog.create({ data: { tenantId, userId, islem: "HASSAS_VERI_SIFRELEME_GECISI", varlik: "personel", detay: { donusturulen } } });
      return { taranan: kayitlar.length, donusturulen };
    });
  }

  /** PRS-19 (P3-5): kuyruk kararının kadro büyüklüğü. */
  tahakkukKapsamSayisi(tenantId: string, donemYil: number, donemAy: number) {
    return this.prisma.tenantIslem(tenantId, (tx) => tx.personel.count({ where: tahakkukKapsamiKosulu(tenantId, donemYil, donemAy) }));
  }

  /**
   * P3-5: ortak veriler (kapsam, mevcut bordrolar, puantaj, mevzuat, ücretsiz
   * izinler) tek okumada; her personel kendi kısa transaction'ında yazılır.
   * Birinin hatası (ör. ücret kaydı yok) ötekileri durdurmaz, nedeniyle
   * döner. Aynı dönemi eşzamanlı çalışan ikinci tahakkukun yazdığı bordro
   * tekillik kısıtıyla atlanır. Arka plan işi `ilerleme` ile durum bildirir.
   */
  async bordroTopluTahakkuk(tenantId: string, userId: string, girdi: z.infer<typeof bordroTahakkukSemasi>, ilerleme?: (yapilan: number, toplam: number) => Promise<void> | void) {
    const { donemYil, donemAy } = bordroTahakkukSemasi.parse(girdi);
    const { personeller, mevcutlar, calismaHaritasi, mevzuat, izinler } = await this.prisma.tenantIslem(tenantId, async (tx) => {
      // PRS-02: dönemle kesişen istihdamı olan herkes (çıkış ayı, askıda, uzun süreli izin dahil).
      const personeller = await tx.personel.findMany({
        where: tahakkukKapsamiKosulu(tenantId, donemYil, donemAy),
        include: { istihdamDonemleri: { select: { baslangicTarihi: true, bitisTarihi: true } }, ucretler: { select: { yururlukTarihi: true, tip: true, tutar: true } } },
        orderBy: { personelNo: "asc" },
      });
      const mevcutlar = await tx.personelBordro.findMany({ where: { tenantId, donemYil, donemAy }, select: { personelId: true } });
      const calismalar = await tx.personelDonemCalisma.findMany({ where: { tenantId, yil: donemYil, ay: donemAy } });
      return {
        personeller,
        mevcutlar: new Set(mevcutlar.map((b) => b.personelId)),
        calismaHaritasi: new Map(calismalar.map((c) => [c.personelId, c])),
        mevzuat: await this.donemMevzuatiVarsa(tx, tenantId, donemYil, donemAy),
        izinler: await this.ucretsizIzinler(tx, tenantId, personeller.map((p) => p.id), donemYil, donemAy),
      };
    });

    const bekleyen = personeller.filter((p) => !mevcutlar.has(p.id));
    let olusturulanSayi = 0;
    const hatalar: { personel: string; mesaj: string }[] = [];
    for (const [i, p] of bekleyen.entries()) {
      try {
        await this.prisma.tenantIslem(tenantId, async (tx) => {
          const hesap = await this.bordroHesabi(tx, tenantId, p, calismaHaritasi.get(p.id), donemYil, donemAy, mevzuat, izinler.get(p.id) ?? []);
          await tx.personelBordro.create({
            data: {
              tenantId, personelId: p.id, donemYil, donemAy, ...hesap.baslik,
              prim: 0, kesinti: 0, odenecekTutar: hesap.baslik.netMaas, kalanTutar: hesap.baslik.netMaas,
              odendi: false, durum: "hesaplandi", olusturanUserId: userId,
              kalemler: { create: hesap.kalemler.map((k) => ({ tenantId, ...k })) },
            },
          });
        });
        olusturulanSayi++;
      } catch (e) {
        if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) hatalar.push({ personel: `${p.personelNo} ${p.ad} ${p.soyad}`, mesaj: e instanceof Error ? e.message : String(e) });
      }
      if (ilerleme && ((i + 1) % 10 === 0 || i + 1 === bekleyen.length)) await ilerleme(i + 1, bekleyen.length);
    }

    return { olusturulanSayi, toplamAktifPersonel: personeller.length, mevcutSayi: personeller.length - bekleyen.length, hatalar };
  }

  /** MVZ-14: bordro mevzuatı merkezden okunur; kiracıda set yoktur. */
  private donemMevzuatiVarsa(tx: Prisma.TransactionClient, _tenantId: string, yil: number, ay: number) {
    return donemBordroMevzuati(tx, yil, ay);
  }

  /**
   * Bir personelin dönem bordrosunun sistem tarafı: başlık alanları ve sistem
   * kalemleri. Toplu tahakkuk ve yeniden hesaplama (PRS-03) aynı fonksiyonu
   * kullanır. Elle kalemler ve avans mahsupları burada üretilmez.
   */
  private async bordroHesabi(
    tx: Prisma.TransactionClient,
    tenantId: string,
    p: { id: string; personelNo?: string; engellilikDerecesi: number | null; sgkTesvikOrani: Prisma.Decimal; istihdamDonemleri: { baslangicTarihi: Date; bitisTarihi: Date | null }[]; ucretler: { yururlukTarihi: Date; tip: string; tutar: Prisma.Decimal }[] },
    calisma: Prisma.PersonelDonemCalismaGetPayload<object> | undefined,
    donemYil: number,
    donemAy: number,
    mevzuat: Pick<DonemBordroMevzuati, "id" | "parametreler"> | null,
    ucretsizIzinler: UcretsizIzin[] = [],
  ) {
    const izinOnerisi = izinliPrimGunu(p.istihdamDonemleri, ucretsizIzinler, donemYil, donemAy);
    const primGunu = calisma?.primGunu ?? izinOnerisi.primGunu;
    // PRS-06: dönemin ücreti ücret geçmişinden; brüt ücret mevzuat ister, net ücret mevzuat varsa brüte çevrilir.
    const ucret = donemUcreti(p.ucretler, p.istihdamDonemleri, donemYil, donemAy);
    if (ucret.tip === "brut" && !mevzuat) throw new BadRequestException(`${p.personelNo ?? "Personel"} brüt ücretli; ${donemYil}/${String(donemAy).padStart(2, "0")} dönemi hesaplanamaz: ${mevzuatYokMesaji(donemYil)}`);
    const mevzuatli = Boolean(mevzuat);
    const onceki = mevzuatli ? await tx.personelBordro.findFirst({ where: { tenantId, personelId: p.id, donemYil, donemAy: { lt: donemAy } }, orderBy: { donemAy: "desc" }, select: { kumulatifMatrah: true, asgariKumulatifMatrah: true, hesapOzeti: true } }) : null;
    const oncekiDevirBordrosu = mevzuatli ? await tx.personelBordro.findFirst({ where: { tenantId, personelId: p.id, OR: [{ donemYil: { lt: donemYil } }, { donemYil, donemAy: { lt: donemAy } }] }, orderBy: [{ donemYil: "desc" }, { donemAy: "desc" }], select: { donemYil: true, donemAy: true, hesapOzeti: true } }) : null;
    const oranli = new Prisma.Decimal(ucret.aylik).mul(primGunu).div(30).toDecimalPlaces(2);
    const ortak = { primGunu, engellilikDerecesi: p.engellilikDerecesi ?? undefined, sgkTesvikOrani: calisma?.sgkTesvikOrani?.toNumber() ?? Number(p.sgkTesvikOrani ?? 0), oncekiKumulatifMatrah: onceki?.kumulatifMatrah?.toNumber() ?? 0, oncekiAsgariKumulatifMatrah: onceki?.asgariKumulatifMatrah?.toNumber() ?? 0 };
    const temelBrut = !mevzuat ? null : ucret.tip === "brut" ? oranli : new Prisma.Decimal(primGunu > 0 ? nettenBrute(mevzuat.parametreler, oranli.toNumber(), ortak) : 0);
    const fazlaMesaiBrut = calisma?.fazlaMesaiBrut ?? new Prisma.Decimal(0);
    const primIkramiyeBrut = calisma?.primIkramiyeBrut ?? new Prisma.Decimal(0);
    const ucretDisiOdeme = fazlaMesaiBrut.add(primIkramiyeBrut);
    // PRS-18: çıkış ayında kıdem, ihbar ve kullanılmamış izin ücreti.
    const { baslangic: ayBasi, son: aySonu } = donemSinirlari(donemYil, donemAy);
    const cikisDonemi = await tx.personelIstihdamDonemi.findFirst({ where: { tenantId, personelId: p.id, bitisTarihi: { gte: ayBasi, lte: aySonu }, NOT: { cikisHesabi: { equals: Prisma.DbNull } } }, orderBy: { bitisTarihi: "desc" }, select: { cikisHesabi: true } });
    const ch = (cikisDonemi?.cikisHesabi ?? null) as { kidemTutari?: number; ihbarTutari?: number; ihbarDurumu?: IhbarDurumu; izinUcreti?: number; izinGunu?: number; ihbarHaftasi?: number } | null;
    const kidemTazminati = ch?.kidemTutari ?? 0, izinUcreti = ch?.izinUcreti ?? 0;
    const ihbarTazminati = ch?.ihbarDurumu === "isveren_oder" ? ch.ihbarTutari ?? 0 : 0;
    const ihbarKesintisi = ch?.ihbarDurumu === "isci_oder" ? ch.ihbarTutari ?? 0 : 0;
    const cikisKazanclari = [
      ...(izinUcreti > 0 ? [{ tip: "kazanc" as const, kod: "izin_ucreti", aciklama: `Kullanılmamış yıllık izin ücreti (${ch?.izinGunu} gün)`, tutar: izinUcreti }] : []),
      ...(ihbarTazminati > 0 ? [{ tip: "kazanc" as const, kod: "ihbar_tazminati", aciklama: `İhbar tazminatı (${ch?.ihbarHaftasi} hafta)`, tutar: ihbarTazminati }] : []),
      ...(kidemTazminati > 0 ? [{ tip: "kazanc" as const, kod: "kidem_tazminati", aciklama: "Kıdem tazminatı", tutar: kidemTazminati }] : []),
    ];
    const cikisKesintileri = ihbarKesintisi > 0 ? [{ tip: "kesinti" as const, kod: "ihbar_kesintisi", aciklama: `İhbar önelsiz ayrılış (${ch?.ihbarHaftasi} hafta)`, tutar: ihbarKesintisi }] : [];
    const sgkMatrahDevirleri = oncekiDevirBordrosu ? hesapOzetindenSgkDevirleri(oncekiDevirBordrosu.hesapOzeti, oncekiDevirBordrosu.donemYil, oncekiDevirBordrosu.donemAy, donemYil, donemAy) : [];
    const hesap = temelBrut && mevzuat ? bordroHesapla(mevzuat.parametreler, { brutUcret: temelBrut.toNumber(), ucretDisiOdeme:ucretDisiOdeme.toNumber(), sgkMatrahDevirleri, primGunu, nakitYemekYardimi:calisma?.nakitYemekYardimi.toNumber()??0, fiiliCalismaGunu:calisma?.fiiliCalismaGunu??0, engellilikDerecesi: p.engellilikDerecesi ?? undefined, sgkTesvikOrani: calisma?.sgkTesvikOrani?.toNumber() ?? p.sgkTesvikOrani.toNumber(), sahisSigortaPrimi:calisma?.sahisSigortaPrimi.toNumber()??0, hayatSigortaPrimi:calisma?.hayatSigortaPrimi.toNumber()??0, sendikaAidati:calisma?.sendikaAidati.toNumber()??0, oncekiKumulatifSigortaIndirimi:hesapOzetiTutari(onceki?.hesapOzeti??null,"yeniKumulatifSigortaIndirimi").toNumber(), oncekiKumulatifMatrah: onceki?.kumulatifMatrah?.toNumber() ?? 0, oncekiAsgariKumulatifMatrah: onceki?.asgariKumulatifMatrah?.toNumber() ?? 0, izinUcreti, ihbarTazminati, kidemTazminati }) : null;
    const operasyonelNet = oranli;
    const kalemler: { tip: "kazanc" | "kesinti"; kod: string; aciklama: string; tutar: Prisma.Decimal.Value }[] = hesap ? [
      { tip: "kazanc", kod: "temel_brut_ucret", aciklama: "Temel brüt ücret", tutar: temelBrut! },
      ...(fazlaMesaiBrut.gt(0) ? [{ tip: "kazanc" as const, kod: "fazla_mesai", aciklama: "Fazla mesai brüt", tutar: fazlaMesaiBrut }] : []),
      ...(primIkramiyeBrut.gt(0) ? [{ tip: "kazanc" as const, kod: "prim_ikramiye", aciklama: "Prim / ikramiye brüt", tutar: primIkramiyeBrut }] : []),
      ...(Number(hesap.nakitYemekYardimi) > 0 ? [{ tip: "kazanc" as const, kod: "nakit_yemek_yardimi", aciklama: "Nakit yemek yardımı", tutar: hesap.nakitYemekYardimi }] : []),
      ...cikisKazanclari,
      { tip: "kesinti", kod: "sgk_isci", aciklama: "SGK çalışan payı", tutar: hesap.sgkIsci },
      { tip: "kesinti", kod: "issizlik_isci", aciklama: "İşsizlik çalışan payı", tutar: hesap.issizlikIsci },
      { tip: "kesinti", kod: "gelir_vergisi", aciklama: "Gelir vergisi", tutar: hesap.gelirVergisi },
      { tip: "kesinti", kod: "damga_vergisi", aciklama: "Damga vergisi", tutar: hesap.damgaVergisi },
      ...(Number(hesap.sahisSigortaPrimi) > 0 ? [{ tip: "kesinti" as const, kod: "sahis_sigorta_primi", aciklama: "Şahıs sigortası primi", tutar: hesap.sahisSigortaPrimi }] : []),
      ...(Number(hesap.hayatSigortaPrimi) > 0 ? [{ tip: "kesinti" as const, kod: "hayat_sigorta_primi", aciklama: "Hayat sigortası primi", tutar: hesap.hayatSigortaPrimi }] : []),
      ...(Number(hesap.sendikaAidati) > 0 ? [{ tip: "kesinti" as const, kod: "sendika_aidati", aciklama: "Sendika aidatı", tutar: hesap.sendikaAidati }] : []),
      ...cikisKesintileri,
    ] : [
      // P2-6: dönemin bordro mevzuatı yoksa vergi/SGK hesaplanmaz; puantajdaki ek kazançlar yine de bordroya girer.
      { tip: "kazanc", kod: "temel_ucret", aciklama: "Temel ücret", tutar: operasyonelNet },
      ...(fazlaMesaiBrut.gt(0) ? [{ tip: "kazanc" as const, kod: "fazla_mesai", aciklama: "Fazla mesai", tutar: fazlaMesaiBrut }] : []),
      ...(primIkramiyeBrut.gt(0) ? [{ tip: "kazanc" as const, kod: "prim_ikramiye", aciklama: "Prim / ikramiye", tutar: primIkramiyeBrut }] : []),
      ...(calisma?.nakitYemekYardimi.gt(0) ? [{ tip: "kazanc" as const, kod: "nakit_yemek_yardimi", aciklama: "Nakit yemek yardımı", tutar: calisma.nakitYemekYardimi }] : []),
      ...cikisKazanclari,
      ...cikisKesintileri,
    ];
    const kazancToplami = kalemler.filter((k) => k.tip === "kazanc").reduce((t, k) => t.add(new Prisma.Decimal(k.tutar.toString())), new Prisma.Decimal(0));
    const operasyonelToplam = kazancToplami.sub(ihbarKesintisi);
    return {
      baslik: {
        brutMaas: hesap ? new Prisma.Decimal(hesap.brutUcret).add(ihbarTazminati).add(kidemTazminati) : kazancToplami,
        netMaas: hesap ? new Prisma.Decimal(hesap.netUcret).sub(ihbarKesintisi) : operasyonelToplam,
        mevzuatKayitId: hesap ? mevzuat!.id : null,
        hesapOzeti: hesap ? ({ ...hesap, ucretTipi: ucret.tip, ...(ucret.tip === "net" ? { hedefNet: oranli.toFixed(2) } : {}) } as Prisma.InputJsonValue) : Prisma.DbNull,
        kumulatifMatrah: hesap ? new Prisma.Decimal(hesap.yeniKumulatifMatrah) : null,
        asgariKumulatifMatrah: hesap ? new Prisma.Decimal(hesap.yeniAsgariKumulatifMatrah) : null,
        primGunu,
        eksikGunNedeni: calisma ? calisma.eksikGunNedeni ?? null : izinOnerisi.eksikGunNedeni,
      },
      kalemler,
    };
  }

  /** Mevzuatlı bordroda kümülatif matrah sonraki aylara taşınır; sonraki dönem bordrosu varken önceki değiştirilemez. */
  private async sonrakiDonemKontrolu(tx: Prisma.TransactionClient, tenantId: string, b: { personelId: string; donemYil: number; donemAy: number; mevzuatKayitId: string | null }, eylem: string) {
    if (!b.mevzuatKayitId) return;
    const sonraki = await tx.personelBordro.findFirst({ where: { tenantId, personelId: b.personelId, donemYil: b.donemYil, donemAy: { gt: b.donemAy } }, orderBy: { donemAy: "asc" }, select: { donemAy: true } });
    if (sonraki) throw new BadRequestException(`Kişinin ${b.donemYil}/${String(sonraki.donemAy).padStart(2, "0")} bordrosu kümülatif vergi matrahını bu aydan alıyor; önce sonraki ayların bordrosunu silin, sonra ${eylem}`);
  }

  /**
   * PRS-03: hesaplanmış, onay bekleyen ya da reddedilmiş bordroyu güncel ücret,
   * puantaj ve mevzuatla yeniden üretir. Sistem kalemleri silinip yeniden
   * yazılır; elle eklenen kalemler ve avans mahsupları korunur. Yeniden
   * hesaplayan kişi hazırlayan olur (onay görev ayrılığı ona göre işler).
   */
  async bordroYenidenHesapla(tenantId: string, bordroId: string, userId: string) {
    await this.prisma.tenantIslem(tenantId, async (tx) => {
      const bordro = await tx.personelBordro.findFirst({ where: { id: bordroId, tenantId }, select: { id: true, personelId: true, donemYil: true, donemAy: true, durum: true, mevzuatKayitId: true } });
      if (!bordro) throw new NotFoundException("Bordro bulunamadı");
      if (!["hesaplandi", "onay_bekliyor", "reddedildi"].includes(bordro.durum)) throw new BadRequestException("Yalnız onaylanmamış bordro yeniden hesaplanır; onaylı bordroda önce onayı geri alın");
      await this.sonrakiDonemKontrolu(tx, tenantId, bordro, "yeniden hesaplayın");
      const personel = await tx.personel.findFirstOrThrow({ where: { id: bordro.personelId, tenantId }, include: { istihdamDonemleri: { select: { baslangicTarihi: true, bitisTarihi: true } }, ucretler: { select: { yururlukTarihi: true, tip: true, tutar: true } } } });
      if (istihdamGunu(personel.istihdamDonemleri, bordro.donemYil, bordro.donemAy) === 0) throw new BadRequestException("Personelin bu dönemde istihdamı yok; bordroyu silin");
      const calisma = await tx.personelDonemCalisma.findUnique({ where: { tenantId_personelId_yil_ay: { tenantId, personelId: bordro.personelId, yil: bordro.donemYil, ay: bordro.donemAy } } }) ?? undefined;
      const mevzuat = await this.donemMevzuatiVarsa(tx, tenantId, bordro.donemYil, bordro.donemAy);
      const izinler = await this.ucretsizIzinler(tx, tenantId, [personel.id], bordro.donemYil, bordro.donemAy);
      const hesap = await this.bordroHesabi(tx, tenantId, personel, calisma, bordro.donemYil, bordro.donemAy, mevzuat, izinler.get(personel.id) ?? []);
      if (hesap.baslik.mevzuatKayitId) {
        const elle = await tx.personelBordroKalemi.count({ where: { tenantId, bordroId, manuel: true, avansId: null } });
        if (elle) throw new BadRequestException("Mevzuatla hesaplanan bordroda elle kalem olamaz; elle eklenen kalemleri silip yeniden deneyin");
      }
      await tx.personelBordroKalemi.deleteMany({ where: { tenantId, bordroId, manuel: false } });
      await tx.personelBordroKalemi.createMany({ data: hesap.kalemler.map((k) => ({ tenantId, bordroId, ...k })) });
      await tx.personelBordro.update({ where: { id: bordroId }, data: { ...hesap.baslik, durum: "hesaplandi", retNedeni: null, onaylayanUserId: null, onayTarihi: null, olusturanUserId: userId } });
      await this.bordroToplamlariniGuncelle(tx, tenantId, bordroId);
      await tx.auditLog.create({ data: { tenantId, userId, islem: "personel_bordro_yeniden_hesapla", varlik: "personel_bordro", varlikId: bordroId, detay: { donem: `${bordro.donemYil}/${bordro.donemAy}`, primGunu: hesap.baslik.primGunu, net: hesap.baslik.netMaas.toFixed(2) } } });
    });
    return this.bordroGetir(tenantId, bordroId);
  }

  /**
   * PRS-03: onaylı ve hiç ödenmemiş bordronun onayı yönetici tarafından
   * gerekçeyle geri alınır; cari tahakkuku ters kayıtla kapanır, bordro
   * "hesaplandı"ya döner ve yeniden onaya girer.
   */
  async bordroOnayGeriAl(tenantId: string, bordroId: string, userId: string, neden: string) {
    await this.donemKilidi?.tarihDogrula(tenantId, new Date(), "bordro onayını geri alma");
    await this.prisma.tenantIslem(tenantId, async (tx) => {
      const bordro = await tx.personelBordro.findFirst({ where: { id: bordroId, tenantId }, include: { personel: { select: { cariId: true } }, odemeler: { where: { durum: "aktif" }, select: { id: true } } } });
      if (!bordro) throw new NotFoundException("Bordro bulunamadı");
      if (bordro.durum !== "onaylandi" || bordro.odenenTutar.gt(0) || bordro.odemeler.length) throw new BadRequestException("Yalnız onaylanmış ve hiç ödeme yapılmamış bordronun onayı geri alınır; önce ödemeleri iptal edin");
      const sonuc = await tx.personelBordro.updateMany({ where: { id: bordroId, tenantId, durum: "onaylandi" }, data: { durum: "hesaplandi", onaylayanUserId: null, onayTarihi: null } });
      if (sonuc.count !== 1) throw new BadRequestException("Bordro eşzamanlı olarak değişti");
      const tahakkuk = await tx.cariHareket.findFirst({ where: { tenantId, kaynakTur: "bordro_tahakkuk", kaynakRef: bordroId }, orderBy: { createdAt: "desc" } });
      const iptalEdilmis = tahakkuk ? await tx.cariHareket.count({ where: { tenantId, kaynakTur: "bordro_tahakkuk_iptal", kaynakRef: tahakkuk.id } }) : 0;
      if (tahakkuk && !iptalEdilmis) {
        await tx.cariHareket.create({ data: {
          tenantId, cariId: tahakkuk.cariId, tip: "borc", tutar: tahakkuk.tutar, tutarTry: tahakkuk.tutarTry, tarih: new Date(),
          aciklama: `${bordro.donemYil}/${bordro.donemAy} maaş tahakkuku geri alındı: ${neden}`.slice(0, 500), kaynakTur: "bordro_tahakkuk_iptal", kaynakRef: tahakkuk.id,
        } });
      }
      await tx.auditLog.create({ data: { tenantId, userId, islem: "personel_bordro_onay_geri_al", varlik: "personel_bordro", varlikId: bordroId, detay: { donem: `${bordro.donemYil}/${bordro.donemAy}`, neden, tahakkukTers: Boolean(tahakkuk && !iptalEdilmis) } } });
    });
    return this.bordroGetir(tenantId, bordroId);
  }

  /**
   * PRS-03: finansal etkisi olmayan (hesaplanmış, onay bekleyen, reddedilmiş)
   * bordro gerekçeyle silinir; avans mahsupları avansa geri döner. Gerekirse
   * aynı ay için yeniden tahakkuk alınabilir.
   */
  async bordroSil(tenantId: string, bordroId: string, userId: string, neden: string) {
    await this.prisma.tenantIslem(tenantId, async (tx) => {
      const bordro = await tx.personelBordro.findFirst({ where: { id: bordroId, tenantId }, include: { kalemler: { where: { avansId: { not: null } }, select: { avansId: true, tutar: true } }, personel: { select: { personelNo: true, ad: true, soyad: true } } } });
      if (!bordro) throw new NotFoundException("Bordro bulunamadı");
      if (!["hesaplandi", "onay_bekliyor", "reddedildi"].includes(bordro.durum)) throw new BadRequestException("Yalnız onaylanmamış bordro silinir; onaylı bordroda önce onayı geri alın");
      await this.sonrakiDonemKontrolu(tx, tenantId, bordro, "silin");
      for (const k of bordro.kalemler) {
        await tx.personelAvans.update({ where: { id: k.avansId! }, data: { mahsupEdilenTutar: { decrement: k.tutar }, kalanTutar: { increment: k.tutar } } });
        const avans = await tx.personelAvans.findUniqueOrThrow({ where: { id: k.avansId! }, select: { mahsupEdilenTutar: true } });
        await tx.personelAvans.update({ where: { id: k.avansId! }, data: { durum: avans.mahsupEdilenTutar.isZero() ? "odendi" : "kismen_mahsup" } });
      }
      const silinen = await tx.personelBordro.deleteMany({ where: { id: bordroId, tenantId, durum: { in: ["hesaplandi", "onay_bekliyor", "reddedildi"] } } });
      if (silinen.count !== 1) throw new BadRequestException("Bordro eşzamanlı olarak değişti");
      await tx.auditLog.create({ data: { tenantId, userId, islem: "personel_bordro_sil", varlik: "personel_bordro", varlikId: bordroId, detay: { personel: `${bordro.personel.personelNo} ${bordro.personel.ad} ${bordro.personel.soyad}`, donem: `${bordro.donemYil}/${bordro.donemAy}`, net: bordro.netMaas.toFixed(2), neden, avansIadesi: bordro.kalemler.length } } });
    });
    return { silindi: true };
  }

  async bordroOnayaGonder(tenantId: string, id: string) {
    return this.bordroDurumGecisi(tenantId, id, "hesaplandi", "onay_bekliyor");
  }

  async bordroOnayla(tenantId: string, id: string, userId: string) {
    const bordro = await this.bordroGetir(tenantId, id);
    if (bordro.olusturanUserId === userId) {
      throw new BadRequestException("Bordroyu hazırlayan kullanıcı aynı bordroyu onaylayamaz");
    }
    // PRS-05 (P1-2): tahakkuk dönem sonu tarihiyle yazılır; dönem kapalıysa onay reddedilir.
    const tahakkukTarihi = donemSonu(bordro.donemYil, bordro.donemAy);
    if (bordro.personel.cariId) await this.donemKilidi?.tarihDogrula(tenantId, tahakkukTarihi, "bordro onayı");
    await this.prisma.tenantIslem(tenantId, async (tx) => {
      const onayTarihi = new Date();
      const sonuc = await tx.personelBordro.updateMany({
        where: { id, tenantId, durum: "onay_bekliyor" },
        data: { durum: "onaylandi", onaylayanUserId: userId, onayTarihi, retNedeni: null },
      });
      if (sonuc.count !== 1) throw new BadRequestException("Yalnızca onay bekleyen bordro onaylanabilir");

      if (bordro.personel.cariId) {
        const tutar = cariTahakkukTutari(bordro);
        await tx.cariHareket.create({ data: {
          tenantId,
          cariId: bordro.personel.cariId,
          tip: "alacak",
          tutar,
          tutarTry: tutar,
          tarih: tahakkukTarihi,
          aciklama: `${bordro.donemYil}/${bordro.donemAy} Maaş Tahakkuku`,
          kaynakTur: "bordro_tahakkuk",
          kaynakRef: bordro.id,
        }});
      }
    });
    return this.bordroGetir(tenantId, id);
  }

  async bordroReddet(tenantId: string, id: string, userId: string, neden: string) {
    const sonuc = await this.prisma.tenantIslem(tenantId, (tx) => tx.personelBordro.updateMany({
      where: { id, tenantId, durum: "onay_bekliyor" },
      data: { durum: "reddedildi", onaylayanUserId: userId, onayTarihi: new Date(), retNedeni: neden },
    }));
    if (sonuc.count !== 1) throw new BadRequestException("Yalnızca onay bekleyen bordro reddedilebilir");
    return this.bordroGetir(tenantId, id);
  }

  async bordroKalemEkle(tenantId: string, bordroId: string, girdi: z.infer<typeof bordroKalemOlusturSemasi>) {
    const veri = bordroKalemOlusturSemasi.parse(girdi);
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const bordro = await tx.personelBordro.findFirst({
        where: { id: bordroId, tenantId, durum: { in: ["hesaplandi", "reddedildi"] } }, select: { id: true, mevzuatKayitId: true },
      });
      if (!bordro) throw new BadRequestException("Yalnızca hesaplanmış veya reddedilmiş bordronun kalemleri değiştirilebilir");
      if (bordro.mevzuatKayitId) throw new BadRequestException("Mevzuatla hesaplanan bordroya manuel kalem eklenemez; brüt ücret girdisini düzelterek yeniden tahakkuk oluşturun");
      await tx.personelBordroKalemi.create({
        data: { tenantId, bordroId, tip: veri.tip, kod: veri.kod, aciklama: veri.aciklama, tutar: new Prisma.Decimal(veri.tutar), manuel: true },
      });
      await this.bordroToplamlariniGuncelle(tx, tenantId, bordroId);
      await tx.personelBordro.update({ where: { id: bordroId }, data: { durum: "hesaplandi", retNedeni: null, onaylayanUserId: null, onayTarihi: null } });
      return tx.personelBordro.findUnique({ where: { id: bordroId }, include: { kalemler: { orderBy: { createdAt: "asc" } }, personel: { select: PERSONEL_GUVENLI_SECIM } } });
    });
  }

  async bordroKalemSil(tenantId: string, bordroId: string, kalemId: string) {
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const bordro = await tx.personelBordro.findFirst({
        where: { id: bordroId, tenantId, durum: { in: ["hesaplandi", "reddedildi"] } }, select: { id: true },
      });
      if (!bordro) throw new BadRequestException("Bu bordronun kalemleri artık değiştirilemez");
      const kalem = await tx.personelBordroKalemi.findFirst({ where: { id: kalemId, bordroId, tenantId, manuel: true } });
      if (!kalem) throw new BadRequestException("Temel veya bulunamayan bordro kalemi silinemez");
      if (kalem.avansId) {
        await tx.personelAvans.update({ where: { id: kalem.avansId }, data: { mahsupEdilenTutar: { decrement: kalem.tutar }, kalanTutar: { increment: kalem.tutar } } });
        const avans = await tx.personelAvans.findUniqueOrThrow({ where: { id: kalem.avansId }, select: { mahsupEdilenTutar: true } });
        await tx.personelAvans.update({ where: { id: kalem.avansId }, data: { durum: avans.mahsupEdilenTutar.isZero() ? "odendi" : "kismen_mahsup" } });
      }
      const silinen = await tx.personelBordroKalemi.deleteMany({ where: { id: kalemId, bordroId, tenantId, manuel: true } });
      if (silinen.count !== 1) throw new BadRequestException("Temel veya bulunamayan bordro kalemi silinemez");
      await this.bordroToplamlariniGuncelle(tx, tenantId, bordroId);
      return tx.personelBordro.findUnique({ where: { id: bordroId }, include: { kalemler: { orderBy: { createdAt: "asc" } }, personel: { select: PERSONEL_GUVENLI_SECIM } } });
    });
  }

  async bordroAvansMahsup(tenantId: string, bordroId: string, girdi: z.infer<typeof avansMahsupSemasi>) {
    const veri = avansMahsupSemasi.parse(girdi);
    const tutar = new Prisma.Decimal(veri.tutar);
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const bordro = await tx.personelBordro.findFirst({ where: { id: bordroId, tenantId, durum: { in: ["hesaplandi", "reddedildi"] } }, select: { id: true, personelId: true } });
      if (!bordro) throw new BadRequestException("Bu bordroya avans mahsubu eklenemez");
      const guncellenen = await tx.personelAvans.updateMany({
        where: { id: veri.avansId, tenantId, personelId: bordro.personelId, durum: { in: ["odendi", "kismen_mahsup"] }, kalanTutar: { gte: tutar } },
        data: { mahsupEdilenTutar: { increment: tutar }, kalanTutar: { decrement: tutar } },
      });
      if (guncellenen.count !== 1) throw new BadRequestException("Avans bulunamadı veya mahsup tutarı kalan bakiyeyi aşıyor");
      const kalem = await tx.personelBordroKalemi.create({ data: { tenantId, bordroId, tip: "kesinti", kod: "avans_mahsup", aciklama: "Avans mahsubu", tutar, manuel: true, avansId: veri.avansId } });
      const avans = await tx.personelAvans.findUniqueOrThrow({ where: { id: veri.avansId }, select: { kalanTutar: true } });
      await tx.personelAvans.update({ where: { id: veri.avansId }, data: { durum: avans.kalanTutar.isZero() ? "mahsup_edildi" : "kismen_mahsup" } });
      await this.bordroToplamlariniGuncelle(tx, tenantId, bordroId);
      return kalem;
    });
  }

  private async bordroToplamlariniGuncelle(tx: Prisma.TransactionClient, tenantId: string, bordroId: string) {
    const kalemler = await tx.personelBordroKalemi.findMany({ where: { tenantId, bordroId }, select: { tip: true, kod: true, tutar: true } });
    const kazanc = kalemler.filter((k) => k.tip === "kazanc").reduce((t, k) => t.add(k.tutar), new Prisma.Decimal(0));
    const kesinti = kalemler.filter((k) => k.tip === "kesinti").reduce((t, k) => t.add(k.tutar), new Prisma.Decimal(0));
    const temelUcret = kalemler.find((k) => k.tip === "kazanc" && (k.kod === "temel_ucret" || k.kod === "temel_brut_ucret"))?.tutar ?? new Prisma.Decimal(0);
    const odenecek = kazanc.sub(kesinti);
    if (odenecek.isNegative()) throw new BadRequestException("Kesintiler toplam kazancı aşamaz");
    await tx.personelBordro.update({
      where: { id: bordroId },
      data: { prim: kazanc.sub(temelUcret), kesinti, odenecekTutar: odenecek, kalanTutar: odenecek },
    });
  }

  private async bordroDurumGecisi(tenantId: string, id: string, kaynak: "hesaplandi", hedef: "onay_bekliyor") {
    const sonuc = await this.prisma.tenantIslem(tenantId, (tx) => tx.personelBordro.updateMany({
      where: { id, tenantId, durum: kaynak }, data: { durum: hedef },
    }));
    if (sonuc.count !== 1) throw new BadRequestException("Bordro mevcut durumundan bu işleme geçirilemez");
    return this.bordroGetir(tenantId, id);
  }

  async bordroOde(tenantId: string, bordroId: string, girdi: z.infer<typeof bordroOdeSemasi>) {
    const veri = bordroOdeSemasi.parse(girdi);
    const tutar = new Prisma.Decimal(veri.tutar);
    await this.donemKilidi?.tarihDogrula(tenantId, veri.odemeTarihi, "maaş ödemesi");

    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const bordro = await tx.personelBordro.findFirst({
        where: { id: bordroId, tenantId },
        include: { personel: { select: PERSONEL_GUVENLI_SECIM } }
      });

      if (!bordro) throw new NotFoundException("Bordro bulunamadı");
      if (!['onaylandi', 'kismen_odendi'].includes(bordro.durum)) throw new BadRequestException("Yalnızca onaylanmış bordroya ödeme yapılabilir");
      if (!bordro.personel.cariId) {
        throw new BadRequestException("Maaş ödemesi için personele bağlı bir cari hesap gereklidir");
      }

      if (veri.kasaId) {
        const kasa = await tx.kasa.findFirst({
          where: { id: veri.kasaId, tenantId, aktif: true, dovizCinsi: "TRY" },
          select: { id: true },
        });
        if (!kasa) throw new BadRequestException("Aktif bir TRY kasası seçilmelidir");
      } else {
        const banka = await tx.bankaHesap.findFirst({
          where: { id: veri.bankaHesapId!, tenantId, aktif: true, dovizCinsi: "TRY" },
          select: { id: true },
        });
        if (!banka) throw new BadRequestException("Aktif bir TRY banka hesabı seçilmelidir");
      }

      const bakiyeGuncelleme = await tx.personelBordro.updateMany({
        where: { id: bordroId, tenantId, durum: { in: ["onaylandi", "kismen_odendi"] }, kalanTutar: { gte: tutar } },
        data: { odenenTutar: { increment: tutar }, kalanTutar: { decrement: tutar } },
      });
      if (bakiyeGuncelleme.count !== 1) throw new BadRequestException("Ödeme tutarı bordronun kalan bakiyesini aşamaz");

      const odeme = await tx.personelBordroOdeme.create({
        data: { tenantId, bordroId, tutar, tarih: veri.odemeTarihi, kasaId: veri.kasaId || null, bankaHesapId: veri.bankaHesapId || null, aciklama: veri.aciklama || null },
      });
      const fis = await tx.kasaBankaHareket.create({
          data: {
            tenantId,
            kasaId: veri.kasaId || null,
            bankaHesapId: veri.bankaHesapId || null,
            cariId: bordro.personel.cariId,
            tip: "tediye",
            tutar,
            tutarTry: tutar,
            tarih: veri.odemeTarihi,
            aciklama: veri.aciklama || `${bordro.donemYil}/${bordro.donemAy} Maaş Ödemesi - ${bordro.personel.ad} ${bordro.personel.soyad}`,
            kaynakTur: "personel_maas",
            kaynakRef: odeme.id,
          }
      });
      const cariHareket = await tx.cariHareket.create({
          data: {
            tenantId,
            cariId: bordro.personel.cariId,
            tip: "borc",
            tutar,
            tutarTry: tutar,
            tarih: veri.odemeTarihi,
            aciklama: veri.aciklama || `${bordro.donemYil}/${bordro.donemAy} Maaş Ödemesi`,
            kaynakTur: "bordro_odeme",
            kaynakRef: odeme.id,
          }
      });
      await tx.personelBordroOdeme.update({ where: { id: odeme.id }, data: { kasaBankaHareketId: fis.id, cariHareketId: cariHareket.id } });
      const guncel = await tx.personelBordro.findUniqueOrThrow({ where: { id: bordroId }, select: { kalanTutar: true } });
      const tamamenOdendi = guncel.kalanTutar.isZero();
      return tx.personelBordro.update({
        where: { id: bordroId },
        data: {
          odendi: tamamenOdendi,
          durum: tamamenOdendi ? "odendi" : "kismen_odendi",
          odemeTarihi: veri.odemeTarihi,
          kasaBankaFiId: fis.id,
        },
        include: { odemeler: { orderBy: [{ tarih: "desc" }, { createdAt: "desc" }] }, kalemler: true, personel: { select: PERSONEL_GUVENLI_SECIM } },
      });
    });
  }

  async bordroOdemeIptal(tenantId: string, bordroId: string, odemeId: string, neden: string) {
    await this.donemKilidi?.tarihDogrula(tenantId, new Date(), "maaş ödemesi iptali");
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const odeme = await tx.personelBordroOdeme.findFirst({ where: { id: odemeId, bordroId, tenantId, durum: "aktif" } });
      if (!odeme) throw new NotFoundException("Aktif bordro ödemesi bulunamadı");
      const bordro = await tx.personelBordro.findFirst({ where: { id: bordroId, tenantId }, include: { personel: true } });
      if (!bordro?.personel.cariId) throw new BadRequestException("Bordro veya personel cari hesabı bulunamadı");
      const sahiplen = await tx.personelBordroOdeme.updateMany({ where: { id: odemeId, tenantId, durum: "aktif" }, data: { durum: "iptal", iptalTarihi: new Date(), iptalNedeni: neden } });
      if (sahiplen.count !== 1) throw new BadRequestException("Ödeme daha önce iptal edilmiştir");
      const tersFis = await tx.kasaBankaHareket.create({ data: {
        tenantId, kasaId: odeme.kasaId, bankaHesapId: odeme.bankaHesapId, cariId: bordro.personel.cariId,
        tip: "tahsilat", tutar: odeme.tutar, tutarTry: odeme.tutar, tarih: new Date(),
        aciklama: `Bordro ödeme iptali: ${neden}`, kaynakTur: "personel_maas_iptal", kaynakRef: odeme.id,
        karsiHareketId: odeme.kasaBankaHareketId,
      }});
      const tersCari = await tx.cariHareket.create({ data: {
        tenantId, cariId: bordro.personel.cariId, tip: "alacak", tutar: odeme.tutar, tutarTry: odeme.tutar,
        tarih: new Date(), aciklama: `Bordro ödeme iptali: ${neden}`, kaynakTur: "bordro_odeme_iptal", kaynakRef: odeme.id,
      }});
      await tx.personelBordroOdeme.update({ where: { id: odemeId }, data: { tersKasaBankaHareketId: tersFis.id, tersCariHareketId: tersCari.id } });
      await tx.personelBordro.update({ where: { id: bordroId }, data: { odenenTutar: { decrement: odeme.tutar }, kalanTutar: { increment: odeme.tutar }, odendi: false } });
      const guncel = await tx.personelBordro.findUniqueOrThrow({ where: { id: bordroId }, select: { odenenTutar: true } });
      return tx.personelBordro.update({ where: { id: bordroId }, data: { durum: guncel.odenenTutar.isZero() ? "onaylandi" : "kismen_odendi" }, include: { odemeler: { orderBy: [{ tarih: "desc" }, { createdAt: "desc" }] }, kalemler: true, personel: { select: PERSONEL_GUVENLI_SECIM } } });
    });
  }

  async avansListele(tenantId: string, personelId?: string) {
    return this.prisma.tenantIslem(tenantId, (tx) => tx.personelAvans.findMany({
      where: { tenantId, ...(personelId ? { personelId } : {}) }, include: { personel: { select: { id: true, personelNo: true, ad: true, soyad: true } } }, orderBy: [{ tarih: "desc" }, { id: "desc" }],
    }));
  }

  async avansVer(tenantId: string, userId: string, girdi: z.infer<typeof avansOlusturSemasi>) {
    const veri = avansOlusturSemasi.parse(girdi);

    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const personel = await tx.personel.findFirst({
        where: { id: veri.personelId, tenantId }
      });
      if (!personel) throw new NotFoundException("Personel bulunamadı");

      return tx.personelAvans.create({ data: {
        tenantId, personelId: veri.personelId, tutar: veri.tutar, tarih: veri.tarih,
        aciklama: veri.aciklama || null, durum: "talep", olusturanUserId: userId, kalanTutar: 0,
      }});
    });
  }

  async avansOnayla(tenantId: string, id: string, userId: string) {
    const avans = await this.prisma.tenantIslem(tenantId, (tx) => tx.personelAvans.findFirst({ where: { id, tenantId } }));
    if (!avans) throw new NotFoundException("Avans talebi bulunamadı");
    if (avans.olusturanUserId === userId) throw new BadRequestException("Avans talebini oluşturan kullanıcı aynı talebi onaylayamaz");
    const sonuc = await this.prisma.tenantIslem(tenantId, (tx) => tx.personelAvans.updateMany({ where: { id, tenantId, durum: "talep" }, data: { durum: "onaylandi", onaylayanUserId: userId, onayTarihi: new Date(), retNedeni: null } }));
    if (sonuc.count !== 1) throw new BadRequestException("Yalnızca bekleyen avans talebi onaylanabilir");
    return this.prisma.tenantIslem(tenantId, (tx) => tx.personelAvans.findUnique({ where: { id } }));
  }

  async avansReddet(tenantId: string, id: string, userId: string, neden: string) {
    const sonuc = await this.prisma.tenantIslem(tenantId, (tx) => tx.personelAvans.updateMany({ where: { id, tenantId, durum: "talep" }, data: { durum: "reddedildi", onaylayanUserId: userId, onayTarihi: new Date(), retNedeni: neden } }));
    if (sonuc.count !== 1) throw new BadRequestException("Yalnızca bekleyen avans talebi reddedilebilir");
    return this.prisma.tenantIslem(tenantId, (tx) => tx.personelAvans.findUnique({ where: { id } }));
  }

  async avansOde(tenantId: string, id: string, girdi: z.infer<typeof avansOdeSemasi>) {
    const veri = avansOdeSemasi.parse(girdi);
    await this.donemKilidi?.tarihDogrula(tenantId, veri.tarih, "avans ödemesi");
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const avans = await tx.personelAvans.findFirst({ where: { id, tenantId, durum: "onaylandi" }, include: { personel: true } });
      if (!avans) throw new BadRequestException("Yalnızca onaylanmış avans ödenebilir");
      if (!avans.personel.cariId) throw new BadRequestException("Avans ödemesi için personel cari hesabı gereklidir");
      if (veri.kasaId) {
        const kasa = await tx.kasa.findFirst({
          where: { id: veri.kasaId, tenantId, aktif: true, dovizCinsi: "TRY" },
          select: { id: true },
        });
        if (!kasa) throw new BadRequestException("Aktif bir TRY kasası seçilmelidir");
      } else {
        const banka = await tx.bankaHesap.findFirst({
          where: { id: veri.bankaHesapId!, tenantId, aktif: true, dovizCinsi: "TRY" },
          select: { id: true },
        });
        if (!banka) throw new BadRequestException("Aktif bir TRY banka hesabı seçilmelidir");
      }

      const fis = await tx.kasaBankaHareket.create({
          data: {
            tenantId,
            kasaId: veri.kasaId || null,
            bankaHesapId: veri.bankaHesapId || null,
            cariId: avans.personel.cariId,
            tip: "tediye",
            tutar: avans.tutar,
            tutarTry: avans.tutar,
            tarih: veri.tarih,
            aciklama: avans.aciklama || `Avans Ödemesi - ${avans.personel.ad} ${avans.personel.soyad}`,
            kaynakTur: "personel_avans",
            kaynakRef: avans.id,
          }
      });
      await tx.cariHareket.create({ data: { tenantId, cariId: avans.personel.cariId, tip: "borc", tutar: avans.tutar, tutarTry: avans.tutar, tarih: veri.tarih, aciklama: "Personel avans alacağı", kaynakTur: "personel_avans", kaynakRef: avans.id } });
      return tx.personelAvans.update({ where: { id }, data: { durum: "odendi", odendi: true, odenenTutar: avans.tutar, kalanTutar: avans.tutar, kasaBankaFiId: fis.id, tarih: veri.tarih } });
    });
  }

  /** PRS-06: onaylı/ödenmiş bordrosu olan ay ve sonrası geriye dönük değiştirilemez. */
  private async ucretDonemKontrolu(tx: Prisma.TransactionClient, tenantId: string, personelId: string, tarih: Date) {
    const kilitli = await tx.personelBordro.findFirst({
      where: { tenantId, personelId, durum: { in: ["onaylandi", "kismen_odendi", "odendi"] }, OR: [{ donemYil: { gt: tarih.getUTCFullYear() } }, { donemYil: tarih.getUTCFullYear(), donemAy: { gte: tarih.getUTCMonth() + 1 } }] },
      orderBy: [{ donemYil: "asc" }, { donemAy: "asc" }], select: { donemYil: true, donemAy: true },
    });
    if (kilitli) throw new BadRequestException(`${kilitli.donemYil}/${String(kilitli.donemAy).padStart(2, "0")} bordrosu onaylı; o aya etki eden ücret değişikliği için önce onayı geri alın`);
  }

  /** Kartta gösterilen güncel ücret: bugün geçerli kayıt. */
  private async kartUcretiniGuncelle(tx: Prisma.TransactionClient, tenantId: string, personelId: string) {
    const bugun = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
    const gecerli = await tx.personelUcret.findFirst({ where: { tenantId, personelId, yururlukTarihi: { lte: bugun } }, orderBy: { yururlukTarihi: "desc" } })
      ?? await tx.personelUcret.findFirst({ where: { tenantId, personelId }, orderBy: { yururlukTarihi: "asc" } });
    if (!gecerli) return;
    await tx.personel.update({ where: { id: personelId }, data: gecerli.tip === "brut" ? { brutMaas: gecerli.tutar } : { netMaas: gecerli.tutar, brutMaas: null } });
  }

  /**
   * PRS-06 (P1-1): yürürlük tarihli ücret değişikliği (zam, net↔brüt geçişi).
   * Aynı güne ikinci kayıt öncekini değiştirir. Onaylı bordro dönemine geriye
   * dönük kayıt girilemez; onaylanmamış bordrolar "Yeniden hesapla" ile güncellenir.
   */
  async ucretEkle(tenantId: string, personelId: string, userId: string, girdi: z.infer<typeof personelUcretSemasi>) {
    const v = personelUcretSemasi.parse(girdi);
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const personel = await tx.personel.findFirst({ where: { id: personelId, tenantId }, select: { id: true, girisTarihi: true } });
      if (!personel) throw new NotFoundException("Personel bulunamadı");
      await this.ucretDonemKontrolu(tx, tenantId, personelId, v.yururlukTarihi);
      const kayit = await tx.personelUcret.upsert({
        where: { tenantId_personelId_yururlukTarihi: { tenantId, personelId, yururlukTarihi: v.yururlukTarihi } },
        create: { tenantId, personelId, yururlukTarihi: v.yururlukTarihi, tip: v.tip, tutar: v.tutar, neden: v.neden ?? null, olusturanUserId: userId },
        update: { tip: v.tip, tutar: v.tutar, neden: v.neden ?? null, olusturanUserId: userId },
      });
      await this.kartUcretiniGuncelle(tx, tenantId, personelId);
      await tx.auditLog.create({ data: { tenantId, userId, islem: "personel_ucret_ekle", varlik: "personel", varlikId: personelId, detay: { yururluk: v.yururlukTarihi.toISOString().slice(0, 10), tip: v.tip, tutar: kayit.tutar.toFixed(2), neden: v.neden ?? null } } });
      return kayit;
    });
  }

  async ucretSil(tenantId: string, personelId: string, ucretId: string, userId: string) {
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const kayit = await tx.personelUcret.findFirst({ where: { id: ucretId, personelId, tenantId } });
      if (!kayit) throw new NotFoundException("Ücret kaydı bulunamadı");
      if (await tx.personelUcret.count({ where: { tenantId, personelId } }) <= 1) throw new BadRequestException("Tek ücret kaydı silinemez; yeni kayıt ekleyerek değiştirin");
      await this.ucretDonemKontrolu(tx, tenantId, personelId, kayit.yururlukTarihi);
      await tx.personelUcret.delete({ where: { id: ucretId } });
      await this.kartUcretiniGuncelle(tx, tenantId, personelId);
      await tx.auditLog.create({ data: { tenantId, userId, islem: "personel_ucret_sil", varlik: "personel", varlikId: personelId, detay: { yururluk: kayit.yururlukTarihi.toISOString().slice(0, 10), tip: kayit.tip, tutar: kayit.tutar.toFixed(2) } } });
      return { silindi: true };
    });
  }

  /**
   * PRS-16 (P2-7): seçilen bordrolara toplu onaya gönderme, onaylama ya da
   * ödeme (kalan tutar). Her bordro tekil işlemin kurallarından geçer
   * (hazırlayan onaylayamaz, dönem kilidi…); hata ötekileri durdurmaz.
   */
  async bordroToplu(tenantId: string, userId: string, girdi: { islem: "onaya_gonder" | "onayla" | "ode"; bordroIdler: string[]; kasaId?: string | null; bankaHesapId?: string | null; odemeTarihi?: Date }) {
    const bordrolar = await this.prisma.tenantIslem(tenantId, (tx) => tx.personelBordro.findMany({ where: { tenantId, id: { in: girdi.bordroIdler } }, select: { id: true, kalanTutar: true, personel: { select: { personelNo: true, ad: true, soyad: true } } } }));
    const atlananlar: { bordroId: string; personel: string; mesaj: string }[] = [];
    let islenen = 0;
    for (const b of bordrolar) {
      try {
        if (girdi.islem === "onaya_gonder") await this.bordroOnayaGonder(tenantId, b.id);
        else if (girdi.islem === "onayla") await this.bordroOnayla(tenantId, b.id, userId);
        else {
          if (b.kalanTutar.lte(0)) throw new BadRequestException("Kalan tutar yok");
          await this.bordroOde(tenantId, b.id, { kasaId: girdi.kasaId ?? null, bankaHesapId: girdi.bankaHesapId ?? null, odemeTarihi: girdi.odemeTarihi!, tutar: b.kalanTutar.toFixed(2) } as never);
        }
        islenen += 1;
      } catch (hata) {
        atlananlar.push({ bordroId: b.id, personel: `${b.personel.personelNo} ${b.personel.ad} ${b.personel.soyad}`, mesaj: hata instanceof Error ? hata.message : "İşlem yapılamadı" });
      }
    }
    for (const id of girdi.bordroIdler) if (!bordrolar.some((b) => b.id === id)) atlananlar.push({ bordroId: id, personel: "—", mesaj: "Bordro bulunamadı" });
    return { islenen, atlananlar };
  }

  /** PRS-16: dönemin puantaj şablonu (kapsamdaki personel + kayıtlı değerler). */
  async puantajSablonuUret(tenantId: string, yil: number, ay: number) {
    const liste = await this.donemCalismaListele(tenantId, yil, ay);
    return puantajSablonu(yil, ay, liste.map((p) => {
      const c = p.donemCalismalari[0];
      return {
        personelNo: p.personelNo, adSoyad: `${p.ad} ${p.soyad}`, istihdamGunu: p.istihdamGunu,
        primGunu: c?.primGunu ?? p.onerilenPrimGunu, eksikGunNedeni: c ? c.eksikGunNedeni : p.onerilenEksikGunNedeni,
        fazlaMesaiBrut: Number(c?.fazlaMesaiBrut ?? 0), primIkramiyeBrut: Number(c?.primIkramiyeBrut ?? 0), nakitYemekYardimi: Number(c?.nakitYemekYardimi ?? 0),
        fiiliCalismaGunu: c?.fiiliCalismaGunu ?? 0, sahisSigortaPrimi: Number(c?.sahisSigortaPrimi ?? 0), hayatSigortaPrimi: Number(c?.hayatSigortaPrimi ?? 0),
        sendikaAidati: Number(c?.sendikaAidati ?? 0), aciklama: c?.aciklama ?? null,
      };
    }));
  }

  /** PRS-16: Excel'den puantaj; her satır tekil kayıt kurallarından geçer, satır satır sonuç döner. */
  async puantajIceAktar(tenantId: string, yil: number, ay: number, buffer: Buffer) {
    const satirlar = await puantajOku(buffer);
    if (!satirlar.length) throw new BadRequestException("Dosyada puantaj satırı bulunamadı");
    const personeller = await this.prisma.tenantIslem(tenantId, (tx) => tx.personel.findMany({ where: { tenantId, personelNo: { in: satirlar.map((s) => s.personelNo) } }, select: { id: true, personelNo: true } }));
    const harita = new Map(personeller.map((p) => [p.personelNo, p.id]));
    const hatalar: { satir: number; personelNo: string; mesaj: string }[] = [];
    let kaydedilen = 0;
    for (const s of satirlar) {
      const personelId = harita.get(s.personelNo);
      if (!personelId) { hatalar.push({ satir: s.satir, personelNo: s.personelNo, mesaj: "Personel bulunamadı" }); continue; }
      try {
        const { satir: _s, personelNo: _n, ...alanlar } = s;
        await this.donemCalismaKaydet(tenantId, donemCalismaSemasi.parse({ personelId, yil, ay, ...alanlar }));
        kaydedilen += 1;
      } catch (hata) {
        const mesaj = hata instanceof z.ZodError ? hata.issues.map((i) => i.message).join("; ") : hata instanceof Error ? hata.message : "Kaydedilemedi";
        hatalar.push({ satir: s.satir, personelNo: s.personelNo, mesaj });
      }
    }
    return { kaydedilen, hatalar };
  }

  /**
   * PRS-04 (P1-10): mahsup edilmemiş avans ödemesi ters kayıtla geri alınır;
   * avans yeniden "onaylandı" olur, doğru hesaptan tekrar ödenebilir.
   */
  async avansOdemeIptal(tenantId: string, id: string, userId: string, neden: string) {
    await this.donemKilidi?.tarihDogrula(tenantId, new Date(), "avans ödemesi iptali");
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const avans = await tx.personelAvans.findFirst({ where: { id, tenantId }, include: { personel: { select: { cariId: true, ad: true, soyad: true } } } });
      if (!avans) throw new NotFoundException("Avans bulunamadı");
      if (avans.durum !== "odendi" || avans.mahsupEdilenTutar.gt(0)) throw new BadRequestException("Yalnız ödenmiş ve bordrodan hiç mahsup edilmemiş avansın ödemesi geri alınır; önce mahsubu bordrodan kaldırın");
      const isaret = await tx.personelAvans.updateMany({ where: { id, tenantId, durum: "odendi", mahsupEdilenTutar: 0 }, data: { durum: "onaylandi", odendi: false, odenenTutar: 0, kalanTutar: 0, kasaBankaFiId: null } });
      if (isaret.count !== 1) throw new BadRequestException("Avans eşzamanlı olarak değişti");
      const fis = avans.kasaBankaFiId ? await tx.kasaBankaHareket.findFirst({ where: { id: avans.kasaBankaFiId, tenantId } }) : null;
      if (fis) {
        await tx.kasaBankaHareket.create({ data: {
          tenantId, kasaId: fis.kasaId, bankaHesapId: fis.bankaHesapId, cariId: fis.cariId, tip: "tahsilat", tutar: fis.tutar, tutarTry: fis.tutarTry, tarih: new Date(),
          aciklama: `Avans ödemesi iptali: ${neden}`.slice(0, 500), kaynakTur: "personel_avans_iptal", kaynakRef: avans.id, karsiHareketId: fis.id,
        } });
      }
      const cariHareket = await tx.cariHareket.findFirst({ where: { tenantId, kaynakTur: "personel_avans", kaynakRef: avans.id }, orderBy: { createdAt: "desc" } });
      if (cariHareket) {
        await tx.cariHareket.create({ data: {
          tenantId, cariId: cariHareket.cariId, tip: "alacak", tutar: cariHareket.tutar, tutarTry: cariHareket.tutarTry, tarih: new Date(),
          aciklama: `Avans ödemesi iptali: ${neden}`.slice(0, 500), kaynakTur: "personel_avans_iptal", kaynakRef: avans.id,
        } });
      }
      await tx.auditLog.create({ data: { tenantId, userId, islem: "personel_avans_odeme_iptal", varlik: "personel_avans", varlikId: id, detay: { tutar: avans.tutar.toFixed(2), neden, kasaTers: Boolean(fis), cariTers: Boolean(cariHareket) } } });
      return tx.personelAvans.findUnique({ where: { id } });
    });
  }

  /**
   * PRS-04 (P1-3): carisi olmayan personele cari bağlar (verilen cari ya da
   * yeni açılan). Onaylı bordrolardan cari tahakkuku olmayanlar dönem sonu
   * tarihiyle yazılır (kapalı dönem reddedilir).
   */
  async cariBagla(tenantId: string, id: string, userId: string, mevcutCariId?: string | null) {
    const eksikler = await this.prisma.tenantIslem(tenantId, async (tx) => {
      const personel = await tx.personel.findFirst({ where: { id, tenantId } });
      if (!personel) throw new NotFoundException("Personel bulunamadı");
      if (personel.cariId) throw new BadRequestException("Personelin zaten bağlı carisi var");
      const bordrolar = await tx.personelBordro.findMany({ where: { tenantId, personelId: id, durum: { in: ["onaylandi", "kismen_odendi", "odendi"] } }, include: { kalemler: { select: { avansId: true, tutar: true } } } });
      return bordrolar;
    });
    for (const b of eksikler) await this.donemKilidi?.tarihDogrula(tenantId, donemSonu(b.donemYil, b.donemAy), "personel cari tahakkuku");

    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const personel = await tx.personel.findFirstOrThrow({ where: { id, tenantId } });
      let cariId: string;
      if (mevcutCariId) {
        const cari = await tx.cariHesap.findFirst({ where: { id: mevcutCariId, tenantId }, select: { id: true, personel: { select: { id: true } } } });
        if (!cari) throw new NotFoundException("Cari bulunamadı");
        if (cari.personel) throw new BadRequestException("Bu cari başka bir personele bağlı");
        cariId = cari.id;
      } else {
        const kodVar = await tx.cariHesap.findFirst({ where: { tenantId, kod: personel.personelNo }, select: { id: true } });
        const yeni = await tx.cariHesap.create({ data: {
          tenantId, kod: kodVar ? `${personel.personelNo}-P` : personel.personelNo, unvan: `${personel.ad} ${personel.soyad}`, tip: "personel", kisiTipi: "gercek",
          ad: personel.ad, soyad: personel.soyad, eposta: personel.eposta, telefon: personel.telefon, iban: hassasCoz(personel.iban), vknTckn: hassasCoz(personel.tckn),
        } });
        cariId = yeni.id;
      }
      await tx.personel.update({ where: { id }, data: { cariId } });
      let yazilan = 0;
      for (const b of eksikler) {
        const tahakkuk = await tx.cariHareket.findFirst({ where: { tenantId, kaynakTur: "bordro_tahakkuk", kaynakRef: b.id } });
        if (tahakkuk) continue;
        const tutar = cariTahakkukTutari(b);
        await tx.cariHareket.create({ data: {
          tenantId, cariId, tip: "alacak", tutar, tutarTry: tutar, tarih: donemSonu(b.donemYil, b.donemAy),
          aciklama: `${b.donemYil}/${b.donemAy} Maaş Tahakkuku`, kaynakTur: "bordro_tahakkuk", kaynakRef: b.id,
        } });
        yazilan++;
      }
      await tx.auditLog.create({ data: { tenantId, userId, islem: "personel_cari_bagla", varlik: "personel", varlikId: id, detay: { cariId, yeniCari: !mevcutCariId, eksikTahakkuk: yazilan } } });
      return { cariId, eksikTahakkuk: yazilan };
    });
  }

  /**
   * Dönemin ödenmemiş (onaylı ya da kısmen ödenmiş) bordrolarından toplu maaş
   * havalesi CSV'si. TCKN/IBAN çözülerek yazılır; IBAN'ı olmayan personel varsa
   * dosya üretilmez (bankada reddedilecek satır göndermek yerine eksik listelenir).
   * Toplu hassas veri dökümü denetim kaydına yazılır.
   */
  async bankaMaasDosyasiOlustur(tenantId: string, userId: string, yil: number, ay: number) {
    const bordrolar = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.personelBordro.findMany({
        where: { tenantId, donemYil: yil, donemAy: ay, durum: { in: ["onaylandi", "kismen_odendi"] }, kalanTutar: { gt: 0 } },
        include: { personel: { select: { personelNo: true, ad: true, soyad: true, tckn: true, iban: true } } },
        orderBy: { personel: { ad: "asc" } },
      })
    );
    if (bordrolar.length === 0) {
      throw new BadRequestException("Belirtilen dönemde ödenmemiş onaylı maaş bordrosu bulunamadı");
    }
    const satirlar = bordrolar.map((b) => ({ ...b, tckn: hassasCoz(b.personel.tckn), iban: hassasCoz(b.personel.iban) }));
    const ibansiz = satirlar.filter((b) => !b.iban);
    if (ibansiz.length) {
      throw new BadRequestException(`IBAN'ı olmayan personel var: ${ibansiz.map((b) => `${b.personel.personelNo} ${b.personel.ad} ${b.personel.soyad}`).join(", ")}. Personel kartına IBAN girip yeniden deneyin`);
    }

    const donem = `${yil}/${String(ay).padStart(2, "0")}`;
    const alan = (deger: string) => `"${deger.replaceAll('"', '""')}"`;
    const toplam = satirlar.reduce((t, b) => t.add(b.kalanTutar), new Prisma.Decimal(0));
    // Excel Türkçe karakterleri doğru açsın diye UTF-8 BOM.
    const dosyaIcerigi = "\uFEFF" + ["Ad Soyad;TCKN;IBAN;Tutar;Açıklama", ...satirlar.map((b) =>
      [alan(`${b.personel.ad} ${b.personel.soyad}`), alan(b.tckn ?? ""), alan(b.iban!), b.kalanTutar.toFixed(2), alan(`${donem} Maaş Ödemesi`)].join(";"),
    )].join("\r\n") + "\r\n";

    await this.prisma.tenantIslem(tenantId, (tx) => tx.auditLog.create({
      data: { tenantId, userId, islem: "HASSAS_VERI_TOPLU_DISA_AKTAR", varlik: "personel_bordro", detay: { amac: "banka_maas_dosyasi", donem, personelSayisi: satirlar.length, toplam: toplam.toFixed(2) } },
    }));
    return {
      donemYil: yil,
      donemAy: ay,
      toplamPersonel: satirlar.length,
      toplamTutar: toplam.toFixed(2),
      dosyaAdi: `Maas_Transfer_${yil}_${String(ay).padStart(2, "0")}.csv`,
      dosyaIcerigi,
    };
  }
}
