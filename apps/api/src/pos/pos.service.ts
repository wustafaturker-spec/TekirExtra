import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { aktifBaglam } from "../core/istek-baglami";
import { PrismaService } from "../core/prisma.service";
import { coz } from "../core/kripto";
import { IyzicoAdapter, type IyzicoConfig } from "./iyzico.adapter";
import { EpostaService } from "../tenant/eposta.service";
import { NetgsmAdapter, type NetgsmConfig } from "./netgsm.adapter";
import { PaytrAdapter, type PaytrCallback, type PaytrConfig } from "./paytr.adapter";

@Injectable()
export class PosService {
  constructor(private readonly prisma: PrismaService, private readonly eposta: EpostaService) {}
  private config(sifreli: string): IyzicoConfig { const c = JSON.parse(coz(sifreli)) as any; return { apiKey: c.kullaniciAdi, secretKey: c.parola, baseUrl: c.servisAdresi ?? "https://sandbox-api.iyzipay.com" }; }
  private netgsmConfig(sifreli: string): NetgsmConfig { const c = JSON.parse(coz(sifreli)) as any; return { kullaniciAdi: c.kullaniciAdi, parola: c.parola, gondericiAdi: c.gondericiAdi, servisAdresi: c.servisAdresi }; }
  private paytrConfig(sifreli: string): PaytrConfig { const c = JSON.parse(coz(sifreli)) as any; return { merchantId: c.magazaId, merchantKey: c.kullaniciAdi, merchantSalt: c.parola }; }

  async listele() { const { tenantId } = aktifBaglam(); return this.prisma.tenantIslem(tenantId, (tx) => tx.posTahsilat.findMany({ orderBy: { createdAt: "desc" }, include: { posHesap: { select: { ad: true, saglayici: true } }, cari: { select: { kod: true, unvan: true } }, fatura: { select: { no: true } } } })); }

