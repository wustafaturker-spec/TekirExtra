import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import * as ExcelJS from "exceljs";
import { bugunTR } from "@tekirextra/shared";
import { aktifBaglam } from "../core/istek-baglami";
import { PrismaService } from "../core/prisma.service";
import { DepoService } from "../ekler/depo.service";
import { EpostaService } from "../tenant/eposta.service";
import { CariService } from "./cari.service";
import { guncelKurlar, guncelTlDegeri } from "./doviz-degerleme";
import type { TopluAtlanan, TopluSonuc } from "./cari-toplu";
import {
  anahtarUret, bakiyeCumlesi, bakiyeFarklari, DURUM_ADLARI, gorunenDurum, gunEkle, hatirlatmaZamani, portalAdresi, trTarih,
  VARSAYILAN_YANIT_GUNU, type DovizBakiyesi, type MutabakatGorunenDurum,
} from "./cari-mutabakat";

const BEKLEYEN = ["gonderildi", "goruldu"];
const PARA = "#,##0.00;[Red]-#,##0.00";
const kacis = (m: string) => m.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export interface MutabakatFiltresi {
  cariId?: string;
  durum?: MutabakatGorunenDurum;
  /** Mutabakat tarihinin ayı, YYYY-AA. */
  ay?: string;
}

type Kayit = Prisma.CariMutabakatGetPayload<{ include: { cari: { select: { id: true; kod: true; unvan: true } } } }>;

/**
 * CARI-42 (P3-1): mutabakat talebinin bizim taraftaki yaşam döngüsü. Talep
 * anında bakiye ve ekstre PDF'i dondurulur; aynı carinin bekleyen talebi yeni
 * talep açılınca iptal olur. Karşı tarafın yanıtı mutabakat-portal.service.ts'te.
 */
