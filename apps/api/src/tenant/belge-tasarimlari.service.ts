import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type { Baglanti } from "@prisma/client";
import type { BelgeTasarimi, EntegratorAdapter, EntegratorConfig, TasarimTuru } from "@tekirextra/baglanti";
import { XMLValidator } from "fast-xml-parser";
import { z } from "zod";
import { coz, sifrele } from "../core/kripto";
import { aktifBaglam } from "../core/istek-baglami";
import { PrismaService } from "../core/prisma.service";
import { BaglantilarService } from "./baglantilar.service";

export const TASARIM_TURLERI = ["efatura", "earsiv", "eirsaliye"] as const satisfies readonly TasarimTuru[];

/** Config'te türün tasarım başlığını tutan alan. */
export const TASARIM_ALANI = { efatura: "efaturaTasarimi", earsiv: "earsivTasarimi", eirsaliye: "eirsaliyeTasarimi" } as const satisfies Record<TasarimTuru, keyof EntegratorConfig>;

const TUR_ADI: Record<TasarimTuru, string> = { efatura: "e-Fatura", earsiv: "e-Arşiv", eirsaliye: "e-İrsaliye" };

/**
 * Ad karşılaştırması büyük/küçük harf ve I/İ farkını gözetmez: Türkçe
 * küçültmede "TEKIR" → "tekır" olur ve "tekir" ile eşleşmezdi.
 */
const adAnahtari = (ad: string) => ad.toLocaleLowerCase("tr").replace(/ı/g, "i");

/** NES'e yüklenen XSLT'ler 300 KB'ı buluyor (logo + karekod gömülü); sınır bunun üstünde. */
const AZAMI_XSLT_BOYU = 1_500_000;

export const tasarimYukleSemasi = z.object({
  tur: z.enum(TASARIM_TURLERI),
  baslik: z.string().trim().min(3, "Tasarım adı en az 3 karakter olmalıdır").max(60, "Tasarım adı en çok 60 karakter olabilir"),
  xslt: z.string().min(1, "XSLT dosyası boş").max(AZAMI_XSLT_BOYU, "XSLT dosyası 1,5 MB'tan büyük olamaz"),
});

export const tasarimOnizleSemasi = z.object({ tur: z.enum(TASARIM_TURLERI), tasarimId: z.string().uuid() });

/** Boş metin "entegratörün varsayılanı" demektir. */
export const tasarimSecimSemasi = z.object({
  efatura: z.string().trim().max(60).optional(),
  earsiv: z.string().trim().max(60).optional(),
  eirsaliye: z.string().trim().max(60).optional(),
});

/**
 * Yüklemeden önce dosyanın XSLT olduğu denetlenir; bozuk dosya entegratörde
 * yüklenir ama belge açılırken boş sayfa verir, hata orada fark edilmez.
 */
