-- EBLG-144…150: gelen alış denetçisi. Kural sonucu gelen belgeyle saklanır
-- (liste rozeti), ödeme hesapları belge kaydedilirken XML'den yazılır (EBLG-147),
-- uyarıları geçerek işlenen gelen belgenin kararı ön denetim kararlarına düşer.

ALTER TABLE gelen_ebelgeler
  ADD COLUMN denetim_bulgulari JSONB,
  ADD COLUMN denetim_uyari_sayisi INTEGER,
  ADD COLUMN denetim_at TIMESTAMP(3),
  ADD COLUMN odeme_hesaplari TEXT[];

-- Eski belgelerin ödeme hesapları (ad alanı öneki olsun olmasın), boşluksuz büyük harf.
UPDATE gelen_ebelgeler g SET odeme_hesaplari = COALESCE((
  SELECT array_agg(DISTINCT upper(regexp_replace(m[1], '\s+', '', 'g')))
  FROM regexp_matches(g.xml_icerik, 'PayeeFinancialAccount>\s*<(?:\w+:)?ID[^>]*>([^<]+)<', 'g') AS m
), ARRAY[]::TEXT[]);

ALTER TABLE on_denetim_kararlari
  ALTER COLUMN fatura_id DROP NOT NULL,
  ADD COLUMN gelen_ebelge_id UUID REFERENCES gelen_ebelgeler(id) ON DELETE CASCADE,
  ADD CONSTRAINT on_denetim_kararlari_tek_hedef CHECK ((fatura_id IS NULL) <> (gelen_ebelge_id IS NULL));
CREATE INDEX on_denetim_kararlari_tenant_id_gelen_ebelge_id_idx ON on_denetim_kararlari (tenant_id, gelen_ebelge_id);