  async baslat(girdi: { posHesapId: string; cariId: string; faturaId?: string; tutar: string }) {
    const { tenantId } = aktifBaglam(); const tutar = new Prisma.Decimal(girdi.tutar);
    const kaynak = await this.prisma.tenantIslem(tenantId, (tx) => tx.posHesap.findUnique({ where: { id: girdi.posHesapId }, include: { baglanti: true } }));
    if (!kaynak || !kaynak.aktif || !["iyzico", "paytr"].includes(kaynak.saglayici) || !kaynak.baglanti || kaynak.baglanti.durum !== "aktif") throw new BadRequestException("Aktif bağlantılı POS hesabı bulunamadı");
    const cari = await this.prisma.tenantIslem(tenantId, (tx) => tx.cariHesap.findUnique({ where: { id: girdi.cariId }, include: { adresler: { take: 1 } } }));
    if (!cari?.eposta || (kaynak.saglayici === "iyzico" && !cari.adresler[0])) throw new BadRequestException("Ödeme için carinin e-posta ve adres bilgileri zorunludur");
    if (girdi.faturaId) { const f = await this.prisma.tenantIslem(tenantId, (tx) => tx.fatura.findFirst({ where: { id: girdi.faturaId, cariId: cari.id } })); if (!f) throw new NotFoundException("Cariye ait fatura bulunamadı"); }
    const kayit = await this.prisma.tenantIslem(tenantId, (tx) => tx.posTahsilat.create({ data: { tenantId, posHesapId: kaynak.id, cariId: cari.id, faturaId: girdi.faturaId, tutar, dovizCinsi: kaynak.dovizCinsi } }));
    const callbackKoku = process.env.PUBLIC_API_URL ?? "http://localhost:3001"; const adres = cari.adresler[0]; const adParcalari = cari.unvan.trim().split(/\s+/); const soyad = adParcalari.length > 1 ? adParcalari.pop()! : "Müşteri"; const ad = adParcalari.join(" ") || cari.unvan;
    try {
      if (kaynak.saglayici === "paytr") {
        if (!process.env.PUBLIC_API_URL || !callbackKoku.startsWith("https://") || /localhost|127\.0\.0\.1|:\d+(?:\/|$)/i.test(callbackKoku)) throw new BadRequestException("PayTR için portsuz, herkese açık HTTPS PUBLIC_API_URL tanımlanmalıdır");
        const sonuc = await new PaytrAdapter().linkOlustur(this.paytrConfig(kaynak.baglanti.sifreliConfig), { ad: girdi.faturaId ? "Fatura tahsilati" : "Cari hesap tahsilati", tutarKurus: Number(tutar.mul(100).toFixed(0)), dovizCinsi: kaynak.dovizCinsi, eposta: cari.eposta, callbackUrl: `${callbackKoku}/api/v1/pos/paytr/callback/${tenantId}/${kayit.id}`, callbackId: kayit.id.replace(/-/g, "") });
        const tamamlanan = await this.prisma.tenantIslem(tenantId, (tx) => tx.posTahsilat.update({ where: { id: kayit.id }, data: { saglayiciToken: sonuc.id, odemeSayfasiUrl: sonuc.link } }));
        await this.odemeLinkiEpostala(tenantId, tamamlanan.id, cari.eposta, cari.unvan, sonuc.link, girdi.faturaId).catch(() => undefined); if (cari.telefon) await this.odemeLinkiSmsGonder(tenantId, tamamlanan.id, cari.telefon, cari.unvan, sonuc.link, girdi.faturaId).catch(() => undefined);
        return this.prisma.tenantIslem(tenantId, (tx) => tx.posTahsilat.findUniqueOrThrow({ where: { id: tamamlanan.id } }));
      }
      const sonuc = await new IyzicoAdapter().odemeBaslat(this.config(kaynak.baglanti.sifreliConfig), { locale: "tr", conversationId: kayit.id, price: Number(tutar), paidPrice: Number(tutar), currency: kaynak.dovizCinsi, basketId: girdi.faturaId ?? kayit.id, paymentGroup: "PRODUCT", callbackUrl: `${callbackKoku}/api/v1/pos/iyzico/callback/${tenantId}/${kayit.id}`, buyer: { id: cari.id, name: ad, surname: soyad, identityNumber: cari.vknTckn ?? "11111111111", email: cari.eposta, gsmNumber: cari.telefon ?? undefined, registrationAddress: adres.adres, city: adres.il ?? "İstanbul", country: adres.ulke ?? "Türkiye", zipCode: adres.postaKodu ?? undefined }, billingAddress: { contactName: cari.unvan, address: adres.adres, city: adres.il ?? "İstanbul", country: adres.ulke ?? "Türkiye", zipCode: adres.postaKodu ?? undefined }, basketItems: [{ id: girdi.faturaId ?? kayit.id, name: girdi.faturaId ? "Fatura tahsilatı" : "Cari hesap tahsilatı", category1: "Tahsilat", itemType: "VIRTUAL", price: Number(tutar) }] });
      const tamamlanan = await this.prisma.tenantIslem(tenantId, (tx) => tx.posTahsilat.update({ where: { id: kayit.id }, data: { saglayiciToken: sonuc.token, odemeSayfasiUrl: sonuc.odemeSayfasiUrl } }));
      await this.odemeLinkiEpostala(tenantId, tamamlanan.id, cari.eposta, cari.unvan, sonuc.odemeSayfasiUrl, girdi.faturaId).catch(() => undefined);
      if (cari.telefon) await this.odemeLinkiSmsGonder(tenantId, tamamlanan.id, cari.telefon, cari.unvan, sonuc.odemeSayfasiUrl, girdi.faturaId).catch(() => undefined);
      return this.prisma.tenantIslem(tenantId, (tx) => tx.posTahsilat.findUniqueOrThrow({ where: { id: tamamlanan.id } }));
    } catch (hata) { await this.prisma.tenantIslem(tenantId, (tx) => tx.posTahsilat.update({ where: { id: kayit.id }, data: { durum: "basarisiz", hataMesaji: hata instanceof Error ? hata.message : "Ödeme başlatılamadı" } })); throw hata; }
  }

  async paytrCallback(tenantId: string, tahsilatId: string, girdi: PaytrCallback) {
    const kayit = await this.prisma.tenantIslem(tenantId, (tx) => tx.posTahsilat.findUnique({ where: { id: tahsilatId }, include: { posHesap: { include: { baglanti: true } } } }));
    if (!kayit?.posHesap.baglanti || kayit.posHesap.saglayici !== "paytr" || girdi.callback_id !== tahsilatId.replace(/-/g, "") || girdi.status !== "success") throw new BadRequestException("Geçersiz PayTR bildirimi");
    const config = this.paytrConfig(kayit.posHesap.baglanti.sifreliConfig); if (girdi.merchant_id !== config.merchantId || !new PaytrAdapter().callbackDogrula(config, girdi)) throw new BadRequestException("PayTR bildirim imzası geçersiz");
    const doviz = girdi.currency === "TL" ? "TRY" : girdi.currency; if (doviz !== kayit.dovizCinsi || !new Prisma.Decimal(girdi.payment_amount).div(100).equals(kayit.tutar)) throw new BadRequestException("PayTR ödeme tutarı veya dövizi uyuşmuyor");
    await this.odemeyiKaydet(tenantId, kayit, girdi.merchant_oid, "PayTR kart tahsilatı"); return "OK";
  }

