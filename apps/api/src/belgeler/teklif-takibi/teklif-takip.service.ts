import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit, Optional } from "@nestjs/common";
import { AbonelikErisimService } from "../../core/abonelik-erisim.service";
import { ModuleRef } from "@nestjs/core";
import { PrismaClient, type Prisma, type TeklifTakibi } from "@prisma/client";
import { belgeNoMetni } from "@tekirextra/shared";
import { BildirimService } from "../../bildirimler/bildirim.service";
import { aktifBaglam, baglamlaCalistir } from "../../core/istek-baglami";
import { PrismaService } from "../../core/prisma.service";
import { kiraciSaglayicisi } from "../../ai/saglayici/kiraci-saglayici";
import { tercihlerBlogu } from "../../ai/hafiza/hafiza.kurallari";
import { veriEtiketiTemizle } from "../../ai/teklif-talebi/teklif-talebi.kurallari";
import { EpostaService } from "../../tenant/eposta.service";
import { BelgelerService } from "../belgeler.service";
import { hatirlatmaGunu, takipAyari, tatiller, teklifGonderiminiKaydet } from "./teklif-takip.kayit";
import {
  ACIK_TAKIP, TAKIP_METNI_TALIMATI, TEKLIF_TAKIP_MODULU, hazirTakipMetni, isGunuEkle, kapanisNedeni, mesajKimligi,
  takipMetniIstemi, takipMetniSemasi, teklifAcikMi, teklifTakipAyariSemasi, trGunu, yerTutucuVar,
} from "./teklif-takip.kurallari";
import { nabizla } from "../../core/nabiz/nabiz";

type Tx = Prisma.TransactionClient;
const OTUZ_DAKIKA_MS = 30 * 60 * 1000;
const SISTEM_USER_ID = "00000000-0000-4000-8000-000000000000";
const tarihTR = (d: Date | string) => (typeof d === "string" ? d : d.toISOString().slice(0, 10)).split("-").reverse().join(".");

export interface TakipGorunumu {
  durum: string; kaynak: string; alici: string | null; gonderildiAt: string; gonderimSayisi: number;
  hatirlatmaGunu: string; hatirlatildiAt: string | null; yanitAt: string | null; yanitEpostaId: string | null;
  kapanisNedeni: string | null; crmGorevId: string | null; bekleyenGun: number | null;
}

function gorunum(t: TeklifTakibi, bugun = trGunu()): TakipGorunumu {
  const gonderim = trGunu(t.gonderildiAt);
  return {
    durum: t.durum, kaynak: t.kaynak, alici: t.alici, gonderildiAt: t.gonderildiAt.toISOString(), gonderimSayisi: t.gonderimSayisi,
    hatirlatmaGunu: t.hatirlatmaGunu.toISOString().slice(0, 10), hatirlatildiAt: t.hatirlatildiAt?.toISOString() ?? null,
    yanitAt: t.yanitAt?.toISOString() ?? null, yanitEpostaId: t.yanitEpostaId, kapanisNedeni: t.kapanisNedeni, crmGorevId: t.crmGorevId,
    // Takvim günü; iş günü hatırlatma gününe gömülüdür.
    bekleyenGun: ACIK_TAKIP.includes(t.durum as never) ? Math.max(0, Math.round((Date.parse(bugun) - Date.parse(gonderim)) / 86_400_000)) : null,
  };
}

/**
 * AI-38…43: gönderilen teklifin takibi. Gönderim kaydı ve yanıt eşleştirme her
 * zaman çalışır; hatırlatma, takip görevi ve geçerlilik uyarısı Modül
 * Ayarları'nda açıkken. Sistem kendiliğinden e-posta göndermez; takip
 * e-postasını kullanıcı düzenleyip gönderir.
 */
