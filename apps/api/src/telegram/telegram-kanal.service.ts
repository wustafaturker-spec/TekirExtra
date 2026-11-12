import { ConflictException, Injectable, Logger, OnModuleDestroy, OnModuleInit, ServiceUnavailableException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import type { Rol } from "@tekirextra/shared";
import { AiAjanService, type AjanYaniti } from "../ai/ajan/ai-ajan.service";
import { AiSinirHatasi } from "../ai/saglayici/ai-butce";
import { baglamlaCalistir } from "../core/istek-baglami";
import { nabizla } from "../core/nabiz/nabiz";
import { PrismaService } from "../core/prisma.service";
import { structuredLogger } from "../core/observability/structured-logger";
import { uzayanKilitle } from "../core/redis-kilit";
import { DUSME_METNI, telegramAyariOku, telegramBotAdi, type DusmeNedeni } from "./telegram-ayar";
import { TelegramHatasi, TelegramIstemci, type TelegramGuncelleme, type TelegramMesaj } from "./telegram-istemci";
import { parcala, telegramSuz } from "./telegram-suzgec";
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
const YARDIM = "Sorunuzu doğrudan yazabilirsiniz; ör. “bugün vadesi gelen alacaklar”, “kasa ve banka bakiyeleri”, “ABC Ltd. cari durumu”.\n\nKomutlar:\n/yeni — yeni bir sohbet başlatır\n/ayril — bu Telegram hesabının TekirExtra bağlantısını kaldırır\n/yardim — bu yardım\n\nOnay, ödeme ve gönderim gibi kararlar yalnız panelde verilir; buradan yalnız onay talebi açılır.";

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
    const anahtar = String(g.message?.chat.id ?? `g${g.update_id}`);
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

  private async firmaMesaji(g: TelegramGuncelleme, m: TelegramMesaj, metin: string, { tenantId, userId }: Cozum): Promise<void> {
    const telegramId = BigInt(m.from!.id);
    const bag = await this.prisma.tenantIslem(tenantId, (tx) => tx.telegramBagi.findFirst({ where: { tenantId, userId, telegramKullaniciId: telegramId }, select: { oturumSurumu: true } }));
    if (!bag) { await this.dogrudanGonder(m.chat.id, YONERGE); return; }
    const karar = await this.telegram.bagKarari(tenantId, userId, bag);
    if (karar.neden && karar.neden !== "rol_kapali") {
      olay(`bag_dustu_${karar.neden}`);
      await this.telegram.bagDusur(tenantId, userId, karar.neden);
      await this.dogrudanGonder(m.chat.id, `Telegram bağlantınız kaldırıldı: ${DUSME_METNI[karar.neden]}. Gerekirse panelden yeniden bağlayabilirsiniz.`);
      return;
    }
    const baglam = { tenantId, userId, rol: karar.rol as Rol, ...(karar.ozelRol ? { ozelRol: karar.ozelRol } : {}), paketModulleri: karar.moduller };
    const tur = !m.text ? "desteklenmeyen" : metin.startsWith("/") ? "komut" : "sohbet";
    olay(tur);
    // CNL-01: aynı güncelleme ikinci kez gelirse burada elenir.
    try {
      await baglamlaCalistir(baglam, () => this.prisma.tenantIslem(tenantId, (tx) => this.iz(tx, tenantId, userId, "gelen", tur, "alindi", null, g.update_id)));
    } catch (hata) {
      if (hata instanceof Prisma.PrismaClientKnownRequestError && hata.code === "P2002") return;
      throw hata;
    }
    const yanitla = (yanit: string, yanitTuru: string) => baglamlaCalistir(baglam, () => this.firmayaGonder(tenantId, userId, telegramId, yanitTuru, yanit, karar.tutarGoster));

    if (karar.neden === "rol_kapali") return void (await yanitla(`Yanıt veremiyorum: ${DUSME_METNI.rol_kapali}.`, "red"));
    if (tur === "desteklenmeyen") return void (await yanitla("Şimdilik yalnız yazılı mesajları anlayabiliyorum. Sorunuzu yazarak iletin.", "bilgi"));
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
  async firmayaGonder(tenantId: string, userId: string, beklenenHesap: bigint | null, tur: string, metin: string, tutarGoster?: boolean): Promise<boolean> {
    const { bag, ayar } = await this.prisma.tenantIslem(tenantId, async (tx) => ({
      bag: await tx.telegramBagi.findUnique({ where: { userId }, select: { tenantId: true, telegramKullaniciId: true, sohbetId: true } }),
      ayar: await telegramAyariOku(tx, tenantId),
    }));
    if (!bag || bag.tenantId !== tenantId || !ayar.etkin || (beklenenHesap !== null && bag.telegramKullaniciId !== beklenenHesap)) {
      await this.prisma.tenantIslem(tenantId, (tx) => this.iz(tx, tenantId, userId, "giden", tur, "gonderilmedi", "bag_gecersiz"));
      return false;
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
    return !hataTuru;
  }
}

/** CNL-04: onay talebi açıldıysa özeti ve panel bağlantısı eklenir; onay/ret Telegram'dan yapılmaz. Panel yolları tam adres olur. */
export function telegramYaniti(yanit: Pick<AjanYaniti, "cevap" | "onayTalepleri">): string {
  const panel = (process.env.APP_URL ?? "http://localhost:3100").replace(/\/+$/, "");
  // Asistan panel için göreli yol yazar (/panel/...); Telegram'da tıklanabilsin diye tam adrese çevrilir.
  const cevap = yanit.cevap.replace(/(^|[\s(“"'])(\/panel\/[^\s)”"'<>]*)/g, (_e, on: string, yol: string) => `${on}${panel}${yol}`);
  const talepler = yanit.onayTalepleri.map((t) => `• ${t.ozet.replace(/\s+/g, " ").slice(0, 300)}\n  ${panel}/panel/ai?talep=${t.id}`);
  return talepler.length ? `${cevap}\n\nPanelde onayınızı bekleyen işlem:\n${talepler.join("\n")}` : cevap;
}

export type { DusmeNedeni };
