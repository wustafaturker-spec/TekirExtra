import 'reflect-metadata';
import {expect,it,vi} from 'vitest';
import {Prisma} from '@prisma/client';
import {baglamlaCalistir} from '../core/istek-baglami';
import {IhtiyacService} from './ihtiyac.service';
const id='11111111-1111-4111-8111-111111111111';
const g={stokId:id,depoId:id,miktar:'8',birim:'adet',ihtiyacTarihi:'2026-10-21'};
function fixture(){const kart={id,kod:'S1',ad:'Ürün',anaBirim:'adet',tedarikSuresiGun:3,birimler:[{ad:'kutu',katsayi:new Prisma.Decimal('2.5')}],varyantlar:[] as any[]};const t={$queryRaw:vi.fn().mockResolvedValue([{zaman:new Date('2026-10-20T21:30:00Z')}]),stokKart:{findFirst:vi.fn().mockResolvedValue(kart)},depo:{findFirst:vi.fn().mockResolvedValue({id,kod:'D1',ad:'Depo'})},stokDepoBakiye:{findUnique:vi.fn().mockResolvedValue({mevcutMiktar:new Prisma.Decimal(10),rezerveMiktar:new Prisma.Decimal(4),yoldakiMiktar:new Prisma.Decimal(100)})}};const p={tenantIslem:vi.fn(async(_id:string,fn:any)=>fn(t))};const s=new IhtiyacService(p as never);const run=(extra={},rol:any='depo')=>baglamlaCalistir({tenantId:id,userId:id,rol},()=>s.onizle({...g,...extra}));return {t,p,kart,run};}
it('Türkiye gününü kullanır, snapshot ve tenant kapsamını açık kurar',async()=>{const f=fixture(),r=await f.run();expect(r.bugun).toBe('2026-10-21');expect(r.hesap.eksik).toBe('2.000');expect(f.p.tenantIslem).toHaveBeenCalledWith(id,expect.any(Function),{isolationLevel:'RepeatableRead'});expect(f.t.stokKart.findFirst.mock.calls[0][0].where.tenantId).toBe(id);});
it('UTC günü henüz bitmemiş olsa da Türkiye geçmiş gününü reddeder',async()=>{await expect(fixture().run({ihtiyacTarihi:'2026-10-20'})).rejects.toMatchObject({status:400});});
it('birimi tam çevirir, üç haneyi aşan sonucu reddeder',async()=>{const f=fixture();expect((await f.run({birim:'kutu',miktar:'4'})).hesap.talep).toBe('10.000');await expect(f.run({birim:'kutu',miktar:'0.001'})).rejects.toMatchObject({status:400});});
it('varyantlı ürünü reddeder',async()=>{const f=fixture();f.kart.varyantlar.push({id});await expect(f.run()).rejects.toMatchObject({status:400});});
it('bakiyesiz depo için sıfır stok kullanır',async()=>{const f=fixture();f.t.stokDepoBakiye.findUnique.mockResolvedValue(null as never);expect((await f.run()).hesap.eksik).toBe('8.000');});
it('yetkisiz rolde veritabanına gitmez',async()=>{const f=fixture();await expect(f.run({},'salt_okunur')).rejects.toMatchObject({status:403});expect(f.p.tenantIslem).not.toHaveBeenCalled();});
it('geçersiz tarih ve enjeksiyon alanını reddeder',async()=>{const f=fixture();for(const x of [{ihtiyacTarihi:'2026-02-30'},{tenantId:id}])await expect(f.run(x)).rejects.toMatchObject({status:400});expect(f.p.tenantIslem).not.toHaveBeenCalled();});
it('bulunamayan ürün veya depoyu reddeder',async()=>{const f=fixture();f.t.stokKart.findFirst.mockResolvedValueOnce(null as never);await expect(f.run()).rejects.toMatchObject({status:404});f.t.depo.findFirst.mockResolvedValueOnce(null as never);await expect(f.run()).rejects.toMatchObject({status:404});});