@Injectable()
export class TeklifTakipService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TeklifTakipService.name);
  private zamanlayici?: NodeJS.Timeout;
  private calisiyor = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly belgeler: BelgelerService,
    @Optional() private readonly eposta?: EpostaService,
    @Optional() private readonly moduleRef?: ModuleRef,
    @Optional() private readonly erisim?: AbonelikErisimService,
  ) {}

  onModuleInit(): void {
    if (process.env.TEKIR_WORKER !== "1") return;
    this.zamanlayici = setInterval(() => void nabizla("teklif-takip", () => this.taraGuvenli()), OTUZ_DAKIKA_MS);
    setImmediate(() => void nabizla("teklif-takip", () => this.taraGuvenli()));
  }

  onModuleDestroy(): void {
    if (this.zamanlayici) clearInterval(this.zamanlayici);
  }

  /** Testlerde değiştirilebilir. */
  saglayiciBul = (tenantId: string) => kiraciSaglayicisi(this.prisma, tenantId, { ozellik: "hatirlatma" });

  private async teklif(tx: Tx, belgeId: string) {
    const { tenantId } = aktifBaglam();
    const b = await tx.belge.findFirst({
      where: { id: belgeId, tenantId },
      select: { id: true, tur: true, yon: true, durum: true, no: true, revizyonNo: true, tarih: true, gecerlilikTarihi: true, genelToplam: true, dovizCinsi: true, cariId: true, cari: { select: { unvan: true, eposta: true } } },
    });
    if (!b) throw new NotFoundException("Belge bulunamadı");
    if (b.tur !== "teklif" || b.yon !== "satis") throw new BadRequestException("Takip yalnız satış teklifleri içindir");
    return b;
  }

  async getir(belgeId: string): Promise<{ takip: TakipGorunumu | null }> {
    const { tenantId } = aktifBaglam();
    const t = await this.prisma.tenantIslem(tenantId, async (tx) => { await this.teklif(tx, belgeId); return tx.teklifTakibi.findUnique({ where: { belgeId } }); });
    return { takip: t ? gorunum(t) : null };
  }

  /** AI-42: e-posta dışında (WhatsApp, elden) verilen teklif takibe alınır. */
  async elleGonderildi(belgeId: string, tarih?: string): Promise<{ takip: TakipGorunumu }> {
    const { tenantId, userId } = aktifBaglam();
    const zaman = tarih ? new Date(`${tarih}T09:00:00+03:00`) : new Date();
    if (Number.isNaN(zaman.getTime()) || zaman.getTime() > Date.now() + 60_000) throw new BadRequestException("Gönderim tarihi geçersiz ya da ileride");
    const t = await this.prisma.tenantIslem(tenantId, async (tx) => {
      const b = await this.teklif(tx, belgeId);
      if (!teklifAcikMi(b.durum)) throw new BadRequestException("Yalnız onaylı ve açık teklif takibe alınır");
      return teklifGonderiminiKaydet(tx, tenantId, { belgeId, kaynak: "elle", alici: null, mesajId: null, sorumluUserId: userId, zaman });
    });
    return { takip: gorunum(t) };
  }

  /** AI-42: yanıt e-posta dışında alındı (telefon, yüz yüze) ya da takip bırakıldı. */
  async kapat(belgeId: string, g: { yanitAlindi: boolean; not?: string | null }): Promise<{ takip: TakipGorunumu }> {
    const { tenantId } = aktifBaglam();
    const t = await this.prisma.tenantIslem(tenantId, async (tx) => {
      const mevcut = await this.acikTakip(tx, belgeId);
      await this.gorevKapat(tx, mevcut.crmGorevId);
      return tx.teklifTakibi.update({
        where: { id: mevcut.id },
        data: g.yanitAlindi
          ? { durum: "yanit_geldi", yanitAt: new Date(), kapanisNedeni: g.not ? `Yanıt e-posta dışında alındı: ${g.not}` : "Yanıt e-posta dışında alındı", updatedAt: new Date() }
          : { durum: "kapandi", kapanisNedeni: g.not ? `Takip kapatıldı: ${g.not}` : "Takip kapatıldı", updatedAt: new Date() },
      });
    });
    return { takip: gorunum(t) };
  }

  /** AI-42: hatırlatma bugünden N iş günü sonraya alınır. */
  async ertele(belgeId: string, isGunu: number): Promise<{ takip: TakipGorunumu }> {
    const { tenantId } = aktifBaglam();
    const t = await this.prisma.tenantIslem(tenantId, async (tx) => {
      const mevcut = await this.acikTakip(tx, belgeId);
      const gun = await hatirlatmaGunu(tx, tenantId, new Date(), isGunu);
      if (mevcut.crmGorevId) await tx.crmGorev.updateMany({ where: { id: mevcut.crmGorevId, tenantId, durum: "acik" }, data: { sonTarih: gun } });
      return tx.teklifTakibi.update({ where: { id: mevcut.id }, data: { durum: "yanit_bekliyor", hatirlatmaGunu: gun, hatirlatildiAt: null, updatedAt: new Date() } });
    });
    return { takip: gorunum(t) };
  }

  /** AI-42: takip e-postası taslağı — model yazar, kullanılamazsa hazır metin. Gönderilmez. */
  async takipMetni(belgeId: string): Promise<{ konu: string; metin: string; alici: string | null; kaynak: "model" | "sablon" }> {
    const { tenantId } = aktifBaglam();
    const { userId } = aktifBaglam();
    const { b, t, firma, gonderen, tercihler } = await this.prisma.tenantIslem(tenantId, async (tx) => {
      const belge = await this.teklif(tx, belgeId);
      return {
        b: belge, t: await tx.teklifTakibi.findUnique({ where: { belgeId } }),
        // AI-63: yalnız kullanıcı onaylı müşteri tercihleri.
        tercihler: (await tx.aiHafiza.findMany({ where: { tenantId, tur: "musteri_tercihi", durum: "aktif", cariId: belge.cariId }, orderBy: { createdAt: "asc" }, select: { metin: true } })).map((x) => x.metin ?? "").filter(Boolean),
        firma: (await tx.tenant.findUnique({ where: { id: tenantId }, select: { unvan: true } }))?.unvan.trim() ?? "",
        gonderen: (await tx.user.findFirst({ where: { id: userId, tenantId }, select: { adSoyad: true } }))?.adSoyad ?? "",
      };
    });
    const bilgi = {
      unvan: b.cari.unvan, no: belgeNoMetni(b.no ?? "", b.revizyonNo), tarih: tarihTR(b.tarih), gecerlilik: b.gecerlilikTarihi ? tarihTR(b.gecerlilikTarihi) : null,
      tutar: Number(b.genelToplam).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }), doviz: b.dovizCinsi,
      gonderildi: t ? tarihTR(t.gonderildiAt) : tarihTR(new Date()), gonderimSayisi: t?.gonderimSayisi ?? 1, firma, gonderen,
    };
    const alici = t?.alici ?? b.cari.eposta ?? null;
    try {
      const { saglayici } = await this.saglayiciBul(tenantId);
      const m = await saglayici.yapilandirilmisUretim({ sistemRol: TAKIP_METNI_TALIMATI, prompt: [takipMetniIstemi(bilgi), tercihlerBlogu(tercihler, veriEtiketiTemizle)].filter(Boolean).join("\n\n"), dusunmeKapali: true }, takipMetniSemasi);
      if (yerTutucuVar(m.konu) || yerTutucuVar(m.metin)) throw new Error("Model metninde yer tutucu kaldı");
      return { ...m, alici, kaynak: "model" };
    } catch (hata) {
      this.logger.warn(`Takip metni modelden alınamadı (${belgeId}): ${String(hata)}`);
      return { ...hazirTakipMetni(bilgi), alici, kaynak: "sablon" };
    }
  }

  /** AI-42: kullanıcının düzenlediği takip e-postası teklif PDF'iyle gönderilir; takip tazelenir. */
  async takipGonder(belgeId: string, g: { alici?: string; konu: string; metin: string }): Promise<{ takip: TakipGorunumu; alici: string }> {
    if (!this.eposta) throw new Error("EpostaService yüklenmedi");
    const { tenantId, userId } = aktifBaglam();
    const b = await this.prisma.tenantIslem(tenantId, (tx) => this.teklif(tx, belgeId));
    if (!teklifAcikMi(b.durum)) throw new BadRequestException("Yalnız onaylı ve açık teklif için takip e-postası gönderilir");
    const alici = g.alici || b.cari.eposta;
    if (!alici) throw new BadRequestException("Alıcı e-postası yok: cari kartına e-posta ekleyin veya adres belirtin");
    const { buffer, dosyaAdi } = await this.belgeler.pdfUret(belgeId);
    const ileti = await this.eposta.ekliIletiGonder({ alici, konu: g.konu, metin: g.metin, ekler: [{ dosyaAdi, icerik: buffer, mime: "application/pdf" }] });
    const t = await this.prisma.tenantIslem(tenantId, (tx) => teklifGonderiminiKaydet(tx, tenantId, { belgeId, kaynak: "eposta", alici, mesajId: mesajKimligi(ileti?.messageId), sorumluUserId: userId }));
    return { takip: gorunum(t), alici };
  }

  private async acikTakip(tx: Tx, belgeId: string) {
    await this.teklif(tx, belgeId);
    const t = await tx.teklifTakibi.findUnique({ where: { belgeId } });
    if (!t) throw new NotFoundException("Bu teklif takipte değil");
    if (!ACIK_TAKIP.includes(t.durum as never)) throw new ConflictException("Takip zaten kapanmış");
    return t;
  }

  private async gorevKapat(tx: Tx, gorevId: string | null) {
    if (!gorevId) return;
    const { tenantId } = aktifBaglam();
    await tx.crmGorev.updateMany({ where: { id: gorevId, tenantId, durum: "acik" }, data: { durum: "tamamlandi", tamamlanmaZamani: new Date() } });
  }

  private bildirimler(): BildirimService | null {
    try { return this.moduleRef?.get(BildirimService, { strict: false }) ?? null; } catch { return null; }
  }

  /** Worker: açık takiplerin kapanışı (her zaman) ve hatırlatma/geçerlilik uyarısı (ayar açıkken). */
  // Zamanlayıcıdan çağrılır: veritabanı anlık erişilemezse hata yakalanmadan süreci düşürmesin, sonraki turda yeniden dener.
  private async taraGuvenli(): Promise<void> {
    try { await this.tara(); }
    catch (hata) { this.logger.error(`Teklif takibi taraması başarısız: ${hata instanceof Error ? hata.message.split("\n").filter(Boolean).pop() : String(hata)}`); }
  }

  async tara(): Promise<void> {
    if (this.calisiyor) return;
    this.calisiyor = true;
    try {
      const url = process.env.DATABASE_URL_MIGRATE;
      if (!url) return;
      const yonetim = new PrismaClient({ datasourceUrl: url });
      let kiracilar: string[];
      try { kiracilar = (await yonetim.teklifTakibi.findMany({ where: { durum: { in: ACIK_TAKIP } }, select: { tenantId: true }, distinct: ["tenantId"] })).map((x) => x.tenantId); }
      finally { await yonetim.$disconnect().catch(() => undefined); }
      for (const tenantId of kiracilar) {
        // PLT-05: askıdaki firmada teklif takibi görev açmaz.
        if (await this.erisim?.otomasyonDurdu(tenantId)) continue;
        try { await baglamlaCalistir({ tenantId, userId: SISTEM_USER_ID, rol: "yonetici" }, () => this.kiraciTara()); }
        catch (hata) { this.logger.error(`Teklif takibi taranamadı (${tenantId}): ${String(hata)}`); }
      }
    } finally {
      this.calisiyor = false;
    }
  }

  async kiraciTara(an = new Date()): Promise<{ kapanan: number; hatirlatilan: number; gecerlilik: number }> {
    const { tenantId } = aktifBaglam();
    const bugun = trGunu(an);
    const sonuc = { kapanan: 0, hatirlatilan: 0, gecerlilik: 0 };
    const takipler = await this.prisma.tenantIslem(tenantId, (tx) => tx.teklifTakibi.findMany({
      where: { tenantId, durum: { in: ACIK_TAKIP } },
      include: { belge: { select: { id: true, durum: true, no: true, revizyonNo: true, gecerlilikTarihi: true, cariId: true, cari: { select: { unvan: true } } } } },
      take: 500,
    }));
    const ayar = await this.prisma.tenantIslem(tenantId, (tx) => takipAyari(tx, tenantId));
    const tatil = await this.prisma.tenantIslem(tenantId, (tx) => tatiller(tx, tenantId, bugun, Math.max(ayar.gecerlilikUyariGun, 1)));
    const uyariSiniri = isGunuEkle(bugun, ayar.gecerlilikUyariGun, tatil);
    for (const t of takipler) {
      const no = belgeNoMetni(t.belge.no ?? "", t.belge.revizyonNo);
      if (!teklifAcikMi(t.belge.durum)) {
        await this.prisma.tenantIslem(tenantId, async (tx) => {
          await this.gorevKapat(tx, t.crmGorevId);
          await tx.teklifTakibi.update({ where: { id: t.id }, data: { durum: "kapandi", kapanisNedeni: kapanisNedeni(t.belge.durum), updatedAt: new Date() } });
        });
        sonuc.kapanan++;
        continue;
      }
      if (!ayar.acik || !t.sorumluUserId) continue;
      const sorumlu = await this.prisma.tenantIslem(tenantId, (tx) => tx.user.findFirst({ where: { id: t.sorumluUserId!, tenantId, aktif: true }, select: { id: true } }));
      if (!sorumlu) continue;
      if (t.durum === "yanit_bekliyor" && t.hatirlatmaGunu.toISOString().slice(0, 10) <= bugun) {
        const gorev = await this.prisma.tenantIslem(tenantId, (tx) => tx.crmGorev.create({ data: {
          tenantId, cariId: t.belge.cariId, atananUserId: sorumlu.id, baslik: `${no} teklifi için yanıt yok — takip edin`,
          aciklama: `Teklif ${tarihTR(t.gonderildiAt)} tarihinde ${t.alici ?? "müşteriye"} gönderildi; ${ayar.isGunu} iş günüdür yanıt gelmedi. Teklif ekranından takip e-postası gönderebilir, yanıt alındı olarak işaretleyebilir ya da erteleyebilirsiniz.`,
          sonTarih: new Date(`${bugun}T00:00:00Z`), oncelik: "normal",
        } }));
        await this.prisma.tenantIslem(tenantId, (tx) => tx.teklifTakibi.update({ where: { id: t.id }, data: { durum: "hatirlatildi", hatirlatildiAt: new Date(), crmGorevId: gorev.id, updatedAt: new Date() } }));
        await this.bildir(sorumlu.id, `teklif_takip:${t.id}:${t.gonderimSayisi}`, `${no} teklifi için yanıt yok`, `${t.belge.cari.unvan} — ${ayar.isGunu} iş günüdür yanıt gelmedi. Takip e-postası gönderebilir ya da erteleyebilirsiniz.`, "uyari", t.belgeId);
        sonuc.hatirlatilan++;
      }
      const gecerlilik = t.belge.gecerlilikTarihi?.toISOString().slice(0, 10);
      if (gecerlilik && !t.gecerlilikUyarisiAt && gecerlilik >= bugun && gecerlilik <= uyariSiniri) {
        await this.prisma.tenantIslem(tenantId, (tx) => tx.teklifTakibi.update({ where: { id: t.id }, data: { gecerlilikUyarisiAt: new Date(), updatedAt: new Date() } }));
        await this.bildir(sorumlu.id, `teklif_gecerlilik:${t.id}`, `${no} teklifinin geçerliliği bitiyor`, `${t.belge.cari.unvan} — teklif ${tarihTR(gecerlilik)} tarihine kadar geçerli ve henüz yanıt yok.`, "uyari", t.belgeId);
        sonuc.gecerlilik++;
      }
    }
    return sonuc;
  }

  private async bildir(userId: string, anahtar: string, baslik: string, aciklama: string, onem: "uyari" | "bilgi", belgeId: string) {
    const b = this.bildirimler();
    if (!b) return;
    await b.uret({ tur: "teklif", onem, baslik, aciklama, birlesimAnahtari: anahtar, kaynakTur: "teklif_takibi", kaynakRef: belgeId, hedefYol: `/panel/belgeler?odak=${belgeId}`, roller: [], kullaniciIdler: [userId] })
      .catch((hata: unknown) => this.logger.warn(`Teklif takibi bildirimi üretilemedi: ${String(hata)}`));
  }
}

export { TEKLIF_TAKIP_MODULU, teklifTakipAyariSemasi };
