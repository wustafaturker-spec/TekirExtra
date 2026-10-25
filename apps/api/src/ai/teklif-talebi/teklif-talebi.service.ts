import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit, Optional } from "@nestjs/common";
import { AbonelikErisimService } from "../../core/abonelik-erisim.service";
import { Prisma, PrismaClient, type EpostaTeklifIslemi } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Rol } from "@tekirextra/shared";
import { BildirimService } from "../../bildirimler/bildirim.service";
import { aktifBaglam, baglamlaCalistir } from "../../core/istek-baglami";
import { PrismaService } from "../../core/prisma.service";
import { AracYurutucu, hataMetni } from "../ajan/arac-yurutucu";
import { adres } from "../ajan/araclar/arac";
import { UC } from "../ajan/araclar/uclar";
import { UcCagirici } from "../ajan/uc-cagirici";
import { AiSinirHatasi } from "../saglayici/ai-butce";
import { cariAdaylari, type CariAdayi } from "../../cari/cari-aday";
import { kiraciSaglayicisi } from "../saglayici/kiraci-saglayici";
import { HafizaService } from "../hafiza/hafiza.service";
import { ifadeAnahtari, orneklerBlogu } from "../hafiza/hafiza.kurallari";
import type { IAiProvider } from "../saglayici/ai-provider.interface";
import { TEKLIF_TALEBI_MODULU, TEKLIF_TALEBI_ROLLERI, teklifTalebiAyariSemasi, type TeklifTalebiAyari } from "./teklif-talebi-ayari";
import {
  ADAY_SAYISI, ASGARI_GUVEN, AZAMI_DENEME, CIKARIM_TALIMATI, ESLESME_TALIMATI, YENIDEN_CALISTIRILABILIR,
  cariKoduOner, cikarimIstemi, cikarimSemasi, eslesmeIstemi, eslesmeSemasi, miktarMetni, otomatikIletiMi, veriEtiketiTemizle,
  secimleriUygula, taslakAciklamasi, varsayilanUnvan, varyantBelirsizligi, varyantSorusuMetni, yedekAramalar,
  type Cikarim, type StokAdayi, type TeklifIslemDurumu,
} from "./teklif-talebi.kurallari";

const BES_DAKIKA_MS = 5 * 60 * 1000;
const ON_DAKIKA_MS = 10 * 60 * 1000;
const TARAMA_PARTISI = 10;
/** Açılıştan önceki bir günün e-postaları da yeni sayılır (senkron gecikmesi). */
const GERIYE_TOLERANS_MS = 24 * 60 * 60 * 1000;
const SISTEM_USER_ID = "00000000-0000-4000-8000-000000000000";

type Eposta = { id: string; konu: string; tarih: Date; gonderenAdi: string | null; gonderenEposta: string; icerikMetin: string | null; otomatik: boolean; crmFirsatId: string | null; ekler: Array<{ dosyaAdi: string }> };
type KalemSonucu = {
  ifade: string; miktar: number | null; birim: string | null; stokId: string | null; varyantId: string | null; kod: string | null; ad: string | null; kartBirimi: string | null;
  /** Kart bulundu ama müşteri varyantı belirtmedi (seçilmedi). */
  belirsizKart?: { stokId?: string; kartKodu: string; kartAdi: string; secenekler: string[] };
  /** AI-61: aynı cari için önceki düzeltmeden hatırlandı (modele sorulmadı). */
  hatirlandi?: boolean;
};
type Sonuc = { durum: TeklifIslemDurumu; uyarilar: string[]; belgeId?: string | null; firsatId?: string | null; onayTalebiId?: string | null; cariId?: string | null; kalemler?: KalemSonucu[]; cariAdaylari?: CariAdayi[] };

export interface TeklifIslemGorunumu {
  id: string; gelenEpostaId: string; durum: string; guven: number | null; uyarilar: string[]; kalemler: KalemSonucu[];
  /** Varyantı belirsiz kalemler için müşteriye sorulacak metin önerisi (şablon). */
  yanitOnerisi: string | null;
  cariId: string | null; belgeId: string | null; firsatId: string | null; onayTalebiId: string | null; hata: string | null;
  belgeAdresi: string | null; onayAdresi: string | null; guncellendiAt: string;
  cariAdaylari: CariAdayi[];
}

export function gorunum(k: EpostaTeklifIslemi): TeklifIslemGorunumu {
  const kalemler = (k.kalemler as KalemSonucu[]) ?? [];
  const yetkili = cikarimSemasi.safeParse(k.cikarim);
  const belirsizler = k.belgeId ? [] : kalemler.filter((x) => !x.stokId && x.belirsizKart).map((x) => ({ ...x.belirsizKart!, miktar: x.miktar, birim: x.birim }));
  return {
    id: k.id, gelenEpostaId: k.gelenEpostaId, durum: k.durum, guven: k.guven === null ? null : Number(k.guven),
    uyarilar: (k.uyarilar as string[]) ?? [], kalemler,
    yanitOnerisi: varyantSorusuMetni(yetkili.success ? yetkili.data.firma?.yetkili ?? null : null, belirsizler),
    cariId: k.cariId, belgeId: k.belgeId, firsatId: k.firsatId, onayTalebiId: k.onayTalebiId, hata: k.hata,
    belgeAdresi: k.belgeId ? adres.belge(k.belgeId) : null,
    onayAdresi: k.onayTalebiId ? `/panel/ai?talep=${k.onayTalebiId}` : null,
    guncellendiAt: k.updatedAt.toISOString(),
    cariAdaylari: (k.cariAdaylari as unknown as CariAdayi[]) ?? [],
  };
}

/**
 * AI-32…37: gelen e-postadaki teklif talebini sabit bir hatla taslak teklife
 * çevirir. Model yalnız veri çıkarır ve sunulan stok adaylarından seçer; cari,
 * stok, fiyat ve belge ekranın uçlarından, çalıştıranın kimliği ve rolüyle
 * okunur/yazılır. Hiçbir şey onaylanmaz ya da gönderilmez; yeni cari yalnız
 * onay talebiyle açılır.
 */
