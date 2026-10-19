import { expect, it } from 'vitest';
import { ihtiyaciHesapla } from './ihtiyac-hesap';
const hesap=(v={})=>ihtiyaciHesapla({mevcut:'10',rezerve:'4',talep:'8',yoldaki:'100',...v});
it('rezervi bir kez düşer; terminsiz yoldaki stok eksik ihtiyacı kapatmaz',()=>expect(hesap()).toMatchObject({kullanilabilir:'6.000',karsilanabilir:'6.000',eksik:'2.000',durum:'tedarik_gerekli'}));
it('tam karşılanan ihtiyacın eksiği sıfırdır',()=>expect(hesap({talep:'6'})).toMatchObject({eksik:'0.000',durum:'stok_yeterli'}));
it('ondalık miktarları kesin hesaplar',()=>expect(hesap({mevcut:'0.3',rezerve:'0.1',talep:'0.2'}).eksik).toBe('0.000'));
it('negatif net stok borcunu tedarik miktarına ekler',()=>expect(hesap({mevcut:'-2'})).toMatchObject({karsilanabilir:'0.000',eksik:'14.000'}));
it.each([{talep:'0'},{talep:'-1'},{rezerve:'-1'},{yoldaki:'-1'},{talep:'1.0001'},{mevcut:'NaN'}])('geçersiz stok miktarını reddeder %j',v=>expect(()=>hesap(v)).toThrow());
