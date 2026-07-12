-- Geliştirme ortamı ilk kurulum betiği (yalnızca boş volume'de bir kez çalışır).
-- Üretimde tekir_app parolası mutlaka güçlü bir değerle değiştirilmelidir.

-- Uygulamanın RLS'e tabi bağlantı rolü (BYPASSRLS YOK, tablo sahibi DEĞİL)
CREATE ROLE tekir_app LOGIN PASSWORD 'tekir_app_dev';

-- Metabase kendi meta-verisi için ayrı veritabanı kullanır
CREATE DATABASE metabase OWNER tekir;
