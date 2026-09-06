-- Entegratör çağrı disiplini (EBLG-10…EBLG-15).
--
-- Sovos'un "Doğru Kullanım Tavsiyeleri" kılavuzu çağrı sayısına üst limit
-- koymuyor ama hatalı kullanım kalıplarında erişimin otomatik bloklandığını
-- yazıyor. Bu göç, o kalıplardan çıkmak için gereken kalıcı durumu ekler:
-- mükellef listesi lokale iner, gelen belge çekimi kursörle ilerler, zarf
-- durumu tekrar tekrar sorgulanmaz ve alıcının yanıtı ayrı eksende tutulur.

CREATE TYPE "AliciYanit" AS ENUM ('kabul', 'ret');
-- e-Arşiv'in GİB kaydı yoktur; bu küme EbelgeTur'dan bilerek ayrıdır.
CREATE TYPE "GibBelgeTuru" AS ENUM ('efatura', 'eirsaliye');

-- GİB mükellef listesi kamuya açıktır ve her kiracı için aynıdır; kiracı
-- başına kopyalamak aynı veriyi N kez saklamak olurdu. Bu yüzden tablo
-- bilinçli olarak globaldir ve RLS uygulanmaz.
CREATE TABLE "gib_mukellefler" (
  "vkn_tckn" TEXT NOT NULL,
  "belge_turu" "GibBelgeTuru" NOT NULL,
  "posta_kutusu" TEXT NOT NULL,
  "unvan" TEXT,
  "guncellendi" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "gib_mukellefler_pkey" PRIMARY KEY ("vkn_tckn", "belge_turu", "posta_kutusu")
);
CREATE INDEX "gib_mukellefler_vkn_tckn_belge_turu_idx" ON "gib_mukellefler"("vkn_tckn", "belge_turu");

CREATE TABLE "gib_mukellef_senkron" (
  "id" TEXT NOT NULL,
  "son_senkron_at" TIMESTAMP(3),
  "kayit_sayisi" INTEGER NOT NULL DEFAULT 0,
  "durum" TEXT NOT NULL DEFAULT 'beklemede',
  "hata_mesaji" TEXT,
  "saglayici" TEXT,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "gib_mukellef_senkron_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ebelge_gelen_kursor" (
  "tenant_id" UUID NOT NULL,
  "son_cekim_at" TIMESTAMP(3) NOT NULL,
  "son_tetikleme_at" TIMESTAMP(3),
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ebelge_gelen_kursor_pkey" PRIMARY KEY ("tenant_id")
);

ALTER TABLE "ebelge_gelen_kursor" ADD CONSTRAINT "ebelge_gelen_kursor_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ebelge_gelen_kursor" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ebelge_gelen_kursor" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_ebelge_gelen_kursor" ON "ebelge_gelen_kursor" USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid) WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE "ebelge_kayitlari" ADD COLUMN "son_durum_sorgu_at" TIMESTAMP(3);
ALTER TABLE "ebelge_kayitlari" ADD COLUMN "alici_yaniti" "AliciYanit";
ALTER TABLE "ebelge_kayitlari" ADD COLUMN "alici_yanit_zamani" TIMESTAMP(3);
ALTER TABLE "ebelge_kayitlari" ADD COLUMN "alici_yanit_notu" TEXT;
ALTER TABLE "ebelge_kayitlari" ADD COLUMN "alici_yanit_ref" TEXT;

CREATE INDEX "ebelge_kayitlari_tenant_id_durum_son_durum_sorgu_at_idx" ON "ebelge_kayitlari"("tenant_id", "durum", "son_durum_sorgu_at");
