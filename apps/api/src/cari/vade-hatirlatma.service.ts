import { BadRequestException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { aktifBaglam } from "../core/istek-baglami";
import { PrismaService } from "../core/prisma.service";
import { baglanmamisOdemeler } from "../kasa-banka/baglanmamis-odeme";
import { EpostaService } from "../tenant/eposta.service";
import { vadeSmsSablonu } from "../ileti/sms-kurallari";
import { SmsService } from "../ileti/sms.service";
import { CariService } from "./cari.service";
import { guncelKurlar, guncelTlDegeri } from "./doviz-degerleme";
import { Prisma } from "@prisma/client";
import { kiraciSaglayicisi } from "../ai/saglayici/kiraci-saglayici";
import { itirazliCariler, tahsilatIletisiminiDogrula, ITIRAZ_ILETISIM_ENGELI } from "./tahsilat-iletisim";
import {
  hatirlatmaIletisi, hatirlatmaSablonlari, KADEME_ADI, siklikEngeli, sonHatirlatmalar, vadesiGecmisKalemler,
  type Kademe,
} from "./vade-hatirlatma";

/** Hatırlatmaya eklenen ekstrenin geriye dönük süresi (gün). */
const EKSTRE_GUN = 90;

export interface HatirlatmaSonucu {
  cariId: string;
  kod: string;
  unvan: string;
  durum: "gonderildi" | "atlandi" | "hata";
  mesaj: string;
}

/** CARI-38: vade hatırlatma / ihtar adayları, önizleme ve toplu gönderim. */
@Injectable()
export class VadeHatirlatmaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eposta: EpostaService,
    private readonly cari: CariService,
    @Optional() private readonly sms?: SmsService,
  ) {}

  /** Vadesi geçmiş alacağı olan cariler; tutar güncel kurla TL'ye çevrilerek sıralanır. */
  async adaylar() {
    const { tenantId } = aktifBaglam();
    const bugun = new Date();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const cariler = await tx.cariHesap.findMany({
        where: { hareketler: { some: { tip: "borc", OR: [{ vadeTarihi: { lt: bugun } }, { vadeTarihi: null, tarih: { lt: bugun } }] } } },
        select: { id: true, kod: true, unvan: true, eposta: true, telefon: true, smsHatirlatma: true, karaListe: true, aktif: true },
      });
      const ids = cariler.map((c) => c.id);
      const itirazlar = await itirazliCariler(tx, tenantId, ids);
      const [kalemler, sonlar, baglanmamis] = await Promise.all([vadesiGecmisKalemler(tx, ids, bugun), sonHatirlatmalar(tx, ids), baglanmamisOdemeler(tx, ids, "tahsilat")]);
      const kurlar = await guncelKurlar(tx, tenantId, [...kalemler.values()].flat().map((k) => k.dovizCinsi), bugun);
      return cariler
        .map((c) => {
          const liste = kalemler.get(c.id) ?? [];
          const dovizler = new Map<string, number>();
          for (const k of liste) dovizler.set(k.dovizCinsi, (dovizler.get(k.dovizCinsi) ?? 0) + k.acik);
          const toplamTry = [...dovizler].reduce((t, [d, tutar]) => t + guncelTlDegeri(d, new Prisma.Decimal(tutar.toFixed(2)), new Prisma.Decimal(0), kurlar).guncelTry.toNumber(), 0);
          const son = sonlar.get(c.id);
          return {
            cariId: c.id, kod: c.kod, unvan: c.unvan, eposta: c.eposta, smsUygun: c.smsHatirlatma && Boolean(c.telefon), karaListe: c.karaListe, aktif: c.aktif,
            faturaSayisi: liste.length,
            dovizler: [...dovizler].map(([dovizCinsi, tutar]) => ({ dovizCinsi, tutar: tutar.toFixed(2) })),
            toplamTry: toplamTry.toFixed(2),
            enEskiVade: liste[0]?.vade.toISOString().slice(0, 10) ?? null,
            enUzunGecikme: liste.reduce((m, k) => Math.max(m, k.gecikmeGun), 0),
            sonHatirlatma: son?.toISOString() ?? null,
            siklikEngeli: siklikEngeli(son),
            itirazEngeli: itirazlar.has(c.id),
            /** KSB-23: faturaya bağlanmamış tahsilat; vadesi geçmiş görünen fatura bununla ödenmiş olabilir. */
            baglanmamisTahsilatTry: baglanmamis.get(c.id)?.toFixed(2) ?? null,
            gonderimEngeli: itirazlar.has(c.id) ? ITIRAZ_ILETISIM_ENGELI : null,
          };
        })
        .filter((a) => a.faturaSayisi > 0)
        .sort((a, b) => Number(b.toplamTry) - Number(a.toplamTry));
    });
  }

  private async ileti(cariId: string, kademe: Kademe, not?: string | null) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      await tahsilatIletisiminiDogrula(tx, tenantId, cariId);
      const [cari, firma, sablonlar, kalemler] = await Promise.all([
        tx.cariHesap.findUnique({ where: { id: cariId }, select: { id: true, kod: true, unvan: true, eposta: true, telefon: true, smsHatirlatma: true } }),
        tx.tenant.findUnique({ where: { id: tenantId }, select: { unvan: true } }),
        hatirlatmaSablonlari(tx, tenantId),
        vadesiGecmisKalemler(tx, [cariId]),
      ]);
      if (!cari) throw new NotFoundException("Cari bulunamadı");
      const liste = kalemler.get(cariId) ?? [];
      return { cari, firma: firma?.unvan ?? "", kalemler: liste, ileti: hatirlatmaIletisi(sablonlar[kademe], { unvan: cari.unvan, firma: firma?.unvan ?? "", kalemler: liste, not }) };
    });
  }

  async onizle(cariId: string, kademe: Kademe, not?: string | null) {
    const { cari, kalemler, ileti } = await this.ileti(cariId, kademe, not);
    if (kalemler.length === 0) throw new BadRequestException(`${cari.unvan} için vadesi geçmiş alacak yok`);
    return { alici: cari.eposta, konu: ileti.konu, metin: ileti.metin, html: ileti.html };
  }

  /**
   * Seçili carilere sırayla gönderir; birinin hatası ötekileri durdurmaz.
   * E-postası olmayan, vadesi geçmiş alacağı kalmayan ve son 7 günde
   * hatırlatma almış cari atlanır (`siklikSiniriniAs` ile bilerek geçilir).
   */
  async gonder(girdi: { cariIdler: string[]; kademe: Kademe; not?: string | null; siklikSiniriniAs?: boolean; baglanmamisOnayi?: boolean; smsDeGonder?: boolean }): Promise<HatirlatmaSonucu[]> {
    const { tenantId, userId } = aktifBaglam();
    const [sonlar, baglanmamis] = await this.prisma.tenantIslem(tenantId, (tx) => Promise.all([sonHatirlatmalar(tx, girdi.cariIdler), baglanmamisOdemeler(tx, girdi.cariIdler, "tahsilat")]));
    const sonuclar: HatirlatmaSonucu[] = [];
    for (const cariId of girdi.cariIdler) {
      let kimlik = { kod: "", unvan: cariId };
      try {
        const { cari, firma, kalemler, ileti } = await this.ileti(cariId, girdi.kademe, girdi.not);
        kimlik = { kod: cari.kod, unvan: cari.unvan };
        const atla = (mesaj: string) => sonuclar.push({ cariId, ...kimlik, durum: "atlandi", mesaj });
        // ILT-13: SMS yalnız kartında izni açık cariye gider.
        const smsTelefonu = girdi.smsDeGonder && cari.smsHatirlatma ? cari.telefon : null;
        if (!cari.eposta && !smsTelefonu) { atla(girdi.smsDeGonder ? "Cari kartında e-posta yok, SMS izni de açık değil" : "Cari kartında e-posta yok"); continue; }
        if (kalemler.length === 0) { atla("Vadesi geçmiş alacak kalmamış"); continue; }
        const son = sonlar.get(cariId);
        if (!girdi.siklikSiniriniAs && siklikEngeli(son)) { atla(`Son hatırlatma ${son!.toLocaleDateString("tr-TR")} tarihinde gitti (7 gün dolmadı)`); continue; }
        const bagsiz = baglanmamis.get(cariId);
        if (bagsiz && !girdi.baglanmamisOnayi) { atla(`Faturaya bağlanmamış ${bagsiz.toFixed(2)} TL tahsilat var; ödenmiş faturaya hatırlatma gitmesin diye önce bağlayın ya da onaylayarak gönderin`); continue; }

        const mesajlar: string[] = [];
        if (cari.eposta) {
          const bitis = new Date().toISOString().slice(0, 10);
          const baslangic = new Date(Date.now() - EKSTRE_GUN * 86_400_000).toISOString().slice(0, 10);
          const ekstre = await this.cari.ekstrePdf(cariId, baslangic, bitis);
          // Önizlemeden/PDF üretiminden sonra açılan itirazı da gönderimden önce denetle.
          await this.prisma.tenantIslem(tenantId, (tx) => tahsilatIletisiminiDogrula(tx, tenantId, cariId));
          await this.eposta.ekliIletiGonder({
            alici: cari.eposta, konu: ileti.konu, metin: ileti.metin, html: ileti.html,
            ekler: [{ dosyaAdi: `ekstre-${cari.kod}.pdf`, icerik: ekstre, mime: "application/pdf" }],
          });
          await this.prisma.tenantIslem(tenantId, (tx) => tx.crmEtkilesim.create({
            data: {
              tenantId, cariId, userId, tip: "eposta", tarih: new Date(),
              konu: `${KADEME_ADI[girdi.kademe]}: ${ileti.toplam}`.slice(0, 255),
              aciklama: `${cari.eposta} adresine gönderildi; ${kalemler.length} kalem, en eski vade ${kalemler[0].vade.toISOString().slice(0, 10)}. Ek: son ${EKSTRE_GUN} günlük ekstre.${girdi.not?.trim() ? ` Not: ${girdi.not.trim()}` : ""}`.slice(0, 2000),
            },
          }));
          mesajlar.push(`${cari.eposta} adresine gönderildi (${ileti.toplam})`);
        }
        if (smsTelefonu) {
          // E-posta çıktıysa SMS hatası gönderimi "hata" yapmaz, sonuca yazılır.
          try {
            await this.prisma.tenantIslem(tenantId, (tx) => tahsilatIletisiminiDogrula(tx, tenantId, cariId));
            await this.sms!.gonder({ tur: "vade_hatirlatma", telefon: smsTelefonu, cariId, sablon: vadeSmsSablonu({ firma, unvan: cari.unvan, toplam: ileti.toplam, ihtar: girdi.kademe === "ihtar" }) });
            if (!cari.eposta) {
              await this.prisma.tenantIslem(tenantId, (tx) => tx.crmEtkilesim.create({ data: { tenantId, cariId, userId, tip: "telefon", tarih: new Date(), konu: `${KADEME_ADI[girdi.kademe]}: ${ileti.toplam}`.slice(0, 255), aciklama: `SMS gönderildi; ${kalemler.length} kalem.` } }));
            }
            mesajlar.push("SMS gönderildi");
          } catch (hata) {
            if (!cari.eposta) throw hata;
            mesajlar.push(`SMS gönderilemedi: ${hata instanceof Error ? hata.message : "bilinmeyen hata"}`);
          }
        }
        sonuclar.push({ cariId, ...kimlik, durum: "gonderildi", mesaj: mesajlar.join("; ") });
      } catch (hata) {
        sonuclar.push({ cariId, ...kimlik, durum: "hata", mesaj: hata instanceof Error ? hata.message : "Gönderilemedi" });
      }
    }
    return sonuclar;
  }

  /**
   * AI-20: hatırlatmanın "ek not"u için dil modeline kibar bir taslak yazdırır.
   * Tek cari seçiliyse onun geciken kalemleriyle kişiselleşir; birden çoksa
   * kademe tonunda genel not yazılır. E-posta şablonu fatura tablosunu zaten
   * içerdiği için not rakam tekrar etmez. Gönderim kullanıcının düzenleyip
   * onaylamasıyla mevcut akıştan yapılır.
   */
  async yapayZekaNotu(girdi: { cariIdler: string[]; kademe: Kademe }): Promise<{ not: string }> {
    const { tenantId } = aktifBaglam();
    const tek = girdi.cariIdler.length === 1 ? girdi.cariIdler[0] : null;
    const baglam = tek ? await this.ileti(tek, girdi.kademe) : null;
    const firma = await this.prisma.tenantIslem(tenantId, (tx) => tx.tenant.findUnique({ where: { id: tenantId }, select: { unvan: true } }));
    const { saglayici } = await kiraciSaglayicisi(this.prisma, tenantId, { ozellik: "hatirlatma" });
    const ton = girdi.kademe === "ihtar" ? "kararlı ve resmî ama saygılı (ödeme ihtarı)" : "kibar ve yardımsever (hatırlatma)";
    const ayrinti = baglam
      ? `Alıcı: ${baglam.cari.unvan}. Geciken kalem sayısı: ${baglam.kalemler.length}; en uzun gecikme ${baglam.kalemler.reduce((m, k) => Math.max(m, k.gecikmeGun), 0)} gün.`
      : "Not birden çok cariye gidecek; alıcıya özel bilgi kullanma.";
    const metin = await saglayici.metinUret({
      sistemRol:
        "Bir Türk şirketinin muhasebe biriminden müşteriye giden vade hatırlatma e-postasına eklenecek kısa notu yazarsın. " +
        "E-postada fatura tablosu zaten var: tutar, tarih ya da fatura numarası yazma, yeni bilgi uydurma. Selamlama ve imza yazma. " +
        "En çok 3 cümle, düz metin, Türkçe.",
      prompt: `Gönderen firma: ${firma?.unvan ?? ""}. Ton: ${ton}. ${ayrinti} Ödeme yapıldıysa dikkate alınmamasını rica eden ve iletişim için davet eden bir not yaz.`,
      dusunmeKapali: true,
    });
    const not = metin.replace(/\*\*|__|`/g, "").replace(/\s+/g, " ").trim().slice(0, 1000);
    if (!not) throw new BadRequestException("Not üretilemedi; lütfen tekrar deneyin.");
    return { not };
  }
}
