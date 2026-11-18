import { Injectable, Logger, Optional } from "@nestjs/common";
import type { Rol } from "@tekirextra/shared";
import { baglamAl } from "../../core/istek-baglami";
import { PrismaService } from "../../core/prisma.service";
import { AiOnayService, type OnayTalebiGorunumu } from "../onay/ai-onay.service";
import { AJAN_ARACLARI, aracBul, type AjanAraci } from "./araclar";
import { icerikOzeti, type OnayOnizlemesi } from "./araclar/arac";
import { UcCagirici } from "./uc-cagirici";

const ARAC_CIKTISI_SINIRI = 12_000;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

class KimlikBelirsizHatasi extends Error {
  readonly secim: { tur: string; aranan: string; adaylar: Array<Record<string, unknown>> };
  constructor(tur: string, aranan: string, adaylar: Array<Record<string, unknown>>) {
    super(JSON.stringify({ hata: "belirsiz_kimlik", tur, aranan, adaylar, not: "Hiçbir işlem yapılmadı. Kullanıcıdan adaylardan birini seçmesini iste." }));
    this.secim = { tur, aranan, adaylar };
  }
}

export interface AracSonucu {
  icerik: string;
  hata?: boolean;
  talep?: OnayTalebiGorunumu;
  secim?: { tur: string; aranan: string; adaylar: Array<Record<string, unknown>> };
  dosya?: { tampon: Buffer; dosyaAdi: string; mimeType: string; aciklama?: string };
}

export function hataMetni(hata: unknown): string {
  if (hata && typeof hata === "object" && "getResponse" in hata && typeof (hata as { getResponse: unknown }).getResponse === "function") {
    const yanit = (hata as { getResponse: () => unknown }).getResponse();
    if (typeof yanit === "string") return yanit;
    const mesaj = (yanit as { message?: unknown })?.message;
    if (Array.isArray(mesaj)) return mesaj.join("; ");
    if (typeof mesaj === "string") return mesaj;
  }
  return hata instanceof Error ? hata.message : "Araç çalışırken hata oluştu";
}

function jsonKisalt(deger: unknown): string {
  const metin = JSON.stringify(deger ?? null);
  return metin.length > ARAC_CIKTISI_SINIRI ? `${metin.slice(0, ARAC_CIKTISI_SINIRI)}… (kısaltıldı)` : metin;
}

function varsayilanOnizleme(arac: AjanAraci, ozet: string, girdi: unknown): OnayOnizlemesi {
  const nesne = girdi && typeof girdi === "object" && !Array.isArray(girdi) ? girdi as Record<string, unknown> : {};
  const degisiklikKaynak = nesne.degisiklikler && typeof nesne.degisiklikler === "object" && !Array.isArray(nesne.degisiklikler)
    ? nesne.degisiklikler as Record<string, unknown>
    : nesne;
  const degisiklikler = Object.entries(degisiklikKaynak)
    .filter(([alan, deger]) => deger !== undefined && !alan.toLowerCase().endsWith("id"))
    .slice(0, 20)
    .map(([alan, sonra]) => ({ alan, sonra }));
  return { eylem: arac.ad, hedef: ozet, ...(degisiklikler.length ? { degisiklikler } : {}) };
}

/**
 * Asistan (AI-05) ve MCP (AI-09) için ortak araç yürütme: yetki süzgeci,
 * girdi doğrulaması, okuma/taslak araçlarını çalıştırma, onaya tabi araçta
 * yalnız talep açma. Kimlik ve rol aktif istek bağlamından gelir.
 */
@Injectable()
export class AracYurutucu {
  private readonly logger = new Logger(AracYurutucu.name);

  constructor(
    private readonly uc: UcCagirici,
    private readonly onay: AiOnayService,
    @Optional() private readonly prisma?: PrismaService,
  ) {}

  /** Rolün ekranda girebildiği uçların araçları (AI-02). */
  izinliAraclar(rol: Rol): AjanAraci[] {
    return AJAN_ARACLARI.filter((a) => this.uc.yetkiliMi(a.uc, rol));
  }

