#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Kullanım: $0 <yedek dosyası> [yedek dosyası ...]" >&2
  exit 2
fi

for file in "$@"; do
  case "$file" in
    *.sql.gz|*.tar.gz) gzip -t "$file" ;;
    *.sql|*) test -s "$file" ;;
  esac
  echo "Yedek doğrulandı: $file"
done
