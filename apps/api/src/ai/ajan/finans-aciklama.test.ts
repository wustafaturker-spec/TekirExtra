import { describe, expect, it } from 'vitest';
import { finansAciklamasiniDogrula, finansOlgulari, finansOlguTalimati, finansSecimSemasi } from './finans-aciklama';
import { finansKaynaklariCikar, type FinansKaynagi } from './finans-kaynaklari';

const kaynak: FinansKaynagi = {
  arac: 'gelir_gider', hesapSurumu: 'gelir_gider@1', baslik: 'Gelir gider', adres: '/panel/raporlar/gelir-gider', alindiAt: '2026-10-14T18:00:00Z',
  donem: { baslangic: '2026-10-01', bitis: '2026-10-14', aciklama: 'Rapor dönemi' },
  kalemler: [{ ad: 'Net kâr', metrik: 'net_kar', deger: '-1250.50', paraBirimi: 'TRY' }, { ad: 'Alacak', metrik: 'toplam_alacak', deger: '9999999999999999.99', paraBirimi: 'USD' }],
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
    const k = { ...kaynak, kalemler: Array.from({ length: 25 }, (_, i) => ({ ad: `Kalem ${i}`, metrik: `kalem_${i}`, deger: '0.00', paraBirimi: 'TRY' })) };
    const y = finansAciklamasiniDogrula(null, [k]);
    expect(y.finansAciklama.secilenOlguIdleri).toHaveLength(20);
    expect(y.finansAciklama.kisaltildi).toBe(true);
    expect(y.cevap).toContain('Özet kısaltıldı');
  });

  describe('AI-103 rakamsız not', () => {
    it('belirsiz caride olgu seçmeden soru sorabilir; kaynak listesi ve dipnot basılmaz', () => {
      const soru = 'Birden fazla ABC kaydı var: ABC Ltd. mi, ABC A.Ş. mi?';
      const y = finansAciklamasiniDogrula(JSON.stringify({ olguIdleri: [], not: soru }), [kaynak]);
      expect(y.finansAciklama).toMatchObject({ durum: 'dogrulandi', secilenOlguIdleri: [], not: soru });
      expect(y.cevap).toBe(soru);
    });
    it('ret notu ve seçilen olgular birlikte gösterilir; not önce gelir', () => {
      const id = finansOlgulari([kaynak])[0].id;
      const not = 'Silme işlemi yapılamaz; yalnız bakiyeyi gösterebilirim.';
      const y = finansAciklamasiniDogrula('```json\n' + JSON.stringify({ olguIdleri: [id], not }) + '\n```', [kaynak]);
      expect(y.finansAciklama.durum).toBe('dogrulandi');
      expect(y.cevap.split('\n')[0]).toBe(not);
      expect(y.cevap).toContain('-1.250,50 TRY');
      expect(y.cevap).toContain('model yeni bir oran');
    });
    it.each(['Net kâr eksi bin iki yüz elli, yani 1250 TRY.', 'Artış %ten fazla.', 'Vade ٢٠٢٧ yılında.', 'Binde ‰ fark.'])('rakam ya da yüzde içeren not reddedilir: %s', (not) => {
      const id = finansOlgulari([kaynak])[0].id;
      const y = finansAciklamasiniDogrula(JSON.stringify({ olguIdleri: [id], not }), [kaynak]);
      expect(y.finansAciklama).toMatchObject({ durum: 'guvenli_ozet', dogrulamaHatasi: 'notta_rakam' });
      expect(y.finansAciklama.not).toBeUndefined();
      expect(y.cevap).not.toContain(not);
      expect(y.cevap).toContain('-1.250,50 TRY');
    });
    it('boş seçim yalnız notla geçerli; boş/aşırı uzun not şemadan döner', () => {
      for (const v of [{ olguIdleri: [] }, { olguIdleri: [], not: '   ' }, { olguIdleri: [], not: 'a'.repeat(601) }]) {
        expect(finansAciklamasiniDogrula(JSON.stringify(v), [kaynak]).finansAciklama.dogrulamaHatasi).toBe('sema_gecersiz');
      }
    });
    it('ek denetimin reddettiği not güvenli özete döner', () => {
      const y = finansAciklamasiniDogrula(JSON.stringify({ olguIdleri: [], not: 'Faturayı iptal ettim.' }), [kaynak], { notuReddet: () => true });
      expect(y.finansAciklama).toMatchObject({ durum: 'guvenli_ozet', dogrulamaHatasi: 'not_reddedildi' });
      expect(y.cevap).not.toContain('iptal ettim');
    });
    it('üretim şeması da rakamlı notu ve bilinmeyen kimliği reddeder', () => {
      const id = finansOlgulari([kaynak])[0].id;
      const sema = finansSecimSemasi([kaynak]);
      expect(sema.safeParse({ olguIdleri: [], not: 'Hangi cari?' }).success).toBe(true);
      expect(sema.safeParse({ olguIdleri: [id], not: 'Toplam 5 TRY' }).success).toBe(false);
      expect(sema.safeParse({ olguIdleri: ['f-yok'], not: 'Hangi cari?' }).success).toBe(false);
      expect(finansOlguTalimati([kaynak])).toContain('HİÇ RAKAM');
    });
    it('harf+rakam kelime kullanıcı mesajında geçiyorsa notta kabul edilir; yalın sayı yine reddedilir', () => {
      const id = finansOlgulari([kaynak])[0].id;
      const dogrula = (not: string, kullaniciMetni?: string) => finansAciklamasiniDogrula(JSON.stringify({ olguIdleri: [id], not }), [kaynak], { kullaniciMetni }).finansAciklama;
      expect(dogrula('A4 kağıdı için hangi cariyi kastediyorsunuz?', "Yılmaz'a A4 kağıdı teklifi aç")).toMatchObject({ durum: 'dogrulandi' });
      expect(dogrula('A4 kağıdı için hangi cari?')).toMatchObject({ dogrulamaHatasi: 'notta_rakam' });
      expect(dogrula('On adet A4 değil, 10 adet mi?', 'A4 kağıdından 10 adet')).toMatchObject({ dogrulamaHatasi: 'notta_rakam' });
      expect(dogrula('B4 mü?', 'A4 kağıdı')).toMatchObject({ dogrulamaHatasi: 'notta_rakam' });
      expect(dogrula('Gelir gider raporu', undefined)).toMatchObject({ durum: 'dogrulandi' });
      const sema = finansSecimSemasi([kaynak], 'A4 kağıdı');
      expect(sema.safeParse({ olguIdleri: [id], not: 'A4 için hangisi?' }).success).toBe(true);
      expect(sema.safeParse({ olguIdleri: [id], not: 'A4 için 10 adet' }).success).toBe(false);
    });
    it('talimattaki olgular kaynak başlığını taşır (aynı adlı iki carinin bakiyesi ayırt edilir)', () => {
      const a = { ...kaynak, baslik: 'Test Yılmaz A' }, b = { ...kaynak, baslik: 'Test Yılmaz B', alindiAt: '2026-10-14T18:00:01Z' };
      const t = finansOlguTalimati([a, b]);
      expect(t).toContain('"kaynak":"Test Yılmaz A"');
      expect(t).toContain('"kaynak":"Test Yılmaz B"');
      expect(finansOlgulari([a])[0].id).toBe(finansOlgulari([{ ...a, baslik: 'Başka' }])[0].id);
    });
  });

  describe('AI-98 metrik ve hesap sürümü', () => {
    it('aynı tutar ve ad farklı metrikle ayrı olgudur; metrik ve dönem yanıtta görünür', () => {
      const ikiz = { ...kaynak, kalemler: [{ ad: 'Tutar', metrik: 'net_kar', deger: '0.00', paraBirimi: 'TRY' }, { ad: 'Tutar', metrik: 'vadesi_gecen_alacak', deger: '0.00', paraBirimi: 'TRY' }] };
      const [a, b] = finansOlgulari([ikiz]);
      expect(a.id).not.toBe(b.id);
      expect(a).toMatchObject({ metrik: 'net_kar', hesapSurumu: 'gelir_gider@1', donem: 'Rapor dönemi 2026-10-01 – 2026-10-14' });
      const y = finansAciklamasiniDogrula(JSON.stringify({ olguIdleri: [b.id] }), [ikiz]);
      expect(y.finansAciklama).toMatchObject({ surum: 'finans-olgu-v2', durum: 'dogrulandi' });
      expect(y.cevap).toContain('Tutar: 0,00 TRY (vadesi_gecen_alacak · Rapor dönemi 2026-10-01 – 2026-10-14)');
      expect(y.cevap).not.toContain('net_kar');
    });
    it('hesap sürümü kimliğe girer: sürüm değişince eski kimlik reddedilir', () => {
      const eski = finansOlgulari([kaynak])[0].id;
      const yeni = { ...kaynak, hesapSurumu: 'gelir_gider@2' };
      expect(finansOlgulari([yeni])[0].id).not.toBe(eski);
      expect(finansAciklamasiniDogrula(JSON.stringify({ olguIdleri: [eski] }), [yeni]).finansAciklama).toMatchObject({ durum: 'guvenli_ozet', dogrulamaHatasi: 'kaynakta_olmayan_kimlik' });
    });
    it('eski oturumdaki (AI-98 öncesi, metriksiz) kaynak olgu üretmez; kimliği yeni yanıtta geçmez', () => {
      const v1 = { ...kaynak, hesapSurumu: undefined as unknown as string, kalemler: kaynak.kalemler.map(({ metrik: _m, ...k }) => k) } as unknown as FinansKaynagi;
      expect(finansOlgulari([v1])).toEqual([]);
      const eskiKimlik = 'f-' + '0'.repeat(24);
      expect(finansAciklamasiniDogrula(JSON.stringify({ olguIdleri: [eskiKimlik] }), [kaynak]).finansAciklama.dogrulamaHatasi).toBe('kaynakta_olmayan_kimlik');
    });
    it('negatif, sıfır ve çok büyük tutarlar metrikleriyle aktarılır', () => {
      const k = finansKaynaklariCikar('finansal_ozet', JSON.stringify({ nakitVarliklar: '-1250.50', envanterDegeri: 0, toplamAlacaklar: '123456789012345678901234.99', toplamBorclar: 1e20 }), new Date('2026-11-16T09:00:00Z'));
      expect(k[0]).toMatchObject({ hesapSurumu: 'finansal_ozet@1' });
      expect(k[0].kalemler).toEqual([
        { ad: 'Nakit varlıklar', metrik: 'nakit_varliklar', deger: '-1250.50', paraBirimi: 'TRY' },
        { ad: 'Stok değeri', metrik: 'stok_degeri', deger: '0', paraBirimi: 'TRY' },
        { ad: 'Alacaklar', metrik: 'toplam_alacak', deger: '123456789012345678901234.99', paraBirimi: 'TRY' },
      ]);
      expect(k[0].uyarilar.join(' ')).toContain('Güvenli sayı aralığı');
      const y = finansAciklamasiniDogrula(null, k);
      expect(y.cevap).toContain('-1.250,50 TRY (nakit_varliklar');
      expect(y.cevap).toContain('0,00 TRY (stok_degeri');
      expect(y.cevap).toContain('123.456.789.012.345.678.901.234,99 TRY (toplam_alacak');
    });
    it('yetkisiz/bilinmeyen araç kaynak üretmez; ondan türetilmiş kimlik reddedilir', () => {
      expect(finansKaynaklariCikar('maas_listesi', JSON.stringify({ toplamAlacakTry: '5' }))).toEqual([]);
      const sahte = finansOlgulari([{ ...kaynak, arac: 'maas_listesi', hesapSurumu: 'maas@1' }])[0].id;
      expect(finansAciklamasiniDogrula(JSON.stringify({ olguIdleri: [sahte] }), [kaynak]).finansAciklama.dogrulamaHatasi).toBe('kaynakta_olmayan_kimlik');
    });
    it('mevcut araçların her kalemi metrik kodu taşır (END-21 dahil)', () => {
      const simdi = new Date('2026-11-16T09:00:00Z');
      const stokId = '11111111-1111-4111-8111-111111111111';
      const ornekler: Array<[string, unknown]> = [
        ['finansal_ozet', { nakitVarliklar: '1', envanterDegeri: '2', toplamAlacaklar: '3', toplamBorclar: '4', netVarlikDegeri: '5' }],
        ['vadesi_gecen_alacaklar', { toplamAlacakTry: '1', toplamBorcTry: '2' }],
        ['gelir_gider', { adres: '/panel/raporlar/gelir-gider?baslangic=2026-10-01&bitis=2026-10-31', karZarar: { netSatis: '1', netKar: '2' } }],
        ['rapor_calistir', { ad: 'Satış', adres: '/panel/raporlar?rapor=satis.ozet&f.baslangic=2026-10-01', kolonlar: [{ alan: 'tutar', baslik: 'Tutar', tip: 'para' }], toplamlar: { tutar: { deger: '10', doviz: 'TRY' } }, satirlar: [], satirSayisi: 0 }],
        ['endeks_getir', { kod: 'TUFE', ad: 'TÜFE', degerler: [{ ay: '2026-10', deger: '3000' }], ozet: { ilkAy: '2026-01', sonAy: '2026-10', ilkDeger: '2800', sonDeger: '3000', donemDegisimi: '7.14', sonYillikDegisim: '33.1' } }],
        ['fiyat_endeks_karsilastir', { stok: { id: stokId, ad: 'Ürün', anaBirim: 'kg' }, endeksler: [{ kod: 'TUFE', ad: 'TÜFE' }], seriler: [{ ad: 'Satış', karsilastirmalar: [{ endeks: 'TUFE', bazAy: '2026-01-01', sonAy: '2026-10-01', bazFiyat: '10', sonFiyat: '12', olmasiGerekenFiyat: '11', fark: '1', fiyatDegisim: '20', endeksDegisim: '10', reelDegisim: '9.09' }] }] }],
        ['cari_getir', { id: stokId, unvan: 'Cari', bakiyeler: [{ dovizCinsi: 'TRY', bakiye: '-5' }] }],
        ['fatura_getir', { id: stokId, no: 'F1', tarih: '2026-10-05', dovizCinsi: 'USD', genelToplam: '120', toplamMatrah: '100', toplamKdv: '20' }],
      ];
      const metrikler = new Set<string>();
      for (const [arac, cikti] of ornekler) {
        const k = finansKaynaklariCikar(arac, JSON.stringify(cikti), simdi);
        expect(k.length, arac).toBeGreaterThan(0);
        for (const kaynak of k) {
          expect(kaynak.hesapSurumu, arac).toMatch(/^[a-z_]+@\d+$/);
          for (const t of kaynak.kalemler) { expect(t.metrik, `${arac} ${t.ad}`).toMatch(/^[a-z0-9_:.]+$/); metrikler.add(t.metrik); }
        }
      }
      for (const m of ['vadesi_gecen_alacak', 'net_kar', 'reel_degisim', 'endeks_degeri', 'cari_bakiye', 'belge_kdv', 'rapor:satis.ozet:tutar:toplam']) expect(metrikler).toContain(m);
    });
  });
});
