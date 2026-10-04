import { BadRequestException, ConflictException, Injectable } from "@nestjs/common";
import * as ExcelJS from "exceljs";
import { muhtelifMusteriMi } from "@tekirextra/shared";
import { aktifBaglam } from "../core/istek-baglami";
import { PrismaService } from "../core/prisma.service";
import { CariService } from "./cari.service";
import {
  ACIK_BAKIYE_ISARETI, acikBakiyeVar, ekstreDonemi,
  type TopluAtlanan, type TopluSonuc,
} from "./cari-toplu";

interface SeciliCari {
  id: string;
  kod: string;
  unvan: string;
  vknTckn: string | null;
  eposta: string | null;
  karaListe: boolean;
  aktif: boolean;
}

const PARA = "#,##0.00;[Red]-#,##0.00";
const TIP_ADI: Record<string, string> = { musteri: "Müşteri", tedarikci: "Tedarikçi", her_ikisi: "Müşteri + tedarikçi" };

/**
 * CARI-40 (P2-2): listede seçilen carilere toplu etiket, pasif/aktif, kara
 * liste, temsilci, ekstre e-postası ve Excel. Veri değiştiren her toplu işlem
 * tek bir denetim kaydı bırakır; bulunamayan ya da kurala takılan cari
 * işlemi durdurmaz, nedeniyle "atlananlar"da döner.
 */
