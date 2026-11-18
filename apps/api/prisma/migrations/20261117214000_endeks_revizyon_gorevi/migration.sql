-- END-04: sistem görevi gerçek bir platform kullanıcısı adına açılmaz.
ALTER TABLE public.platform_gorevleri ALTER COLUMN olusturan_id DROP NOT NULL;

CREATE FUNCTION public.endeks_revizyon_gorevi_ac() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  INSERT INTO public.platform_gorevleri (id, baslik, aciklama, kapsam, updated_at)
  VALUES (
    NEW.id,
    format('Endeks revizyonu · %s · %s', NEW.seri_kodu, to_char(NEW.donem, 'YYYY-MM')),
    format('EVDS dönem değerini değiştirdi: %s → %s. Önceki kaynak: %s. Revizyonu Platform > Endeks verileri ekranında inceleyin.',
           NEW.eski_deger, NEW.yeni_deger, NEW.eski_kaynak),
    'platform',
    CURRENT_TIMESTAMP
  );
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.endeks_revizyon_gorevi_ac() FROM PUBLIC;

CREATE TRIGGER endeks_revizyon_gorevi_ac
AFTER INSERT ON public.endeks_deger_revizyonlari
FOR EACH ROW WHEN (NEW.yeni_kaynak = 'evds' AND NEW.eski_deger IS DISTINCT FROM NEW.yeni_deger)
EXECUTE FUNCTION public.endeks_revizyon_gorevi_ac();
