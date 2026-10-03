import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  AKTARIM_ALANLARI,
  HAZIR_AKTARIM_PROFILLERI,
  MUHASEBE_HESAPLARI,
  MUHASEBE_HESAP_ANAHTARLARI,
  MUHASEBE_KODU_DESENI,
  type AktarimProfili,
  type MuhasebeHesapAnahtari,
} from "@tekirextra/shared";
import { z } from "zod";
import { aktifBaglam } from "../../core/istek-baglami";
import { PdfService } from "../../core/pdf/pdf.service";
import { PrismaService } from "../../core/prisma.service";
import { csvDosyasi, duzSatirlar, excelDosyasi, parmakIzi, yevmiyeHtml } from "./aktarim-dosyasi";
import { fisleriUret, HesapCozucu } from "./fis-uretici";
import { uretimGirdisiOku } from "./fis-okuyucu";

const EN_UZUN_DONEM_GUN = 370;
const GUN_MS = 86_400_000;

export const aktarimProfiliSemasi = z.object({
  ad: z.string().trim().min(1).max(60),
  bicim: z.enum(["xlsx", "csv"]),
  sutunlar: z.array(z.object({ alan: z.enum(Object.keys(AKTARIM_ALANLARI) as [keyof typeof AKTARIM_ALANLARI, ...(keyof typeof AKTARIM_ALANLARI)[]]), baslik: z.string().trim().min(1).max(60) })).min(1).max(30),
  tarihBicimi: z.enum(["GG.AA.YYYY", "YYYY-AA-GG"]),
  ondalik: z.enum([",", "."]),
  csvAyirici: z.enum([";", ",", "\t"]),
});

const kodSemasi = z.string().trim().regex(MUHASEBE_KODU_DESENI, "Hesap kodu rakamla başlamalı; nokta ve tireyle alt hesaba inebilir (en çok 40 karakter)");

export const hesapKodlariSemasi = z.record(z.string(), z.string().trim().max(40)).superRefine((kayit, ctx) => {
  for (const [anahtar, kod] of Object.entries(kayit)) {
    if (!(MUHASEBE_HESAP_ANAHTARLARI as string[]).includes(anahtar)) ctx.addIssue({ code: "custom", message: `Bilinmeyen hesap: ${anahtar}` });
    else if (kod && !MUHASEBE_KODU_DESENI.test(kod)) ctx.addIssue({ code: "custom", message: `${MUHASEBE_HESAPLARI[anahtar as MuhasebeHesapAnahtari].ad}: geçersiz hesap kodu` });
  }
});

export const altHesaplarSemasi = z.array(z.object({
  tur: z.enum(["cari", "kasa", "banka", "pos", "kart", "kredi"]),
  id: z.uuid(),
  muhasebeKodu: kodSemasi.nullable(),
})).min(1).max(1000);

/**
 * MUH-01…07: muhasebe aktarımı. Fişler her istekte kaynak kayıtlardan
 * üretilir; yalnız aktarımın kendisi (dönem, sayı, parmak izi) saklanır.
 */
@Injectable()
export class MuhasebeAktarimService {
  constructor(private readonly prisma: PrismaService, private readonly pdf: PdfService) {}

