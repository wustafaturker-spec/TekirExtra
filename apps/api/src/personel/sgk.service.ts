import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import * as ExcelJS from "exceljs";
import { z } from "zod";
import { bugunTR } from "@tekirextra/shared";
import { PrismaService } from "../core/prisma.service";
import { PdfService } from "../core/pdf/pdf.service";
import { kacis, sayfaSablonu } from "../core/pdf/pdf-sablon";
import { raporSayfasiEkle } from "../core/raporlar/rapor-excel";
import { raporTablosuHtml } from "../core/raporlar/rapor-pdf";
import type { RaporKolon, RaporSatiri } from "../core/raporlar/rapor-kayit";
import { hassasCoz, tcknMaskele } from "./personel-hassas";
import { hesapOzetiTutari } from "./personel-rapor-yardimci";
import { istihdamGunu } from "./tahakkuk-kapsami";
import { aphbBildirgeleri, aphbDisiNedeni, hizmetSatiri, muhsgkOzeti, ONAYLI_BORDRO_DURUMLARI, type HizmetSatiri } from "./sgk-dokum";
import { belgeTuruSigortaKolu, iseGirisSonTarihi, istenCikisSonTarihi, isyeriSiciliAyristir, MESLEK_KODU_DESENI, OGRENIM_DURUMLARI, SGK_CIKIS_KODLARI, tesvikKanunNo } from "./sgk-kodlari";
import { aphbDogrula, aphbXml, iseGirisXml, istenCikisXml, type CikisDonemi, type XmlIsyeri } from "./sgk-xml";

const evetHayir = z.enum(["1", "0", "true", "false"]).transform((v) => v === "1" || v === "true");
export const bildirgeListeSemasi = z.object({
  tur: z.enum(["giris", "cikis"]),
  baslangic: z.coerce.date(),
  bitis: z.coerce.date(),
  isyeriId: z.string().uuid().optional(),
  yalnizVerilmemis: evetHayir.optional(),
}).refine((f) => f.bitis >= f.baslangic, { message: "Bitiş tarihi başlangıçtan önce olamaz", path: ["bitis"] });
export const muhsgkSemasi = z.object({ yil: z.coerce.number().int().min(2020).max(2100), ay: z.coerce.number().int().min(1).max(12), isyeriId: z.string().uuid().optional() });
export const bildirgeIsaretSemasi = z.object({ tur: z.enum(["giris", "cikis"]), tarih: z.coerce.date(), no: z.string().trim().max(50).optional().nullable() });
export const cikisKoduSemasi = z.object({ kod: z.string().refine((k) => k in SGK_CIKIS_KODLARI, "Geçersiz SGK çıkış kodu") });
export type DosyaBicimi = "xlsx" | "pdf" | "xml";

type Tx = Prisma.TransactionClient;
const iso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const ayAnahtari = (yil: number, ay: number) => `${yil}-${String(ay).padStart(2, "0")}`;
const oncekiAy = (yil: number, ay: number) => (ay === 1 ? { yil: yil - 1, ay: 12 } : { yil, ay: ay - 1 });

const PERSONEL_SECIMI = {
  id: true, personelNo: true, ad: true, soyad: true, tckn: true, engellilikDerecesi: true, sgkTesvikOrani: true,
  meslekKodu: true, sgkBelgeTuru: true, ogrenimDurumu: true, mezuniyetYili: true, mezuniyetBolumu: true, eskiHukumlu: true, tesvikKanunNo: true,
  isyeri: { select: { id: true, kod: true, ad: true, adres: true, sgkSicilNo: true, csgbIsKolu: true } },
  istihdamDonemleri: { select: { id: true, baslangicTarihi: true, bitisTarihi: true, sgkCikisKodu: true } },
} satisfies Prisma.PersonelSelect;
type SgkPersoneli = Prisma.PersonelGetPayload<{ select: typeof PERSONEL_SECIMI }>;
type BordroOzeti = { personelId: string; donemYil: number; donemAy: number; primGunu: number; eksikGunNedeni: string | null; hesapOzeti: Prisma.JsonValue };

export interface BildirgeSatiri {
  istihdamId: string; personelId: string; personelNo: string; adSoyad: string; ad: string; soyad: string; tckn: string | null; tcknMaskeli: string | null;
  isyeriId: string | null; isyeri: string | null; sgkSicilNo: string | null; tarih: string;
  belgeTuru: string; sigortaKolu: string | null; meslekKodu: string | null; ogrenimDurumu: number | null; mezuniyetYili: number | null; mezuniyetBolumu: string | null;
  engelli: boolean; eskiHukumlu: boolean; gorevKodu: string; kanunNo: string; cikisKodu: string | null;
  sonTarih: string; bildirgeTarihi: string | null; bildirgeNo: string | null; durum: "verildi" | "gecikti" | "bekliyor";
  bulundugumuz: CikisDonemi | null; onceki: CikisDonemi | null; eksikler: string[]; xmlDisi: string | null;
}

