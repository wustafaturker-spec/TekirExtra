import { Injectable } from "@nestjs/common";
import { aktifBaglam } from "../core/istek-baglami";
import { PrismaService } from "../core/prisma.service";
import { yururluktedir } from "./yayin-plani";

export interface MevzuatDegeri {
  anahtar: string;
  deger: unknown;
  yururlukBaslangic: string;
  yururlukBitis: string | null;
}

const gun = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
/** API ve worker ayrı süreçlerdir; yayın diğer sürece en geç bu sürede ulaşır. */
const ONBELLEK_SURESI_MS = 60_000;

/**
 * Kiracı tarafının Mevzuat Merkezi okuyucusu (MVZ-01/02/07/09). Uygulama
 * bağlantısı bu tablolarda yalnız okuma ve talep ekleme yetkisine sahiptir;
 * tablolar kiracıya ait olmadığı için kiracı işlemi (RLS bağlamı) gerekmez.
 */
@Injectable()
export class MevzuatService {
  private onbellek = new Map<string, { zaman: number; kayitlar: MevzuatDegeri[] }>();

  constructor(private readonly prisma: PrismaService) {}

  /** Bir türün tüm kayıtları (geçmiş dahil), kısa süreli önbellekten. */
  private async turKayitlari(tur: string): Promise<MevzuatDegeri[]> {
    const onceki = this.onbellek.get(tur);
    if (onceki && Date.now() - onceki.zaman < ONBELLEK_SURESI_MS) return onceki.kayitlar;
    const kayitlar = (await this.prisma.mevzuatKayit.findMany({ where: { tur }, orderBy: [{ anahtar: "asc" }, { yururlukBaslangic: "asc" }] }))
      .map((k) => ({ anahtar: k.anahtar, deger: k.deger, yururlukBaslangic: gun(k.yururlukBaslangic)!, yururlukBitis: gun(k.yururlukBitis) }));
    this.onbellek.set(tur, { zaman: Date.now(), kayitlar });
    return kayitlar;
  }

  /** Yayından sonra aynı süreçte eski değer okunmasın (diğer süreçler TTL ile tazelenir). */
  onbellekTemizle(): void {
    this.onbellek.clear();
  }

  /** MVZ-02: belge tarihinde yürürlükte olan değerler. */
  async yururluktekiler(tur: string, tarih: string): Promise<MevzuatDegeri[]> {
    return (await this.turKayitlari(tur)).filter((k) => yururluktedir(k, tarih));
  }

  /** Ayarlar > Mevzuat: bir türün geçmiş dahil bütün kayıtları. */
  async tumKayitlar(tur: string): Promise<MevzuatDegeri[]> {
    return this.turKayitlari(tur);
  }

  /** MVZ-07: yayınlanan değişiklikler (en yeni önce). */
  async yayinlananlar() {
    const liste = await this.prisma.mevzuatDegisiklik.findMany({
      where: { durum: "yayinlandi" },
      orderBy: { yayinZamani: "desc" },
      take: 100,
      select: { id: true, no: true, baslik: true, dayanak: true, aciklama: true, yururlukBaslangic: true, yayinZamani: true, satirlar: { orderBy: { sira: "asc" }, select: { tur: true, anahtar: true, islem: true, deger: true } } },
    });
    return liste.map((d) => ({ ...d, yururlukBaslangic: gun(d.yururlukBaslangic) }));
  }

  /**
   * MVZ-10: gelen belgede görülen bilinmeyen kod/oran. Aynı kod için açık bir
   * talep varsa yalnız görülme sayısı artar. Kiracı bilgisi yazılmaz; uygulama
   * rolü bu tabloda yalnız eşleşme sütunlarını okuyup sayacı artırabilir.
   */
  async bilinmeyenBildir(girdi: { tur: string; anahtar: string; aciklama: string }): Promise<void> {
    await this.prisma.$executeRaw`
      INSERT INTO mevzuat_talepleri (id, kaynak, tur, anahtar, aciklama, updated_at)
      VALUES (gen_random_uuid(), 'bilinmeyen_kod', ${girdi.tur}, ${girdi.anahtar}, ${girdi.aciklama}, now())
      ON CONFLICT (tur, anahtar) WHERE kaynak = 'bilinmeyen_kod' AND durum = 'acik'
      DO UPDATE SET gorulme_sayisi = mevzuat_talepleri.gorulme_sayisi + 1, updated_at = now()`;
  }

  /**
   * MVZ-09: kiracının "eksik / hatalı bildir" kaydı. Uygulama rolünün bu
   * tabloda yalnız ekleme yetkisi var (okuyamaz); bu yüzden RETURNING'siz
   * ham INSERT kullanılır.
   */
  async talepAc(girdi: { tur?: string | null; anahtar?: string | null; aciklama: string }): Promise<void> {
    const { tenantId } = aktifBaglam();
    await this.prisma.$executeRaw`
      INSERT INTO mevzuat_talepleri (id, kaynak, tenant_id, tur, anahtar, aciklama, updated_at)
      VALUES (gen_random_uuid(), 'kiraci_bildirimi', ${tenantId}::uuid, ${girdi.tur ?? null}, ${girdi.anahtar ?? null}, ${girdi.aciklama}, now())`;
  }
}