export function xsltDenetle(xslt: string): string | null {
  const sonuc = XMLValidator.validate(xslt.replace(/^﻿/, ""));
  if (sonuc !== true) return `Dosya geçerli bir XML değil (satır ${sonuc.err.line}: ${sonuc.err.msg})`;
  const kok = /<([A-Za-z_][\w.-]*:)?(stylesheet|transform)\b/.exec(xslt.replace(/<\?[\s\S]*?\?>|<!--[\s\S]*?-->/g, ""));
  if (!kok || !/xmlns(:\w+)?\s*=\s*["']http:\/\/www\.w3\.org\/1999\/XSL\/Transform["']/.test(xslt)) {
    return "Dosya bir XSLT değil; kök öğe xsl:stylesheet olmalıdır";
  }
  return null;
}

/**
 * Entegratör belge tasarımları (EBLG-99). Tasarım entegratörde durur ve alıcının
 * gördüğü görünüm odur (EBLG-31 kararı: görünümü biz gömmeyiz). Buradan
 * listelenir, yüklenir, önizlenir ve belge türü başına hangisinin kullanılacağı
 * seçilir; seçim her gönderimde belgeyle birlikte istenir. NES'te "varsayılan
 * yap" ve silme bilerek yok: ortak test hesabında başka firmaları etkiler ve
 * liste tasarımı kimin yüklediğini söylemez.
 */
@Injectable()
export class BelgeTasarimlariService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly baglantilar: BaglantilarService,
  ) {}

  async listele(id: string, tur: TasarimTuru): Promise<{ destekleniyor: boolean; secili: string | null; tasarimlar: BelgeTasarimi[] }> {
    const { kayit, cfg, adapter } = await this.hazirla(id);
    const secili = cfg[TASARIM_ALANI[tur]] || null;
    if (!adapter.tasarimlariListele) return { destekleniyor: false, secili, tasarimlar: [] };
    const tasarimlar = await this.entegrator(() => adapter.tasarimlariListele!(cfg, tur), kayit);
    return { destekleniyor: true, secili, tasarimlar };
  }

  async yukle(id: string, girdi: z.infer<typeof tasarimYukleSemasi>): Promise<BelgeTasarimi> {
    const { kayit, cfg, adapter } = await this.hazirla(id);
    if (!adapter.tasarimYukle || !adapter.tasarimlariListele) throw new BadRequestException("Bu entegratör tasarım yüklemeyi desteklemiyor");
    const hata = xsltDenetle(girdi.xslt);
    if (hata) throw new BadRequestException(hata);
    // Tasarım gönderimde adıyla istenir; aynı adda ikinci tasarım hangisinin
    // basılacağını belirsiz bırakırdı.
    const mevcut = await this.entegrator(() => adapter.tasarimlariListele!(cfg, girdi.tur), kayit);
    if (mevcut.some((t) => adAnahtari(t.baslik) === adAnahtari(girdi.baslik))) {
      throw new BadRequestException(`Entegratörde "${girdi.baslik}" adlı bir ${TUR_ADI[girdi.tur]} tasarımı zaten var; başka bir ad verin`);
    }
    return this.entegrator(() => adapter.tasarimYukle!(cfg, girdi.tur, { baslik: girdi.baslik, xslt: girdi.xslt }), kayit);
  }

  /**
   * Tasarımı firmanın bu türde en son gönderdiği belgeyle çizer. Örnek belge
   * uydurulmaz: tasarımın firmanın gerçek verisiyle nasıl göründüğü önemlidir.
   */
  async onizle(id: string, girdi: z.infer<typeof tasarimOnizleSemasi>): Promise<{ html: string; belgeNo: string }> {
    const { kayit, cfg, adapter } = await this.hazirla(id);
    if (!adapter.tasarimOnizle) throw new BadRequestException("Bu entegratör tasarım önizlemeyi desteklemiyor");
    const ornek = await this.ornekBelge(kayit.tenantId, girdi.tur);
    if (!ornek) throw new BadRequestException(`Önizleme için gönderilmiş bir ${TUR_ADI[girdi.tur]} belgesi gerekir; bu türde henüz belge yok`);
    const sonuc = await adapter.tasarimOnizle(cfg, girdi.tur, girdi.tasarimId, ornek.xml);
    if (!sonuc.basarili || !sonuc.html) throw new BadRequestException(sonuc.hataMesaji ?? "Tasarım önizlenemedi");
    return { html: sonuc.html, belgeNo: ornek.belgeNo };
  }

  /**
   * Seçim bağlantı config'ine yazılır. Bağlantı düzenlemesinin aksine durumu
   * pasife çekmez: tasarım kimlik ya da seri değildir, gönderimi bozmaz.
   */
  async sec(id: string, secim: z.infer<typeof tasarimSecimSemasi>): Promise<Record<TasarimTuru, string | null>> {
    const { kayit, cfg, adapter } = await this.hazirla(id);
    const yeni: EntegratorConfig = { ...cfg };
    for (const tur of TASARIM_TURLERI) {
      const deger = secim[tur];
      if (deger === undefined) continue;
      if (!deger) {
        delete yeni[TASARIM_ALANI[tur]];
        continue;
      }
      if (!adapter.tasarimlariListele) throw new BadRequestException("Bu entegratör tasarım seçimini desteklemiyor");
      const tanimlar = await this.entegrator(() => adapter.tasarimlariListele!(cfg, tur), kayit);
      if (!tanimlar.some((t) => t.baslik === deger)) {
        throw new BadRequestException(`"${deger}" adlı ${TUR_ADI[tur]} tasarımı entegratörde bulunamadı`);
      }
      yeni[TASARIM_ALANI[tur]] = deger;
    }
    const { tenantId } = aktifBaglam();
    await this.prisma.tenantIslem(tenantId, (tx) => tx.baglanti.update({ where: { id }, data: { sifreliConfig: sifrele(JSON.stringify(yeni)) } }));
    return Object.fromEntries(TASARIM_TURLERI.map((tur) => [tur, yeni[TASARIM_ALANI[tur]] || null])) as Record<TasarimTuru, string | null>;
  }

  private async hazirla(id: string): Promise<{ kayit: Baglanti; cfg: EntegratorConfig; adapter: EntegratorAdapter }> {
    const { tenantId } = aktifBaglam();
    const kayit = await this.prisma.tenantIslem(tenantId, (tx) => tx.baglanti.findUnique({ where: { id } }));
    if (!kayit) throw new NotFoundException("Bağlantı bulunamadı");
    if (kayit.aile !== "ebelge") throw new BadRequestException("Belge tasarımı yalnız e-Belge bağlantısında yönetilir");
    const cfg = JSON.parse(coz(kayit.sifreliConfig)) as EntegratorConfig;
    return { kayit, cfg, adapter: this.baglantilar.adapterCoz(kayit.saglayici) };
  }

  /** Entegratör hatası kullanıcıya 400 olarak, sebebiyle döner. */
  private async entegrator<T>(cagri: () => Promise<T>, kayit: Baglanti): Promise<T> {
    try {
      return await cagri();
    } catch (hata) {
      throw new BadRequestException(`${kayit.saglayici.toUpperCase()}: ${hata instanceof Error ? hata.message : String(hata)}`);
    }
  }

  private async ornekBelge(tenantId: string, tur: TasarimTuru): Promise<{ xml: string; belgeNo: string } | null> {
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      if (tur === "eirsaliye") {
        const k = await tx.eirsaliyeKayit.findFirst({
          where: { entegratorRef: { not: null } },
          orderBy: { createdAt: "desc" },
          select: { xmlIcerik: true, belge: { select: { no: true } } },
        });
        return k?.xmlIcerik ? { xml: k.xmlIcerik, belgeNo: k.belge?.no ?? "" } : null;
      }
      const a = await tx.ebelgeArsiv.findFirst({
        where: { ebelge: { tur } },
        orderBy: { createdAt: "desc" },
        select: { xmlIcerik: true, ebelge: { select: { fatura: { select: { no: true } } } } },
      });
      return a ? { xml: a.xmlIcerik, belgeNo: a.ebelge.fatura?.no ?? "" } : null;
    });
  }
}
