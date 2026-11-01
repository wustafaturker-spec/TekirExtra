import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../core/prisma.service";
import { DepoService } from "../ekler/depo.service";
import { EpostaService } from "./eposta.service";
import { AiService } from "../ai/ai.service";
import { coz } from "../core/kripto";
import { epostaHtmliniTemizle } from "../core/guvenlik/eposta-html";
import { otomatikBasliklarMi } from "../ai/teklif-talebi/teklif-talebi.kurallari";
import { yanitlananKimlikler } from "../belgeler/teklif-takibi/teklif-takip.kurallari";
import { teklifYanitiniEslestir } from "../belgeler/teklif-takibi/teklif-yaniti";
import { cariAdaylari } from "../cari/cari-aday";

@Injectable()
export class ImapService {
  private readonly logger = new Logger(ImapService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly depoService: DepoService,
    private readonly epostaService: EpostaService,
    private readonly aiService: AiService,
  ) {}

  /**
   * Kiracının yapılandırılmış IMAP sunucusuna bağlanarak yeni iletileri çeker ve ekleri depolar.
   */
  async senkronizeEt(tenantId: string): Promise<{ senkronizeEdildi: number; toplam: number; mesaj?: string }> {
    const ayar = await this.epostaService.saklananAyar(tenantId);
    if (!ayar?.imapHost || !ayar?.imapKullaniciAdi || !ayar?.imapSifreliParola || !ayar?.imapAktif) {
      return { senkronizeEdildi: 0, toplam: 0, mesaj: "IMAP yapılandırılmamış veya aktif değil" };
    }

    const parola = coz(ayar.imapSifreliParola);
    const { ImapFlow } = await import("imapflow");
    const { simpleParser } = await import("mailparser");

    const client = new ImapFlow({
      host: ayar.imapHost,
      port: ayar.imapPort ?? 993,
      secure: (ayar.imapGuvenlik ?? "ssl") === "ssl",
      auth: { user: ayar.imapKullaniciAdi, pass: parola },
      logger: false,
    });

    let eklenenSayisi = 0;
    let toplam = 0;

    try {
      await client.connect();
      const lock = await client.getMailboxLock(ayar.imapKlasor || "INBOX", { readOnly: true });

      try {
        toplam = client.mailbox ? (client.mailbox.exists ?? 0) : 0;
        if (toplam === 0) {
          return { senkronizeEdildi: 0, toplam: 0 };
        }

        // Son 30 iletiyi çek
        const baslangic = Math.max(1, toplam - 29);
        const mesajAraligi = `${baslangic}:*`;

        const mesajlar = client.fetch(mesajAraligi, {
          uid: true,
          envelope: true,
          source: true,
        });

        for await (const message of mesajlar) {
          if (!message.source) continue;

          try {
            const parsed = await simpleParser(message.source);
            const mesajId = parsed.messageId || `imap-${tenantId}-${message.uid}-${message.seq}`;

            // Veritabanında daha önce işlenmiş mi?
            const mevcut = await this.prisma.tenantIslem(tenantId, (tx) =>
              tx.gelenEposta.findUnique({
                where: { tenantId_mesajId: { tenantId, mesajId } },
              }),
            );

            if (mevcut) continue;

            const gonderenEposta = (parsed.from?.value[0]?.address || "").toLowerCase().trim();
            const gonderenAdi = parsed.from?.value[0]?.name || null;
            const aliciEposta = parsed.to
              ? Array.isArray(parsed.to)
                ? parsed.to.map((t) => t.text).join(", ")
                : parsed.to.text
              : (ayar.gondericiEposta || "");
            const konu = parsed.subject || "(Konusuz)";
            const icerikMetin = parsed.text || "";
            // SEC-01: gönderen herkes olabilir; HTML kayıttan önce temizlenir.
            const icerikHtml = typeof parsed.html === "string" ? epostaHtmliniTemizle(parsed.html) : null;
            const tarih = parsed.date || new Date();

            // Otomatik Cari Eşleştirme (CariHesap veya CariKisi e-postasından)
            let cariId: string | null = null;
            if (gonderenEposta) {
              const cari = await this.prisma.tenantIslem(tenantId, async (tx) => {
                const dogrudanCari = await tx.cariHesap.findFirst({
                  where: {
                    tenantId,
                    eposta: { equals: gonderenEposta, mode: "insensitive" },
                    aktif: true,
                  },
                  select: { id: true },
                });
                if (dogrudanCari) return dogrudanCari;

                const kisiCari = await tx.cariKisi.findFirst({
                  where: {
                    tenantId,
                    eposta: { equals: gonderenEposta, mode: "insensitive" },
                  },
                  select: { cariId: true },
                });
                return kisiCari ? { id: kisiCari.cariId } : null;
              });

              if (cari) {
                cariId = cari.id;
              }
            }

            // Gelen e-posta ana kaydını oluştur
            const yeniEposta = await this.prisma.tenantIslem(tenantId, (tx) =>
              tx.gelenEposta.create({
                data: {
                  tenantId,
                  mesajId,
                  uid: message.uid,
                  gonderenAdi,
                  gonderenEposta,
                  aliciEposta,
                  konu,
                  icerikMetin,
                  icerikHtml,
                  tarih,
                  cariId,
                  durum: "yeni",
                  okundu: false,
                  otomatik: otomatikBasliklarMi(parsed.headers),
                  yanitlananMesajIdleri: yanitlananKimlikler(parsed.inReplyTo, parsed.references),
                },
              }),
            );

            // AI-39: gönderilmiş teklifin yanıtıysa takip "yanıt geldi" olur (model kullanılmaz).
            await this.prisma.tenantIslem(tenantId, (tx) => teklifYanitiniEslestir(tx, tenantId, yeniEposta))
              .catch((hata: unknown) => this.logger.warn(`Teklif yanıtı eşleştirilemedi (${yeniEposta.id}): ${String(hata)}`));

            // Ekleri MinIO nesne deposuna yükle ve kaydet
            if (parsed.attachments && parsed.attachments.length > 0) {
              for (const ek of parsed.attachments) {
                const dosyaAdi = ek.filename || "ek-belge";
                const mimeTuru = ek.contentType || "application/octet-stream";
                const boyut = ek.size || (ek.content ? ek.content.length : 0);
                const depolamaAnahtari = `${tenantId}/eposta/${yeniEposta.id}/${Date.now()}-${dosyaAdi}`;

                try {
                  await this.depoService.yukle(depolamaAnahtari, ek.content, mimeTuru);

                  await this.prisma.tenantIslem(tenantId, (tx) =>
                    tx.gelenEpostaEk.create({
                      data: {
                        tenantId,
                        epostaId: yeniEposta.id,
                        dosyaAdi,
                        mimeTuru,
                        boyut,
                        minioAnahtari: depolamaAnahtari,
                      },
                    }),
                  );
                } catch (yuklemeHatasi) {
                  this.logger.error(`E-posta eki MinIO'ya yüklenemedi: ${dosyaAdi}`, yuklemeHatasi);
                }
              }
            }

            eklenenSayisi++;
          } catch (mesajHatasi) {
            this.logger.error(`İleti ayrıştırılamadı (UID: ${message.uid})`, mesajHatasi);
          }
        }
      } finally {
        lock.release();
      }

      await client.logout().catch(() => undefined);
    } catch (hata) {
      this.logger.error(`IMAP senkronizasyon hatası (tenant: ${tenantId})`, hata);
      throw new BadRequestException(
        hata instanceof Error ? `IMAP senkronizasyon hatası: ${hata.message}` : "IMAP bağlantısı kurulamadı",
      );
    }

    return { senkronizeEdildi: eklenenSayisi, toplam };
  }

