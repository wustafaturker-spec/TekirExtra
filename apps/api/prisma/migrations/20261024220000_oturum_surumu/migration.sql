-- Yönetim P1-2: erişim token'ı kullanıcının oturum sürümünü taşır; parola ya da
-- 2FA değişince sürüm artar ve eski token'lar en geç önbellek süresinde düşer.
ALTER TABLE "users" ADD COLUMN "oturum_surumu" INTEGER NOT NULL DEFAULT 0;
