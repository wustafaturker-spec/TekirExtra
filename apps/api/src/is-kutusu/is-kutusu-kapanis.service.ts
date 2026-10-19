import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { belgeNoMetni } from "@tekirextra/shared";
import { AiOnayService } from "../ai/onay/ai-onay.service";
import { HafizaService } from "../ai/hafiza/hafiza.service";
import { BelgelerService } from "../belgeler/belgeler.service";
import { aktifBaglam } from "../core/istek-baglami";
import { PrismaService } from "../core/prisma.service";
import {
  KAPATILAN_GUN, NEDEN_ADI, epostaGeriDonus, epostaKutudaMi, kapanisMetni,
  type EpostaOncesi, type KapanisNedeni, type KapanisTuru, type KapatGirdisi,
} from "./is-kutusu.kurallari";
import type { Kapsam } from "./is-kutusu.service";

type Tx = Prisma.TransactionClient;
const ADAY_SINIRI = 10;

/**
 * AI-66…70: iş kutusundan kaldırma ve geri alma. Kaldırma kaydın kendi durumunu
 * değiştirir (e-posta işlemi `kapatildi`/`teklif_degil`, takip `kapandi`, onay
 * `reddedildi`); `is_kutusu_kapanislari` geçmişi ve geri dönüş bilgisini tutar.
 */
