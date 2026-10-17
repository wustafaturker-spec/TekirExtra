import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { OdemeSozu, Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { aktifBaglam } from "../core/istek-baglami";
import { PrismaService } from "../core/prisma.service";
import { FATURA_ODEME_SECIMI, faturaOdemeDurumu } from "../fatura/odeme-durumu";
import { odemeSozuKaynaklariniOku } from "./odeme-sozu-kaynak";
import { odemeSozuIptalSemasi, odemeSozuListeSemasi, odemeSozuOlusturSemasi, odemeSozuRevizeSemasi } from "./odeme-sozu.semalar";
import { tahsilatErisiminiDogrula } from "./tahsilat-erisim";
import { z } from "zod";
import { odemeSozuGorunumu as gorunum } from "./odeme-sozu-gorunumu";

type Tx = Prisma.TransactionClient;
function ayristir<T>(sema: z.ZodType<T>, deger: unknown): T {
  const sonuc = sema.safeParse(deger);
  if (!sonuc.success) throw new BadRequestException(sonuc.error.issues.map((s) => s.message).join("; "));
  return sonuc.data;
}
const kimlik = (v: string) => ayristir(z.uuid().transform((s) => s.toLowerCase()), v);

@Injectable()
export class OdemeSozuService {
  constructor(private readonly prisma: PrismaService) {}

  async listele(sorgu: unknown) {
    const { cariId } = ayristir(odemeSozuListeSemasi, sorgu);
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const kullanimModu = await tahsilatErisiminiDogrula(tx);
      return { kullanimModu, ...(await odemeSozuKaynaklariniOku(tx, tenantId, cariId)) };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }

  async olustur(govde: unknown) {
    const g = ayristir(odemeSozuOlusturSemasi, govde);
    return this.yaz(g.istekAnahtari, { islem: "olustur", ...g }, async (tx, tenantId, userId, ozet) => {
      await this.cariKilitle(tx, tenantId, g.cariId);
      await this.hedefDogrula(tx, tenantId, g);
      const zaman = await this.zaman(tx, g.sozTarihi);
      await this.aktifTekilligi(tx, tenantId, g.faturaId);
      await this.kapasite(tx, tenantId, g.cariId);
      const s = await tx.odemeSozu.create({ data: { ...g, tenantId, olusturanUserId: userId, sozTarihi: new Date(g.sozTarihi), verildigiZaman: zaman, girdiOzeti: ozet } });
      await this.audit(tx, s, userId, "odeme_sozu_olusturuldu");
      return gorunum(s);
    });
  }

  async revize(sozId: string, govde: unknown) {
    const id = kimlik(sozId), g = ayristir(odemeSozuRevizeSemasi, govde);
    return this.yaz(g.istekAnahtari, { islem: "revize", id, ...g }, async (tx, tenantId, userId, ozet) => {
      const eski = await this.sozKilitle(tx, tenantId, id);
      this.surumDogrula(eski, g.beklenenSurum);
      await this.hedefDogrula(tx, tenantId, { ...eski, tutar: g.tutar });
      const zaman = await this.zaman(tx, g.sozTarihi);
      await this.kapasite(tx, tenantId, eski.cariId);
      await tx.odemeSozu.update({ where: { id }, data: { kayitDurumu: "revize", sonlandirmaNedeni: g.gerekce, surum: { increment: 1 } } });
      const yeni = await tx.odemeSozu.create({ data: {
        tenantId, cariId: eski.cariId, faturaId: eski.faturaId, dovizCinsi: eski.dovizCinsi,
        tutar: g.tutar, sozTarihi: new Date(g.sozTarihi), aciklama: g.aciklama,
        istekAnahtari: g.istekAnahtari, girdiOzeti: ozet, verildigiZaman: zaman, olusturanUserId: userId, oncekiSozId: id,
      } });
      await this.audit(tx, yeni, userId, "odeme_sozu_revize_edildi", { oncekiSozId: id, gerekce: g.gerekce });
      return gorunum(yeni);
    });
  }

  async iptal(sozId: string, govde: unknown) {
    const id = kimlik(sozId), g = ayristir(odemeSozuIptalSemasi, govde);
    const { tenantId, userId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      await tahsilatErisiminiDogrula(tx, true);
      const eski = await this.sozKilitle(tx, tenantId, id);
      this.surumDogrula(eski, g.beklenenSurum);
      const s = await tx.odemeSozu.update({ where: { id }, data: { kayitDurumu: "iptal", sonlandirmaNedeni: g.gerekce, surum: { increment: 1 } } });
      await this.audit(tx, s, userId, "odeme_sozu_iptal_edildi", { gerekce: g.gerekce });
      return gorunum(s);
    });
  }

  private async yaz<T>(istekAnahtari: string, icerik: unknown, is: (tx: Tx, tenantId: string, userId: string, ozet: string) => Promise<T>) {
    const { tenantId, userId } = aktifBaglam();
    const ozet = createHash("sha256").update(JSON.stringify(icerik)).digest("hex");
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      await tahsilatErisiminiDogrula(tx, true);
      // Tekrar anahtarı başka cariyle eşzamanlı kullanılsa da tek karar.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${tenantId + ":" + istekAnahtari}, 0))::text`;
      const mevcut = await tx.odemeSozu.findUnique({ where: { tenantId_istekAnahtari: { tenantId, istekAnahtari } } });
      if (mevcut) {
        if (mevcut.girdiOzeti !== ozet) throw new ConflictException("İstek anahtarı farklı içerikle kullanılmış");
        return gorunum(mevcut);
      }
      return is(tx, tenantId, userId, ozet);
    });
  }

  private async cariKilitle(tx: Tx, tenantId: string, cariId: string) {
    const satirlar = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM cari_hesaplar WHERE tenant_id = ${tenantId}::uuid AND id = ${cariId}::uuid FOR UPDATE`;
    if (!satirlar.length) throw new NotFoundException("Cari bulunamadı");
  }

  private async sozKilitle(tx: Tx, tenantId: string, id: string) {
    const ilk = await tx.odemeSozu.findFirst({ where: { id, tenantId } });
    if (!ilk) throw new NotFoundException("Ödeme sözü bulunamadı");
    await this.cariKilitle(tx, tenantId, ilk.cariId);
    return tx.odemeSozu.findFirstOrThrow({ where: { id, tenantId } });
  }

  private surumDogrula(s: OdemeSozu, beklenen: number) {
    if (s.kayitDurumu !== "aktif" || s.surum !== beklenen) throw new ConflictException("Ödeme sözü değişmiş veya sonlandırılmış; güncel kaydı okuyun");
  }

  private async aktifTekilligi(tx: Tx, tenantId: string, faturaId: string) {
    if (await tx.odemeSozu.findFirst({ where: { tenantId, faturaId, kayitDurumu: "aktif" }, select: { id: true } })) throw new ConflictException("Bu faturanın aktif bir sözü var; mevcut sözü revize edin");
  }

  private async kapasite(tx: Tx, tenantId: string, cariId: string) {
    if (await tx.odemeSozu.count({ where: { tenantId, cariId } }) >= 1000) throw new BadRequestException("Cari başına söz geçmişi sınırına ulaşıldı");
  }

  private async zaman(tx: Tx, sozTarihi: string) {
    const [r] = await tx.$queryRaw<{ zaman: Date }[]>`SELECT clock_timestamp() AS zaman`;
    if (sozTarihi < r.zaman.toLocaleDateString("sv-SE", { timeZone: "Europe/Istanbul" })) throw new BadRequestException("Söz tarihi bugünden önce olamaz");
    return r.zaman;
  }

  private async hedefDogrula(tx: Tx, tenantId: string, g: { faturaId: string; cariId: string; dovizCinsi: string; tutar: string }) {
    const f = await tx.fatura.findFirst({ where: { id: g.faturaId, tenantId, cariId: g.cariId }, select: { tip: true, durum: true, dovizCinsi: true, genelToplam: true, ...FATURA_ODEME_SECIMI } });
    if (!f) throw new NotFoundException("Söz hedefi bulunamadı");
    if (f.tip !== "satis" || f.durum !== "kesin" || f.dovizCinsi !== g.dovizCinsi) throw new BadRequestException("Kesin satış faturası ve aynı döviz gerekli");
    if (new Prisma.Decimal(g.tutar).gt(faturaOdemeDurumu(f).kalan)) throw new BadRequestException("Söz tutarı faturanın güncel kalanını aşamaz");
  }

  private async audit(tx: Tx, s: OdemeSozu, userId: string, islem: string, ek: Record<string, string> = {}) {
    await tx.auditLog.create({ data: { tenantId: s.tenantId, userId, islem, varlik: "odeme_sozu", varlikId: s.id, detay: { cariId: s.cariId, faturaId: s.faturaId, tutar: s.tutar.toFixed(2), dovizCinsi: s.dovizCinsi, sozTarihi: s.sozTarihi.toISOString().slice(0, 10), ...ek } } });
  }
}
