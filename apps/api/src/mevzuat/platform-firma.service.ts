import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import type { JwtYuku } from "../auth/auth.guard";
import { AbonelikErisimService } from "../core/abonelik-erisim.service";
import { aktifPlatformBaglam, DESTEK_KULLANICI_ID } from "../core/istek-baglami";
import { ABONELIK_PLANLARI } from "../tenant/abonelik.service";
import { PlatformPrismaService } from "./platform-prisma.service";
import type { FirmaFiltresi } from "./platform-firma-filtre";

interface FirmaSatiri {
  tenant_id: string;
  unvan: string;
  vkn: string;
  kayit_tarihi: Date;
  plan_kodu: string;
  durum: string;
  donem_sonu: Date | null;
  iptal_tarihi: Date | null;
  aktif_kullanici: bigint;
  son_giris: Date | null;
  ebelge_saglayici: string | null;
  bekleyen_talep_id: string | null;
  bekleyen_plan: string | null;
  son_odeme_at: Date | null;
  askiya_alinacak: boolean;
  baglanti_hatali?: boolean;
  takip_sorumlu_adi?: string | null;
  takip_sorumlu_uygun?: boolean | null;
  sonraki_gorusme?: string | null;
  takip_durumu?: string | null;
}

interface DestekSatiri {
  tenant_id: string;
  izin_bitis: Date;
  acik_oturum_id: string | null;
  acik_oturum_bitis: Date | null;
  acik_oturum_kisi: string | null;
}

/** PLT-09: "ödeme alındı" ile dönem bu kadar ay uzar. */
export const ODEME_SURELERI = [1, 3, 6, 12] as const;

/**
 * Platform P0-1 / P1-1: firma genel bakışı ve abonelik yönetimi. Platform rolü
 * kiracı tablolarını okuyamaz; her şey veritabanındaki dar işlevlerden geçer
 * (yalnız sayılar ve durumlar, firma verisinin içeriği değil). Her işlem
 * platform olay kaydına yazılır.
 */
@Injectable()
export class PlatformFirmaService {
  constructor(
    private readonly platform: PlatformPrismaService,
    private readonly erisim: AbonelikErisimService,
    private readonly jwt: JwtService,
  ) {}

  async listele() {
    const [satirlar, destekler] = await Promise.all([
      this.platform.db.$queryRaw<FirmaSatiri[]>`SELECT * FROM platform_firma_ozeti()`,
      this.platform.db.$queryRaw<DestekSatiri[]>`SELECT * FROM platform_destek_durumu()`,
    ]);
    const destek = new Map(destekler.map((d) => [d.tenant_id, d]));
    return this.gorunum(satirlar, destek);
  }

