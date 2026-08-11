# Banka Hareket Webhook'u

Yetkili banka veya açık bankacılık sağlayıcısı hareketleri şu adrese gönderir:

`POST /api/v1/banka-webhook/{tenantId}/{baglantiId}`

İstek `Authorization: Bearer {erisimAnahtari}` ve `Content-Type: application/json`
başlıklarını taşımalıdır. Tek istekte en fazla 500 hareket kabul edilir.

```json
{
  "hareketler": [
    {
      "id": "saglayici-tarafindaki-benzersiz-id",
      "tarih": "2026-08-11",
      "tutar": 1250.50,
      "aciklama": "Fatura tahsilatı ABC LTD",
      "dekontNo": "D-123",
      "karsiIban": "TR000000000000000000000000",
      "karsiUnvan": "ABC LTD",
      "bakiye": 24500.75
    }
  ]
}
```

Pozitif tutar hesaba giriş, negatif tutar hesaptan çıkıştır. `id` bağlantı
özelinde idempotency anahtarıdır; aynı hareket tekrar gönderildiğinde ikinci
kayıt oluşturulmaz. Kayıtlar doğrudan muhasebeleştirilmez: Banka Ekstresi
ekranındaki cari/fatura öneri ve kullanıcı onayı akışına girer.
