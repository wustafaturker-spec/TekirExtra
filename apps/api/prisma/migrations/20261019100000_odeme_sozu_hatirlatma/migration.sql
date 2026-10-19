CREATE UNIQUE INDEX odeme_sozleri_tenant_id_id_key ON odeme_sozleri(tenant_id,id);
CREATE TABLE odeme_sozu_hatirlatmalari (
 tenant_id UUID NOT NULL,
 soz_id UUID NOT NULL,
 durum TEXT NOT NULL DEFAULT 'gonderiliyor' CHECK (durum IN ('gonderiliyor','gonderildi','basarisiz','belirsiz')),
 deneme INTEGER NOT NULL DEFAULT 1 CHECK (deneme BETWEEN 1 AND 3),
 alici VARCHAR(255) NOT NULL,
 konu VARCHAR(255) NOT NULL,
 message_id VARCHAR(255),
 hata_mesaji VARCHAR(1000),
 baslangic_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 gonderildi_at TIMESTAMP(3),
 sonraki_deneme_at TIMESTAMP(3),
 PRIMARY KEY (tenant_id,soz_id),
 FOREIGN KEY (tenant_id,soz_id) REFERENCES odeme_sozleri(tenant_id,id) ON DELETE RESTRICT ON UPDATE CASCADE
);
ALTER TABLE odeme_sozu_hatirlatmalari ENABLE ROW LEVEL SECURITY;
ALTER TABLE odeme_sozu_hatirlatmalari FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON odeme_sozu_hatirlatmalari
 USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
 WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE ON odeme_sozu_hatirlatmalari TO tekir_app;
REVOKE DELETE ON odeme_sozu_hatirlatmalari FROM tekir_app;
