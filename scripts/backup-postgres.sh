#!/usr/bin/env bash
set -euo pipefail

output_dir="${1:-backups}"
mkdir -p "$output_dir"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
file="$output_dir/tekirextra-$stamp.sql.gz"

docker compose exec -T postgres pg_dump -U tekir -d tekirextra --no-owner --no-privileges | gzip > "$file"
echo "PostgreSQL yedeği oluşturuldu: $file"
