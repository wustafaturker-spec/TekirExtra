import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { kapamaPayiKaynak } from './crm-kapama-paylari';
const ownership=vi.hoisted(()=>({read:vi.fn()}));
vi.mock('./crm-fatura-satir-sahipligi',()=>({faturaSatirSahiplikleriniOku:ownership.read}));
beforeEach(()=>vi.clearAllMocks());
function kur(overflow?:'kapama'|'gecmis'){
 const d=new Prisma.Decimal('100');
 ownership.read.mockResolvedValue(new Map([['F',{lines:[{id:'L',kaynakBelgeSatirId:'K',toplamTutar:d}],path:[],links:[],satirSahipleri:[{satirId:'L',firsatId:'O',matrah:d}]}]]));
 return {fatura:{findFirst:vi.fn().mockResolvedValue({id:'F',durum:'kesin',dovizCinsi:'TRY',genelToplam:d})},faturaKapama:{findMany:vi.fn().mockResolvedValue(overflow==='kapama'?Array.from({length:5001},()=>({})):[])},firsatKapamaPayi:{findMany:vi.fn().mockResolvedValue(overflow==='gecmis'?Array.from({length:5001},()=>({})):[])}};
}
describe('kapama okuyucusunda hacim koruması',()=>{
 it('normal kaynakta doğrulanmış fırsat payını korur',async()=>{const c=await kapamaPayiKaynak(kur() as never,'T','C','O','F');expect(c.pay.toFixed(2)).toBe('100.00');});
 it.each(['kapama','gecmis'] as const)('%s sorgusunda 5001 kayıt kısmi sonuç yerine 409 verir',async field=>{await expect(kapamaPayiKaynak(kur(field) as never,'T','C','O','F')).rejects.toMatchObject({status:409});});
});
