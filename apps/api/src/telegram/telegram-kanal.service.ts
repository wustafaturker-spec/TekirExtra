import { BadRequestException, ConflictException, HttpException, Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional, ServiceUnavailableException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import type { Rol } from "@tekirextra/shared";
import { AiAjanService, type AjanYaniti } from "../ai/ajan/ai-ajan.service";
import { AiSinirHatasi } from "../ai/saglayici/ai-butce";
import { dugmeCoz, dugmeVerisi, PANEL_SECENEGI } from "../asistan-soru/asistan-soru.kurallari";
import { AsistanSoruService, type SoruYaniti, type YanitSonucu } from "../asistan-soru/asistan-soru.service";
import { fikirDugmesi, fikirDugmesiCoz } from "../asistan-soru/fikir.kurallari";
import { FikirService } from "../asistan-soru/fikir.service";
import { BELGE_AZAMI_BAYT } from "../asistan-soru/masraf-belge.kurallari";
import { MasrafBelgeService } from "../asistan-soru/masraf-belge.service";
import { baglamlaCalistir, type IstekBaglami } from "../core/istek-baglami";
import { nabizla } from "../core/nabiz/nabiz";
import { PrismaService } from "../core/prisma.service";
import { structuredLogger } from "../core/observability/structured-logger";
import { uzayanKilitle } from "../core/redis-kilit";
import { DUSME_METNI, telegramAyariOku, telegramBotAdi, type DusmeNedeni } from "./telegram-ayar";
import { TelegramHatasi, TelegramIstemci, type TelegramDugme, type TelegramGuncelleme, type TelegramMesaj } from "./telegram-istemci";
import { parcala, telegramSuz } from "./telegram-suzgec";
import { gunSonu, ritimKomutu } from "./telegram-bildirim.kurallari";
import { kodOzeti, TelegramService } from "./telegram.service";

/** CNL-13: bir hesaptan dakikada bundan çok mesaj gelirse geçici olarak yanıt verilmez. */
export const DAKIKA_SINIRI = 20;
/** CNL-18: hesap başına 15 dakikada en çok bu kadar hatalı bağlama denemesi. */
export const YANLIS_KOD_SINIRI = 5;
const YANLIS_KOD_PENCERE_MS = 15 * 60 * 1000;
/** Aynı anda en çok bu kadar sohbet işlenir; bir firmanın yavaş yanıtı ötekileri bekletmez (CNL-17e). */
const ESZAMANLI = 8;
/** Yoklama 3 dakikadır başarılı değilse sağlık tiki hata yazar (CNL-14). */
const SAGLIK_ESIGI_MS = 3 * 60 * 1000;
const KILIT = "tekir:telegram:yoklama";

const uyu = (ms: number) => new Promise<void>((r) => setTimeout(r, ms).unref());

/** CNL-13/17f: gelen güncellemenin yalnız türü günlüğe yazılır; içerik, hesap ve firma kimliği yazılmaz. */
const olay = (tur: string) => structuredLogger.info("telegram_guncelleme", { tur });

/** Güncelleme numarasından kararlı istek kimliği: aynı mesaj asistanda da iki kez çalışmaz. */
export function guncellemeIstekKimligi(updateId: number, deneme = 1): string {
  const h = createHash("sha256").update(deneme === 1 ? `telegram:${updateId}` : `telegram:${updateId}:${deneme}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${((parseInt(h[16], 16) & 0x3) | 0x8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

const YONERGE = "Merhaba! Bu bot TekirExtra asistanıdır.\n\nKullanmak için TekirExtra panelinde Ayarlar › Bildirimler › Telegram bölümünden “Telegram'ı bağla”ya basın ve açılan bağlantıyla buraya dönün.\n\nBağlantıyı açtığınız hâlde bu mesajı görüyorsanız (Telegram bu sohbet daha önce açıldıysa kodu iletmeyebilir) panelde gösterilen kodu buraya yapıştırıp gönderin.";
const YARDIM = "Sorunuzu doğrudan yazabilirsiniz; ör. “bugün vadesi gelen alacaklar”, “kasa ve banka bakiyeleri”, “ABC Ltd. cari durumu”.\nFiş ya da fatura fotoğrafı gönderirseniz masraf taslağı açarım.\n\nKomutlar:\n/yeni — yeni bir sohbet başlatır\nsus — 24 saat kendiliğinden mesaj göndermez (bugünlük yeter: gün sonuna dek)\n/devam — kendiliğinden mesajları yeniden açar\n/ayril — bu Telegram hesabının TekirExtra bağlantısını kaldırır\n/yardim — bu yardım\n\nOnay, ödeme ve gönderim gibi kararlar yalnız panelde verilir; buradan yalnız onay talebi açılır.";

interface Cozum { tenantId: string; userId: string }

/**
 * CNL-01/02/03/04/13/17: ayrı Telegram sürecinin (`main.telegram.ts`) yoklama döngüsü.
 * Firma yalnız bağ kaydından çözülür; sonraki her okuma/yazma o firmanın RLS bağlamındadır.
 * Mesaj içeriği bu servisin kayıtlarına yazılmaz; yalnız iz (yön, tür, durum, hata türü).
 */
@Injectable()
export class TelegramKanalService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TelegramKanalService.name);
  private istemci: TelegramIstemci | null = null;
  private durdu = false;
  private dongu?: Promise<void>;
  private saglikZamanlayici?: NodeJS.Timeout;
  private offset: number | undefined;
  private sonBasariliYoklama = 0;
  private kilitBaskasinda = false;
  private readonly gonderimHatalari = new Map<string, number>();
  private readonly kuyruklar = new Map<string, Promise<void>>();
  private readonly hiz = new Map<string, number[]>();
  private readonly yanlisKod = new Map<string, number[]>();
  private calisan = 0;
  private readonly bekleyenler: Array<() => void> = [];
  /** Testlerde sahte istemci vermek için. */
  istemciKur = (anahtar: string) => new TelegramIstemci(anahtar);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ajan: AiAjanService,
    private readonly telegram: TelegramService,
    @Optional() private readonly sorular?: AsistanSoruService,
    @Optional() private readonly fikirler?: FikirService,
    @Optional() private readonly masrafBelge?: MasrafBelgeService,
  ) {}

  onModuleInit(): void {
    if (process.env.TEKIR_TELEGRAM !== "1") return;
    this.baslat();
  }

  async onModuleDestroy(): Promise<void> {
    this.durdu = true;
    if (this.saglikZamanlayici) clearInterval(this.saglikZamanlayici);
    // Süren yanıtlar bitsin (en çok 20 sn); yoklama döngüsü zaman aşımında kendiliğinden döner.
    await Promise.race([Promise.allSettled([...this.kuyruklar.values(), ...(this.dongu ? [this.dongu] : [])]), uyu(20_000)]);
  }

  baslat(): void {
    const anahtar = process.env.TELEGRAM_BOT_TOKEN?.trim();
    try {
      this.istemci = anahtar ? this.istemciKur(anahtar) : null;
    } catch (hata) {
      this.logger.error(`Telegram istemcisi kurulamadı: ${hata instanceof Error ? hata.message : String(hata)}`);
      this.istemci = null;
    }
    this.saglikZamanlayici = setInterval(() => void nabizla("telegram-yoklama", () => this.saglik(), 60_000, { tekSurec: false }), 60_000);
    this.saglikZamanlayici.unref();
    if (!this.istemci) {
      this.logger.warn("TELEGRAM_BOT_TOKEN tanımlı değil; Telegram kanalı çalışmıyor.");
      return;
    }
    // Panelin ürettiği bağlantı başka bota gitmesin: anahtar ile TELEGRAM_BOT_ADI aynı botu göstermeli.
    void this.istemci.ben().then((b) => {
      const ad = telegramBotAdi();
      if (ad && b.username?.toLowerCase() !== ad.toLowerCase()) this.logger.error(`TELEGRAM_BOT_ADI (${ad}) anahtarın botuyla (${b.username ?? "?"}) uyuşmuyor; paneldeki bağlantılar yanlış bota gider.`);
    }).catch(() => undefined);
    this.dongu = this.yokla();
  }

  /** CNL-14: sistem sağlığında görünen tik. Yalnız sayı ve hata türü yazılır (CNL-17f). */
  async saglik(): Promise<void> {
    if (!this.istemci) throw new Error("Bot anahtarı tanımlı değil ya da geçersiz");
    const hatalar = [...this.gonderimHatalari.entries()];
    this.gonderimHatalari.clear();
    if (this.kilitBaskasinda) return;
    const gecen = Date.now() - this.sonBasariliYoklama;
    if (gecen > SAGLIK_ESIGI_MS) throw new Error(`Son başarılı yoklama ${this.sonBasariliYoklama ? `${Math.round(gecen / 60_000)} dakika önce` : "hiç olmadı"}`);
    if (hatalar.length) throw new Error(`Gönderim hataları: ${hatalar.map(([tur, n]) => `${tur} ${n}`).join(", ")}`);
  }

  private hataSay(tur: string): void {
    this.gonderimHatalari.set(tur, (this.gonderimHatalari.get(tur) ?? 0) + 1);
  }

  /** Uzun yoklama. Telegram aynı bot için tek yoklamaya izin verir; süreçler arası Redis kilidi tutulur. */
  private async yokla(): Promise<void> {
    let bekleme = 1_000;
    while (!this.durdu) {
      let birak: (() => Promise<void>) | null = null;
      try {
        birak = await uzayanKilitle(KILIT, 90);
      } catch (hata) {
        this.logger.warn(`Telegram yoklama kilidi alınamadı: ${hata instanceof Error ? hata.message : String(hata)}`);
      }
      if (!birak) { this.kilitBaskasinda = true; await uyu(30_000); continue; }
      this.kilitBaskasinda = false;
      try {
        while (!this.durdu) {
          const guncellemeler = await this.istemci!.guncellemeler(this.offset);
          this.sonBasariliYoklama = Date.now();
          bekleme = 1_000;
          for (const g of guncellemeler) {
            // Sonraki yoklama bu numaraya kadar olanları sunucuda onaylar; tekrar gelen mesaj
            // veritabanındaki benzersiz güncelleme numarasıyla elenir.
            this.offset = Math.max(this.offset ?? 0, g.update_id + 1);
            void this.sirala(g);
          }
        }
      } catch (hata) {
        const h = hata instanceof TelegramHatasi ? hata : new TelegramHatasi("ag", hata instanceof Error ? hata.message : String(hata));
        if (h.tur === "yetki") { this.logger.error(`Telegram bot anahtarı reddedildi: ${h.message}`); bekleme = 5 * 60_000; }
        else if (h.tur === "cakisma") { this.logger.warn("Telegram: başka bir süreç aynı botu yokluyor."); bekleme = 30_000; }
        else if (h.tur === "hiz_siniri") bekleme = (h.bekleSn ?? 5) * 1000;
        else { this.logger.warn(`Telegram yoklaması başarısız: ${h.message}`); bekleme = Math.min(bekleme * 2, 60_000); }
      } finally {
        await birak().catch(() => undefined);
      }
      if (!this.durdu) await uyu(bekleme);
    }
  }

  /** Sohbet başına sıralı kuyruk; sohbetler birbirini beklemez, toplam eşzamanlılık sınırlıdır. */
  sirala(g: TelegramGuncelleme): Promise<void> {
    const anahtar = String(g.message?.chat.id ?? g.callback_query?.message?.chat.id ?? `g${g.update_id}`);
    const onceki = this.kuyruklar.get(anahtar) ?? Promise.resolve();
    const sonraki = onceki.then(() => this.sinirli(() => this.isleGuvenli(g)));
    this.kuyruklar.set(anahtar, sonraki);
    void sonraki.finally(() => { if (this.kuyruklar.get(anahtar) === sonraki) this.kuyruklar.delete(anahtar); });
    return sonraki;
  }

  private async sinirli(is: () => Promise<void>): Promise<void> {
    if (this.calisan >= ESZAMANLI) await new Promise<void>((r) => this.bekleyenler.push(r));
    this.calisan++;
    try { await is(); } finally { this.calisan--; this.bekleyenler.shift()?.(); }
  }

  private async isleGuvenli(g: TelegramGuncelleme): Promise<void> {
    try {
      await this.isle(g);
    } catch (hata) {
      this.logger.error(`Telegram mesajı işlenemedi (güncelleme ${g.update_id}): ${hata instanceof Error ? hata.message.split("\n").filter(Boolean).pop() : String(hata)}`);
    }
  }

  /** Kayan pencereli sayaç; sınır aşıldıysa true. */
  private sinirda(harita: Map<string, number[]>, anahtar: string, sinir: number, pencereMs: number, say = true): boolean {
    const simdi = Date.now();
    const liste = (harita.get(anahtar) ?? []).filter((t) => t > simdi - pencereMs);
    if (say) liste.push(simdi);
    harita.set(anahtar, liste);
    if (harita.size > 50_000) harita.clear();
    return liste.length > sinir;
  }

  async isle(g: TelegramGuncelleme): Promise<void> {
    if (g.callback_query) return this.dugmeIsle(g, g.callback_query);
    const m = g.message;
    // CNL-01: yalnız bire bir sohbet; grup ve kanal mesajlarına yanıt verilmez.
    if (!m || m.chat.type !== "private" || !m.from || m.from.is_bot) return;
    const hesap = String(m.from.id);
    if (this.sinirda(this.hiz, hesap, DAKIKA_SINIRI, 60_000)) return;
    const metin = (m.text ?? "").trim();
    // "/start KOD" (bağlantıdan) ya da yalnız kod (Telegram bağlantıdaki kodu iletmediyse elle yapıştırılır).
    const baglama = /^\/start(?:@\w+)?\s+([A-Za-z0-9_-]{16,64})$/.exec(metin) ?? /^([A-Za-z0-9_-]{32})$/.exec(metin);
    if (baglama) return this.bagla(g, m, baglama[1]);
    const cozum = await this.coz(BigInt(m.from.id));
    // Bağlı olmayan hesaba yalnız yönerge; hiçbir firma kaydına iz düşmez.
    if (!cozum) { olay("bagsiz_hesap"); await this.dogrudanGonder(m.chat.id, YONERGE); return; }
    await this.firmaMesaji(g, m, metin, cozum);
  }

  /** CNL-17b: firma yalnız bağ kaydından; dar işlev yalnız firma ve kullanıcıyı döndürür. */
  private async coz(telegramKullaniciId: bigint): Promise<Cozum | null> {
    const satir = await this.prisma.$queryRaw<{ tenant_id: string; user_id: string }[]>`SELECT tenant_id::text, user_id::text FROM telegram_bag_coz(${telegramKullaniciId})`;
    return satir[0] ? { tenantId: satir[0].tenant_id, userId: satir[0].user_id } : null;
  }

  /** Yalnız bağsız durumlar (yönerge, bağlama sonucu, düşen bağ): alıcı mesajı yazan sohbettir, firma verisi içermez. */
  private async dogrudanGonder(sohbetId: number, metin: string): Promise<boolean> {
    try {
      await this.istemci!.gonder(sohbetId, telegramSuz(metin, { tutarGoster: true }));
      return true;
    } catch (hata) {
      this.hataSay(hata instanceof TelegramHatasi ? hata.tur : "bilinmeyen");
      return false;
    }
  }

  private iz(tx: Prisma.TransactionClient, tenantId: string, userId: string | null, yon: "gelen" | "giden", tur: string, durum: string, hataTuru: string | null = null, guncellemeNo: number | null = null) {
    return tx.telegramMesaji.create({ data: { tenantId, userId, yon, tur, durum, hataTuru, guncellemeNo: guncellemeNo === null ? null : BigInt(guncellemeNo) } });
  }

  /** CNL-02/17a/18: tek kullanımlık kodla bağlama. Kod tüketimi ve bağ aynı firma işleminde yazılır. */
  private async bagla(g: TelegramGuncelleme, m: TelegramMesaj, kod: string): Promise<void> {
    const hesap = String(m.from!.id);
    if (this.sinirda(this.yanlisKod, hesap, YANLIS_KOD_SINIRI - 1, YANLIS_KOD_PENCERE_MS, false)) {
      olay("baglama_cok_deneme");
      await this.dogrudanGonder(m.chat.id, "Çok fazla hatalı bağlantı denemesi yapıldı. 15 dakika sonra panelden yeni bir bağlantı alarak deneyin.");
      return;
    }
    const telegramId = BigInt(m.from!.id);
    const ozet = kodOzeti(kod);
    const [kayit] = await this.prisma.$queryRaw<{ tenant_id: string; user_id: string }[]>`SELECT tenant_id::text, user_id::text FROM telegram_kod_coz(${ozet})`;
    if (!kayit) {
      olay("baglama_kod_gecersiz");
      this.sinirda(this.yanlisKod, hesap, YANLIS_KOD_SINIRI, YANLIS_KOD_PENCERE_MS);
      await this.dogrudanGonder(m.chat.id, "Bu bağlantı geçersiz ya da süresi dolmuş (bağlantılar 10 dakika geçerlidir). Panelden yeni bir bağlantı alın.");
      return;
    }
    const tenantId = kayit.tenant_id;
    const userId = kayit.user_id;
    const mevcut = await this.coz(telegramId);
    // CNL-17a: başka bir kullanıcıya (başka firmada olabilir) bağlı hesap önce o bağı kaldırır.
    if (mevcut && mevcut.userId !== userId) {
      olay("baglama_baska_hesap");
      await this.dogrudanGonder(m.chat.id, "Bu Telegram hesabı başka bir TekirExtra kullanıcısına bağlı. Önce /ayril yazarak o bağı kaldırın, sonra panelden yeni bir bağlantı alın.");
      return;
    }
    const karar = await this.telegram.bagKarari(tenantId, userId, null);
    if (karar.neden) {
      olay(`baglama_engel_${karar.neden}`);
      await this.dogrudanGonder(m.chat.id, `Bağlanamadı: ${DUSME_METNI[karar.neden]}.`);
      return;
    }
    let sonuc: { adSoyad: string; unvan: string } | "gecersiz" | "baska_hesap";
    try {
      sonuc = await baglamlaCalistir({ tenantId, userId, rol: karar.rol as Rol }, () => this.prisma.tenantIslem(tenantId, async (tx) => {
        const simdi = new Date();
        const tuketilen = await tx.telegramBaglamaKodu.updateMany({ where: { kodOzeti: ozet, userId, kullanildiAt: null, sonGecerlilik: { gt: simdi } }, data: { kullanildiAt: simdi } });
        if (tuketilen.count !== 1) return "gecersiz" as const;
        const [kodKaydi, kullanici, firma] = await Promise.all([
          tx.telegramBaglamaKodu.findUnique({ where: { kodOzeti: ozet }, select: { rizaAt: true } }),
          tx.user.findUnique({ where: { id: userId }, select: { adSoyad: true, oturumSurumu: true, aktif: true } }),
          tx.tenant.findUnique({ where: { id: tenantId }, select: { unvan: true } }),
        ]);
        if (!kodKaydi || !kullanici?.aktif || !firma) return "gecersiz" as const;
        // Kullanıcının başka bir Telegram hesabıyla bağı varsa yenisi onun yerine geçer.
        await tx.telegramBagi.deleteMany({ where: { userId } });
        await tx.telegramBagi.create({
          data: { tenantId, userId, telegramKullaniciId: telegramId, sohbetId: BigInt(m.chat.id), kullaniciAdi: m.from!.username?.slice(0, 64) ?? null, oturumSurumu: kullanici.oturumSurumu, rizaAt: kodKaydi.rizaAt },
        });
        await tx.auditLog.create({ data: { tenantId, userId, islem: "telegram_baglandi", varlik: "telegram_bag", varlikId: userId, detay: { rizaAt: kodKaydi.rizaAt.toISOString() } } });
        await this.iz(tx, tenantId, userId, "gelen", "baglama", "islendi", null, g.update_id);
        return { adSoyad: kullanici.adSoyad, unvan: firma.unvan };
      }));
    } catch (hata) {
      // Eşzamanlı ikinci bağlama ya da tekrar gelen güncelleme: işlem geri alınır, kod tüketilmez.
      if (hata instanceof Prisma.PrismaClientKnownRequestError && hata.code === "P2002") {
        const hedef = String((hata.meta as { target?: unknown } | undefined)?.target ?? "");
        if (hedef.includes("guncelleme_no")) return;
        sonuc = "baska_hesap";
      } else throw hata;
    }
    olay(sonuc === "gecersiz" ? "baglama_kod_gecersiz" : sonuc === "baska_hesap" ? "baglama_baska_hesap" : "baglandi");
    if (sonuc === "gecersiz") {
      this.sinirda(this.yanlisKod, hesap, YANLIS_KOD_SINIRI, YANLIS_KOD_PENCERE_MS);
      await this.dogrudanGonder(m.chat.id, "Bu bağlantı geçersiz ya da süresi dolmuş. Panelden yeni bir bağlantı alın.");
    } else if (sonuc === "baska_hesap") {
      await this.dogrudanGonder(m.chat.id, "Bu Telegram hesabı başka bir TekirExtra kullanıcısına bağlı. Önce /ayril yazarak o bağı kaldırın.");
    } else {
      await this.dogrudanGonder(m.chat.id, `Bağlantı tamam: ${sonuc.adSoyad} — ${sonuc.unvan}.\n\n${YARDIM}`);
    }
  }

  /**
   * Bağ bu an geçerli mi (CNL-02/17)? Değilse bağ düşer, kullanıcıya söylenir ve null döner.
   * Geçerliyse kullanıcının güncel rolü, özel rolü ve paket modülleriyle bağlam döner.
   */
  private async baglamHazirla(tenantId: string, userId: string, telegramId: bigint, sohbetId: number) {
    const bag = await this.prisma.tenantIslem(tenantId, (tx) => tx.telegramBagi.findFirst({ where: { tenantId, userId, telegramKullaniciId: telegramId }, select: { oturumSurumu: true } }));
    if (!bag) { await this.dogrudanGonder(sohbetId, YONERGE); return null; }
    const karar = await this.telegram.bagKarari(tenantId, userId, bag);
    if (karar.neden && karar.neden !== "rol_kapali") {
      olay(`bag_dustu_${karar.neden}`);
      await this.telegram.bagDusur(tenantId, userId, karar.neden);
      await this.dogrudanGonder(sohbetId, `Telegram bağlantınız kaldırıldı: ${DUSME_METNI[karar.neden]}. Gerekirse panelden yeniden bağlayabilirsiniz.`);
      return null;
    }
    const baglam: IstekBaglami = { tenantId, userId, rol: karar.rol as Rol, ...(karar.ozelRol ? { ozelRol: karar.ozelRol } : {}), paketModulleri: karar.moduller };
    return { baglam, karar };
  }

  /** Aynı güncelleme ikinci kez gelirse false (CNL-01). */
  private async gelenIz(baglam: IstekBaglami, guncellemeNo: number, tur: string): Promise<boolean> {
    try {
      await baglamlaCalistir(baglam, () => this.prisma.tenantIslem(baglam.tenantId, (tx) => this.iz(tx, baglam.tenantId, baglam.userId, "gelen", tur, "alindi", null, guncellemeNo)));
      return true;
    } catch (hata) {
      if (hata instanceof Prisma.PrismaClientKnownRequestError && hata.code === "P2002") return false;
      throw hata;
    }
  }

  /**
   * CNL-16: fiş/fatura fotoğrafı ya da PDF'i masraf taslağına çevrilir. En büyük fotoğraf boyutu 6 MB
   * sınırını aşıyorsa sığan en büyüğü alınır. Kategori belirsizse asistan düğmeli soru sorar.
   */
  private async belgeIsle(baglam: IstekBaglami, m: TelegramMesaj): Promise<void> {
    const { tenantId, userId } = baglam;
    if (!this.masrafBelge) return void (await baglamlaCalistir(baglam, () => this.firmayaGonder(tenantId, userId, null, "bilgi", "Belge işleme şu anda kullanılamıyor.")));
    const foto = [...(m.photo ?? [])].reverse().find((p) => !p.file_size || p.file_size <= BELGE_AZAMI_BAYT);
    const dosyaId = m.document?.file_id ?? foto?.file_id;
    const ad = m.document?.file_name ?? `telegram-${m.message_id}`;
    let metin: string;
    try {
      if (!dosyaId) throw new BadRequestException("Fotoğraf 6 MB'tan büyük; daha küçük gönderin.");
      if (m.document?.mime_type && !/^(image\/(jpeg|png|webp)|application\/pdf)$/.test(m.document.mime_type)) throw new BadRequestException("Yalnız JPEG, PNG, WebP fotoğraf ya da PDF gönderebilirsiniz.");
      await baglamlaCalistir(baglam, async () => this.masrafBelge!.yetkiDenetle());
      await this.istemci!.yaziyor(m.chat.id);
      const buffer = await this.istemci!.dosyaIndir(dosyaId, BELGE_AZAMI_BAYT).catch((h: unknown) => {
        throw h instanceof TelegramHatasi && h.message === "Dosya çok büyük" ? new BadRequestException("Dosya 6 MB'tan büyük; daha küçük gönderin.") : h;
      });
      const r = await baglamlaCalistir(baglam, () => this.masrafBelge!.belgedenMasraf({ ad, buffer }, m.caption ?? null));
      if (r.soru && r.masrafId) {
        // CNL-22: taslak açıldı, ödeme hesabı belirsiz; önce sonuç, ardından ödeme sorusu.
        await baglamlaCalistir(baglam, () => this.firmayaGonder(tenantId, userId, null, "belge_sonuc", r.sonuc));
        const sonuc = await baglamlaCalistir(baglam, () => this.soruGonder(tenantId, userId, r.soru!));
        if (sonuc === "gonderildi") return;
        metin = "Ödeme hesabı sorusunu gönderemedim; panelde Asistan › Sorular kutusundan yanıtlayabilirsiniz.";
      } else if (r.soru) {
        const sonuc = await baglamlaCalistir(baglam, () => this.soruGonder(tenantId, userId, r.soru!));
        if (sonuc === "gonderildi") return;
        metin = "Belgeyi okudum ama kategori sorusunu gönderemedim; panelde Asistan › Sorular kutusundan yanıtlayabilirsiniz.";
      } else metin = r.sonuc;
    } catch (hata) {
      metin = this.kullaniciHatasi(hata, "Belgeyi işleyemedim; biraz sonra yeniden deneyin ya da panelden yükleyin.");
    }
    await baglamlaCalistir(baglam, () => this.firmayaGonder(tenantId, userId, null, "belge_sonuc", metin));
  }

  /** CNL-09: soru düğmesi. "Panelde bakacağım" yalnız Telegram'daki düğmeleri kaldırır; soru panelde açık kalır. */
  private async dugmeIsle(g: TelegramGuncelleme, d: TelegramDugme): Promise<void> {
    const m = d.message;
    if (!m || m.chat.type !== "private" || d.from.is_bot) { await this.istemci!.dugmeYanitla(d.id); return; }
    if (this.sinirda(this.hiz, String(d.from.id), DAKIKA_SINIRI, 60_000)) return;
    const cozum = await this.coz(BigInt(d.from.id));
    if (!cozum) { await this.istemci!.dugmeYanitla(d.id, "Bu Telegram hesabı TekirExtra'ya bağlı değil."); return; }
    const hazir = await this.baglamHazirla(cozum.tenantId, cozum.userId, BigInt(d.from.id), m.chat.id);
    if (!hazir) { await this.istemci!.dugmeYanitla(d.id); return; }
    const { baglam, karar } = hazir;
    if (!(await this.gelenIz(baglam, g.update_id, "soru_yanit"))) return;
    olay("soru_yanit");
    const f = fikirDugmesiCoz(d.data ?? "");
    if (f && this.fikirler && karar.neden !== "rol_kapali") {
      let metin: string;
      try {
        metin = (await baglamlaCalistir(baglam, () => this.fikirler!.isaretle(f.fikirId, f.isaret))).sonuc;
      } catch (hata) {
        metin = this.kullaniciHatasi(hata, "İşaret kaydedilemedi; biraz sonra yeniden deneyin.");
      }
      await this.istemci!.klavyeKaldir(m.chat.id, m.message_id).catch(() => undefined);
      await this.istemci!.dugmeYanitla(d.id, metin);
      return;
    }
    const v = dugmeCoz(d.data ?? "");
    if (!v || !this.sorular || karar.neden === "rol_kapali") { await this.istemci!.dugmeYanitla(d.id, "Bu düğme artık geçerli değil."); return; }
    if (v.kod === PANEL_SECENEGI.kod) {
      await this.istemci!.klavyeKaldir(m.chat.id, m.message_id).catch(() => undefined);
      await baglamlaCalistir(baglam, () => this.klavyeKaldirildi(baglam.tenantId, v.soruId, baglam.userId));
      await this.istemci!.dugmeYanitla(d.id, "Soru panelde Asistan › Sorular kutusunda bekliyor.");
      return;
    }
    await this.soruYanitla(baglam, v.soruId, { kod: v.kod }, m.chat.id, m.message_id, d.id);
  }

  /** Yanıt soru servisine gider; sonuç ve (açıldıysa) onay talebinin panel bağlantısı sohbete yazılır. */
  private async soruYanitla(baglam: IstekBaglami, soruId: string, yanit: SoruYaniti, sohbetId: number, mesajId: number, dugmeId?: string): Promise<void> {
    const { tenantId, userId } = baglam;
    let metin: string;
    let sonraki: YanitSonucu["sonrakiSoru"];
    try {
      const r = await baglamlaCalistir(baglam, () => this.sorular!.yanitla(soruId, yanit, "telegram"));
      const panel = (process.env.APP_URL ?? "http://localhost:3100").replace(/\/+$/, "");
      const bag = r.talepId && !r.sonuc.includes(`talep=${r.talepId}`) ? `\n${panel}/panel/ai?talep=${r.talepId}` : "";
      metin = `✅ ${r.sonuc}${bag}`;
      sonraki = r.sonrakiSoru;
      await this.istemci!.klavyeKaldir(sohbetId, mesajId).catch(() => undefined);
      await baglamlaCalistir(baglam, () => this.klavyeKaldirildi(tenantId, soruId, userId));
      if (dugmeId) await this.istemci!.dugmeYanitla(dugmeId, "Yanıtınız alındı.");
    } catch (hata) {
      const neden = this.kullaniciHatasi(hata, "Yanıt işlenemedi; biraz sonra yeniden deneyin ya da panelden yanıtlayın.");
      if (dugmeId) await this.istemci!.dugmeYanitla(dugmeId, neden);
      metin = `Yanıtınızı işleyemedim: ${neden}`;
    }
    await baglamlaCalistir(baglam, () => this.firmayaGonder(tenantId, userId, null, "soru_sonuc", metin));
    if (sonraki) {
      const s = sonraki;
      const g = await baglamlaCalistir(baglam, () => this.soruGonder(tenantId, userId, s));
      if (g !== "gonderildi") await baglamlaCalistir(baglam, () => this.firmayaGonder(tenantId, userId, null, "soru_sonuc", "Ödeme hesabı sorusunu gönderemedim; panelde Asistan › Sorular kutusundan yanıtlayabilirsiniz."));
    }
  }

  /**
   * Kullanıcıya yalnız bilerek yazılmış iletiler (HTTP istisnaları) gider; veritabanı ve iç hatalar
   * sunucu yolu ya da sorgu içerebileceği için genel iletiye çevrilir ve günlüğe türüyle yazılır.
   */
  private kullaniciHatasi(hata: unknown, genel: string): string {
    if (hata instanceof HttpException) {
      const yanit = hata.getResponse();
      const m = typeof yanit === "string" ? yanit : (yanit as { message?: unknown }).message;
      return String(Array.isArray(m) ? m.join(" ") : m ?? genel).slice(0, 300);
    }
    this.logger.error(`Telegram yanıtı işlenemedi: ${hata instanceof Prisma.PrismaClientKnownRequestError ? `Prisma ${hata.code}` : hata instanceof Error ? hata.name : "bilinmeyen"}`);
    return genel;
  }

  private klavyeKaldirildi(tenantId: string, soruId: string, userId: string) {
    return this.prisma.tenantIslem(tenantId, (tx) => tx.asistanSoruGonderimi.updateMany({ where: { soruId, userId, klavyeKaldirildiAt: null }, data: { klavyeKaldirildiAt: new Date() } }));
  }

  /**
   * CNL-09: soru düğmelerle gönderilir; alıcı ve bağ diğer gönderimler gibi yeniden doğrulanır
   * (CNL-17d). Gönderim kaydı, yanıt panelden gelse de düğmelerin kaldırılabilmesi içindir.
   */
  async soruGonder(tenantId: string, userId: string, soru: { id: string; soru: string; secenekler: Array<{ kod: string; etiket: string }>; serbestYanit: boolean }): Promise<GonderimSonucu> {
    const { bag, ayar } = await this.prisma.tenantIslem(tenantId, async (tx) => ({
      bag: await tx.telegramBagi.findUnique({ where: { userId }, select: { tenantId: true, sohbetId: true } }),
      ayar: await telegramAyariOku(tx, tenantId),
    }));
    if (!bag || bag.tenantId !== tenantId || !ayar.etkin) {
      await this.prisma.tenantIslem(tenantId, (tx) => this.iz(tx, tenantId, userId, "giden", "soru", "gonderilmedi", "bag_gecersiz"));
      return "bag_gecersiz";
    }
    const metin = telegramSuz(`❓ ${soru.soru}${soru.serbestYanit ? "\n\nDüğmelerden seçin ya da bu mesajı yanıtlayarak yazın." : ""}`, { tutarGoster: ayar.tutarGoster });
    const klavye = soru.secenekler.map((s) => [{ text: s.etiket.slice(0, 60), callback_data: dugmeVerisi(soru.id, s.kod) }]);
    try {
      const mesajId = await this.istemci!.klavyeliGonder(bag.sohbetId, parcala(metin)[0], klavye);
      await this.prisma.tenantIslem(tenantId, async (tx) => {
        await tx.asistanSoruGonderimi.create({ data: { tenantId, soruId: soru.id, userId, sohbetId: bag.sohbetId, telegramMesajId: BigInt(mesajId) } });
        await this.iz(tx, tenantId, userId, "giden", "soru", "gonderildi");
      });
      return "gonderildi";
    } catch (hata) {
      const tur = hata instanceof TelegramHatasi ? hata.tur : "bilinmeyen";
      this.hataSay(tur);
      await this.prisma.tenantIslem(tenantId, (tx) => this.iz(tx, tenantId, userId, "giden", "soru", "gonderilmedi", tur));
      return "hata";
    }
  }

  /** CNL-11: fikir üç işaret düğmesiyle gider; dayandığı rapor ya da ekran bağlantısıyla. */
  async fikirGonder(tenantId: string, userId: string, fikir: { id: string; baslik: string; metin: string; hedefYol: string }): Promise<GonderimSonucu> {
    const { bag, ayar } = await this.prisma.tenantIslem(tenantId, async (tx) => ({
      bag: await tx.telegramBagi.findUnique({ where: { userId }, select: { tenantId: true, sohbetId: true } }),
      ayar: await telegramAyariOku(tx, tenantId),
    }));
    if (!bag || bag.tenantId !== tenantId || !ayar.etkin) {
      await this.prisma.tenantIslem(tenantId, (tx) => this.iz(tx, tenantId, userId, "giden", "fikir", "gonderilmedi", "bag_gecersiz"));
      return "bag_gecersiz";
    }
    const panel = (process.env.APP_URL ?? "http://localhost:3100").replace(/\/+$/, "");
    const metin = telegramSuz(`💡 ${fikir.baslik}\n\n${fikir.metin}\n\n${panel}${fikir.hedefYol}`, { tutarGoster: ayar.tutarGoster });
    const klavye = [[{ text: "👍 İşe yarar", callback_data: fikirDugmesi(fikir.id, "yarar") }, { text: "👎 İşe yaramaz", callback_data: fikirDugmesi(fikir.id, "yaramaz") }], [{ text: "🚫 Bu konuyu bir daha getirme", callback_data: fikirDugmesi(fikir.id, "getirme") }]];
    try {
      await this.istemci!.klavyeliGonder(bag.sohbetId, parcala(metin)[0], klavye);
      await this.prisma.tenantIslem(tenantId, (tx) => this.iz(tx, tenantId, userId, "giden", "fikir", "gonderildi"));
      return "gonderildi";
    } catch (hata) {
      const tur = hata instanceof TelegramHatasi ? hata.tur : "bilinmeyen";
      this.hataSay(tur);
      await this.prisma.tenantIslem(tenantId, (tx) => this.iz(tx, tenantId, userId, "giden", "fikir", "gonderilmedi", tur));
      return "hata";
    }
  }

  /** Yanıtlanmış ya da geçersizleşmiş sorunun Telegram'daki düğmeleri kaldırılır (yanıt panelden geldiyse). */
  async klavyeleriTemizle(tenantId: string, userId: string): Promise<void> {
    const eski = await this.prisma.tenantIslem(tenantId, (tx) => tx.asistanSoruGonderimi.findMany({ where: { userId, klavyeKaldirildiAt: null, soru: { durum: { not: "acik" } } }, select: { id: true, sohbetId: true, telegramMesajId: true }, take: 20 }));
    for (const e of eski) {
      await this.istemci!.klavyeKaldir(e.sohbetId, e.telegramMesajId).catch(() => undefined);
      await this.prisma.tenantIslem(tenantId, (tx) => tx.asistanSoruGonderimi.update({ where: { id: e.id }, data: { klavyeKaldirildiAt: new Date() } }));
    }
  }

  private async firmaMesaji(g: TelegramGuncelleme, m: TelegramMesaj, metin: string, { tenantId, userId }: Cozum): Promise<void> {
    const telegramId = BigInt(m.from!.id);
    const hazir = await this.baglamHazirla(tenantId, userId, telegramId, m.chat.id);
    if (!hazir) return;
    const { baglam, karar } = hazir;
    const belge = m.photo?.length || m.document;
    const tur = belge ? "belge" : !m.text ? "desteklenmeyen" : metin.startsWith("/") ? "komut" : "sohbet";
    olay(tur);
    // CNL-01: aynı güncelleme ikinci kez gelirse burada elenir.
    if (!(await this.gelenIz(baglam, g.update_id, tur))) return;
    const yanitla = (yanit: string, yanitTuru: string) => baglamlaCalistir(baglam, () => this.firmayaGonder(tenantId, userId, telegramId, yanitTuru, yanit, karar.tutarGoster));

    if (karar.neden === "rol_kapali") return void (await yanitla(`Yanıt veremiyorum: ${DUSME_METNI.rol_kapali}.`, "red"));
    const ritim = m.text ? ritimKomutu(metin) : null;
    if (ritim) {
      const simdi = new Date();
      const bitis = ritim === "sus" ? new Date(simdi.getTime() + 24 * 60 * 60 * 1000) : ritim === "bugunluk" ? gunSonu(simdi) : null;
      await baglamlaCalistir(baglam, () => this.susAyarla(tenantId, userId, bitis));
      return void (await yanitla(
        ritim === "devam" ? "Kendiliğinden mesajlar yeniden açıldı." : ritim === "sus" ? "Tamam, 24 saat boyunca kendiliğinden mesaj göndermeyeceğim. Sorularınızı yanıtlamayı sürdürürüm; yeniden açmak için /devam yazın." : "Tamam, bugün başka kendiliğinden mesaj göndermeyeceğim. Yeniden açmak için /devam yazın.",
        "komut",
      ));
    }
    if (tur === "belge") return this.belgeIsle(baglam, m);
    if (tur === "desteklenmeyen") return void (await yanitla(m.voice ? "Sesli mesajları henüz anlayamıyorum; sorunuzu yazarak iletin." : "Bu tür mesajı anlayamıyorum. Soru yazabilir ya da fiş/fatura fotoğrafı gönderebilirsiniz.", "bilgi"));
    if (tur === "komut") {
      const komut = metin.split(/\s+/)[0].replace(/@\w+$/, "").toLowerCase();
      if (komut === "/ayril") {
        await this.telegram.bagDusur(tenantId, userId, "telegram");
        await this.dogrudanGonder(m.chat.id, "Bağlantı kaldırıldı. Bu hesaptan artık TekirExtra verisi gelmeyecek. Yeniden bağlamak için paneli kullanın.");
        return;
      }
      if (komut === "/yeni") {
        await baglamlaCalistir(baglam, () => this.ajan.telegramSohbetiniKapat());
        return void (await yanitla("Yeni sohbet başladı. Sorunuzu yazabilirsiniz.", "bilgi"));
      }
      if (komut === "/start") return void (await yanitla(`Hesabınız bağlı. ${YARDIM}`, "bilgi"));
      return void (await yanitla(YARDIM, "bilgi"));
    }

    // CNL-09: bir soru mesajına yanıt olarak yazılan metin soruya gider, asistana değil.
    if (m.reply_to_message && this.sorular) {
      const gonderim = await baglamlaCalistir(baglam, () => this.prisma.tenantIslem(tenantId, (tx) => tx.asistanSoruGonderimi.findFirst({ where: { userId, sohbetId: BigInt(m.chat.id), telegramMesajId: BigInt(m.reply_to_message!.message_id) }, select: { soruId: true } })));
      if (gonderim) return this.soruYanitla(baglam, gonderim.soruId, { metin }, m.chat.id, m.reply_to_message.message_id);
    }

    // Telegram "yazıyor" göstergesini ~5 sn tutar; model yanıtı uzun sürebildiği için yanıt gelene dek yenilenir.
    await this.istemci!.yaziyor(m.chat.id);
    const yaziyor = setInterval(() => void this.istemci!.yaziyor(m.chat.id), 4_500);
    let yanit: AjanYaniti;
    let aracCalisti = false;
    const sor = (deneme: number) => baglamlaCalistir(baglam, () => this.ajan.mesajiIsle(metin, guncellemeIstekKimligi(g.update_id, deneme), undefined, [], {
      kanal: "TELEGRAM",
      olay: (e) => { if (e.tur === "arac") aracCalisti = true; },
    }));
    try {
      try {
        yanit = await sor(1);
      } catch (hata) {
        // Model zaman aşımı ya da sağlayıcı hatası: hiçbir araç çalışmadıysa yan etki yoktur, bir kez
        // yeniden denenir. Araç çalıştıysa (taslak açılmış olabilir) yeniden denemek çift kayıt doğurur.
        if (!(hata instanceof ServiceUnavailableException) || aracCalisti) throw hata;
        olay("ai_yeniden_deneme");
        yanit = await sor(2);
      }
    } catch (hata) {
      clearInterval(yaziyor);
      if (hata instanceof ConflictException) return;
      const sinir = hata instanceof AiSinirHatasi;
      if (!sinir) this.logger.error(`Telegram asistan yanıtı üretilemedi: ${hata instanceof Error ? hata.message.split("\n").filter(Boolean).pop() : String(hata)}`);
      await baglamlaCalistir(baglam, () => this.prisma.tenantIslem(tenantId, (tx) => tx.telegramMesaji.updateMany({ where: { guncellemeNo: BigInt(g.update_id) }, data: { durum: "hata", hataTuru: sinir ? "ai_sinir" : "ai_hata" } })));
      await yanitla(sinir
        ? "Bu ayın yapay zekâ kullanım sınırına ulaşıldı; asistan şu anda yanıt veremiyor. Yöneticiniz Ayarlar › Yapay zekâ ekranından sınırı görebilir."
        : "Şu anda yanıt veremiyorum. Biraz sonra yeniden deneyin.", "hata");
      return;
    }
    clearInterval(yaziyor);
    await baglamlaCalistir(baglam, () => this.prisma.tenantIslem(tenantId, (tx) => tx.telegramMesaji.updateMany({ where: { guncellemeNo: BigInt(g.update_id) }, data: { durum: "islendi" } })));
    await yanitla(telegramYaniti(yanit), "sohbet");
  }

  /**
   * CNL-17d: alıcı, gönderen firmanın kendi bağ kaydından alınır ve gönderimden hemen önce bağın
   * etkin, aynı firmaya ve aynı Telegram hesabına ait olduğu yeniden doğrulanır; doğrulanamayan
   * mesaj gönderilmez, kayda geçer.
   */
  async firmayaGonder(tenantId: string, userId: string, beklenenHesap: bigint | null, tur: string, metin: string, tutarGoster?: boolean): Promise<GonderimSonucu> {
    const { bag, ayar } = await this.prisma.tenantIslem(tenantId, async (tx) => ({
      bag: await tx.telegramBagi.findUnique({ where: { userId }, select: { tenantId: true, telegramKullaniciId: true, sohbetId: true } }),
      ayar: await telegramAyariOku(tx, tenantId),
    }));
    if (!bag || bag.tenantId !== tenantId || !ayar.etkin || (beklenenHesap !== null && bag.telegramKullaniciId !== beklenenHesap)) {
      await this.prisma.tenantIslem(tenantId, (tx) => this.iz(tx, tenantId, userId, "giden", tur, "gonderilmedi", "bag_gecersiz"));
      return "bag_gecersiz";
    }
    const temiz = telegramSuz(metin, { tutarGoster: tutarGoster ?? ayar.tutarGoster });
    let hataTuru: string | null = null;
    for (const parca of parcala(temiz)) {
      try {
        await this.istemci!.gonder(bag.sohbetId, parca);
      } catch (hata) {
        if (hata instanceof TelegramHatasi && hata.tur === "hiz_siniri" && (hata.bekleSn ?? 0) <= 10) {
          await uyu((hata.bekleSn ?? 1) * 1000);
          try { await this.istemci!.gonder(bag.sohbetId, parca); continue; } catch (ikinci) { hataTuru = ikinci instanceof TelegramHatasi ? ikinci.tur : "bilinmeyen"; }
        } else hataTuru = hata instanceof TelegramHatasi ? hata.tur : "bilinmeyen";
        break;
      }
    }
    if (hataTuru) this.hataSay(hataTuru);
    await this.prisma.tenantIslem(tenantId, (tx) => this.iz(tx, tenantId, userId, "giden", tur, hataTuru ? "gonderilmedi" : "gonderildi", hataTuru));
    return hataTuru ? "hata" : "gonderildi";
  }

  /** CNL-07: "sus" / "bugünlük yeter" / "/devam"; kullanıcı ayarına (sessiz saatle aynı kayıt) yazılır. */
  async susAyarla(tenantId: string, userId: string, bitis: Date | null): Promise<void> {
    await this.prisma.tenantIslem(tenantId, (tx) => tx.bildirimKullaniciAyari.upsert({
      where: { userId }, create: { tenantId, userId, telegramSusBitis: bitis }, update: { telegramSusBitis: bitis },
    }));
  }
}

/** Gönderilmeyen mesajın nedeni: bağ yok/başka hesap (bir daha denenmez) ya da Telegram hatası (yeniden denenebilir). */
export type GonderimSonucu = "gonderildi" | "bag_gecersiz" | "hata";

/** CNL-04: onay talebi açıldıysa özeti ve panel bağlantısı eklenir; onay/ret Telegram'dan yapılmaz. Panel yolları tam adres olur. */
export function telegramYaniti(yanit: Pick<AjanYaniti, "cevap" | "onayTalepleri">): string {
  const panel = (process.env.APP_URL ?? "http://localhost:3100").replace(/\/+$/, "");
  // Asistan panel için göreli yol yazar (/panel/...); Telegram'da tıklanabilsin diye tam adrese çevrilir.
  const cevap = yanit.cevap.replace(/(^|[\s(“"'])(\/panel\/[^\s)”"'<>]*)/g, (_e, on: string, yol: string) => `${on}${panel}${yol}`);
  const talepler = yanit.onayTalepleri.map((t) => `• ${t.ozet.replace(/\s+/g, " ").slice(0, 300)}\n  ${panel}/panel/ai?talep=${t.id}`);
  return talepler.length ? `${cevap}\n\nPanelde onayınızı bekleyen işlem:\n${talepler.join("\n")}` : cevap;
}

export type { DusmeNedeni };
