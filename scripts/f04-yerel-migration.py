"""Yalnız üç F04 migration'ını transaction içinde, geçmişi koruyarak uygular."""
import hashlib
import pathlib
import subprocess
import sys
import uuid

container, source = sys.argv[1:]
names = ["20261022120000_siparis_giris_tarihi", "20261022160000_ihtiyac_uretim_ve_plan", "20261022190000_ihtiyac_satin_alma_bagi"]
parts = ["BEGIN; SET LOCAL lock_timeout='10s'; SET LOCAL statement_timeout='60s'; SELECT pg_advisory_xact_lock(64042026);"]
for name in names:
    data = (pathlib.Path(source) / "apps/api/prisma/migrations" / name / "migration.sql").read_bytes()
    checksum = hashlib.sha256(data).hexdigest()
    # Prova ve canlı aynı dosyaları kullanır. Kısmen uygulanmış/geçmişte bulunan
    # migration sessizce atlanmaz; operatöre hata döner.
    parts += [f"DO $$ BEGIN IF EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name='{name}') THEN RAISE EXCEPTION 'F04 migration zaten kayıtlı'; END IF; END $$;", data.decode(), f"INSERT INTO _prisma_migrations(id,checksum,finished_at,migration_name,started_at,applied_steps_count) VALUES ('{uuid.uuid4()}','{checksum}',now(),'{name}',now(),1);"]
parts += ["COMMIT;"]
p = subprocess.run(["docker", "exec", "-i", container, "psql", "-U", "tekir", "-d", "tekirextra", "-v", "ON_ERROR_STOP=1"], input="\n".join(parts), text=True, capture_output=True)
if p.returncode:
    print(p.stderr, file=sys.stderr)
    sys.exit(p.returncode)
print("F04: üç migration transaction içinde uygulandı; mevcut geçmiş değiştirilmedi.")
