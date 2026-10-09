-- MVZ aşama 5 (2026-10-09): bordro mevzuatı Mevzuat Merkezi'ne taşınır (MVZ-14).
-- Kiracıya kopyalanan setler (PRS-11) ve kiracıdaki taslak/onay adımı kalkar;
-- bordro merkezi kayda bağlanır. Onaylı bordroların saklı hesap değerleri değişmez.
-- Kiracı tabloları okunup yazıldığı için RLS'i aşan şema sahibiyle çalışır.
SET row_security = off;

-- ─── İlk dolum ───────────────────────────────────────────────────────────
-- Kaynaklar (2026-10-04 doğrulandı, önceki "resmî set" 2026-1 / 2026-2 ile aynı):
-- • Asgari ücret brüt 33.030,00 TL (Asgari Ücret Tespit Komisyonu 2026); Temmuz'da ara zam yok.
-- • SGK tavanı asgari ücretin 9 katı 297.270,00 TL; işçi %14 + işsizlik %1; işveren %21,75 + %2.
-- • Hazine prim desteği azami 5 puan (7566 s. K. m.23; imalat 5, diğer 2 — personel/dönemde girilir).
-- • GV ücret tarifesi 190.000 / 400.000 / 1.500.000 / 5.300.000 (%15–40), GVK 103, 332 s. GV GT.
-- • Damga vergisi binde 7,59; engellilik indirimi 12.000 / 7.000 / 3.000 TL.
-- • Yemek GV istisnası 300 TL/gün; SGK istisnası 16.04.2026'ya kadar 260,39 TL/gün (2022/323 YK),
--   17.04.2026'dan 300 TL/gün (7577 s. K. m.10, SGK Genelgesi 2026/12). Bordro aylık hesaplandığı
--   için Nisan 2026 eski tutarla, Mayıs'tan itibaren 300 TL ile hesaplanır.
INSERT INTO "mevzuat_kayitlari" ("id", "tur", "anahtar", "deger", "yururluk_baslangic", "yururluk_bitis") VALUES
  (gen_random_uuid(), 'bordro_parametreleri', 'genel', '{"asgariUcretBrut": 33030, "sgkTavan": 297270, "sgkIsciOrani": 14, "issizlikIsciOrani": 1, "sgkIsverenOrani": 21.75, "issizlikIsverenOrani": 2, "sgkTesvikAzamiOrani": 5, "yemekGelirVergisiGunlukIstisna": 300, "yemekSgkGunlukIstisna": 260.39, "engellilikDerece1": 12000, "engellilikDerece2": 7000, "engellilikDerece3": 3000, "damgaVergisiOrani": 0.759, "gelirVergisiDilimleri": [{"ustSinir": 190000, "oran": 15}, {"ustSinir": 400000, "oran": 20}, {"ustSinir": 1500000, "oran": 27}, {"ustSinir": 5300000, "oran": 35}, {"ustSinir": null, "oran": 40}]}'::jsonb, DATE '2026-01-01', DATE '2026-04-30'),
  (gen_random_uuid(), 'bordro_parametreleri', 'genel', '{"asgariUcretBrut": 33030, "sgkTavan": 297270, "sgkIsciOrani": 14, "issizlikIsciOrani": 1, "sgkIsverenOrani": 21.75, "issizlikIsverenOrani": 2, "sgkTesvikAzamiOrani": 5, "yemekGelirVergisiGunlukIstisna": 300, "yemekSgkGunlukIstisna": 300, "engellilikDerece1": 12000, "engellilikDerece2": 7000, "engellilikDerece3": 3000, "damgaVergisiOrani": 0.759, "gelirVergisiDilimleri": [{"ustSinir": 190000, "oran": 15}, {"ustSinir": 400000, "oran": 20}, {"ustSinir": 1500000, "oran": 27}, {"ustSinir": 5300000, "oran": 35}, {"ustSinir": null, "oran": 40}]}'::jsonb, DATE '2026-05-01', NULL);

INSERT INTO "mevzuat_olaylari" ("id", "olay", "detay") VALUES
  (gen_random_uuid(), 'ilk_dolum', '{"tur": "bordro_parametreleri", "kaynak": "2026 resmî bordro parametreleri (asgari ücret 33.030; GVK 103 tarifesi; 7577 s. K. m.10 yemek istisnası 17.04.2026)", "kayit": 2, "yururlukBaslangic": "2026-01-01"}'::jsonb);

-- ─── Bordrolar merkezi kayda bağlanır ────────────────────────────────────
ALTER TABLE "personel_bordro" ADD COLUMN "mevzuat_kayit_id" UUID;