/**
 * PRS-24…28 (P3-3): SGK bildirge verisi, MUHSGK ön dökümü ve yükleme XML'leri.
 * Dosyalarda TCKN açık yazıldığı için her indirme denetim kaydına geçer;
 * ekran yanıtları maskelidir.
 */
@Injectable()
export class SgkService {
  constructor(private readonly prisma: PrismaService, private readonly pdf: PdfService) {}

  private firma(tx: Tx, tenantId: string) {
    return tx.tenant.findUnique({ where: { id: tenantId }, select: { unvan: true, vkn: true, adres: true, ilce: true, il: true } });
  }

  /** İstihdam dönemine göre personelin o aydaki onaylı bordroları (çıkış ayı ve önceki ay). */
  private async onayliBordrolar(tx: Tx, tenantId: string, personelIdler: string[], aylar: { yil: number; ay: number }[]) {
    if (!personelIdler.length || !aylar.length) return new Map<string, BordroOzeti>();
    const bordrolar = await tx.personelBordro.findMany({
      where: { tenantId, personelId: { in: personelIdler }, durum: { in: [...ONAYLI_BORDRO_DURUMLARI] }, OR: aylar.map((a) => ({ donemYil: a.yil, donemAy: a.ay })) },
      select: { personelId: true, donemYil: true, donemAy: true, primGunu: true, eksikGunNedeni: true, hesapOzeti: true },
    });
    return new Map(bordrolar.map((b) => [`${b.personelId}|${ayAnahtari(b.donemYil, b.donemAy)}`, b]));
  }

  private hizmet(p: SgkPersoneli, b: BordroOzeti, giris: string | null, cikis: string | null, cikisKodu: string | null): HizmetSatiri {
    const tesvik = hesapOzetiTutari(b.hesapOzeti, "sgkTesvikOrani", p.sgkTesvikOrani).toNumber();
    return hizmetSatiri({
      personelId: p.id, personelNo: p.personelNo, ad: p.ad, soyad: p.soyad, tckn: hassasCoz(p.tckn), belgeTuru: p.sgkBelgeTuru, kanunNo: tesvikKanunNo(p.tesvikKanunNo, tesvik), meslekKodu: p.meslekKodu,
      primGunu: b.primGunu, istihdamGunu: istihdamGunu(p.istihdamDonemleri, b.donemYil, b.donemAy), eksikGunNedeni: b.eksikGunNedeni, girisTarihi: giris, cikisTarihi: cikis, cikisKodu, hesapOzeti: b.hesapOzeti,
    });
  }

  private cikisDonemi(p: SgkPersoneli, b: BordroOzeti | undefined, cikis: string, cikisKodu: string | null): CikisDonemi | null {
    if (!b) return null;
    const s = this.hizmet(p, b, null, cikis, cikisKodu);
    return s.hesapIzi ? { belgeTuru: p.sgkBelgeTuru, hakEdilenUcret: s.hakEdilenUcret, primIkramiye: s.primIkramiye, eksikGunSayisi: s.eksikGunSayisi, eksikGunNedeni: s.eksikGunKodu } : null;
  }

