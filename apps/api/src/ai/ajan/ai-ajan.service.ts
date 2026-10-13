import { BadRequestException, ForbiddenException, Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../core/prisma.service";
import {
  araciBakiyeSorgula,
  araciStokSorgula,
  araciTeklifTaslagiHazirla,
  araciTeklifOnayla,
  araciBelgeGonder,
  araciCariEkstreGonder,
  araciOdemeHatirlatmasiYap,
  araciCrmGorevOlustur,
  AjanAracSonucu,
} from "./ai-ajan.tools";

export interface GelenAjanMesaji {
  kanal: "WHATSAPP" | "TELEGRAM" | "EMAIL" | "WEB";
  kanalKimlik: string; // Telefon veya e-posta
  mesaj?: string;
  sesBase64?: string;
  mimeType?: string;
  pinKodu?: string;
}

/** Oturumdan (aktifBaglam) gelen kimlik; istek gövdesinden alınmaz. */
export interface AjanKimligi {
  tenantId: string;
  userId: string;
}

export interface AjanCevabi {
  oturumId: string;
  cevap: string;
  eylem?: string;
  veri?: Record<string, unknown>;
  pinGerekiyor?: boolean;
}

@Injectable()
export class AiAjanService {
  private readonly logger = new Logger(AiAjanService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Oturum açmış kullanıcının mesajını işler
   */
  async mesajiIsle(girdi: GelenAjanMesaji, kimlik: AjanKimligi): Promise<AjanCevabi> {
    const kanal = girdi.kanal || "WEB";
    const kanalKimlik = (girdi.kanalKimlik || "").trim();
    if (!kanalKimlik) throw new BadRequestException("Kanal kimliği zorunludur.");
    const { tenantId } = kimlik;

    // 1. Kullanıcı yalnız oturumdan
    const user = await this.kullaniciyiGetir(kimlik);

    // 2. Oturumu Getir veya Başlat
    const oturum = await this.oturumBulVeyaOlustur(tenantId, user.id, kanal, kanalKimlik, user.pinKodu);

    // 3. PIN Doğrulama Denetimi
    const pinGerekli = Boolean(user.pinKodu && !oturum.pinDogrulandi);
    const islenecekMetin = girdi.mesaj?.trim() || "";

    if (pinGerekli) {
      const adayPin = girdi.pinKodu || (/^\d{4}$/.test(islenecekMetin) ? islenecekMetin : null);

      if (adayPin && adayPin === user.pinKodu) {
        await this.prisma.tenantIslem(tenantId, (tx) => {
          const txOturum = (tx as any)?.ajanOturumu || this.prisma.ajanOturumu;
          return txOturum.update({
            where: { id: oturum.id },
            data: { pinDogrulandi: true, sonEtkilesim: new Date() },
          });
        });

        const hosgeldinMesaji = `🔐 PIN kodunuz doğrulandı. Hoş geldiniz Sayın ${user.adSoyad}.\n\nSize nasıl yardımcı olabilirim?\n• *"Yılmaz Ticaret bakiye sorgula"*\n• *"A4 Kağıt stok sorgula"*\n• *"ABC Ltd için 50 adet teklif aç"*`;
        // PIN'in kendisi geçmişe yazılmaz.
        await this.mesajKaydet(tenantId, oturum.id, "user", "[PIN girildi]");
        await this.mesajKaydet(tenantId, oturum.id, "assistant", hosgeldinMesaji);

        return {
          oturumId: oturum.id,
          cevap: hosgeldinMesaji,
          pinGerekiyor: false,
        };
      }

      return {
        oturumId: oturum.id,
        cevap: `🔒 Güvenliğiniz için lütfen 4 haneli PIN kodunuzu giriniz.\n(Kullanıcı: ${user.adSoyad})`,
        pinGerekiyor: true,
      };
    }

    // Ses yazıya dökülemiyor; tahmin edilen bir komut çalıştırılmaz.
    if (!islenecekMetin) {
      return {
        oturumId: oturum.id,
        cevap: girdi.sesBase64
          ? "🎙️ Sesli mesajlar henüz yazıya dökülemiyor. Lütfen talimatınızı yazarak gönderin."
          : "Lütfen bir talimat yazın.",
        eylem: "girdi_yok",
      };
    }

    // 4. Kullanıcı Mesajını Kaydet
    await this.mesajKaydet(tenantId, oturum.id, "user", islenecekMetin);

    // 5. Niyet & Komut Çözümleme (Intent Extraction & Tool Dispatch)
    const aracSonucu = await this.komutuYurut(tenantId, user.id, islenecekMetin);

    // 6. Yanıtı Kaydet ve Oturumu Güncelle
    await this.mesajKaydet(tenantId, oturum.id, "assistant", aracSonucu.mesaj, aracSonucu.veri);
    await this.prisma.tenantIslem(tenantId, (tx) => {
      const txOturum = (tx as any)?.ajanOturumu || this.prisma.ajanOturumu;
      return txOturum.update({
        where: { id: oturum.id },
        data: { sonEtkilesim: new Date() },
      });
    });

    return {
      oturumId: oturum.id,
      cevap: aracSonucu.mesaj,
      eylem: aracSonucu.eylem,
      veri: aracSonucu.veri,
      pinGerekiyor: false,
    };
  }

  /**
   * PIN Doğrulama Ucu — yalnız kullanıcının kendi oturumu için
   */
  async pinDogrula(kimlik: AjanKimligi, kanal: string, kanalKimlik: string, pinKodu: string): Promise<boolean> {
    const { tenantId, userId } = kimlik;
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const txOturum = (tx as any)?.ajanOturumu || this.prisma.ajanOturumu;
      const oturum = await txOturum.findFirst({
        where: { tenantId, userId, kanal, kanalKimlik },
        include: { user: true },
      });

      if (!oturum || !oturum.user.pinKodu || oturum.user.pinKodu !== pinKodu) return false;

      await txOturum.update({
        where: { id: oturum.id },
        data: { pinDogrulandi: true, sonEtkilesim: new Date() },
      });
      return true;
    });
  }

  /**
   * Oturum Bilgisi ve Son Mesajlar — yalnız kullanıcının kendi oturumu
   */
  async oturumDetay(kimlik: AjanKimligi, oturumId: string) {
    const { tenantId, userId } = kimlik;
    return this.prisma.tenantIslem(tenantId, (tx) => {
      const txOturum = (tx as any)?.ajanOturumu || this.prisma.ajanOturumu;
      return txOturum.findFirst({
        where: { id: oturumId, userId },
        include: {
          mesajlar: { orderBy: { createdAt: "asc" }, take: 20 },
          user: { select: { id: true, adSoyad: true, eposta: true, rol: true } },
        },
      });
    });
  }

  // ─── YARDIMCI METODLAR ──────────────────────────────────────────────────

  private async kullaniciyiGetir(kimlik: AjanKimligi) {
    const user = await this.prisma.tenantIslem(kimlik.tenantId, (tx) =>
      tx.user.findFirst({ where: { id: kimlik.userId, tenantId: kimlik.tenantId } }),
    );
    if (!user) throw new ForbiddenException("Kullanıcı bu kiracıda bulunamadı.");
    return user;
  }

  private async oturumBulVeyaOlustur(
    tenantId: string,
    userId: string,
    kanal: string,
    kanalKimlik: string,
    userPin?: string | null,
  ) {
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const txOturum = (tx as any)?.ajanOturumu || this.prisma.ajanOturumu;
      let oturum = await txOturum.findUnique({
        where: {
          tenantId_kanal_kanalKimlik: { tenantId, kanal, kanalKimlik },
        },
      });

      if (oturum && oturum.userId !== userId) {
        throw new ForbiddenException("Bu kanal kimliği başka bir kullanıcıya bağlı.");
      }

      if (!oturum) {
        oturum = await txOturum.create({
          data: {
            tenantId,
            userId,
            kanal,
            kanalKimlik,
            pinDogrulandi: !userPin, // PIN yoksa doğrudan onaylı
          },
        });
      } else {
        // 12 saatten uzun süre geçmişse ve PIN varsa oturumu kilitle
        const onikiSaatOnce = new Date(Date.now() - 12 * 60 * 60 * 1000);
        if (oturum.sonEtkilesim < onikiSaatOnce && userPin) {
          oturum = await txOturum.update({
            where: { id: oturum.id },
            data: { pinDogrulandi: false },
          });
        }
      }

      return oturum;
    });
  }

  private async mesajKaydet(tenantId: string, oturumId: string, rol: string, icerik: string, aracCagrisi?: any) {
    return this.prisma.tenantIslem(tenantId, (tx) => {
      const txMesaj = (tx as any)?.ajanMesajGecmisi || this.prisma.ajanMesajGecmisi;
      return txMesaj.create({
        data: {
          oturumId,
          rol,
          icerik,
          aracCagrisi: aracCagrisi || undefined,
        },
      });
    });
  }

  /**
   * Doğal dildeki kullanıcı girdisini analiz eder ve ilgili aracı çalıştırır
   */
  private async komutuYurut(tenantId: string, userId: string, metin: string): Promise<AjanAracSonucu> {
    const m = metin.trim();
    const kucuk = m.toLowerCase();

    return this.prisma.tenantIslem(tenantId, async (tx) => {
      // 1. ONAY EYLEMİ ("ONAYLA", "TEKLİFİ ONAYLA", "TKF-2026-0001 ONAYLA")
      if (kucuk.includes("onayla")) {
        const teklifNoMatch = m.match(/TKF-\d{4}-\d{4}/i);
        return araciTeklifOnayla(tx, tenantId, {
          teklifNo: teklifNoMatch ? teklifNoMatch[0] : undefined,
        });
      }

      // 2. TEKLİF TASLAĞI OLUŞTURMA ("X firmasına 50 adet Y teklifi aç", "teklif hazırla", "teklif oluştur")
      if (
        (kucuk.includes("teklif") && (kucuk.includes("aç") || kucuk.includes("hazırla") || kucuk.includes("oluştur") || kucuk.includes("ver") || kucuk.includes("vadeli"))) ||
        kucuk.includes("fiyat ver")
      ) {
        // Miktar tespiti (örn: 50 adet, 10 koli, 100)
        const miktarMatch = m.match(/(\d+)\s*(?:adet|koli|paket|kg|ton|metre|kutu)?/i);
        const miktar = miktarMatch ? parseInt(miktarMatch[1], 10) : 1;

        // Fiyat tespiti (örn: birim fiyatı 120 TL, 120 liradan, 120 TL)
        const fiyatMatch = m.match(/(?:fiyat[ı]?|tutar[ı]?|birim\s+fiyat[ı]?)\s*[:=]?\s*(\d+(?:[.,]\d+)?)|(\d+(?:[.,]\d+)?)\s*(?:tl|lira)/i);
        let birimFiyat: number | undefined;
        if (fiyatMatch) {
          const hamFiyat = fiyatMatch[1] || fiyatMatch[2];
          birimFiyat = parseFloat(hamFiyat.replace(",", "."));
        }

        // Vade tespiti (örn: 60 gün vadeli, 30 gün)
        const vadeMatch = m.match(/(\d+)\s*gün(?:\s*vade|\s*vadeli)?/i);
        const vadeGun = vadeMatch ? parseInt(vadeMatch[1], 10) : 0;

        // Cari ve Ürün adı ayrıştırma
        let cariAdi = "Yılmaz Ticaret";
        let urunAdi = "A4 Kağıt";

        const cariMatch = m.match(/([a-zA-ZçğıöşüÇĞİÖŞÜ0-9\s.]+?)(?:'e|'a|'ye|'ya|\sfirmasına|\scarisine|\sşirketine)/i);
        if (cariMatch) cariAdi = cariMatch[1].trim();

        // Ürün adı
        const urunMatch = m.match(/(?:için|adet|koli|paket)\s+([a-zA-ZçğıöşüÇĞİÖŞÜ0-9\s]+?)(?:\s+teklif|\s+için|\s+fiyat|\s+vadeli|\s+\d+\s+tl)/i);
        if (urunMatch) urunAdi = urunMatch[1].trim();

        return araciTeklifTaslagiHazirla(tx, tenantId, {
          cariAdi,
          urunAdi,
          miktar,
          birimFiyat,
          vadeGun,
        });
      }

      // 3. BELGE GÖNDERME EYLEMİ ("e-posta ile gönder", "WhatsApp'tan at", "müşteriye ilet")
      const gonderimKelimeleri = /\b(gönder|ilet|paylaş|yolla)\b|e-posta\s+at|whatsapp(?:'tan)?\s+at/i;
      if (gonderimKelimeleri.test(m)) {
        // Cari ekstresi mi isteniyor?
        if (kucuk.includes("ekstre")) {
          const cariAdiMatch = m.match(/([a-zA-ZçğıöşüÇĞİÖŞÜ0-9\s.]+?)(?:'ye|'ya|'e|'a|\sfirmasına|\scarisine|\sşirketine)?\s+(?:son\s+\d+\s+aylık\s+)?(?:cari\s+)?ekstre/i);
          const cariAdi = cariAdiMatch ? cariAdiMatch[1].trim() : "Müşteri";
          const kanal = kucuk.includes("whatsapp") ? "WHATSAPP" : "EMAIL";
          return araciCariEkstreGonder(tx, tenantId, { cariAdi, kanal });
        }

        // Ödeme hatırlatması mı isteniyor?
        if (kucuk.includes("hatırlat")) {
          const kanal = kucuk.includes("whatsapp") ? "WHATSAPP" : "EMAIL";
          return araciOdemeHatirlatmasiYap(tx, tenantId, { kanal });
        }

        // Teklif veya Fatura PDF iletimi
        const kanal = kucuk.includes("whatsapp") ? "WHATSAPP" : "EMAIL";
        const teklifNoMatch = m.match(/TKF-\d{4}-\d{4}/i);
        return araciBelgeGonder(tx, tenantId, {
          belgeTuru: "teklif",
          belgeNo: teklifNoMatch ? teklifNoMatch[0] : undefined,
          kanal,
        });
      }

      // 4. ÖDEME HATIRLATMASI EYLEMİ ("geciken faturalar", "ödeme hatırlat")
      if (kucuk.includes("hatırlat") || kucuk.includes("gecik")) {
        const kanal = kucuk.includes("whatsapp") ? "WHATSAPP" : "EMAIL";
        return araciOdemeHatirlatmasiYap(tx, tenantId, { kanal });
      }

      // 5. BAKİYE SORGULAMA ("... bakiye", "... borcu ne kadar")
      if (kucuk.includes("bakiye") || kucuk.includes("borç") || kucuk.includes("alacak")) {
        const cariAdi = m
          .replace(/bakiye(si)?|sorgula|borç|borcu|nedir|ne kadar|\?/gi, "")
          .replace(/('nin|'nın|'in|'ın|'ün|'un)/gi, "")
          .trim();

        return araciBakiyeSorgula(tx, tenantId, { cariAdi: cariAdi || "Yılmaz" });
      }

      // 6. STOK SORGULAMA ("... stokta ne kadar var", "... stoğu nedir", "... fiyatı kaç")
      if (
        kucuk.includes("stok") ||
        kucuk.includes("stoğ") ||
        kucuk.includes("stogu") ||
        (kucuk.includes("fiyat") && !kucuk.includes("teklif")) ||
        kucuk.includes("kaç adet var")
      ) {
        const urunAdi = m
          .replace(/stok(ta|u)?|stoğu|stogu|mevcut|miktar|ne kadar|kaç adet|fiyatı|kaç|var|\?/gi, "")
          .replace(/('nin|'nın|'in|'ın)/gi, "")
          .trim();

        return araciStokSorgula(tx, tenantId, { urunAdi: urunAdi || "A4" });
      }

      // 6. TEKLİF TASLAĞI OLUŞTURMA ("X firmasına 50 adet Y teklifi aç", "teklif hazırla")
      if (kucuk.includes("teklif") || kucuk.includes("fiyat ver")) {
        // Miktar tespiti (örn: 50 adet, 10 koli, 100)
        const miktarMatch = m.match(/(\d+)\s*(?:adet|koli|paket|kg|ton|metre|kutu)?/i);
        const miktar = miktarMatch ? parseInt(miktarMatch[1], 10) : 1;

        // Fiyat tespiti (örn: birim fiyatı 120 TL, 120 liradan, 120 TL)
        const fiyatMatch = m.match(/(?:fiyat[ı]?|tutar[ı]?|birim\s+fiyat[ı]?)\s*[:=]?\s*(\d+(?:[.,]\d+)?)|(\d+(?:[.,]\d+)?)\s*(?:tl|lira)/i);
        let birimFiyat: number | undefined;
        if (fiyatMatch) {
          const hamFiyat = fiyatMatch[1] || fiyatMatch[2];
          birimFiyat = parseFloat(hamFiyat.replace(",", "."));
        }

        // Vade tespiti (örn: 60 gün vadeli, 30 gün)
        const vadeMatch = m.match(/(\d+)\s*gün(?:\s*vade|\s*vadeli)?/i);
        const vadeGun = vadeMatch ? parseInt(vadeMatch[1], 10) : 0;

        // Cari ve Ürün adı ayrıştırma
        // Basit ve etkili regex: "X'e Y için teklif" veya "X firmasına Miktar Y teklif"
        let cariAdi = "Yılmaz Ticaret";
        let urunAdi = "A4 Kağıt";

        const cariMatch = m.match(/([a-zA-ZçğıöşüÇĞİÖŞÜ0-9\s.]+?)(?:'e|'a|'ye|'ya|\sfirmasına|\scarisine|\sşirketine)/i);
        if (cariMatch) cariAdi = cariMatch[1].trim();

        // Ürün adı
        const urunMatch = m.match(/(?:için|adet|koli|paket)\s+([a-zA-ZçğıöşüÇĞİÖŞÜ0-9\s]+?)(?:\s+teklif|\s+için|\s+fiyat|\s+vadeli|\s+\d+\s+tl)/i);
        if (urunMatch) urunAdi = urunMatch[1].trim();

        return araciTeklifTaslagiHazirla(tx, tenantId, {
          cariAdi,
          urunAdi,
          miktar,
          birimFiyat,
          vadeGun,
        });
      }

      // 7. CRM GÖREV AÇMA ("Görev aç", "Not ekle")
      if (kucuk.includes("görev") || kucuk.includes("not ekle") || kucuk.includes("toplantı")) {
        return araciCrmGorevOlustur(tx, tenantId, userId, {
          baslik: m,
          aciklama: "Kullanıcı sesli/yazılı talimatı ile oluşturuldu.",
        });
      }

      // 8. GENEL YARDIM VE SELAMLAMA
      return {
        basarili: true,
        eylem: "yardim",
        mesaj: `👋 Merhaba! Ben **TekirExtra Asistanınız**. Şu talimatları yazarak verebilirsiniz:\n\n• 📊 **Bakiye:** *"Yılmaz Ticaret bakiye sorgula"*\n• 📦 **Stok:** *"A4 Kağıt stoğu ne kadar?"*\n• 📝 **Teklif:** *"Yılmaz Ticarete 50 koli A4 Kağıt için 60 gün vadeli teklif hazırla, birim fiyat 120 TL"*\n• ✅ **Onay:** *"ONAYLA"*\n\nBelge, ekstre ve ödeme hatırlatması gönderimi henüz asistandan yapılamıyor; ilgili ekranları kullanın.`,
      };
    });
  }
}
