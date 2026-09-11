import { BadGatewayException, BadRequestException, HttpException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { aktifBaglam } from "../core/istek-baglami";
import { PrismaService } from "../core/prisma.service";
import { coz } from "../core/kripto";
import { IyzicoAdapter, iyzicoTelefonuDuzenle, type IyzicoConfig } from "./iyzico.adapter";
import { EpostaService } from "../tenant/eposta.service";
import { NetgsmAdapter, type NetgsmConfig } from "./netgsm.adapter";
import { PaytrAdapter, type PaytrCallback, type PaytrConfig } from "./paytr.adapter";
import { randomBytes } from "node:crypto";
import { adSoyadCoz } from "../cari/ad-soyad";
import { PdfService } from "../core/pdf/pdf.service";
import { makbuzPdfHtml } from "../kasa-banka/makbuz-pdf";

@Injectable()
export class PosService {
  constructor(private readonly prisma: PrismaService, private readonly eposta: EpostaService, private readonly pdf: PdfService) {}
  private config(sifreli: string): IyzicoConfig { const c = JSON.parse(coz(sifreli)) as any; return { apiKey: c.kullaniciAdi, secretKey: c.parola, baseUrl: c.servisAdresi ?? "https://sandbox-api.iyzipay.com" }; }
  private netgsmConfig(sifreli: string): NetgsmConfig { const c = JSON.parse(coz(sifreli)) as any; return { kullaniciAdi: c.kullaniciAdi, parola: c.parola, gondericiAdi: c.gondericiAdi, servisAdresi: c.servisAdresi }; }
  private paytrConfig(sifreli: string): PaytrConfig { const c = JSON.parse(coz(sifreli)) as any; return { merchantId: c.magazaId, merchantKey: c.kullaniciAdi, merchantSalt: c.parola }; }

  async listele(girdi: { durum?: "baslatildi"|"odendi"|"basarisiz"|"iptal"|"suresi_doldu"; arama?: string; posHesapId?: string; sayfa: number; adet: number }) { const { tenantId } = aktifBaglam(); const where: Prisma.PosTahsilatWhereInput = { durum: girdi.durum, posHesapId: girdi.posHesapId, ...(girdi.arama ? { OR: [{ cari: { unvan: { contains: girdi.arama, mode: "insensitive" } } }, { cari: { kod: { contains: girdi.arama, mode: "insensitive" } } }, { fatura: { no: { contains: girdi.arama, mode: "insensitive" } } }, { hataMesaji: { contains: girdi.arama, mode: "insensitive" } }] } : {}) }; return this.prisma.tenantIslem(tenantId, async (tx) => { await tx.posTahsilat.updateMany({ where: { durum: "baslatildi", sonKullanimTarihi: { lt: new Date() } }, data: { durum: "suresi_doldu" } }); const [hamKayitlar, toplam, durumlar] = await Promise.all([tx.posTahsilat.findMany({ where, orderBy: { createdAt: "desc" }, skip: (girdi.sayfa - 1) * girdi.adet, take: girdi.adet, include: { posHesap: { select: { id: true, ad: true, saglayici: true } }, cari: { select: { id: true, kod: true, unvan: true } }, fatura: { select: { id: true, no: true } } } }), tx.posTahsilat.count({ where }), tx.posTahsilat.groupBy({ by: ["durum"], _count: { _all: true } })]); const kayitlar = hamKayitlar.map((kayit) => ({ ...kayit, makbuzYolu: kayit.durum === "odendi" && kayit.hareketId ? `/pos/makbuz/${tenantId}/${kayit.id}/${kayit.makbuzAnahtari}` : null })); return { kayitlar, toplam, sayfa: girdi.sayfa, adet: girdi.adet, durumOzetleri: Object.fromEntries(durumlar.map((x) => [x.durum, x._count._all])) }; }); }

  async baslat(girdi: { posHesapId: string; cariId: string; faturaId?: string; tutar: string }) {
    const { tenantId } = aktifBaglam(); const tutar = new Prisma.Decimal(girdi.tutar);
    const kaynak = await this.prisma.tenantIslem(tenantId, (tx) => tx.posHesap.findUnique({ where: { id: girdi.posHesapId }, include: { baglanti: true } }));
    if (!kaynak || !kaynak.aktif || !["iyzico", "paytr"].includes(kaynak.saglayici) || !kaynak.baglanti || kaynak.baglanti.durum !== "aktif") throw new BadRequestException("Aktif bağlantılı POS hesabı bulunamadı");
    const cari = await this.prisma.tenantIslem(tenantId, (tx) => tx.cariHesap.findUnique({ where: { id: girdi.cariId }, include: { adresler: { take: 1 } } }));
    if (!cari) throw new NotFoundException("Cari hesap bulunamadı");
    if (!cari.aktif) throw new BadRequestException("Pasif cari hesaba ödeme talebi oluşturulamaz");
    if (cari.dovizCinsi !== kaynak.dovizCinsi) throw new BadRequestException("Cari hesap ve POS hesabı para birimleri aynı olmalıdır");
    if (!cari.eposta) throw new BadRequestException("Ödeme bağlantısı için carinin e-posta adresi zorunludur");
    if (kaynak.saglayici === "iyzico" && !cari.adresler[0]) throw new BadRequestException("iyzico ödemesi için carinin en az bir adresi zorunludur");
    if (girdi.faturaId) { const f = await this.prisma.tenantIslem(tenantId, (tx) => tx.fatura.findFirst({ where: { id: girdi.faturaId, cariId: cari.id }, include: { kasaBankaHarekets: { select: { tutar: true } }, krediKartiHareketleri: { select: { cariOdemeTutari: true } } } })); if (!f || f.durum !== "kesin" || !["satis", "alis_iade"].includes(f.tip)) throw new BadRequestException("Yalnızca kesinleşmiş açık satış faturası tahsil edilebilir"); if (f.dovizCinsi !== kaynak.dovizCinsi) throw new BadRequestException("Fatura ve POS hesabı para birimleri aynı olmalıdır"); const odenen = f.kasaBankaHarekets.reduce((t, h) => t.add(h.tutar), new Prisma.Decimal(0)).add(f.krediKartiHareketleri.reduce((t, h) => t.add(h.cariOdemeTutari ?? 0), new Prisma.Decimal(0))); const kalan = Prisma.Decimal.max(0, f.genelToplam.sub(odenen)); if (tutar.gt(kalan)) throw new BadRequestException(`Tahsilat kalan ${kalan.toFixed(2)} ${f.dovizCinsi} tutarını aşamaz`); }
    const kayit = await this.prisma.tenantIslem(tenantId, (tx) => tx.posTahsilat.create({ data: { tenantId, posHesapId: kaynak.id, cariId: cari.id, faturaId: girdi.faturaId, tutar, dovizCinsi: kaynak.dovizCinsi, sonKullanimTarihi: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), makbuzAnahtari: randomBytes(32).toString("hex") } }));
    const callbackKoku = process.env.PUBLIC_API_URL ?? "http://localhost:3001"; const adres = cari.adresler[0]; const { ad, soyad } = adSoyadCoz(cari); // CARI-21: karttaki ad/soyad, yoksa unvandan tahmin
    try {
      if (kaynak.saglayici === "paytr") {
        if (!process.env.PUBLIC_API_URL || !callbackKoku.startsWith("https://") || /localhost|127\.0\.0\.1|:\d+(?:\/|$)/i.test(callbackKoku)) throw new BadRequestException("PayTR için portsuz, herkese açık HTTPS PUBLIC_API_URL tanımlanmalıdır");
        const sonuc = await new PaytrAdapter().linkOlustur(this.paytrConfig(kaynak.baglanti.sifreliConfig), { ad: girdi.faturaId ? "Fatura tahsilati" : "Cari hesap tahsilati", tutarKurus: Number(tutar.mul(100).toFixed(0)), dovizCinsi: kaynak.dovizCinsi, eposta: cari.eposta, callbackUrl: `${callbackKoku}/api/v1/pos/paytr/callback/${tenantId}/${kayit.id}`, callbackId: kayit.id.replace(/-/g, "") });
        const tamamlanan = await this.prisma.tenantIslem(tenantId, (tx) => tx.posTahsilat.update({ where: { id: kayit.id }, data: { saglayiciToken: sonuc.id, odemeSayfasiUrl: sonuc.link } }));
        await this.odemeLinkiEpostala(tenantId, tamamlanan.id, cari.eposta, cari.unvan, sonuc.link, girdi.faturaId).catch(() => undefined); if (cari.telefon) await this.odemeLinkiSmsGonder(tenantId, tamamlanan.id, cari.telefon, cari.unvan, sonuc.link, girdi.faturaId).catch(() => undefined);
        return this.prisma.tenantIslem(tenantId, (tx) => tx.posTahsilat.findUniqueOrThrow({ where: { id: tamamlanan.id } }));
      }
      const sonuc = await new IyzicoAdapter().odemeBaslat(this.config(kaynak.baglanti.sifreliConfig), { locale: "tr", conversationId: kayit.id, price: Number(tutar), paidPrice: Number(tutar), currency: kaynak.dovizCinsi, basketId: girdi.faturaId ?? kayit.id, paymentGroup: "PRODUCT", callbackUrl: `${callbackKoku}/api/v1/pos/iyzico/callback/${tenantId}/${kayit.id}`, buyer: { id: cari.id, name: ad, surname: soyad, identityNumber: cari.vknTckn ?? "11111111111", email: cari.eposta, gsmNumber: iyzicoTelefonuDuzenle(cari.telefon), registrationAddress: adres.adres, city: adres.il ?? "İstanbul", country: adres.ulke ?? "Türkiye", zipCode: adres.postaKodu ?? undefined }, billingAddress: { contactName: cari.unvan, address: adres.adres, city: adres.il ?? "İstanbul", country: adres.ulke ?? "Türkiye", zipCode: adres.postaKodu ?? undefined }, basketItems: [{ id: girdi.faturaId ?? kayit.id, name: girdi.faturaId ? "Fatura tahsilatı" : "Cari hesap tahsilatı", category1: "Tahsilat", itemType: "VIRTUAL", price: Number(tutar) }] });
      const tamamlanan = await this.prisma.tenantIslem(tenantId, (tx) => tx.posTahsilat.update({ where: { id: kayit.id }, data: { saglayiciToken: sonuc.token, odemeSayfasiUrl: sonuc.odemeSayfasiUrl } }));
      await this.odemeLinkiEpostala(tenantId, tamamlanan.id, cari.eposta, cari.unvan, sonuc.odemeSayfasiUrl, girdi.faturaId).catch(() => undefined);
      if (cari.telefon) await this.odemeLinkiSmsGonder(tenantId, tamamlanan.id, cari.telefon, cari.unvan, sonuc.odemeSayfasiUrl, girdi.faturaId).catch(() => undefined);
      return this.prisma.tenantIslem(tenantId, (tx) => tx.posTahsilat.findUniqueOrThrow({ where: { id: tamamlanan.id } }));
    } catch (hata) {
      const mesaj = hata instanceof Error ? hata.message : "Ödeme başlatılamadı";
      const saglayiciHatasi = !(hata instanceof HttpException); const yapilandirmaHatasi = /api bilgileri|api key|unauthor|kimlik|credential|merchant|şifre|parola/i.test(mesaj);
      await this.prisma.tenantIslem(tenantId, async (tx) => {
        await tx.posTahsilat.update({ where: { id: kayit.id }, data: { durum: "basarisiz", hataMesaji: mesaj } });
        if (saglayiciHatasi && yapilandirmaHatasi) await tx.baglanti.update({ where: { id: kaynak.baglanti!.id }, data: { durum: "hata", sonSenkronHatasi: mesaj } });
      });
      if (hata instanceof HttpException) throw hata;
      throw new BadGatewayException(`${kaynak.saglayici} ödeme bağlantısı oluşturulamadı: ${mesaj}. POS bağlantı bilgilerini ve seçilen ortamı kontrol edin.`);
    }
  }

  async paytrCallback(tenantId: string, tahsilatId: string, girdi: PaytrCallback) {
    const kayit = await this.prisma.tenantIslem(tenantId, (tx) => tx.posTahsilat.findUnique({ where: { id: tahsilatId }, include: { posHesap: { include: { baglanti: true } } } }));
    if (!kayit?.posHesap.baglanti || kayit.posHesap.saglayici !== "paytr" || girdi.callback_id !== tahsilatId.replace(/-/g, "") || girdi.status !== "success") throw new BadRequestException("Geçersiz PayTR bildirimi");
    const config = this.paytrConfig(kayit.posHesap.baglanti.sifreliConfig); if (girdi.merchant_id !== config.merchantId || !new PaytrAdapter().callbackDogrula(config, girdi)) throw new BadRequestException("PayTR bildirim imzası geçersiz");
    const doviz = girdi.currency === "TL" ? "TRY" : girdi.currency; if (doviz !== kayit.dovizCinsi || !new Prisma.Decimal(girdi.payment_amount).div(100).equals(kayit.tutar)) throw new BadRequestException("PayTR ödeme tutarı veya dövizi uyuşmuyor");
    await this.odemeyiKaydet(tenantId, kayit, girdi.merchant_oid, "PayTR kart tahsilatı"); return "OK";
  }

  private async odemeyiKaydet(tenantId: string, kayit: any, odemeId: string, aciklama: string) {
    if (kayit.durum === "odendi") return { basarili: true, tekrar: true, makbuzAnahtari: kayit.makbuzAnahtari };
    return this.prisma.tenantIslem(tenantId, async (tx) => { const simdi = new Date(); const hak = await tx.posTahsilat.updateMany({ where: { id: kayit.id, durum: "baslatildi", hareketId: null }, data: { durum: "odendi", saglayiciOdemeId: odemeId, odemeTarihi: simdi, hataMesaji: null } }); if (hak.count !== 1) return { basarili: true, tekrar: true, makbuzAnahtari: kayit.makbuzAnahtari }; const kur = kayit.dovizCinsi === "TRY" ? new Prisma.Decimal(1) : (await tx.dovizKuru.findFirst({ where: { dovizCinsi: kayit.dovizCinsi, tarih: { lte: simdi } }, orderBy: { tarih: "desc" } }))?.dovizSatis; if (!kur) throw new BadRequestException(`${kayit.dovizCinsi} için güncel kur bulunamadı`); const tutarTry = kayit.tutar.mul(kur).toDecimalPlaces(2); const hareket = await tx.kasaBankaHareket.create({ data: { tenantId, posHesapId: kayit.posHesapId, tip: "tahsilat", tutar: kayit.tutar, dovizCinsi: kayit.dovizCinsi, kur, tutarTry, tarih: simdi, cariId: kayit.cariId, faturaId: kayit.faturaId, aciklama, kaynakTur: "pos_tahsilat", kaynakRef: kayit.id } }); await tx.cariHareket.create({ data: { tenantId, cariId: kayit.cariId, tip: "alacak", tutar: kayit.tutar, dovizCinsi: kayit.dovizCinsi, kur, tutarTry, tarih: simdi, aciklama, kaynakTur: "pos_tahsilat", kaynakRef: kayit.id } }); await tx.posTahsilat.update({ where: { id: kayit.id }, data: { hareketId: hareket.id } }); return { basarili: true, tekrar: false, makbuzAnahtari: kayit.makbuzAnahtari }; });
  }

  async epostaYenidenGonder(id: string) {
    const { tenantId } = aktifBaglam(); const kayit = await this.prisma.tenantIslem(tenantId, (tx) => tx.posTahsilat.findUnique({ where: { id }, include: { cari: { select: { eposta: true, unvan: true } } } }));
    if (!kayit?.odemeSayfasiUrl || !kayit.cari.eposta || kayit.durum !== "baslatildi") throw new BadRequestException("Gönderilebilir ödeme bağlantısı veya cari e-postası bulunamadı");
    await this.odemeLinkiEpostala(tenantId, kayit.id, kayit.cari.eposta, kayit.cari.unvan, kayit.odemeSayfasiUrl, kayit.faturaId); return { basarili: true };
  }

  async smsYenidenGonder(id: string) {
    const { tenantId } = aktifBaglam(); const kayit = await this.prisma.tenantIslem(tenantId, (tx) => tx.posTahsilat.findUnique({ where: { id }, include: { cari: { select: { telefon: true, unvan: true } } } }));
    if (!kayit?.odemeSayfasiUrl || !kayit.cari.telefon || kayit.durum !== "baslatildi") throw new BadRequestException("Gönderilebilir ödeme bağlantısı veya cari telefonu bulunamadı");
    await this.odemeLinkiSmsGonder(tenantId, kayit.id, kayit.cari.telefon, kayit.cari.unvan, kayit.odemeSayfasiUrl, kayit.faturaId); return { basarili: true };
  }

  async yenidenDene(id: string) { const { tenantId } = aktifBaglam(); const eski = await this.prisma.tenantIslem(tenantId, (tx) => tx.posTahsilat.findUnique({ where: { id } })); if (!eski || !["basarisiz", "suresi_doldu"].includes(eski.durum)) throw new BadRequestException("Yalnız başarısız veya süresi dolmuş talep yeniden denenebilir"); return this.baslat({ posHesapId: eski.posHesapId, cariId: eski.cariId, faturaId: eski.faturaId ?? undefined, tutar: eski.tutar.toFixed(2) }); }

  private async odemeLinkiEpostala(tenantId: string, id: string, alici: string, unvan: string, link: string, faturaId?: string | null) {
    try { await this.eposta.iletiGonder({ alici, konu: `TekirExtra — ${faturaId ? "fatura" : "cari hesap"} ödeme bağlantısı`, metin: `Merhaba ${unvan},\n\nGüvenli kart ödeme bağlantınız:\n${link}\n\nKart bilgileriniz TekirExtra tarafından görüntülenmez veya saklanmaz.` }); await this.prisma.tenantIslem(tenantId, (tx) => tx.posTahsilat.update({ where: { id }, data: { epostaGonderimTarihi: new Date(), epostaHatasi: null } })); }
    catch (hata) { const mesaj = hata instanceof Error ? hata.message : "E-posta gönderilemedi"; await this.prisma.tenantIslem(tenantId, (tx) => tx.posTahsilat.update({ where: { id }, data: { epostaHatasi: mesaj } })); throw hata; }
  }

  private async odemeLinkiSmsGonder(tenantId: string, id: string, telefon: string, unvan: string, link: string, faturaId?: string | null) {
    try {
      const baglanti = await this.prisma.tenantIslem(tenantId, (tx) => tx.baglanti.findFirst({ where: { aile: "sms", saglayici: "netgsm", durum: "aktif" }, orderBy: { updatedAt: "desc" } }));
      if (!baglanti) throw new Error("Aktif Netgsm SMS bağlantısı bulunamadı");
      const mesaj = `Sayin ${unvan}, ${faturaId ? "fatura" : "cari hesap"} odeme baglantiniz: ${link}`;
      const sonuc = await new NetgsmAdapter().smsGonder(this.netgsmConfig(baglanti.sifreliConfig), telefon, mesaj);
      await this.prisma.tenantIslem(tenantId, (tx) => tx.posTahsilat.update({ where: { id }, data: { smsGonderimTarihi: new Date(), smsGorevId: sonuc.gorevId, smsHatasi: null } }));
    } catch (hata) {
      const mesaj = hata instanceof Error ? hata.message : "SMS gönderilemedi";
      await this.prisma.tenantIslem(tenantId, (tx) => tx.posTahsilat.update({ where: { id }, data: { smsHatasi: mesaj } }));
      throw hata;
    }
  }

  async makbuzPdf(tenantId: string, tahsilatId: string, anahtar: string) {
    const [tahsilat, firma] = await this.prisma.tenantIslem(tenantId, (tx) => Promise.all([
      tx.posTahsilat.findFirst({ where: { id: tahsilatId, makbuzAnahtari: anahtar, durum: "odendi", hareketId: { not: null } }, include: { hareket: { include: { posHesap: true, cari: { select: { kod: true, unvan: true } }, fatura: { select: { no: true } } } } } }),
      tx.tenant.findUnique({ where: { id: tenantId }, select: { unvan: true } }),
    ]));
    if (!tahsilat?.hareket || !firma) throw new NotFoundException("Tahsilat makbuzu bulunamadı");
    const buffer = await this.pdf.htmlToPdf(makbuzPdfHtml(tahsilat.hareket, firma));
    return { buffer, dosyaAdi: `tahsilat-makbuzu-${tahsilat.id.slice(0, 8)}.pdf` };
  }

  async callback(tenantId: string, tahsilatId: string, token: string) {
    const kayit = await this.prisma.tenantIslem(tenantId, (tx) => tx.posTahsilat.findUnique({ where: { id: tahsilatId }, include: { posHesap: { include: { baglanti: true } } } }));
    if (!kayit || !kayit.saglayiciToken || kayit.saglayiciToken !== token) throw new BadRequestException("Geçersiz ödeme callback tokenı");
    if (kayit.durum === "odendi") return { basarili: true, tekrar: true, makbuzAnahtari: kayit.makbuzAnahtari };
    const sonuc = await new IyzicoAdapter().odemeSonucu(this.config(kayit.posHesap.baglanti!.sifreliConfig), token);
    if (!sonuc.basarili || !new Prisma.Decimal(sonuc.tutar).equals(kayit.tutar) || sonuc.dovizCinsi !== kayit.dovizCinsi) { await this.prisma.tenantIslem(tenantId, (tx) => tx.posTahsilat.update({ where: { id: kayit.id }, data: { durum: "basarisiz", hataMesaji: "Sağlayıcı ödeme doğrulaması başarısız" } })); throw new BadRequestException("Ödeme doğrulanamadı"); }
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const simdi = new Date(); const hak = await tx.posTahsilat.updateMany({ where: { id: kayit.id, durum: "baslatildi", hareketId: null }, data: { durum: "odendi", saglayiciOdemeId: sonuc.odemeId, odemeTarihi: simdi, hataMesaji: null } }); if (hak.count !== 1) return { basarili: true, tekrar: true, makbuzAnahtari: kayit.makbuzAnahtari };
      const kur = kayit.dovizCinsi === "TRY" ? new Prisma.Decimal(1) : (await tx.dovizKuru.findFirst({ where: { dovizCinsi: kayit.dovizCinsi, tarih: { lte: simdi } }, orderBy: { tarih: "desc" } }))?.dovizSatis; if (!kur) throw new BadRequestException(`${kayit.dovizCinsi} için güncel kur bulunamadı`); const tutarTry = kayit.tutar.mul(kur).toDecimalPlaces(2);
      const hareket = await tx.kasaBankaHareket.create({ data: { tenantId, posHesapId: kayit.posHesapId, tip: "tahsilat", tutar: kayit.tutar, dovizCinsi: kayit.dovizCinsi, kur, tutarTry, tarih: simdi, cariId: kayit.cariId, faturaId: kayit.faturaId, aciklama: "iyzico kart tahsilatı", kaynakTur: "pos_tahsilat", kaynakRef: kayit.id } });
      await tx.cariHareket.create({ data: { tenantId, cariId: kayit.cariId, tip: "alacak", tutar: kayit.tutar, dovizCinsi: kayit.dovizCinsi, kur, tutarTry, tarih: simdi, aciklama: "iyzico kart tahsilatı", kaynakTur: "pos_tahsilat", kaynakRef: kayit.id } });
      await tx.posTahsilat.update({ where: { id: kayit.id }, data: { hareketId: hareket.id } }); return { basarili: true, tekrar: false, makbuzAnahtari: kayit.makbuzAnahtari };
    });
  }
}
