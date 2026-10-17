import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { aktifBaglam } from "../core/istek-baglami";
import { PrismaService } from "../core/prisma.service";
import { tahsilatErisiminiDogrula } from "./tahsilat-erisim";
import { TAHSILAT_OTOMASYONU, tahsilatOtomasyonSemasi } from "./tahsilat-otomasyon-ayari";
import { odemeSozuKaynaklariniOku } from "./odeme-sozu-kaynak";
import { FATURA_ODEME_SECIMI, faturaOdemeDurumu } from "../fatura/odeme-durumu";
import { tahsilatBildirimiUret, TAHSILAT_BILDIRIM_KAYNAGI } from "./tahsilat-bildirimi";
import { gorusmeOlusturSemasi, takipGuncelleSemasi, takipKimligi, takipListeSemasi, takipOlusturSemasi } from "./tahsilat-takibi.semalar";
type Tx = Prisma.TransactionClient;
const iliskiler = { cari: { select: { id: true, unvan: true } }, sorumlu: { select: { id: true, adSoyad: true, aktif: true } } } as const;
type Takip = Prisma.TahsilatTakibiGetPayload<{ include: typeof iliskiler }>;
const aktif = (s: { durum: string }) => ["acik", "beklemede"].includes(s.durum);
const trGun = (d: Date) => d.toLocaleDateString("sv-SE", { timeZone: "Europe/Istanbul" });
const gorunum = (s: Takip) => ({ id: s.id, cari: s.cari, sorumlu: s.sorumlu, konu: s.konu, neden: s.neden, durum: s.durum, sonrakiIslemTarihi: s.sonrakiIslemTarihi?.toISOString().slice(0, 10) ?? null, sonrakiIslem: s.sonrakiIslem, sonIslemGerekcesi: s.sonIslemGerekcesi, surum: s.surum, createdAt: s.createdAt.toISOString(), updatedAt: s.updatedAt.toISOString() });
function ayristir<T>(sema: z.ZodType<T>, v: unknown): T {
  const sonuc = sema.safeParse(v); if (!sonuc.success) throw new BadRequestException(sonuc.error.issues.map((s) => s.message).join("; ")); return sonuc.data;
}
async function simdi(tx: Tx) { return (await tx.$queryRaw<{ zaman: Date }[]>`SELECT clock_timestamp() AS zaman`)[0].zaman; }

