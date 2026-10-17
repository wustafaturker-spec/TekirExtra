#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Kullanım: $0 <sql veya sql.gz dosyası>" >&2
  exit 2
fi

file="$1"
case "$file" in
  *.gz) gzip -dc "$file" ;;
  *) cat "$file" ;;
esac | docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U tekir -d tekirextra
echo "PostgreSQL geri yükleme tamamlandı: $file"