@Injectable()
export class CariMutabakatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cari: CariService,
    private readonly depo: DepoService,
    private readonly eposta: EpostaService,
  ) {}

  async olustur(cariId: string, girdi: { mutabakatTarihi: string; baslangicTarihi?: string | null; sonYanitTarihi?: string | null; alici?: string | null; tur?: "standart" | "ayrintili" }) {
    const { tenantId, userId } = aktifBaglam();
    const bugun = bugunTR();
    if (girdi.mutabakatTarihi > bugun) throw new BadRequestException("Mutabakat tarihi bugünden sonra olamaz");
    const sonYanit = girdi.sonYanitTarihi || gunEkle(bugun, VARSAYILAN_YANIT_GUNU);
    if (sonYanit < bugun) throw new BadRequestException("Son yanıt tarihi geçmiş olamaz");
    const [cari, firma] = await this.prisma.tenantIslem(tenantId, (tx) => Promise.all([
      tx.cariHesap.findUnique({ where: { id: cariId }, select: { id: true, kod: true, unvan: true, eposta: true } }),
      tx.tenant.findUnique({ where: { id: tenantId }, select: { unvan: true } }),
    ]));
    if (!cari) throw new NotFoundException("Cari bulunamadı");
    const alici = girdi.alici?.trim() || cari.eposta;
    if (!alici) throw new BadRequestException("Cari kartında e-posta yok; alıcı adresini yazın");

    // Bakiye ve ekstre mutabakat tarihine göre dondurulur.
    const ekstre = await this.cari.ekstre(cariId, girdi.baslangicTarihi ?? undefined, girdi.mutabakatTarihi, false, { tur: girdi.tur });
    const bakiyeler: DovizBakiyesi[] = ekstre.dovizOzet.map((o) => ({ dovizCinsi: o.dovizCinsi, bakiye: o.bakiye }));
    const kurlar = await this.prisma.tenantIslem(tenantId, (tx) => guncelKurlar(tx, tenantId, bakiyeler.map((b) => b.dovizCinsi)));
    const bakiyeTry = bakiyeler.reduce((t, b) => t.add(guncelTlDegeri(b.dovizCinsi, new Prisma.Decimal(b.bakiye), new Prisma.Decimal(0), kurlar).guncelTry), new Prisma.Decimal(0));
    const pdf = await this.cari.ekstrePdf(cariId, girdi.baslangicTarihi ?? undefined, girdi.mutabakatTarihi, false, { tur: girdi.tur });
    const id = randomUUID();
    const ekstreAnahtari = `${tenantId}/mutabakat/${id}/ekstre.pdf`;
    await this.depo.yukle(ekstreAnahtari, pdf, "application/pdf");
    const { anahtar, ozet } = anahtarUret();

    await this.prisma.tenantIslem(tenantId, async (tx) => {
      const eskiler = await tx.cariMutabakat.updateMany({ where: { cariId, durum: { in: BEKLEYEN } }, data: { durum: "iptal", iptalAt: new Date() } });
      await tx.cariMutabakat.create({
        data: {
          id, tenantId, cariId, mutabakatTarihi: new Date(girdi.mutabakatTarihi), baslangicTarihi: girdi.baslangicTarihi ? new Date(girdi.baslangicTarihi) : null,
          sonYanitTarihi: new Date(sonYanit), bakiyeler: bakiyeler as unknown as Prisma.InputJsonValue, bakiyeTry, alici, anahtarOzeti: ozet, ekstreAnahtari, olusturanUserId: userId,
        },
      });
      await tx.auditLog.create({ data: { tenantId, userId, islem: "cari_mutabakat_gonder", varlik: "cari", varlikId: cariId, detay: { mutabakatId: id, mutabakatTarihi: girdi.mutabakatTarihi, alici, bakiyeler, iptalEdilenOnceki: eskiler.count } as unknown as Prisma.InputJsonValue } });
    });

    try {
      await this.ileti({ alici, firma: firma?.unvan ?? "", cariUnvan: cari.unvan, cariKod: cari.kod, mutabakatTarihi: girdi.mutabakatTarihi, sonYanit, bakiyeler, adres: portalAdresi(tenantId, anahtar), pdf });
    } catch (hata) {
      // Gitmeyen talep bekleyen kalmasın; kullanıcı yeniden dener.
      await this.prisma.tenantIslem(tenantId, (tx) => tx.cariMutabakat.update({ where: { id }, data: { durum: "iptal", iptalAt: new Date() } }));
      throw new BadRequestException(`E-posta gönderilemedi: ${hata instanceof Error ? hata.message : String(hata)}`);
    }
    await this.prisma.tenantIslem(tenantId, (tx) => tx.crmEtkilesim.create({
      data: { tenantId, cariId, userId, tip: "eposta", tarih: new Date(), konu: `Mutabakat talebi: ${trTarih(girdi.mutabakatTarihi)}`, aciklama: `${alici} adresine gönderildi; ${bakiyeCumlesi(bakiyeler)}. Son yanıt ${trTarih(sonYanit)}.` },
    }));
    return { id, alici, mesaj: `Mutabakat talebi ${alici} adresine gönderildi` };
  }

  private async ileti(g: { alici: string; firma: string; cariUnvan: string; cariKod: string; mutabakatTarihi: string; sonYanit: string; bakiyeler: DovizBakiyesi[]; adres: string; pdf: Buffer; hatirlatma?: boolean }) {
    const cumle = bakiyeCumlesi(g.bakiyeler);
    const giris = g.hatirlatma
      ? `${trTarih(g.mutabakatTarihi)} tarihli cari hesap mutabakatımıza henüz yanıt alamadık; son yanıt tarihi ${trTarih(g.sonYanit)}.`
      : `${g.firma} kayıtlarına göre ${trTarih(g.mutabakatTarihi)} tarihi itibarıyla ${cumle}. Hesap ekstreniz ektedir.`;
    const metin = `Sayın Yetkili,\n\n${giris}\n\nAşağıdaki bağlantıdan ${trTarih(g.sonYanit)} tarihine kadar bakiyeye mutabık olup olmadığınızı bildirmenizi rica ederiz; mutabık değilseniz kendi kayıtlarınızdaki bakiyeyi ve hesap dökümünüzü ekleyebilirsiniz:\n${g.adres}\n\nBağlantı size özeldir, lütfen paylaşmayınız.\n\nSaygılarımızla\n${g.firma}`;
    const html = `<p>Sayın Yetkili,</p><p>${kacis(giris)}</p><p>${kacis(trTarih(g.sonYanit))} tarihine kadar bakiyeye mutabık olup olmadığınızı bildirmenizi rica ederiz; mutabık değilseniz kendi kayıtlarınızdaki bakiyeyi ve hesap dökümünüzü ekleyebilirsiniz.</p>`
      + `<p><a href="${kacis(g.adres)}" style="display:inline-block;background:#ea7a2c;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:600">Mutabakatı yanıtla</a></p>`
      + `<p style="color:#6b7280;font-size:12px">Bağlantı size özeldir, lütfen paylaşmayınız. Düğme çalışmazsa: ${kacis(g.adres)}</p><p>Saygılarımızla<br>${kacis(g.firma)}</p>`;
    await this.eposta.ekliIletiGonder({
      alici: g.alici,
      konu: `${g.hatirlatma ? "Hatırlatma: " : ""}${g.firma} — ${trTarih(g.mutabakatTarihi)} tarihli cari hesap mutabakatı`,
      metin, html,
      ekler: [{ dosyaAdi: `ekstre-${g.cariKod}-${g.mutabakatTarihi}.pdf`, icerik: g.pdf, mime: "application/pdf" }],
    });
  }

  /** Listede seçilenlere; e-postası olmayan atlanır, birinin hatası ötekini durdurmaz. */
  async toplu(girdi: { cariIdler: string[]; mutabakatTarihi: string; sonYanitTarihi?: string | null; tur?: "standart" | "ayrintili" }): Promise<TopluSonuc> {
    const { tenantId } = aktifBaglam();
    const cariler = await this.prisma.tenantIslem(tenantId, (tx) => tx.cariHesap.findMany({ where: { id: { in: [...new Set(girdi.cariIdler)] } }, select: { id: true, kod: true, unvan: true, eposta: true }, orderBy: { kod: "asc" } }));
    const bulunan = new Set(cariler.map((c) => c.id));
    const atlananlar: TopluAtlanan[] = girdi.cariIdler.filter((id) => !bulunan.has(id)).map((id) => ({ cariId: id, kod: "", unvan: id, mesaj: "Cari bulunamadı" }));
    let islenen = 0;
    for (const c of cariler) {
      if (!c.eposta) { atlananlar.push({ cariId: c.id, kod: c.kod, unvan: c.unvan, mesaj: "Cari kartında e-posta yok" }); continue; }
      try {
        await this.olustur(c.id, { mutabakatTarihi: girdi.mutabakatTarihi, sonYanitTarihi: girdi.sonYanitTarihi, tur: girdi.tur });
        islenen += 1;
      } catch (hata) {
        atlananlar.push({ cariId: c.id, kod: c.kod, unvan: c.unvan, mesaj: hata instanceof Error ? hata.message : "Gönderilemedi" });
      }
    }
    return { islenen, atlananlar };
  }

  private gorunum(k: Kayit, bugun: string) {
    const bakiyeler = k.bakiyeler as unknown as DovizBakiyesi[];
    const karsi = (k.karsiBakiyeler as unknown as DovizBakiyesi[] | null) ?? null;
    const durum = gorunenDurum(k, bugun);
    return {
      id: k.id, cari: k.cari,
      mutabakatTarihi: k.mutabakatTarihi.toISOString().slice(0, 10),
      baslangicTarihi: k.baslangicTarihi?.toISOString().slice(0, 10) ?? null,
      sonYanitTarihi: k.sonYanitTarihi.toISOString().slice(0, 10),
      bakiyeler, bakiyeTry: k.bakiyeTry.toFixed(2), alici: k.alici,
      durum, durumAdi: DURUM_ADLARI[durum],
      gonderimAt: k.createdAt.toISOString(), gorulduAt: k.gorulduAt?.toISOString() ?? null, yanitAt: k.yanitAt?.toISOString() ?? null,
      hatirlatmaAt: k.hatirlatmaAt?.toISOString() ?? null,
      yanitlayan: k.yanitlayanAd ? { ad: k.yanitlayanAd, gorev: k.yanitlayanGorev, eposta: k.yanitlayanEposta } : null,
      yanitAciklama: k.yanitAciklama, karsiBakiyeler: karsi,
      farklar: karsi ? bakiyeFarklari(bakiyeler, karsi) : [],
      ek: k.ekAnahtari ? { dosyaAdi: k.ekDosyaAdi } : null,
      itirazKapandiAt: k.itirazKapandiAt?.toISOString() ?? null, itirazKapatmaNotu: k.itirazKapatmaNotu,
      yanitIp: k.yanitIp,
    };
  }

  async listele(f: MutabakatFiltresi) {
    const { tenantId } = aktifBaglam();
    const bugun = bugunTR();
    const where: Prisma.CariMutabakatWhereInput = {
      ...(f.cariId ? { cariId: f.cariId } : {}),
      ...(f.ay ? { mutabakatTarihi: { gte: new Date(`${f.ay}-01`), lt: new Date(gunEkle(`${f.ay}-01`, 31).slice(0, 7) + "-01") } } : {}),
      ...(f.durum === "suresi_doldu" ? { durum: { in: BEKLEYEN }, sonYanitTarihi: { lt: new Date(bugun) } }
        : f.durum === "gonderildi" || f.durum === "goruldu" ? { durum: f.durum, sonYanitTarihi: { gte: new Date(bugun) } }
        : f.durum ? { durum: f.durum } : {}),
    };
    const kayitlar = await this.prisma.tenantIslem(tenantId, (tx) => tx.cariMutabakat.findMany({ where, include: { cari: { select: { id: true, kod: true, unvan: true } } }, orderBy: { createdAt: "desc" }, take: 1000 }));
    const satirlar = kayitlar.map((k) => this.gorunum(k, bugun));
    const ozet: Record<string, number> = {};
    for (const s of satirlar) ozet[s.durum] = (ozet[s.durum] ?? 0) + 1;
    return { kayitlar: satirlar, ozet };
  }

  private async bul(id: string) {
    const { tenantId } = aktifBaglam();
    const k = await this.prisma.tenantIslem(tenantId, (tx) => tx.cariMutabakat.findUnique({ where: { id }, include: { cari: { select: { id: true, kod: true, unvan: true } } } }));
    if (!k) throw new NotFoundException("Mutabakat talebi bulunamadı");
    return k;
  }

  async iptal(id: string) {
    const { tenantId, userId } = aktifBaglam();
    const k = await this.bul(id);
    if (!BEKLEYEN.includes(k.durum)) throw new ConflictException("Yalnız yanıt bekleyen talep iptal edilir");
    await this.prisma.tenantIslem(tenantId, async (tx) => {
      await tx.cariMutabakat.update({ where: { id }, data: { durum: "iptal", iptalAt: new Date() } });
      await tx.auditLog.create({ data: { tenantId, userId, islem: "cari_mutabakat_iptal", varlik: "cari", varlikId: k.cariId, detay: { mutabakatId: id } } });
    });
    return { mesaj: "Talep iptal edildi; bağlantı artık açılmaz" };
  }

  /** Yeni bağlantıyla yeniden gönderir; eski bağlantılar geçersizleşir (yanlış alıcıya gittiyse de kullanılır). */
  async yenidenGonder(id: string, alici?: string | null) {
    const { tenantId, userId } = aktifBaglam();
    const k = await this.bul(id);
    if (!BEKLEYEN.includes(k.durum) || gorunenDurum(k, bugunTR()) === "suresi_doldu") throw new ConflictException("Yalnız süresi dolmamış, yanıt bekleyen talep yeniden gönderilir; yeni talep açın");
    const hedef = alici?.trim() || k.alici;
    const [firma, pdf] = await Promise.all([
      this.prisma.tenantIslem(tenantId, (tx) => tx.tenant.findUnique({ where: { id: tenantId }, select: { unvan: true } })),
      this.depo.indir(k.ekstreAnahtari),
    ]);
    const { anahtar, ozet } = anahtarUret();
    const mutabakatTarihi = k.mutabakatTarihi.toISOString().slice(0, 10);
    await this.ileti({ alici: hedef, firma: firma?.unvan ?? "", cariUnvan: k.cari.unvan, cariKod: k.cari.kod, mutabakatTarihi, sonYanit: k.sonYanitTarihi.toISOString().slice(0, 10), bakiyeler: k.bakiyeler as unknown as DovizBakiyesi[], adres: portalAdresi(tenantId, anahtar), pdf });
    await this.prisma.tenantIslem(tenantId, async (tx) => {
      await tx.cariMutabakat.update({ where: { id }, data: { anahtarOzeti: ozet, hatirlatmaAnahtarOzeti: null, alici: hedef } });
      await tx.auditLog.create({ data: { tenantId, userId, islem: "cari_mutabakat_yeniden_gonder", varlik: "cari", varlikId: k.cariId, detay: { mutabakatId: id, onceki: k.alici, alici: hedef } } });
    });
    return { mesaj: `Yeni bağlantı ${hedef} adresine gönderildi; önceki bağlantılar geçersiz` };
  }

  async itirazKapat(id: string, not: string) {
    const { tenantId, userId } = aktifBaglam();
    const k = await this.bul(id);
    if (k.durum !== "itiraz" || k.itirazKapandiAt) throw new ConflictException("Yalnız açık itiraz kapatılır");
    await this.prisma.tenantIslem(tenantId, async (tx) => {
      await tx.cariMutabakat.update({ where: { id }, data: { itirazKapandiAt: new Date(), itirazKapatmaNotu: not, itirazKapatanUserId: userId } });
      await tx.auditLog.create({ data: { tenantId, userId, islem: "cari_mutabakat_itiraz_kapat", varlik: "cari", varlikId: k.cariId, detay: { mutabakatId: id, not } } });
    });
    return { mesaj: "İtiraz kapatıldı" };
  }

  async ekstreIndir(id: string) {
    const k = await this.bul(id);
    return { dosyaAdi: `ekstre-${k.cari.kod}-${k.mutabakatTarihi.toISOString().slice(0, 10)}.pdf`, mime: "application/pdf", icerik: await this.depo.indir(k.ekstreAnahtari) };
  }

  async ekIndir(id: string) {
    const k = await this.bul(id);
    if (!k.ekAnahtari) throw new NotFoundException("Bu yanıtta ek yok");
    return { dosyaAdi: k.ekDosyaAdi ?? "ek", mime: k.ekMime ?? "application/octet-stream", icerik: await this.depo.indir(k.ekAnahtari) };
  }

  async excel(f: MutabakatFiltresi): Promise<Buffer> {
    const { kayitlar } = await this.listele(f);
    const kitap = new ExcelJS.Workbook();
    const sayfa = kitap.addWorksheet("Mutabakatlar");
    const kolonlar = [
      { baslik: "Cari kodu", genislik: 14 }, { baslik: "Unvan", genislik: 36 }, { baslik: "Mutabakat tarihi", genislik: 14, bicim: "dd.mm.yyyy" },
      { baslik: "Bakiyemiz", genislik: 26 }, { baslik: "Bakiye (TL, güncel kur)", genislik: 18, bicim: PARA }, { baslik: "Durum", genislik: 13 },
      { baslik: "Alıcı", genislik: 26 }, { baslik: "Gönderim", genislik: 17, bicim: "dd.mm.yyyy hh:mm" }, { baslik: "Son yanıt", genislik: 12, bicim: "dd.mm.yyyy" },
      { baslik: "Yanıt", genislik: 17, bicim: "dd.mm.yyyy hh:mm" }, { baslik: "Yanıtlayan", genislik: 28 }, { baslik: "Karşı taraf bakiyesi", genislik: 26 },
      { baslik: "Fark", genislik: 22 }, { baslik: "Açıklama", genislik: 40 }, { baslik: "İtiraz kapatma notu", genislik: 30 },
    ];
    sayfa.columns = kolonlar.map((k) => ({ width: k.genislik, style: k.bicim ? { numFmt: k.bicim } : {} }));
    const baslik = sayfa.getRow(1);
    baslik.values = kolonlar.map((k) => k.baslik);
    baslik.font = { bold: true, color: { argb: "FFFFFFFF" } };
    baslik.eachCell((h) => { h.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF374151" } }; });
    sayfa.views = [{ state: "frozen", ySplit: 1 }];
    sayfa.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: kolonlar.length } };
    const liste = (b: DovizBakiyesi[] | null) => (b ?? []).map((x) => `${Number(x.bakiye).toLocaleString("tr-TR", { minimumFractionDigits: 2 })} ${x.dovizCinsi}`).join("; ") || null;
    for (const k of kayitlar) {
      sayfa.addRow([
        k.cari.kod, k.cari.unvan, new Date(`${k.mutabakatTarihi}T00:00:00Z`), liste(k.bakiyeler), Number(k.bakiyeTry), k.durumAdi, k.alici,
        new Date(k.gonderimAt), new Date(`${k.sonYanitTarihi}T00:00:00Z`), k.yanitAt ? new Date(k.yanitAt) : null,
        k.yanitlayan ? `${k.yanitlayan.ad} (${k.yanitlayan.gorev})` : null, liste(k.karsiBakiyeler), liste(k.farklar), k.yanitAciklama, k.itirazKapatmaNotu,
      ]);
    }
    return Buffer.from(await kitap.xlsx.writeBuffer());
  }

  /**
   * Worker: son tarihe 3 gün kalan yanıtsız talebe bir kez hatırlatma. Mevcut
   * bağlantı yalnız özetiyle saklandığı için ikinci bir bağlantı üretilir;
   * ikisi de geçerlidir.
   */
  async hatirlatmalariGonder(): Promise<number> {
    const { tenantId } = aktifBaglam();
    const bugun = bugunTR();
    const adaylar = await this.prisma.tenantIslem(tenantId, (tx) => tx.cariMutabakat.findMany({
      where: { durum: { in: BEKLEYEN }, hatirlatmaAt: null, sonYanitTarihi: { gte: new Date(bugun), lte: new Date(gunEkle(bugun, 3)) } },
      include: { cari: { select: { id: true, kod: true, unvan: true } } },
      take: 200,
    }));
    if (!adaylar.length) return 0;
    const firma = await this.prisma.tenantIslem(tenantId, (tx) => tx.tenant.findUnique({ where: { id: tenantId }, select: { unvan: true } }));
    let gonderilen = 0;
    for (const k of adaylar) {
      const sonYanit = k.sonYanitTarihi.toISOString().slice(0, 10);
      if (!hatirlatmaZamani({ durum: k.durum, sonYanitTarihi: sonYanit, hatirlatmaAt: k.hatirlatmaAt }, bugun)) continue;
      // Önce işaretle: e-posta yavaşken ikinci tur aynı talebi tekrar göndermesin.
      const { anahtar, ozet } = anahtarUret();
      const isaret = await this.prisma.tenantIslem(tenantId, (tx) => tx.cariMutabakat.updateMany({ where: { id: k.id, hatirlatmaAt: null, durum: { in: BEKLEYEN } }, data: { hatirlatmaAt: new Date(), hatirlatmaAnahtarOzeti: ozet } }));
      if (isaret.count !== 1) continue;
      try {
        await this.ileti({
          alici: k.alici, firma: firma?.unvan ?? "", cariUnvan: k.cari.unvan, cariKod: k.cari.kod, mutabakatTarihi: k.mutabakatTarihi.toISOString().slice(0, 10), sonYanit,
          bakiyeler: k.bakiyeler as unknown as DovizBakiyesi[], adres: portalAdresi(tenantId, anahtar), pdf: await this.depo.indir(k.ekstreAnahtari), hatirlatma: true,
        });
        gonderilen += 1;
      } catch {
        // Gitmediyse bir sonraki turda yeniden denensin.
        await this.prisma.tenantIslem(tenantId, (tx) => tx.cariMutabakat.update({ where: { id: k.id }, data: { hatirlatmaAt: null, hatirlatmaAnahtarOzeti: null } }));
      }
    }
    return gonderilen;
  }
}
