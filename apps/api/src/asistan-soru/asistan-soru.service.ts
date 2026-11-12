import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, Optional } from "@nestjs/common";
import { Prisma, type AsistanSorusu, type Rol } from "@prisma/client";
import { AracYurutucu } from "../ai/ajan/arac-yurutucu";
import { HafizaService } from "../ai/hafiza/hafiza.service";
import { BildirimUreticiService } from "../bildirimler/bildirim-uretici.service";
import { aktifBaglam } from "../core/istek-baglami";
import { PrismaService } from "../core/prisma.service";
import { EkstreEslestirmeService } from "../kasa-banka/ekstre-eslestirme.service";
import { ImapService } from "../tenant/imap.service";
import { MasrafBelgeService } from "./masraf-belge.service";
import {
  bankaSorusu, epostaSorusu, gunFarki, maasSatiriMi, PANEL_SECENEGI, TARAMA_SORU_SINIRI, taslakSapmasi, taslakSorusu, type Secenek, type SoruTuru, type TaslakSapmasi,
} from "./asistan-soru.kurallari";

const ARALIK_MS = 30 * 60 * 1000;
const GUN = 86_400_000;
const FINANS_ROLLERI: Rol[] = ["yonetici", "muhasebe"];
const SATIS_ROLLERI: Rol[] = ["yonetici", "muhasebe", "satis"];

export interface SoruYaniti { kod?: string; metin?: string }
export interface YanitSonucu { sonuc: string; talepId?: string }

type BankaVerisi = { onerilenCariId: string | null; karsiUnvan: string | null };
type EpostaVerisi = { gonderenEposta: string; adaylar: Array<{ cariId: string; unvan: string }> };
type TaslakVerisi = { cariId: string; tarih: string; sapma: TaslakSapmasi };

/** Kullanıcıya gösterilen soru (panel "Sorular" kutusu ve Telegram). */
export function soruGorunumu(s: AsistanSorusu) {
  return {
    id: s.id, tur: s.tur, soru: s.soru, secenekler: (s.secenekler as unknown as Secenek[]).filter((x) => x.kod !== PANEL_SECENEGI.kod),
    serbestYanit: s.serbestYanit, durum: s.durum, sonuc: s.sonuc, createdAt: s.createdAt.toISOString(), yanitAt: s.yanitAt?.toISOString() ?? null,
  };
}

/**
 * CNL-09/10: asistanın soruları. Üretim bildirim taramasına eklenir (worker, firma başına 30 dk);
 * yanıt panelden ya da Telegram'dan gelir ve hafızaya yazılır. Kesin işlem (banka eşleştirmesi)
 * onay talebiyle yapılır; taslak doğrudan düzeltilir (asistanın yetki kuralı, AI-03).
 */
