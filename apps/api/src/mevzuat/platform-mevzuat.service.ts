import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { MevzuatDegisiklikDurum, MevzuatTalepDurumu, Prisma } from "@prisma/client";
import { bugunTR, DONEMSEL_DEGERLER, MEVZUAT_TUR_TANIMLARI, mevzuatDegerHatalari, mevzuatTuruMu, yayinTakvimi } from "@tekirextra/shared";
import { aktifPlatformBaglam } from "../core/istek-baglami";
import { MevzuatService } from "./mevzuat.service";
import { PlatformPrismaService } from "./platform-prisma.service";
import { kabulCalistir, type KabulSenaryosuGirdisi } from "./bordro-kabul";
import { yayinPlani, yururluktedir, type PlanKaydi, type PlanSatiri } from "./yayin-plani";

const gun = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
/** Bu olayları kaydeden kişi değişikliğin hazırlayanlarındandır; yayınlayamaz (dört göz). */
const DUZENLEME_OLAYLARI = ["olusturuldu", "guncellendi", "satirlar_guncellendi", "kabul_senaryolari_guncellendi", "onaya_gonderildi"];
/** MVZ-14: kabul senaryosu isteyen satır (bordro parametresi eklenir ya da değişir). */
const kabulGerekir = (s: { tur: string; islem: string }) => s.tur === "bordro_parametreleri" && s.islem !== "kaldir";

export interface DegisiklikGirdisi { baslik: string; dayanak: string; aciklama?: string | null; yururlukBaslangic: string }
export interface SatirGirdisi { tur: string; anahtar: string; islem: "ekle" | "degistir" | "kaldir"; deger?: unknown }

/**
 * Mevzuat Merkezi platform işlemleri (MVZ-04…08). Yalnız `tekir_platform`
 * bağlantısını kullanır. Akış: taslak → onay bekliyor → yayınlandı; geri
 * çevrilen değişiklik gerekçesiyle taslağa döner. Yayınlanan değişiklik
 * veritabanı tetikleyicisiyle de değiştirilemez.
 */
@Injectable()
export class PlatformMevzuatService {
  constructor(
    private readonly platform: PlatformPrismaService,
    private readonly okuyucu: MevzuatService,
  ) {}

  private get db() {
    return this.platform.db;
  }

  private async olay(tx: Prisma.TransactionClient, degisiklikId: string | null, olay: string, detay?: Prisma.InputJsonValue) {
    await tx.mevzuatOlay.create({ data: { degisiklikId, kullaniciId: aktifPlatformBaglam().kullaniciId, olay, detay } });
  }

  async listele(durum?: MevzuatDegisiklikDurum) {
    const liste = await this.db.mevzuatDegisiklik.findMany({
      where: durum ? { durum } : undefined,
      orderBy: [{ no: "desc" }],
      take: 200,
      include: { hazirlayan: { select: { adSoyad: true } }, yayinlayan: { select: { adSoyad: true } }, _count: { select: { satirlar: true } } },
    });
    return liste.map(({ _count, ...d }) => ({ ...d, yururlukBaslangic: gun(d.yururlukBaslangic), satirSayisi: _count.satirlar }));
  }