  /** Eski dizi sözleşmesini kullanan özet/ödeme ekranlarını bozmadan sayfalı liste. */
  async sayfali(f: FirmaFiltresi) {
    const arama = f.arama.replace(/[\\%_]/g, "\\$&");
    const kosullar: Prisma.Sql[] = [];
    if (arama) kosullar.push(Prisma.sql`(lower(translate(unvan, 'Iİ', 'ıi')) LIKE lower(translate(${`%${arama}%`}, 'Iİ', 'ıi')) OR vkn ILIKE ${`%${arama}%`})`);
    if (f.plan) kosullar.push(Prisma.sql`plan_kodu = ${f.plan}`);
    if (f.firma) kosullar.push(Prisma.sql`tenant_id = ${f.firma}::uuid`);
    if (f.baglanti === "hata" || f.goster === "baglantiHatali") kosullar.push(Prisma.sql`baglanti_hatali`);
    if (f.baglanti === "ebelgeAktif") kosullar.push(Prisma.sql`ebelge_saglayici IS NOT NULL`);
    else if (f.baglanti === "ebelgeYok") kosullar.push(Prisma.sql`ebelge_saglayici IS NULL`);
    // Prisma timestamp alanları UTC saklanır; takvim filtreleri Türkiye gününe göre uygulanır.
    for (const [baslangic, bitis, sutun] of [
      [f.kayitBaslangic, f.kayitBitis, Prisma.sql`kayit_tarihi`],
      [f.yenilemeBaslangic, f.yenilemeBitis, Prisma.sql`donem_sonu`],
    ] as const) {
      if (baslangic) kosullar.push(Prisma.sql`(${sutun} AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Istanbul')::date >= ${baslangic}::date`);
      if (bitis) kosullar.push(Prisma.sql`(${sutun} AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Istanbul')::date <= ${bitis}::date`);
    }
    if (f.goster === "talep") kosullar.push(Prisma.sql`bekleyen_talep_id IS NOT NULL`);
    else if (f.goster === "takibiGeciken") kosullar.push(Prisma.sql`takip_durumu <> 'tamamlandi' AND sonraki_gorusme::date < (now() AT TIME ZONE 'Europe/Istanbul')::date`);
    else if (f.goster === "sorumluUygunDegil") kosullar.push(Prisma.sql`takip_durumu <> 'tamamlandi' AND takip_sorumlu_uygun = false`);
    else if (f.goster === "askiyaAlinacak") kosullar.push(Prisma.sql`askiya_alinacak`);
    else if (["askida", "iptal", "aktif", "deneme"].includes(f.goster)) kosullar.push(Prisma.sql`durum = ${f.goster}`);
    else if (f.goster === "hicGirmeyen") kosullar.push(Prisma.sql`son_giris IS NULL`);
    else if (f.goster === "uzunSuredirGirmeyen") kosullar.push(Prisma.sql`son_giris < (now() AT TIME ZONE 'UTC') - interval '30 days'`);
    else if (f.goster === "yenilenecek" || f.goster === "denemesiBitecek") {
      kosullar.push(f.goster === "denemesiBitecek" ? Prisma.sql`durum = 'deneme'` : Prisma.sql`durum IN ('aktif', 'deneme')`);
      kosullar.push(Prisma.sql`(donem_sonu AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Istanbul')::date BETWEEN (now() AT TIME ZONE 'Europe/Istanbul')::date AND (now() AT TIME ZONE 'Europe/Istanbul')::date + 7`);
    }
    const siralar = {
      unvan: Prisma.sql`unvan ASC, tenant_id ASC`,
      kayitYeni: Prisma.sql`kayit_tarihi DESC, tenant_id ASC`,
      sonGiris: Prisma.sql`son_giris DESC NULLS LAST, tenant_id ASC`,
      yenileme: Prisma.sql`donem_sonu ASC NULLS LAST, tenant_id ASC`,
    };
    const [sonuc] = await this.platform.db.$queryRaw<{
      kayitlar: FirmaSatiri[]; toplam: bigint;
      sayilar: { toplam: number; talep: number; askiyaAlinacak: number; askida: number; iptal: number };
    }[]>`
      WITH hatali AS MATERIALIZED (SELECT DISTINCT tenant_id FROM platform_baglanti_sagligi()),
      kaynak AS MATERIALIZED (SELECT o.*, (h.tenant_id IS NOT NULL) AS baglanti_hatali,
        t.durum AS takip_durumu, t.sonraki_gorusme::text AS sonraki_gorusme, k.ad_soyad AS takip_sorumlu_adi,
        (k.aktif AND k.rol = 'yonetici' AND k.davet_turu IS NULL) AS takip_sorumlu_uygun
        FROM platform_firma_ozeti() o LEFT JOIN hatali h ON h.tenant_id = o.tenant_id
        LEFT JOIN platform_firma_takipleri t ON t.tenant_id = o.tenant_id LEFT JOIN platform_kullanicilari k ON k.id = t.sorumlu_id),
      suzulen AS (SELECT * FROM kaynak WHERE ${kosullar.length ? Prisma.join(kosullar, " AND ") : Prisma.sql`TRUE`}),
      sayfa AS (SELECT * FROM suzulen ORDER BY ${siralar[f.siralama]} LIMIT ${f.sayfaBoyutu} OFFSET ${(f.sayfa - 1) * f.sayfaBoyutu})
      SELECT COALESCE((SELECT jsonb_agg(to_jsonb(s) || jsonb_build_object(
          'kayit_tarihi', kayit_tarihi AT TIME ZONE 'UTC', 'son_giris', son_giris AT TIME ZONE 'UTC',
          'donem_sonu', donem_sonu AT TIME ZONE 'UTC', 'iptal_tarihi', iptal_tarihi AT TIME ZONE 'UTC',
          'son_odeme_at', son_odeme_at AT TIME ZONE 'UTC'
        ) ORDER BY ${siralar[f.siralama]}) FROM sayfa s), '[]'::jsonb) AS kayitlar,
        (SELECT count(*) FROM suzulen) AS toplam,
        (SELECT jsonb_build_object('toplam', count(*), 'talep', count(*) FILTER (WHERE bekleyen_talep_id IS NOT NULL),
          'askiyaAlinacak', count(*) FILTER (WHERE askiya_alinacak), 'askida', count(*) FILTER (WHERE durum = 'askida'),
          'iptal', count(*) FILTER (WHERE durum = 'iptal')) FROM kaynak) AS sayilar`;
    const destekler = sonuc.kayitlar.length ? await this.platform.db.$queryRaw<DestekSatiri[]>`
      SELECT * FROM platform_destek_durumu() WHERE tenant_id IN (${Prisma.join(sonuc.kayitlar.map((r) => Prisma.sql`${r.tenant_id}::uuid`))})` : [];
    return {
      kayitlar: this.gorunum(sonuc.kayitlar, new Map(destekler.map((d) => [d.tenant_id, d]))),
      toplam: Number(sonuc.toplam), sayfa: f.sayfa, sayfaBoyutu: f.sayfaBoyutu, sayilar: sonuc.sayilar,
    };
  }

