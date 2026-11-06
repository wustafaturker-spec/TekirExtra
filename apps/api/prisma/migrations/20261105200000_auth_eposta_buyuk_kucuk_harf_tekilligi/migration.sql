-- E-posta uygulamada normalize edilse de veritabanı yarış koşullarında
-- büyük/küçük harf ve çevresindeki boşlukları yok sayarak tekilliği korur.
CREATE UNIQUE INDEX "auth_kimlikler_eposta_normalize_key"
ON "auth_kimlikler" (lower(btrim("eposta")));