-- Kiracı setinin değerleri dönemin merkezi kaydıyla birebir aynıysa bağlanır.
UPDATE "personel_bordro" b SET "mevzuat_kayit_id" = k.id
FROM "bordro_mevzuat_setleri" s, "mevzuat_kayitlari" k
WHERE b."mevzuat_seti_id" = s.id
  AND k.tur = 'bordro_parametreleri' AND k.anahtar = 'genel'
  AND k.yururluk_baslangic <= make_date(b.donem_yil, b.donem_ay, 1)
  AND (k.yururluk_bitis IS NULL OR k.yururluk_bitis >= make_date(b.donem_yil, b.donem_ay, 1))
  AND s.parametreler = (k.deger - 'engellilikDerece1' - 'engellilikDerece2' - 'engellilikDerece3')
      || jsonb_build_object('engellilikIndirimi', jsonb_build_object(
           'derece1', k.deger -> 'engellilikDerece1', 'derece2', k.deger -> 'engellilikDerece2', 'derece3', k.deger -> 'engellilikDerece3'));

-- Eşleşmeyen bordro varsa (kiracıya özel değerlerle hesaplanmış) göç durur: veri kaybı olmasın.
DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM "personel_bordro" WHERE "mevzuat_seti_id" IS NOT NULL AND "mevzuat_kayit_id" IS NULL;
  IF n > 0 THEN
    RAISE EXCEPTION 'MVZ-14 göçü: % bordro merkezdeki değerlerden farklı bir kiracı setiyle hesaplanmış; elle incelenmeli', n;
  END IF;
END
$$;

ALTER TABLE "personel_bordro" DROP CONSTRAINT "personel_bordro_mevzuat_seti_id_fkey";
ALTER TABLE "personel_bordro" DROP COLUMN "mevzuat_seti_id";
ALTER TABLE "personel_bordro" ADD CONSTRAINT "personel_bordro_mevzuat_kayit_id_fkey" FOREIGN KEY ("mevzuat_kayit_id") REFERENCES "mevzuat_kayitlari"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

DROP TABLE "bordro_kabul_senaryolari";
DROP TABLE "bordro_mevzuat_setleri";
DROP TYPE "BordroMevzuatDurum";

-- ─── Platform kabul senaryoları ──────────────────────────────────────────
CREATE TABLE "mevzuat_kabul_senaryolari" (
    "id" UUID NOT NULL,
    "degisiklik_id" UUID NOT NULL,
    "sira" INTEGER NOT NULL,
    "ad" TEXT NOT NULL,
    "girdiler" JSONB NOT NULL,
    "beklenen" JSONB NOT NULL,
    "tolerans" DECIMAL(8,2) NOT NULL DEFAULT 0.01,
    "son_sonuc" JSONB,
    "basarili" BOOLEAN,
    "son_calistiran_id" UUID,
    "son_calisma_zamani" TIMESTAMP(3),

    CONSTRAINT "mevzuat_kabul_senaryolari_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "mevzuat_kabul_senaryolari_degisiklik_id_sira_idx" ON "mevzuat_kabul_senaryolari"("degisiklik_id", "sira");
ALTER TABLE "mevzuat_kabul_senaryolari" ADD CONSTRAINT "mevzuat_kabul_senaryolari_degisiklik_id_fkey" FOREIGN KEY ("degisiklik_id") REFERENCES "mevzuat_degisiklikleri"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Yayınlanan değişikliğin senaryoları da değiştirilemez (MVZ-05/08).
CREATE TRIGGER mevzuat_kabul_degismez BEFORE INSERT OR UPDATE OR DELETE ON "mevzuat_kabul_senaryolari"
  FOR EACH ROW EXECUTE FUNCTION mevzuat_satir_degismez();

REVOKE ALL ON "mevzuat_kabul_senaryolari" FROM tekir_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "mevzuat_kabul_senaryolari" TO tekir_platform;

-- ─── Etki önizlemesi (MVZ-06) ────────────────────────────────────────────
-- Bordro parametresi değişikliği, dönem başı yürürlükten sonra gelen aynı yıldaki
-- onaylanmamış bordroları etkiler (yeniden hesaplamada yeni değer kullanılır).
CREATE FUNCTION mevzuat_etki_bordro(p_yururluk date)
RETURNS TABLE (taslak_bordro bigint, firma bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public SET row_security = off AS $$
  SELECT count(*), count(DISTINCT b.tenant_id)
  FROM personel_bordro b
  WHERE b.durum IN ('hesaplandi', 'onay_bekliyor', 'reddedildi')
    AND b.donem_yil = extract(year FROM p_yururluk)::int
    AND make_date(b.donem_yil, b.donem_ay, 1) >= p_yururluk;
$$;
REVOKE ALL ON FUNCTION mevzuat_etki_bordro(date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mevzuat_etki_bordro(date) TO tekir_platform;
