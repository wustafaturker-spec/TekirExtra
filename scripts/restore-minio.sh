#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Kullanım: $0 <tar.gz dosyası>" >&2
  exit 2
fi

file="$1"
container="$(docker compose ps -q minio)"
volume="$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Name}}{{end}}{{end}}' "$container")"
test -n "$volume"
case "$file" in
  *.gz) gzip -dc "$file" | docker run --rm -i -v "$volume:/data" alpine:3.20 tar -C /data -xf - ;;
  *) echo "MinIO yedeği .gz olmalıdır" >&2; exit 2 ;;
esac
echo "MinIO geri yükleme tamamlandı: $file"
