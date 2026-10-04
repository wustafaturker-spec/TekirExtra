import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { aktifBaglam } from "../core/istek-baglami";
import { PdfService } from "../core/pdf/pdf.service";
import { PrismaService } from "../core/prisma.service";
import { EpostaService } from "../tenant/eposta.service";
import { bordroPusulaHtml, donemAdi, type PusulaVerisi } from "./bordro-pusula";
import { tcknMaskele } from "./personel-hassas";

const GONDERILEBILIR: ("onaylandi" | "kismen_odendi" | "odendi")[] = ["onaylandi", "kismen_odendi", "odendi"];

/** PRS-10 (P1-9): ücret hesap pusulası PDF'i ve personele e-postası. */
@Injectable()
export class BordroPusulaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pdf: PdfService,
    private readonly eposta: EpostaService,
  ) {}

  private async veri(bordroId: string) {
    const { tenantId } = aktifBaglam();
    const [b, firma] = await this.prisma.tenantIslem(tenantId, (tx) => Promise.all([
      tx.personelBordro.findFirst({
        where: { id: bordroId, tenantId },
        include: {
          kalemler: { orderBy: [{ tip: "asc" }, { createdAt: "asc" }] },
          personel: { select: { personelNo: true, ad: true, soyad: true, tckn: true, eposta: true, girisTarihi: true, unvan: true, departman: true } },
        },
      }),
      tx.tenant.findUnique({ where: { id: tenantId }, select: { unvan: true, vkn: true, vergiDairesi: true, adres: true, ilce: true, il: true, postaKodu: true, telefon: true, eposta: true, webSitesi: true, mersisNo: true, ticaretSicilNo: true } }),
    ]));
    if (!b) throw new NotFoundException("Bordro bulunamadı");
    if (!firma) throw new NotFoundException("Firma bulunamadı");
    const veri: PusulaVerisi = {
      donemYil: b.donemYil, donemAy: b.donemAy, durum: b.durum, primGunu: b.primGunu, eksikGunNedeni: b.eksikGunNedeni,
      netMaas: b.netMaas.toFixed(2), odenecekTutar: b.odenecekTutar.toFixed(2), odenenTutar: b.odenenTutar.toFixed(2),
      hesapOzeti: b.hesapOzeti && typeof b.hesapOzeti === "object" && !Array.isArray(b.hesapOzeti) ? (b.hesapOzeti as Record<string, unknown>) : null,
      kalemler: b.kalemler.map((k) => ({ tip: k.tip, aciklama: k.aciklama, tutar: k.tutar.toFixed(2) })),
      personel: { personelNo: b.personel.personelNo, ad: b.personel.ad, soyad: b.personel.soyad, tcknMaskeli: tcknMaskele(b.personel.tckn), girisTarihi: b.personel.girisTarihi, unvan: b.personel.unvan, departman: b.personel.departman },
    };
    return { veri, firma, eposta: b.personel.eposta, durum: b.durum };
  }

  async pdfUret(bordroId: string) {
    const { veri, firma } = await this.veri(bordroId);
    const buffer = await this.pdf.htmlToPdf(bordroPusulaHtml(veri, firma, await this.pdf.belgeTemasi()));
    return { buffer, dosyaAdi: `pusula-${veri.personel.personelNo}-${veri.donemYil}-${String(veri.donemAy).padStart(2, "0")}.pdf`, veri, firma };
  }

  /** Tek bordronun pusulası personelin e-postasına (yalnız onaylı bordro). */
  async epostala(bordroId: string, alici?: string | null) {
    const { tenantId, userId } = aktifBaglam();
    const { eposta, durum } = await this.veri(bordroId);
    if (!(GONDERILEBILIR as string[]).includes(durum)) throw new BadRequestException("Yalnız onaylanmış bordronun pusulası gönderilir");
    const hedef = alici?.trim() || eposta;
    if (!hedef) throw new BadRequestException("Personel kartında e-posta yok");
    const { buffer, dosyaAdi, veri, firma } = await this.pdfUret(bordroId);
    const donem = donemAdi(veri.donemYil, veri.donemAy);
    await this.eposta.ekliIletiGonder({
      alici: hedef,
      konu: `${donem} ücret hesap pusulası`,
      metin: `Sayın ${veri.personel.ad} ${veri.personel.soyad},\n\n${donem} dönemine ait ücret hesap pusulanız ektedir.\n\nSaygılarımızla\n${firma.unvan}`,
      ekler: [{ dosyaAdi, icerik: buffer, mime: "application/pdf" }],
    });
    await this.prisma.tenantIslem(tenantId, (tx) => tx.auditLog.create({ data: { tenantId, userId, islem: "personel_pusula_eposta", varlik: "personel_bordro", varlikId: bordroId, detay: { alici: hedef, donem } } }));
    return { mesaj: `Pusula ${hedef} adresine gönderildi` };
  }

  /** Dönemin onaylı bordrolarının pusulaları; e-postası olmayan atlanır, hata ötekileri durdurmaz. */
  async topluEpostala(yil: number, ay: number) {
    const { tenantId } = aktifBaglam();
    const bordrolar = await this.prisma.tenantIslem(tenantId, (tx) => tx.personelBordro.findMany({
      where: { tenantId, donemYil: yil, donemAy: ay, durum: { in: GONDERILEBILIR } },
      select: { id: true, personel: { select: { personelNo: true, ad: true, soyad: true, eposta: true } } },
      orderBy: { personel: { ad: "asc" } },
    }));
    if (!bordrolar.length) throw new BadRequestException("Bu dönemde onaylanmış bordro yok");
    const atlananlar: { personel: string; mesaj: string }[] = [];
    let gonderilen = 0;
    for (const b of bordrolar) {
      const ad = `${b.personel.personelNo} ${b.personel.ad} ${b.personel.soyad}`;
      if (!b.personel.eposta) { atlananlar.push({ personel: ad, mesaj: "Personel kartında e-posta yok" }); continue; }
      try { await this.epostala(b.id); gonderilen += 1; }
      catch (hata) { atlananlar.push({ personel: ad, mesaj: hata instanceof Error ? hata.message : "Gönderilemedi" }); }
    }
    return { gonderilen, atlananlar };
  }
}