  /**
   * Model belge/fatura numarası veya unvan/kod verdiğinde otomatik UUID çözümü.
   * Okuma dışı (taslak/onay) araçlarda ad yalnız kısmen eşleşirse tek aday
   * olsa bile otomatik seçilmez: "Ahmet" yazıldığında tek eşleşen
   * "Ahmet Yılmaz Ltd." sessizce işleme alınmasın, kullanıcı seçsin.
   */
  private async kimlikleriCoz(aracAdi: string, girdi: unknown, yazma = false): Promise<unknown> {
    if (!girdi || typeof girdi !== "object" || !this.prisma) return girdi;
    const baglam = baglamAl();
    if (!baglam?.tenantId) return girdi;

    const kopyasi = { ...(girdi as Record<string, unknown>) };
    const tenantId = baglam.tenantId;

    try {
      await this.prisma.tenantIslem(tenantId, async (tx) => {
        // 1. Belge ID çözümü
        const belgeDegeri = kopyasi.belgeId ?? (aracAdi.startsWith("belge_") ? kopyasi.id : undefined);
        if (typeof belgeDegeri === "string" && !UUID_REGEX.test(belgeDegeri)) {
          const aranan = belgeDegeri.trim();
          // İşlem araçlarında belge numarası kısmi eşleşmez; yanlış belgeye
          // işlem hazırlamaktansa model önce belge_ara ile seçim istemelidir.
          const belgeler = await tx.belge.findMany({
            where: { no: { equals: aranan, mode: "insensitive" } },
            take: 6,
            select: { id: true, no: true, tur: true, durum: true, cari: { select: { unvan: true } } },
          });
          if (belgeler.length === 1) kopyasi.belgeId = belgeler[0].id;
          else if (belgeler.length > 1) throw new KimlikBelirsizHatasi("belge", aranan, belgeler.slice(0, 5));
        }

        // 2. Fatura ID çözümü
        const faturaDegeri = kopyasi.faturaId ?? ((aracAdi.startsWith("fatura_") || aracAdi.startsWith("ebelge_")) ? kopyasi.id : undefined);
        if (typeof faturaDegeri === "string" && !UUID_REGEX.test(faturaDegeri)) {
          const aranan = faturaDegeri.trim();
          const faturalar = await tx.fatura.findMany({
            where: { no: { equals: aranan, mode: "insensitive" } },
            take: 6,
            select: { id: true, no: true, tip: true, durum: true, cari: { select: { unvan: true } } },
          });
          if (faturalar.length === 1) kopyasi.faturaId = faturalar[0].id;
          else if (faturalar.length > 1) throw new KimlikBelirsizHatasi("fatura", aranan, faturalar.slice(0, 5));
        }

        // 3. Cari ID çözümü
        const cariDegeri = kopyasi.cariId ?? (aracAdi.startsWith("cari_") && aracAdi !== "cari_ara" ? kopyasi.id : undefined);
        if (typeof cariDegeri === "string" && !UUID_REGEX.test(cariDegeri)) {
          const aranan = cariDegeri.trim();
          const tamCariler = await tx.cariHesap.findMany({
            where: { OR: [{ kod: { equals: aranan, mode: "insensitive" } }, { unvan: { equals: aranan, mode: "insensitive" } }, { vknTckn: aranan }] },
            take: 6,
            select: { id: true, kod: true, unvan: true, vknTckn: true },
          });
          const cariler = tamCariler.length ? tamCariler : await tx.cariHesap.findMany({
            where: { unvan: { contains: aranan, mode: "insensitive" } }, take: 6,
            select: { id: true, kod: true, unvan: true, vknTckn: true },
          });
          if (cariler.length === 1 && (tamCariler.length || !yazma)) kopyasi.cariId = cariler[0].id;
          else if (cariler.length >= 1) throw new KimlikBelirsizHatasi("cari", aranan, cariler.slice(0, 5));
        }

        // 4. Stok ID çözümü
        const stokDegeri = kopyasi.stokId ?? (aracAdi.startsWith("stok_") && aracAdi !== "stok_ara" ? kopyasi.id : undefined);
        if (typeof stokDegeri === "string" && !UUID_REGEX.test(stokDegeri)) {
          const aranan = stokDegeri.trim();
          const tamStoklar = await tx.stokKart.findMany({
            where: { OR: [{ kod: { equals: aranan, mode: "insensitive" } }, { ad: { equals: aranan, mode: "insensitive" } }, { barkod: aranan }] },
            take: 6, select: { id: true, kod: true, ad: true, barkod: true },
          });
          const stoklar = tamStoklar.length ? tamStoklar : await tx.stokKart.findMany({
            where: { ad: { contains: aranan, mode: "insensitive" } }, take: 6,
            select: { id: true, kod: true, ad: true, barkod: true },
          });
          if (stoklar.length === 1 && (tamStoklar.length || !yazma)) kopyasi.stokId = stoklar[0].id;
          else if (stoklar.length >= 1) throw new KimlikBelirsizHatasi("stok", aranan, stoklar.slice(0, 5));
        }

        // 5. Satırlardaki stokId çözümü
        if (Array.isArray(kopyasi.satirlar)) {
          kopyasi.satirlar = await Promise.all(
            kopyasi.satirlar.map(async (satir: unknown) => {
              if (satir && typeof satir === "object" && "stokId" in satir) {
                const s = { ...(satir as Record<string, unknown>) };
                if (typeof s.stokId === "string" && !UUID_REGEX.test(s.stokId)) {
                  const aranan = s.stokId.trim();
                  const tam = await tx.stokKart.findMany({
                    where: { OR: [{ kod: { equals: aranan, mode: "insensitive" } }, { ad: { equals: aranan, mode: "insensitive" } }, { barkod: aranan }] },
                    take: 6, select: { id: true, kod: true, ad: true, barkod: true },
                  });
                  const adaylar = tam.length ? tam : await tx.stokKart.findMany({
                    where: { ad: { contains: aranan, mode: "insensitive" } }, take: 6,
                    select: { id: true, kod: true, ad: true, barkod: true },
                  });
                  if (adaylar.length === 1 && (tam.length || !yazma)) s.stokId = adaylar[0].id;
                  else if (adaylar.length >= 1) throw new KimlikBelirsizHatasi("stok", aranan, adaylar.slice(0, 5));
                }
                return s;
              }
              return satir;
            }),
          );
        }
      });
    } catch (hata) {
      if (hata instanceof KimlikBelirsizHatasi) throw hata;
      this.logger.warn(`Kimlik çözümü sırasında hata: ${String(hata)}`);
    }

    return kopyasi;
  }

