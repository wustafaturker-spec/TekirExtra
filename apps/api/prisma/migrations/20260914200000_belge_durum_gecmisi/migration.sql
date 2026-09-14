-- Belge durum geçmişi (EBLG-35).
--
-- Fatura, e-Belge (alıcı yanıtı dahil) ve e-İrsaliye durumu her değiştiğinde
-- eski → yeni durum bir satır olarak yazılır. Kayıt tetikleyiciyle tutulur:
-- durum bugün 12 ayrı noktada değişiyor ve servis katmanında bir yolun kaydı
-- atlaması mümkündü. Yalnız gerçek değişiklik yazılır (IS DISTINCT FROM);
-- durumu değiştirmeyen periyodik sorgu satır üretmez.
--
-- Değiştiren kullanıcı, uygulamanın işlem başında kurduğu `app.user_id`
-- değişkeninden okunur (PrismaService.tenantIslem). Değer UUID değilse yok
-- sayılır: geçmiş yazımı asıl güncellemeyi hiçbir koşulda düşürmemeli.

CREATE TABLE "belge_durum_gecmisi" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "eksen" TEXT NOT NULL,
    "kayit_id" UUID NOT NULL,
    "fatura_id" UUID,
    "belge_id" UUID,
    "eski_durum" TEXT,
    "yeni_durum" TEXT NOT NULL,
    "aciklama" TEXT,
    "user_id" UUID,
    "baslangic" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "belge_durum_gecmisi_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "belge_durum_gecmisi_tenant_id_fatura_id_created_at_idx" ON "belge_durum_gecmisi"("tenant_id", "fatura_id", "created_at");
CREATE INDEX "belge_durum_gecmisi_tenant_id_belge_id_created_at_idx" ON "belge_durum_gecmisi"("tenant_id", "belge_id", "created_at");

ALTER TABLE "belge_durum_gecmisi" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "belge_durum_gecmisi" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_belge_durum_gecmisi" ON "belge_durum_gecmisi" USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid) WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);

-- Geçmiş yalnız eklenir (audit_log ve cari_hareketler ile aynı kalıp).
REVOKE UPDATE, DELETE ON TABLE "belge_durum_gecmisi" FROM tekir_app;

CREATE FUNCTION belge_durum_gecmisi_yaz() RETURNS trigger AS $$
DECLARE
  ham_kullanici text := current_setting('app.user_id', true);
  kullanici uuid := CASE WHEN ham_kullanici ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN ham_kullanici::uuid END;
  yeni_kayit boolean := TG_OP = 'INSERT';
BEGIN
  IF TG_TABLE_NAME = 'faturalar' THEN
    IF yeni_kayit OR NEW.durum IS DISTINCT FROM OLD.durum THEN
      INSERT INTO belge_durum_gecmisi (tenant_id, eksen, kayit_id, fatura_id, eski_durum, yeni_durum, aciklama, user_id)
      VALUES (NEW.tenant_id, 'fatura', NEW.id, NEW.id, CASE WHEN NOT yeni_kayit THEN OLD.durum::text END, NEW.durum::text, NEW.no, kullanici);
    END IF;
  ELSIF TG_TABLE_NAME = 'ebelge_kayitlari' THEN
    IF yeni_kayit OR NEW.durum IS DISTINCT FROM OLD.durum THEN
      INSERT INTO belge_durum_gecmisi (tenant_id, eksen, kayit_id, fatura_id, eski_durum, yeni_durum, aciklama, user_id)
      VALUES (NEW.tenant_id, 'ebelge', NEW.id, NEW.fatura_id, CASE WHEN NOT yeni_kayit THEN OLD.durum::text END, NEW.durum::text, NEW.hata_mesaji, kullanici);
    END IF;
    -- Alıcının kabul/ret kararı zarf durumundan ayrı eksendir (EBLG-13).
    IF NEW.alici_yaniti IS NOT NULL AND (yeni_kayit OR NEW.alici_yaniti IS DISTINCT FROM OLD.alici_yaniti) THEN
      INSERT INTO belge_durum_gecmisi (tenant_id, eksen, kayit_id, fatura_id, eski_durum, yeni_durum, aciklama, user_id)
      VALUES (NEW.tenant_id, 'alici_yaniti', NEW.id, NEW.fatura_id, CASE WHEN NOT yeni_kayit THEN OLD.alici_yaniti::text END, NEW.alici_yaniti::text, NEW.alici_yanit_notu, kullanici);
    END IF;
  ELSIF TG_TABLE_NAME = 'eirsaliye_kayitlari' THEN
    IF yeni_kayit OR NEW.durum IS DISTINCT FROM OLD.durum THEN
      INSERT INTO belge_durum_gecmisi (tenant_id, eksen, kayit_id, belge_id, eski_durum, yeni_durum, aciklama, user_id)
      VALUES (NEW.tenant_id, 'eirsaliye', NEW.id, NEW.belge_id, CASE WHEN NOT yeni_kayit THEN OLD.durum::text END, NEW.durum::text, NEW.hata_mesaji, kullanici);
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "faturalar_durum_gecmisi" AFTER INSERT OR UPDATE OF "durum" ON "faturalar" FOR EACH ROW EXECUTE FUNCTION belge_durum_gecmisi_yaz();
CREATE TRIGGER "ebelge_kayitlari_durum_gecmisi" AFTER INSERT OR UPDATE OF "durum", "alici_yaniti" ON "ebelge_kayitlari" FOR EACH ROW EXECUTE FUNCTION belge_durum_gecmisi_yaz();
CREATE TRIGGER "eirsaliye_kayitlari_durum_gecmisi" AFTER INSERT OR UPDATE OF "durum" ON "eirsaliye_kayitlari" FOR EACH ROW EXECUTE FUNCTION belge_durum_gecmisi_yaz();

-- Özellik öncesi kayıtlar: mevcut durumla tek başlangıç satırı. Gerçek bir
-- değişiklik değildir; `baslangic` ile işaretlenir ve eski durumu boştur.
INSERT INTO belge_durum_gecmisi (tenant_id, eksen, kayit_id, fatura_id, yeni_durum, aciklama, baslangic, created_at)
SELECT tenant_id, 'fatura', id, id, durum::text, no, true, updated_at FROM faturalar;

INSERT INTO belge_durum_gecmisi (tenant_id, eksen, kayit_id, fatura_id, yeni_durum, aciklama, baslangic, created_at)
SELECT tenant_id, 'ebelge', id, fatura_id, durum::text, hata_mesaji, true, updated_at FROM ebelge_kayitlari;

INSERT INTO belge_durum_gecmisi (tenant_id, eksen, kayit_id, fatura_id, yeni_durum, aciklama, baslangic, created_at)
SELECT tenant_id, 'alici_yaniti', id, fatura_id, alici_yaniti::text, alici_yanit_notu, true, coalesce(alici_yanit_zamani, updated_at)
FROM ebelge_kayitlari WHERE alici_yaniti IS NOT NULL;

INSERT INTO belge_durum_gecmisi (tenant_id, eksen, kayit_id, belge_id, yeni_durum, aciklama, baslangic, created_at)
SELECT tenant_id, 'eirsaliye', id, belge_id, durum::text, hata_mesaji, true, updated_at FROM eirsaliye_kayitlari;