  /** Değişiklik + satırlar + her satırın şu an yürürlükteki değeri + olaylar + kullanıcının yapabilecekleri. */
  async getir(id: string) {
    const d = await this.db.mevzuatDegisiklik.findUnique({
      where: { id },
      include: {
        satirlar: { orderBy: { sira: "asc" } },
        hazirlayan: { select: { adSoyad: true, eposta: true } },
        yayinlayan: { select: { adSoyad: true, eposta: true } },
        olaylar: { orderBy: { zaman: "asc" } },
        kabulSenaryolari: { orderBy: { sira: "asc" } },
      },
    });
    if (!d) throw new NotFoundException("Mevzuat değişikliği bulunamadı");
    const yururluk = gun(d.yururlukBaslangic)!;
    const mevcut = await this.planKayitlari(this.db, d.satirlar);
    const kullanicilar = new Map((await this.db.platformKullanici.findMany({
      where: { id: { in: [...new Set(d.olaylar.map((o) => o.kullaniciId).filter((x): x is string => Boolean(x)))] } },
      select: { id: true, adSoyad: true },
    })).map((k) => [k.id, k.adSoyad]));
    const { kullaniciId } = aktifPlatformBaglam();
    const duzenleyen = this.duzenleyenler(d);
    const plan = d.durum === "yayinlandi" ? null : yayinPlani(mevcut, d.satirlar.map(satirPlani), yururluk);
    const etki = d.durum === "yayinlandi" ? null : await this.etki(d.satirlar, yururluk);

    return {
      ...d,
      yururlukBaslangic: yururluk,
      satirlar: d.satirlar.map((s) => {
        // Yayınlanmamışta karşılaştırma için yürürlükten önceki son değer.
        const onceki = mevcut.filter((k) => k.tur === s.tur && k.anahtar === s.anahtar && k.yururlukBaslangic < yururluk)
          .sort((a, b) => b.yururlukBaslangic.localeCompare(a.yururlukBaslangic))[0];
        return { ...s, oncekiDeger: onceki ? (onceki as PlanKaydi & { deger: unknown }).deger : null, oncekiYururluk: onceki?.yururlukBaslangic ?? null };
      }),
      olaylar: d.olaylar.map((o) => ({ ...o, kullanici: o.kullaniciId ? kullanicilar.get(o.kullaniciId) ?? null : null })),
      planHatalari: plan?.hatalar ?? [],
      etki,
      kabulGerekli: d.satirlar.some(kabulGerekir),
      izinler: {
        duzenle: d.durum === "taslak",
        onayaGonder: d.durum === "taslak",
        taslagaCek: d.durum === "onay_bekliyor" && duzenleyen.has(kullaniciId),
        yayinla: d.durum === "onay_bekliyor" && !duzenleyen.has(kullaniciId),
        geriCevir: d.durum === "onay_bekliyor" && !duzenleyen.has(kullaniciId),
      },
    };
  }

  async olustur(girdi: DegisiklikGirdisi) {
    const { kullaniciId } = aktifPlatformBaglam();
    return this.db.$transaction(async (tx) => {
      const d = await tx.mevzuatDegisiklik.create({
        data: { baslik: girdi.baslik.trim(), dayanak: girdi.dayanak.trim(), aciklama: girdi.aciklama?.trim() || null, yururlukBaslangic: new Date(girdi.yururlukBaslangic), hazirlayanId: kullaniciId },
      });
      await this.olay(tx, d.id, "olusturuldu", { baslik: d.baslik, dayanak: d.dayanak, yururlukBaslangic: girdi.yururlukBaslangic });
      return { id: d.id, no: d.no };
    });
  }

  async guncelle(id: string, girdi: DegisiklikGirdisi) {
    await this.db.$transaction(async (tx) => {
      await this.taslakOlmali(tx, id);
      await tx.mevzuatDegisiklik.update({
        where: { id },
        data: { baslik: girdi.baslik.trim(), dayanak: girdi.dayanak.trim(), aciklama: girdi.aciklama?.trim() || null, yururlukBaslangic: new Date(girdi.yururlukBaslangic) },
      });
      await this.olay(tx, id, "guncellendi", { baslik: girdi.baslik, dayanak: girdi.dayanak, yururlukBaslangic: girdi.yururlukBaslangic });
    });
  }

  async sil(id: string) {
    await this.db.$transaction(async (tx) => {
      const d = await this.taslakOlmali(tx, id);
      await this.olay(tx, id, "silindi", { no: d.no, baslik: d.baslik });
      await tx.mevzuatDegisiklik.delete({ where: { id } });
    });
  }

  /** Satır listesinin tamamı yazılır; değerler türün kuralıyla denetlenir. */
  async satirlariYaz(id: string, satirlar: SatirGirdisi[]) {
    const hatalar: string[] = [];
    satirlar.forEach((s, i) => {
      if (!mevzuatTuruMu(s.tur)) hatalar.push(`${i + 1}. satır: tanımsız tür ${s.tur}`);
      else if (s.islem !== "kaldir") for (const h of mevzuatDegerHatalari(s.tur, s.anahtar, s.deger)) hatalar.push(`${i + 1}. satır (${s.anahtar}): ${h}`);
    });
    const anahtarlar = satirlar.map((s) => `${s.tur}/${s.anahtar}`);
    if (new Set(anahtarlar).size !== anahtarlar.length) hatalar.push("Aynı kalem birden çok kez girilmiş");
    if (hatalar.length) throw new BadRequestException(hatalar.join("; "));

    await this.db.$transaction(async (tx) => {
      await this.taslakOlmali(tx, id);
      await tx.mevzuatDegisiklikSatiri.deleteMany({ where: { degisiklikId: id } });
      await tx.mevzuatDegisiklikSatiri.createMany({
        data: satirlar.map((s, i) => ({
          degisiklikId: id, sira: i + 1, tur: s.tur, anahtar: s.anahtar.trim(), islem: s.islem,
          deger: s.islem === "kaldir" ? undefined : (s.deger as Prisma.InputJsonValue),
        })),
      });
      await this.olay(tx, id, "satirlar_guncellendi", { satirlar: satirlar.map((s) => ({ tur: s.tur, anahtar: s.anahtar, islem: s.islem, deger: s.deger ?? null })) as Prisma.InputJsonValue });
    });
  }