  async yurut(
    cagri: { ad: string; girdi: unknown },
    izinli: Map<string, AjanAraci>,
    secenek: { kaynak: "asistan" | "mcp" | "otomasyon"; oturumId?: string | null },
  ): Promise<AracSonucu> {
    const arac = izinli.get(cagri.ad);
    if (!arac) {
      if (aracBul(cagri.ad)) return { icerik: `Kullanıcının rolü "${cagri.ad}" işlemine yetkili değil; bu işlemi yapamazsın.`, hata: true };
      // Canlıda Gemini adı kesik yazdı ("belge_taslagi_olust"): en yakın adı önerip yeniden denetir.
      const oneri = [...izinli.keys()].find((ad) => cagri.ad && (ad.startsWith(cagri.ad) || cagri.ad.startsWith(ad)));
      return { icerik: `"${cagri.ad}" adlı araç yok.${oneri ? ` "${oneri}" aracını kastettiysen onu aynı parametrelerle yeniden çağır.` : " Yalnız sunulan araç adlarını kullan."}`, hata: true };
    }
    let cozulenGirdi: unknown;
    try {
      cozulenGirdi = await this.kimlikleriCoz(arac.ad, cagri.girdi, arac.sinif !== "okuma");
    } catch (hata) {
      if (hata instanceof KimlikBelirsizHatasi) return { icerik: hata.message, hata: true, secim: hata.secim };
      throw hata;
    }
    const ayristirma = arac.girdi.safeParse(cozulenGirdi);
    if (!ayristirma.success) {
      return {
        icerik: `Geçersiz parametre: ${ayristirma.error.issues.map((s) => `${s.path.join(".")}: ${s.message}`).join("; ")}. ` +
          "Kimlik (…Id) alanları arama araçlarının döndürdüğü UUID olmalıdır; elinde belge numarası ya da ad varsa önce ilgili arama aracını çağır.",
        hata: true,
      };
    }
    const baglam = { uc: this.uc, kaynak: secenek.kaynak, arac: arac.ad };
    try {
      if (arac.sinif === "onay") {
        const ozet = await arac.ozetle!(baglam, ayristirma.data);
        const onizleme = arac.onizle ? await arac.onizle(baglam, ayristirma.data) : varsayilanOnizleme(arac, ozet, ayristirma.data);
        // AI-27: onay, kullanıcının şu an gördüğü kayıt içeriğine bağlanır.
        const hedefOzeti = arac.hedefDurumu ? icerikOzeti(await arac.hedefDurumu(baglam, ayristirma.data)) : null;
        // Ham girdi saklanır; onayda aynı şemayla yeniden doğrulanır.
        const talep = await this.onay.olustur({ arac: arac.ad, parametreler: ayristirma.data, ozet, onizleme, hedefOzeti, kaynak: secenek.kaynak, oturumId: secenek.oturumId ?? null });
        return {
          icerik: jsonKisalt({
            durum: "onay_bekliyor", talepId: talep.id, ozet, adres: `/panel/ai?talep=${talep.id}`,
            not: secenek.kaynak === "mcp"
              ? "İşlem YAPILMADI. Kullanıcı TekirExtra panelindeki onay listesinden onaylayınca çalışacak."
              : "İşlem YAPILMADI. Kullanıcı sohbetteki Onayla düğmesine ya da adresteki onay listesine basınca çalışacak.",
          }),
          talep,
        };
      }
      const sonuc = await arac.calistir(baglam, ayristirma.data);
      let dosya: { tampon: Buffer; dosyaAdi: string; mimeType: string; aciklama?: string } | undefined;
      let temizSonuc = sonuc;
      if (sonuc && typeof sonuc === "object" && "_dosya" in (sonuc as Record<string, unknown>)) {
        const { _dosya, ...kalan } = sonuc as { _dosya?: { tampon: Buffer; dosyaAdi: string; mimeType: string; aciklama?: string } };
        if (_dosya) dosya = _dosya;
        temizSonuc = kalan;
      }
      return { icerik: jsonKisalt(temizSonuc), dosya };
    } catch (hata) {
      this.logger.warn(`Araç ${arac.ad} hata verdi: ${String(hata)}`);
      return { icerik: `Hata: ${hataMetni(hata)}`, hata: true };
    }
  }
}
