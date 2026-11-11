import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, Optional } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { Rol } from "@tekirextra/shared";
import { BildirimService } from "../bildirimler/bildirim.service";
import { BildirimUreticiService } from "../bildirimler/bildirim-uretici.service";
import { AyarlarService } from "../core/ayarlar/ayarlar.service";
import { aktifBaglam, baglamlaCalistir } from "../core/istek-baglami";
import { PrismaService } from "../core/prisma.service";
import {
  adimiOnaylayabilir, ISLEM_ADLARI, kuralSec, kuralSemasi, onayliYurut, onayModulu, onayYurutmesi, OnayGerekliHatasi,
  type IslemOlculeri, type KuralGirdisi, type KuralSatiri, type OnayAdimi, type OnayIslemi,
} from "./onay-kurallari";

type Tx = Prisma.TransactionClient;
const D = (d: Prisma.Decimal.Value) => new Prisma.Decimal(d);
/** ONY-07: bekleyen talep bu süreyi aşınca onaycılara günde bir hatırlatma gider. */
const HATIRLATMA_MS = 24 * 3_600_000;

/** Bir işlemin onaylanınca nasıl yürütüleceği ve hedef kaydın içerik özeti (servisler kendini kaydeder). */
export interface OnayYurutucusu {
  yurut(parametreler: unknown, hedefId: string | null): Promise<unknown>;
  hedefOzeti?(hedefId: string): Promise<string | null>;
}

export interface KapiGirdisi {
  islem: OnayIslemi;
  hedefTur?: string;
  hedefId?: string | null;
  /** Talepte görünen tek satırlık özet (belge no, cari, tutar). */
  ozet: string;
  /** Onayda işleme aynen verilecek girdi. */
  parametreler: unknown;
  /** Ölçüler ve hedef özeti; yalnız işleme etkin kural varsa hesaplanır. */
  olc: () => Promise<IslemOlculeri & { hedefOzeti?: string | null }>;
}

type Karar = { adim: number; userId: string; karar: "onay" | "ret"; gerekce: string | null; at: string };

/**
 * ONY-01…10: genel onay akışları. İşlemler kapıdan geçer; kurala takılan işlem yapılmaz, talep
 * açılır. Son adım onaylayınca işlem talep edenin adına yürütülür (asistanın onay talebinde olduğu gibi).
 */
