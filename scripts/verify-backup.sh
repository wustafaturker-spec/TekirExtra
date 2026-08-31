#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Kullanım: $0 <yedek dosyası> [yedek dosyası ...]" >&2
  exit 2
fi

for file in "$@"; do
  case "$file" in
    *.sql.gz) gzip -t "$file" ;;
    *.tar.gz) gzip -dc "$file" | tar -tf - >/dev/null ;;
    *.sql|*) test -s "$file" ;;
  esac
  echo "Yedek doğrulandı: $file"
done