@Injectable()
export class TahsilatTakibiService {
  constructor(private readonly prisma: PrismaService) {}
  async listele(sorgu: unknown) {
    const g = ayristir(takipListeSemasi, sorgu), { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const kullanimModu = await tahsilatErisiminiDogrula(tx), zaman = await simdi(tx), bugun = trGun(zaman);
      if (g.cariId && !await tx.cariHesap.findFirst({ where: { tenantId, id: g.cariId }, select: { id: true } })) throw new NotFoundException("Cari bulunamadı");
      const where: Prisma.TahsilatTakibiWhereInput = {
        tenantId, ...(g.cariId ? { cariId: g.cariId } : {}), ...(g.sorumluUserId ? { sorumluUserId: g.sorumluUserId } : {}),
        ...(g.gorunum === "tum" ? {} : { durum: { in: ["acik", "beklemede"] }, ...(g.gorunum === "itiraz" ? { neden: "itiraz" } : { sonrakiIslemTarihi: { lte: new Date(bugun) } }) }),
      };
      if (g.imlec && !await tx.tahsilatTakibi.findFirst({ where: { ...where, id: g.imlec }, select: { id: true } })) throw new ConflictException("Liste veya imleç değişmiş; listeyi baştan yenileyin");
      const kayitlar = await tx.tahsilatTakibi.findMany({ where, include: iliskiler, orderBy: [{ sonrakiIslemTarihi: "asc" }, { id: "asc" }], take: 51, ...(g.imlec ? { cursor: { id: g.imlec }, skip: 1 } : {}) });
      return { kullanimModu, bugun, alindigiZaman: zaman.toISOString(), cariId: g.cariId ?? null, gorunum: g.gorunum, sorumluUserId: g.sorumluUserId ?? null, toplam: await tx.tahsilatTakibi.count({ where }), sonrakiImlec: kayitlar.length > 50 ? kayitlar[49].id : null, kayitlar: kayitlar.slice(0, 50).map(gorunum) };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }
  async sorumlular() {
    const { tenantId, userId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      await tahsilatErisiminiDogrula(tx);
      const kayitlar = await tx.user.findMany({ where: { tenantId, aktif: true, rol: { in: ["yonetici", "muhasebe"] } }, select: { id: true, adSoyad: true }, orderBy: [{ adSoyad: "asc" }, { id: "asc" }], take: 1001 });
      if (kayitlar.length > 1000) throw new BadRequestException("Sorumlu seçim sınırı aşıldı");
      return { kayitlar, varsayilanUserId: kayitlar.some((s) => s.id === userId) ? userId : null };
    });
  }
  async getir(takipId: string) {
    const id = ayristir(takipKimligi, takipId), { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const kullanimModu = await tahsilatErisiminiDogrula(tx); const s = await this.kaydiOku(tx, tenantId, id);
      const gorusmeler = await tx.tahsilatGorusmesi.findMany({ where: { tenantId, takipId: id }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 100, select: { id: true, kanal: true, gorusmeTarihi: true, not: true, createdAt: true } });
      const olaylar = await tx.auditLog.findMany({ where: { tenantId, varlik: "tahsilat_takibi", varlikId: id }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 100, select: { id: true, islem: true, detay: true, createdAt: true } });
      return { kullanimModu, kayit: gorunum(s), gorusmeSayisi: await tx.tahsilatGorusmesi.count({ where: { tenantId, takipId: id } }), olaySayisi: await tx.auditLog.count({ where: { tenantId, varlik: "tahsilat_takibi", varlikId: id } }),
        gorusmeler: gorusmeler.map((g) => ({ ...g, gorusmeTarihi: g.gorusmeTarihi.toISOString().slice(0, 10), createdAt: g.createdAt.toISOString() })),
        olaylar: olaylar.map((o) => ({ id: o.id, islem: o.islem, createdAt: o.createdAt.toISOString(), aciklama: (o.detay as { gerekce?: string } | null)?.gerekce ?? "" })),
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }
  async olustur(govde: unknown) {
    const g = ayristir(takipOlusturSemasi, govde), { tenantId, userId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      await tahsilatErisiminiDogrula(tx, true);
      const ozet = await this.tekrarKilitle(tx, tenantId, "takip", g.istekAnahtari, g);
      const mevcut = await tx.tahsilatTakibi.findUnique({ where: { tenantId_istekAnahtari: { tenantId, istekAnahtari: g.istekAnahtari } }, include: iliskiler });
      if (mevcut) { this.ozetDogrula(mevcut.girdiOzeti, ozet); return gorunum(mevcut); }
      await this.cariKilitle(tx, tenantId, g.cariId);
      if (await tx.tahsilatTakibi.findFirst({ where: { tenantId, cariId: g.cariId, durum: { in: ["acik", "beklemede"] } } })) throw new ConflictException("Carinin açık takibi var; mevcut takibi güncelleyin");
      await this.sorumluDogrula(tx, tenantId, g.sorumluUserId);
      const zaman = await simdi(tx); this.gunDogrula(g.sonrakiIslemTarihi, zaman);
      const s = await tx.tahsilatTakibi.create({ data: { ...g, sonrakiIslemTarihi: new Date(g.sonrakiIslemTarihi), tenantId, olusturanUserId: userId, girdiOzeti: ozet, createdAt: zaman, updatedAt: zaman }, include: iliskiler });
      await this.audit(tx, s, userId, "tahsilat_takibi_olusturuldu", g.konu, null); return gorunum(s);
    });
  }
  async guncelle(takipId: string, govde: unknown) {
    const id = ayristir(takipKimligi, takipId), g = ayristir(takipGuncelleSemasi, govde), { tenantId, userId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      await tahsilatErisiminiDogrula(tx, true); const eski = await this.kilitle(tx, tenantId, id); this.surumDogrula(eski, g.beklenenSurum);
      if (g.sorumluUserId !== eski.sorumluUserId) await this.sorumluDogrula(tx, tenantId, g.sorumluUserId);
      const zaman = await simdi(tx); if (g.sonrakiIslemTarihi) this.gunDogrula(g.sonrakiIslemTarihi, zaman);
      const { beklenenSurum: _, gerekce, ...alanlar } = g;
      const yeni = await tx.tahsilatTakibi.update({ where: { id }, data: { ...alanlar, sonrakiIslemTarihi: g.sonrakiIslemTarihi ? new Date(g.sonrakiIslemTarihi) : null, sonIslemGerekcesi: gerekce, surum: { increment: 1 }, updatedAt: zaman }, include: iliskiler });
      if (!aktif(yeni)) await tx.bildirim.updateMany({ where: { tenantId, kaynakTur: TAHSILAT_BILDIRIM_KAYNAGI, kaynakRef: id, kapandiAt: null }, data: { kapandiAt: zaman } });
      if (yeni.sorumluUserId !== eski.sorumluUserId) {
        // Önceki sorumlu artık bu görev bildiriminin alıcısı değildir.
        await tx.bildirimTeslimati.updateMany({ where: { tenantId, bildirim: { kaynakTur: TAHSILAT_BILDIRIM_KAYNAGI, kaynakRef: id }, userId: eski.sorumluUserId }, data: { durum: "yoksayildi", epostaDurumu: "kapali" } });
        const ayar = await tx.modulAyar.findUnique({ where: { tenantId_modul: { tenantId, modul: TAHSILAT_OTOMASYONU } }, select: { ayarlar: true } });
        const otomasyon = tahsilatOtomasyonSemasi.safeParse(ayar?.ayarlar ?? {});
        if (aktif(yeni) && otomasyon.success && otomasyon.data.uygulamaIciBildirim && await tx.bildirim.findFirst({ where: { tenantId, kaynakTur: TAHSILAT_BILDIRIM_KAYNAGI, kaynakRef: id }, select: { id: true } })) {
          await tahsilatBildirimiUret(tx, { tenantId, takipId: id, sorumluUserId: yeni.sorumluUserId, zaman });
        }
      }
      await this.audit(tx, yeni, userId, "tahsilat_takibi_guncellendi", gerekce, eski); return gorunum(yeni);
    });
  }
  async gorusmeEkle(takipId: string, govde: unknown) {
    const id = ayristir(takipKimligi, takipId), g = ayristir(gorusmeOlusturSemasi, govde), { tenantId, userId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      await tahsilatErisiminiDogrula(tx, true);
      const ozet = await this.tekrarKilitle(tx, tenantId, "gorusme", g.istekAnahtari, { id, ...g });
      const mevcut = await tx.tahsilatGorusmesi.findUnique({ where: { tenantId_istekAnahtari: { tenantId, istekAnahtari: g.istekAnahtari } } });
      if (mevcut) { this.ozetDogrula(mevcut.girdiOzeti, ozet); return { kayit: gorunum(await this.kaydiOku(tx, tenantId, id)), gorusmeId: mevcut.id }; }
      const eski = await this.kilitle(tx, tenantId, id); this.surumDogrula(eski, g.beklenenSurum);
      const zaman = await simdi(tx); if (g.gorusmeTarihi > trGun(zaman)) throw new BadRequestException("Görüşme günü gelecekte olamaz");
      const { beklenenSurum: _, ...alanlar } = g;
      const gorusme = await tx.tahsilatGorusmesi.create({ data: { ...alanlar, gorusmeTarihi: new Date(g.gorusmeTarihi), tenantId, takipId: id, userId, girdiOzeti: ozet, createdAt: zaman } });
      const yeni = await tx.tahsilatTakibi.update({ where: { id }, data: { surum: { increment: 1 }, updatedAt: zaman, sonIslemGerekcesi: "Görüşme kaydedildi" }, include: iliskiler });
      await this.audit(tx, yeni, userId, "tahsilat_gorusmesi_eklendi", g.not, eski); return { kayit: gorunum(yeni), gorusmeId: gorusme.id };
    });
  }
  /** Worker iç çağrısı. Her caride ayar, aktör, kaynak ve tekrar yeniden denetlenir. */
  async gecikenSozleriBagla(cariId: string) {
    const { tenantId, userId, rol } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      await tahsilatErisiminiDogrula(tx, true);
      const ayarlar = await tx.$queryRaw<{ ayarlar: unknown }[]>`SELECT ayarlar FROM modul_ayarlari WHERE tenant_id=${tenantId}::uuid AND modul=${TAHSILAT_OTOMASYONU} FOR SHARE`;
      const ayar = tahsilatOtomasyonSemasi.safeParse(ayarlar[0]?.ayarlar ?? {});
      if (!ayar.success || !ayar.data.acik || ayar.data.sorumluUserId !== userId) return { baglanan: 0, olusturulan: 0 };
      await this.cariKilitle(tx, tenantId, cariId);
      const users = await tx.$queryRaw<{ rol: string }[]>`SELECT rol FROM users WHERE id=${userId}::uuid AND tenant_id=${tenantId}::uuid AND aktif AND rol IN ('yonetici','muhasebe') FOR SHARE`;
      if (users[0]?.rol !== rol) throw new ConflictException("Otomatik takip sorumlusunun güncel yetkisi değişmiş");
      const kaynak = await odemeSozuKaynaklariniOku(tx, tenantId, cariId);
      const zaman = await simdi(tx), bugun = trGun(zaman);
      const adaylar = kaynak.sozler.filter((s) => s.kayitDurumu === "aktif" && s.sozTarihi < bugun && s.gerceklesme?.durum === "gecikti");
      const baglar = await tx.tahsilatSozBaglantisi.findMany({ where: { tenantId, sozId: { in: adaylar.map((s) => s.id) } }, select: { sozId: true } });
      const bagli = new Set(baglar.map((b) => b.sozId));
      const faturalar = await tx.fatura.findMany({ where: { tenantId, cariId, id: { in: adaylar.map((s) => s.faturaId) }, durum: "kesin", tip: "satis" }, select: { id: true, durum: true, genelToplam: true, ...FATURA_ODEME_SECIMI } });
      const kalanlar = new Map(faturalar.map((f) => [f.id, new Prisma.Decimal(faturaOdemeDurumu(f).kalan)]));
      let takip = await tx.tahsilatTakibi.findFirst({ where: { tenantId, cariId, durum: { in: ["acik", "beklemede"] } }, include: iliskiler });
      let baglanan = 0, olusturulan = 0;
      for (const soz of adaylar) {
        if (bagli.has(soz.id)) continue;
        const kalan = Prisma.Decimal.min(kalanlar.get(soz.faturaId) ?? 0, soz.gerceklesme!.kalan);
        if (!kalan.gt(0)) continue;
        const gerekce = `Geciken ödeme sözü ${soz.id}: ${kalan.toFixed(2)} ${soz.dovizCinsi} kalan; söz günü ${soz.sozTarihi}`;
        const eski = takip;
        if (!takip) {
          const istekAnahtari = randomUUID();
          takip = await tx.tahsilatTakibi.create({ data: {
            tenantId, cariId, sorumluUserId: userId, olusturanUserId: userId, konu: "Geciken ödeme sözü takibi", neden: "tahsilat",
            sonrakiIslemTarihi: new Date(bugun), sonrakiIslem: "Geciken ödeme sözünü incele", istekAnahtari,
            girdiOzeti: createHash("sha256").update(`geciken-soz:${soz.id}`).digest("hex"), createdAt: zaman, updatedAt: zaman,
          }, include: iliskiler });
          await this.audit(tx, takip, userId, "tahsilat_takibi_olusturuldu", gerekce, null);
          olusturulan++;
        } else {
          takip = await tx.tahsilatTakibi.update({ where: { id: takip.id }, data: { surum: { increment: 1 }, updatedAt: zaman }, include: iliskiler });
        }
        await tx.tahsilatSozBaglantisi.create({ data: { tenantId, sozId: soz.id, takipId: takip.id, userId, kalan, createdAt: zaman } });
        await tx.auditLog.create({ data: { tenantId, userId, islem: "geciken_soz_takibe_baglandi", varlik: "tahsilat_takibi", varlikId: takip.id, createdAt: zaman,
          detay: { gerekce, sozId: soz.id, faturaId: soz.faturaId, kalan: kalan.toFixed(2), dovizCinsi: soz.dovizCinsi, onceki: eski ? gorunum(eski) : null, sonraki: gorunum(takip) } } });
        if (ayar.data.uygulamaIciBildirim) await tahsilatBildirimiUret(tx, { tenantId, takipId: takip.id, sorumluUserId: takip.sorumluUserId, zaman });
        baglanan++;
      }
      return { baglanan, olusturulan };
    }, { timeout: 15000 });
  }
  private async kaydiOku(tx: Tx, tenantId: string, id: string) {
    const s = await tx.tahsilatTakibi.findFirst({ where: { tenantId, id }, include: iliskiler });
    if (!s) throw new NotFoundException("Tahsilat takibi bulunamadı"); return s;
  }
  private async cariKilitle(tx: Tx, tenantId: string, cariId: string) {
    if (!(await tx.$queryRaw<{ id: string }[]>`SELECT id FROM cari_hesaplar WHERE tenant_id=${tenantId}::uuid AND id=${cariId}::uuid FOR UPDATE`).length) throw new NotFoundException("Cari bulunamadı");
  }
  private async kilitle(tx: Tx, tenantId: string, id: string) { const s = await this.kaydiOku(tx, tenantId, id); await this.cariKilitle(tx, tenantId, s.cariId); return this.kaydiOku(tx, tenantId, id); }
  private surumDogrula(s: Takip, surum: number) { if (!aktif(s) || s.surum !== surum) throw new ConflictException("Takip değişmiş veya kapanmış; güncel kaydı okuyun"); }
  private gunDogrula(gun: string, zaman: Date) { if (gun < trGun(zaman)) throw new BadRequestException("Sonraki işlem günü geçmişte olamaz"); }
  private async sorumluDogrula(tx: Tx, tenantId: string, userId: string) {
    if (!(await tx.$queryRaw<{ id: string }[]>`SELECT id FROM users WHERE id=${userId}::uuid AND tenant_id=${tenantId}::uuid AND aktif AND rol IN ('yonetici','muhasebe') FOR SHARE`).length) throw new BadRequestException("Sorumlu, şirketin aktif yönetici veya muhasebe kullanıcısı olmalı");
  }
  private async tekrarKilitle(tx: Tx, tenantId: string, tur: string, anahtar: string, icerik: unknown) {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${tenantId + ":" + tur + ":" + anahtar}, 0))::text`;
    return createHash("sha256").update(JSON.stringify(icerik)).digest("hex");
  }
  private ozetDogrula(eski: string, yeni: string) { if (eski !== yeni) throw new ConflictException("İstek anahtarı farklı içerikle kullanılmış"); }
  private async audit(tx: Tx, yeni: Takip, userId: string, islem: string, gerekce: string, eski: Takip | null) {
    await tx.auditLog.create({ data: { tenantId: yeni.tenantId, userId, islem, varlik: "tahsilat_takibi", varlikId: yeni.id, createdAt: yeni.updatedAt, detay: { gerekce, onceki: eski ? gorunum(eski) : null, sonraki: gorunum(yeni) } } });
  }
}
