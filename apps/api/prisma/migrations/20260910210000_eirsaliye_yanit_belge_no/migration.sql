-- Yanıt belgesinin numarasını sağlayıcı atar (EBLG-24); dönen numara kayda
-- yazılır ki kullanıcı hangi yanıt belgesinin düzenlendiğini görebilsin.
ALTER TABLE "gelen_eirsaliyeler" ADD COLUMN "yanit_belge_no" TEXT;