@Injectable()
export class TeklifTalebiService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TeklifTalebiService.name);
  private zamanlayici?: NodeJS.Timeout;
  private calisiyor = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly uc: UcCagirici,
    private readonly yurutucu: AracYurutucu,
    private readonly bildirimler: BildirimService,
    @Optional() private readonly hafiza?: HafizaService,
    @Optional() private readonly erisim?: AbonelikErisimService,
  ) {}

  /** Testlerde değiştirilebilir; çağrılar "teklif" özelliğiyle sayılır ve bütçeye tabidir. */
  saglayiciBul: (tenantId: string) => Promise<{ saglayici: IAiProvider }> = (tenantId) => kiraciSaglayicisi(this.prisma, tenantId, { ozellik: "teklif" });

  onModuleInit(): void {
    if (process.env.TEKIR_WORKER !== "1") return;
    this.zamanlayici = setInterval(() => void this.taraGuvenli(), BES_DAKIKA_MS);
    setImmediate(() => void this.taraGuvenli());
  }

  onModuleDestroy(): void {
    if (this.zamanlayici) clearInterval(this.zamanlayici);
  }

  async getir(epostaId: string): Promise<TeklifIslemGorunumu | null> {
    const { tenantId } = aktifBaglam();
    const kayit = await this.prisma.tenantIslem(tenantId, (tx) => tx.epostaTeklifIslemi.findFirst({ where: { tenantId, gelenEpostaId: epostaId } }));
    return kayit ? gorunum(kayit) : null;
  }

  /**
   * AI-32: elle "Taslak hazırla" — çalıştıran kullanıcının kimliği ve rolüyle,
   * özellik kapalıyken de. `cariId` verilirse cari eşleşmesi atlanır ve önceki
   * çıkarım yeniden kullanılır (gönderen birden çok caride kayıtlıysa).
   */
  async elleHazirla(epostaId: string, secim: { cariId?: string; yeniCari?: boolean; teklifTalebiydi?: boolean } = {}): Promise<TeklifIslemGorunumu> {
    const { cariId, yeniCari, teklifTalebiydi } = secim;
    const { tenantId, userId } = aktifBaglam();
    const kayit = await this.prisma.tenantIslem(tenantId, async (tx) => {
      const eposta = await tx.gelenEposta.findFirst({ where: { id: epostaId, tenantId }, select: { id: true } });
      if (!eposta) throw new NotFoundException("E-posta bulunamadı");
      if (cariId && !(await tx.cariHesap.findFirst({ where: { id: cariId, tenantId, aktif: true }, select: { id: true } }))) throw new NotFoundException("Cari bulunamadı ya da pasif");
      const mevcut = await tx.epostaTeklifIslemi.findUnique({ where: { gelenEpostaId: epostaId } });
      if (!mevcut) return tx.epostaTeklifIslemi.create({ data: { tenantId, gelenEpostaId: epostaId, calistiranUserId: userId, durum: "isleniyor", cariId: cariId ?? null } });
      if (mevcut.belgeId) throw new ConflictException("Bu e-postadan taslak zaten hazırlandı; yeniden işlenmez.");
      if (mevcut.durum === "cari_onayi_bekliyor") return { ...mevcut, devam: true as const };
      if (!YENIDEN_CALISTIRILABILIR.includes(mevcut.durum as TeklifIslemDurumu)) {
        throw new ConflictException(mevcut.durum === "taslak_hazir" ? "Bu e-postadan taslak zaten hazırlandı." : mevcut.durum === "cari_onayi_bekliyor" ? "Cari açma onayı bekliyor." : "E-posta şu an işleniyor.");
      }
      const alindi = await tx.epostaTeklifIslemi.updateMany({
        where: { id: mevcut.id, durum: mevcut.durum },
        data: { durum: "isleniyor", calistiranUserId: userId, deneme: { increment: 1 }, hata: null, sonrakiDenemeAt: null, uyarilar: [], cariId: cariId ?? null, updatedAt: new Date() },
      });
      if (!alindi.count) throw new ConflictException("E-posta şu an işleniyor.");
      return { ...mevcut, durum: "isleniyor", cariId: cariId ?? null, deneme: mevcut.deneme + 1 };
    }).catch((hata: unknown) => {
      // Worker aynı anda ilk kaydı açtıysa tekil indeks bu yazımı reddeder: yarışı kaybeden çakışma alır.
      if (hata instanceof Prisma.PrismaClientKnownRequestError && hata.code === "P2002") throw new ConflictException("E-posta şu an işleniyor.");
      throw hata;
    });
    if ("devam" in kayit) {
      // Cari açma onayı verildiyse beklemeden devam edilir; hâlâ bekliyorsa işlem yapılmaz.
      if (!(await this.cariOnayiniIzle(kayit))) throw new ConflictException("Cari açma onayı bekliyor; onaylandıktan sonra taslak hazırlanır.");
      return (await this.getir(epostaId))!;
    }
    const sonuc = await this.isle(kayit, { cikarimiYenile: !cariId && !yeniCari, yeniCari, teklifTalebiydi });
    if (!cariId || ["hata", "sinirda"].includes(sonuc.durum)) return sonuc;
    // AI-46: kullanıcının seçtiği cariye gönderen adresi ilgili kişi olarak öğretilir.
    const not = await this.gondereniOgret(epostaId, cariId);
    if (!not) return sonuc;
    return gorunum(await this.kaydet(sonuc.id, { uyarilar: [...sonuc.uyarilar, not] }));
  }

  /**
   * AI-61: panelde "Doğru ürünü seç" — kalemin ifadesi bu cari için seçilen
   * kart/varyanta öğretilir. Taslak henüz yoksa önceki çıkarımla yeniden hazırlanır.
   */
  async urunSec(epostaId: string, secim: { kalem: number; stokId: string; varyantId?: string }): Promise<TeklifIslemGorunumu> {
    const { tenantId } = aktifBaglam();
    if (!this.hafiza) throw new ConflictException("Hafıza kullanılamıyor");
    const { islem, varyantSayisi, kart, varyant } = await this.prisma.tenantIslem(tenantId, async (tx) => ({
      islem: await tx.epostaTeklifIslemi.findFirst({ where: { tenantId, gelenEpostaId: epostaId } }),
      kart: await tx.stokKart.findFirst({ where: { id: secim.stokId, tenantId, aktif: true }, select: { id: true } }),
      varyantSayisi: await tx.stokVaryant.count({ where: { stokId: secim.stokId, tenantId, aktif: true } }),
      varyant: secim.varyantId ? await tx.stokVaryant.findFirst({ where: { id: secim.varyantId, stokId: secim.stokId, tenantId, aktif: true }, select: { id: true } }) : null,
    }));
    if (!islem) throw new NotFoundException("Bu e-posta teklif talebi olarak işlenmedi");
    if (!islem.cariId) throw new ConflictException("Önce cariyi seçin; ürün eşleşmesi cariye göre hatırlanır.");
    const kalem = ((islem.kalemler as KalemSonucu[]) ?? [])[secim.kalem];
    if (!kalem) throw new NotFoundException("Kalem bulunamadı");
    if (!kart) throw new NotFoundException("Stok kartı bulunamadı ya da pasif");
    if (secim.varyantId && !varyant) throw new NotFoundException("Varyant bu karta ait değil ya da pasif");
    if (!secim.varyantId && varyantSayisi) throw new BadRequestException("Bu kartın varyantları var; varyantı seçin.");
    await this.hafiza.urunOgret({ cariId: islem.cariId, ifade: kalem.ifade, stokId: kart.id, varyantId: varyant?.id ?? null, kaynak: "kullanici", kaynakEpostaId: epostaId });
    if (!islem.belgeId && YENIDEN_CALISTIRILABILIR.includes(islem.durum as TeklifIslemDurumu)) return this.elleHazirla(epostaId, { cariId: islem.cariId });
    return gorunum(islem);
  }

  /**
   * AI-64: kullanıcının sınıflandırma kararı. "teklif_degil" ve "sustur" taslağı olmayan
   * işlemi `teklif_degil` yapar; "teklifti" yeniden çıkarır ve sınıflandırmayı geçersiz kılar.
   */
  async geriBildirim(epostaId: string, tur: "teklif_degil" | "teklifti" | "sustur"): Promise<TeklifIslemGorunumu | null> {
    const { tenantId } = aktifBaglam();
    if (!this.hafiza) throw new ConflictException("Hafıza kullanılamıyor");
    const { eposta, islem } = await this.prisma.tenantIslem(tenantId, async (tx) => ({
      eposta: await tx.gelenEposta.findFirst({ where: { id: epostaId, tenantId }, select: { id: true, konu: true, icerikMetin: true, gonderenEposta: true } }),
      islem: await tx.epostaTeklifIslemi.findFirst({ where: { tenantId, gelenEpostaId: epostaId } }),
    }));
    if (!eposta) throw new NotFoundException("E-posta bulunamadı");
    if (tur === "teklifti") {
      if (islem?.belgeId) throw new ConflictException("Bu e-postadan taslak zaten hazırlandı.");
      await this.hafiza.siniflandirmaKaydet(eposta, "teklif");
      return this.elleHazirla(epostaId, { teklifTalebiydi: true });
    }
    if (tur === "sustur") await this.hafiza.sustur(eposta.gonderenEposta, epostaId);
    else await this.hafiza.siniflandirmaKaydet(eposta, "teklif_degil");
    if (!islem || islem.belgeId || islem.durum === "isleniyor" || islem.durum === "cari_onayi_bekliyor") return islem ? gorunum(islem) : null;
    const not = tur === "sustur" ? `${eposta.gonderenEposta} susturuldu; bu adresten gelen e-postalar teklif talebi olarak işlenmeyecek.` : "Kullanıcı teklif talebi değil olarak işaretledi.";
    return gorunum(await this.kaydet(islem.id, { durum: "teklif_degil", uyarilar: [not], hata: null, sonrakiDenemeAt: null }));
  }

  /** Talep alınmış (durum `isleniyor`) kaydı baştan ya da kaldığı yerden işler. */
  async isle(kayit: Pick<EpostaTeklifIslemi, "id" | "gelenEpostaId" | "cikarim" | "cariId" | "deneme">, secenek: { cikarimiYenile?: boolean; yeniCari?: boolean; teklifTalebiydi?: boolean } = {}): Promise<TeklifIslemGorunumu> {
    const { tenantId } = aktifBaglam();
    let sonuc: Sonuc;
    let guven: number | null = null;
    let cikarim: Cikarim | null = !secenek.cikarimiYenile && kayit.cikarim ? cikarimSemasi.parse(kayit.cikarim) : null;
    try {
      const eposta = await this.prisma.tenantIslem(tenantId, (tx) => tx.gelenEposta.findFirst({
        where: { id: kayit.gelenEpostaId, tenantId },
        select: { id: true, konu: true, tarih: true, gonderenAdi: true, gonderenEposta: true, icerikMetin: true, otomatik: true, crmFirsatId: true, ekler: { select: { dosyaAdi: true } } },
      }));
      if (!eposta) throw new NotFoundException("E-posta bulunamadı");
      if (!cikarim && otomatikIletiMi(eposta)) {
        sonuc = { durum: "atlandi", uyarilar: ["Otomatik ileti (yanıt, bülten ya da teslim raporu); teklif talebi olarak işlenmedi."] };
      } else if (!cikarim && !secenek.teklifTalebiydi && (await this.hafiza?.susturulduMu(eposta.gonderenEposta))) {
        // AI-64: kullanıcı bu göndericiyi susturdu; model çağrılmaz.
        sonuc = { durum: "atlandi", uyarilar: [`${eposta.gonderenEposta} susturuldu ("Bu göndericiden teklif gelmez"); teklif talebi olarak işlenmedi. Hafıza ekranından geri alınabilir.`] };
      } else {
        const { saglayici } = await this.saglayiciBul(tenantId);
        if (!cikarim) {
          const ornekler = this.hafiza ? orneklerBlogu(await this.hafiza.siniflandirmaOrnekleri(), veriEtiketiTemizle) : "";
          cikarim = await saglayici.yapilandirilmisUretim({ sistemRol: CIKARIM_TALIMATI, prompt: cikarimIstemi({ ...eposta, ekAdlari: eposta.ekler.map((e) => e.dosyaAdi) }, ornekler) }, cikarimSemasi);
          await this.kaydet(kayit.id, { cikarim: cikarim as unknown as Prisma.InputJsonValue, guven: cikarim.guven });
        }
        // AI-64: kullanıcının "teklif talebiydi" sözü sınıflandırmanın yerine geçer; kalemleri yine model çıkarır.
        if (secenek.teklifTalebiydi && (!cikarim.teklifTalebi || cikarim.guven < ASGARI_GUVEN)) {
          cikarim = { ...cikarim, teklifTalebi: true, guven: Math.max(cikarim.guven, ASGARI_GUVEN), gerekce: `Kullanıcı teklif talebi olarak işaretledi. ${cikarim.gerekce}`.slice(0, 300) };
          await this.kaydet(kayit.id, { cikarim: cikarim as unknown as Prisma.InputJsonValue, guven: cikarim.guven });
        }
        guven = cikarim.guven;
        sonuc = await this.devamEt(eposta, cikarim, kayit.cariId, saglayici, { yeniCari: secenek.yeniCari });
      }
    } catch (hata) {
      const mesaj = (hata instanceof z.ZodError || hata instanceof SyntaxError ? "Yapay zekâ yanıtı beklenen biçimde değildi; yeniden denenecek." : hataMetni(hata)).slice(0, 2000);
      if (hata instanceof AiSinirHatasi) sonuc = { durum: "sinirda", uyarilar: [mesaj] };
      else {
        this.logger.warn(`Teklif talebi işlenemedi (${kayit.gelenEpostaId}): ${hataMetni(hata).slice(0, 2000)}`);
        const sonDeneme = kayit.deneme >= AZAMI_DENEME;
        const guncel = await this.kaydet(kayit.id, { durum: "hata", hata: mesaj, sonrakiDenemeAt: sonDeneme ? null : new Date(Date.now() + ON_DAKIKA_MS * kayit.deneme) });
        if (sonDeneme) await this.bildir(kayit.gelenEpostaId, "hata", "E-posta teklif talebi işlenemedi", mesaj, "/panel/eposta", "uyari");
        return gorunum(guncel);
      }
    }
    const guncel = await this.kaydet(kayit.id, {
      durum: sonuc.durum, uyarilar: sonuc.uyarilar, hata: null, sonrakiDenemeAt: null,
      ...(guven !== null ? { guven } : {}),
      ...(sonuc.kalemler ? { kalemler: sonuc.kalemler as unknown as Prisma.InputJsonValue } : {}),
      ...(sonuc.cariId !== undefined ? { cariId: sonuc.cariId } : {}),
      ...(sonuc.belgeId !== undefined ? { belgeId: sonuc.belgeId } : {}),
      ...(sonuc.firsatId !== undefined ? { firsatId: sonuc.firsatId } : {}),
      ...(sonuc.onayTalebiId !== undefined ? { onayTalebiId: sonuc.onayTalebiId } : {}),
      ...(sonuc.cariAdaylari ? { cariAdaylari: sonuc.cariAdaylari as unknown as Prisma.InputJsonValue } : {}),
    });
    await this.sonucuBildir(guncel);
    return gorunum(guncel);
  }

  /** Sınıflandırmadan sonrası: güven, cari, kalem eşleşmesi, taslak ve fırsat. */
  private async devamEt(eposta: Eposta, cikarim: Cikarim, bilinenCariId: string | null, saglayici: IAiProvider, secenek: { yeniCari?: boolean } = {}): Promise<Sonuc> {
    if (!cikarim.teklifTalebi) return { durum: "teklif_degil", uyarilar: [] };
    if (cikarim.guven < ASGARI_GUVEN) return { durum: "incelenmeli", uyarilar: [`Teklif talebi olabilir ama model emin değil (%${Math.round(cikarim.guven * 100)}): ${cikarim.gerekce}`] };
    if (!cikarim.kalemler.length) return { durum: "incelenmeli", uyarilar: ["Teklif talebi ama istenen ürün ya da hizmet çıkarılamadı."] };

    const adres = bilinenCariId ? { tek: bilinenCariId, adaylar: [bilinenCariId] } : await this.cariBul(eposta.gonderenEposta);
    const onUyarilar: string[] = [];
    let cariId = adres.tek;
    if (!cariId) {
      const cozum = secenek.yeniCari ? null : await this.cariCoz(eposta, cikarim, adres.adaylar);
      if (!cozum) return this.cariTalebi(eposta, cikarim);
      if ("sonuc" in cozum) return cozum.sonuc;
      cariId = cozum.cariId;
      onUyarilar.push(cozum.uyari);
    }
    const cari = { tek: cariId };

    const uyarilar: string[] = [...onUyarilar];
    // AI-63: modelin gördüğü kalıcı istekler öneri olarak; kullanıcı onaylamadan hiçbir yerde kullanılmaz.
    // Sağlayıcı çıktısı şemadan geçer; yine de alan eksikse (eski kayıt/sahte model) öneri yoktur.
    const kaliciTercihler = cikarim.kaliciTercihler ?? [];
    if (this.hafiza && kaliciTercihler.length) {
      const n = await this.hafiza.tercihOnerileri(cari.tek, kaliciTercihler, eposta.id);
      if (n) uyarilar.push(`${n} müşteri tercihi önerisi kaydedildi; onaylarsanız sonraki tekliflerde kullanılır.`);
    }
    const kalemler = await this.kalemleriEslestir(cikarim, saglayici, cari.tek);
    const eslesen = kalemler.filter((k) => k.stokId);
    const miktarli = (k: KalemSonucu) => `${k.ifade}${k.miktar !== null ? ` (${k.miktar}${k.birim ? ` ${k.birim}` : ""})` : ""}`;
    const eslesmeyenler = kalemler.filter((k) => !k.stokId && !k.belirsizKart).map(miktarli);
    for (const k of kalemler.filter((x) => x.hatirlandi)) uyarilar.push(`"${k.ifade}" önceki düzeltmeden hatırlandı: [${k.kod}] ${k.ad}.`);
    for (const k of kalemler.filter((x) => !x.stokId && x.belirsizKart)) {
      const b = k.belirsizKart!;
      uyarilar.push(`${b.kartKodu} – ${b.kartAdi} bulundu; müşteri hangisini istediğini belirtmemiş (${b.secenekler.join(" / ")}). Ölçüyü müşteriye sorun ya da taslağı doğru varyantla elle açın.`);
    }
    if (eslesmeyenler.length) uyarilar.push(`Stokta eşleşmeyen kalem: ${eslesmeyenler.join("; ")}`);
    if (!eslesen.length) return { durum: "incelenmeli", uyarilar, cariId: cari.tek, kalemler };
    const miktarsiz = eslesen.filter((k) => k.miktar === null);
    if (miktarsiz.length) uyarilar.push(`Miktar yazılmamış, 1 alındı: ${miktarsiz.map((k) => k.ifade).join("; ")}`);
    const ayni = (a: string, b: string) => a.trim().toLocaleLowerCase("tr-TR") === b.trim().toLocaleLowerCase("tr-TR");
    for (const k of eslesen) if (k.birim?.trim() && !(k.kartBirimi && ayni(k.birim, k.kartBirimi))) uyarilar.push(`"${k.ifade}" için istenen birim "${k.birim}"; satır kartın ana birimiyle${k.kartBirimi ? ` (${k.kartBirimi})` : ""} açıldı, kontrol edin.`);
    if (cikarim.notlar) uyarilar.push(`Müşteri notu: ${cikarim.notlar}`);
    // Fiyatı bulunamayan satır 0 ile açılır; fiyatı model değil kullanıcı belirler.
    const fiyatsiz: string[] = [];
    for (const k of eslesen) if (await this.fiyatYok(k, cari.tek)) fiyatsiz.push(k.stokId!);
    if (fiyatsiz.length) uyarilar.push(`Kayıtlı fiyatı olmayan ürün, taslakta 0 yazıldı: ${eslesen.filter((k) => fiyatsiz.includes(k.stokId!)).map((k) => k.ad ?? k.ifade).join("; ")}`);

    const belge = await this.taslakAc({
      tur: "teklif", cariId: cari.tek,
      aciklama: taslakAciklamasi(eposta, eslesmeyenler, cikarim.notlar, this.hafiza ? await this.hafiza.aktifTercihler(cari.tek) : []),
      satirlar: eslesen.map((k) => ({ stokId: k.stokId!, ...(k.varyantId ? { varyantId: k.varyantId } : {}), miktar: miktarMetni(k.miktar ?? 1), ...(fiyatsiz.includes(k.stokId!) ? { birimFiyat: "0" } : {}) })),
    });
    const firsat = await this.firsataBagla(eposta, cari.tek, belge.id).catch((hata: unknown) => {
      if (!(hata instanceof ForbiddenException)) uyarilar.push(`Fırsat bağı kurulamadı: ${hataMetni(hata)}`);
      return null;
    });
    return { durum: eslesmeyenler.length || miktarsiz.length || fiyatsiz.length || onUyarilar.length ? "incelenmeli" : "taslak_hazir", uyarilar, cariId: cari.tek, belgeId: belge.id, firsatId: firsat, kalemler };
  }

  /** Fiyat önerisi ucu (fiyat listesi → kart) TL'de fiyat bulamıyorsa; başka dövizdeki fiyatı taslak aracı çevirir. */
  private async fiyatYok(k: KalemSonucu, cariId: string): Promise<boolean> {
    const f = await this.uc.cagir<{ birimFiyat?: string | number | null; cevrilebilir?: boolean; kaynakDoviz?: string | null } | null>(
      UC.stokTavsiyeFiyat, [k.stokId, cariId, "satis", "TRY", undefined, "1", undefined, k.varyantId ?? undefined], { kaynak: "otomasyon", arac: "teklif_talebi" },
    );
    if (f?.cevrilebilir === false && f.kaynakDoviz && f.kaynakDoviz !== "TRY") return false;
    return f?.birimFiyat === null || f?.birimFiyat === undefined || Number(f.birimFiyat) <= 0;
  }

  /**
   * AI-46: seçilen carinin kartında ya da ilgili kişilerinde gönderen adresi
   * yoksa ilgili kişi olarak eklenir (ekranın ucu, rolü yazamayan için not).
   */
  private async gondereniOgret(epostaId: string, cariId: string): Promise<string | null> {
    const { tenantId } = aktifBaglam();
    const { eposta, kayitli } = await this.prisma.tenantIslem(tenantId, async (tx) => {
      const e = await tx.gelenEposta.findFirst({ where: { id: epostaId, tenantId }, select: { gonderenAdi: true, gonderenEposta: true } });
      const adres = e?.gonderenEposta.trim() ?? "";
      const var_ = adres ? await tx.cariHesap.count({ where: { id: cariId, tenantId, OR: [{ eposta: { equals: adres, mode: "insensitive" } }, { kisiler: { some: { eposta: { equals: adres, mode: "insensitive" } } } }] } }) : 1;
      return { eposta: e, kayitli: var_ > 0 };
    });
    // AI-62: seçim ilgili kişi eklenemese de (rol) hafızada kalır.
    if (eposta?.gonderenEposta.trim()) await this.hafiza?.cariOgret(eposta.gonderenEposta, cariId, epostaId);
    if (!eposta || kayitli || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(eposta.gonderenEposta)) return null;
    const adSoyad = (eposta.gonderenAdi?.trim() || eposta.gonderenEposta.split("@")[0]).slice(0, 120).padEnd(2, ".");
    try {
      await this.uc.cagir(UC.cariKisiEkle, [cariId, { adSoyad, eposta: eposta.gonderenEposta.trim() }], { kaynak: "otomasyon", arac: "teklif_talebi" });
      return `${eposta.gonderenEposta} carinin ilgili kişilerine eklendi; bu adresten gelen e-postalar artık bu cariyle eşleşir.`;
    } catch (hata) {
      return hata instanceof ForbiddenException
        ? `${eposta.gonderenEposta} ilgili kişi olarak eklenemedi (rolünüz cari kartını düzenleyemiyor); muhasebe ya da yönetici ekleyebilir.`
        : `${eposta.gonderenEposta} ilgili kişi olarak eklenemedi: ${hataMetni(hata)}`;
    }
  }

  /** AI-34: gönderen adresi tek bir aktif cariye ait olmalı (kart ya da ilgili kişi). */
  private async cariBul(gonderen: string): Promise<{ tek: string | null; adaylar: string[] }> {
    const { tenantId } = aktifBaglam();
    const adres = gonderen.trim();
    if (!adres) return { tek: null, adaylar: [] };
    const [kartlar, kisiler] = await this.prisma.tenantIslem(tenantId, (tx) => Promise.all([
      tx.cariHesap.findMany({ where: { tenantId, aktif: true, eposta: { equals: adres, mode: "insensitive" } }, select: { id: true }, take: 5 }),
      tx.cariKisi.findMany({ where: { tenantId, eposta: { equals: adres, mode: "insensitive" }, cari: { aktif: true } }, select: { cariId: true }, take: 5 }),
    ]));
    const hafizadan = (await this.hafiza?.adresCarileri(adres)) ?? [];
    const adaylar = [...new Set([...kartlar.map((k) => k.id), ...kisiler.map((k) => k.cariId), ...hafizadan])];
    return { tek: adaylar.length === 1 ? adaylar[0] : null, adaylar };
  }

  /**
   * AI-44/45: kesin eşleşme yoksa. Adres birden çok caride kayıtlıysa ya da
   * yaklaşık ipucu (telefon, alan adı, unvan) varsa kullanıcıya seçtirilir;
   * yalnız tek VKN/TCKN eşleşmesi kendiliğinden kullanılır (uyarıyla).
   * `null`: aday yok, cari açma talebine geçilir.
   */
  private async cariCoz(eposta: Eposta, cikarim: Cikarim, adresAdaylari: string[]): Promise<{ cariId: string; uyari: string } | { sonuc: Sonuc } | null> {
    const { tenantId } = aktifBaglam();
    const firma = cikarim.firma;
    const adaylar = await this.prisma.tenantIslem(tenantId, async (tx) => {
      if (adresAdaylari.length > 1) {
        const kartlar = await tx.cariHesap.findMany({ where: { tenantId, id: { in: adresAdaylari } }, select: { id: true, kod: true, unvan: true, vknTckn: true } });
        return kartlar.map((k): CariAdayi => ({ cariId: k.id, kod: k.kod, unvan: k.unvan, vknTckn: k.vknTckn, gerekceler: ["gönderen adresi bu caride kayıtlı"], guclu: false, puan: 50 }));
      }
      return cariAdaylari(tx, tenantId, { eposta: eposta.gonderenEposta, vknTckn: firma?.vknTckn, telefon: firma?.telefon, unvan: firma?.unvan ?? eposta.gonderenAdi });
    });
    const guclu = adaylar.filter((a) => a.guclu);
    if (guclu.length === 1) {
      const a = guclu[0];
      return { cariId: a.cariId, uyari: `Gönderen adresi kayıtlı değil; e-postadaki VKN/TCKN (${a.vknTckn}) ile "${a.unvan}" carisine eşlendi. Doğru cari olduğunu kontrol edin.` };
    }
    if (!adaylar.length) return null;
    return { sonuc: {
      durum: "cari_secimi", cariAdaylari: adaylar,
      uyarilar: [adresAdaylari.length > 1
        ? `Gönderen adresi ${adresAdaylari.length} caride kayıtlı; doğru cariyi seçin.`
        : `Gönderen hiçbir cariyle kesin eşleşmedi; ${adaylar.length} olası cari bulundu. Doğru cariyi seçin ya da yeni cari açın.`],
    } };
  }

  /** Cari yoksa: onaya tabi cari açma talebi (sorumlu onaylarsa taslak sonra hazırlanır). */
  private async cariTalebi(eposta: Eposta, cikarim: Cikarim): Promise<Sonuc> {
    const { tenantId, rol } = aktifBaglam();
    const kodlar = await this.prisma.tenantIslem(tenantId, (tx) => tx.cariHesap.findMany({ where: { tenantId, kod: { startsWith: "CARI-" } }, select: { kod: true } }));
    const firma = cikarim.firma;
    const girdi = {
      kod: cariKoduOner(kodlar.map((k) => k.kod)),
      unvan: firma?.unvan && firma.unvan.length >= 2 ? firma.unvan : varsayilanUnvan(eposta.gonderenAdi, eposta.gonderenEposta),
      tip: "musteri",
      eposta: eposta.gonderenEposta,
      ...(firma?.telefon ? { telefon: firma.telefon } : {}),
      ...(firma?.vknTckn && /^\d{10,11}$/.test(firma.vknTckn) ? { vknTckn: firma.vknTckn, kisiTipi: firma.vknTckn.length === 11 ? "gercek" : "tuzel" } : {}),
    };
    const izinli = new Map(this.yurutucu.izinliAraclar(rol as Rol).map((a) => [a.ad, a]));
    const sonuc = await this.yurutucu.yurut({ ad: "cari_olustur", girdi }, izinli, { kaynak: "otomasyon" });
    if (sonuc.hata || !sonuc.talep) return { durum: "cari_yok", uyarilar: [`Gönderen hiçbir cariyle eşleşmedi; cari açma talebi oluşturulamadı: ${sonuc.icerik.replace(/^Hata: /, "")}`] };
    return { durum: "cari_onayi_bekliyor", uyarilar: [`Gönderen hiçbir cariyle eşleşmedi. "${girdi.unvan}" (${girdi.kod}) için cari açma onayı bekleniyor; onaylanınca taslak hazırlanır.`], onayTalebiId: sonuc.talep.id };
  }

  /**
   * AI-35: her kalem için en çok 5 stok adayı; model yalnız bu adaylardan seçebilir.
   * AI-61: aynı caride hafızadaki ifade modele sorulmadan eşlenir; başka carinin
   * hafızası yalnız ilk aday olur.
   */
  private async kalemleriEslestir(cikarim: Cikarim, saglayici: IAiProvider, cariId: string): Promise<KalemSonucu[]> {
    const hatira = this.hafiza ? await this.hafiza.urunleriHatirla(cariId, cikarim.kalemler.map((k) => k.ifade)) : null;
    const kesinler = cikarim.kalemler.map((k) => hatira?.kesin.get(ifadeAnahtari(k.ifade)) ?? null);
    const kesinAdaylar = await Promise.all(kesinler.map((h) => (h ? this.hafizaAdayi(h.stokId, h.varyantId) : null)));
    const adaylar: StokAdayi[][] = [];
    for (const [i, k] of cikarim.kalemler.entries()) {
      if (kesinAdaylar[i]) { adaylar.push([]); continue; }
      let liste = await this.stokAdaylari(k.ifade);
      for (const yedek of liste.length ? [] : yedekAramalar(k.ifade)) {
        liste = await this.stokAdaylari(yedek);
        if (liste.length) break;
      }
      const hafizaAdaylari = (await Promise.all((hatira?.aday.get(ifadeAnahtari(k.ifade)) ?? []).map((h) => this.hafizaAdayi(h.stokId, h.varyantId))))
        .filter((a): a is StokAdayi => Boolean(a))
        .map((a) => ({ ...a, hafizadan: true }));
      const ayni = (a: StokAdayi, b: StokAdayi) => a.stokId === b.stokId && a.varyantId === b.varyantId;
      adaylar.push([...hafizaAdaylari, ...liste.filter((a) => !hafizaAdaylari.some((h) => ayni(h, a)))].slice(0, ADAY_SAYISI));
    }
    const secilen = adaylar.some((a) => a.length)
      ? secimleriUygula(adaylar, (await saglayici.yapilandirilmisUretim({ sistemRol: ESLESME_TALIMATI, prompt: eslesmeIstemi(cikarim.kalemler, adaylar) }, eslesmeSemasi)).secimler)
      : adaylar.map(() => null);
    await this.hafiza?.kullanildi(kesinler.filter((h, i) => h && kesinAdaylar[i]).map((h) => h!.id));
    return cikarim.kalemler.map((k, i) => {
      const hatirlanan = kesinAdaylar[i];
      if (hatirlanan) return { ...k, stokId: hatirlanan.stokId, varyantId: hatirlanan.varyantId, kod: hatirlanan.kod, ad: hatirlanan.ad, kartBirimi: hatirlanan.birim, hatirlandi: true };
      const belirsiz = secilen[i] ? null : varyantBelirsizligi(adaylar[i]);
      return { ...k, stokId: secilen[i]?.stokId ?? null, varyantId: secilen[i]?.varyantId ?? null, kod: secilen[i]?.kod ?? null, ad: secilen[i]?.ad ?? null, kartBirimi: secilen[i]?.birim ?? null, ...(belirsiz ? { belirsizKart: belirsiz } : {}) };
    });
  }

  /** Hafızadaki kart/varyant, stok adayı biçiminde (aktif değilse null). */
  private async hafizaAdayi(stokId: string, varyantId: string | null): Promise<StokAdayi | null> {
    const { tenantId } = aktifBaglam();
    const [kart, varyant] = await this.prisma.tenantIslem(tenantId, (tx) => Promise.all([
      tx.stokKart.findFirst({ where: { id: stokId, tenantId, aktif: true }, select: { id: true, kod: true, ad: true, anaBirim: true } }),
      varyantId ? tx.stokVaryant.findFirst({ where: { id: varyantId, stokId, tenantId, aktif: true }, select: { id: true, kod: true, ad: true } }) : null,
    ]));
    if (!kart || (varyantId && !varyant)) return null;
    return varyant
      ? { stokId: kart.id, varyantId: varyant.id, kod: varyant.kod ?? kart.kod, ad: `${kart.ad} — ${varyant.ad ?? varyant.kod}`, birim: kart.anaBirim ?? null, kartKodu: kart.kod, kartAdi: kart.ad, varyantAdi: varyant.ad ?? varyant.kod }
      : { stokId: kart.id, varyantId: null, kod: kart.kod, ad: kart.ad, birim: kart.anaBirim ?? null };
  }

  private async stokAdaylari(arama: string): Promise<StokAdayi[]> {
    const yanit = await this.uc.cagir<{ kayitlar?: Array<Record<string, any>> }>(UC.stokListe, [arama, undefined, undefined, String(ADAY_SAYISI)], { kaynak: "otomasyon", arac: "teklif_talebi" });
    const sonuc: StokAdayi[] = [];
    for (const s of (yanit.kayitlar ?? []).filter((x) => x.aktif !== false)) {
      const varyantlar = (s.varyantlar ?? []).filter((v: Record<string, any>) => v.aktif !== false);
      if (varyantlar.length) for (const v of varyantlar) sonuc.push({ stokId: s.id, varyantId: v.id, kod: v.kod ?? s.kod, ad: `${s.ad} — ${v.ad ?? v.kod}`, birim: s.anaBirim ?? null, kartKodu: s.kod, kartAdi: s.ad, varyantAdi: v.ad ?? v.kod });
      else sonuc.push({ stokId: s.id, varyantId: null, kod: s.kod, ad: s.ad, birim: s.anaBirim ?? null });
    }
    return sonuc.slice(0, ADAY_SAYISI);
  }

  /** Taslak, asistanın taslak aracıyla aynı yoldan (fiyat listesi/kart fiyatı, KDV karttan) açılır. */
  private async taslakAc(girdi: Record<string, unknown>): Promise<{ id: string }> {
    const { rol } = aktifBaglam();
    const arac = this.yurutucu.izinliAraclar(rol as Rol).find((a) => a.ad === "belge_taslagi_olustur");
    if (!arac) throw new ForbiddenException("Rolünüz teklif taslağı açamıyor.");
    return arac.calistir({ uc: this.uc, kaynak: "otomasyon", arac: arac.ad }, arac.girdi.parse(girdi)) as Promise<{ id: string }>;
  }

  /** AI-36: e-postanın fırsatı yoksa açılır; taslak fırsata bağlanır (CRM belge bağları açıksa). */
  private async firsataBagla(eposta: Eposta, cariId: string, belgeId: string): Promise<string | null> {
    const { tenantId, userId } = aktifBaglam();
    const iz = { kaynak: "otomasyon" as const, arac: "teklif_talebi" };
    let firsat: { id: string } | null = null;
    if (eposta.crmFirsatId) {
      firsat = await this.prisma.tenantIslem(tenantId, (tx) => tx.crmFirsat.findFirst({ where: { id: eposta.crmFirsatId!, tenantId, cariId }, select: { id: true } }));
    }
    firsat ??= await this.uc.cagir<{ id: string }>(UC.gelenEpostaCrmGorev, [eposta.id, { sorumluUserId: userId, cariId }], iz);
    // Bağlama ucu eşzamanlı değişikliği zaman damgalarıyla denetler; ikisi de güncel kayıttan okunur.
    const [guncelFirsat, belge] = await this.prisma.tenantIslem(tenantId, (tx) => Promise.all([
      tx.crmFirsat.findFirstOrThrow({ where: { id: firsat!.id, tenantId }, select: { updatedAt: true } }),
      tx.belge.findFirstOrThrow({ where: { id: belgeId, tenantId }, select: { updatedAt: true } }),
    ]));
    await this.uc.cagir(UC.crmTeklifBagla, [firsat.id, {
      belgeId, istekAnahtari: randomUUID(), gerekce: "E-posta teklif talebinden hazırlanan taslak",
      beklenenFirsatZamani: guncelFirsat.updatedAt.toISOString(), beklenenBelgeZamani: belge.updatedAt.toISOString(),
    }], iz).catch((hata: unknown) => {
      // Belge bağları kapalı ya da rol yazamıyorsa fırsat yine de e-postaya bağlı kalır.
      if (hata instanceof ForbiddenException) return null;
      throw hata;
    });
    return firsat.id;
  }

  private kaydet(id: string, veri: Prisma.EpostaTeklifIslemiUpdateInput): Promise<EpostaTeklifIslemi> {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, (tx) => tx.epostaTeklifIslemi.update({ where: { id }, data: { ...veri, updatedAt: new Date() } }));
  }

  /** AI-37: sonucu çalıştıran kullanıcıya bildirir; teklif olmayan ve atlanan iletiler sessizdir. */
  private async sonucuBildir(k: EpostaTeklifIslemi): Promise<void> {
    const uyarilar = (k.uyarilar as string[]) ?? [];
    const ozet = uyarilar.join(" ").slice(0, 1500);
    if (k.durum === "taslak_hazir") await this.bildir(k.gelenEpostaId, k.durum, "E-postadan teklif taslağı hazır", "Teklif talebinden taslak teklif açıldı. Kontrol edip onaylayın; gönderim ayrıca onay ister.", adres.belge(k.belgeId!), "bilgi");
    else if (k.durum === "incelenmeli") await this.bildir(k.gelenEpostaId, k.durum, k.belgeId ? "E-postadan teklif taslağı: kontrol gerekli" : "E-posta teklif talebi incelenmeli", ozet || "Teklif talebi inceleme bekliyor.", k.belgeId ? adres.belge(k.belgeId) : "/panel/eposta", "uyari");
    else if (k.durum === "cari_secimi") await this.bildir(k.gelenEpostaId, k.durum, "E-posta teklif talebi: cari seçimi bekliyor", `${ozet} Adaylar: ${((k.cariAdaylari as unknown as CariAdayi[]) ?? []).map((a) => `${a.unvan} (${a.gerekceler.join(", ")})`).join("; ")}`.slice(0, 1500), "/panel/eposta", "uyari");
    else if (k.durum === "cari_yok") await this.bildir(k.gelenEpostaId, k.durum, "E-posta teklif talebi: cari bulunamadı", ozet, "/panel/eposta", "uyari");
    else if (k.durum === "sinirda") await this.bildir(k.gelenEpostaId, k.durum, "E-posta teklif talebi işlenmedi: yapay zekâ sınırı", ozet, "/panel/ayarlar/yapay-zeka", "uyari");
    // cari_onayi_bekliyor: onay talebi kendi bildirimini üretir.
  }

  private async bildir(epostaId: string, durum: string, baslik: string, aciklama: string, hedefYol: string, onem: "bilgi" | "uyari"): Promise<void> {
    const { userId } = aktifBaglam();
    await this.bildirimler.uret({
      tur: "yapay_zeka", onem, baslik, aciklama: aciklama.slice(0, 1500), hedefYol,
      birlesimAnahtari: `yapay_zeka:teklif_talebi:${epostaId}:${durum}`, kaynakTur: "gelen_eposta", kaynakRef: epostaId,
      roller: [], kullaniciIdler: [userId],
    }).catch((hata: unknown) => this.logger.warn(`Teklif talebi bildirimi üretilemedi: ${String(hata)}`));
  }

  /** Worker: açık kiracılarda yeni e-postalar, yeniden denenecek hatalar ve onaylanan cariler. */
  // Zamanlayıcıdan çağrılır: veritabanı anlık erişilemezse hata yakalanmadan süreci düşürmesin, sonraki turda yeniden dener.
  private async taraGuvenli(): Promise<void> {
    try { await this.tara(); }
    catch (hata) { this.logger.error(`Teklif talebi taraması başarısız: ${hata instanceof Error ? hata.message.split("\n").filter(Boolean).pop() : String(hata)}`); }
  }

  async tara(): Promise<void> {
    if (this.calisiyor) return;
    this.calisiyor = true;
    try {
      const url = process.env.DATABASE_URL_MIGRATE;
      if (!url) return;
      const yonetim = new PrismaClient({ datasourceUrl: url });
      let kiracilar: Array<{ tenantId: string; ayarlar: unknown }>;
      let bekleyenKiracilar: string[];
      let ogrenecekKiracilar: string[];
      try {
        kiracilar = await yonetim.modulAyar.findMany({ where: { modul: TEKLIF_TALEBI_MODULU }, select: { tenantId: true, ayarlar: true } });
        bekleyenKiracilar = (await yonetim.epostaTeklifIslemi.findMany({ where: { durum: "cari_onayi_bekliyor" }, select: { tenantId: true }, distinct: ["tenantId"] })).map((x) => x.tenantId);
        ogrenecekKiracilar = this.hafiza ? (await yonetim.epostaTeklifIslemi.findMany({ where: { belgeId: { not: null }, hafizaIslendiAt: null }, select: { tenantId: true }, distinct: ["tenantId"] })).map((x) => x.tenantId) : [];
      } finally {
        await yonetim.$disconnect().catch(() => undefined);
      }
      // Onay bekleyen cariler özellik kapalıyken de izlenir (elle başlatılan talepler).
      // PLT-05: askıdaki firmada e-postadan teklif hattı (yapay zekâ dahil) durur.
      const durdu = async (tenantId: string) => Boolean(await this.erisim?.otomasyonDurdu(tenantId));
      for (const tenantId of bekleyenKiracilar) {
        if (await durdu(tenantId)) continue;
        try { await baglamlaCalistir({ tenantId, userId: SISTEM_USER_ID, rol: "yonetici" }, () => this.bekleyenCarileriIzle()); }
        catch (hata) { this.logger.error(`Cari onayı izlenemedi (${tenantId}): ${hataMetni(hata)}`); }
      }
      // AI-61: onaylanan tekliflerden öğrenme (özellik kapalıyken de; elle hazırlananlar dahil).
      for (const tenantId of ogrenecekKiracilar) {
        if (await durdu(tenantId)) continue;
        try { await baglamlaCalistir({ tenantId, userId: SISTEM_USER_ID, rol: "yonetici" }, () => this.hafiza!.tekliftenOgren()); }
        catch (hata) { this.logger.error(`Tekliften öğrenilemedi (${tenantId}): ${hataMetni(hata)}`); }
      }
      for (const k of kiracilar) {
        const ayar = teklifTalebiAyariSemasi.safeParse(k.ayarlar);
        if (!ayar.success || !ayar.data.acik || !ayar.data.sorumluUserId || !ayar.data.acildiAt) continue;
        if (await durdu(k.tenantId)) continue;
        try { await this.kiraciTara(k.tenantId, ayar.data); }
        catch (hata) { this.logger.error(`Teklif talebi taraması başarısız (${k.tenantId}): ${hataMetni(hata)}`); }
      }
    } finally {
      this.calisiyor = false;
    }
  }

  async kiraciTara(tenantId: string, ayar: TeklifTalebiAyari, simdi = new Date()): Promise<number> {
    const sorumlu = await this.prisma.tenantIslem(tenantId, (tx) => tx.user.findFirst({ where: { id: ayar.sorumluUserId!, tenantId, aktif: true, rol: { in: [...TEKLIF_TALEBI_ROLLERI] } }, select: { id: true, rol: true } }));
    if (!sorumlu) { this.logger.warn(`Teklif talebi sorumlusu etkin değil ya da yetkisiz (${tenantId}); tarama atlandı`); return 0; }
    const acildi = new Date(ayar.acildiAt!);
    return baglamlaCalistir({ tenantId, userId: sorumlu.id, rol: sorumlu.rol as Rol }, async () => {
      let islenen = 0;
      // Yeni e-postalar ve zamanı gelen hatalar.
      const yeniler = await this.prisma.tenantIslem(tenantId, (tx) => tx.gelenEposta.findMany({
        where: { tenantId, createdAt: { gte: acildi }, tarih: { gte: new Date(acildi.getTime() - GERIYE_TOLERANS_MS) }, teklifIslemi: { is: null } },
        select: { id: true }, orderBy: { createdAt: "asc" }, take: TARAMA_PARTISI,
      }));
      for (const e of yeniler) {
        const kayit = await this.prisma.tenantIslem(tenantId, (tx) => tx.epostaTeklifIslemi.create({ data: { tenantId, gelenEpostaId: e.id, calistiranUserId: sorumlu.id, durum: "isleniyor" } }))
          .catch((hata: unknown) => { if (hata instanceof Prisma.PrismaClientKnownRequestError && hata.code === "P2002") return null; throw hata; });
        if (!kayit) continue;
        await this.isle(kayit);
        islenen++;
      }
      const tekrar = await this.prisma.tenantIslem(tenantId, (tx) => tx.epostaTeklifIslemi.findMany({
        where: { tenantId, OR: [
          { durum: "hata", deneme: { lt: AZAMI_DENEME }, sonrakiDenemeAt: { lte: simdi } },
          { durum: "isleniyor", updatedAt: { lt: new Date(simdi.getTime() - 15 * 60 * 1000) } },
        ] },
        take: TARAMA_PARTISI,
      }));
      for (const t of tekrar) {
        const alindi = await this.prisma.tenantIslem(tenantId, (tx) => tx.epostaTeklifIslemi.updateMany({ where: { id: t.id, durum: t.durum, updatedAt: t.updatedAt }, data: { durum: "isleniyor", deneme: { increment: 1 }, updatedAt: new Date() } }));
        if (!alindi.count) continue;
        await this.isle({ ...t, deneme: t.deneme + 1 });
        islenen++;
      }
      return islenen;
    });
  }

  /** Onay bekleyen cari talepleri: onaylandıysa taslağa devam, reddedildiyse "cari yok". */
  async bekleyenCarileriIzle(): Promise<number> {
    const { tenantId } = aktifBaglam();
    const bekleyenler = await this.prisma.tenantIslem(tenantId, (tx) => tx.epostaTeklifIslemi.findMany({ where: { tenantId, durum: "cari_onayi_bekliyor", onayTalebiId: { not: null } }, take: TARAMA_PARTISI }));
    let islenen = 0;
    for (const b of bekleyenler) islenen += await this.cariOnayiniIzle(b);
    return islenen;
  }

  /** Cari açma talebinin sonucu; talebi açan kullanıcının bağlamında devam edilir. */
  private async cariOnayiniIzle(k: EpostaTeklifIslemi): Promise<number> {
    const { tenantId } = aktifBaglam();
    const talep = await this.prisma.tenantIslem(tenantId, (tx) => tx.aiOnayTalebi.findFirst({ where: { id: k.onayTalebiId!, tenantId }, select: { durum: true, sonuc: true, userId: true, user: { select: { rol: true, aktif: true } } } }));
    if (!talep || talep.durum === "bekliyor" || talep.durum === "isleniyor") return 0;
    const cariId = talep.durum === "onaylandi" ? (talep.sonuc as { id?: string } | null)?.id ?? null : null;
    const alindi = await this.prisma.tenantIslem(tenantId, (tx) => tx.epostaTeklifIslemi.updateMany({ where: { id: k.id, durum: "cari_onayi_bekliyor" }, data: cariId ? { durum: "isleniyor", cariId, updatedAt: new Date() } : { durum: "cari_yok", uyarilar: [`Cari açma talebi ${talep.durum === "reddedildi" ? "reddedildi" : talep.durum === "suresi_doldu" ? "süresi doldu" : "tamamlanamadı"}; taslak hazırlanmadı.`], updatedAt: new Date() } }));
    if (!alindi.count || !cariId) return alindi.count;
    if (!talep.user.aktif) return 0;
    await baglamlaCalistir({ tenantId, userId: talep.userId, rol: talep.user.rol as Rol }, () => this.isle({ ...k, cariId }));
    return 1;
  }
}
