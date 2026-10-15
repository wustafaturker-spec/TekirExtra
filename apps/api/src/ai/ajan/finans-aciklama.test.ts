import { describe, expect, it } from 'vitest';
import { finansAciklamasiniDogrula, finansOlgulari, finansOlguTalimati } from './finans-aciklama';
import { finansKaynaklariCikar, type FinansKaynagi } from './finans-kaynaklari';

const kaynak: FinansKaynagi = {
  arac: 'gelir_gider', baslik: 'Gelir gider', adres: '/panel/raporlar/gelir-gider', alindiAt: '2026-10-14T18:00:00Z',
  donem: { baslangic: '2026-10-01', bitis: '2026-10-14', aciklama: 'Rapor dönemi' },
  kalemler: [{ ad: 'Net kâr', deger: '-1250.50', paraBirimi: 'TRY' }, { ad: 'Alacak', deger: '9999999999999999.99', paraBirimi: 'USD' }],
  uyarilar: ['Maliyet kaydı eksik'],
};

describe('olgu kimlikli finans açıklaması', () => {
  it.each(['json', '', 'JSON'])('yalnız JSON içeren %s kod bloğunu kaynak denetiminden geçirir', (dil) => {
    const id = finansOlgulari([kaynak])[0].id;
    const metin = `  \n\x60\x60\x60${dil}\n${JSON.stringify({ olguIdleri: [id] })}\n\x60\x60\x60\n `;
    const y = finansAciklamasiniDogrula(metin, [kaynak]);
    expect(y.finansAciklama.durum).toBe('dogrulandi');
    expect(y.finansAciklama.dogrulamaHatasi).toBeUndefined();
    expect(y.cevap).toContain('-1.250,50 TRY');
  });
  it('kod bloğu kaynak kimliği ve şema denetimini aşamaz; hata türü içeriksiz saklanır', () => {
    const id = finansOlgulari([kaynak])[0].id;
    const blok = (v: unknown) => '\x60\x60\x60json\n' + JSON.stringify(v) + '\n\x60\x60\x60';
    const ornekler = [
      [blok({ olguIdleri: ['baska-snapshot'] }), 'kaynakta_olmayan_kimlik'],
      [blok({ olguIdleri: [id, id] }), 'tekrarlanan_kimlik'],
      [blok({ olguIdleri: [id], tutar: '999999' }), 'sema_gecersiz'],
      [blok({ olguIdleri: [] }), 'sema_gecersiz'],
      ['Açıklama: ' + blok({ olguIdleri: [id] }), 'json_gecersiz'],
      [blok({ olguIdleri: [id] }) + '\nEk açıklama', 'json_gecersiz'],
      ['\x60\x60\x60text\n' + JSON.stringify({ olguIdleri: [id] }) + '\n\x60\x60\x60', 'json_gecersiz'],
      ['özel-ham-model-metni', 'json_gecersiz'],
    ];
    for (const [metin, hata] of ornekler) {
      const y = finansAciklamasiniDogrula(metin, [kaynak]);
      expect(y.finansAciklama).toMatchObject({ durum: 'guvenli_ozet', neden: 'model_yaniti_gecersiz', dogrulamaHatasi: hata });
      expect(y.cevap).toContain('-1.250,50 TRY');
      expect(y.cevap).not.toContain('999999');
      expect(JSON.stringify(y)).not.toContain('özel-ham-model-metni');
    }
    expect(finansAciklamasiniDogrula(null, [kaynak]).finansAciklama).toMatchObject({ neden: 'model_hatasi' });
    expect(finansAciklamasiniDogrula(null, [kaynak]).finansAciklama.dogrulamaHatasi).toBeUndefined();
  });
  it('diğer geliri modelin seçebileceği olguya ve güvenli kaynak özetine dahil eder', () => {
    const kaynaklar = finansKaynaklariCikar('gelir_gider', JSON.stringify({
      adres: '/panel/raporlar/gelir-gider?baslangic=2026-10-01&bitis=2026-10-14',
      karZarar: { netSatis: '920438.21', smm: '481121.89', brutKar: '439316.32', digerGelirler: '30000.00', faaliyetGiderleri: '49015.78', netKar: '420300.54' },
      uyarilar: ['14 mal satış satırının maliyeti kayıtlı değil'],
    }), new Date('2026-10-14T20:29:00Z'));
    const olgular = finansOlgulari(kaynaklar);
    expect(olgular.find(f => f.ad === 'Diğer gelirler')).toMatchObject({ tur: 'tutar', deger: '30000.00', paraBirimi: 'TRY' });
    expect(finansOlguTalimati(kaynaklar)).toContain('Diğer gelirler');
    for (const metin of [JSON.stringify({ olguIdleri: olgular.map(f => f.id) }), null]) {
      const y = finansAciklamasiniDogrula(metin, kaynaklar);
      expect(y.cevap).toContain('Diğer gelirler: 30.000,00 TRY');
      expect(y.cevap).toContain('Net kâr: 420.300,54 TRY');
      expect(y.cevap).toContain('14 mal satış satırının maliyeti kayıtlı değil');
    }
  });
  it('kimlikleri snapshot bazında üretir; tarihler tutardan ayrıdır', () => {
    const f = finansOlgulari([kaynak]);
    expect(f.map(v => v.tur)).toEqual(['tutar', 'tutar', 'tarih', 'tarih']);
    expect(finansOlgulari([kaynak])).toEqual(f);
    expect(finansOlgulari([{ ...kaynak, alindiAt: '2026-10-14T18:01:00Z' }])[0].id).not.toBe(f[0].id);
    expect(finansOlguTalimati([kaynak])).toContain(f[0].id);
    expect(finansOlguTalimati([])).toBe('');
  });
  it('model yalnız kimlik seçer; negatif/büyük tutar ve döviz kaynakta kalır', () => {
    const f = finansOlgulari([kaynak]);
    const y = finansAciklamasiniDogrula(JSON.stringify({ olguIdleri: f.map(v => v.id) }), [kaynak]);
    expect(y.finansAciklama.durum).toBe('dogrulandi');
    expect(y.cevap).toContain('-1.250,50 TRY');
    expect(y.cevap).toContain('9.999.999.999.999.999,99 USD');
    expect(y.cevap).toContain('2026-10-01');
    expect(y.cevap).toContain('Maliyet kaydı eksik');
  });
  it.each(['Net kâr 1250.50 TRY.', 'Artış %99.', 'Vade 2027-01-01.', '{bozuk', '{"olguIdleri":[]}'])('desteklenmeyen metin güvenli özete döner: %s', (metin) => {
    const y = finansAciklamasiniDogrula(metin, [kaynak]);
    expect(y.finansAciklama.durum).toBe('guvenli_ozet');
    expect(y.cevap).toContain('-1.250,50 TRY');
    expect(y.cevap).not.toContain('%99');
    expect(y.cevap).not.toContain('2027-01-01');
  });
  it('ek tutar/oran/tarih/metin alanlarını, yinelenen ve eski kimliği reddeder', () => {
    const id = finansOlgulari([kaynak])[0].id;
    for (const alan of ['tutar', 'oran', 'tarih', 'aciklama']) {
      expect(finansAciklamasiniDogrula(JSON.stringify({ olguIdleri: [id], [alan]: 'uydurma' }), [kaynak]).finansAciklama.durum).toBe('guvenli_ozet');
    }
    expect(finansAciklamasiniDogrula(JSON.stringify({ olguIdleri: [id, id] }), [kaynak]).finansAciklama.durum).toBe('guvenli_ozet');
    expect(finansAciklamasiniDogrula(JSON.stringify({ olguIdleri: [id] }), [{ ...kaynak, alindiAt: '2026-10-14T18:01:00Z' }]).finansAciklama.durum).toBe('guvenli_ozet');
  });
  it('model hatasında kaynak olgularını ve uyarıları korur; işlem yapılmadığı iddiası üretmez', () => {
    const y = finansAciklamasiniDogrula(null, [kaynak]);
    expect(y.finansAciklama.neden).toBe('model_hatasi');
    expect(y.finansAciklama.olgular).toHaveLength(4);
    expect(y.cevap).not.toContain('Hiçbir kayıt');
  });
  it('uzun güvenli özeti sınırlar ve kısaltmayı açıkça belirtir', () => {
    const k = { ...kaynak, kalemler: Array.from({ length: 25 }, (_, i) => ({ ad: `Kalem ${i}`, deger: '0.00', paraBirimi: 'TRY' })) };
    const y = finansAciklamasiniDogrula(null, [k]);
    expect(y.finansAciklama.secilenOlguIdleri).toHaveLength(20);
    expect(y.finansAciklama.kisaltildi).toBe(true);
    expect(y.cevap).toContain('Özet kısaltıldı');
  });
});