  private donemDogrula(baslangic: string, bitis: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(baslangic) || !/^\d{4}-\d{2}-\d{2}$/.test(bitis)) throw new BadRequestException("Dönem YYYY-AA-GG biçiminde verilmelidir");
    const gun = (Date.parse(bitis) - Date.parse(baslangic)) / GUN_MS;
    if (gun < 0) throw new BadRequestException("Başlangıç bitişten sonra olamaz");
    if (gun > EN_UZUN_DONEM_GUN) throw new BadRequestException(`Tek seferde en çok ${EN_UZUN_DONEM_GUN} günlük dönem aktarılır`);
  }

  private async uret(baslangic: string, bitis: string) {
    const { tenantId } = aktifBaglam();
    const girdi = await this.prisma.tenantIslem(tenantId, (tx) => uretimGirdisiOku(tx, tenantId, baslangic, bitis), { timeout: 60_000 });
    return fisleriUret(girdi);
  }

  async onizleme(baslangic: string, bitis: string) {
    this.donemDogrula(baslangic, bitis);
    const { fisler, kontroller } = await this.uret(baslangic, bitis);
    const borc = fisler.reduce((t, f) => f.satirlar.reduce((u, s) => u.add(s.borc), t), new Prisma.Decimal(0));
    const alacak = fisler.reduce((t, f) => f.satirlar.reduce((u, s) => u.add(s.alacak), t), new Prisma.Decimal(0));
    return {
      baslangic,
      bitis,
      ozet: { fisSayisi: fisler.length, satirSayisi: fisler.reduce((t, f) => t + f.satirlar.length, 0), borc: borc.toFixed(2), alacak: alacak.toFixed(2) },
      kontroller,
      fisler: fisler.map((f, i) => ({
        no: i + 1,
        tarih: f.tarih,
        tur: f.tur,
        aciklama: f.aciklama,
        belgeNo: f.belgeNo,
        kaynak: f.kaynak,
        satirlar: f.satirlar.map((s) => ({
          hesapKodu: s.hesapKodu,
          aciklama: s.aciklama,
          borc: s.borc.toFixed(2),
          alacak: s.alacak.toFixed(2),
          doviz: s.doviz ? { cins: s.doviz.cins, tutar: s.doviz.tutar.toFixed(2), kur: s.doviz.kur.toFixed(6) } : null,
        })),
      })),
    };
  }

  /** MUH-06/07: dosyayı üretir ve aktarımı kaydeder. */
  async disaAktar(baslangic: string, bitis: string, bicim: "xlsx" | "csv" | "pdf") {
    this.donemDogrula(baslangic, bitis);
    const { tenantId, userId } = aktifBaglam();
    const [{ fisler }, profil] = await Promise.all([this.uret(baslangic, bitis), this.profilOku()]);
    const satirlar = duzSatirlar(fisler);
    let buffer: Buffer;
    if (bicim === "pdf") {
      const firma = await this.prisma.tenantIslem(tenantId, (tx) => tx.tenant.findUnique({ where: { id: tenantId }, select: { unvan: true, vkn: true } }));
      if (!firma) throw new NotFoundException("Firma bulunamadı");
      buffer = await this.pdf.htmlToPdf(yevmiyeHtml(fisler, firma, baslangic, bitis), { yatay: true, sayfaNumarasi: true });
    } else {
      const p = { ...profil, bicim };
      buffer = bicim === "xlsx" ? await excelDosyasi(satirlar, p) : csvDosyasi(satirlar, p);
    }
    const borcToplami = satirlar.reduce((t, s) => t + s.borc, 0);
    await this.prisma.tenantIslem(tenantId, (tx) => tx.muhasebeAktarimi.create({
      data: {
        tenantId, baslangic: new Date(`${baslangic}T00:00:00.000Z`), bitis: new Date(`${bitis}T00:00:00.000Z`), bicim,
        fisSayisi: fisler.length, satirSayisi: satirlar.length, borcToplami: new Prisma.Decimal(borcToplami.toFixed(2)), parmakIzi: parmakIzi(fisler), userId,
      },
    }));
    const tur = { xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", csv: "text/csv; charset=utf-8", pdf: "application/pdf" }[bicim];
    return { buffer, tur, dosyaAdi: `muhasebe-fisleri-${baslangic}-${bitis}.${bicim}` };
  }

  /**
   * MUH-07: son aktarımlar. En yeni beş farklı dönem yeniden üretilip parmak
   * iziyle karşılaştırılır; daha eskiler için "denetlenmedi" döner.
   */
  async aktarimlar() {
    const { tenantId } = aktifBaglam();
    const kayitlar = await this.prisma.tenantIslem(tenantId, (tx) => tx.muhasebeAktarimi.findMany({ orderBy: { createdAt: "desc" }, take: 30 }));
    const kullanicilar = await this.prisma.tenantIslem(tenantId, (tx) => tx.user.findMany({ where: { id: { in: kayitlar.map((k) => k.userId).filter((x): x is string => Boolean(x)) } }, select: { id: true, adSoyad: true } }));
    const gun = (t: Date) => t.toISOString().slice(0, 10);
    const guncelIz = new Map<string, string>();
    for (const k of kayitlar) {
      const anahtar = `${gun(k.baslangic)}|${gun(k.bitis)}`;
      if (guncelIz.has(anahtar) || guncelIz.size >= 5) continue;
      guncelIz.set(anahtar, parmakIzi((await this.uret(gun(k.baslangic), gun(k.bitis))).fisler));
    }
    return kayitlar.map((k) => {
      const iz = guncelIz.get(`${gun(k.baslangic)}|${gun(k.bitis)}`);
      return {
        id: k.id, baslangic: gun(k.baslangic), bitis: gun(k.bitis), bicim: k.bicim, fisSayisi: k.fisSayisi, satirSayisi: k.satirSayisi,
        borcToplami: k.borcToplami.toFixed(2), zaman: k.createdAt.toISOString(), kullanici: kullanicilar.find((u) => u.id === k.userId)?.adSoyad ?? null,
        degisti: iz === undefined ? null : iz !== k.parmakIzi,
      };
    });
  }

  // ─── Ayarlar ─────────────────────────────────────────────────────────────

  private async profilOku(): Promise<AktarimProfili> {
    const { tenantId } = aktifBaglam();
    const ayar = await this.prisma.tenantIslem(tenantId, (tx) => tx.muhasebeAyari.findUnique({ where: { tenantId } }));
    const kayitli = aktarimProfiliSemasi.safeParse(ayar?.aktarimProfili);
    return kayitli.success ? kayitli.data : HAZIR_AKTARIM_PROFILLERI.genel;
  }

  async ayarlar() {
    const { tenantId } = aktifBaglam();
    const ayar = await this.prisma.tenantIslem(tenantId, (tx) => tx.muhasebeAyari.findUnique({ where: { tenantId } }));
    const kodlar = (ayar?.hesapKodlari ?? {}) as Partial<Record<MuhasebeHesapAnahtari, string>>;
    return {
      hesaplar: MUHASEBE_HESAP_ANAHTARLARI.map((anahtar) => ({ anahtar, ad: MUHASEBE_HESAPLARI[anahtar].ad, varsayilan: MUHASEBE_HESAPLARI[anahtar].kod, kod: kodlar[anahtar] ?? null })),
      profil: await this.profilOku(),
      hazirProfiller: HAZIR_AKTARIM_PROFILLERI,
    };
  }

  async hesapKodlariKaydet(kodlar: Record<string, string>) {
    const { tenantId } = aktifBaglam();
    // Boş bırakılan anahtar varsayılana döner.
    const temiz = Object.fromEntries(Object.entries(kodlar).filter(([, kod]) => kod.trim()).map(([a, kod]) => [a, kod.trim()]));
    await this.prisma.tenantIslem(tenantId, (tx) => tx.muhasebeAyari.upsert({ where: { tenantId }, create: { tenantId, hesapKodlari: temiz }, update: { hesapKodlari: temiz } }));
    return this.ayarlar();
  }

  async profilKaydet(profil: AktarimProfili) {
    const { tenantId } = aktifBaglam();
    const veri = profil as unknown as Prisma.InputJsonValue;
    await this.prisma.tenantIslem(tenantId, (tx) => tx.muhasebeAyari.upsert({ where: { tenantId }, create: { tenantId, aktarimProfili: veri }, update: { aktarimProfili: veri } }));
    return this.ayarlar();
  }

  /** MUH-03: alt hesaplar; boşsa üretilecek varsayılan kod da döner. */
  async altHesaplar() {
    const { tenantId } = aktifBaglam();
    const girdi = await this.prisma.tenantIslem(tenantId, (tx) => uretimGirdisiOku(tx, tenantId, "1900-01-01", "1900-01-01"));
    const bos = new HesapCozucu({ ...girdi, cariler: new Map([...girdi.cariler].map(([id, c]) => [id, { ...c, muhasebeKodu: null }])), hesaplar: new Map([...girdi.hesaplar].map(([k, h]) => [k, { ...h, muhasebeKodu: null }])) });
    const cariler = [...girdi.cariler.values()].sort((a, b) => a.kod.localeCompare(b.kod, "tr")).map((c) => ({
      tur: "cari" as const, id: c.id, kod: c.kod, ad: c.unvan, tip: c.tip, muhasebeKodu: c.muhasebeKodu,
      varsayilan: bos.cari(c.id, c.tip === "tedarikci" ? "satici" : "alici"),
    }));
    const hesaplar = [...girdi.hesaplar.values()].map((h) => ({ tur: h.tur, id: h.id, kod: null, ad: h.ad, tip: h.dovizCinsi, muhasebeKodu: h.muhasebeKodu, varsayilan: bos.hesap(h.tur, h.id) }));
    return { hesaplar, cariler };
  }

  async altHesaplariKaydet(kayitlar: z.infer<typeof altHesaplarSemasi>) {
    const { tenantId } = aktifBaglam();
    await this.prisma.tenantIslem(tenantId, async (tx) => {
      for (const k of kayitlar) {
        const veri = { muhasebeKodu: k.muhasebeKodu };
        const sonuc =
          k.tur === "cari" ? await tx.cariHesap.updateMany({ where: { id: k.id }, data: veri })
          : k.tur === "kasa" ? await tx.kasa.updateMany({ where: { id: k.id }, data: veri })
          : k.tur === "banka" ? await tx.bankaHesap.updateMany({ where: { id: k.id }, data: veri })
          : k.tur === "pos" ? await tx.posHesap.updateMany({ where: { id: k.id }, data: veri })
          : k.tur === "kredi" ? await tx.bankaKredisi.updateMany({ where: { id: k.id }, data: veri })
          : await tx.krediKarti.updateMany({ where: { id: k.id }, data: veri });
        if (sonuc.count !== 1) throw new NotFoundException("Alt hesabı değiştirilecek kayıt bulunamadı");
      }
    });
    return this.altHesaplar();
  }
}