  private gorunum(satirlar: FirmaSatiri[], destek: Map<string, DestekSatiri>) {
    return satirlar.map((r) => ({
      tenantId: r.tenant_id,
      unvan: r.unvan.trim(),
      vkn: r.vkn,
      kayitTarihi: r.kayit_tarihi,
      planKodu: r.plan_kodu,
      planAdi: planAdi(r.plan_kodu),
      durum: r.durum,
      donemSonu: r.donem_sonu,
      iptalTarihi: r.iptal_tarihi,
      aktifKullanici: Number(r.aktif_kullanici),
      sonGiris: r.son_giris,
      ebelgeSaglayici: r.ebelge_saglayici,
      baglantiHatali: r.baglanti_hatali ?? false,
      takip: r.takip_durumu ? { durum: r.takip_durumu, sonrakiGorusme: r.sonraki_gorusme ?? null, sorumluAdi: r.takip_sorumlu_adi ?? null, sorumluUygun: r.takip_sorumlu_uygun ?? null } : null,
      bekleyenTalep: r.bekleyen_talep_id ? { id: r.bekleyen_talep_id, istenenPlan: r.bekleyen_plan, istenenPlanAdi: planAdi(r.bekleyen_plan ?? "") } : null,
      sonOdemeAt: r.son_odeme_at,
      // PLT-09: dönem sonundan 15 gün geçti, ödeme işaretlenmedi. Otomatik askı yok; karar platformun.
      askiyaAlinacak: r.askiya_alinacak,
      // PLT-10: firma KLN-24 ile izin verdiyse bitişi ve açık destek oturumu.
      destek: destek.has(r.tenant_id) ? destekGorunumu(destek.get(r.tenant_id)!) : null,
    }));
  }

