import { expect, test, type Page, type Route } from '@playwright/test';

const banka = { id: '11111111-1111-4111-8111-111111111111', ad: 'Test hesabı', bankaAdi: 'Test banka', dovizCinsi: 'TRY' };
const dosya = { name: 'ornek.csv', mimeType: 'text/csv', buffer: Buffer.from('Tarih;Açıklama;Tutar\n15.10.2026;Test hareketi;100,00\n') };
const onizleme = { bankaHesapId: banka.id, bankaHesapAdi: banka.ad, basliklar: ['Tarih', 'Açıklama', 'Tutar'], ornekSatirlar: [['15.10.2026', 'Test hareketi', '100,00']], toplamSatir: 1, esleme: { baslikSatiri: 0, tarih: 0, aciklama: 1, tutar: 2 }, eslemeKayitli: false };

async function kur(page: Page, yukleme: (route: Route) => Promise<void>) {
  await page.addInitScript(() => sessionStorage.setItem('tekir_access', 'test-token'));
  await page.route('**/api/v1/**', async route => {
    const url = new URL(route.request().url()), yol = url.pathname;
    // localhost:3001'e kaçan istek, gerçek API'ye ulaşmadan testi düşürür.
    if (url.origin !== 'http://127.0.0.1:3103') { await route.abort(); throw new Error('API_ORIGIN_YANLIS'); }
    if (yol.endsWith('/ekstre/onizle') || yol.endsWith('/ekstre/yukle')) return yukleme(route);
    if (yol.endsWith('/auth/yenile')) return route.fulfill({ json: { accessToken: 'yenilenen-token' } });
    let json: unknown = {};
    if (yol.endsWith('/auth/ben')) json = { userId: 'u1', tenantId: 't1', rol: 'yonetici' };
    else if (yol.endsWith('/bankalar')) json = [banka];
    else if (yol.endsWith('/cari')) json = { kayitlar: [], sonrakiImlec: null };
    else if (yol.includes('/kasa-banka/') || yol.endsWith('/ai/onay-talepleri')) json = [];
    else if (yol.endsWith('/ebelge/uygulamalar')) json = { efatura: { acik: false }, earsiv: { acik: false }, eirsaliye: { acik: false } };
    await route.fulfill({ json });
  });
  await page.goto('/panel/kasa-banka/ekstre');
  await page.getByRole('button', { name: 'Ekstre yükle', exact: true }).click();
  await page.locator('.statement-upload select').first().selectOption(banka.id);
  await page.locator('.statement-upload input[type=file]').setInputFiles(dosya);
}

test('aynı origin multipart önizleme ve aktarım; 401 sonrası dosya ve istek anahtarı korunur', async ({ page }) => {
  let okuma = 0, aktarim = 0;
  const anahtarlar: string[] = [];
  await kur(page, async route => {
    const req = route.request(), headers = req.headers(), body = req.postDataBuffer()!.toString('utf8');
    expect(req.method()).toBe('POST');
    expect(headers['content-type']).toMatch(/^multipart\/form-data; boundary=/);
    expect(headers['idempotency-key']).toBeTruthy();
    expect(body).toContain('ornek.csv');
    expect(body).toContain('Test hareketi');
    if (new URL(req.url()).pathname.endsWith('/onizle')) {
      okuma++;
      anahtarlar.push(headers['idempotency-key']);
      if (okuma === 1) return route.fulfill({ status: 401, json: { message: 'Token süresi doldu' } });
      expect(headers.authorization).toBeUndefined();
      expect(body).toContain(banka.id);
      return route.fulfill({ json: onizleme });
    }
    aktarim++;
    expect(headers.authorization).toBeUndefined();
    expect(body).toContain('name="veri"');
    expect(body).toContain('"esleme"');
    await route.fulfill({ json: { okunanSatir: 1, yeniSatir: 1, yinelenenSatir: 0, atlananSatir: 0 } });
  });
  await page.getByRole('button', { name: 'Dosyayı oku', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Satırları aktar', exact: true })).toBeVisible();
  expect(okuma).toBe(2);
  expect(anahtarlar[0]).toBe(anahtarlar[1]);
  expect(aktarim).toBe(0);
  await page.getByRole('button', { name: 'Satırları aktar', exact: true }).click();
  await expect(page.getByText('1 hareket okundu; 1 yeni satır eklendi.', { exact: true })).toBeVisible();
  expect(aktarim).toBe(1);
});

test('sunucunun dosya doğrulama hatasını gösterir; aktarım başlamaz', async ({ page }) => {
  await kur(page, async route => {
    expect(new URL(route.request().url()).pathname).toContain('/onizle');
    await route.fulfill({ status: 400, json: { message: ['Dosya biçimi desteklenmiyor', 'CSV veya XLSX yükleyin'] } });
  });
  await page.getByRole('button', { name: 'Dosyayı oku', exact: true }).click();
  await expect(page.getByText('Dosya biçimi desteklenmiyor; CSV veya XLSX yükleyin', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Satırları aktar', exact: true })).toHaveCount(0);
});

test('ağ kesilmesinde anlaşılır hata gösterir ve yüklemeyi otomatik tekrarlamaz', async ({ page }) => {
  let istek = 0;
  await kur(page, async route => { istek++; await route.abort('failed'); });
  await page.getByRole('button', { name: 'Dosyayı oku', exact: true }).click();
  await expect(page.getByText('Sunucuya bağlanılamadı. Lütfen sunucunun çalıştığından emin olun.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Dosyayı oku', exact: true })).toBeEnabled();
  expect(istek).toBe(1);
});