  async onayaGonder(id: string) {
    await this.db.$transaction(async (tx) => {
      const d = await this.taslakOlmali(tx, id);
      const satirlar = await tx.mevzuatDegisiklikSatiri.findMany({ where: { degisiklikId: id }, orderBy: { sira: "asc" } });
      const plan = yayinPlani(await this.planKayitlari(tx, satirlar), satirlar.map(satirPlani), gun(d.yururlukBaslangic)!);
      if (plan.hatalar.length) throw new BadRequestException(plan.hatalar.join("; "));
      await this.kabulKapisi(tx, id, satirlar);
      await this.durumGecisi(tx, id, "taslak", { durum: "onay_bekliyor", onayaGonderimZamani: new Date(), retGerekcesi: null });
      await this.olay(tx, id, "onaya_gonderildi");
    });
  }

  /** Hazırlayan, onay bekleyen değişikliği düzeltmek için geri çeker. */
  async taslagaCek(id: string) {
    await this.db.$transaction(async (tx) => {
      const d = await this.onayBekleyenOlmali(tx, id);
      if (!this.duzenleyenler(d).has(aktifPlatformBaglam().kullaniciId)) throw new ForbiddenException("Yalnız hazırlayanlar taslağa çekebilir; siz geri çevirebilirsiniz");
      await this.durumGecisi(tx, id, "onay_bekliyor", { durum: "taslak", onayaGonderimZamani: null });
      await this.olay(tx, id, "taslaga_cekildi");
    });
  }

  async geriCevir(id: string, gerekce: string) {
    await this.db.$transaction(async (tx) => {
      const d = await this.onayBekleyenOlmali(tx, id);
      this.dortGoz(d);
      await this.durumGecisi(tx, id, "onay_bekliyor", { durum: "taslak", onayaGonderimZamani: null, retGerekcesi: gerekce.trim() });
      await this.olay(tx, id, "geri_cevrildi", { gerekce: gerekce.trim() });
    });
  }

  /**
   * Dört göz: değişikliği hazırlayan ya da düzenleyen kişi yayınlayamaz. Plan
   * yayın anındaki kayıtlarla yeniden kurulur (onaydan sonra başka bir
   * değişiklik yayınlanmış olabilir).
   */
  async yayinla(id: string) {
    const { kullaniciId } = aktifPlatformBaglam();
    return this.db.$transaction(async (tx) => {
      // Aynı anda iki yayını sıraya sokar: kayıt planı tutarlı kalır.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('mevzuat_yayin'))`;
      const d = await this.onayBekleyenOlmali(tx, id);
      this.dortGoz(d);
      const satirlar = await tx.mevzuatDegisiklikSatiri.findMany({ where: { degisiklikId: id }, orderBy: { sira: "asc" } });
      const yururluk = gun(d.yururlukBaslangic)!;
      const plan = yayinPlani(await this.planKayitlari(tx, satirlar), satirlar.map(satirPlani), yururluk);
      if (plan.hatalar.length) throw new BadRequestException(`Yayınlanamadı: ${plan.hatalar.join("; ")}`);
      // MVZ-14: bordro parametresinin kabul senaryoları yayın anında yeniden çalıştırılır.
      await this.kabulKapisi(tx, id, satirlar);

      for (const k of plan.kapat) await tx.mevzuatKayit.update({ where: { id: k.id }, data: { yururlukBitis: new Date(k.yururlukBitis) } });
      if (plan.ekle.length) {
        await tx.mevzuatKayit.createMany({
          data: plan.ekle.map((e) => ({ tur: e.tur, anahtar: e.anahtar, deger: e.deger as Prisma.InputJsonValue, yururlukBaslangic: new Date(e.yururlukBaslangic), degisiklikId: id })),
        });
      }
      // Olay, durum yayınlandı olmadan önce yazılır: sonrasında değişiklik satırı kilitlenir.
      await this.olay(tx, id, "yayinlandi", { kapatilan: plan.kapat.length, eklenen: plan.ekle.length });
      await this.durumGecisi(tx, id, "onay_bekliyor", { durum: "yayinlandi", yayinlayanId: kullaniciId, yayinZamani: new Date() });
      return { kapatilan: plan.kapat.length, eklenen: plan.ekle.length };
    }).finally(() => this.okuyucu.onbellekTemizle());
  }