  /**
   * Gelen e-postaları filtreli ve sayfalı listeler.
   */
  async listele(
    tenantId: string,
    filtre?: {
      sayfa?: number;
      adet?: number;
      okundu?: boolean;
      durum?: string;
      cariId?: string;
      arama?: string;
    },
  ) {
    const sayfa = Math.max(1, filtre?.sayfa || 1);
    const adet = Math.min(100, Math.max(1, filtre?.adet || 25));
    const atla = (sayfa - 1) * adet;

    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const where: any = { tenantId };
      if (filtre?.okundu !== undefined) where.okundu = filtre.okundu;
      if (filtre?.durum) where.durum = filtre.durum;
      if (filtre?.cariId) where.cariId = filtre.cariId;
      if (filtre?.arama) {
        where.OR = [
          { konu: { contains: filtre.arama, mode: "insensitive" } },
          { gonderenEposta: { contains: filtre.arama, mode: "insensitive" } },
          { gonderenAdi: { contains: filtre.arama, mode: "insensitive" } },
        ];
      }

      const [toplam, satirlar] = await Promise.all([
        tx.gelenEposta.count({ where }),
        tx.gelenEposta.findMany({
          where,
          include: {
            cari: { select: { id: true, kod: true, unvan: true } },
            ekler: { select: { id: true, dosyaAdi: true, mimeTuru: true, boyut: true, cikarilanVeri: true } },
            // AI-37: teklif talebi işlem durumu rozeti.
            teklifIslemi: { select: { durum: true, belgeId: true, onayTalebiId: true } },
            // AI-39: yanıt olduğu teklif.
            teklifBelge: { select: { id: true, no: true, revizyonNo: true } },
          },
          orderBy: { tarih: "desc" },
          skip: atla,
          take: adet,
        }),
      ]);

      return {
        toplam,
        sayfa,
        adet,
        sayfaSayisi: Math.ceil(toplam / adet),
        // SEC-01: temizlemeden önce kaydedilmiş eski iletiler de temiz döner.
        satirlar: satirlar.map((e) => ({ ...e, icerikHtml: epostaHtmliniTemizle(e.icerikHtml) })),
      };
    });
  }

  /**
   * Tek bir e-postanın tüm detaylarını ve eklerini getirir.
   */
  /**
   * E-posta ekranından yazılan ileti (yeni / yanıt / iletme). Yanıtta `yanitlananId` iletinin
   * zincirini (In-Reply-To + References) taşır; kiracının kendi adresi alıcılardan düşülür.
   */
  async iletiGonder(tenantId: string, girdi: { kime: string[]; konu: string; metin: string; yanitlananId?: string }) {
    let zincir: { inReplyTo?: string; references?: string[] } = {};
    if (girdi.yanitlananId) {
      const asil = await this.prisma.tenantIslem(tenantId, (tx) =>
        tx.gelenEposta.findFirst({ where: { id: girdi.yanitlananId, tenantId }, select: { mesajId: true, yanitlananMesajIdleri: true } }),
      );
      if (!asil) throw new NotFoundException("Yanıtlanan e-posta bulunamadı");
      zincir = { inReplyTo: asil.mesajId, references: [...new Set([...asil.yanitlananMesajIdleri, asil.mesajId])].slice(-20) };
    }
    const kendi = new Set(await this.epostaService.kendiAdresleri(tenantId));
    const tumu = [...new Set(girdi.kime.map((a) => a.trim().toLowerCase()))];
    const disaridakiler = tumu.filter((a) => !kendi.has(a));
    const alicilar = disaridakiler.length ? disaridakiler : tumu;
    try {
      await this.epostaService.serbestIletiGonder({ alici: alicilar.join(", "), konu: girdi.konu, metin: girdi.metin, ...zincir });
    } catch (hata) {
      throw new BadRequestException(`İleti gönderilemedi: ${hata instanceof Error ? hata.message : String(hata)}`);
    }
    return { gonderildi: true, alicilar };
  }

  async getir(tenantId: string, id: string) {
    const eposta = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.gelenEposta.findFirst({
        where: { id, tenantId },
        include: {
          cari: { select: { id: true, kod: true, unvan: true, eposta: true, telefon: true } },
          ekler: true,
          teklifIslemi: true,
          teklifBelge: { select: { id: true, no: true, revizyonNo: true } },
        },
      }),
    );
    if (!eposta) throw new NotFoundException("E-posta bulunamadı");
    return { ...eposta, icerikHtml: epostaHtmliniTemizle(eposta.icerikHtml) };
  }

  /**
   * AI-47: e-postanın göndereni için cari adayları (kesin adres eşleşmeleri ve
   * yaklaşık ipuçları). Teklif talebi işlendiyse e-postadan çıkarılan firma
   * bilgisi (VKN, telefon, unvan) de kullanılır. Model çağrılmaz.
   */
  async cariAdaylariGetir(tenantId: string, id: string) {
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const e = await tx.gelenEposta.findFirst({ where: { id, tenantId }, select: { gonderenAdi: true, gonderenEposta: true, teklifIslemi: { select: { cikarim: true } } } });
      if (!e) throw new NotFoundException("E-posta bulunamadı");
      const adres = e.gonderenEposta.trim();
      const [kartlar, kisiler] = adres ? await Promise.all([
        tx.cariHesap.findMany({ where: { tenantId, aktif: true, eposta: { equals: adres, mode: "insensitive" } }, select: { id: true, kod: true, unvan: true, vknTckn: true }, take: 5 }),
        tx.cariKisi.findMany({ where: { tenantId, eposta: { equals: adres, mode: "insensitive" }, cari: { aktif: true } }, select: { cari: { select: { id: true, kod: true, unvan: true, vknTckn: true } } }, take: 5 }),
      ]) : [[], []];
      const kesin = new Map([...kartlar, ...kisiler.map((k) => k.cari)].map((c) => [c.id, { cariId: c.id, kod: c.kod, unvan: c.unvan, vknTckn: c.vknTckn, gerekceler: ["gönderen adresi bu caride kayıtlı"], guclu: false, puan: 200 }]));
      const firma = (e.teklifIslemi?.cikarim as { firma?: { vknTckn?: string | null; telefon?: string | null; unvan?: string | null } | null } | null)?.firma ?? null;
      const yaklasik = await cariAdaylari(tx, tenantId, { eposta: adres, vknTckn: firma?.vknTckn, telefon: firma?.telefon, unvan: firma?.unvan ?? e.gonderenAdi });
      return [...kesin.values(), ...yaklasik.filter((a) => !kesin.has(a.cariId))].slice(0, 5);
    });
  }

  /**
   * Okundu bilgisini günceller.
   */
  async okunduGuncelle(tenantId: string, id: string, okundu: boolean) {
    await this.getir(tenantId, id);
    return this.prisma.tenantIslem(tenantId, (tx) =>
      tx.gelenEposta.update({
        where: { id, tenantId },
        data: { okundu },
      }),
    );
  }

  /**
   * E-posta işlem durumunu günceller (yeni, islendi, arsivlendi).
   */
  async durumGuncelle(tenantId: string, id: string, durum: string) {
    await this.getir(tenantId, id);
    return this.prisma.tenantIslem(tenantId, (tx) =>
      tx.gelenEposta.update({
        where: { id, tenantId },
        data: { durum },
      }),
    );
  }

  /**
   * Ek dosyayı MinIO'dan indirir.
   */
  async ekIndir(tenantId: string, epostaId: string, ekId: string) {
    const ek = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.gelenEpostaEk.findFirst({
        where: { id: ekId, epostaId, tenantId },
      }),
    );
    if (!ek) throw new NotFoundException("Ek dosya bulunamadı");
    const tampon = await this.depoService.indir(ek.minioAnahtari);
    return {
      tampon,
      dosyaAdi: ek.dosyaAdi,
      mimeTuru: ek.mimeTuru,
    };
  }

  /**
   * 1. İşlev: E-postadan CRM Fırsatı / Destek Görevi oluşturur.
   */
  async crmGorevOlustur(tenantId: string, epostaId: string, sorumluUserId?: string, secilenCariId?: string) {
    const eposta = await this.getir(tenantId, epostaId);

    // Fırsat yalnız kullanıcının seçtiği ya da e-postanın eşleştiği cariye açılır.
    // Eşleşme yoksa rastgele bir cariye bağlanmaz (fırsat yanlış müşteriye yazılırdı).
    let cariId = secilenCariId ?? eposta.cariId;
    if (!cariId) {
      throw new BadRequestException("E-posta bir cariyle eşleşmedi; fırsatın açılacağı cariyi seçin.");
    }
    if (secilenCariId) {
      const cari = await this.prisma.tenantIslem(tenantId, (tx) =>
        tx.cariHesap.findFirst({ where: { id: secilenCariId, tenantId, aktif: true }, select: { id: true } }),
      );
      if (!cari) throw new BadRequestException("Seçilen cari bulunamadı ya da pasif.");
      cariId = cari.id;
    }

    const baslik = `E-posta: ${eposta.konu.slice(0, 120)}`;
    const notlar = `Gönderen: ${eposta.gonderenAdi || ""} <${eposta.gonderenEposta}>\nTarih: ${eposta.tarih.toLocaleString("tr-TR")}\n\nİçerik Özeti:\n${(eposta.icerikMetin || "").slice(0, 1500)}`;

    const firsat = await this.prisma.tenantIslem(tenantId, async (tx) => {
      const f = await tx.crmFirsat.create({
        data: {
          tenantId,
          cariId: cariId!,
          baslik,
          tahminiTutar: 0,
          asama: "yeni_lead",
          sorumluUserId: sorumluUserId || null,
          notlar,
        },
        include: {
          cari: { select: { id: true, kod: true, unvan: true } },
        },
      });

      await tx.gelenEposta.update({
        where: { id: epostaId, tenantId },
        data: { crmFirsatId: f.id, durum: "islendi" },
      });

      return f;
    });

    return firsat;
  }

  /**
   * 2. İşlev: Ek dosyadaki (PDF/görsel) fatura veya masraf bilgilerini OCR ile çıkarır.
   */
  async ekOcrCikar(tenantId: string, epostaId: string, ekId: string) {
    const ek = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.gelenEpostaEk.findFirst({ where: { id: ekId, epostaId, tenantId } }),
    );
    if (!ek) throw new NotFoundException("Ek dosya bulunamadı");

    const dosyaBuffer = await this.depoService.indir(ek.minioAnahtari);
    const base64 = dosyaBuffer.toString("base64");

    const mimeTuru = ek.mimeTuru.toLowerCase().includes("pdf") ? "application/pdf" : "image/jpeg";

    const ocrSonucu = await this.aiService.fisFaturaOcrTara(tenantId, {
      gorselBase64: base64,
      mimeType: mimeTuru,
      belgeTipi: "fis_fatura",
    });

    // Çıkarılan veriyi ek kaydına sakla
    await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.gelenEpostaEk.update({
        where: { id: ekId, tenantId },
        data: { cikarilanVeri: ocrSonucu as any },
      }),
    );

    return ocrSonucu;
  }
}