  /** PRS-25: tam (TCKN açık) bildirge satırları; ekrana maskelenerek, dosyaya olduğu gibi gider. */
  private async bildirgeSatirlari(tenantId: string, f: z.infer<typeof bildirgeListeSemasi>): Promise<BildirgeSatiri[]> {
    const giris = f.tur === "giris";
    const bugun = bugunTR();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const donemler = await tx.personelIstihdamDonemi.findMany({
        where: {
          tenantId,
          ...(giris ? { baslangicTarihi: { gte: f.baslangic, lte: f.bitis } } : { bitisTarihi: { gte: f.baslangic, lte: f.bitis } }),
          ...(f.yalnizVerilmemis && (giris ? { iseGirisBildirgeTarihi: null } : { istenCikisBildirgeTarihi: null })),
          personel: { durum: { not: "taslak" }, ...(f.isyeriId && { isyeriId: f.isyeriId }) },
        },
        include: { personel: { select: PERSONEL_SECIMI } },
        orderBy: giris ? { baslangicTarihi: "asc" } : { bitisTarihi: "asc" },
      });
      const aylar = new Map<string, { yil: number; ay: number }>();
      if (!giris) for (const d of donemler) {
        const yil = d.bitisTarihi!.getUTCFullYear(), ay = d.bitisTarihi!.getUTCMonth() + 1;
        aylar.set(ayAnahtari(yil, ay), { yil, ay });
        const o = oncekiAy(yil, ay); aylar.set(ayAnahtari(o.yil, o.ay), o);
      }
      const bordrolar = giris ? new Map<string, BordroOzeti>() : await this.onayliBordrolar(tx, tenantId, [...new Set(donemler.map((d) => d.personelId))], [...aylar.values()]);
      return donemler.map((d): BildirgeSatiri => {
        const p = d.personel;
        const tarihD = giris ? d.baslangicTarihi : d.bitisTarihi!;
        const tarih = iso(tarihD)!;
        const sonTarih = iso(giris ? iseGirisSonTarihi(tarihD) : istenCikisSonTarihi(tarihD))!;
        const bildirgeTarihi = iso(giris ? d.iseGirisBildirgeTarihi : d.istenCikisBildirgeTarihi);
        const tckn = hassasCoz(p.tckn);
        const yil = tarihD.getUTCFullYear(), ay = tarihD.getUTCMonth() + 1, o = oncekiAy(yil, ay);
        const bulundugumuz = giris ? null : this.cikisDonemi(p, bordrolar.get(`${p.id}|${ayAnahtari(yil, ay)}`), tarih, d.sgkCikisKodu);
        const onceki = giris ? null : this.cikisDonemi(p, bordrolar.get(`${p.id}|${ayAnahtari(o.yil, o.ay)}`), tarih, d.sgkCikisKodu);
        const sigortaKolu = belgeTuruSigortaKolu(p.sgkBelgeTuru);
        const meslekGecerli = Boolean(p.meslekKodu && MESLEK_KODU_DESENI.test(p.meslekKodu));
        const eksikler = [
          !tckn && "TCKN", !p.isyeri && "işyeri", p.isyeri && !isyeriSiciliAyristir(p.isyeri.sgkSicilNo) && "işyeri sicil no (26 hane)",
          !meslekGecerli && "meslek kodu", giris && p.ogrenimDurumu === null && "öğrenim durumu", giris && !sigortaKolu && `belge türü ${p.sgkBelgeTuru} için sigorta kolu`,
          !giris && !d.sgkCikisKodu && "SGK çıkış kodu", !giris && !bulundugumuz && "çıkış ayının onaylı bordrosu",
        ].filter((e): e is string => Boolean(e));
        // Öğrenim boşsa XML'e 0 (bilinmeyen) yazılır; diğer eksikler kişiyi dosyanın dışında bırakır.
        const xmlEngeli = eksikler.filter((e) => e !== "öğrenim durumu" && e !== "işyeri sicil no (26 hane)");
        return {
          istihdamId: d.id, personelId: p.id, personelNo: p.personelNo, adSoyad: `${p.ad} ${p.soyad}`, ad: p.ad, soyad: p.soyad, tckn, tcknMaskeli: tcknMaskele(p.tckn),
          isyeriId: p.isyeri?.id ?? null, isyeri: p.isyeri?.ad ?? null, sgkSicilNo: p.isyeri?.sgkSicilNo ?? null, tarih,
          belgeTuru: p.sgkBelgeTuru, sigortaKolu, meslekKodu: p.meslekKodu, ogrenimDurumu: p.ogrenimDurumu, mezuniyetYili: p.mezuniyetYili, mezuniyetBolumu: p.mezuniyetBolumu,
          engelli: (p.engellilikDerecesi ?? 0) > 0, eskiHukumlu: p.eskiHukumlu, gorevKodu: "2", kanunNo: tesvikKanunNo(p.tesvikKanunNo, Number(p.sgkTesvikOrani)), cikisKodu: d.sgkCikisKodu,
          sonTarih, bildirgeTarihi, bildirgeNo: giris ? d.iseGirisBildirgeNo : d.istenCikisBildirgeNo, durum: bildirgeTarihi ? "verildi" : bugun > sonTarih ? "gecikti" : "bekliyor",
          bulundugumuz, onceki, eksikler, xmlDisi: xmlEngeli.length ? `eksik: ${xmlEngeli.join(", ")}` : null,
        };
      });
    });
  }

  async bildirgeListesi(tenantId: string, girdi: unknown) {
    const f = bildirgeListeSemasi.parse(girdi);
    return (await this.bildirgeSatirlari(tenantId, f)).map(({ tckn: _tckn, ...s }) => s);
  }

  /** PRS-24: bildirgeyi verildi olarak işaretler; işlem denetim kaydına yazılır. */
  async bildirgeIsaretle(tenantId: string, userId: string, istihdamId: string, girdi: unknown) {
    const v = bildirgeIsaretSemasi.parse(girdi);
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const d = await tx.personelIstihdamDonemi.findFirst({ where: { id: istihdamId, tenantId }, select: { id: true, personelId: true, baslangicTarihi: true, bitisTarihi: true } });
      if (!d) throw new NotFoundException("İstihdam dönemi bulunamadı");
      if (v.tur === "cikis" && !d.bitisTarihi) throw new BadRequestException("İşten çıkışı yapılmamış dönem için çıkış bildirgesi işaretlenemez");
      const yarin = new Date(`${bugunTR()}T00:00:00Z`); yarin.setUTCDate(yarin.getUTCDate() + 1);
      if (v.tarih >= yarin) throw new BadRequestException("Bildirge tarihi gelecekte olamaz");
      const veri = v.tur === "giris" ? { iseGirisBildirgeTarihi: v.tarih, iseGirisBildirgeNo: v.no || null } : { istenCikisBildirgeTarihi: v.tarih, istenCikisBildirgeNo: v.no || null };
      await tx.personelIstihdamDonemi.update({ where: { id: d.id }, data: veri });
      await tx.auditLog.create({ data: { tenantId, userId, islem: "personel_sgk_bildirge_isaretle", varlik: "personel", varlikId: d.personelId, detay: { istihdamId: d.id, tur: v.tur, tarih: iso(v.tarih), no: v.no || null } } });
      return { istihdamId: d.id, tur: v.tur, tarih: iso(v.tarih), no: v.no || null };
    });
  }

  async bildirgeIsaretGeriAl(tenantId: string, userId: string, istihdamId: string, tur: "giris" | "cikis") {
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const d = await tx.personelIstihdamDonemi.findFirst({ where: { id: istihdamId, tenantId } });
      if (!d) throw new NotFoundException("İstihdam dönemi bulunamadı");
      const onceki = tur === "giris" ? { tarih: iso(d.iseGirisBildirgeTarihi), no: d.iseGirisBildirgeNo } : { tarih: iso(d.istenCikisBildirgeTarihi), no: d.istenCikisBildirgeNo };
      if (!onceki.tarih) throw new BadRequestException("Bildirge işaretli değil");
      await tx.personelIstihdamDonemi.update({ where: { id: d.id }, data: tur === "giris" ? { iseGirisBildirgeTarihi: null, iseGirisBildirgeNo: null } : { istenCikisBildirgeTarihi: null, istenCikisBildirgeNo: null } });
      await tx.auditLog.create({ data: { tenantId, userId, islem: "personel_sgk_bildirge_geri_al", varlik: "personel", varlikId: d.personelId, detay: { istihdamId: d.id, tur, onceki } } });
      return { istihdamId: d.id, tur };
    });
  }

  /** PRS-24: SGK çıkış kodu sonradan düzeltilebilir. */
  async cikisKoduGuncelle(tenantId: string, userId: string, istihdamId: string, girdi: unknown) {
    const { kod } = cikisKoduSemasi.parse(girdi);
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const d = await tx.personelIstihdamDonemi.findFirst({ where: { id: istihdamId, tenantId }, select: { id: true, personelId: true, bitisTarihi: true, sgkCikisKodu: true } });
      if (!d) throw new NotFoundException("İstihdam dönemi bulunamadı");
      if (!d.bitisTarihi) throw new BadRequestException("İşten çıkışı yapılmamış dönemin çıkış kodu olmaz");
      await tx.personelIstihdamDonemi.update({ where: { id: d.id }, data: { sgkCikisKodu: kod } });
      await tx.auditLog.create({ data: { tenantId, userId, islem: "personel_sgk_cikis_kodu", varlik: "personel", varlikId: d.personelId, detay: { istihdamId: d.id, onceki: d.sgkCikisKodu, yeni: kod } } });
      return { istihdamId: d.id, kod };
    });
  }

  /** PRS-26: dönemin onaylı bordrolarından hizmet satırları + özet. */
  private async muhsgkVerisi(tenantId: string, f: z.infer<typeof muhsgkSemasi>) {
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const bordrolar = await tx.personelBordro.findMany({
        where: { tenantId, donemYil: f.yil, donemAy: f.ay, ...(f.isyeriId && { personel: { isyeriId: f.isyeriId } }) },
        select: { personelId: true, donemYil: true, donemAy: true, primGunu: true, eksikGunNedeni: true, hesapOzeti: true, durum: true, personel: { select: PERSONEL_SECIMI } },
      });
      const onayli = bordrolar.filter((b) => (ONAYLI_BORDRO_DURUMLARI as readonly string[]).includes(b.durum));
      const ayBas = new Date(Date.UTC(f.yil, f.ay - 1, 1)), aySon = new Date(Date.UTC(f.yil, f.ay, 0));
      const satirlar = onayli.map((b) => {
        const icinde = (t: Date | null) => Boolean(t && t >= ayBas && t <= aySon);
        const giris = b.personel.istihdamDonemleri.find((d) => icinde(d.baslangicTarihi));
        const cikis = b.personel.istihdamDonemleri.find((d) => icinde(d.bitisTarihi));
        return this.hizmet(b.personel, b, iso(giris?.baslangicTarihi), iso(cikis?.bitisTarihi), cikis?.sgkCikisKodu ?? null);
      }).sort((a, b) => a.personelNo.localeCompare(b.personelNo));
      const onaysiz = bordrolar.length - onayli.length;
      const uyarilar = [
        onaysiz > 0 && `Dönemde onaylanmamış ${onaysiz} bordro var; dökümde yer almaz. Onaylayıp yeniden alın.`,
        !bordrolar.length && "Dönemde bordro yok.",
      ].filter((u): u is string => Boolean(u));
      const firma = await this.firma(tx, tenantId);
      const isyeri = f.isyeriId ? await tx.personelIsyeri.findFirst({ where: { id: f.isyeriId, tenantId }, select: { id: true, ad: true, adres: true, sgkSicilNo: true, csgbIsKolu: true } }) : null;
      if (f.isyeriId && !isyeri) throw new NotFoundException("İşyeri bulunamadı");
      return { satirlar, ozet: muhsgkOzeti(satirlar), uyarilar, firma, isyeri };
    });
  }

  async muhsgk(tenantId: string, girdi: unknown) {
    const f = muhsgkSemasi.parse(girdi);
    const { satirlar, ozet, uyarilar } = await this.muhsgkVerisi(tenantId, f);
    return { yil: f.yil, ay: f.ay, ozet, uyarilar, satirlar: satirlar.map(({ tckn, ...s }) => ({ ...s, tcknMaskeli: tcknMaskele(tckn), aphbDisi: aphbDisiNedeni({ ...s, tckn }) })) };
  }

  private xmlIsyeri(firma: { unvan: string; vkn: string | null; adres: string | null; ilce: string | null; il: string | null } | null, isyeri: { ad: string; adres: string | null; sgkSicilNo: string | null; csgbIsKolu: number | null } | null): XmlIsyeri {
    if (!isyeri) throw new BadRequestException("XML için işyeri seçin; her işyerinin SGK dosyası ayrıdır");
    const sicil = isyeriSiciliAyristir(isyeri.sgkSicilNo);
    if (!sicil) throw new BadRequestException(`${isyeri.ad} işyerinin SGK sicil numarası 26 hane olmalıdır (Organizasyon ekranından düzeltin)`);
    const firmaAdresi = [firma?.adres, firma?.ilce, firma?.il].filter(Boolean).join(" ");
    return { sicil, unvan: firma?.unvan ?? isyeri.ad, adres: isyeri.adres || firmaAdresi || isyeri.ad, isKolu: isyeri.csgbIsKolu ?? 0, vergiNo: firma?.vkn };
  }

  private async disaAktarimKaydi(tenantId: string, userId: string, amac: string, detay: Record<string, unknown>) {
    await this.prisma.tenantIslem(tenantId, (tx) => tx.auditLog.create({ data: { tenantId, userId, islem: "HASSAS_VERI_TOPLU_DISA_AKTAR", varlik: "personel", detay: { amac, ...detay } as Prisma.InputJsonValue } }));
  }

  /** PRS-25: bildirge verisi Excel / PDF / toplu XML. */
  async bildirgeDosyasi(tenantId: string, userId: string, girdi: unknown, bicim: DosyaBicimi) {
    const f = bildirgeListeSemasi.parse(girdi);
    const giris = f.tur === "giris";
    const satirlar = await this.bildirgeSatirlari(tenantId, f);
    const aralik = `${iso(f.baslangic)}_${iso(f.bitis)}`;
    const ad = giris ? "SGK İşe Giriş Bildirge Verisi" : "SGK İşten Çıkış Bildirge Verisi";
    let sonuc: { buffer: Buffer; dosyaAdi: string; mime: string; kisiSayisi: number };
    if (bicim === "xml") {
      if (!f.isyeriId) throw new BadRequestException("XML için işyeri seçin; her işyerinin SGK dosyası ayrıdır");
      const { firma, isyeri } = await this.prisma.tenantIslem(tenantId, async (tx) => ({ firma: await this.firma(tx, tenantId), isyeri: await tx.personelIsyeri.findFirst({ where: { id: f.isyeriId, tenantId } }) }));
      const xi = this.xmlIsyeri(firma, isyeri);
      const uygun = satirlar.filter((s) => !s.xmlDisi);
      if (!uygun.length) throw new BadRequestException(satirlar.length ? `XML'e girecek kişi yok: ${satirlar.map((s) => `${s.personelNo} (${s.xmlDisi})`).join("; ")}` : "Seçilen aralıkta kayıt yok");
      const xml = giris
        ? iseGirisXml(xi, uygun.map((s) => ({ tckn: s.tckn!, ad: s.ad, soyad: s.soyad, girisTarihi: s.tarih, sigortaKolu: s.sigortaKolu!, engelli: s.engelli, eskiHukumlu: s.eskiHukumlu, ogrenimKodu: s.ogrenimDurumu ?? 0, mezuniyetYili: s.mezuniyetYili, mezuniyetBolumu: s.mezuniyetBolumu, meslekKodu: s.meslekKodu! })))
        : istenCikisXml(xi, uygun.map((s) => ({ tckn: s.tckn!, ad: s.ad, soyad: s.soyad, cikisTarihi: s.tarih, meslekKodu: s.meslekKodu!, cikisKodu: s.cikisKodu!, onceki: s.onceki, bulundugumuz: s.bulundugumuz! })));
      sonuc = { buffer: Buffer.from(xml, "utf-8"), dosyaAdi: `sgk-${giris ? "ise-giris" : "isten-cikis"}-${aralik}.xml`, mime: "application/xml", kisiSayisi: uygun.length };
    } else {
      const kolonlar: RaporKolon[] = [
        { alan: "personelNo", baslik: "Personel no", tip: "metin" }, { alan: "adSoyad", baslik: "Ad soyad", tip: "metin" }, { alan: "tckn", baslik: "TCKN", tip: "metin" },
        { alan: "isyeri", baslik: "İşyeri", tip: "metin" }, { alan: "sgkSicilNo", baslik: "SGK sicil no", tip: "metin" }, { alan: "tarih", baslik: giris ? "Giriş tarihi" : "Çıkış tarihi", tip: "tarih" },
        { alan: "belgeTuru", baslik: "Belge türü", tip: "metin" }, { alan: "meslekKodu", baslik: "Meslek kodu", tip: "metin" },
        ...(giris
          ? [{ alan: "sigortaKolu", baslik: "Sigorta kolu", tip: "metin" }, { alan: "ogrenim", baslik: "Öğrenim", tip: "metin" }, { alan: "gorevKodu", baslik: "Görev kodu", tip: "metin" }] as RaporKolon[]
          : [{ alan: "cikisKodu", baslik: "Çıkış kodu", tip: "metin" }, { alan: "bGun", baslik: "Çıkış ayı eksik gün", tip: "sayi" }, { alan: "bUcret", baslik: "Çıkış ayı hak edilen", tip: "para" }, { alan: "bPrim", baslik: "Çıkış ayı prim/ikramiye", tip: "para" }, { alan: "oUcret", baslik: "Önceki ay hak edilen", tip: "para" }, { alan: "oPrim", baslik: "Önceki ay prim/ikramiye", tip: "para" }] as RaporKolon[]),
        { alan: "kanunNo", baslik: "Kanun no", tip: "metin" }, { alan: "sonTarih", baslik: "Son tarih", tip: "tarih" }, { alan: "bildirgeTarihi", baslik: "Bildirge tarihi", tip: "tarih" },
        { alan: "durumAdi", baslik: "Durum", tip: "metin" }, { alan: "eksik", baslik: "Eksik", tip: "metin" },
      ];
      const DURUM = { verildi: "Verildi", gecikti: "Gecikti", bekliyor: "Bekliyor" } as const;
      const raporSatirlari: RaporSatiri[] = satirlar.map((s) => ({
        personelNo: s.personelNo, adSoyad: s.adSoyad, tckn: s.tckn, isyeri: s.isyeri, sgkSicilNo: s.sgkSicilNo, tarih: s.tarih, belgeTuru: s.belgeTuru, meslekKodu: s.meslekKodu,
        sigortaKolu: s.sigortaKolu, ogrenim: s.ogrenimDurumu === null ? null : `${s.ogrenimDurumu} ${OGRENIM_DURUMLARI[s.ogrenimDurumu]}`, gorevKodu: s.gorevKodu,
        cikisKodu: s.cikisKodu, bGun: s.bulundugumuz?.eksikGunSayisi ?? null, bUcret: s.bulundugumuz?.hakEdilenUcret ?? null, bPrim: s.bulundugumuz?.primIkramiye ?? null, oUcret: s.onceki?.hakEdilenUcret ?? null, oPrim: s.onceki?.primIkramiye ?? null,
        kanunNo: s.kanunNo, sonTarih: s.sonTarih, bildirgeTarihi: s.bildirgeTarihi, durumAdi: DURUM[s.durum], eksik: s.eksikler.join(", "),
      }));
      const tanim = { ad, kolonlar };
      if (bicim === "xlsx") {
        const w = new ExcelJS.Workbook(); raporSayfasiEkle(w, tanim, raporSatirlari);
        sonuc = { buffer: Buffer.from(await w.xlsx.writeBuffer()), dosyaAdi: `sgk-${giris ? "ise-giris" : "isten-cikis"}-${aralik}.xlsx`, mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", kisiSayisi: satirlar.length };
      } else {
        const html = sayfaSablonu({ baslik: ad, altBaslik: `${iso(f.baslangic)} – ${iso(f.bitis)} · ön döküm`, icerik: raporTablosuHtml(tanim, raporSatirlari), tema: await this.pdf.belgeTemasi() });
        sonuc = { buffer: await this.pdf.htmlToPdf(html, { yatay: true, sayfaNumarasi: true }), dosyaAdi: `sgk-${giris ? "ise-giris" : "isten-cikis"}-${aralik}.pdf`, mime: "application/pdf", kisiSayisi: satirlar.length };
      }
    }
    await this.disaAktarimKaydi(tenantId, userId, `sgk_${f.tur}_${bicim}`, { aralik, isyeriId: f.isyeriId ?? null, kisiSayisi: sonuc.kisiSayisi });
    return sonuc;
  }

  /** PRS-26/28: MUHSGK ön dökümü (Excel iki sayfa, yatay PDF) ve APHB XML'i. */
  async muhsgkDosyasi(tenantId: string, userId: string, girdi: unknown, bicim: DosyaBicimi) {
    const f = muhsgkSemasi.parse(girdi);
    const { satirlar, ozet, uyarilar, firma, isyeri } = await this.muhsgkVerisi(tenantId, f);
    const donem = ayAnahtari(f.yil, f.ay);
    let sonuc: { buffer: Buffer; dosyaAdi: string; mime: string; kisiSayisi: number };
    if (bicim === "xml") {
      const xi = this.xmlIsyeri(firma, isyeri);
      const bildirgeler = aphbBildirgeleri(satirlar);
      if (!bildirgeler.length) throw new BadRequestException("APHB'ye girecek hizmet satırı yok (onaylı ve hesap izi olan bordro gerekir)");
      const xml = aphbXml(xi, f.yil, f.ay, bildirgeler);
      const hatalar = await aphbDogrula(xml);
      if (hatalar.length) throw new BadRequestException(`APHB dosyası şemaya uymadı: ${hatalar.slice(0, 5).join("; ")}`);
      sonuc = { buffer: Buffer.from(xml, "utf-8"), dosyaAdi: `aphb-${donem}.xml`, mime: "application/xml", kisiSayisi: bildirgeler.reduce((t, b) => t + b.sigortalilar.length, 0) };
    } else {
      const para = (alan: string, baslik: string): RaporKolon => ({ alan, baslik, tip: "para" });
      const hizmetKolonlari: RaporKolon[] = [
        { alan: "personelNo", baslik: "Personel no", tip: "metin" }, { alan: "tckn", baslik: "TCKN", tip: "metin" }, { alan: "adSoyad", baslik: "Ad soyad", tip: "metin" },
        { alan: "belgeTuru", baslik: "Belge", tip: "metin" }, { alan: "kanunNo", baslik: "Kanun", tip: "metin" }, { alan: "primGunu", baslik: "Gün", tip: "sayi" },
        { alan: "eksikGunSayisi", baslik: "Eksik gün", tip: "sayi" }, { alan: "eksikGunKodu", baslik: "Eksik neden", tip: "metin" },
        { alan: "girisTarihi", baslik: "Giriş", tip: "tarih" }, { alan: "cikisTarihi", baslik: "Çıkış", tip: "tarih" }, { alan: "cikisKodu", baslik: "Çıkış kodu", tip: "metin" },
        para("hakEdilenUcret", "Hak edilen ücret"), para("primIkramiye", "Prim/ikramiye"), para("pek", "PEK"), para("gvMatrahi", "GV matrahı"), para("hesaplananGv", "Hesaplanan GV"),
        para("asgariGvIstisnasi", "AÜ GV istisnası"), para("kesilenGv", "Kesilen GV"), para("hesaplananDv", "Hesaplanan DV"), para("dvIstisnasi", "DV istisnası"), para("kesilenDv", "Kesilen DV"),
        { alan: "meslekKodu", baslik: "Meslek kodu", tip: "metin" }, { alan: "uyari", baslik: "Uyarı", tip: "metin" },
      ];
      const hizmet: RaporSatiri[] = satirlar.map((s) => ({ ...Object.fromEntries(hizmetKolonlari.map((k) => [k.alan, (s as unknown as Record<string, string | number | null>)[k.alan] ?? null])), uyari: s.uyarilar.join("; ") }));
      const ozetKolonlari: RaporKolon[] = [{ alan: "kalem", baslik: "Kalem", tip: "metin" }, { alan: "tutar", baslik: "Tutar", tip: "para" }];
      const ozetSatirlari: RaporSatiri[] = [
        ["Hizmet satırı (hesap izi olan)", ozet.kisiSayisi], ["Toplam prim günü", ozet.primGunu], ["Gayrisafi ücret ödemeleri", ozet.gayrisafi], ["GV matrahı", ozet.gvMatrahi],
        ["Hesaplanan GV", ozet.hesaplananGv], ["Asgari ücret GV istisnası", ozet.asgariGvIstisnasi], ["Muhtasar: kesilen GV", ozet.kesilenGv],
        ["Hesaplanan DV", ozet.hesaplananDv], ["DV istisnası", ozet.dvIstisnasi], ["Muhtasar: kesilen DV", ozet.kesilenDv],
        ["PEK toplamı", ozet.pek], ["SGK işçi payı", ozet.sgkIsci], ["İşsizlik işçi payı", ozet.issizlikIsci], ["SGK işveren payı (teşvik öncesi)", ozet.isverenSgk],
        ["Teşvik indirimi", ozet.tesvikIndirimi], ["SGK işveren payı (teşvik sonrası)", ozet.isverenSgkNet], ["İşsizlik işveren payı", ozet.isverenIssizlik],
      ].map(([kalem, tutar]) => ({ kalem, tutar }));
      if (bicim === "xlsx") {
        const w = new ExcelJS.Workbook();
        raporSayfasiEkle(w, { ad: `MUHSGK Hizmet Listesi ${donem}`, kolonlar: hizmetKolonlari }, hizmet);
        raporSayfasiEkle(w, { ad: `MUHSGK Özet ${donem}`, kolonlar: ozetKolonlari }, [...ozetSatirlari, ...uyarilar.map((u) => ({ kalem: `Uyarı: ${u}`, tutar: null }))]);
        sonuc = { buffer: Buffer.from(await w.xlsx.writeBuffer()), dosyaAdi: `muhsgk-on-dokum-${donem}.xlsx`, mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", kisiSayisi: satirlar.length };
      } else {
        const ozetTanimi = { kolonlar: ozetKolonlari.map((k) => (k.alan === "tutar" ? { ...k, tip: "sayi" as const } : k)) };
        const icerik = `${uyarilar.map((u) => `<p class="alt-baslik">${kacis(u)}</p>`).join("")}${raporTablosuHtml({ kolonlar: hizmetKolonlari }, hizmet)}<h2>Özet</h2>${raporTablosuHtml(ozetTanimi, ozetSatirlari)}`;
        const html = sayfaSablonu({ baslik: "MUHSGK Ön Dökümü", altBaslik: `${donem}${isyeri ? ` · ${isyeri.ad}` : ""} · onaylı bordrolar · ${firma?.unvan ?? ""}`, icerik, tema: await this.pdf.belgeTemasi() });
        sonuc = { buffer: await this.pdf.htmlToPdf(html, { yatay: true, sayfaNumarasi: true }), dosyaAdi: `muhsgk-on-dokum-${donem}.pdf`, mime: "application/pdf", kisiSayisi: satirlar.length };
      }
    }
    await this.disaAktarimKaydi(tenantId, userId, `muhsgk_${bicim}`, { donem, isyeriId: f.isyeriId ?? null, kisiSayisi: sonuc.kisiSayisi });
    return sonuc;
  }
}
