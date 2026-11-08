#!/bin/sh
# PLT-109…116: yedek servisi. postgres:16-alpine içinde çalışır (pg_dump, pg_restore, psql hazır).
# API yalnız `platform_yedekler` tablosuna talep yazar; bu servis talebi alır, yedeği üretir ve doğrular.
# Gerekli: DATABASE_URL_MIGRATE (süper kullanıcı), /yedekler (yazılabilir), /minio (salt okunur).
set -u
umask 077

: "${DATABASE_URL_MIGRATE:?DATABASE_URL_MIGRATE gerekli}"
DB_URL=${DATABASE_URL_MIGRATE%%\?*}
TABAN_URL=${DB_URL%/*}
YEDEK_DIZIN=${YEDEK_DIZIN:-/yedekler}
MINIO_DIZIN=${MINIO_DIZIN:-/minio}
ARALIK=${YEDEK_ARALIK_SN:-20}
SAHIP=${YEDEK_SAHIP:-}
SURUM=${YEDEK_SURUM:-bilinmiyor}
KRITIK="tenants users cari_hesaplar faturalar ebelge_kayitlari gelen_ebelgeler kasa_banka_hareketleri audit_log"
DENEME_ONEK=tekirextra_yedekdeneme_
KLASOR_DESENI='^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{8}$'

gunluk() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
sql() { psql "$DB_URL" -X -q -A -t -v ON_ERROR_STOP=1 "$@"; }
yonetim_sql() { psql "$TABAN_URL/postgres" -X -q -A -t -v ON_ERROR_STOP=1 "$@"; }

nabiz() {
  set -- $(df -Pk "$YEDEK_DIZIN" | awk 'NR==2 {printf "%.0f %.0f", $2*1024, $4*1024}')
  sql -v toplam="$1" -v bos="$2" -v surum="$SURUM" <<'SQL' >/dev/null || gunluk "nabız yazılamadı"
INSERT INTO platform_yedek_ajan (id, son_nabiz_at, disk_toplam_bayt, disk_bos_bayt, surum)
VALUES (1, now() AT TIME ZONE 'UTC', :toplam, :bos, :'surum')
ON CONFLICT (id) DO UPDATE SET son_nabiz_at = EXCLUDED.son_nabiz_at, disk_toplam_bayt = EXCLUDED.disk_toplam_bayt, disk_bos_bayt = EXCLUDED.disk_bos_bayt, surum = EXCLUDED.surum;
SQL
}

bos_bayt() { df -Pk "$YEDEK_DIZIN" | awk 'NR==2 {printf "%.0f", $4*1024}'; }

# Servis yeniden başladıysa yarım kalan iş sonuçlanamaz; kayıt açıkça başarısız olur.
acilis_temizligi() {
  sql <<'SQL'
UPDATE platform_yedekler SET durum = 'hatali', bitis_at = now() AT TIME ZONE 'UTC', hata = 'Yedek servisi iş sürerken yeniden başladı' WHERE durum = 'calisiyor';
UPDATE platform_yedekler SET deneme_durum = 'hatali', deneme_at = now() AT TIME ZONE 'UTC', deneme_detay = 'Yedek servisi deneme sürerken yeniden başladı' WHERE deneme_durum = 'calisiyor';
SQL
  rm -rf "${YEDEK_DIZIN:?}"/*.parca
  for g in $(yonetim_sql -c "SELECT datname FROM pg_database WHERE datname LIKE '${DENEME_ONEK}%'"); do
    yonetim_sql -c "DROP DATABASE IF EXISTS $g WITH (FORCE)"
  done
}

sayim() {
  for t in $KRITIK; do
    printf '%s %s\n' "$t" "$(sql -c "SELECT count(*) FROM $t")" || return 1
  done
}

HATA=""
LOG=""
adim() {
  ad=$1; shift
  "$@" 2>>"$LOG" || { HATA="$ad başarısız: $(tail -c 400 "$LOG")"; return 1; }
}

yedek_basarisiz() {
  gunluk "yedek başarısız: $2"
  sql -v id="$1" -v hata="$2" <<'SQL'
UPDATE platform_yedekler SET durum = 'hatali', bitis_at = now() AT TIME ZONE 'UTC', hata = :'hata' WHERE id = :'id'::uuid;
SQL
  rm -rf "${3:?}"
}

yedek_uret() {
  id=$1; klasor=$2; dizin=$3
  once=$(sayim 2>>"$LOG") || { HATA="Satır sayımı başarısız: $(tail -c 400 "$LOG")"; return 1; }
  adim "Veritabanı yedeği" nice -n 15 pg_dump -d "$DB_URL" -Fc -Z 6 --no-owner -f "$dizin/veritabani.dump" || return 1
  adim "Rol yedeği" pg_dumpall -d "$DB_URL" --globals-only -f "$dizin/roller.sql" || return 1
  adim "Dosya yedeği" nice -n 15 tar -C "$MINIO_DIZIN" -czf "$dizin/dosyalar.tar.gz" . || return 1
  sonra=$(sayim 2>>"$LOG") || { HATA="Satır sayımı başarısız: $(tail -c 400 "$LOG")"; return 1; }

  # Doğrulama: arşivler açılabiliyor ve içerik listesi çıkıyor.
  liste=$(pg_restore -l "$dizin/veritabani.dump" 2>>"$LOG") || { HATA="Veritabanı arşivi okunamadı: $(tail -c 400 "$LOG")"; return 1; }
  tablo=$(printf '%s\n' "$liste" | grep -c ' TABLE public ')
  [ "$tablo" -gt 0 ] || { HATA="Veritabanı arşivinde tablo yok"; return 1; }
  adim "Dosya arşivi denetimi" gzip -t "$dizin/dosyalar.tar.gz" || return 1
  dosya=$(tar -tzf "$dizin/dosyalar.tar.gz" 2>>"$LOG" | wc -l) || { HATA="Dosya arşivi okunamadı"; return 1; }
  migration=$(sql -c "SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY migration_name DESC LIMIT 1")

  {
    printf 'TABLO %s\nDOSYA %s\n' "$tablo" "$dosya"
    printf '%s\n' "$once" | while read -r t n; do
      m=$(printf '%s\n' "$sonra" | awk -v t="$t" '$1==t {print $2}')
      printf 'SAYIM %s %s %s\n' "$t" "$n" "$m"
    done
  } >"$dizin/dogrulama.txt"

  zaman=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  sayimlar=$(awk '$1=="SAYIM" {printf "%s\"%s\":[%s,%s]", (c++ ? "," : ""), $2, $3, $4}' "$dizin/dogrulama.txt")
  KUNYE=$(printf '{"zaman":"%s","klasor":"%s","surum":"%s","sonMigration":"%s","tabloSayisi":%s,"dosyaSayisi":%s,"sayimlar":{%s}}' "$zaman" "$klasor" "$SURUM" "$migration" "$tablo" "$dosya" "$sayimlar")
  printf '%s\n' "$KUNYE" >"$dizin/kunye.json"

  (cd "$dizin" && sha256sum veritabani.dump roller.sql dosyalar.tar.gz dogrulama.txt kunye.json >SHA256SUMS) 2>>"$LOG" || { HATA="Özet üretilemedi"; return 1; }
  (cd "$dizin" && sha256sum -c -s SHA256SUMS) 2>>"$LOG" || { HATA="Özet doğrulanamadı"; return 1; }
  OZET=$(sha256sum "$dizin/SHA256SUMS" | cut -d' ' -f1)
  MIGRATION=$migration
}

yedek_al() {
  kayit=$(sql <<'SQL'
UPDATE platform_yedekler SET durum = 'calisiyor', baslangic_at = now() AT TIME ZONE 'UTC'
WHERE id = (SELECT id FROM platform_yedekler WHERE durum = 'bekliyor' ORDER BY talep_at LIMIT 1 FOR UPDATE SKIP LOCKED)
RETURNING id;
SQL
  ) || return 0
  [ -n "$kayit" ] || return 1
  id=$kayit
  klasor="$(date -u +%Y%m%dT%H%M%SZ)-$(printf '%s' "$id" | cut -c1-8)"
  dizin="${YEDEK_DIZIN:?}/$klasor.parca"
  gunluk "yedek başladı: $id $klasor"

  son=$(sql -c "SELECT coalesce((SELECT boyut_bayt FROM platform_yedekler WHERE durum = 'basarili' ORDER BY bitis_at DESC LIMIT 1), 0)")
  bos=$(bos_bayt)
  if [ "$bos" -lt $((son * 2)) ]; then
    yedek_basarisiz "$id" "Yetersiz disk: boş alan son yedeğin iki katından az" "$dizin"
    return 0
  fi

  mkdir -p "$dizin" || { yedek_basarisiz "$id" "Yedek klasörü oluşturulamadı" "$dizin"; return 0; }
  LOG="$dizin/.hata.log"; HATA=""
  ( while :; do sleep 60; nabiz; done ) &
  nabiz_pid=$!
  if ! yedek_uret "$id" "$klasor" "$dizin"; then
    kill "$nabiz_pid" 2>/dev/null
    yedek_basarisiz "$id" "${HATA:-Bilinmeyen hata}" "$dizin"
    return 0
  fi
  kill "$nabiz_pid" 2>/dev/null
  rm -f "$LOG"

  vt=$(stat -c %s "$dizin/veritabani.dump"); dos=$(stat -c %s "$dizin/dosyalar.tar.gz")
  [ -z "$SAHIP" ] || chown -R "$SAHIP" "$dizin"
  mv "$dizin" "$YEDEK_DIZIN/$klasor" || { yedek_basarisiz "$id" "Yedek klasörü taşınamadı" "$dizin"; return 0; }
  toplam=$(du -sb "$YEDEK_DIZIN/$klasor" | cut -f1)

  sql -v id="$id" -v klasor="$klasor" -v boyut="$toplam" -v vt="$vt" -v dos="$dos" -v ozet="$OZET" -v migration="$MIGRATION" -v surum="$SURUM" -v kunye="$KUNYE" <<'SQL'
UPDATE platform_yedekler SET durum = 'basarili', bitis_at = now() AT TIME ZONE 'UTC', klasor = :'klasor', boyut_bayt = :boyut, veritabani_bayt = :vt, dosya_bayt = :dos,
  ozet = :'ozet', son_migration = :'migration', uygulama_surumu = :'surum', kunye = :'kunye'::jsonb WHERE id = :'id'::uuid;
SQL
  gunluk "yedek tamamlandı: $klasor $toplam bayt"
  return 0
}

deneme_sonuc() {
  sql -v id="$1" -v durum="$2" -v detay="$3" <<'SQL'
UPDATE platform_yedekler SET deneme_durum = :'durum', deneme_at = now() AT TIME ZONE 'UTC', deneme_detay = :'detay' WHERE id = :'id'::uuid;
SQL
  gunluk "geri yükleme denemesi $2: $3"
}

deneme_calistir() {
  dizin=$1; gecici=$2; gurl="$TABAN_URL/$gecici"
  (cd "$dizin" && sha256sum -c -s SHA256SUMS) 2>>"$LOG" || { HATA="Özet tutmuyor; yedek bozulmuş"; return 1; }
  adim "Geçici veritabanı" yonetim_sql -c "CREATE DATABASE $gecici" || return 1
  adim "Geri yükleme" nice -n 15 pg_restore --no-owner -j 2 -d "$gurl" "$dizin/veritabani.dump" || return 1
  beklenen=$(awk '$1=="TABLO" {print $2}' "$dizin/dogrulama.txt")
  tablo=$(psql "$gurl" -X -q -A -t -c "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'") || { HATA="Tablo sayılamadı"; return 1; }
  [ "$tablo" = "$beklenen" ] || { HATA="Tablo sayısı tutmuyor: beklenen $beklenen, açılan $tablo"; return 1; }
  while read -r tur t alt ust; do
    [ "$tur" = "SAYIM" ] || continue
    n=$(psql "$gurl" -X -q -A -t -c "SELECT count(*) FROM $t") || { HATA="$t sayılamadı"; return 1; }
    if [ "$alt" -gt "$ust" ]; then g=$alt; alt=$ust; ust=$g; fi
    if [ "$n" -lt "$alt" ] || [ "$n" -gt "$ust" ]; then HATA="$t satır sayısı aralık dışında: $n ($alt-$ust)"; return 1; fi
  done <"$dizin/dogrulama.txt"
  beklenen=$(awk '$1=="DOSYA" {print $2}' "$dizin/dogrulama.txt")
  dosya=$(tar -tzf "$dizin/dosyalar.tar.gz" 2>>"$LOG" | wc -l)
  [ "$dosya" = "$beklenen" ] || { HATA="Dosya sayısı tutmuyor: beklenen $beklenen, açılan $dosya"; return 1; }
  DETAY="$tablo tablo açıldı, kritik tablo satırları tutarlı, $dosya dosya kaydı doğrulandı"
}

deneme_al() {
  kayit=$(sql <<'SQL'
UPDATE platform_yedekler SET deneme_durum = 'calisiyor'
WHERE id = (SELECT id FROM platform_yedekler WHERE deneme_durum = 'bekliyor' AND durum = 'basarili' ORDER BY deneme_talep_at LIMIT 1 FOR UPDATE SKIP LOCKED)
RETURNING id, klasor;
SQL
  ) || return 0
  [ -n "$kayit" ] || return 1
  id=${kayit%%|*}; klasor=${kayit#*|}
  if ! printf '%s' "$klasor" | grep -Eq "$KLASOR_DESENI" || [ ! -d "$YEDEK_DIZIN/$klasor" ]; then
    deneme_sonuc "$id" hatali "Yedek klasörü bulunamadı"
    return 0
  fi
  gecici="${DENEME_ONEK}$(printf '%s' "$id" | cut -c1-8)"
  gunluk "geri yükleme denemesi başladı: $klasor"
  LOG=$(mktemp); HATA=""; DETAY=""
  ( while :; do sleep 60; nabiz; done ) &
  nabiz_pid=$!
  if deneme_calistir "$YEDEK_DIZIN/$klasor" "$gecici"; then sonuc=basarili; metin=$DETAY; else sonuc=hatali; metin=${HATA:-Bilinmeyen hata}; fi
  kill "$nabiz_pid" 2>/dev/null
  yonetim_sql -c "DROP DATABASE IF EXISTS $gecici WITH (FORCE)" || gunluk "geçici veritabanı silinemedi: $gecici"
  rm -f "$LOG"
  deneme_sonuc "$id" "$sonuc" "$metin"
  return 0
}

isaretlileri_sil() {
  sql -c "SELECT id, klasor FROM platform_yedekler WHERE silinecek AND durum = 'basarili' AND NOT korunuyor" | while IFS='|' read -r id klasor; do
    [ -n "$id" ] || continue
    if ! printf '%s' "$klasor" | grep -Eq "$KLASOR_DESENI"; then gunluk "geçersiz klasör adı atlandı: $id"; continue; fi
    rm -rf "${YEDEK_DIZIN:?}/${klasor:?}" && sql -v id="$id" <<'SQL'
UPDATE platform_yedekler SET durum = 'silindi', silindi_at = now() AT TIME ZONE 'UTC' WHERE id = :'id'::uuid;
SQL
    gunluk "saklama süresi dolan yedek silindi: $klasor"
  done
}

trap 'exit 0' TERM INT
mkdir -p "$YEDEK_DIZIN"
until sql -c 'SELECT 1 FROM platform_yedekler LIMIT 1' >/dev/null 2>&1; do gunluk "veritabanı bekleniyor"; sleep 10; done
acilis_temizligi
gunluk "yedek servisi başladı ($SURUM)"
while :; do
  nabiz
  isaretlileri_sil
  yedek_al || deneme_al || true
  sleep "$ARALIK"
done
