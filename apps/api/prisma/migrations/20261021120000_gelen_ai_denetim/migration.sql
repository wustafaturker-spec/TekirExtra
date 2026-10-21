-- AI-72: gelen alış faturasının yapay zekâ kontrolü belgeyle saklanır
-- ({imza: kullanılan satır eşleştirmesi, sonuc}); aynı eşleştirmeyle model yeniden çağrılmaz.
ALTER TABLE gelen_ebelgeler ADD COLUMN ai_denetim JSONB;
