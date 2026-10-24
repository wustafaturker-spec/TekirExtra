import { Prisma } from '@prisma/client';
import { z } from 'zod';

const gun = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => {
  const d = new Date(`${v}T00:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === v;
}, 'Geçersiz takvim günü');
const miktar = z.string().regex(/^(0|[1-9]\d{0,11})(\.\d{1,3})?$/);
const kapsam = z.object({
  tenantId: z.uuid(), stokId: z.uuid(), depoId: z.uuid(),
  varyantId: z.uuid().nullable(), anaBirim: z.string().trim().min(1).max(30),
}).strict();
const olay = z.object({
  // Kaynak kimliği belge değil, kalan miktarı temsil eden tekil satır kimliğidir.
  kaynakId: z.string().trim().min(1).max(200),
  tur: z.enum(['giris', 'talep']), gun: gun.nullable(),
  kalanMiktar: miktar, durum: z.enum(['acik', 'iptal', 'tamamlandi']),
  tarihDogrulandi: z.boolean(),
  // Snapshot rezervine zaten katılan talep bir daha düşülmez.
  rezervde: z.boolean(), kapsam,
}).strict();
export const tarihliIhtiyacSemasi = z.object({
  kapsam, bugun: gun, ihtiyacTarihi: gun,
  mevcut: z.string().regex(/^-?\d{1,12}(\.\d{1,3})?$/),
  rezerve: miktar, yeniTalep: miktar.refine(v => new Prisma.Decimal(v).gt(0)),
  olaylar: z.array(olay).max(5000),
}).strict();
export type TarihliIhtiyacGirdisi = z.infer<typeof tarihliIhtiyacSemasi>;

/**
 * Salt okunur, tek stok/depo/varyant ve ana birim için dönemsel hesap.
 * Girdi yalnız yetkili kaynak adaptöründen gelmelidir; bu işlev yetkilendirme yapmaz.
 * Kalan miktarlar kısmi teslim/fatura zinciri çözülerek ana birimde sağlanır.
 * Sonuç rezerv veya kalıcı talep–karşılama bağı değildir.
 */
export function tarihliIhtiyaciHesapla(girdi: TarihliIhtiyacGirdisi) {
  const g = tarihliIhtiyacSemasi.parse(girdi);
  if (g.ihtiyacTarihi < g.bugun) throw Error('İhtiyaç günü geçmişte olamaz');
  const kimlikler = new Set<string>();
  const dislananlar: { kaynakId: string; neden: string }[] = [];
  const dahil: typeof g.olaylar = [];
  let veriYeterli = true;
  for (const o of g.olaylar) {
    if ((Object.keys(g.kapsam) as (keyof typeof g.kapsam)[]).some(k => o.kapsam[k] !== g.kapsam[k])) {
      throw Error('Kaynak tenant/stok/depo/varyant/birim kapsamı uyuşmuyor');
    }
    if (kimlikler.has(o.kaynakId)) throw Error('Tekrarlanan kaynak satırı');
    kimlikler.add(o.kaynakId);
    if (o.tur === 'giris' && o.rezervde) throw Error('Giriş rezerv talebi olamaz');
    const neden = o.durum !== 'acik' ? 'kapali_kaynak'
      : new Prisma.Decimal(o.kalanMiktar).isZero() ? 'kalan_yok'
      : o.tur === 'talep' && o.rezervde ? 'rezervde_zaten_dusuldu'
      : !o.gun || !o.tarihDogrulandi ? 'tarih_dogrulanmadi'
      : o.gun < g.bugun ? 'gecikmis_kaynak'
      : o.gun > g.ihtiyacTarihi ? 'ufuk_disinda' : null;
    if (neden) {
      dislananlar.push({ kaynakId: o.kaynakId, neden });
      // Tarihi bilinmeyen veya gecikmiş açık talebi yok sayarak yeterlilik ilan edilmez.
      if (o.tur === 'talep' && ['tarih_dogrulanmadi', 'gecikmis_kaynak'].includes(neden)) veriYeterli = false;
    }
    else dahil.push(o);
  }
  // Aynı gün içi saat sırası bilinmez: talepler girişlerden önce işlenir.
  // Böylece gün sonu yeterliliği gün içindeki açığı gizlemez.
  dahil.sort((a, b) => a.gun!.localeCompare(b.gun!) ||
    (a.tur === b.tur ? a.kaynakId.localeCompare(b.kaynakId) : a.tur === 'talep' ? -1 : 1));
  let bakiye = new Prisma.Decimal(g.mevcut).sub(g.rezerve);
  let enDusuk = bakiye;
  let giris = new Prisma.Decimal(0), ekTalep = new Prisma.Decimal(0);
  const hareketler: { kaynakId: string; gun: string; tur: 'giris' | 'talep'; miktar: string; bakiye: string }[] = [];
  for (const o of dahil) {
    const m = new Prisma.Decimal(o.kalanMiktar);
    if (o.tur === 'giris') { bakiye = bakiye.add(m); giris = giris.add(m); }
    else { bakiye = bakiye.sub(m); ekTalep = ekTalep.add(m); }
    enDusuk = Prisma.Decimal.min(enDusuk, bakiye);
    hareketler.push({ kaynakId: o.kaynakId, gun: o.gun!, tur: o.tur, miktar: m.toFixed(3), bakiye: bakiye.toFixed(3) });
  }
  const talepOncesi = bakiye;
  bakiye = bakiye.sub(g.yeniTalep);
  enDusuk = Prisma.Decimal.min(enDusuk, bakiye);
  const eksik = Prisma.Decimal.max(bakiye.negated(), 0);
  return {
    surum: 1 as const, ihtiyacTarihi: g.ihtiyacTarihi,
    baslangicKullanilabilir: new Prisma.Decimal(g.mevcut).sub(g.rezerve).toFixed(3),
    tarihliGiris: giris.toFixed(3), ekTalep: ekTalep.toFixed(3),
    talepOncesi: talepOncesi.toFixed(3), yeniTalep: new Prisma.Decimal(g.yeniTalep).toFixed(3),
    donemSonu: bakiye.toFixed(3), eksik: eksik.toFixed(3),
    donemIciEnBuyukAcik: Prisma.Decimal.max(enDusuk.negated(), 0).toFixed(3),
    veriYeterli,
    durum: !veriYeterli ? 'dogrulanamadi' as const : eksik.gt(0) ? 'tedarik_gerekli' as const : 'donem_sonu_yeterli' as const,
    hareketler, dislananlar,
  };
}