@Injectable()
export class CariTopluService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cari: CariService,
  ) {}

  /** Seçilenleri okur; bulunamayanları (silinmiş, başka kiracı) atlananlara ekler. */
  private async seciliCariler(cariIdler: string[]) {
    const { tenantId } = aktifBaglam();
    const tekil = [...new Set(cariIdler)];
    const kayitlar = await this.prisma.tenantIslem(tenantId, (tx) => tx.cariHesap.findMany({
      where: { id: { in: tekil } },
      select: { id: true, kod: true, unvan: true, vknTckn: true, eposta: true, karaListe: true, aktif: true },
      orderBy: [{ kod: "asc" }, { id: "asc" }],
    }));
    const bulunan = new Set(kayitlar.map((k) => k.id));
    const atlananlar: TopluAtlanan[] = tekil.filter((id) => !bulunan.has(id)).map((id) => ({ cariId: id, kod: "", unvan: id, mesaj: "Cari bulunamadı" }));
    return { cariler: kayitlar as SeciliCari[], atlananlar };
  }

  private atla(c: SeciliCari, mesaj: string): TopluAtlanan {
    return { cariId: c.id, kod: c.kod, unvan: c.unvan, mesaj };
  }

  private async denetimKaydi(islem: string, cariIdler: string[], detay: Record<string, unknown>) {
    const { tenantId, userId } = aktifBaglam();
    await this.prisma.tenantIslem(tenantId, (tx) => tx.auditLog.create({
      data: { tenantId, userId, islem: `cari_toplu_${islem}`, varlik: "cari", varlikId: null, detay: { adet: cariIdler.length, cariIdler, ...detay } },
    }));
  }

  async etiket(girdi: { cariIdler: string[]; etiketId: string; islem: "ekle" | "kaldir" }): Promise<TopluSonuc> {
    const { tenantId } = aktifBaglam();
    const { cariler, atlananlar } = await this.seciliCariler(girdi.cariIdler);
    const etiket = await this.prisma.tenantIslem(tenantId, (tx) => tx.cariEtiket.findUnique({ where: { id: girdi.etiketId }, select: { id: true, ad: true } }));
    if (!etiket) throw new BadRequestException("Etiket bulunamadı");
    const ids = cariler.map((c) => c.id);
    await this.prisma.tenantIslem(tenantId, (tx) => girdi.islem === "ekle"
      ? tx.cariEtiketAtama.createMany({ data: ids.map((cariId) => ({ tenantId, cariId, etiketId: etiket.id })), skipDuplicates: true })
      : tx.cariEtiketAtama.deleteMany({ where: { cariId: { in: ids }, etiketId: etiket.id } }));
    await this.denetimKaydi(`etiket_${girdi.islem}`, ids, { etiket: etiket.ad });
    return { islenen: ids.length, atlananlar };
  }

  /**
   * Pasife alınan cari yeni belgede kullanılamaz (CARI-32), mevcut belgeler
   * etkilenmez. Açık bakiyeli cari varsa önce onay istenir. Muhtelif
   * Müşteriler sistem carisi pasife alınmaz.
   */
  async durum(girdi: { cariIdler: string[]; aktif: boolean; acikBakiyeOnayi?: boolean }): Promise<TopluSonuc> {
    const { tenantId } = aktifBaglam();
    const { cariler, atlananlar } = await this.seciliCariler(girdi.cariIdler);
    const uygun = cariler.filter((c) => {
      if (!girdi.aktif && muhtelifMusteriMi(c)) { atlananlar.push(this.atla(c, "Muhtelif Müşteriler sistem carisi pasife alınamaz")); return false; }
      return true;
    });
    let acikBakiyeli: SeciliCari[] = [];
    if (!girdi.aktif) {
      const bakiyeler = await this.cari.bakiyeleriGetir(uygun.filter((c) => c.aktif).map((c) => c.id));
      acikBakiyeli = uygun.filter((c) => acikBakiyeVar(bakiyeler.get(c.id)));
      if (acikBakiyeli.length && !girdi.acikBakiyeOnayi) {
        const ornek = acikBakiyeli.slice(0, 5).map((c) => c.kod).join(", ");
        throw new ConflictException(`${acikBakiyeli.length} caride açık bakiye var (${ornek}${acikBakiyeli.length > 5 ? "…" : ""}); ${ACIK_BAKIYE_ISARETI}`);
      }
    }
    const ids = uygun.map((c) => c.id);
    await this.prisma.tenantIslem(tenantId, (tx) => tx.cariHesap.updateMany({ where: { id: { in: ids } }, data: { aktif: girdi.aktif } }));
    await this.denetimKaydi(girdi.aktif ? "aktif" : "pasif", ids, acikBakiyeli.length ? { acikBakiyeli: acikBakiyeli.map((c) => c.id) } : {});
    return { islenen: ids.length, atlananlar };
  }

  /** Kara liste her belgeyi durdurur (CARI-32); kaldırınca kart notu da silinir. */
  async karaListe(girdi: { cariIdler: string[]; karaListe: boolean; not?: string | null }): Promise<TopluSonuc> {
    const { tenantId } = aktifBaglam();
    const { cariler, atlananlar } = await this.seciliCariler(girdi.cariIdler);
    const uygun = cariler.filter((c) => {
      if (girdi.karaListe && muhtelifMusteriMi(c)) { atlananlar.push(this.atla(c, "Muhtelif Müşteriler sistem carisi kara listeye alınamaz")); return false; }
      return true;
    });
    const ids = uygun.map((c) => c.id);
    const not = girdi.not?.trim() || undefined;
    await this.prisma.tenantIslem(tenantId, (tx) => tx.cariHesap.updateMany({
      where: { id: { in: ids } },
      data: girdi.karaListe ? { karaListe: true, ...(not ? { karaListeNotu: not } : {}) } : { karaListe: false, karaListeNotu: null },
    }));
    await this.denetimKaydi(girdi.karaListe ? "kara_liste_ekle" : "kara_liste_kaldir", ids, not ? { not } : {});
    return { islenen: ids.length, atlananlar };
  }

  async temsilciler() {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, (tx) => tx.user.findMany({ where: { aktif: true }, orderBy: { adSoyad: "asc" }, select: { id: true, adSoyad: true } }));
  }

  async temsilci(girdi: { cariIdler: string[]; temsilciUserId: string | null }): Promise<TopluSonuc> {
    const { tenantId } = aktifBaglam();
    const { cariler, atlananlar } = await this.seciliCariler(girdi.cariIdler);
    let temsilciAdi: string | null = null;
    if (girdi.temsilciUserId) {
      const kullanici = await this.prisma.tenantIslem(tenantId, (tx) => tx.user.findFirst({ where: { id: girdi.temsilciUserId!, aktif: true }, select: { adSoyad: true } }));
      if (!kullanici) throw new BadRequestException("Temsilci bulunamadı ya da pasif");
      temsilciAdi = kullanici.adSoyad;
    }
    const ids = cariler.map((c) => c.id);
    await this.prisma.tenantIslem(tenantId, (tx) => tx.cariHesap.updateMany({ where: { id: { in: ids } }, data: { temsilciUserId: girdi.temsilciUserId } }));
    await this.denetimKaydi("temsilci", ids, { temsilciUserId: girdi.temsilciUserId, temsilci: temsilciAdi });
    return { islenen: ids.length, atlananlar };
  }

  /**
   * Her cariye kendi ekstresi (PDF + Excel) kart e-postasına gider; sırayla
   * gönderilir, birinin hatası ötekileri durdurmaz. E-postası olmayan ve kara
   * listedeki cari atlanır. Her gönderim CRM etkileşimine yazılır.
   */
  async ekstreEposta(girdi: { cariIdler: string[]; baslangic?: string; bitis?: string; tur?: "standart" | "ayrintili"; mutabakat?: boolean }): Promise<TopluSonuc> {
    const { tenantId, userId } = aktifBaglam();
    const { cariler, atlananlar } = await this.seciliCariler(girdi.cariIdler);
    const donem = ekstreDonemi(girdi.baslangic, girdi.bitis);
    const gonderilen: string[] = [];
    for (const c of cariler) {
      if (!c.eposta) { atlananlar.push(this.atla(c, "Cari kartında e-posta yok")); continue; }
      if (c.karaListe) { atlananlar.push(this.atla(c, "Kara listede")); continue; }
      try {
        await this.cari.ekstreEpostaGonder(c.id, girdi.baslangic, girdi.bitis, undefined, false, { tur: girdi.tur, mutabakat: girdi.mutabakat });
        gonderilen.push(c.id);
        await this.prisma.tenantIslem(tenantId, (tx) => tx.crmEtkilesim.create({
          data: {
            tenantId, cariId: c.id, userId, tip: "eposta", tarih: new Date(),
            konu: `${girdi.mutabakat ? "Ekstre + mutabakat" : "Cari ekstresi"}: ${donem}`.slice(0, 255),
            aciklama: `${c.eposta} adresine toplu gönderimle iletildi (${girdi.tur === "ayrintili" ? "ayrıntılı" : "standart"} ekstre, PDF + Excel).`,
          },
        }));
      } catch (hata) {
        atlananlar.push(this.atla(c, hata instanceof Error ? hata.message : "Gönderilemedi"));
      }
    }
    await this.denetimKaydi("ekstre_eposta", gonderilen, { donem, tur: girdi.tur ?? "standart", mutabakat: girdi.mutabakat ?? false, atlanan: atlananlar.length });
    return { islenen: gonderilen.length, atlananlar };
  }

  /** Seçili carilerin listesi; bakiye güncel kurla TL (liste ve kartla aynı), dövizler ayrıca. */
  async excel(cariIdler: string[]): Promise<Buffer> {
    const { tenantId } = aktifBaglam();
    const tekil = [...new Set(cariIdler)];
    const cariler = await this.prisma.tenantIslem(tenantId, (tx) => tx.cariHesap.findMany({
      where: { id: { in: tekil } },
      orderBy: [{ kod: "asc" }, { id: "asc" }],
      select: {
        id: true, kod: true, unvan: true, tip: true, kisiTipi: true, vknTckn: true, vergiDairesi: true, eposta: true, telefon: true,
        sektor: true, riskLimiti: true, varsayilanVadeGun: true, aktif: true, karaListe: true, karaListeNotu: true,
        temsilci: { select: { adSoyad: true } },
        etiketler: { select: { etiket: { select: { ad: true } } } },
      },
    }));
    const bakiyeler = await this.cari.bakiyeleriGetir(cariler.map((c) => c.id));

    const kitap = new ExcelJS.Workbook();
    const sayfa = kitap.addWorksheet("Cariler");
    const kolonlar: { baslik: string; genislik: number; bicim?: string }[] = [
      { baslik: "Kod", genislik: 14 }, { baslik: "Unvan", genislik: 40 }, { baslik: "Tür", genislik: 18 }, { baslik: "Kişi tipi", genislik: 10 },
      { baslik: "VKN / TCKN", genislik: 14 }, { baslik: "Vergi dairesi", genislik: 18 }, { baslik: "E-posta", genislik: 28 }, { baslik: "Telefon", genislik: 16 },
      { baslik: "Sektör", genislik: 16 }, { baslik: "Temsilci", genislik: 20 }, { baslik: "Etiketler", genislik: 24 },
      { baslik: "Durum", genislik: 8 }, { baslik: "Kara liste", genislik: 10 }, { baslik: "Kara liste notu", genislik: 28 },
      { baslik: "Vade (gün)", genislik: 10 }, { baslik: "Risk limiti (TL)", genislik: 15, bicim: PARA },
      { baslik: "Bakiye (TL, güncel kur)", genislik: 18, bicim: PARA }, { baslik: "Döviz bakiyeleri", genislik: 30 },
    ];
    sayfa.columns = kolonlar.map((k) => ({ width: k.genislik, style: k.bicim ? { numFmt: k.bicim } : {} }));
    const baslik = sayfa.getRow(1);
    baslik.values = kolonlar.map((k) => k.baslik);
    baslik.font = { bold: true, color: { argb: "FFFFFFFF" } };
    baslik.eachCell((h) => { h.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF374151" } }; });
    sayfa.views = [{ state: "frozen", ySplit: 1 }];
    sayfa.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: kolonlar.length } };

    let toplam = 0;
    for (const c of cariler) {
      const liste = bakiyeler.get(c.id) ?? [];
      const tl = liste.reduce((t, b) => t + Number(b.bakiyeGuncelTry), 0);
      toplam += tl;
      const dovizli = liste.filter((b) => b.dovizCinsi !== "TRY" && Number(b.bakiye) !== 0)
        .map((b) => `${Number(b.bakiye).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${b.dovizCinsi}`).join("; ");
      sayfa.addRow([
        c.kod, c.unvan, TIP_ADI[c.tip] ?? c.tip, c.kisiTipi === "gercek" ? "Gerçek" : "Tüzel", c.vknTckn, c.vergiDairesi, c.eposta, c.telefon,
        c.sektor, c.temsilci?.adSoyad ?? null, c.etiketler.map((e) => e.etiket.ad).join(", ") || null,
        c.aktif ? "Aktif" : "Pasif", c.karaListe ? "Evet" : "", c.karaListeNotu, c.varsayilanVadeGun,
        c.riskLimiti === null ? null : Number(c.riskLimiti), Math.round(tl * 100) / 100, dovizli || null,
      ]);
    }
    const toplamSatiri = sayfa.addRow([`${cariler.length} cari`, ...Array(15).fill(null), Math.round(toplam * 100) / 100, null]);
    toplamSatiri.font = { bold: true };
    toplamSatiri.eachCell((h) => { h.border = { top: { style: "medium" } }; });
    return Buffer.from(await kitap.xlsx.writeBuffer());
  }
}
