-- P-10: Sürümlü ve yetkili sözleşme/şartname RAG belge ve parça tabloları

CREATE TABLE sozlesme_belgeler (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    baslik VARCHAR(200) NOT NULL,
    tur VARCHAR(50) NOT NULL DEFAULT 'sozlesme',
    cari_id UUID,
    dosya_adi VARCHAR(255) NOT NULL,
    mime_tip VARCHAR(100) NOT NULL,
    boyut INTEGER NOT NULL,
    depo_anahtari VARCHAR(255) NOT NULL,
    surum INTEGER NOT NULL DEFAULT 1,
    onceki_surum_id UUID,
    durum VARCHAR(30) NOT NULL DEFAULT 'hazir',
    ozet TEXT,
    sayfa_sayisi INTEGER NOT NULL DEFAULT 1,
    gecerlilik_bitis DATE,
    yetkili_roller JSONB,
    yukleyen_user_id UUID,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT sozlesme_belgeler_pkey PRIMARY KEY (id),
    CONSTRAINT sozlesme_belgeler_depo_anahtari_key UNIQUE (depo_anahtari),
    CONSTRAINT sozlesme_belgeler_tur_chk CHECK (tur IN ('sozlesme', 'sartname', 'protokol', 'teklif_eki', 'diger')),
    CONSTRAINT sozlesme_belgeler_durum_chk CHECK (durum IN ('isleniyor', 'hazir', 'hatali', 'arsivlendi')),
    CONSTRAINT sozlesme_belgeler_tenant_fk FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    CONSTRAINT sozlesme_belgeler_cari_fk FOREIGN KEY (cari_id) REFERENCES cari_hesaplar(id) ON DELETE SET NULL,
    CONSTRAINT sozlesme_belgeler_yukleyen_fk FOREIGN KEY (yukleyen_user_id) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT sozlesme_belgeler_onceki_surum_fk FOREIGN KEY (onceki_surum_id) REFERENCES sozlesme_belgeler(id) ON DELETE SET NULL
);

CREATE TABLE sozlesme_belge_parcalar (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    belge_id UUID NOT NULL,
    parca_no INTEGER NOT NULL,
    sayfa_no INTEGER NOT NULL,
    bolum_basligi VARCHAR(255),
    icerik TEXT NOT NULL,
    karakter_sayisi INTEGER NOT NULL,
    kelime_sayisi INTEGER NOT NULL,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT sozlesme_belge_parcalar_pkey PRIMARY KEY (id),
    CONSTRAINT sozlesme_belge_parcalar_belge_parca_key UNIQUE (belge_id, parca_no),
    CONSTRAINT sozlesme_belge_parcalar_tenant_fk FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    CONSTRAINT sozlesme_belge_parcalar_belge_fk FOREIGN KEY (belge_id) REFERENCES sozlesme_belgeler(id) ON DELETE CASCADE
);

-- İndeksler
CREATE INDEX sozlesme_belgeler_tenant_durum_idx ON sozlesme_belgeler(tenant_id, durum);
CREATE INDEX sozlesme_belgeler_tenant_cari_idx ON sozlesme_belgeler(tenant_id, cari_id);
CREATE INDEX sozlesme_belge_parcalar_tenant_belge_idx ON sozlesme_belge_parcalar(tenant_id, belge_id);
CREATE INDEX sozlesme_belge_parcalar_tenant_sayfa_idx ON sozlesme_belge_parcalar(tenant_id, sayfa_no);

-- PostgreSQL Tam Metin Arama GIN İndeksleri
CREATE INDEX sozlesme_belge_parcalar_tsv_idx ON sozlesme_belge_parcalar USING gin(to_tsvector('turkish', icerik));
CREATE INDEX sozlesme_belge_parcalar_bolum_tsv_idx ON sozlesme_belge_parcalar USING gin(to_tsvector('turkish', coalesce(bolum_basligi, '')));

-- RLS (Row-Level Security)
ALTER TABLE sozlesme_belgeler ENABLE ROW LEVEL SECURITY;
ALTER TABLE sozlesme_belge_parcalar ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_sozlesme_belgeler ON sozlesme_belgeler
    FOR ALL
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE POLICY tenant_isolation_sozlesme_belge_parcalar ON sozlesme_belge_parcalar
    FOR ALL
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