@Injectable()
export class AsistanSoruService {
  private readonly logger = new Logger(AsistanSoruService.name);
  private readonly sonTarama = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly ekstre: EkstreEslestirmeService,
    private readonly imap: ImapService,
    private readonly hafiza: HafizaService,
    private readonly yurutucu: AracYurutucu,
    private readonly masrafBelge: MasrafBelgeService,
    @Optional() uretici?: BildirimUreticiService,
  ) {
    uretici?.ekTaramaKaydet("asistan soruları", () => this.tara());
  }

  // ─── ÜRETİM ────────────────────────────────────────────────────────────────

  async tara(simdi = new Date()): Promise<number> {
    const { tenantId } = aktifBaglam();
    if ((this.sonTarama.get(tenantId) ?? 0) > simdi.getTime() - ARALIK_MS) return 0;
    this.sonTarama.set(tenantId, simdi.getTime());
    if (this.sonTarama.size > 50_000) this.sonTarama.clear();
    await this.gecersizleriKapat();
    let acilan = 0;
    for (const uret of [() => this.bankaSorulari(simdi), () => this.epostaSorulari(simdi), () => this.taslakSorulari(simdi)]) {
      if (acilan >= TARAMA_SORU_SINIRI) break;
      acilan += await uret().catch((h: unknown) => { this.logger.warn(`Asistan sorusu üretilemedi: ${h instanceof Error ? h.message : String(h)}`); return 0; });
    }
    return acilan;
  }

  private async sorulmusKaynaklar(tur: SoruTuru, idler: string[]): Promise<Set<string>> {
    const { tenantId } = aktifBaglam();
    if (!idler.length) return new Set();
    const l = await this.prisma.tenantIslem(tenantId, (tx) => tx.asistanSorusu.findMany({ where: { tur, kaynakId: { in: idler } }, select: { kaynakId: true } }));
    return new Set(l.map((x) => x.kaynakId));
  }

  private async ac(tur: SoruTuru, kaynakId: string, roller: Rol[], s: { soru: string; secenekler: Secenek[] }, veri: object, serbestYanit: boolean): Promise<boolean> {
    const { tenantId } = aktifBaglam();
    try {
      await this.prisma.tenantIslem(tenantId, (tx) => tx.asistanSorusu.create({ data: { tenantId, tur, kaynakId, roller, soru: s.soru, secenekler: s.secenekler as unknown as Prisma.InputJsonValue, veri: veri as Prisma.InputJsonValue, serbestYanit } }));
      return true;
    } catch (hata) {
      if (hata instanceof Prisma.PrismaClientKnownRequestError && hata.code === "P2002") return false;
      throw hata;
    }
  }

  /** Kesin önerisi olmayan, en az bir saattir bekleyen, son 30 günün banka satırları. Maaş satırları sorulmaz. */
  private async bankaSorulari(simdi: Date): Promise<number> {
    const { tenantId } = aktifBaglam();
    const satirlar = await this.prisma.tenantIslem(tenantId, (tx) => tx.bankaEkstreSatir.findMany({
      where: { durum: "beklemede", createdAt: { lt: new Date(simdi.getTime() - 60 * 60 * 1000) }, tarih: { gte: new Date(simdi.getTime() - 30 * GUN) } },
      select: { id: true, aciklama: true, karsiUnvan: true }, orderBy: { tarih: "desc" }, take: 30,
    }));
    const sorulmus = await this.sorulmusKaynaklar("banka_satiri", satirlar.map((s) => s.id));
    let acilan = 0;
    for (const s of satirlar) {
      if (acilan >= TARAMA_SORU_SINIRI || sorulmus.has(s.id) || maasSatiriMi(s.aciklama, s.karsiUnvan)) continue;
      if (await this.ekstre.kesinOneri(s.id)) continue;
      const aday = await this.ekstre.soruAdayi(s.id);
      if (!aday || aday.onerilenCari?.tip === "personel") continue;
      const metin = bankaSorusu({ ...aday.satir, onerilenCari: aday.onerilenCari });
      if (await this.ac("banka_satiri", s.id, FINANS_ROLLERI, metin, { onerilenCariId: aday.onerilenCari?.id ?? null, karsiUnvan: aday.satir.karsiUnvan } satisfies BankaVerisi, true)) acilan++;
    }
    return acilan;
  }

  /**
   * Tanınmayan gönderen: cariye bağlanmamış, hafızada eşleşmesi ya da susturması olmayan e-posta.
   * Bülten/istenmeyen ileti gürültüsünü önlemek için yalnız en az bir cari adayı olan sorulur.
   */
  private async epostaSorulari(simdi: Date): Promise<number> {
    const { tenantId } = aktifBaglam();
    const epostalar = await this.prisma.tenantIslem(tenantId, (tx) => tx.gelenEposta.findMany({
      where: { durum: "yeni", cariId: null, createdAt: { gte: new Date(simdi.getTime() - 7 * GUN), lt: new Date(simdi.getTime() - 10 * 60 * 1000) } },
      select: { id: true, gonderenAdi: true, gonderenEposta: true, konu: true }, orderBy: { createdAt: "desc" }, take: 30,
    }));
    const sorulmus = await this.sorulmusKaynaklar("eposta_gonderen", epostalar.map((e) => e.id));
    const adresler = new Set<string>();
    let acilan = 0;
    for (const e of epostalar) {
      const adres = e.gonderenEposta.trim().toLowerCase();
      if (acilan >= TARAMA_SORU_SINIRI || sorulmus.has(e.id) || !adres || adresler.has(adres)) continue;
      adresler.add(adres);
      if (await this.hafiza.susturulduMu(adres) || (await this.hafiza.adresCarileri(adres)).length) continue;
      const adaylar = (await this.imap.cariAdaylariGetir(tenantId, e.id)).map((a) => ({ cariId: a.cariId, unvan: a.unvan }));
      if (!adaylar.length) continue;
      const metin = epostaSorusu({ gonderenAdi: e.gonderenAdi, gonderenEposta: e.gonderenEposta, konu: e.konu, adaylar });
      if (await this.ac("eposta_gonderen", e.id, SATIS_ROLLERI, metin, { gonderenEposta: e.gonderenEposta, adaylar: adaylar.slice(0, 3) } satisfies EpostaVerisi, true)) acilan++;
    }
    return acilan;
  }

  /** Son 7 günün, en az 30 dakikadır dokunulmayan satış taslakları; carinin son 10 kesin satışıyla kıyaslanır. */
  private async taslakSorulari(simdi: Date): Promise<number> {
    const { tenantId } = aktifBaglam();
    const taslaklar = await this.prisma.tenantIslem(tenantId, (tx) => tx.fatura.findMany({
      where: { tip: "satis", durum: "taslak", createdAt: { gte: new Date(simdi.getTime() - 7 * GUN) }, updatedAt: { lt: new Date(simdi.getTime() - 30 * 60 * 1000) } },
      select: { id: true, cariId: true, tarih: true, vadeTarihi: true, genelToplam: true, dovizCinsi: true, toplamBrut: true, toplamSatirIskontosu: true, genelIskontoToplam: true, cari: { select: { unvan: true, varsayilanVadeGun: true } } },
      orderBy: { createdAt: "desc" }, take: 30,
    }));
    const sorulmus = await this.sorulmusKaynaklar("taslak_kosul", taslaklar.map((t) => t.id));
    const vadeGun = (f: { tarih: Date; vadeTarihi: Date | null }) => (f.vadeTarihi ? gunFarki(f.tarih.toISOString().slice(0, 10), f.vadeTarihi.toISOString().slice(0, 10)) : null);
    const iskonto = (f: { toplamBrut: Prisma.Decimal; toplamSatirIskontosu: Prisma.Decimal; genelIskontoToplam: Prisma.Decimal }) =>
      (f.toplamBrut.isZero() ? 0 : f.toplamSatirIskontosu.add(f.genelIskontoToplam).div(f.toplamBrut).mul(100).toNumber());
    let acilan = 0;
    for (const t of taslaklar) {
      if (acilan >= TARAMA_SORU_SINIRI || sorulmus.has(t.id)) continue;
      const gecmis = await this.prisma.tenantIslem(tenantId, (tx) => tx.fatura.findMany({
        where: { cariId: t.cariId, tip: "satis", durum: "kesin" }, orderBy: { tarih: "desc" }, take: 10,
        select: { tarih: true, vadeTarihi: true, toplamBrut: true, toplamSatirIskontosu: true, genelIskontoToplam: true },
      }));
      const sapma = taslakSapmasi({ vadeGun: vadeGun(t), iskontoYuzde: iskonto(t) }, gecmis.map((g) => ({ vadeGun: vadeGun(g), iskontoYuzde: iskonto(g) })), t.cari.varsayilanVadeGun);
      if (!sapma || await this.dahaOnceOnaylandi(t.cariId, sapma)) continue;
      const metin = taslakSorusu({ cariUnvan: t.cari.unvan, tutar: t.genelToplam.toFixed(2), dovizCinsi: t.dovizCinsi, sapma });
      if (await this.ac("taslak_kosul", t.id, SATIS_ROLLERI, metin, { cariId: t.cariId, tarih: t.tarih.toISOString().slice(0, 10), sapma } satisfies TaslakVerisi, false)) acilan++;
    }
    return acilan;
  }

  /** CNL-10: aynı caride aynı koşul daha önce "doğru" diye onaylandıysa yeniden sorulmaz. */
  private async dahaOnceOnaylandi(cariId: string, sapma: TaslakSapmasi): Promise<boolean> {
    const { tenantId } = aktifBaglam();
    const onceki = await this.prisma.tenantIslem(tenantId, (tx) => tx.asistanSorusu.findMany({
      where: { tur: "taslak_kosul", durum: "yanitlandi", veri: { path: ["cariId"], equals: cariId } }, select: { veri: true, yanit: true }, take: 50,
    }));
    return onceki.some((o) => (o.yanit as SoruYaniti | null)?.kod === "dogru" && (o.veri as unknown as TaslakVerisi).sapma?.alan === sapma.alan && (o.veri as unknown as TaslakVerisi).sapma?.taslak === sapma.taslak);
  }

  /** Kaynağı artık soruyu gerektirmeyen (eşleşmiş satır, bağlanmış e-posta, kesinleşmiş taslak) sorular kapanır. */
  private async gecersizleriKapat(): Promise<void> {
    const { tenantId } = aktifBaglam();
    await this.prisma.tenantIslem(tenantId, async (tx) => {
      const acik = await tx.asistanSorusu.findMany({ where: { durum: "acik" }, select: { id: true, tur: true, kaynakId: true } });
      if (!acik.length) return;
      const idler = (tur: string) => acik.filter((s) => s.tur === tur).map((s) => s.kaynakId);
      const [satirlar, epostalar, faturalar] = await Promise.all([
        tx.bankaEkstreSatir.findMany({ where: { id: { in: idler("banka_satiri") }, durum: "beklemede" }, select: { id: true } }),
        tx.gelenEposta.findMany({ where: { id: { in: idler("eposta_gonderen") }, durum: "yeni", cariId: null }, select: { id: true } }),
        tx.fatura.findMany({ where: { id: { in: idler("taslak_kosul") }, durum: "taslak" }, select: { id: true } }),
      ]);
      // Fiş kategorisi sorusu (CNL-16) kullanıcı yanıtlayana dek açık kalır; kaynağı sohbet ekidir.
      const gecerli = new Set([...satirlar, ...epostalar, ...faturalar].map((x) => x.id).concat(acik.filter((s) => s.tur === "masraf_kategori").map((s) => s.kaynakId)));
      const kapanacak = acik.filter((s) => !gecerli.has(s.kaynakId)).map((s) => s.id);
      if (kapanacak.length) await tx.asistanSorusu.updateMany({ where: { id: { in: kapanacak }, durum: "acik" }, data: { durum: "gecersiz", sonuc: "Kayıt başka yoldan işlendi; soru kapandı." } });
    });
  }

  // ─── GÖRÜNÜM ───────────────────────────────────────────────────────────────

  private hedefimdeMi(s: Pick<AsistanSorusu, "userId" | "roller">, userId: string, rol: string): boolean {
    return s.userId ? s.userId === userId : (s.roller as string[]).includes(rol);
  }

  /** CNL-09: panel "Sorular" kutusu — bana açık sorular ve son 7 günde yanıtlananlar. */
  async liste() {
    const { tenantId, userId, rol } = aktifBaglam();
    const sorular = await this.prisma.tenantIslem(tenantId, (tx) => tx.asistanSorusu.findMany({
      where: { OR: [{ durum: "acik" }, { durum: "yanitlandi", yanitAt: { gte: new Date(Date.now() - 7 * GUN) } }] },
      orderBy: { createdAt: "desc" }, take: 100,
    }));
    return sorular.filter((s) => this.hedefimdeMi(s, userId, rol)).map(soruGorunumu);
  }

  // ─── YANIT ─────────────────────────────────────────────────────────────────

  /**
   * CNL-10: yanıt hafızaya yazılır; kesin işlem onay talebiyle, taslak doğrudan. Soru önce koşullu
   * sahiplenilir (iki kanaldan aynı anda gelen yanıt tek işlem doğurur); işlem başarısızsa açık kalır.
   */
  async yanitla(id: string, yanit: SoruYaniti, kanal: "panel" | "telegram"): Promise<YanitSonucu> {
    const { tenantId, userId, rol } = aktifBaglam();
    const metin = yanit.metin?.trim().slice(0, 200) || undefined;
    if (!yanit.kod && !metin) throw new BadRequestException("Bir seçenek seçin ya da yanıt yazın.");
    const soru = await this.prisma.tenantIslem(tenantId, (tx) => tx.asistanSorusu.findUnique({ where: { id } }));
    if (!soru) throw new NotFoundException("Soru bulunamadı.");
    if (!this.hedefimdeMi(soru, userId, rol)) throw new ForbiddenException("Bu soru size sorulmadı.");
    if (soru.durum !== "acik") throw new BadRequestException(soru.durum === "yanitlandi" ? "Bu soru zaten yanıtlandı." : "Bu soru artık geçerli değil.");
    const secenekler = soru.secenekler as unknown as Secenek[];
    if (yanit.kod && !secenekler.some((s) => s.kod === yanit.kod)) throw new BadRequestException("Geçersiz seçenek.");
    if (!yanit.kod && !soru.serbestYanit) throw new BadRequestException("Bu soru yalnız seçeneklerle yanıtlanır.");
    if (yanit.kod === PANEL_SECENEGI.kod) throw new BadRequestException("Bu seçenek yalnız Telegram'da soruyu panele bırakır.");

    const alindi = await this.prisma.tenantIslem(tenantId, (tx) => tx.asistanSorusu.updateMany({
      where: { id, durum: "acik" },
      data: { durum: "yanitlandi", yanit: { ...(yanit.kod ? { kod: yanit.kod } : {}), ...(metin ? { metin } : {}) }, yanitlayanUserId: userId, yanitKanali: kanal, yanitAt: new Date() },
    }));
    if (alindi.count !== 1) throw new BadRequestException("Bu soru zaten yanıtlandı.");
    try {
      const sonuc = soru.tur === "masraf_kategori" ? { sonuc: await this.masrafBelge.kategoriSecildi(soru, yanit.kod, metin) }
        : soru.tur === "banka_satiri" ? await this.bankaYaniti(soru, yanit.kod, metin)
        : soru.tur === "eposta_gonderen" ? await this.epostaYaniti(soru, yanit.kod, metin)
          : await this.taslakYaniti(soru, yanit.kod!);
      await this.prisma.tenantIslem(tenantId, (tx) => tx.asistanSorusu.update({ where: { id }, data: { sonuc: sonuc.sonuc } }));
      return sonuc;
    } catch (hata) {
      // İşlem yapılamadıysa soru yeniden yanıtlanabilsin.
      await this.prisma.tenantIslem(tenantId, (tx) => tx.asistanSorusu.update({ where: { id }, data: { durum: "acik", yanit: Prisma.DbNull, yanitlayanUserId: null, yanitKanali: null, yanitAt: null } }));
      throw hata;
    }
  }

  /** Serbest yanıttaki cari: aktif, personel olmayan, unvanı ya da kodu eşleşen TEK kart. */
  private async cariCoz(metin: string): Promise<{ id: string; unvan: string }> {
    const { tenantId } = aktifBaglam();
    const adaylar = await this.prisma.tenantIslem(tenantId, (tx) => tx.cariHesap.findMany({
      where: { aktif: true, tip: { not: "personel" }, OR: [{ kod: { equals: metin, mode: "insensitive" } }, { unvan: { contains: metin, mode: "insensitive" } }] },
      select: { id: true, unvan: true, kod: true }, take: 6,
    }));
    const tamKod = adaylar.filter((a) => a.kod.toLocaleLowerCase("tr-TR") === metin.toLocaleLowerCase("tr-TR"));
    if (tamKod.length === 1) return tamKod[0];
    if (adaylar.length === 1) return adaylar[0];
    if (!adaylar.length) throw new BadRequestException(`“${metin}” ile eşleşen cari bulamadım; unvanı ya da kodu yazın.`);
    throw new BadRequestException(`“${metin}” birden çok cariyle eşleşiyor (${adaylar.slice(0, 5).map((a) => a.unvan).join(", ")}); daha belirgin yazın ya da kodu yazın.`);
  }

  private async bankaYaniti(soru: AsistanSorusu, kod: string | undefined, metin: string | undefined): Promise<YanitSonucu> {
    const { rol } = aktifBaglam();
    const veri = soru.veri as unknown as BankaVerisi;
    if (kod === "hayir") return { sonuc: "Not alındı; satır panelde Banka Ekstresi ekranında eşleştirilmeyi bekliyor." };
    const cari = kod === "evet" && veri.onerilenCariId
      ? await this.prisma.tenantIslem(aktifBaglam().tenantId, (tx) => tx.cariHesap.findUniqueOrThrow({ where: { id: veri.onerilenCariId! }, select: { id: true, unvan: true } }))
      : await this.cariCoz(metin ?? "");
    const ogrenildi = await this.ekstre.kuralOgren(soru.kaynakId, cari.id);
    const fatura = await this.ekstre.tamFaturaBul(soru.kaynakId, cari.id);
    const izinli = new Map(this.yurutucu.izinliAraclar(rol as Rol).map((a) => [a.ad, a]));
    const sonuc = await this.yurutucu.yurut({ ad: "ekstre_satiri_eslestir", girdi: { satirId: soru.kaynakId, cariId: cari.id, ...(fatura ? { dagitim: [{ faturaId: fatura.id, tutar: fatura.kalan }] } : {}) } }, izinli, { kaynak: "otomasyon" });
    const ogrenme = ogrenildi ? ` Bu karşı taraftan gelen sonraki hareketler ${cari.unvan} olarak önerilecek.` : "";
    if (sonuc.hata) return { sonuc: `${cari.unvan} not edildi ama eşleştirme talebi açılamadı (${sonuc.icerik.slice(0, 160)}).${ogrenme}` };
    const talepId = sonuc.talep?.id;
    return { sonuc: `${cari.unvan} carisine eşleştirme onayınıza sunuldu${fatura ? " (tutarı tutan açık fatura kapanacak)" : ""}; panelden onaylayın.${ogrenme}`, ...(talepId ? { talepId } : {}) };
  }

  private async epostaYaniti(soru: AsistanSorusu, kod: string | undefined, metin: string | undefined): Promise<YanitSonucu> {
    const { tenantId } = aktifBaglam();
    const veri = soru.veri as unknown as EpostaVerisi;
    if (kod === "ilgisiz") {
      await this.hafiza.sustur(veri.gonderenEposta, soru.kaynakId);
      return { sonuc: `${veri.gonderenEposta} cari olarak izlenmeyecek; bu adres için bir daha sorulmayacak.` };
    }
    const secilen = kod?.startsWith("cari") ? veri.adaylar[Number(kod.slice(4))] : undefined;
    const cari = secilen ? { id: secilen.cariId, unvan: secilen.unvan } : await this.cariCoz(metin ?? "");
    await this.hafiza.cariOgret(veri.gonderenEposta, cari.id, soru.kaynakId);
    await this.prisma.tenantIslem(tenantId, (tx) => tx.gelenEposta.updateMany({ where: { id: soru.kaynakId, cariId: null }, data: { cariId: cari.id } }));
    return { sonuc: `E-posta ${cari.unvan} carisine bağlandı; ${veri.gonderenEposta} adresinden gelenler artık tanınacak.` };
  }

  private async taslakYaniti(soru: AsistanSorusu, kod: string): Promise<YanitSonucu> {
    const { tenantId, userId } = aktifBaglam();
    const veri = soru.veri as unknown as TaslakVerisi;
    const { sapma } = veri;
    if (kod === "dogru") {
      await this.hafiza.tercihEkle(veri.cariId, sapma.alan === "vade" ? `Bu cari için ${sapma.taslak} gün vade olağandır.` : `Bu cari için %${sapma.taslak} iskonto olağandır.`, "kullanici");
      return { sonuc: "Not alındı; bu koşul bu cari için bir daha sorulmayacak." };
    }
    // "olagan": taslağın vadesi alışılmış güne çekilir (taslak doğrudan düzeltilir; kesin belgeye dokunulmaz).
    const vade = new Date(Date.parse(`${veri.tarih}T00:00:00Z`) + sapma.olagan * GUN);
    const sonuc = await this.prisma.tenantIslem(tenantId, async (tx) => {
      const g = await tx.fatura.updateMany({ where: { id: soru.kaynakId, durum: "taslak" }, data: { vadeTarihi: vade } });
      if (g.count) await tx.auditLog.create({ data: { tenantId, userId, islem: "fatura_vade_duzeltildi", varlik: "fatura", varlikId: soru.kaynakId, detay: { kaynak: "asistan_sorusu", soruId: soru.id, onceki: sapma.taslak, yeni: sapma.olagan } } });
      return g.count;
    });
    if (!sonuc) throw new BadRequestException("Taslak artık düzenlenemiyor (kesinleşmiş ya da silinmiş).");
    return { sonuc: `Taslağın vadesi ${sapma.olagan} güne (${vade.toISOString().slice(0, 10).split("-").reverse().join(".")}) çekildi.` };
  }
}