  /** MVZ-14: kabul senaryolarının tamamı yazılır (yalnız taslakta). */
  async kabulSenaryolariYaz(id: string, senaryolar: KabulSenaryosuGirdisi[]) {
    await this.db.$transaction(async (tx) => {
      await this.taslakOlmali(tx, id);
      await tx.mevzuatKabulSenaryosu.deleteMany({ where: { degisiklikId: id } });
      await tx.mevzuatKabulSenaryosu.createMany({
        data: senaryolar.map((s, i) => ({ degisiklikId: id, sira: i + 1, ad: s.ad, girdiler: s.girdiler as Prisma.InputJsonValue, beklenen: s.beklenen as Prisma.InputJsonValue, tolerans: s.tolerans })),
      });
      await this.olay(tx, id, "kabul_senaryolari_guncellendi", { senaryolar: senaryolar as unknown as Prisma.InputJsonValue });
    });
  }

  /** Senaryoları değişiklikteki bordro değeriyle çalıştırıp sonucu saklar (yayınlanana kadar). */
  async kabulSenaryolariCalistir(id: string) {
    await this.db.$transaction(async (tx) => {
      const d = await tx.mevzuatDegisiklik.findUnique({ where: { id }, select: { durum: true } });
      if (!d) throw new NotFoundException("Mevzuat değişikliği bulunamadı");
      if (d.durum === "yayinlandi") throw new ConflictException("Yayınlanan değişikliğin senaryoları yeniden çalıştırılmaz");
      const satirlar = await tx.mevzuatDegisiklikSatiri.findMany({ where: { degisiklikId: id } });
      await this.kabulSonuclari(tx, id, satirlar);
    });
  }

  /**
   * Bordro parametresi eklenen/değişen değişiklikte en az bir senaryo olmalı ve
   * hepsi tutmalıdır; aksi hâlde onaya gönderilemez ve yayınlanamaz.
   */
  private async kabulKapisi(tx: Prisma.TransactionClient, id: string, satirlar: { tur: string; islem: string; deger: unknown }[]) {
    if (!satirlar.some(kabulGerekir)) return;
    const sonuclar = await this.kabulSonuclari(tx, id, satirlar);
    if (!sonuclar.length) throw new BadRequestException("Bordro parametresi değişikliğinde en az bir kabul senaryosu bulunmalıdır (ör. asgari ücretin resmî neti)");
    const tutmayan = sonuclar.filter((s) => !s.basarili).map((s) => s.ad);
    if (tutmayan.length) throw new BadRequestException(`Kabul senaryosu tutmadı: ${tutmayan.join(", ")}`);
  }

  private async kabulSonuclari(tx: Prisma.TransactionClient, id: string, satirlar: { tur: string; islem: string; deger: unknown }[]) {
    const satir = satirlar.find(kabulGerekir);
    const senaryolar = await tx.mevzuatKabulSenaryosu.findMany({ where: { degisiklikId: id }, orderBy: { sira: "asc" } });
    if (!satir) return [];
    const { kullaniciId } = aktifPlatformBaglam();
    const zaman = new Date();
    const sonuclar: { ad: string; basarili: boolean }[] = [];
    for (const s of senaryolar) {
      let sonuc;
      try { sonuc = kabulCalistir(satir.deger, s); } catch (e) { sonuc = { basarili: false, alanlar: {}, hata: e instanceof Error ? e.message : String(e) }; }
      await tx.mevzuatKabulSenaryosu.update({ where: { id: s.id }, data: { sonSonuc: sonuc as unknown as Prisma.InputJsonValue, basarili: sonuc.basarili, sonCalistiranId: kullaniciId, sonCalismaZamani: zaman } });
      sonuclar.push({ ad: s.ad, basarili: sonuc.basarili });
    }
    return sonuclar;
  }

