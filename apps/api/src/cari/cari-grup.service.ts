import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import * as ExcelJS from "exceljs";
import { aktifBaglam } from "../core/istek-baglami";
import { PrismaService } from "../core/prisma.service";
import { CariService } from "./cari.service";
import { cariRiskleri, cariYaslandirmalari, grupRiskleri, riskOzetiGorunumu, toplamLimit, vadesiGecmis } from "./cari-risk";
import type { CariGrupGirdisi } from "./cari-grup";

const PARA = "#,##0.00;[Red]-#,##0.00";
const D = (deger: Prisma.Decimal.Value) => new Prisma.Decimal(deger);

/**
 * CARI-41 (P3-2, karar 2026-10-04): tek seviyeli cari grubu. Grup riski
 * üyelerin riskleri toplamı, limit = grup risk limiti + üyelerin geçerli
 * teminatları (cari-risk.ts grupRiskleri; belge denetimi de onu kullanır).
 * Grup silinince üyeler gruptan çıkar, cariler kalır.
 */
@Injectable()
export class CariGrupService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cari: CariService,
  ) {}

  async listele() {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const gruplar = await tx.cariGrup.findMany({ orderBy: { ad: "asc" } });
      const riskler = await grupRiskleri(tx, tenantId, gruplar.map((g) => g.id));
      const uyeler = await tx.cariHesap.findMany({ where: { grupId: { in: gruplar.map((g) => g.id) } }, select: { id: true, grupId: true } });
      const yaslandirma = await cariYaslandirmalari(tx, tenantId, uyeler.map((u) => u.id));
      const gecikmis = new Map<string, number>();
      for (const u of uyeler) gecikmis.set(u.grupId!, (gecikmis.get(u.grupId!) ?? 0) + vadesiGecmis(yaslandirma.get(u.id)!));
      return gruplar.map((g) => {
        const r = riskler.get(g.id)!;
        return {
          id: g.id, ad: g.ad, notlar: g.notlar, riskLimiti: g.riskLimiti?.toFixed(2) ?? null,
          uyeSayisi: r.uyeSayisi,
          bakiyeTry: r.bakiyeTry.toFixed(2),
          vadesiGecmis: (gecikmis.get(g.id) ?? 0).toFixed(2),
          risk: riskOzetiGorunumu(r, g.riskLimiti),
        };
      });
    });
  }

  /** Grup ve üyeleri: üye başına bakiye (döviz kırılımı), risk, teminat, vadesi geçmiş. */
  async getir(id: string) {
    const { tenantId } = aktifBaglam();
    const grup = await this.prisma.tenantIslem(tenantId, (tx) => tx.cariGrup.findUnique({ where: { id } }));
    if (!grup) throw new NotFoundException("Cari grubu bulunamadı");
    const { uyeler, riskler, yaslandirma, grupRiski } = await this.prisma.tenantIslem(tenantId, async (tx) => {
      const uyeler = await tx.cariHesap.findMany({
        where: { grupId: id }, orderBy: [{ kod: "asc" }, { id: "asc" }],
        select: { id: true, kod: true, unvan: true, tip: true, aktif: true, karaListe: true, riskLimiti: true },
      });
      const ids = uyeler.map((u) => u.id);
      const [riskler, yaslandirma, grupRiski] = await Promise.all([
        cariRiskleri(tx, tenantId, ids),
        cariYaslandirmalari(tx, tenantId, ids),
        grupRiskleri(tx, tenantId, [id]),
      ]);
      return { uyeler, riskler, yaslandirma, grupRiski: grupRiski.get(id)! };
    });
    const bakiyeler = await this.cari.bakiyeleriGetir(uyeler.map((u) => u.id));
    return {
      id: grup.id, ad: grup.ad, notlar: grup.notlar, riskLimiti: grup.riskLimiti?.toFixed(2) ?? null,
      uyeSayisi: grupRiski.uyeSayisi,
      bakiyeTry: grupRiski.bakiyeTry.toFixed(2),
      vadesiGecmis: uyeler.reduce((t, u) => t + vadesiGecmis(yaslandirma.get(u.id)!), 0).toFixed(2),
      risk: riskOzetiGorunumu(grupRiski, grup.riskLimiti),
      uyeler: uyeler.map((u) => {
        const r = riskler.get(u.id)!;
        const limit = toplamLimit(r, u.riskLimiti);
        return {
          id: u.id, kod: u.kod, unvan: u.unvan, tip: u.tip, aktif: u.aktif, karaListe: u.karaListe,
          bakiyeler: bakiyeler.get(u.id) ?? [],
          bakiyeTry: r.bakiyeTry.toFixed(2),
          cekSenetRiski: r.cekSenetRiski.toFixed(2),
          mevcutRisk: r.mevcutRisk.toFixed(2),
          teminat: r.teminatTry.toFixed(2),
          riskLimiti: u.riskLimiti?.toFixed(2) ?? null,
          limitAsimi: limit !== null && r.mevcutRisk.greaterThan(limit),
          vadesiGecmis: vadesiGecmis(yaslandirma.get(u.id)!).toFixed(2),
          /** Grup riskindeki payı (%), grup riski 0 ise null. */
          pay: grupRiski.mevcutRisk.isZero() ? null : r.mevcutRisk.div(grupRiski.mevcutRisk).mul(100).toFixed(1),
        };
      }),
    };
  }

  private veri(girdi: CariGrupGirdisi) {
    return {
      ad: girdi.ad.trim(),
      riskLimiti: girdi.riskLimiti === undefined ? undefined : girdi.riskLimiti === null || girdi.riskLimiti === "" ? null : D(girdi.riskLimiti),
      notlar: girdi.notlar === undefined ? undefined : girdi.notlar?.trim() || null,
    };
  }

  private adCakismasi(hata: unknown, ad: string): never {
    if (hata instanceof Prisma.PrismaClientKnownRequestError && hata.code === "P2002") throw new ConflictException(`'${ad}' adlı grup zaten var`);
    throw hata;
  }

  async olustur(girdi: CariGrupGirdisi) {
    const { tenantId, userId } = aktifBaglam();
    try {
      return await this.prisma.tenantIslem(tenantId, async (tx) => {
        const grup = await tx.cariGrup.create({ data: { tenantId, ...this.veri(girdi) } });
        await tx.auditLog.create({ data: { tenantId, userId, islem: "cari_grup_olustur", varlik: "cari_grup", varlikId: grup.id, detay: { ad: grup.ad, riskLimiti: grup.riskLimiti?.toFixed(2) ?? null } } });
        return grup;
      });
    } catch (hata) {
      this.adCakismasi(hata, girdi.ad);
    }
  }

  async guncelle(id: string, girdi: CariGrupGirdisi) {
    const { tenantId, userId } = aktifBaglam();
    const mevcut = await this.prisma.tenantIslem(tenantId, (tx) => tx.cariGrup.findUnique({ where: { id } }));
    if (!mevcut) throw new NotFoundException("Cari grubu bulunamadı");
    try {
      return await this.prisma.tenantIslem(tenantId, async (tx) => {
        const grup = await tx.cariGrup.update({ where: { id }, data: this.veri(girdi) });
        await tx.auditLog.create({
          data: {
            tenantId, userId, islem: "cari_grup_guncelle", varlik: "cari_grup", varlikId: id,
            detay: { onceki: { ad: mevcut.ad, riskLimiti: mevcut.riskLimiti?.toFixed(2) ?? null }, yeni: { ad: grup.ad, riskLimiti: grup.riskLimiti?.toFixed(2) ?? null } },
          },
        });
        return grup;
      });
    } catch (hata) {
      this.adCakismasi(hata, girdi.ad);
    }
  }

  /** Üyeler gruptan çıkar; cariler ve hareketleri olduğu gibi kalır. */
  async sil(id: string) {
    const { tenantId, userId } = aktifBaglam();
    await this.prisma.tenantIslem(tenantId, async (tx) => {
      const grup = await tx.cariGrup.findUnique({ where: { id } });
      if (!grup) throw new NotFoundException("Cari grubu bulunamadı");
      const cikan = await tx.cariHesap.updateMany({ where: { grupId: id }, data: { grupId: null } });
      await tx.cariGrup.delete({ where: { id } });
      await tx.auditLog.create({ data: { tenantId, userId, islem: "cari_grup_sil", varlik: "cari_grup", varlikId: id, detay: { ad: grup.ad, cikanUye: cikan.count } } });
    });
  }

  async excel(id: string): Promise<{ dosyaAdi: string; buffer: Buffer }> {
    const g = await this.getir(id);
    if (!g.uyeler.length) throw new BadRequestException("Grubun üyesi yok");
    const kitap = new ExcelJS.Workbook();
    const sayfa = kitap.addWorksheet(g.ad.replace(/[\\/?*[\]:]/g, " ").slice(0, 31) || "Grup");
    const kolonlar = [
      { baslik: "Kod", genislik: 14 }, { baslik: "Unvan", genislik: 40 }, { baslik: "Durum", genislik: 10 },
      { baslik: "Bakiye (TL, güncel kur)", genislik: 18, bicim: PARA }, { baslik: "Döviz bakiyeleri", genislik: 28 },
      { baslik: "Çek/senet riski", genislik: 15, bicim: PARA }, { baslik: "Mevcut risk", genislik: 15, bicim: PARA },
      { baslik: "Grup riskindeki pay %", genislik: 12, bicim: "0.0" }, { baslik: "Vadesi geçmiş", genislik: 15, bicim: PARA },
      { baslik: "Cari risk limiti", genislik: 15, bicim: PARA }, { baslik: "Teminat", genislik: 14, bicim: PARA },
    ];
    sayfa.columns = kolonlar.map((k) => ({ width: k.genislik, style: k.bicim ? { numFmt: k.bicim } : {} }));
    sayfa.mergeCells("A1:K1");
    sayfa.getCell("A1").value = `CARİ GRUBU: ${g.ad}`;
    sayfa.getCell("A1").font = { size: 14, bold: true };
    sayfa.getCell("A2").value = `${g.uyeSayisi} üye · grup riski ${Number(g.risk.mevcutRisk).toLocaleString("tr-TR", { minimumFractionDigits: 2 })} TL · limit ${g.risk.kullanilabilirLimit ? `${Number(g.risk.kullanilabilirLimit).toLocaleString("tr-TR", { minimumFractionDigits: 2 })} TL` : "tanımsız"} · ${new Date().toLocaleDateString("tr-TR")}`;
    sayfa.getCell("A2").font = { color: { argb: "FF6B7280" } };
    const baslik = sayfa.getRow(4);
    baslik.values = kolonlar.map((k) => k.baslik);
    baslik.font = { bold: true, color: { argb: "FFFFFFFF" } };
    baslik.eachCell((h) => { h.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF374151" } }; });
    sayfa.views = [{ state: "frozen", ySplit: 4 }];
    const sayi = (v: string | null) => (v === null ? null : Number(v));
    for (const u of g.uyeler) {
      const dovizli = u.bakiyeler.filter((b) => b.dovizCinsi !== "TRY" && Number(b.bakiye) !== 0)
        .map((b) => `${Number(b.bakiye).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${b.dovizCinsi}`).join("; ");
      sayfa.addRow([
        u.kod, u.unvan, u.karaListe ? "Bloke" : u.aktif ? "Aktif" : "Pasif", sayi(u.bakiyeTry), dovizli || null,
        sayi(u.cekSenetRiski), sayi(u.mevcutRisk), sayi(u.pay), sayi(u.vadesiGecmis), sayi(u.riskLimiti), sayi(u.teminat),
      ]);
    }
    const toplam = sayfa.addRow([`${g.uyeSayisi} üye`, null, null, sayi(g.bakiyeTry), null, sayi(g.risk.cekSenetRiski), sayi(g.risk.mevcutRisk), null, sayi(g.vadesiGecmis), null, sayi(g.risk.teminat)]);
    toplam.font = { bold: true };
    toplam.eachCell((h) => { h.border = { top: { style: "medium" } }; });
    return { dosyaAdi: `cari-grubu-${new Date().toISOString().slice(0, 10)}.xlsx`, buffer: Buffer.from(await kitap.xlsx.writeBuffer()) };
  }
}
