import { tabloMetniGuvenli } from "@tekirextra/shared";
import { BadRequestException, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import * as ExcelJS from "exceljs";
import { PlatformPrismaService } from "../mevzuat/platform-prisma.service";
import { ABONELIK_SURELERI, fiyatPlani, type AbonelikSuresi } from "./abonelik-tutari";
import { bagliAbonelikTutari } from "../tenant/abonelik-kosullari";
import {
  FATURA_DURUMU_ADI,
  KANAL_ADI,
  aralikCoz,
  aylikTopla,
  gunBasi,
  oncekiAralik,
  ozetle,
  satirCevir,
  son12Ay,
  suz,
  trGunu,
  type HamOdemeSatiri,
  type OdemeSatiri,
  type RaporSuzgeci,
} from "./odeme-raporu";

const ARALIK_HATASI = {
  gecersiz_tarih: "Geçerli bir başlangıç ve bitiş tarihi girin",
  ters_aralik: "Bitiş tarihi başlangıçtan önce olamaz",
  aralik_cok_uzun: "Tarih aralığı en çok 24 ay olabilir",
} as const;

const SAAT_MS = 60 * 60 * 1000;
const GUN_MS = 24 * SAAT_MS;

interface HamDeneme {
  deneme_id: string; tenant_id: string; unvan: string; zaman: Date; saglayici: string; ortam: string; kaynak: string;
  ay_sayisi: number; toplam: unknown; durum: string; hata: string | null;
}
interface HamKart {
  tenant_id: string; unvan: string; saglayici: string; son4: string | null; kart_markasi: string | null; otomatik_yenileme: boolean;
  ay_sayisi: number; deneme_sayisi: number; son_deneme_at: Date | null; son_hata: string | null;
}
interface HamYenileme {
  tenant_id: string; unvan: string; plan_kodu: string; durum: string; donem_sonu: Date;
  kart_var: boolean; saglayici: string | null; son4: string | null; kart_markasi: string | null; otomatik_yenileme: boolean | null; kart_ay_sayisi: number | null;
  paket_surum_id?: string | null; paket_kosullari?: unknown;
}

/** "DD.MM.YYYY HH:mm" (TR). */
function trZaman(an: Date): string {
  const m = new Date(an.getTime() + 3 * SAAT_MS).toISOString();
  return `${m.slice(8, 10)}.${m.slice(5, 7)}.${m.slice(0, 4)} ${m.slice(11, 16)}`;
}
/** Sütunlar UTC saklanır; oturum saat diliminden bağımsız `timestamp` parametresi. */
const utc = (an: Date) => Prisma.sql`(${an.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;
const trTarih = (an: Date | null) => (an ? trZaman(an).slice(0, 10) : "");

/** PLT-32…37: platform ödeme raporu (yalnız platform yöneticisi; denetleyici `@PlatformUcu`). */
@Injectable()
export class PlatformOdemeRaporuService {
  constructor(private readonly platform: PlatformPrismaService) {}

  /** Kapsayıcı TR günlerini doğrular; hatada 400. */
  aralik(baslangic: string, bitis: string) {
    const sonuc = aralikCoz(baslangic, bitis);
    if ("hata" in sonuc) throw new BadRequestException(ARALIK_HATASI[sonuc.hata]);
    return sonuc;
  }

  private async odemeler(bas: Date, bit: Date): Promise<OdemeSatiri[]> {
    const satirlar = await this.platform.db.$queryRaw<HamOdemeSatiri[]>`SELECT * FROM platform_odeme_raporu(${utc(bas)}, ${utc(bit)})`;
    return satirlar.map(satirCevir);
  }

  /** PLT-32/33/34: süzülmüş ve sayfalanmış liste + özet + önceki eşit dönemin özeti. */
  async rapor(baslangic: string, bitis: string, suzgec: RaporSuzgeci, sayfa: number, adet: number) {
    const { bas, bit } = this.aralik(baslangic, bitis);
    const onceki = oncekiAralik(bas, bit);
    const [simdiki, oncekiler] = await Promise.all([this.odemeler(bas, bit), this.odemeler(onceki.bas, onceki.bit)]);
    const suzulmus = suz(simdiki, suzgec);
    const toplamKayit = suzulmus.length;
    const sonSayfa = Math.max(1, Math.ceil(toplamKayit / adet));
    const gecerliSayfa = Math.min(Math.max(1, sayfa), sonSayfa);
    return {
      aralik: { baslangic, bitis },
      ozet: ozetle(suzulmus),
      onceki: {
        baslangic: trGunu(onceki.bas),
        bitis: trGunu(new Date(onceki.bit.getTime() - GUN_MS)),
        ozet: ozetle(suz(oncekiler, suzgec)),
      },
      kayitlar: suzulmus.slice((gecerliSayfa - 1) * adet, gecerliSayfa * adet),
      toplamKayit,
      sayfa: gecerliSayfa,
      adet,
      // Süzgeç seçenekleri: dönemde görülen sağlayıcılar.
      saglayicilar: [...new Set(simdiki.map((x) => x.saglayici).filter((x): x is string => Boolean(x)))].sort(),
    };
  }

  /** PLT-34: son 12 ayın aylık tahsilatı (süzgeçten bağımsız). */
  async aylik(bugun: Date = new Date()) {
    const { baslangic, aylar } = son12Ay(bugun);
    const satirlar = await this.odemeler(gunBasi(baslangic), new Date(bugun.getTime() + GUN_MS));
    return { aylar: aylikTopla(satirlar, aylar) };
  }

  /** PLT-35: başarısız/yarım denemeler ve son yenilemesi başarısız kartlar. */
  async sorunlu(baslangic: string, bitis: string, filtre: { plan?: string; firma?: string; durum?: string; sayfa?: number } = {}) {
    this.aralik(baslangic, bitis);
    const [kapsam, tumKartlar] = await Promise.all([
      this.platform.db.$queryRaw<{ veri: { denemeler: HamDeneme[]; sayilar: { basarisiz: number; sonuclanmadi: number }; toplam: number; sayfa: number; sayfaBoyutu: number } }[]>`SELECT platform_sorunlu_odeme_kapsami(${baslangic}::date, ${bitis}::date, ${filtre.plan || null}::text, ${filtre.firma ?? null}::uuid, ${filtre.durum ?? "hepsi"}::text, ${filtre.sayfa ?? 1}::integer) AS veri`,
      filtre.plan || filtre.firma ? Promise.resolve([] as HamKart[]) : this.platform.db.$queryRaw<HamKart[]>`SELECT * FROM platform_kart_sorunlari()`,
    ]);
    const veri = kapsam[0].veri;
    // Kartlar ayrı, canlı kapsamdır; tarihsel deneme toplamına eklenmez.
    const kartlar = filtre.plan || filtre.firma ? [] : tumKartlar;
    return {
      sayilar: veri.sayilar, toplam: veri.toplam, sayfa: veri.sayfa, sayfaBoyutu: veri.sayfaBoyutu,
      kartKapsami: filtre.plan || filtre.firma ? "gizli" : "canli",
      denemeler: veri.denemeler.map((x) => ({
        id: x.deneme_id,
        tenantId: x.tenant_id,
        unvan: x.unvan.trim(),
        zaman: x.zaman,
        saglayici: x.saglayici,
        ortam: x.ortam,
        kanal: x.kaynak,
        aySayisi: x.ay_sayisi,
        toplam: Number(x.toplam).toFixed(2),
        durum: x.durum === "basarisiz" ? "basarisiz" : "sonuclanmadi",
        hata: x.hata,
      })),
      kartlar: kartlar.map((x) => ({
        tenantId: x.tenant_id,
        unvan: x.unvan.trim(),
        saglayici: x.saglayici,
        son4: x.son4,
        kartMarkasi: x.kart_markasi,
        otomatikYenileme: x.otomatik_yenileme,
        aySayisi: x.ay_sayisi,
        denemeSayisi: x.deneme_sayisi,
        sonDeneme: x.son_deneme_at,
        sonHata: x.son_hata,
      })),
    };
  }

  /** PLT-36: dönemi `gun` gün içinde bitecek ya da bitmiş firmalar ve beklenen tutar. */
  async yaklasan(gun: number, simdi: Date = new Date()) {
    const satirlar = await this.platform.db.$queryRaw<HamYenileme[]>`SELECT * FROM platform_yaklasan_yenilemeler(${gun}::integer)`;
    return {
      gun,
      kayitlar: satirlar.map((x) => {
        const ay = (ABONELIK_SURELERI as readonly number[]).includes(x.kart_ay_sayisi ?? 0) ? (x.kart_ay_sayisi as AbonelikSuresi) : 1;
        const tutar = bagliAbonelikTutari({ planKodu: x.plan_kodu, paketSurumId: x.paket_surum_id, paketKosullari: x.paket_kosullari }, ay);
        const kalanGun = Math.ceil((x.donem_sonu.getTime() - simdi.getTime()) / GUN_MS);
        return {
          tenantId: x.tenant_id,
          unvan: x.unvan.trim(),
          planKodu: x.plan_kodu,
          planAdi: tutar?.planAdi ?? fiyatPlani(x.plan_kodu)?.ad ?? x.plan_kodu,
          paketSurumId: x.paket_surum_id ?? null,
          durum: x.durum,
          donemSonu: x.donem_sonu,
          kalanGun,
          kart: x.kart_var
            ? { saglayici: x.saglayici, son4: x.son4, kartMarkasi: x.kart_markasi, otomatikYenileme: Boolean(x.otomatik_yenileme), aySayisi: x.kart_ay_sayisi }
            : null,
          beklenen: tutar ? { aySayisi: ay, matrah: tutar.matrah.toFixed(2), kdv: tutar.kdv.toFixed(2), toplam: tutar.toplam.toFixed(2) } : null,
        };
      }),
    };
  }

  /** PLT-37: süzülmüş listenin tamamı (sayfasız) Excel ya da CSV olarak. */
  async disariAktar(baslangic: string, bitis: string, suzgec: RaporSuzgeci, bicim: "xlsx" | "csv"): Promise<{ icerik: Buffer; tur: string; dosyaAdi: string }> {
    const { bas, bit } = this.aralik(baslangic, bitis);
    const satirlar = suz(await this.odemeler(bas, bit), suzgec);
    const basliklar = ["Tarih", "Firma", "VKN", "Kaynak", "Sağlayıcı", "Süre (ay)", "Önceki dönem sonu", "Yeni dönem sonu", "Matrah", "KDV", "Toplam", "İade", "KDV hesaplandı", "Fatura durumu", "Fatura no", "Kaydeden", "Not"];
    const degerler = satirlar.map((x) => [
      trZaman(x.zaman),
      x.unvan,
      x.vkn ?? "",
      KANAL_ADI[x.kanal],
      x.saglayici ?? "",
      x.aySayisi,
      trTarih(x.oncekiDonemSonu),
      trTarih(x.yeniDonemSonu),
      Number(x.matrah),
      Number(x.kdv),
      Number(x.toplam),
      Number(x.iade),
      x.kdvHesaplandi ? "Evet" : "Hayır",
      FATURA_DURUMU_ADI[(x.fatura?.durum ?? "yok") as keyof typeof FATURA_DURUMU_ADI] ?? x.fatura?.durum ?? "",
      x.fatura?.no ?? "",
      x.kaydeden ?? "",
      x.not ?? "",
    ]);
    const dosyaKoku = `platform-odemeleri-${baslangic}-${bitis}`;
    if (bicim === "csv") {
      // Türkçe Excel: noktalı virgül ayırıcı, virgüllü ondalık, BOM.
      const hucre = (v: string | number) => {
        // SEC-09: firma ünvanı kayıt formundan gelir; formül olarak çalışmasın.
        const metin = typeof v === "number" ? v.toFixed(2).replace(".", ",") : tabloMetniGuvenli(v);
        return /[";\n\r]/.test(metin) ? `"${metin.replace(/"/g, '""')}"` : metin;
      };
      const metin = [basliklar, ...degerler.map((r) => r.map((v, i) => (i === 5 ? String(v) : v)))].map((r) => r.map(hucre).join(";")).join("\r\n");
      return { icerik: Buffer.from(`﻿${metin}\r\n`, "utf8"), tur: "text/csv; charset=utf-8", dosyaAdi: `${dosyaKoku}.csv` };
    }
    const kitap = new ExcelJS.Workbook();
    const sayfa = kitap.addWorksheet("Ödemeler");
    sayfa.addRow(basliklar).font = { bold: true };
    for (const r of degerler) sayfa.addRow(r);
    const ozet = ozetle(satirlar);
    sayfa.addRow([]);
    sayfa.addRow(["Toplam", "", "", "", "", "", "", "", Number(ozet.matrah), Number(ozet.kdv), Number(ozet.toplam), Number(ozet.iade)]).font = { bold: true };
    for (const kolon of [9, 10, 11, 12]) sayfa.getColumn(kolon).numFmt = "#,##0.00";
    sayfa.columns.forEach((k, i) => { k.width = [17, 34, 13, 20, 11, 9, 16, 16, 13, 12, 13, 12, 14, 26, 18, 18, 30][i]; });
    sayfa.views = [{ state: "frozen", ySplit: 1 }];
    const icerik = Buffer.from(await kitap.xlsx.writeBuffer());
    return { icerik, tur: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", dosyaAdi: `${dosyaKoku}.xlsx` };
  }
}