@Injectable()
export class IsKutusuKapanisService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly belgeler: BelgelerService,
    private readonly onaylar: AiOnayService,
    private readonly hafiza: HafizaService,
  ) {}

  /** Kendi kaydı ya da yönetici (AI-70). */
  private sahipMi(sahipUserId: string | null) {
    const { userId, rol } = aktifBaglam();
    if (rol !== "yonetici" && sahipUserId !== userId) throw new ForbiddenException("Bu kaydı yalnız sahibi ya da yönetici kaldırabilir");
  }

  async kapat(g: KapatGirdisi) {
    if (g.tur === "eposta") return this.epostaKapat(g);
    if (g.tur === "yanit") return this.yanitKapat(g.id, g.neden, g.not ?? null);
    return this.onayKapat(g.id, g.neden, g.not ?? null);
  }

  private async epostaKapat(g: KapatGirdisi) {
    const { tenantId, userId } = aktifBaglam();
    const not = g.not || null;
    const { islem, taslak, bagli } = await this.prisma.tenantIslem(tenantId, async (tx) => {
      const islem = await tx.epostaTeklifIslemi.findFirst({
        where: { id: g.id, tenantId },
        select: { id: true, durum: true, belgeId: true, cariId: true, uyarilar: true, calistiranUserId: true, gelenEposta: { select: { id: true, konu: true, icerikMetin: true } } },
      });
      const taslak = islem?.belgeId ? await tx.belge.findFirst({ where: { id: islem.belgeId, tenantId }, select: { id: true, durum: true } }) : null;
      const bagli = g.belgeId ? await tx.belge.findFirst({ where: { id: g.belgeId, tenantId }, select: { id: true, tur: true, yon: true, durum: true, cariId: true } }) : null;
      return { islem, taslak, bagli };
    });
    if (!islem) throw new NotFoundException("E-posta talebi bulunamadı");
    this.sahipMi(islem.calistiranUserId);
    if (!epostaKutudaMi(islem.durum, taslak?.durum ?? null)) throw new ConflictException("Bu talep iş kutusunda değil ya da zaten kaldırılmış");
    if (g.belgeId) {
      if (!bagli || bagli.tur !== "teklif" || bagli.yon !== "satis") throw new BadRequestException("Bağlanacak belge bir satış teklifi olmalı");
      if (bagli.id === taslak?.id) throw new BadRequestException("E-postadan açılan taslak kendisine bağlanamaz; elle girdiğiniz teklifi seçin");
      if (bagli.durum === "iptal") throw new BadRequestException("İptal edilmiş teklif bağlanamaz");
    }

    const durum = g.neden === "teklif_degil" ? "teklif_degil" : "kapatildi";
    const onceki: EpostaOncesi = { durum: islem.durum, belgeId: islem.belgeId, cariId: islem.cariId, uyarilar: islem.uyarilar };
    const kapanis = await this.prisma.tenantIslem(tenantId, async (tx) => {
      // Aynı anda çalışan bir işleme ya da ikinci kapatmaya karşı önceki hâl şartı.
      const s = await tx.epostaTeklifIslemi.updateMany({
        where: { id: islem.id, tenantId, durum: islem.durum, belgeId: islem.belgeId },
        data: {
          durum, belgeId: bagli?.id ?? null, cariId: bagli?.cariId ?? islem.cariId,
          uyarilar: [kapanisMetni(g.neden, not)], hata: null, sonrakiDenemeAt: null, updatedAt: new Date(),
          // AI-67: bağlanan teklif onaylanınca worker ürün eşleşmesini öğrenir (AI-61).
          ...(bagli ? { hafizaIslendiAt: null } : {}),
        },
      });
      if (!s.count) throw new ConflictException("Talep bu sırada değişti; sayfayı yenileyip yeniden deneyin");
      return this.kapanisYaz(tx, { tur: "eposta", kayitId: islem.id, neden: g.neden, notMetni: not, bagliBelgeId: bagli?.id ?? null, onceki, sahipUserId: islem.calistiranUserId });
    });

    if (g.neden === "teklif_degil") await this.hafiza.siniflandirmaKaydet(islem.gelenEposta, "teklif_degil");
    const uyari = taslak?.durum === "taslak" ? await this.taslakKaldir(kapanis.id, taslak.id) : null;
    return { kapanisId: kapanis.id, uyari };
  }

  /** AI-68: numarasız taslak silinir; fırsat bağı geçmişi varsa silinemez, iptal edilir. */
  private async taslakKaldir(kapanisId: string, belgeId: string): Promise<string | null> {
    const { tenantId } = aktifBaglam();
    let sonuc: "silindi" | "iptal_edildi";
    try {
      await this.belgeler.sil(belgeId);
      sonuc = "silindi";
    } catch (e) {
      if (!(e instanceof ConflictException)) return `Talep kaldırıldı ama taslak silinemedi: ${e instanceof Error ? e.message : "bilinmeyen hata"}. Taslağı teklif listesinden silebilirsiniz.`;
      try {
        await this.belgeler.iptal(belgeId);
        sonuc = "iptal_edildi";
      } catch (e2) {
        return `Talep kaldırıldı ama taslak iptal edilemedi: ${e2 instanceof Error ? e2.message : "bilinmeyen hata"}.`;
      }
    }
    await this.prisma.tenantIslem(tenantId, (tx) => tx.isKutusuKapanisi.update({ where: { id: kapanisId }, data: { taslakSonucu: sonuc } }));
    return null;
  }

  private async yanitKapat(id: string, neden: KapanisNedeni, not: string | null) {
    const { tenantId } = aktifBaglam();
    const kapanis = await this.prisma.tenantIslem(tenantId, async (tx) => {
      const t = await tx.teklifTakibi.findFirst({ where: { id, tenantId }, select: { id: true, durum: true, kapanisNedeni: true, sorumluUserId: true } });
      if (!t) throw new NotFoundException("Teklif takibi bulunamadı");
      this.sahipMi(t.sorumluUserId);
      if (t.durum !== "yanit_geldi") throw new ConflictException("Bu teklif iş kutusunda değil ya da zaten kaldırılmış");
      const s = await tx.teklifTakibi.updateMany({ where: { id, tenantId, durum: "yanit_geldi" }, data: { durum: "kapandi", kapanisNedeni: kapanisMetni(neden, not), updatedAt: new Date() } });
      if (!s.count) throw new ConflictException("Takip bu sırada değişti; sayfayı yenileyip yeniden deneyin");
      return this.kapanisYaz(tx, { tur: "yanit", kayitId: id, neden, notMetni: not, bagliBelgeId: null, onceki: { durum: t.durum, kapanisNedeni: t.kapanisNedeni }, sahipUserId: t.sorumluUserId });
    });
    return { kapanisId: kapanis.id, uyari: null };
  }

  /** Onay talebi reddedilir (yalnız açan; AiOnayService denetler) ve geri alınamaz. */
  private async onayKapat(id: string, neden: KapanisNedeni, not: string | null) {
    const { tenantId, userId } = aktifBaglam();
    await this.onaylar.reddet(id);
    const kapanis = await this.prisma.tenantIslem(tenantId, (tx) =>
      this.kapanisYaz(tx, { tur: "onay", kayitId: id, neden, notMetni: not, bagliBelgeId: null, onceki: { durum: "bekliyor" }, sahipUserId: userId }));
    return { kapanisId: kapanis.id, uyari: null };
  }

  private async kapanisYaz(tx: Tx, k: { tur: KapanisTuru; kayitId: string; neden: KapanisNedeni; notMetni: string | null; bagliBelgeId: string | null; onceki: object; sahipUserId: string | null }) {
    const { tenantId, userId } = aktifBaglam();
    // Kayıt kutuya başka yoldan döndüyse (ör. e-postada "Bu bir teklif talebiydi") eski kapanış
    // açık kalmıştır; tek açık kapanış kuralı için geri alınmış sayılır (geri alan boş).
    await tx.isKutusuKapanisi.updateMany({ where: { tenantId, tur: k.tur, kayitId: k.kayitId, geriAlindiAt: null }, data: { geriAlindiAt: new Date() } });
    return tx.isKutusuKapanisi.create({
      data: { tenantId, ...k, onceki: k.onceki as Prisma.InputJsonValue, kapatanUserId: userId },
      select: { id: true },
    });
  }

  /** AI-69: kaydı kapanış öncesine döndürür; reddedilen onay dönmez. */
  async geriAl(kapanisId: string) {
    const { tenantId, userId } = aktifBaglam();
    await this.prisma.tenantIslem(tenantId, async (tx) => {
      const k = await tx.isKutusuKapanisi.findFirst({ where: { id: kapanisId, tenantId, geriAlindiAt: null } });
      if (!k) throw new NotFoundException("Kapanış bulunamadı ya da zaten geri alındı");
      this.sahipMi(k.sahipUserId);
      if (k.tur === "onay") throw new ConflictException("Reddedilen onay talebi geri alınamaz");
      if (k.tur === "eposta") {
        const hedef = epostaGeriDonus(k.onceki as unknown as EpostaOncesi, k.taslakSonucu);
        const s = await tx.epostaTeklifIslemi.updateMany({
          where: { id: k.kayitId, tenantId, durum: { in: ["kapatildi", "teklif_degil"] } },
          data: { durum: hedef.durum, belgeId: hedef.belgeId, cariId: hedef.cariId, uyarilar: hedef.uyarilar as Prisma.InputJsonValue, updatedAt: new Date() },
        });
        if (!s.count) throw new ConflictException("Talep kapandıktan sonra değişti; geri alınamaz");
      } else {
        const onceki = k.onceki as { durum: string; kapanisNedeni: string | null };
        const s = await tx.teklifTakibi.updateMany({ where: { id: k.kayitId, tenantId, durum: "kapandi" }, data: { durum: onceki.durum, kapanisNedeni: onceki.kapanisNedeni, updatedAt: new Date() } });
        if (!s.count) throw new ConflictException("Takip kapandıktan sonra değişti; geri alınamaz");
      }
      await tx.isKutusuKapanisi.update({ where: { id: k.id }, data: { geriAlindiAt: new Date(), geriAlanUserId: userId } });
    });
    return { tamam: true };
  }

  /** AI-69: son 30 günde kaldırılanlar (geri alınmamış). */
  async kapatilanlar(kapsam: Kapsam) {
    const { tenantId, userId, rol } = aktifBaglam();
    if (kapsam === "firma" && rol !== "yonetici") throw new ForbiddenException("Firma geneli iş kutusunu yalnız yönetici görebilir");
    const firma = kapsam === "firma";
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const kayitlar = await tx.isKutusuKapanisi.findMany({
        where: { tenantId, geriAlindiAt: null, kapandiAt: { gte: new Date(Date.now() - KAPATILAN_GUN * 86_400_000) }, ...(firma ? {} : { sahipUserId: userId }) },
        orderBy: { kapandiAt: "desc" }, take: 100,
      });
      const idler = (tur: KapanisTuru) => kayitlar.filter((k) => k.tur === tur).map((k) => k.kayitId);
      const [epostalar, takipler, onaylar, belgeler, kullanicilar] = await Promise.all([
        tx.epostaTeklifIslemi.findMany({ where: { tenantId, id: { in: idler("eposta") } }, select: { id: true, durum: true, gelenEposta: { select: { id: true, konu: true, gonderenAdi: true, gonderenEposta: true } } } }),
        tx.teklifTakibi.findMany({ where: { tenantId, id: { in: idler("yanit") } }, select: { id: true, durum: true, belgeId: true, belge: { select: { no: true, revizyonNo: true, cari: { select: { unvan: true } } } } } }),
        tx.aiOnayTalebi.findMany({ where: { tenantId, id: { in: idler("onay") } }, select: { id: true, ozet: true } }),
        tx.belge.findMany({ where: { tenantId, id: { in: kayitlar.map((k) => k.bagliBelgeId).filter((x): x is string => Boolean(x)) } }, select: { id: true, no: true, revizyonNo: true, cari: { select: { unvan: true } } } }),
        tx.user.findMany({ where: { tenantId, id: { in: [...new Set(kayitlar.flatMap((k) => [k.kapatanUserId, k.sahipUserId]).filter((x): x is string => Boolean(x)))] } }, select: { id: true, adSoyad: true } }),
      ]);
      const ad = new Map(kullanicilar.map((u) => [u.id, u.adSoyad]));
      const ep = new Map(epostalar.map((e) => [e.id, e]));
      const tk = new Map(takipler.map((t) => [t.id, t]));
      const on = new Map(onaylar.map((o) => [o.id, o.ozet]));
      const bl = new Map(belgeler.map((b) => [b.id, b]));
      const teklifNo = (b: { no: string | null; revizyonNo: number }) => (b.no ? belgeNoMetni(b.no, b.revizyonNo) : "Taslak teklif");
      return {
        kapsam,
        kayitlar: kayitlar.map((k) => {
          let baslik = "Silinmiş kayıt";
          let adres: string | null = null;
          // Kayıt kapandıktan sonra başka yoldan değiştiyse geri alma reddedilir; düğme hiç sunulmaz.
          let kapali = false;
          if (k.tur === "eposta") {
            const e = ep.get(k.kayitId);
            if (e) { baslik = `${e.gelenEposta.konu} — ${e.gelenEposta.gonderenAdi ?? e.gelenEposta.gonderenEposta}`; adres = `/panel/eposta?id=${e.gelenEposta.id}`; kapali = e.durum === "kapatildi" || e.durum === "teklif_degil"; }
          } else if (k.tur === "yanit") {
            const t = tk.get(k.kayitId);
            if (t) { baslik = `${teklifNo(t.belge)} · ${t.belge.cari.unvan}`; adres = `/panel/belgeler?odak=${t.belgeId}`; kapali = t.durum === "kapandi"; }
          } else baslik = on.get(k.kayitId) ?? baslik;
          const b = k.bagliBelgeId ? bl.get(k.bagliBelgeId) : undefined;
          return {
            id: k.id, tur: k.tur, baslik, adres, neden: k.neden, nedenAdi: NEDEN_ADI[k.neden as KapanisNedeni] ?? k.neden, not: k.notMetni,
            taslakSonucu: k.taslakSonucu, kapandiAt: k.kapandiAt.toISOString(),
            kapatan: k.kapatanUserId ? ad.get(k.kapatanUserId) ?? null : null, sahip: k.sahipUserId ? ad.get(k.sahipUserId) ?? null : null,
            bagliTeklif: b ? { id: b.id, no: teklifNo(b), cari: b.cari.unvan, adres: `/panel/belgeler?odak=${b.id}` } : null,
            geriAlinabilir: k.tur !== "onay" && kapali,
          };
        }),
      };
    });
  }

  /** AI-67: "Elle yapıldı"da bağlanabilecek son satış teklifleri. */
  async teklifAdaylari(q: { cariId?: string; arama?: string; haric?: string }) {
    const { tenantId } = aktifBaglam();
    const arama = q.arama?.trim();
    const kayitlar = await this.prisma.tenantIslem(tenantId, (tx) => tx.belge.findMany({
      where: {
        tenantId, tur: "teklif", yon: "satis", durum: { not: "iptal" },
        ...(q.cariId ? { cariId: q.cariId } : {}),
        ...(q.haric ? { id: { not: q.haric } } : {}),
        ...(arama ? { OR: [{ no: { contains: arama, mode: "insensitive" } }, { cari: { unvan: { contains: arama, mode: "insensitive" } } }] } : {}),
      },
      select: { id: true, no: true, revizyonNo: true, tarih: true, durum: true, genelToplam: true, dovizCinsi: true, cari: { select: { id: true, unvan: true } } },
      orderBy: { createdAt: "desc" }, take: ADAY_SINIRI,
    }));
    return kayitlar.map((b) => ({
      id: b.id, no: b.no ? belgeNoMetni(b.no, b.revizyonNo) : null, tarih: b.tarih.toISOString().slice(0, 10), durum: b.durum,
      tutar: b.genelToplam.toString(), doviz: b.dovizCinsi, cari: b.cari,
    }));
  }
}
