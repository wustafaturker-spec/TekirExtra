-- ILT-03: platform e-posta ayarı ve kaydı yalnız platform rolünündür; kiracı bağlantısı erişemez.
REVOKE ALL ON "platform_ileti_ayari" FROM tekir_app;
REVOKE ALL ON "platform_ileti_kayitlari" FROM tekir_app;