  /**
   * PLT-10: yalnız izin veren firmada ve izin süresince; en çok 30 dk, yenilemesiz.
   * Dönen token kiracı token'ıdır (destek işaretli); kiracı API'si onu salt
   * okunur kabul eder ve her isteği iki kayda yazar.
   */
  async destekOturumuAc(tenantId: string) {
    const { kullaniciId, eposta } = aktifPlatformBaglam();
    const kisi = await this.platform.db.platformKullanici.findUnique({ where: { id: kullaniciId }, select: { adSoyad: true } });
    const ad = kisi?.adSoyad ?? eposta;
    // PLT-27: oturum ve olay kaydı birlikte yazılır; olay yazılamazsa oturum da açılmaz.
    const satir = await this.cagir(() => this.platform.db.$transaction(async (tx) => {
      const [s] = await tx.$queryRaw<{ oturum_id: string; bitis: Date }[]>`SELECT * FROM platform_destek_oturumu_ac(${tenantId}::uuid, ${kullaniciId}::uuid, ${ad}, ${eposta})`;
      await this.olay(tx, kullaniciId, "destek_oturumu_acildi", { tenantId, oturumId: s.oturum_id, bitis: s.bitis });
      return s;
    }));
    const sureSn = Math.max(1, Math.floor((satir.bitis.getTime() - Date.now()) / 1000));
    const yuk: JwtYuku = { sub: DESTEK_KULLANICI_ID, tenantId, rol: "yonetici", destek: { oid: satir.oturum_id, ad, ep: eposta, pid: kullaniciId } };
    const token = await this.jwt.signAsync(yuk, { secret: process.env.JWT_SECRET, expiresIn: sureSn });
    return { token, oturumId: satir.oturum_id, bitis: satir.bitis };
  }

  async destekOturumuKapat(oturumId: string) {
    const { kullaniciId } = aktifPlatformBaglam();
    await this.platform.db.$transaction(async (tx) => {
      const [satir] = await tx.$queryRaw<{ tenant_id: string | null }[]>`SELECT platform_destek_oturumu_kapat(${oturumId}::uuid, 'platform_kapatti') AS tenant_id`;
      if (!satir?.tenant_id) throw new NotFoundException("Açık destek oturumu bulunamadı");
      await this.olay(tx, kullaniciId, "destek_oturumu_kapatildi", { tenantId: satir.tenant_id, oturumId, neden: "platform_kapatti" });
    });
    return { mesaj: "Destek oturumu kapatıldı; açık sekme en geç 10 saniyede düşer." };
  }

  /** Vergi numarası yalnızca platform yöneticisinin doğrulanmış talebiyle değiştirilebilir. */
  async vknDegistir(tenantId: string, yeniVkn: string, destekTalepNo: string, dogrulamaNotu: string) {
    const { kullaniciId, rol } = aktifPlatformBaglam();
    if (rol !== "yonetici") throw new BadRequestException("Vergi numarası değişikliği platform yöneticisi gerektirir");
    return this.cagir(() => this.platform.db.$transaction(async (tx) => {
      const [sonuc] = await tx.$queryRaw<{ eski_vkn: string; yeni_vkn: string; kisi_turu: string }[]>`
        SELECT * FROM platform_firma_vkn_degistir(${tenantId}::uuid, ${yeniVkn})`;
      if (!sonuc) throw new NotFoundException("Firma bulunamadı");
      if (sonuc.eski_vkn === sonuc.yeni_vkn) throw new BadRequestException("Yeni vergi numarası mevcut numarayla aynı");
      await this.olay(tx, kullaniciId, "firma_vkn_degistirildi", { tenantId, eskiVkn: sonuc.eski_vkn, yeniVkn: sonuc.yeni_vkn, kisiTuru: sonuc.kisi_turu, destekTalepNo, dogrulamaNotu });
      return { tenantId, vkn: sonuc.yeni_vkn };
    }));
  }

  async gecmis(tenantId: string) {
    const [satir] = await this.platform.db.$queryRaw<{ gecmis: unknown }[]>`SELECT platform_firma_abonelik_gecmisi(${tenantId}::uuid) AS gecmis`;
    return satir?.gecmis ?? { degisiklikler: [], talepler: [], odemeler: [] };
  }

