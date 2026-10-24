# Yeni banka sağlayıcısı ekleme (KSB-30)

TekirExtra'ya banka hareketi üç yoldan girer:

| Yol | Nerede | Not |
|---|---|---|
| Dosya | `kasa-banka/ekstre-standart.ts`, `ekstre.service.ts` | Excel/CSV (sütun eşlemeli), **MT940** (.sta/.940/.txt) ve **camt.053 / camt.052** (.xml). Biçim içerikten tanınır; IBAN ve döviz seçilen hesapla denetlenir. |
| Webhook | `docs/BANKA-WEBHOOK.md` | Sağlayıcı hareketi kendisi iter. |
| Çekilen API | `kasa-banka/banka-saglayici*.ts` | Toplayıcı (Vomsis vb.) ya da bankanın kendi API'si. Bu belge bu yolu anlatır. |

Çekilen API'lerin hepsi aynı arayüzü uygular; eşleme, elle/otomatik çekim, hata sayacı, kimlik hatasında otomatik durdurma, yineleme denetimi, bakiye uyarısı ve bildirimler sağlayıcıdan bağımsızdır. Yeni sağlayıcı **tek adaptör dosyası + kayıt satırı** ile eklenir.

## 1. Adaptörü yazın

`apps/api/src/kasa-banka/<kod>.adapter.ts`:

```ts
import { bankaIstegi, SaglayiciKimlikHatasi, type BankaSaglayicisi, type HareketAraligi } from "./banka-saglayici";

export class OrnekBankaSaglayicisi implements BankaSaglayicisi {
  readonly kod = "ornekbanka";          // baglanti.saglayici değeri
  readonly ad = "Örnek Bank";           // hata mesajlarında görünür

  async hesaplar(ayar: Record<string, unknown>) {
    const yanit = await bankaIstegi(this.ad, `${ayar.servisAdresi}/accounts`, { headers: { Authorization: `Bearer ${ayar.apiAnahtari}` } });
    if (yanit.status === 401 || yanit.status === 403) throw new SaglayiciKimlikHatasi(`${this.ad} kimlik bilgileri reddedildi`);
    if (!yanit.ok) throw new Error(`${this.ad} hesapları alınamadı (${yanit.status})`);
    const govde = (await yanit.json()) as any[];
    return govde.map((h) => ({ id: String(h.id), ad: h.name, iban: h.iban, dovizCinsi: h.currency, bankaAdi: this.ad }));
  }

  async hareketler(ayar: Record<string, unknown>, disHesapId: string, aralik: HareketAraligi) {
    // aralik.baslangic / bitis: Date. Bankaya Türkiye tarihi gerekiyorsa trTarihParcalari() kullanın.
    // aralik.imlec: önceki çekimde döndürdüğünüz değer (sayfa/son id). Desteklemiyorsanız yok sayın.
    // ...
    return { hareketler: [/* SaglayiciHareketi */], imlec: "son-id-ya-da-null" };
  }
}
```

Kurallar:

- **HTTP** için yalnız `bankaIstegi` kullanın: 30 sn zaman aşımı, 429/5xx ve ağ hatasında 3 deneme (Retry-After'a uyar). Kendi `fetch` döngünüzü yazmayın.
- **Kimlik hatası** (401/403, süresi dolmuş anahtar) `SaglayiciKimlikHatasi` olarak fırlatılır. Otomatik çekim bunda durur ve kullanıcıya bildirim düşer; geçici hatalarda durmaz.
- **Hareket**: `tarih` `YYYY-MM-DD` (Türkiye günü), `tutar` girişte artı / çıkışta eksi, `id` sağlayıcıda kalıcı ve tekil olmalı (yinelenen denetimi buna dayanır). `bakiye` verilirse bakiye uyarısı çalışır; verilmezse uyarı yalnız ekstre bakiyesiyle yapılır.
- **Sayfalama** adaptörün içindedir; tek çağrı aralığın tamamını döndürür. Sonsuz döngüye karşı sayfa sınırı koyun (Vomsis: 20).
- **Token** önbelleği gerekiyorsa anahtarı gizli bilgilerin özetiyle (sha256) kurun, düz metin saklamayın (örnek: `vomsis.adapter.ts`).

## 2. Kaydedin

`banka-saglayici-kaydi.ts`:

```ts
export const BANKA_SAGLAYICILARI = { vomsis: new VomsisSaglayicisi(), ornekbanka: new OrnekBankaSaglayicisi() };
```

`packages/shared/src/enums.ts` içindeki `BANKA_SAGLAYICILARI` listesine de kodu ekleyin (bağlantı formu ve doğrulama bu listeyi kullanır).

## 3. Bağlantı ayarını doğrulayın

`apps/api/src/tenant/baglantilar.service.ts`:

- Satır ~66: zod `superRefine` içinde sağlayıcının zorunlu alanlarını denetleyin (Vomsis: `kullaniciAdi` + `parola`).
- Satır ~335: `bankaKimligiGecerli` hesabına sağlayıcıyı ekleyin.

Ayar şifreli saklanır (`sifreliConfig`); adaptöre çözülmüş nesne olarak gelir. Gizli alanlar API yanıtlarında maskelenir; yeni gizli alan eklerseniz maskeleme listesine de ekleyin.

## 4. Test

`banka-entegrasyon.service.test.ts` içindeki sahte "ornekbanka" sağlayıcı testi şablondur: kayda sahte sağlayıcı ekleyip `senkronize` akışının (eşleme, imleç, yinelenen, bakiye farkı) sağlayıcıdan bağımsız çalıştığını gösterir. Adaptörün kendisi için `banka-saglayici.test.ts` örneğindeki gibi `fetch`'i taklit edin ve `BANKA_HTTP.bekle`'yi boş fonksiyonla değiştirin.

## Bilinen sınırlar

- Ekran (`ayarlar/banka-baglantilari`) şu an Vomsis'e özel alanlar gösterir; yeni sağlayıcı için hesap listesi ortak uçtan alınır: `GET /kasa-banka/banka-baglantilari/:id/saglayici-hesaplari`.
- Vomsis token ömrü belgelenmediği için 20 dakika önbellekte tutulur; 401'de bir kez yeni token alınıp yeniden denenir.
- MT940'ta `:86:` alanı bankadan bankaya değişir; `?NN` alt alanları ve serbest metin desteklenir, karşı taraf adı yalnız `?32/?33` varsa çıkar.