  /** Bir türün belirli tarihte yürürlükteki kayıtları (ya da bir anahtarın tüm geçmişi). */
  async kayitlar(tur: string, tarih?: string, anahtar?: string) {
    const kayitlar = await this.db.mevzuatKayit.findMany({
      where: { tur, ...(anahtar ? { anahtar } : {}) },
      orderBy: [{ anahtar: "asc" }, { yururlukBaslangic: "asc" }],
      include: { degisiklik: { select: { no: true, baslik: true, dayanak: true } } },
    });
    const liste = kayitlar.map((k) => ({ ...k, yururlukBaslangic: gun(k.yururlukBaslangic)!, yururlukBitis: gun(k.yururlukBitis) }));
    return anahtar || !tarih ? liste : liste.filter((k) => yururluktedir(k, tarih));
  }

  async olaylar(sayfa = 1) {
    const take = 100;
    const olaylar = await this.db.mevzuatOlay.findMany({ orderBy: { zaman: "desc" }, skip: (Math.max(1, sayfa) - 1) * take, take, include: { degisiklik: { select: { no: true, baslik: true } } } });
    const kullanicilar = new Map((await this.db.platformKullanici.findMany({ select: { id: true, adSoyad: true } })).map((k) => [k.id, k.adSoyad]));
    return olaylar.map((o) => ({ ...o, kullanici: o.kullaniciId ? kullanicilar.get(o.kullaniciId) ?? null : null }));
  }

  async talepler(durum?: MevzuatTalepDurumu) {
    return this.db.mevzuatTalep.findMany({ where: durum ? { durum } : undefined, orderBy: [{ createdAt: "desc" }], take: 300 });
  }

  async talepGuncelle(id: string, durum: MevzuatTalepDurumu, cozumNotu?: string | null) {
    await this.db.$transaction(async (tx) => {
      const sonuc = await tx.mevzuatTalep.updateMany({ where: { id }, data: { durum, cozumNotu: cozumNotu?.trim() || null } });
      if (!sonuc.count) throw new NotFoundException("Talep bulunamadı");
      await this.olay(tx, null, "talep_guncellendi", { talepId: id, durum, cozumNotu: cozumNotu ?? null });
    });
  }

  /**
   * MVZ-06: değişikliğin etkileyeceği taslak belgeler — yalnız toplam sayı
   * (kiracı adı ya da belge bilgisi yok). Platform rolü kiracı tablolarını
   * okuyamadığı için şema sahibinin tanımladığı toplam fonksiyonu kullanılır.
   * Eklenen kod mevcut taslağı etkilemez; değişen ve kaldırılan kodlar sayılır.
   */
  private async etki(satirlar: { tur: string; anahtar: string; islem: string }[], yururluk: string) {
    const turler = [...new Set(satirlar.filter((s) => s.islem !== "ekle" && s.tur !== "kanuni_deger" && s.tur !== "bordro_parametreleri").map((s) => s.tur))];
    const kalemler: { ad: string; taslakFatura: number; taslakBelge: number; taslakBordro: number; firma: number }[] = [];
    for (const tur of turler) {
      const anahtarlar = satirlar.filter((s) => s.tur === tur && s.islem !== "ekle").map((s) => s.anahtar);
      const [r] = await this.db.$queryRaw<{ taslak_fatura: bigint; taslak_belge: bigint; firma: bigint }[]>`SELECT * FROM mevzuat_etki(${tur}, ${anahtarlar}::text[], ${yururluk}::date)`;
      const ad = mevzuatTuruMu(tur) ? MEVZUAT_TUR_TANIMLARI[tur].ad : tur;
      kalemler.push({ ad: `${ad} (${anahtarlar.join(", ")})`, taslakFatura: Number(r?.taslak_fatura ?? 0), taslakBelge: Number(r?.taslak_belge ?? 0), taslakBordro: 0, firma: Number(r?.firma ?? 0) });
    }
    // MVZ-14: eklenen yıl da (yürürlükten sonraki) onaylanmamış bordroları etkiler.
    if (satirlar.some((s) => s.tur === "bordro_parametreleri")) {
      const [r] = await this.db.$queryRaw<{ taslak_bordro: bigint; firma: bigint }[]>`SELECT * FROM mevzuat_etki_bordro(${yururluk}::date)`;
      kalemler.push({ ad: MEVZUAT_TUR_TANIMLARI.bordro_parametreleri.ad, taslakFatura: 0, taslakBelge: 0, taslakBordro: Number(r?.taslak_bordro ?? 0), firma: Number(r?.firma ?? 0) });
    }
    // Kanuni süre/eşikler belge satırında saklanmaz; sayılacak taslak yoktur, yeni değer sonraki hesaplarda kullanılır.
    const hesaplanmayan = [...new Set(satirlar.filter((s) => s.tur === "kanuni_deger").map((s) => s.tur))];
    return { kalemler, hesaplanmayan };
  }