  private async odemeyiKaydet(tenantId: string, kayit: any, odemeId: string, aciklama: string) {
    if (kayit.durum === "odendi") return { basarili: true, tekrar: true };
    return this.prisma.tenantIslem(tenantId, async (tx) => { const hak = await tx.posTahsilat.updateMany({ where: { id: kayit.id, durum: "baslatildi", hareketId: null }, data: { durum: "odendi", saglayiciOdemeId: odemeId } }); if (hak.count !== 1) return { basarili: true, tekrar: true }; const hareket = await tx.kasaBankaHareket.create({ data: { tenantId, posHesapId: kayit.posHesapId, tip: "tahsilat", tutar: kayit.tutar, dovizCinsi: kayit.dovizCinsi, kur: 1, tutarTry: kayit.tutar, tarih: new Date(), cariId: kayit.cariId, faturaId: kayit.faturaId, aciklama, kaynakTur: "pos_tahsilat", kaynakRef: kayit.id } }); await tx.cariHareket.create({ data: { tenantId, cariId: kayit.cariId, tip: "alacak", tutar: kayit.tutar, dovizCinsi: kayit.dovizCinsi, kur: 1, tutarTry: kayit.tutar, tarih: new Date(), aciklama, kaynakTur: "pos_tahsilat", kaynakRef: kayit.id } }); await tx.posTahsilat.update({ where: { id: kayit.id }, data: { hareketId: hareket.id } }); return { basarili: true, tekrar: false }; });
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

  async callback(tenantId: string, tahsilatId: string, token: string) {
    const kayit = await this.prisma.tenantIslem(tenantId, (tx) => tx.posTahsilat.findUnique({ where: { id: tahsilatId }, include: { posHesap: { include: { baglanti: true } } } }));
    if (!kayit || !kayit.saglayiciToken || kayit.saglayiciToken !== token) throw new BadRequestException("Geçersiz ödeme callback tokenı");
    if (kayit.durum === "odendi") return { basarili: true, tekrar: true };
    const sonuc = await new IyzicoAdapter().odemeSonucu(this.config(kayit.posHesap.baglanti!.sifreliConfig), token);
    if (!sonuc.basarili || !new Prisma.Decimal(sonuc.tutar).equals(kayit.tutar) || sonuc.dovizCinsi !== kayit.dovizCinsi) { await this.prisma.tenantIslem(tenantId, (tx) => tx.posTahsilat.update({ where: { id: kayit.id }, data: { durum: "basarisiz", hataMesaji: "Sağlayıcı ödeme doğrulaması başarısız" } })); throw new BadRequestException("Ödeme doğrulanamadı"); }
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const hak = await tx.posTahsilat.updateMany({ where: { id: kayit.id, durum: "baslatildi", hareketId: null }, data: { durum: "odendi", saglayiciOdemeId: sonuc.odemeId } }); if (hak.count !== 1) return { basarili: true, tekrar: true };
      const hareket = await tx.kasaBankaHareket.create({ data: { tenantId, posHesapId: kayit.posHesapId, tip: "tahsilat", tutar: kayit.tutar, dovizCinsi: kayit.dovizCinsi, kur: 1, tutarTry: kayit.tutar, tarih: new Date(), cariId: kayit.cariId, faturaId: kayit.faturaId, aciklama: "iyzico kart tahsilatı", kaynakTur: "pos_tahsilat", kaynakRef: kayit.id } });
      await tx.cariHareket.create({ data: { tenantId, cariId: kayit.cariId, tip: "alacak", tutar: kayit.tutar, dovizCinsi: kayit.dovizCinsi, kur: 1, tutarTry: kayit.tutar, tarih: new Date(), aciklama: "iyzico kart tahsilatı", kaynakTur: "pos_tahsilat", kaynakRef: kayit.id } });
      await tx.posTahsilat.update({ where: { id: kayit.id }, data: { hareketId: hareket.id } }); return { basarili: true, tekrar: false };
    });
  }
}
