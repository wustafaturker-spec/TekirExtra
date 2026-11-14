-- END-01…04, 26, 27: fiyat ve endeks analizi.
-- Yalnız ekleyicidir: yeni tablolar, boş bırakılabilir sütun ve tetikleyiciler.
-- Eski uygulama sürümü bu göçten sonra da çalışır (pilot aynı veritabanını kullanır).

-- ─── Ortak endeks deposu (kiracı verisi yok, RLS'siz) ─────────────────────
CREATE TABLE "endeks_serileri" (
    "kod" VARCHAR(40) NOT NULL,
    "evds_kodu" VARCHAR(80) NOT NULL,
    "ad" VARCHAR(160) NOT NULL,
    "siklik" VARCHAR(10) NOT NULL DEFAULT 'aylik',
    "baz_yili" VARCHAR(20),
    "kaynak" VARCHAR(60) NOT NULL DEFAULT 'TÜİK',
    "etkin" BOOLEAN NOT NULL DEFAULT true,
    "sira" INTEGER NOT NULL DEFAULT 100,
    "onceki_seri_kodu" VARCHAR(40),
    "zincir_katsayisi" DECIMAL(24,12),
    "zincir_donemi" DATE,
    "son_cekim_at" TIMESTAMP(3),
    "son_basarili_at" TIMESTAMP(3),
    "son_donem" DATE,
    "son_hata" VARCHAR(500),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "endeks_serileri_pkey" PRIMARY KEY ("kod"),
    CONSTRAINT "endeks_serileri_kod_bicimi" CHECK ("kod" ~ '^[A-Z][A-Z0-9_]{1,39}$'),
    CONSTRAINT "endeks_serileri_siklik" CHECK ("siklik" IN ('aylik')),
    CONSTRAINT "endeks_serileri_zincir_kendisi_degil" CHECK ("onceki_seri_kodu" IS NULL OR "onceki_seri_kodu" <> "kod")
);
CREATE UNIQUE INDEX "endeks_serileri_evds_kodu_key" ON "endeks_serileri"("evds_kodu");

CREATE TABLE "endeks_degerleri" (
    "seri_kodu" VARCHAR(40) NOT NULL,
    "donem" DATE NOT NULL,
    "deger" DECIMAL(20,6) NOT NULL,
    "kaynak" VARCHAR(10) NOT NULL DEFAULT 'evds',
    "alindi_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "endeks_degerleri_pkey" PRIMARY KEY ("seri_kodu", "donem"),
    CONSTRAINT "endeks_degerleri_ay_basi" CHECK (EXTRACT(DAY FROM "donem") = 1),
    CONSTRAINT "endeks_degerleri_pozitif" CHECK ("deger" > 0),
    CONSTRAINT "endeks_degerleri_kaynak" CHECK ("kaynak" IN ('evds', 'elle'))
);
ALTER TABLE "endeks_degerleri" ADD CONSTRAINT "endeks_degerleri_seri_kodu_fkey" FOREIGN KEY ("seri_kodu") REFERENCES "endeks_serileri"("kod") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "endeks_deger_revizyonlari" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "seri_kodu" VARCHAR(40) NOT NULL,
    "donem" DATE NOT NULL,
    "eski_deger" DECIMAL(20,6) NOT NULL,
    "yeni_deger" DECIMAL(20,6) NOT NULL,
    "eski_kaynak" VARCHAR(10) NOT NULL,
    "yeni_kaynak" VARCHAR(10) NOT NULL,
    "degisti_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "endeks_deger_revizyonlari_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "endeks_deger_revizyonlari_seri_kodu_donem_idx" ON "endeks_deger_revizyonlari"("seri_kodu", "donem");

-- Katalogu platform yazar; uygulama (worker çekimi) değer ve çekim durumunu yazar.
-- Varsayılan yetkiler (RLS göçü) tekir_app'e tam yetki verdiği için önce geri alınır (AI-52 dersi).
REVOKE ALL ON "endeks_serileri", "endeks_degerleri", "endeks_deger_revizyonlari" FROM PUBLIC, tekir_app;
GRANT SELECT ON "endeks_serileri", "endeks_degerleri", "endeks_deger_revizyonlari" TO tekir_app;
GRANT UPDATE ("son_cekim_at", "son_basarili_at", "son_donem", "son_hata", "zincir_katsayisi", "zincir_donemi", "updated_at") ON "endeks_serileri" TO tekir_app;
GRANT INSERT, UPDATE ON "endeks_degerleri" TO tekir_app;
GRANT INSERT ON "endeks_deger_revizyonlari" TO tekir_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "endeks_serileri", "endeks_degerleri", "endeks_deger_revizyonlari" TO tekir_platform;

-- İlk seri kümesi (kullanıcı kararı 2026-11-14). EVDS kodları 2026-11-14'te EVDS'den doğrulandı.
INSERT INTO "endeks_serileri" ("kod", "evds_kodu", "ad", "baz_yili", "kaynak", "sira", "updated_at") VALUES
  ('TUFE', 'TP.TUKFIY2025.GENEL', 'TÜFE (Tüketici Fiyat Endeksi, genel)', '2025=100', 'TÜİK', 10, CURRENT_TIMESTAMP),
  ('YIUFE', 'TP.TUFE1YI.T1', 'Yİ-ÜFE (Yurt İçi Üretici Fiyat Endeksi)', '2003=100', 'TÜİK', 20, CURRENT_TIMESTAMP);

-- ─── END-27: faturada fiyat listesi izi ──────────────────────────────────
ALTER TABLE "faturalar" ADD COLUMN "fiyat_listesi_id" UUID;
ALTER TABLE "faturalar" ADD CONSTRAINT "faturalar_fiyat_listesi_id_fkey" FOREIGN KEY ("fiyat_listesi_id") REFERENCES "fiyat_listeleri"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- SEC-17: liste aynı kiracıda olmalı.
CREATE TRIGGER kbag_faturalar_fiyat_listesi_id_fkey AFTER INSERT OR UPDATE OF fiyat_listesi_id, tenant_id ON "faturalar"
  FOR EACH ROW WHEN (NEW.fiyat_listesi_id IS NOT NULL) EXECUTE FUNCTION kiraci_bag_denetle('fiyat_listesi_id', 'fiyat_listeleri', 'id');

-- Fatura kesinleşirken (her yoldan: ekran, onay akışı, asistan, içe aktarma) carinin o anki listesi yazılır.
-- Taslağa geri alınıp yeniden kesinleşen faturada o anki liste yeniden yazılır. Eski faturalar doldurulmaz.
CREATE OR REPLACE FUNCTION fatura_fiyat_listesi_izi() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.durum = 'kesin' AND (TG_OP = 'INSERT' OR OLD.durum IS DISTINCT FROM NEW.durum) THEN
    SELECT c.fiyat_listesi_id INTO NEW.fiyat_listesi_id
    FROM cari_hesaplar c WHERE c.id = NEW.cari_id AND c.tenant_id = NEW.tenant_id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER fatura_fiyat_listesi_izi BEFORE INSERT OR UPDATE OF durum ON "faturalar"
  FOR EACH ROW EXECUTE FUNCTION fatura_fiyat_listesi_izi();

-- ─── END-27: fiyat listesi fiyat geçmişi (kiracı verisi, RLS'li) ────────
CREATE TABLE "fiyat_listesi_fiyat_gecmisi" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "liste_id" UUID NOT NULL,
    "stok_id" UUID NOT NULL,
    "eski_fiyat" DECIMAL(15,4),
    "yeni_fiyat" DECIMAL(15,4) NOT NULL,
    "degisti_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "fiyat_listesi_fiyat_gecmisi_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "fiyat_listesi_fiyat_gecmisi_tenant_id_liste_id_stok_id_degi_idx" ON "fiyat_listesi_fiyat_gecmisi"("tenant_id", "liste_id", "stok_id", "degisti_at");
ALTER TABLE "fiyat_listesi_fiyat_gecmisi" ADD CONSTRAINT "fiyat_listesi_fiyat_gecmisi_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "fiyat_listesi_fiyat_gecmisi" ADD CONSTRAINT "fiyat_listesi_fiyat_gecmisi_liste_id_fkey" FOREIGN KEY ("liste_id") REFERENCES "fiyat_listeleri"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "fiyat_listesi_fiyat_gecmisi" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "fiyat_listesi_fiyat_gecmisi" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_fiyat_listesi_fiyat_gecmisi ON "fiyat_listesi_fiyat_gecmisi"
  USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
CREATE TRIGGER kbag_fiyat_listesi_fiyat_gecmisi_liste_id_fkey AFTER INSERT OR UPDATE OF liste_id, tenant_id ON "fiyat_listesi_fiyat_gecmisi"
  FOR EACH ROW EXECUTE FUNCTION kiraci_bag_denetle('liste_id', 'fiyat_listeleri', 'id');
-- Geçmiş yalnız tetikleyiciyle yazılır; uygulama okur.
REVOKE ALL ON "fiyat_listesi_fiyat_gecmisi" FROM PUBLIC, tekir_app;
GRANT SELECT, INSERT ON "fiyat_listesi_fiyat_gecmisi" TO tekir_app;

CREATE OR REPLACE FUNCTION fiyat_listesi_fiyat_izi() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO fiyat_listesi_fiyat_gecmisi (tenant_id, liste_id, stok_id, eski_fiyat, yeni_fiyat)
    VALUES (NEW.tenant_id, NEW.liste_id, NEW.stok_id, NULL, NEW.fiyat);
  ELSIF NEW.fiyat IS DISTINCT FROM OLD.fiyat THEN
    INSERT INTO fiyat_listesi_fiyat_gecmisi (tenant_id, liste_id, stok_id, eski_fiyat, yeni_fiyat)
    VALUES (NEW.tenant_id, NEW.liste_id, NEW.stok_id, OLD.fiyat, NEW.fiyat);
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER fiyat_listesi_fiyat_izi AFTER INSERT OR UPDATE OF fiyat ON "fiyat_listesi_kalemleri"
  FOR EACH ROW EXECUTE FUNCTION fiyat_listesi_fiyat_izi();
