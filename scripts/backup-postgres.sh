#!/usr/bin/env bash
set -euo pipefail

output_dir="${1:-backups}"
mkdir -p "$output_dir"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
file="$output_dir/tekirextra-$stamp.sql.gz"

# Uygulama/platform rollerinin GRANT kayıtları yedekte kalmalı; migration
# geçmişi geri yüklendiğinde eski migration'lar bu yetkileri tekrar kurmaz.
docker compose exec -T postgres pg_dump -U tekir -d tekirextra --no-owner | gzip > "$file"
echo "PostgreSQL yedeği oluşturuldu: $file"
