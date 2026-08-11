import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { aktifBaglam } from "../core/istek-baglami";
import { PrismaService } from "../core/prisma.service";
import { coz } from "../core/kripto";
import { IyzicoAdapter, type IyzicoConfig } from "./iyzico.adapter";

@Injectable()
export class PosService {
  constructor(private readonly prisma: PrismaService) {}
  private config(sifreli: string): IyzicoConfig { const c = JSON.parse(coz(sifreli)) as any; return { apiKey: c.kullaniciAdi, secretKey: c.parola, baseUrl: c.servisAdresi ?? "https://sandbox-api.iyzipay.com" }; }

  async listele() { const { tenantId } = aktifBaglam(); return this.prisma.tenantIslem(tenantId, (tx) => tx.posTahsilat.findMany({ orderBy: { createdAt: "desc" }, include: { posHesap: { select: { ad: true, saglayici: true } }, cari: { select: { kod: true, unvan: true } }, fatura: { select: { no: true } } } })); }

  async baslat(girdi: { posHesapId: string; cariId: string; faturaId?: string; tutar: string }) {
    const { tenantId } = aktifBaglam(); const tutar = new Prisma.Decimal(girdi.tutar);
    const kaynak = await this.prisma.tenantIslem(tenantId, (tx) => tx.posHesap.findUnique({ where: { id: girdi.posHesapId }, include: { baglanti: true } }));
    if (!kaynak || !kaynak.aktif || kaynak.saglayici !== "iyzico" || !kaynak.baglanti || kaynak.baglanti.durum !== "aktif") throw new BadRequestException("Aktif iyzico bağlantılı POS hesabı bulunamadı");
    const cari = await this.prisma.tenantIslem(tenantId, (tx) => tx.cariHesap.findUnique({ where: { id: girdi.cariId }, include: { adresler: { take: 1 } } }));
    if (!cari?.eposta || !cari.adresler[0]) throw new BadRequestException("Ödeme için carinin e-posta ve adres bilgileri zorunludur");
    if (girdi.faturaId) { const f = await this.prisma.tenantIslem(tenantId, (tx) => tx.fatura.findFirst({ where: { id: girdi.faturaId, cariId: cari.id } })); if (!f) throw new NotFoundException("Cariye ait fatura bulunamadı"); }
    const kayit = await this.prisma.tenantIslem(tenantId, (tx) => tx.posTahsilat.create({ data: { tenantId, posHesapId: kaynak.id, cariId: cari.id, faturaId: girdi.faturaId, tutar, dovizCinsi: kaynak.dovizCinsi } }));
    const callbackKoku = process.env.PUBLIC_API_URL ?? "http://localhost:3001"; const adres = cari.adresler[0]; const adParcalari = cari.unvan.trim().split(/\s+/); const soyad = adParcalari.length > 1 ? adParcalari.pop()! : "Müşteri"; const ad = adParcalari.join(" ") || cari.unvan;
    try {
      const sonuc = await new IyzicoAdapter().odemeBaslat(this.config(kaynak.baglanti.sifreliConfig), { locale: "tr", conversationId: kayit.id, price: Number(tutar), paidPrice: Number(tutar), currency: kaynak.dovizCinsi, basketId: girdi.faturaId ?? kayit.id, paymentGroup: "PRODUCT", callbackUrl: `${callbackKoku}/api/v1/pos/iyzico/callback/${tenantId}/${kayit.id}`, buyer: { id: cari.id, name: ad, surname: soyad, identityNumber: cari.vknTckn ?? "11111111111", email: cari.eposta, gsmNumber: cari.telefon ?? undefined, registrationAddress: adres.adres, city: adres.il ?? "İstanbul", country: adres.ulke ?? "Türkiye", zipCode: adres.postaKodu ?? undefined }, billingAddress: { contactName: cari.unvan, address: adres.adres, city: adres.il ?? "İstanbul", country: adres.ulke ?? "Türkiye", zipCode: adres.postaKodu ?? undefined }, basketItems: [{ id: girdi.faturaId ?? kayit.id, name: girdi.faturaId ? "Fatura tahsilatı" : "Cari hesap tahsilatı", category1: "Tahsilat", itemType: "VIRTUAL", price: Number(tutar) }] });
      return this.prisma.tenantIslem(tenantId, (tx) => tx.posTahsilat.update({ where: { id: kayit.id }, data: { saglayiciToken: sonuc.token, odemeSayfasiUrl: sonuc.odemeSayfasiUrl } }));
    } catch (hata) { await this.prisma.tenantIslem(tenantId, (tx) => tx.posTahsilat.update({ where: { id: kayit.id }, data: { durum: "basarisiz", hataMesaji: hata instanceof Error ? hata.message : "Ödeme başlatılamadı" } })); throw hata; }
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
