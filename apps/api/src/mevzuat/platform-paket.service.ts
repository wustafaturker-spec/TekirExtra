import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { paketKapsamSemasi, type PaketKapsamSozlesmesi } from "@tekirextra/shared";
import { aktifPlatformBaglam } from "../core/istek-baglami";
import { ABONELIK_KDV_ORANI, ABONELIK_SURELERI, abonelikTutari } from "../abonelik-odeme/abonelik-tutari";
import { ABONELIK_PLANLARI } from "../tenant/abonelik.service";
import { PlatformPrismaService } from "./platform-prisma.service";
import { paketFiyatSemasi, type PaketFiyatlandirmasi } from "./platform-paket-fiyat";
import { abonelikKosullariniOku, bagliAbonelikTutari } from "../tenant/abonelik-kosullari";
import { paketFiyatEtkisi } from "./platform-paket-etki";
import { atamaHatasiniCevir, atamaOnizlemesiniSun, type PaketAtamaGirdisi, type PaketAtamaKaydi } from "./platform-paket-atama";

interface Icerik { ad: string; aciklama: string; ozellikler: string[]; siralama: number; fiyatlandirma?: PaketFiyatlandirmasi | null; kapsamSozlesmesi?: PaketKapsamSozlesmesi | null; denemeGunSayisi?: number }
interface GecisSatiri { tenant_id: string; unvan: string; plan_kodu: string; paket_surum_id: string | null; paket_kosullari: unknown; durum: string }
interface GecisRaporu { toplam: number; bagli: number; bilinmeyenPlan: number; sayfa: number; sayfaBoyutu: number; kayitlar: GecisSatiri[] }
export interface PaketSatisGirdisi { acik: boolean; surumId: string | null; kilitSurumu: number; surumKilitSurumu: number | null; neden: string }
@Injectable()
export class PlatformPaketService {
  constructor(private readonly platform: PlatformPrismaService) {}
  private kapsamVerisi(g: Icerik) {
    if (g.kapsamSozlesmesi === undefined) return undefined;
    if (g.kapsamSozlesmesi === null) return Prisma.DbNull;
    const r = paketKapsamSemasi.safeParse(g.kapsamSozlesmesi);
    if (!r.success) throw new BadRequestException(r.error.issues.map((i) => i.message).join("; "));
    return r.data as unknown as Prisma.InputJsonValue;
  }
  private fiyatVerisi(g: Icerik) {
    if (g.fiyatlandirma === undefined) return undefined;
    if (g.fiyatlandirma === null) return Prisma.DbNull;
    const r = paketFiyatSemasi.safeParse(g.fiyatlandirma);
    if (!r.success) throw new BadRequestException(r.error.issues.map((i) => i.message).join("; "));
    return r.data as unknown as Prisma.InputJsonValue;
  }
  private yonetici() {
    const b = aktifPlatformBaglam();
    if (b.rol !== "yonetici") throw new ForbiddenException("Paket kataloğu için platform yöneticisi yetkisi gerekir.");
    return b;
  }
  private async yetkiKilitle(tx: Prisma.TransactionClient, kullaniciId: string) {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended('platform-kullanici-yetki', 0))::text`;
    const uygun = await tx.platformKullanici.findFirst({ where: { id: kullaniciId, aktif: true, rol: "yonetici", davetTuru: null }, select: { id: true } });
    if (!uygun) throw new ForbiddenException("Paket işlemleri için aktif ve kurulumu tamamlanmış yönetici hesabı gerekir.");
  }
  private async yaz<T>(id: string, islem: (tx: Prisma.TransactionClient, kullaniciId: string) => Promise<T>) {
    const { kullaniciId } = this.yonetici();
    return this.platform.db.$transaction(async (tx) => {
      await this.yetkiKilitle(tx, kullaniciId);
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`platform-paket:${id.toLowerCase()}`}, 0))::text`;
      if (!await tx.platformPaket.findUnique({ where: { id }, select: { id: true } })) throw new NotFoundException("Paket bulunamadı.");
      return islem(tx, kullaniciId);
    });
  }
  async listele(f: { arama: string; sayfa: number }) {
    this.yonetici();
    const [r] = await this.platform.db.$queryRaw<{ kayitlar: unknown[]; toplam: bigint }[]>`
      WITH kaynak AS MATERIALIZED (
        SELECT p.id, p.kod, p.eski_plan_kodu AS "eskiPlanKodu", p.satis_acik AS "satisAcik", p.satis_surum_id AS "satisSurumId", s.siralama,
          jsonb_build_object('id',s.id,'surumNo',s.surum_no,'ad',s.ad,'durum',s.durum,'siralama',s.siralama) AS "sonSurum"
        FROM platform_paketler p JOIN LATERAL (SELECT * FROM platform_paket_surumleri WHERE paket_id = p.id ORDER BY surum_no DESC LIMIT 1) s ON true
        WHERE ${f.arama} = '' OR strpos(lower(p.kod),lower(${f.arama})) > 0 OR strpos(lower(s.ad),lower(${f.arama})) > 0
      ), sayfa AS (SELECT * FROM kaynak ORDER BY siralama, kod, id LIMIT 25 OFFSET ${(f.sayfa - 1) * 25})
      SELECT COALESCE((SELECT jsonb_agg(to_jsonb(s) - 'siralama' ORDER BY siralama, kod, id) FROM sayfa s),'[]'::jsonb) AS kayitlar,
        (SELECT count(*) FROM kaynak) AS toplam`;
    return { kayitlar: r.kayitlar, toplam: Number(r.toplam), sayfa: f.sayfa, sayfaBoyutu: 25, satisEntegrasyonu: false };
  }
  async gecisDurumu(sayfa: number) {
    this.yonetici();
    const [r] = await this.platform.db.$queryRaw<{ sonuc: GecisRaporu }[]>`SELECT platform_abonelik_katalog_durumu(${sayfa}::integer) AS sonuc`;
    return { ...r.sonuc, kayitlar: r.sonuc.kayitlar.map((x) => {
      const a = { planKodu: x.plan_kodu, paketSurumId: x.paket_surum_id, paketKosullari: x.paket_kosullari };
      const k = abonelikKosullariniOku(a), eski = ABONELIK_PLANLARI.find((p) => p.kod === (x.plan_kodu === "v1" ? "profesyonel" : x.plan_kodu));
      const donemler = ABONELIK_SURELERI.map((ay) => {
        const once = abonelikTutari(x.plan_kodu, ay), sonra = k ? bagliAbonelikTutari(a, ay) : null;
        const yaz = (t: typeof once) => t ? { matrah: t.matrah.toFixed(2), kdv: t.kdv.toFixed(2), toplam: t.toplam.toFixed(2) } : null;
        return { aySayisi: ay, once: yaz(once), sonra: yaz(sonra), esit: !!k && (once === null && sonra === null || !!once && !!sonra && once.matrah.eq(sonra.matrah) && once.kdv.eq(sonra.kdv) && once.toplam.eq(sonra.toplam)) };
      });
      const limitlerEsit = !!k && !!eski && (Object.keys(eski.limitler) as (keyof typeof eski.limitler)[]).every((ad) => eski.limitler[ad] === k.limitler[ad]);
      return { tenantId: x.tenant_id, unvan: x.unvan, planKodu: x.plan_kodu, paketSurumId: x.paket_surum_id, durum: x.durum,
        kaynak: k?.kaynak ?? null, donemler, oncekiLimitler: eski?.limitler ?? null, sonrakiLimitler: k?.limitler ?? null,
        kosullarEsit: k ? limitlerEsit && donemler.every((d) => d.esit) : null };
    }) };
  }
  async fiyatEtkisi(surumId: string, sayfa: number) {
    this.yonetici();
    return this.platform.db.$transaction(async (tx) => {
      const surum = await tx.platformPaketSurumu.findUnique({ where: { id: surumId }, include: { paket: true } });
      if (!surum) throw new NotFoundException("Paket sürümü bulunamadı.");
      if (surum.durum !== "yayinlandi") throw new BadRequestException("Fiyat etkisi için yayınlanmış bir sürüm seçin.");
      const fiyat = paketFiyatSemasi.safeParse(surum.fiyatlandirma);
      if (!fiyat.success) throw new BadRequestException("Seçilen sürümün geçerli dönem fiyatları yok.");
      const [r] = await tx.$queryRaw<{ sonuc: GecisRaporu }[]>`SELECT platform_abonelik_katalog_durumu(${sayfa}::integer) AS sonuc`;
      return { ...r.sonuc, hedefSurumId: surum.id, hedefSurumNo: surum.surumNo, hedefPaketAdi: surum.ad, hedefKapsamVar: surum.kapsamSozlesmesi != null,
        gecerlilikTarihi: fiyat.data.gecerlilikTarihi, uygulamaTarihi: null, atamaYapildi: false,
        kapsam: "Tüm abonelikler; yalnız aynı plandaki kayıtlı koşullar karşılaştırılır. Dönem bedelleridir; ücret farkı veya atama uygunluğu değildir.",
        kayitlar: r.sonuc.kayitlar.map((x) => ({ tenantId: x.tenant_id, unvan: x.unvan, planKodu: x.plan_kodu, durum: x.durum,
          kaynakSurumId: x.paket_surum_id,
          ...paketFiyatEtkisi({ planKodu: x.plan_kodu, paketSurumId: x.paket_surum_id, paketKosullari: x.paket_kosullari },
            { planKodu: surum.paket.kod, fiyatlandirma: fiyat.data }),
        })),
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }
  async atamaOnizle(g: PaketAtamaGirdisi) {
    const { kullaniciId } = this.yonetici();
    return this.platform.db.$transaction(async (tx) => {
      await this.yetkiKilitle(tx, kullaniciId);
      const [r] = g.atamaKapsami === "kapsam"
        ? await tx.$queryRaw<{ sonuc: PaketAtamaKaydi }[]>`SELECT platform_paket_kapsam_onizle(${kullaniciId}::uuid,${g.surumId}::uuid,${g.tenantIds}::uuid[],${g.uygulamaTarihi}::date,${g.neden},${g.uygulamaTuru ?? "bugun"}) AS sonuc`
        : !g.uygulamaTuru || g.uygulamaTuru === "bugun"
        ? await tx.$queryRaw<{ sonuc: PaketAtamaKaydi }[]>`SELECT platform_paket_atama_onizle(${kullaniciId}::uuid,${g.surumId}::uuid,${g.tenantIds}::uuid[],${g.uygulamaTarihi}::date,${g.neden}) AS sonuc`
        : await tx.$queryRaw<{ sonuc: PaketAtamaKaydi }[]>`SELECT platform_paket_plan_onizle(${kullaniciId}::uuid,${g.surumId}::uuid,${g.tenantIds}::uuid[],${g.uygulamaTarihi}::date,${g.neden},${g.uygulamaTuru}) AS sonuc`;
      return atamaOnizlemesiniSun(r.sonuc);
    }, { timeout: 15000 }).catch(atamaHatasiniCevir);
  }
  async atamaUygula(onizlemeId: string) {
    const { kullaniciId } = this.yonetici();
    return this.platform.db.$transaction(async (tx) => {
      await this.yetkiKilitle(tx, kullaniciId);
      const [r] = await tx.$queryRaw<{ sonuc: { id: string; tekrar: boolean; uygulandiAt: string | null; firmaAdedi: number; durum?: "planlandi" | "uygulandi" } }[]>`
        SELECT platform_paket_atama_uygula(${kullaniciId}::uuid,${onizlemeId}::uuid) AS sonuc`;
      if (!r.sonuc.tekrar) await this.atamaOlayi(tx, onizlemeId, kullaniciId, r.sonuc.durum === "planlandi" ? "firma_paket_atamasi_planlandi" : "firma_paket_fiyati_atandi");
      return r.sonuc;
    }, { timeout: 15000 }).catch(atamaHatasiniCevir);
  }
  private async atamaOlayi(tx: Prisma.TransactionClient, id: string, kullaniciId: string, olay: string, ek: Prisma.InputJsonObject = {}) {
    const [k] = await tx.$queryRaw<{ veri: PaketAtamaKaydi["veri"]; neden: string; hedefSurumId: string }[]>`
      SELECT veri,neden,hedef_surum_id AS "hedefSurumId" FROM platform_paket_atamalari WHERE id=${id}::uuid`;
    for (const x of k.veri.kayitlar) await tx.mevzuatOlay.create({ data: { kullaniciId, olay,
      detay: { tenantId: x.tenantId, atamaId: id, kaynakSurumId: x.abonelik.paket_surum_id, hedefSurumId: k.hedefSurumId,
        neden: k.neden, oncekiKosullar: x.abonelik.paket_kosullari as Prisma.InputJsonValue,
        sonrakiKosullar: x.hedefKosullar as Prisma.InputJsonValue, ...ek } } });
  }
  async planliAtamalar(g: { surumId?: string; sayfa: number }) {
    this.yonetici();
    const [r] = await this.platform.db.$queryRaw<{ sonuc: unknown }[]>`
      WITH kaynak AS MATERIALIZED (
        SELECT id,hedef_surum_id AS "hedefSurumId",veri->>'hedefPaketAdi' AS "hedefPaketAdi",veri->'hedefSurumNo' AS "hedefSurumNo",
          atama_kapsami AS "atamaKapsami",uygulama_turu AS "uygulamaTuru",uygulanacak_at AS "uygulanacakAt",neden,engel_nedeni AS "engelNedeni",iptal_nedeni AS "iptalNedeni",
          CASE WHEN iptal_at IS NOT NULL THEN 'iptal' WHEN uygulandi_at IS NOT NULL THEN 'uygulandi' WHEN engellendi_at IS NOT NULL THEN 'inceleme' ELSE 'planlandi' END AS durum,
          (SELECT jsonb_agg(jsonb_build_object('tenantId',x->>'tenantId','unvan',x->>'unvan')) FROM jsonb_array_elements(veri->'kayitlar') x) AS firmalar
        FROM platform_paket_atamalari WHERE planlandi_at IS NOT NULL AND (${g.surumId ?? null}::uuid IS NULL OR hedef_surum_id=${g.surumId ?? null}::uuid)
      ), sayfa AS (SELECT * FROM kaynak ORDER BY "uygulanacakAt" DESC,id LIMIT 25 OFFSET ${(g.sayfa - 1) * 25})
      SELECT jsonb_build_object('toplam',(SELECT count(*) FROM kaynak),'sayfa',${g.sayfa},'sayfaBoyutu',25,
        'kayitlar',COALESCE((SELECT jsonb_agg(to_jsonb(s) ORDER BY "uygulanacakAt" DESC,id) FROM sayfa s),'[]'::jsonb)) AS sonuc`;
    return r.sonuc;
  }
  async planIptal(id: string, neden: string) {
    const { kullaniciId } = this.yonetici();
    return this.platform.db.$transaction(async (tx) => {
      await this.yetkiKilitle(tx, kullaniciId);
      const [r] = await tx.$queryRaw<{ sonuc: { id: string; tekrar: boolean } }[]>`SELECT platform_paket_plan_iptal(${kullaniciId}::uuid,${id}::uuid,${neden}) AS sonuc`;
      if (!r.sonuc.tekrar) await this.atamaOlayi(tx, id, kullaniciId, "firma_paket_atamasi_iptal", { iptalNedeni: neden });
      return r.sonuc;
    }, { timeout: 15000 }).catch(atamaHatasiniCevir);
  }
  /** HTTP ucu yoktur; yalnız worker zamanlayıcısı çağırır. Her plan ayrı atomik transaction'dır. */
  async planliAtamalariIsle(kapandi: () => boolean = () => false) {
    const hatalar: unknown[] = [];
    const adaylar = await this.platform.db.$queryRaw<{ id: string }[]>`
      SELECT id FROM platform_paket_atamalari WHERE planlandi_at IS NOT NULL AND uygulandi_at IS NULL
        AND iptal_at IS NULL AND engellendi_at IS NULL AND uygulanacak_at <= clock_timestamp() ORDER BY uygulanacak_at,id LIMIT 25`;
    for (const aday of adaylar) {
      if (kapandi()) break;
      await this.platform.db.$transaction(async (tx) => {
        const [r] = await tx.$queryRaw<{ sonuc: { id: string; durum: "atlandi" | "uygulandi" | "inceleme"; kullaniciId?: string; engelNedeni?: string } }[]>`SELECT platform_paket_plan_isle(${aday.id}::uuid) AS sonuc`;
        if (r.sonuc.durum !== "atlandi") await this.atamaOlayi(tx, aday.id, r.sonuc.kullaniciId!,
          r.sonuc.durum === "uygulandi" ? "firma_paket_fiyati_atandi" : "firma_paket_atamasi_inceleme", { engelNedeni: r.sonuc.engelNedeni ?? null });
      }, { timeout: 15000 }).catch((e: unknown) => { hatalar.push(e); });
    }
    if (hatalar.length) throw new AggregateError(hatalar, `${hatalar.length} planlı paket ataması işlenemedi; sonraki taramada yeniden denenecek.`);
  }
  async getir(id: string, sayfa = 1) {
    this.yonetici();
    return this.platform.db.$transaction(async (tx) => {
      const paket = await tx.platformPaket.findUnique({ where: { id } });
      if (!paket) throw new NotFoundException("Paket bulunamadı.");
      const [surumler, toplam, taslakVar] = await Promise.all([
        tx.platformPaketSurumu.findMany({ where: { paketId: id }, orderBy: { surumNo: "desc" }, skip: (sayfa - 1) * 25, take: 25 }),
        tx.platformPaketSurumu.count({ where: { paketId: id } }),
        tx.platformPaketSurumu.count({ where: { paketId: id, durum: "taslak" } }),
      ]);
      const eski = ABONELIK_PLANLARI.find((p) => p.kod === paket.eskiPlanKodu);
      return { paket, surumler, toplam, sayfa, sayfaBoyutu: 25, taslakVar: taslakVar > 0, satisEntegrasyonu: false,
        mevcutKosullar: eski ? { planKodu: eski.kod, aylikFiyat: eski.aylikFiyat, limitler: eski.limitler, paraBirimi: "TRY", kdvOrani: ABONELIK_KDV_ORANI } : null };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }
  async satisGetir(id: string, sayfa = 1) {
    this.yonetici();
    return this.platform.db.$transaction(async (tx) => {
      const p = await tx.platformPaket.findUnique({ where: { id }, include: { satisSurumu: true } });
      if (!p) throw new NotFoundException("Paket bulunamadı.");
      const [kayitlar, toplam] = await Promise.all([
        tx.platformPaketSatisGecmisi.findMany({ where: { paketId: id }, orderBy: [{ kilitSurumu: "desc" }], skip: (sayfa - 1) * 25, take: 25,
          include: { kullanici: { select: { adSoyad: true } } } }),
        tx.platformPaketSatisGecmisi.count({ where: { paketId: id } }),
      ]);
      return { acik: p.satisAcik, kilitSurumu: p.satisKilitSurumu, surum: p.satisSurumu, kayitlar, toplam, sayfa, sayfaBoyutu: 25, satisEntegrasyonu: false };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }
  async satisDegistir(id: string, g: PaketSatisGirdisi) {
    const { kullaniciId } = this.yonetici();
    try {
      return await this.platform.db.$transaction(async (tx) => {
        const [r] = await tx.$queryRaw<{ sonuc: { tekrar: boolean; kilitSurumu: number } }[]>`
          SELECT platform_paket_satis_degistir(${kullaniciId}::uuid,${id}::uuid,${g.acik}::boolean,${g.surumId}::uuid,${g.kilitSurumu}::integer,${g.surumKilitSurumu}::integer,${g.neden}) AS sonuc`;
        if (!r.sonuc.tekrar) await tx.mevzuatOlay.create({ data: { kullaniciId, olay: "paket_satis_durumu_degisti", detay: { paketId: id, acik: g.acik, surumId: g.surumId, kilitSurumu: r.sonuc.kilitSurumu, neden: g.neden } } });
        return r.sonuc;
      });
    } catch (e) { this.satisHatasi(e); }
  }
  private satisHatasi(e: unknown): never {
    const m = (e as { meta?: { message?: string }; message?: string }).meta?.message ?? (e as Error).message ?? "";
    if (m.includes("satis_yetki")) throw new ForbiddenException("Aktif platform yöneticisi yetkisi gerekir.");
    if (/satis_(paket_yok|surum_yok)/.test(m)) throw new NotFoundException("Paket veya bu pakete ait hedef sürüm bulunamadı.");
    if (m.includes("satis_kilit")) throw new ConflictException("Satış durumu veya hedef sürüm değişti. Kaydı yenileyip yeniden onaylayın.");
    if (m.includes("satis_once_durdur")) throw new ConflictException("Satışa seçili sürümü arşivlemeden önce satışı durdurun veya başka sürümü seçin.");
    if (m.includes("satis_hazir_degil")) throw new BadRequestException("Satışı açmak için yayınlanmış, fiyat ve kapsam sözleşmesi olan bir sürüm seçin.");
    if (m.includes("satis_fiyat_tarihi")) throw new BadRequestException("Hedef sürümün fiyat geçerlilik tarihi henüz gelmedi.");
    if (m.includes("satis_girdi")) throw new BadRequestException("Satış hedefi ve 5–1000 karakterlik gerekçe girin.");
    throw e;
  }
  async olustur(g: Icerik & { kod: string }) {
    const { kullaniciId } = this.yonetici();
    try {
      return await this.platform.db.$transaction(async (tx) => {
        await this.yetkiKilitle(tx, kullaniciId);
        const paket = await tx.platformPaket.create({ data: { kod: g.kod } });
        const surum = await tx.platformPaketSurumu.create({ data: { paketId: paket.id, surumNo: 1, ad: g.ad, aciklama: g.aciklama, ozellikler: g.ozellikler, siralama: g.siralama, fiyatlandirma: this.fiyatVerisi(g), kapsamSozlesmesi: this.kapsamVerisi(g), denemeGunSayisi: g.denemeGunSayisi ?? 0 } });
        await tx.mevzuatOlay.create({ data: { kullaniciId, olay: "paket_olusturuldu", detay: { paketId: paket.id, kod: paket.kod, surumId: surum.id, fiyatlandirma: surum.fiyatlandirma, kapsamSozlesmesi: surum.kapsamSozlesmesi, denemeGunSayisi: surum.denemeGunSayisi } } });
        return { id: paket.id, surum };
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new ConflictException("Bu paket kodu zaten kullanılıyor.");
      throw e;
    }
  }
  async taslakAc(id: string, kaynakSurumId: string) {
    return this.yaz(id, async (tx, kullaniciId) => {
      if (await tx.platformPaketSurumu.findFirst({ where: { paketId: id, durum: "taslak" } })) throw new ConflictException("Bu paketin açık taslağı var. Mevcut taslakla devam edin.");
      const kaynak = await tx.platformPaketSurumu.findFirst({ where: { id: kaynakSurumId, paketId: id, durum: { in: ["yayinlandi", "arsiv"] } } });
      if (!kaynak) throw new NotFoundException("Kaynak paket sürümü bulunamadı.");
      const son = await tx.platformPaketSurumu.findFirstOrThrow({ where: { paketId: id }, orderBy: { surumNo: "desc" } });
      const yeni = await tx.platformPaketSurumu.create({ data: { paketId: id, surumNo: son.surumNo + 1, ad: kaynak.ad, aciklama: kaynak.aciklama, ozellikler: kaynak.ozellikler as Prisma.InputJsonValue, siralama: kaynak.siralama, fiyatlandirma: kaynak.fiyatlandirma === null ? Prisma.DbNull : kaynak.fiyatlandirma as Prisma.InputJsonValue, kapsamSozlesmesi: kaynak.kapsamSozlesmesi == null ? Prisma.DbNull : kaynak.kapsamSozlesmesi as Prisma.InputJsonValue, denemeGunSayisi: kaynak.denemeGunSayisi } });
      await tx.mevzuatOlay.create({ data: { kullaniciId, olay: "paket_taslagi_acildi", detay: { paketId: id, surumId: yeni.id, kaynakSurumId, surumNo: yeni.surumNo } } });
      return yeni;
    });
  }
  private async surum(tx: Prisma.TransactionClient, paketId: string, id: string, kilit: number, durum: string) {
    const s = await tx.platformPaketSurumu.findFirst({ where: { id, paketId } });
    if (!s) throw new NotFoundException("Paket sürümü bulunamadı.");
    if (s.kilitSurumu !== kilit) throw new ConflictException("Sürüm başka biri tarafından değiştirildi. Taslağınızı koruyup güncel kaydı inceleyin.");
    if (s.durum !== durum) throw new ConflictException(durum === "taslak" ? "Yalnız taslak düzenlenebilir veya yayınlanabilir." : "Yalnız yayınlanmış sürüm arşivlenebilir.");
    return s;
  }
  async guncelle(id: string, surumId: string, g: Icerik & { kilitSurumu: number }) {
    return this.yaz(id, async (tx, kullaniciId) => {
      const eski = await this.surum(tx, id, surumId, g.kilitSurumu, "taslak");
      const yeni = await tx.platformPaketSurumu.update({ where: { id: surumId }, data: { ad: g.ad, aciklama: g.aciklama, ozellikler: g.ozellikler, siralama: g.siralama, fiyatlandirma: this.fiyatVerisi(g), kapsamSozlesmesi: this.kapsamVerisi(g), denemeGunSayisi: g.denemeGunSayisi, kilitSurumu: { increment: 1 } } });
      await tx.mevzuatOlay.create({ data: { kullaniciId, olay: "paket_taslagi_guncellendi", detay: { paketId: id, surumId, onceki: { ad: eski.ad, aciklama: eski.aciklama, ozellikler: eski.ozellikler, siralama: eski.siralama, fiyatlandirma: eski.fiyatlandirma, kapsamSozlesmesi: eski.kapsamSozlesmesi, denemeGunSayisi: eski.denemeGunSayisi }, yeni: { ad: yeni.ad, aciklama: yeni.aciklama, ozellikler: yeni.ozellikler, siralama: yeni.siralama, fiyatlandirma: yeni.fiyatlandirma, kapsamSozlesmesi: yeni.kapsamSozlesmesi, denemeGunSayisi: yeni.denemeGunSayisi }, kilitSurumu: yeni.kilitSurumu } } });
      return yeni;
    });
  }
  async yayinla(id: string, surumId: string, kilitSurumu: number) {
    return this.yaz(id, async (tx, kullaniciId) => {
      const eski = await this.surum(tx, id, surumId, kilitSurumu, "taslak");
      if (!(eski.ozellikler as string[]).length) throw new BadRequestException("Yayınlamak için en az bir özellik girin.");
      const yeni = await tx.platformPaketSurumu.update({ where: { id: surumId }, data: { durum: "yayinlandi", yayinlandiAt: new Date(), kilitSurumu: { increment: 1 } } });
      await tx.mevzuatOlay.create({ data: { kullaniciId, olay: "paket_surumu_yayinlandi", detay: { paketId: id, surumId, surumNo: yeni.surumNo, satisEntegrasyonu: false } } });
      return yeni;
    });
  }
  async arsivle(id: string, surumId: string, kilitSurumu: number) {
    return this.yaz(id, async (tx, kullaniciId) => {
      await this.surum(tx, id, surumId, kilitSurumu, "yayinlandi");
      const yeni = await tx.platformPaketSurumu.update({ where: { id: surumId }, data: { durum: "arsiv", arsivlendiAt: new Date(), kilitSurumu: { increment: 1 } } });
      await tx.mevzuatOlay.create({ data: { kullaniciId, olay: "paket_surumu_arsivlendi", detay: { paketId: id, surumId, surumNo: yeni.surumNo } } });
      return yeni;
    }).catch((e: unknown) => this.satisHatasi(e));
  }
}
