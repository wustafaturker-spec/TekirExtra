import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { aktifBaglam } from "../istek-baglami";
import { PdfService } from "../pdf/pdf.service";
import { PrismaService } from "../prisma.service";
import { raporExcelYaz } from "./rapor-excel";
import { raporPdfHtml, raporYatayMi } from "./rapor-pdf";
import {
  girdiDogrula,
  raporErisilebilir,
  raporTanimiAl,
  raporTanimlari,
  siralamaUygula,
  type RaporGirdisi,
} from "./rapor-kayit";

@Injectable()
export class RaporlarService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pdf: PdfService,
  ) {}

  /** Rapor kataloğu: arayüz filtre/gruplama/kolon meta verisinden çizilir. */
  listele(modul?: string) {
    const { rol } = aktifBaglam();
    return raporTanimlari(modul).filter((t) => raporErisilebilir(t, rol)).map((t) => ({
      kod: t.kod,
      modul: t.modul,
      ad: t.ad,
      aciklama: t.aciklama ?? null,
      filtreler: t.filtreler,
      gruplamalar: t.gruplamalar ?? [],
      kolonlar: t.kolonlar,
    }));
  }

  async calistir(kod: string, girdi: RaporGirdisi) {
    const tanim = raporTanimiAl(kod);
    if (!tanim) throw new NotFoundException(`'${kod}' raporu bulunamadı`);
    // RPR-11: Excel ve PDF de buradan geçer.
    if (!raporErisilebilir(tanim, aktifBaglam().rol)) throw new ForbiddenException("Bu raporu görme yetkiniz yok");

    const hatalar = girdiDogrula(tanim, girdi);
    if (hatalar.length > 0) throw new BadRequestException(hatalar.join("; "));

    const { tenantId } = aktifBaglam();
    const satirlar = await this.prisma.tenantIslem(tenantId, (tx) =>
      tanim.calistir(girdi, { tenantId, tx }),
    );
    return {
      kod: tanim.kod,
      ad: tanim.ad,
      kolonlar: tanim.kolonlar,
      satirlar: siralamaUygula(tanim, satirlar, girdi.siralama),
    };
  }

  async excel(kod: string, girdi: RaporGirdisi): Promise<Buffer> {
    const tanim = raporTanimiAl(kod);
    if (!tanim) throw new NotFoundException(`'${kod}' raporu bulunamadı`);
    const sonuc = await this.calistir(kod, girdi);
    return raporExcelYaz(tanim, sonuc.satirlar);
  }

  /** RPR-04: rapor PDF dışa aktarımı (T-02 altyapısı üzerinden). */
  async pdfUret(kod: string, girdi: RaporGirdisi): Promise<Buffer> {
    const tanim = raporTanimiAl(kod);
    if (!tanim) throw new NotFoundException(`'${kod}' raporu bulunamadı`);
    const sonuc = await this.calistir(kod, girdi);
    const tema = await this.pdf.belgeTemasi();
    return this.pdf.htmlToPdf(raporPdfHtml(tanim, sonuc.satirlar, tema), {
      yatay: raporYatayMi(tanim),
    });
  }

  // ─── KAYITLI GÖRÜNÜMLER (RPR-06) ─────────────────────────────────────────
  // Görünüm kişiseldir; firmaGeneli işaretlenirse firmadaki herkes görür.

  /** RPR-11: görünüm uçları da raporun rolüne bağlıdır. */
  private erisimDenetle(raporKod: string) {
    const tanim = raporTanimiAl(raporKod);
    if (!tanim) throw new NotFoundException(`'${raporKod}' raporu bulunamadı`);
    if (!raporErisilebilir(tanim, aktifBaglam().rol)) throw new ForbiddenException("Bu raporu görme yetkiniz yok");
  }

  async gorunumleriListele(raporKod: string) {
    this.erisimDenetle(raporKod);
    const { tenantId, userId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, (tx) =>
      tx.raporGorunumu.findMany({
        where: {
          raporKod,
          OR: [{ userId }, { firmaGeneli: true }],
        },
        orderBy: { ad: "asc" },
      }),
    );
  }

  async gorunumKaydet(
    raporKod: string,
    veri: { ad: string; girdi: RaporGirdisi; firmaGeneli: boolean },
  ) {
    this.erisimDenetle(raporKod);
    if (!raporTanimiAl(raporKod)) {
      throw new NotFoundException(`'${raporKod}' raporu bulunamadı`);
    }
    const { tenantId, userId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, (tx) =>
      tx.raporGorunumu.upsert({
        where: {
          tenantId_userId_raporKod_ad: {
            tenantId,
            userId,
            raporKod,
            ad: veri.ad,
          },
        },
        create: {
          tenantId,
          userId,
          raporKod,
          ad: veri.ad,
          girdi: veri.girdi as Prisma.InputJsonValue,
          firmaGeneli: veri.firmaGeneli,
        },
        update: {
          girdi: veri.girdi as Prisma.InputJsonValue,
          firmaGeneli: veri.firmaGeneli,
        },
      }),
    );
  }

  /** Görünümü sahibi veya yönetici siler. */
  async gorunumSil(id: string) {
    const { tenantId, userId, rol } = aktifBaglam();
    const kayit = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.raporGorunumu.findUnique({ where: { id } }),
    );
    if (!kayit) throw new NotFoundException("Görünüm bulunamadı");
    if (kayit.userId !== userId && rol !== "yonetici") {
      throw new ForbiddenException("Yalnızca sahibi veya yönetici silebilir");
    }
    await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.raporGorunumu.delete({ where: { id } }),
    );
  }
}