  // ─── yardımcılar ────────────────────────────────────────────────────────

  private async planKayitlari(tx: Pick<Prisma.TransactionClient, "mevzuatKayit">, satirlar: { tur: string; anahtar: string }[]) {
    if (!satirlar.length) return [] as (PlanKaydi & { deger: unknown })[];
    const kayitlar = await tx.mevzuatKayit.findMany({
      where: { OR: satirlar.map((s) => ({ tur: s.tur, anahtar: s.anahtar })) },
    });
    return kayitlar.map((k) => ({ id: k.id, tur: k.tur, anahtar: k.anahtar, deger: k.deger, yururlukBaslangic: gun(k.yururlukBaslangic)!, yururlukBitis: gun(k.yururlukBitis) }));
  }

  private duzenleyenler(d: { hazirlayanId: string; olaylar: { kullaniciId: string | null; olay: string }[] }): Set<string> {
    return new Set([d.hazirlayanId, ...d.olaylar.filter((o) => DUZENLEME_OLAYLARI.includes(o.olay) && o.kullaniciId).map((o) => o.kullaniciId!)]);
  }

  private dortGoz(d: { hazirlayanId: string; olaylar: { kullaniciId: string | null; olay: string }[] }) {
    if (this.duzenleyenler(d).has(aktifPlatformBaglam().kullaniciId)) {
      throw new ForbiddenException("Dört göz ilkesi: değişikliği hazırlayan ya da düzenleyen kişi yayınlayamaz ve geri çeviremez");
    }
  }

  private async taslakOlmali(tx: Prisma.TransactionClient, id: string) {
    const d = await tx.mevzuatDegisiklik.findUnique({ where: { id } });
    if (!d) throw new NotFoundException("Mevzuat değişikliği bulunamadı");
    if (d.durum !== "taslak") throw new ConflictException(d.durum === "yayinlandi" ? "Yayınlanan değişiklik değiştirilemez" : "Onay bekleyen değişiklik düzenlenemez; önce taslağa çekin");
    return d;
  }

  private async onayBekleyenOlmali(tx: Prisma.TransactionClient, id: string) {
    const d = await tx.mevzuatDegisiklik.findUnique({ where: { id }, include: { olaylar: { select: { kullaniciId: true, olay: true } } } });
    if (!d) throw new NotFoundException("Mevzuat değişikliği bulunamadı");
    if (d.durum !== "onay_bekliyor") throw new ConflictException("Değişiklik onay beklemiyor");
    return d;
  }

  /** Eşzamanlı iki işlemden yalnız biri durumu değiştirir. */
  private async durumGecisi(tx: Prisma.TransactionClient, id: string, beklenen: MevzuatDegisiklikDurum, data: Prisma.MevzuatDegisiklikUpdateManyMutationInput & { yayinlayanId?: string }) {
    const sonuc = await tx.mevzuatDegisiklik.updateMany({ where: { id, durum: beklenen }, data });
    if (!sonuc.count) throw new ConflictException("Değişikliğin durumu bu arada değişti; sayfayı yenileyin");
  }

  /** MVZ-17: içinde bulunulan ve sıradaki dönemde dönemsel değerlerin yayın durumu. */
  async yayinTakvimi() {
    const kayitlar = await this.db.mevzuatKayit.findMany({
      where: { OR: DONEMSEL_DEGERLER.map((d) => ({ tur: d.tur, anahtar: d.anahtar })) },
      select: { tur: true, anahtar: true, yururlukBaslangic: true },
    });
    return yayinTakvimi(kayitlar.map((k) => ({ ...k, yururlukBaslangic: k.yururlukBaslangic.toISOString().slice(0, 10) })), bugunTR());
  }
}

function satirPlani(s: { tur: string; anahtar: string; islem: "ekle" | "degistir" | "kaldir"; deger: unknown }): PlanSatiri {
  return { tur: s.tur, anahtar: s.anahtar, islem: s.islem, deger: s.deger };
}
