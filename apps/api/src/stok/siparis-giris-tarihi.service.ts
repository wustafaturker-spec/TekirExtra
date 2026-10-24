import {ihtiyacErisiminiDogrula} from './ihtiyac-erisim';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { aktifBaglam } from '../core/istek-baglami';
import { PrismaService } from '../core/prisma.service';
import { girisSatirKaniti, girisSatirSecimi } from './ihtiyac-siparis-kaynak';

const tarih = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => {
  const d = new Date(`${v}T00:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === v;
});
const sema = z.object({ tarih: tarih.nullable(), beklenenSurum: z.number().int().min(0).max(2147483646),
  beklenenKaynakOzeti: z.string().regex(/^[a-f0-9]{64}$/), gerekce: z.string().trim().min(5).max(1000) }).strict();
function kimlik(v: string) {
  const p = z.uuid().safeParse(v);
  if (!p.success) throw new BadRequestException('Geçersiz sipariş satırı');
  return p.data;
}

@Injectable()
export class SiparisGirisTarihiService {
  constructor(private readonly prisma: PrismaService) {}

  async oku(satirId: string) {
    const { tenantId, rol } = aktifBaglam();
    if (!['yonetici', 'muhasebe', 'depo'].includes(rol)) throw new ForbiddenException('Giriş tarihi için yetkiniz yok');
    const id = kimlik(satirId);
    return this.prisma.tenantIslem(tenantId, async tx => {
      const erisim=await ihtiyacErisiminiDogrula(tx);
      const s = await tx.belgeSatir.findFirst({ where: { id, tenantId }, select: girisSatirSecimi });
      if (!s) throw new NotFoundException('Sipariş satırı bulunamadı');
      const k = girisSatirKaniti(s), t = s.girisTarihi;
      return { erisim,satirId: id, ...k, stok:{kod:s.stok.kod,ad:s.stok.ad},siparisNo:s.belge.no, tarih: t?.tarih?.toISOString().slice(0, 10) ?? null, surum: t?.surum ?? 0,
        gecerli: !!t?.tarih && t.kaynakOzeti === k.kaynakOzeti, gerekce: t?.gerekce ?? null };
    });
  }

  async kaydet(satirId: string, body: unknown) {
    const { tenantId, userId, rol } = aktifBaglam();
    if (!['yonetici', 'muhasebe'].includes(rol)) throw new ForbiddenException('Giriş tarihini yalnız yönetici veya muhasebe doğrulayabilir');
    const id = kimlik(satirId), p = sema.safeParse(body);
    if (!p.success) throw new BadRequestException(p.error.issues.map(v => v.message).join('; '));
    const g = p.data;
    return this.prisma.tenantIslem(tenantId, async tx => {
      await ihtiyacErisiminiDogrula(tx,true);
      // Önce belgeyi, sonra satırı kilitle; silme/revizyonla kaynak değişimi önlenir.
      const kilit = await tx.$queryRaw<{ id: string }[]>`SELECT b.id FROM belgeler b JOIN belge_satirlari s ON s.belge_id=b.id AND s.tenant_id=b.tenant_id WHERE s.tenant_id=${tenantId}::uuid AND s.id=${id}::uuid FOR UPDATE OF b`;
      if (!kilit.length) throw new NotFoundException('Sipariş satırı bulunamadı');
      await tx.$queryRaw`SELECT id FROM belge_satirlari WHERE tenant_id=${tenantId}::uuid AND id=${id}::uuid FOR UPDATE`;
      const s = await tx.belgeSatir.findFirst({ where: { id, tenantId }, select: girisSatirSecimi });
      if (!s) throw new NotFoundException('Sipariş satırı bulunamadı');
      const k = girisSatirKaniti(s);
      if (k.kaynakOzeti !== g.beklenenKaynakOzeti || k.kalanMiktar === '0.000') throw new ConflictException('Sipariş kaynağı değişti veya kalan miktar yok; yeniden yükleyin');
      const eski = s.girisTarihi, oncekiTarih = eski?.tarih?.toISOString().slice(0, 10) ?? null;
      // Aynı başarılı isteğin ağ tekrarı ikinci revizyon veya audit oluşturmaz.
      if (eski && eski.surum === g.beklenenSurum + 1 && eski.kaynakOzeti === k.kaynakOzeti && oncekiTarih === g.tarih && eski.gerekce === g.gerekce && eski.dogrulayanUserId === userId) {
        return { satirId: id, tarih: oncekiTarih, surum: eski.surum, kaynakOzeti: k.kaynakOzeti };
      }
      if ((eski?.surum ?? 0) !== g.beklenenSurum) throw new ConflictException('Giriş tarihi başka bir işlemde değişti; yeniden yükleyin');
      const [zaman] = await tx.$queryRaw<{ bugun: string; zaman: Date }[]>`SELECT (clock_timestamp() AT TIME ZONE 'Europe/Istanbul')::date::text AS bugun, clock_timestamp() AS zaman`;
      if (g.tarih && g.tarih < zaman.bugun) throw new BadRequestException('Geçmiş güne beklenen giriş doğrulanamaz');
      const surum = g.beklenenSurum + 1;
      const data = { tarih: g.tarih ? new Date(`${g.tarih}T00:00:00Z`) : null, surum, kaynakOzeti: k.kaynakOzeti, gerekce: g.gerekce, dogrulayanUserId: userId, guncellendiAt: zaman.zaman };
      await tx.siparisGirisTarihi.upsert({ where: { tenantId_satirId: { tenantId, satirId: id } }, create: { tenantId, satirId: id, ...data }, update: data });
      await tx.auditLog.create({ data: { tenantId, userId, varlik: 'siparis_giris_tarihi', varlikId: id, islem: g.tarih ? 'siparis_giris_tarihi_dogrulandi' : 'siparis_giris_tarihi_kaldirildi',
        detay: { belgeId: s.belgeId, oncekiTarih, tarih: g.tarih, oncekiSurum: g.beklenenSurum, surum, kaynakOzeti: k.kaynakOzeti, gerekce: g.gerekce } } });
      return { satirId: id, tarih: g.tarih, surum, kaynakOzeti: k.kaynakOzeti };
    });
  }
}