  /**
   * PLT-09: elle alınan ödeme dönemi uzatır; tutar ve not abonelik geçmişine yazılır.
   * PLT-27: ödeme, dönem uzatma ve olay kaydı tek transaction'dadır. `islemAnahtari`
   * istemcinin her ödeme formu için ürettiği kimliktir: yanıt kaybolup aynı istek
   * yeniden gelirse ilk sonuç döner, ikinci ödeme ya da uzatma oluşmaz; aynı anahtar
   * farklı içerikle (başka tutar, firma, kişi…) gelirse 409. `tutar` kuruş hassasiyetinde metindir.
   */
  async odemeKaydet(tenantId: string, aySayisi: (typeof ODEME_SURELERI)[number], tutar: string, not: string | null, islemAnahtari: string) {
    const { kullaniciId, eposta } = aktifPlatformBaglam();
    const istekOzeti = createHash("sha256").update(JSON.stringify([tenantId, aySayisi, tutar, not ?? "", kullaniciId])).digest("hex");
    const satir = await this.cagir(() => this.platform.db.$transaction(async (tx) => {
      const [s] = await tx.$queryRaw<{ yeni_donem_sonu: Date; odeme_id: string; tekrar: boolean }[]>`
        SELECT * FROM platform_odeme_kaydet(${tenantId}::uuid, ${aySayisi}::int, ${tutar}::numeric, ${not}, ${kullaniciId}::uuid, ${eposta}, ${islemAnahtari}, ${istekOzeti})`;
      if (!s.tekrar) await this.olay(tx, kullaniciId, "abonelik_odemesi_alindi", { tenantId, aySayisi, tutar, not, yeniDonemSonu: s.yeni_donem_sonu, odemeId: s.odeme_id, islemAnahtari });
      return s;
    }));
    // Erişim önbelleği yalnız commit sonrası düşürülür.
    this.erisim.unut(tenantId);
    const gun = satir.yeni_donem_sonu.toLocaleDateString("tr-TR", { timeZone: "Europe/Istanbul" });
    return { mesaj: satir.tekrar ? `Bu ödeme zaten kaydedilmişti; dönem sonu ${gun}.` : `Ödeme kaydedildi; dönem sonu ${gun}.`, yeniDonemSonu: satir.yeni_donem_sonu, odemeId: satir.odeme_id, tekrar: satir.tekrar };
  }