@Injectable()
export class OnayService {
  private readonly logger = new Logger(OnayService.name);
  private readonly yurutuculer = new Map<OnayIslemi, OnayYurutucusu>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly ayarlar: AyarlarService,
    @Optional() private readonly bildirimler?: BildirimService,
    @Optional() uretici?: BildirimUreticiService,
  ) {
    // ONY-07: bildirim taraması her firmada çalışırken bekleyen talepler için hatırlatma üretilir.
    uretici?.ekTaramaKaydet("onay hatırlatması", () => this.hatirlatmalar());
  }

  yurutucuKaydet(islem: OnayIslemi, y: OnayYurutucusu) {
    this.yurutuculer.set(islem, y);
  }

  // ─── Kapı (ONY-03) ─────────────────────────────────────────────────────

  /** İşlemin başında çağrılır; kural uyarsa talep açar ve OnayGerekliHatasi fırlatır, yoksa sessiz geçer. */
  async kapi(g: KapiGirdisi): Promise<void> {
    if (onayYurutmesi()) return;
    const { tenantId, userId, destek } = aktifBaglam();
    if (destek) return; // Destek oturumu yazamaz; kapı da işlem yapmaz.
    const kurallar = await this.prisma.tenantIslem(tenantId, (tx) => tx.onayKurali.findMany({ where: { islem: g.islem, aktif: true } }));
    if (!kurallar.length) return;
    const olcu = await g.olc();
    const secim = kuralSec(kurallar.map(kuralSatiri), olcu);
    if (!secim) return;
    const talep = await this.prisma.tenantIslem(tenantId, async (tx) => {
      // Aynı kayıt için bekleyen talep varsa ikincisi açılmaz.
      if (g.hedefId) {
        const acik = await tx.onayTalebi.findFirst({ where: { hedefId: g.hedefId, islem: g.islem, durum: { in: ["bekliyor", "isleniyor"] } }, select: { id: true } });
        if (acik) throw new ConflictException("Bu kayıt için bekleyen bir onay talebi var; karar verilene kadar işlem yapılamaz");
      }
      const t = await tx.onayTalebi.create({
        data: {
          tenantId, kuralId: secim.kural.id, islem: g.islem, hedefTur: g.hedefTur ?? null, hedefId: g.hedefId ?? null, hedefOzeti: olcu.hedefOzeti ?? null,
          parametreler: (g.parametreler ?? {}) as Prisma.InputJsonValue, ozet: g.ozet.slice(0, 1000), tutarTry: D(olcu.tutarTry).toDecimalPlaces(2),
          nedenler: secim.nedenler as Prisma.InputJsonValue, talepEdenId: userId, adimlar: secim.kural.adimlar as Prisma.InputJsonValue,
        },
      });
      await this.iz(tx, "onay_talebi_acildi", t.id, { islem: g.islem, kural: secim.kural.ad, nedenler: secim.nedenler, ozet: g.ozet });
      return t;
    });
    await this.onaycilaraBildir(talep.id, g.islem, g.ozet, secim.nedenler, secim.kural.adimlar[0], 0, secim.kural.adimlar.length);
    const adimMetni = secim.kural.adimlar.length > 1 ? ` (${secim.kural.adimlar.length} adımlı)` : "";
    throw new OnayGerekliHatasi(
      `${ISLEM_ADLARI[g.islem]} onay gerektiriyor (${secim.nedenler.join("; ")}). Onay talebi açıldı${adimMetni}; onaylanınca işlem kendiliğinden yapılacak.`,
      talep.id,
    );
  }

  // ─── Kararlar (ONY-03…05) ──────────────────────────────────────────────

  async karar(id: string, karar: "onay" | "ret", gerekce?: string | null) {
    const { tenantId, userId } = aktifBaglam();
    const temizGerekce = gerekce?.trim() || null;
    if (karar === "ret" && (!temizGerekce || temizGerekce.length < 3)) throw new BadRequestException("Ret gerekçesi yazın (en az 3 karakter)");
    const gorevAyriligiKapali = await this.gorevAyriligiKapaliMi();
    // Kararı yaz; son adım onaysa talep "isleniyor"a alınır ve işlem kilidin dışında yürütülür.
    const sonuc = await this.prisma.tenantIslem(tenantId, async (tx) => {
      await tx.$queryRaw`SELECT id FROM onay_talepleri WHERE id = ${id}::uuid FOR UPDATE`;
      const t = await tx.onayTalebi.findUnique({ where: { id } });
      if (!t) throw new NotFoundException("Onay talebi bulunamadı");
      if (t.durum !== "bekliyor") throw new ConflictException("Talep zaten karara bağlanmış");
      const kullanici = await tx.user.findUnique({ where: { id: userId }, select: { id: true, rol: true } });
      if (!kullanici) throw new ForbiddenException("Kullanıcı bulunamadı");
      const adimlar = t.adimlar as unknown as OnayAdimi[];
      const kararlar = (t.kararlar as unknown as Karar[]) ?? [];
      const izin = adimiOnaylayabilir(adimlar[t.adim], kullanici, { talepEdenId: t.talepEdenId, oncekiOnaylayanlar: kararlar.filter((k) => k.karar === "onay").map((k) => k.userId) }, gorevAyriligiKapali);
      if (!izin.izin) throw new ForbiddenException(izin.neden);
      const yeni = [...kararlar, { adim: t.adim, userId, karar, gerekce: temizGerekce, at: new Date().toISOString() }];
      if (karar === "ret") {
        await tx.onayTalebi.update({ where: { id }, data: { durum: "reddedildi", kararlar: yeni as Prisma.InputJsonValue, kararAt: new Date() } });
        await this.iz(tx, "onay_talebi_reddedildi", id, { adim: t.adim + 1, gerekce: temizGerekce });
        return { tur: "ret" as const, t };
      }
      if (t.adim + 1 < adimlar.length) {
        await tx.onayTalebi.update({ where: { id }, data: { adim: t.adim + 1, kararlar: yeni as Prisma.InputJsonValue } });
        await this.iz(tx, "onay_talebi_adim_onaylandi", id, { adim: t.adim + 1, gerekce: temizGerekce });
        return { tur: "sonraki" as const, t, sonrakiAdim: adimlar[t.adim + 1], adimNo: t.adim + 1, adimSayisi: adimlar.length };
      }
      await tx.onayTalebi.update({ where: { id }, data: { durum: "isleniyor", kararlar: yeni as Prisma.InputJsonValue, kararAt: new Date() } });
      await this.iz(tx, "onay_talebi_onaylandi", id, { adim: t.adim + 1, gerekce: temizGerekce });
      return { tur: "yurut" as const, t };
    });
    await this.bildirimleriKapat(id);
    if (sonuc.tur === "ret") {
      await this.talepEdeneBildir(sonuc.t.talepEdenId, id, `Onay talebiniz reddedildi: ${ISLEM_ADLARI[sonuc.t.islem as OnayIslemi]}`, `${sonuc.t.ozet}. Gerekçe: ${temizGerekce}`, "uyari");
      return this.getir(id);
    }
    if (sonuc.tur === "sonraki") {
      await this.onaycilaraBildir(id, sonuc.t.islem as OnayIslemi, sonuc.t.ozet, sonuc.t.nedenler as string[], sonuc.sonrakiAdim, sonuc.adimNo, sonuc.adimSayisi);
      return this.getir(id);
    }
    await this.yurut(sonuc.t);
    return this.getir(id);
  }

  /** Son onaydan sonra işlem talep edenin adına yürütülür; hedef değiştiyse yapılmaz (ONY-03). */
  private async yurut(t: { id: string; tenantId: string; islem: string; hedefId: string | null; hedefOzeti: string | null; parametreler: Prisma.JsonValue; talepEdenId: string; ozet: string }) {
    const yurutucu = this.yurutuculer.get(t.islem as OnayIslemi);
    let durum: "onaylandi" | "gecersiz" | "hata" = "onaylandi";
    let sonucVeri: unknown = null;
    let hata: string | null = null;
    try {
      if (!yurutucu) throw new Error("Bu işlemin yürütücüsü tanımlı değil");
      const sahip = await this.prisma.tenantIslem(t.tenantId, (tx) => tx.user.findUnique({ where: { id: t.talepEdenId }, select: { id: true, rol: true, aktif: true, ozelRolId: true } }));
      if (!sahip?.aktif) throw new Error("Talep eden kullanıcı artık etkin değil; işlem yapılmadı");
      // Talep edenin adına, onun rolüyle yürütülür (özel rol daraltması ekrandaki uçta zaten denetlendi).
      sonucVeri = await baglamlaCalistir({ tenantId: t.tenantId, userId: sahip.id, rol: sahip.rol as Rol }, () => onayliYurut(t.id, async () => {
        if (t.hedefId && t.hedefOzeti && yurutucu.hedefOzeti) {
          const guncel = await yurutucu.hedefOzeti(t.hedefId);
          if (guncel !== t.hedefOzeti) { durum = "gecersiz"; return null; }
        }
        return yurutucu.yurut(t.parametreler, t.hedefId);
      }));
      if ((durum as string) === "gecersiz") hata = "Kayıt bu talep açıldıktan sonra değişti; işlem yapılmadı. Güncel hâliyle yeniden isteyin.";
    } catch (e) {
      durum = "hata";
      hata = e instanceof Error ? e.message : String(e);
    }
    await this.prisma.tenantIslem(t.tenantId, async (tx) => {
      await tx.onayTalebi.update({ where: { id: t.id }, data: { durum, hata, sonuc: sonucVeri == null ? undefined : (JSON.parse(JSON.stringify(sonucVeri)) as Prisma.InputJsonValue) } });
      await this.iz(tx, "onay_talebi_yurutuldu", t.id, { durum, hata });
    });
    const islemAdi = ISLEM_ADLARI[t.islem as OnayIslemi] ?? t.islem;
    if (durum === "onaylandi") await this.talepEdeneBildir(t.talepEdenId, t.id, `Onaylandı ve yapıldı: ${islemAdi}`, t.ozet, "bilgi");
    else await this.talepEdeneBildir(t.talepEdenId, t.id, `Onaylandı ama yapılamadı: ${islemAdi}`, `${t.ozet}. ${hata ?? ""}`, "uyari");
  }

  async geriCek(id: string) {
    const { tenantId, userId } = aktifBaglam();
    await this.prisma.tenantIslem(tenantId, async (tx) => {
      const t = await tx.onayTalebi.findUnique({ where: { id }, select: { talepEdenId: true, durum: true } });
      if (!t) throw new NotFoundException("Onay talebi bulunamadı");
      if (t.talepEdenId !== userId) throw new ForbiddenException("Talebi yalnız açan kullanıcı geri çekebilir");
      const r = await tx.onayTalebi.updateMany({ where: { id, durum: "bekliyor" }, data: { durum: "geri_cekildi", kararAt: new Date() } });
      if (!r.count) throw new ConflictException("Talep zaten karara bağlanmış");
      await this.iz(tx, "onay_talebi_geri_cekildi", id, {});
    });
    await this.bildirimleriKapat(id);
    return this.getir(id);
  }

  // ─── Listeler (ONY-06) ─────────────────────────────────────────────────

  async getir(id: string) {
    const { tenantId } = aktifBaglam();
    const t = await this.prisma.tenantIslem(tenantId, (tx) => tx.onayTalebi.findUnique({ where: { id }, include: { talepEden: { select: { adSoyad: true } }, kural: { select: { ad: true } } } }));
    if (!t) throw new NotFoundException("Onay talebi bulunamadı");
    return this.gorunum(t, await this.kullaniciAdlari([t]));
  }

  async liste(kutu: "bekleyen" | "taleplerim" | "gecmis") {
    const { tenantId, userId, rol } = aktifBaglam();
    const gorevAyriligiKapali = await this.gorevAyriligiKapaliMi();
    const talepler = await this.prisma.tenantIslem(tenantId, (tx) => tx.onayTalebi.findMany({
      where: kutu === "bekleyen" ? { durum: "bekliyor" }
        : kutu === "taleplerim" ? { talepEdenId: userId }
        : { durum: { notIn: ["bekliyor", "isleniyor"] }, ...(rol === "yonetici" ? {} : { OR: [{ talepEdenId: userId }, { kararlar: { array_contains: [{ userId }] } }] }) },
      orderBy: { createdAt: "desc" },
      take: 200,
      include: { talepEden: { select: { adSoyad: true } }, kural: { select: { ad: true } } },
    }));
    const benim = { id: userId, rol: rol as Rol };
    const gorunen = kutu === "bekleyen"
      ? talepler.filter((t) => adimiOnaylayabilir((t.adimlar as unknown as OnayAdimi[])[t.adim], benim, { talepEdenId: t.talepEdenId, oncekiOnaylayanlar: ((t.kararlar as unknown as Karar[]) ?? []).filter((k) => k.karar === "onay").map((k) => k.userId) }, gorevAyriligiKapali).izin)
      : talepler;
    const adlar = await this.kullaniciAdlari(gorunen);
    return {
      talepler: gorunen.map((t) => this.gorunum(t, adlar)),
      digerOnaylar: kutu === "bekleyen" ? await this.digerOnaylar(rol as Rol) : [],
    };
  }

  /** ONY-06: kendi akışında karar verilen mevcut onaylar (yalnız listelenir, ekranına bağlanır). */
  private async digerOnaylar(rol: Rol) {
    const { tenantId } = aktifBaglam();
    const yonetici = rol === "yonetici";
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const [satinAlma, talimat, izin, avans, recete] = await Promise.all([
        yonetici || rol === "muhasebe" ? tx.satinAlmaTalebi.findMany({ where: { durum: "onay_bekliyor" }, select: { id: true, no: true, tahminiToplam: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 50 }) : [],
        yonetici || rol === "muhasebe" ? tx.bankaOdemeTalimati.findMany({ where: { durum: "onay_bekliyor" }, select: { id: true, no: true, tutar: true, aciklama: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 50 }) : [],
        yonetici || rol === "ik" ? tx.personelIzinTalebi.findMany({ where: { durum: "talep" }, select: { id: true, aciklama: true, createdAt: true, personel: { select: { ad: true, soyad: true } } }, orderBy: { createdAt: "desc" }, take: 50 }) : [],
        yonetici || rol === "ik" ? tx.personelAvans.findMany({ where: { durum: "talep" }, select: { id: true, tutar: true, tarih: true, personel: { select: { ad: true, soyad: true } } }, orderBy: { tarih: "desc" }, take: 50 }) : [],
        yonetici || rol === "uretim_planlama" ? tx.urunRecetesi.findMany({ where: { durum: "onay_bekliyor" }, select: { id: true, surum: true, createdAt: true, stokId: true, stok: { select: { kod: true, ad: true } } }, orderBy: { createdAt: "desc" }, take: 50 }) : [],
      ]);
      return [
        ...satinAlma.map((s) => ({ tur: "satin_alma", baslik: `Satın alma talebi ${s.no}`, tutar: s.tahminiToplam.toFixed(2), tarih: s.createdAt, yol: `/panel/satin-alma/talepler?talep=${s.id}` })),
        ...talimat.map((s) => ({ tur: "odeme_talimati", baslik: `Ödeme talimatı ${s.no ?? ""} ${s.aciklama}`.trim(), tutar: s.tutar.toFixed(2), tarih: s.createdAt, yol: "/panel/kasa-banka/odeme-talimatlari" })),
        ...izin.map((s) => ({ tur: "izin", baslik: `İzin talebi: ${s.personel.ad} ${s.personel.soyad}`, tutar: null, tarih: s.createdAt, yol: "/panel/personel/izinler" })),
        ...avans.map((s) => ({ tur: "avans", baslik: `Avans talebi: ${s.personel.ad} ${s.personel.soyad}`, tutar: s.tutar.toFixed(2), tarih: s.tarih, yol: "/panel/personel/avanslar" })),
        ...recete.map((s) => ({ tur: "recete", baslik: `Reçete onayı: ${s.stok.kod} ${s.stok.ad} (sürüm ${s.surum})`, tutar: null, tarih: s.createdAt, yol: `/panel/stok/${s.stokId}` })),
      ].sort((a, b) => b.tarih.getTime() - a.tarih.getTime());
    });
  }

  private async kullaniciAdlari(talepler: { kararlar: Prisma.JsonValue; adimlar: Prisma.JsonValue }[]) {
    const idler = new Set<string>();
    for (const t of talepler) {
      for (const k of ((t.kararlar as unknown as Karar[]) ?? [])) idler.add(k.userId);
      for (const a of ((t.adimlar as unknown as OnayAdimi[]) ?? [])) if ("kullaniciId" in a) idler.add(a.kullaniciId);
    }
    if (!idler.size) return new Map<string, string>();
    const { tenantId } = aktifBaglam();
    const k = await this.prisma.tenantIslem(tenantId, (tx) => tx.user.findMany({ where: { id: { in: [...idler] } }, select: { id: true, adSoyad: true } }));
    return new Map(k.map((x) => [x.id, x.adSoyad]));
  }

  private gorunum(t: Prisma.OnayTalebiGetPayload<{ include: { talepEden: { select: { adSoyad: true } }; kural: { select: { ad: true } } } }>, adlar: Map<string, string>) {
    const adimlar = (t.adimlar as unknown as OnayAdimi[]) ?? [];
    return {
      id: t.id, islem: t.islem, islemAdi: ISLEM_ADLARI[t.islem as OnayIslemi] ?? t.islem, hedefTur: t.hedefTur, hedefId: t.hedefId, ozet: t.ozet,
      tutarTry: t.tutarTry?.toFixed(2) ?? null, nedenler: t.nedenler, durum: t.durum, adim: t.adim, kuralAdi: t.kural?.ad ?? null,
      adimlar: adimlar.map((a) => ("kullaniciId" in a ? { kullanici: adlar.get(a.kullaniciId) ?? "Kullanıcı" } : { rol: a.rol })),
      kararlar: ((t.kararlar as unknown as Karar[]) ?? []).map((k) => ({ ...k, ad: adlar.get(k.userId) ?? "Kullanıcı" })),
      talepEden: t.talepEden.adSoyad, talepEdenId: t.talepEdenId, hata: t.hata, createdAt: t.createdAt, kararAt: t.kararAt,
    };
  }

  // ─── Kurallar (ONY-01, ONY-08) ─────────────────────────────────────────

  async kurallar() {
    const { tenantId } = aktifBaglam();
    const [kurallar, satinAlma, ayar, yoneticiSayisi] = await Promise.all([
      this.prisma.tenantIslem(tenantId, (tx) => tx.onayKurali.findMany({ orderBy: [{ islem: "asc" }, { createdAt: "asc" }] })),
      this.ayarlar.getir("satin_alma").catch(() => ({} as Record<string, unknown>)),
      this.ayarlar.getir(onayModulu),
      this.prisma.tenantIslem(tenantId, (tx) => tx.user.count({ where: { rol: "yonetici", aktif: true } })),
    ]);
    return {
      kurallar: kurallar.map((k) => ({ ...k, tutarEsigi: k.tutarEsigi?.toFixed(2) ?? null, iskontoEsigi: k.iskontoEsigi?.toFixed(2) ?? null })),
      islemler: Object.entries(ISLEM_ADLARI).map(([islem, ad]) => ({ islem, ad })),
      satinAlmaEsigi: satinAlma.onayEsigi ?? null,
      gorevAyriligiKapali: Boolean(ayar.gorevAyriligiKapali),
      tekYonetici: yoneticiSayisi === 1,
    };
  }

  async kuralKaydet(id: string | null, govde: unknown) {
    const { tenantId } = aktifBaglam();
    const g: KuralGirdisi = kuralSemasi.parse(govde);
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const kisiler = g.adimlar.filter((a): a is { kullaniciId: string } => "kullaniciId" in a).map((a) => a.kullaniciId);
      if (kisiler.length && (await tx.user.count({ where: { id: { in: kisiler }, aktif: true } })) !== new Set(kisiler).size) throw new BadRequestException("Adımdaki kullanıcı bulunamadı ya da etkin değil");
      const veri = { islem: g.islem, ad: g.ad, aktif: g.aktif, tutarEsigi: g.tutarEsigi ?? null, iskontoEsigi: g.iskontoEsigi ?? null, riskAsimi: g.riskAsimi, adimlar: g.adimlar as Prisma.InputJsonValue };
      const k = id ? await tx.onayKurali.update({ where: { id }, data: veri }) : await tx.onayKurali.create({ data: { tenantId, ...veri } });
      await this.iz(tx, id ? "onay_kurali_guncellendi" : "onay_kurali_eklendi", k.id, veri as Record<string, unknown>);
      return k;
    });
  }

  async kuralSil(id: string) {
    const { tenantId } = aktifBaglam();
    await this.prisma.tenantIslem(tenantId, async (tx) => {
      const k = await tx.onayKurali.findUnique({ where: { id } });
      if (!k) throw new NotFoundException("Kural bulunamadı");
      await tx.onayKurali.delete({ where: { id } });
      await this.iz(tx, "onay_kurali_silindi", id, { ad: k.ad, islem: k.islem });
    });
    return { silindi: true };
  }

  /** ONY-08: satın alma eşiği kural ekranından düzenlenir; değer SAT-03'ün ayarında kalır. */
  async satinAlmaEsigiKaydet(tutar: number) {
    if (!(tutar >= 0)) throw new BadRequestException("Geçerli bir tutar girin");
    const mevcut = await this.ayarlar.getir("satin_alma");
    await this.ayarlar.guncelle("satin_alma", { ...mevcut, onayEsigi: tutar });
    return { satinAlmaEsigi: tutar };
  }

  /** ONY-04: görev ayrılığı yalnız tek etkin yöneticili firmada kapatılabilir. */
  async gorevAyriligiKaydet(kapali: boolean) {
    const { tenantId } = aktifBaglam();
    if (kapali) {
      const sayi = await this.prisma.tenantIslem(tenantId, (tx) => tx.user.count({ where: { rol: "yonetici", aktif: true } }));
      if (sayi !== 1) throw new BadRequestException("Görev ayrılığı yalnız tek etkin yöneticisi olan firmada kapatılabilir");
    }
    await this.ayarlar.guncelle(onayModulu, { gorevAyriligiKapali: kapali });
    return { gorevAyriligiKapali: kapali };
  }

  private async gorevAyriligiKapaliMi(): Promise<boolean> {
    const { tenantId } = aktifBaglam();
    const ayar = await this.ayarlar.getir(onayModulu);
    if (!ayar.gorevAyriligiKapali) return false;
    // İkinci yönetici eklenince ayar kendiliğinden etkisiz kalır.
    return (await this.prisma.tenantIslem(tenantId, (tx) => tx.user.count({ where: { rol: "yonetici", aktif: true } }))) === 1;
  }

  // ─── Bildirim, hatırlatma, denetim izi (ONY-07, ONY-10) ────────────────

  private async onaycilaraBildir(id: string, islem: OnayIslemi, ozet: string, nedenler: string[], adim: OnayAdimi, adimNo: number, adimSayisi: number) {
    if (!this.bildirimler) return;
    const kime = "kullaniciId" in adim ? { roller: [] as Rol[], kullaniciIdler: [adim.kullaniciId] } : { roller: [adim.rol, "yonetici"] as Rol[] };
    await this.bildirimler.uret({
      tur: "onay", onem: "uyari",
      baslik: `Onayınız bekleniyor: ${ISLEM_ADLARI[islem]}${adimSayisi > 1 ? ` (adım ${adimNo + 1}/${adimSayisi})` : ""}`,
      aciklama: `${ozet}. Neden: ${nedenler.join("; ")}`.slice(0, 1000),
      birlesimAnahtari: `onay:${id}:${adimNo}`, kaynakTur: "onay_talebi", kaynakRef: id, hedefYol: `/panel/onaylar?talep=${id}`, ...kime,
    }).catch((e: unknown) => this.logger.warn(`Onay bildirimi üretilemedi: ${String(e)}`));
  }

  private async talepEdeneBildir(userId: string, id: string, baslik: string, aciklama: string, onem: "bilgi" | "uyari") {
    if (!this.bildirimler) return;
    await this.bildirimler.uret({ tur: "onay", onem, baslik, aciklama: aciklama.slice(0, 1000), birlesimAnahtari: `onay-sonuc:${id}`, kaynakTur: "onay_talebi", kaynakRef: id, hedefYol: `/panel/onaylar?talep=${id}`, roller: [], kullaniciIdler: [userId] })
      .catch((e: unknown) => this.logger.warn(`Onay sonucu bildirimi üretilemedi: ${String(e)}`));
  }

  private async bildirimleriKapat(id: string) {
    await this.bildirimler?.kapatEksikleri("onay", [], [`onay:${id}:`]).catch((e: unknown) => this.logger.warn(`Onay bildirimi kapatılamadı: ${String(e)}`));
  }

  /** ONY-07: 24 saati aşan bekleyen talepler için onaycılara günde bir hatırlatma (kiracı bağlamında çağrılır). */
  async hatirlatmalar(simdi = new Date()): Promise<number> {
    const { tenantId } = aktifBaglam();
    const esik = new Date(simdi.getTime() - HATIRLATMA_MS);
    const talepler = await this.prisma.tenantIslem(tenantId, (tx) => tx.onayTalebi.findMany({
      where: { durum: "bekliyor", createdAt: { lt: esik }, OR: [{ hatirlatildiAt: null }, { hatirlatildiAt: { lt: esik } }] },
      select: { id: true, islem: true, ozet: true, nedenler: true, adimlar: true, adim: true, createdAt: true },
      take: 100,
    }));
    for (const t of talepler) {
      const adimlar = t.adimlar as unknown as OnayAdimi[];
      const gun = Math.floor((simdi.getTime() - t.createdAt.getTime()) / 86_400_000);
      await this.onaycilaraBildir(t.id, t.islem as OnayIslemi, `${t.ozet} — ${gun} gündür bekliyor`, t.nedenler as string[], adimlar[t.adim], t.adim, adimlar.length);
      await this.prisma.tenantIslem(tenantId, (tx) => tx.onayTalebi.update({ where: { id: t.id }, data: { hatirlatildiAt: simdi } }));
    }
    return talepler.length;
  }

  private async iz(tx: Tx, islem: string, varlikId: string, detay: Record<string, unknown>) {
    const { tenantId, userId } = aktifBaglam();
    await tx.auditLog.create({ data: { tenantId, userId, islem, varlik: "onay_talebi", varlikId, detay: JSON.parse(JSON.stringify(detay)) as Prisma.InputJsonValue } });
  }
}

function kuralSatiri(k: { id: string; ad: string; tutarEsigi: Prisma.Decimal | null; iskontoEsigi: Prisma.Decimal | null; riskAsimi: boolean; adimlar: Prisma.JsonValue }): KuralSatiri {
  return { id: k.id, ad: k.ad, tutarEsigi: k.tutarEsigi === null ? null : Number(k.tutarEsigi), iskontoEsigi: k.iskontoEsigi === null ? null : Number(k.iskontoEsigi), riskAsimi: k.riskAsimi, adimlar: k.adimlar as unknown as OnayAdimi[] };
}
