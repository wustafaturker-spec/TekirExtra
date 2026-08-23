#!/usr/bin/env bash
set -euo pipefail

output_dir="${1:-backups}"
mkdir -p "$output_dir"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
file="$output_dir/tekirextra-minio-$stamp.tar.gz"

# MinIO imajında tar bulunmayabileceği için volume'ü küçük bir yardımcı imaja bağlar.
container="$(docker compose ps -q minio)"
volume="$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Name}}{{end}}{{end}}' "$container")"
test -n "$volume"
docker run --rm -v "$volume:/data:ro" alpine:3.20 tar -C /data -czf - . > "$file"
test -s "$file"
echo "MinIO yedeği oluşturuldu: $file"