  /** Askıya alma ve geri açma; neden zorunlu ve firmanın abonelik geçmişine de yazılır. */
  /** PLT-13: askı nedeni "odeme" ise firma başarılı sağlayıcı ödemesiyle kendiliğinden açılır. */
  async durumDegistir(tenantId: string, durum: "askida" | "aktif", neden: string, askiNedeni: "odeme" | "diger" = "diger") {
    const { kullaniciId, eposta } = aktifPlatformBaglam();
    const aski = durum === "askida" ? askiNedeni : null;
    const etiket = durum === "askida" ? `Askıya alındı${askiNedeni === "odeme" ? " — ödeme bekleniyor" : ""}` : "Askıdan çıkarıldı";
    await this.cagir(() => this.platform.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT platform_abonelik_guncelle(${tenantId}::uuid, NULL, ${durum}, ${`${etiket} (${eposta}): ${neden}`}, ${aski})`;
      await this.olay(tx, kullaniciId, durum === "askida" ? "firma_askiya_alindi" : "firma_askidan_cikarildi", { tenantId, neden, ...(aski ? { askiNedeni: aski } : {}) });
    }));
    this.erisim.unut(tenantId);
    return { mesaj: durum === "askida" ? "Firma askıya alındı; salt okunur." : "Firma yeniden etkin." };
  }

  async planDegistir(tenantId: string, planKodu: string, neden: string) {
    if (!ABONELIK_PLANLARI.some((p) => p.kod === planKodu)) throw new BadRequestException("Geçersiz plan");
    const { kullaniciId, eposta } = aktifPlatformBaglam();
    await this.cagir(() => this.platform.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT platform_abonelik_guncelle(${tenantId}::uuid, ${planKodu}, NULL, ${`Platform plan değişikliği (${eposta}): ${neden}`})`;
      await this.olay(tx, kullaniciId, "firma_plani_degisti", { tenantId, planKodu, neden });
    }));
    this.erisim.unut(tenantId);
    return { mesaj: `Plan ${planAdi(planKodu)} yapıldı.` };
  }

  async talepKarar(talepId: string, onay: boolean, not: string | null) {
    const { kullaniciId } = aktifPlatformBaglam();
    const satir = await this.cagir(() => this.platform.db.$transaction(async (tx) => {
      const [s] = await tx.$queryRaw<{ tenant_id: string }[]>`SELECT platform_abonelik_talebi_karar(${talepId}::uuid, ${onay}, ${not}, ${kullaniciId}::uuid) AS tenant_id`;
      await this.olay(tx, kullaniciId, onay ? "plan_talebi_onaylandi" : "plan_talebi_reddedildi", { talepId, tenantId: s.tenant_id, not });
      return s;
    }));
    this.erisim.unut(satir.tenant_id);
    return { mesaj: onay ? "Talep onaylandı; yeni plan geçerli." : "Talep reddedildi." };
  }

  /** PLT-27: olay, işlemin kendi transaction'ında yazılır; biri düşerse ikisi de geri alınır. */
  private async olay(tx: Prisma.TransactionClient, kullaniciId: string, olay: string, detay: Record<string, unknown>) {
    await tx.mevzuatOlay.create({ data: { kullaniciId, olay, detay: detay as Prisma.InputJsonValue } });
  }

  private async cagir<T>(is: () => Promise<T>): Promise<T> {
    try {
      return await is();
    } catch (hata) {
      const mesaj = hata instanceof Error ? hata.message : String(hata);
      if (mesaj.includes("firma_yok")) throw new NotFoundException("Firma bulunamadı");
      if (mesaj.includes("vergi_numarasi_cakisma")) throw new ConflictException("Bu VKN/TCKN başka bir firmada kayıtlı");
      if (mesaj.includes("gecersiz_vergi_numarasi")) throw new BadRequestException("Firma türü için uygun uzunlukta VKN/TCKN girin");
      if (mesaj.includes("izin_yok")) throw new BadRequestException("Firma destek izni vermemiş ya da izin süresi dolmuş");
      if (mesaj.includes("talep_bekliyor_degil")) throw new ConflictException("Talep artık beklemiyor (karar verilmiş ya da geri çekilmiş)");
      if (mesaj.includes("islem_anahtari_cakisma")) throw new ConflictException("Bu form ile farklı bilgilerle bir ödeme zaten kaydedilmiş. Mükerrer kayıt olmaması için önce firmanın ödeme geçmişini kontrol edin; yeni bir ödeme gerekiyorsa paneli kapatıp yeniden açın.");
      if (mesaj.includes("islem_anahtari_yok")) throw new BadRequestException("İşlem anahtarı eksik ya da geçersiz");
      if (mesaj.includes("gecersiz_tutar")) throw new BadRequestException("Tutar kuruş hassasiyetinde ve eksi olmayan bir değer olmalı");
      throw hata;
    }
  }
}

function destekGorunumu(d: DestekSatiri) {
  return {
    izinBitis: d.izin_bitis,
    acikOturum: d.acik_oturum_id ? { id: d.acik_oturum_id, bitis: d.acik_oturum_bitis, kisi: d.acik_oturum_kisi } : null,
  };
}

function planAdi(kod: string): string {
  if (kod === "v1") return "Profesyonel (eski kayıt)";
  return ABONELIK_PLANLARI.find((p) => p.kod === kod)?.ad ?? kod;
}
