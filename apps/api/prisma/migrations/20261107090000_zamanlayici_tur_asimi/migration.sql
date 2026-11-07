-- BLD-12: zamanlayıcı tur aşımı. İş kendi aralığını yazar; önceki tur sürerken
-- gelen tetik "atlandı" sayılır ve süreyi ezmez; art arda uzun tur sayılır.
ALTER TABLE sistem_isleri
  ADD COLUMN aralik_ms INTEGER,
  ADD COLUMN ardisik_uzun INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN son_atlama_at TIMESTAMP(3),
  ADD COLUMN atlama_pencere_at TIMESTAMP(3),
  ADD COLUMN pencere_atlama INTEGER NOT NULL DEFAULT 0;
