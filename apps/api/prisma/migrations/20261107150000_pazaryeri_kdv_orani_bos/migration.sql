-- PZR-03: pazaryeri KDV oranı göndermediyse sessizce %20 varsayılmaz; oran boş
-- kalır, faturalaştırmada satırın stok kartındaki oran kullanılır.
ALTER TABLE pazaryeri_siparis_satirlari ALTER COLUMN kdv_orani DROP DEFAULT, ALTER COLUMN kdv_orani DROP NOT NULL;
