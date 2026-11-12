-- CNL-09/10 (aşama C): asistanın tahmin yürütmek yerine sorduğu sorular. Soru firma kapsamlıdır,
-- hedefi bir kişi ya da roller olur; yanıt hafızaya yazılır, kesin işlem onay talebiyle yapılır.
CREATE TABLE "asistan_sorulari" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "tur" VARCHAR(20) NOT NULL,
    "kaynak_id" UUID NOT NULL,
    "user_id" UUID,
    "roller" "Rol"[] NOT NULL DEFAULT ARRAY[]::"Rol"[],
    "soru" TEXT NOT NULL,
    "secenekler" JSONB NOT NULL,
    "serbest_yanit" BOOLEAN NOT NULL DEFAULT false,
    "veri" JSONB NOT NULL DEFAULT '{}',
    "durum" VARCHAR(12) NOT NULL DEFAULT 'acik',
    "yanit" JSONB,
    "yanitlayan_user_id" UUID,
    "yanit_kanali" VARCHAR(10),
    "sonuc" TEXT,
    "yanit_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "asistan_sorulari_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "asistan_sorulari_tur_check" CHECK ("tur" IN ('banka_satiri', 'eposta_gonderen', 'taslak_kosul')),
    CONSTRAINT "asistan_sorulari_durum_check" CHECK ("durum" IN ('acik', 'yanitlandi', 'gecersiz'))
);
-- CNL-10: aynı kayıt için soru bir kez sorulur.
CREATE UNIQUE INDEX "asistan_sorulari_tenant_id_tur_kaynak_id_key" ON "asistan_sorulari"("tenant_id", "tur", "kaynak_id");
CREATE INDEX "asistan_sorulari_tenant_id_durum_idx" ON "asistan_sorulari"("tenant_id", "durum");
ALTER TABLE "asistan_sorulari" ADD CONSTRAINT "asistan_sorulari_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "asistan_sorulari" ADD CONSTRAINT "asistan_sorulari_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "asistan_sorulari" ADD CONSTRAINT "asistan_sorulari_yanitlayan_user_id_fkey" FOREIGN KEY ("yanitlayan_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "asistan_sorulari" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "asistan_sorulari" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_asistan_sorulari ON "asistan_sorulari" USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid) WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
CREATE TRIGGER kbag_asistan_sorulari_user_id_fkey AFTER INSERT OR UPDATE OF user_id, tenant_id ON "asistan_sorulari"
  FOR EACH ROW WHEN (NEW.user_id IS NOT NULL) EXECUTE FUNCTION kiraci_bag_denetle('user_id', 'users', 'id');
CREATE TRIGGER kbag_asistan_sorulari_yanitlayan_user_id_fkey AFTER INSERT OR UPDATE OF yanitlayan_user_id, tenant_id ON "asistan_sorulari"
  FOR EACH ROW WHEN (NEW.yanitlayan_user_id IS NOT NULL) EXECUTE FUNCTION kiraci_bag_denetle('yanitlayan_user_id', 'users', 'id');

-- Telegram'a giden her soru mesajı; yanıt panelden gelse de düğmeler bu kayıtla kaldırılır.
CREATE TABLE "asistan_soru_gonderimleri" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "soru_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "sohbet_id" BIGINT NOT NULL,
    "telegram_mesaj_id" BIGINT NOT NULL,
    "klavye_kaldirildi_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "asistan_soru_gonderimleri_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "asistan_soru_gonderimleri_soru_id_user_id_key" ON "asistan_soru_gonderimleri"("soru_id", "user_id");
CREATE INDEX "asistan_soru_gonderimleri_tenant_id_user_id_idx" ON "asistan_soru_gonderimleri"("tenant_id", "user_id");
ALTER TABLE "asistan_soru_gonderimleri" ADD CONSTRAINT "asistan_soru_gonderimleri_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "asistan_soru_gonderimleri" ADD CONSTRAINT "asistan_soru_gonderimleri_soru_id_fkey" FOREIGN KEY ("soru_id") REFERENCES "asistan_sorulari"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "asistan_soru_gonderimleri" ADD CONSTRAINT "asistan_soru_gonderimleri_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "asistan_soru_gonderimleri" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "asistan_soru_gonderimleri" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_asistan_soru_gonderimleri ON "asistan_soru_gonderimleri" USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid) WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
CREATE TRIGGER kbag_asistan_soru_gonderimleri_soru_id_fkey AFTER INSERT OR UPDATE OF soru_id, tenant_id ON "asistan_soru_gonderimleri"
  FOR EACH ROW WHEN (NEW.soru_id IS NOT NULL) EXECUTE FUNCTION kiraci_bag_denetle('soru_id', 'asistan_sorulari', 'id');
CREATE TRIGGER kbag_asistan_soru_gonderimleri_user_id_fkey AFTER INSERT OR UPDATE OF user_id, tenant_id ON "asistan_soru_gonderimleri"
  FOR EACH ROW WHEN (NEW.user_id IS NOT NULL) EXECUTE FUNCTION kiraci_bag_denetle('user_id', 'users', 'id');
