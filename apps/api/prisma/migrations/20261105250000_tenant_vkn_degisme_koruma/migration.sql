CREATE FUNCTION tenants_vkn_degisme_koruma()
RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.vkn IS DISTINCT FROM OLD.vkn AND (
    current_user = session_user OR
    current_setting('app.platform_vkn_change', true) IS DISTINCT FROM NEW.id::text
  ) THEN
    RAISE EXCEPTION 'tenant_vkn_support_only';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION tenants_vkn_degisme_koruma() FROM PUBLIC;
CREATE TRIGGER tenants_vkn_degisme_koruma
BEFORE UPDATE OF vkn ON tenants
FOR EACH ROW EXECUTE FUNCTION tenants_vkn_degisme_koruma();
