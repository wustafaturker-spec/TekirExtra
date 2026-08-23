# Merkezi gözlemleme

API, tek satırlık JSON logları stdout'a yazar. Docker/Kubernetes log sürücüsü veya bir Fluent Bit/Vector ajanı bu çıktıyı merkezi log sistemine taşıyabilir. Her istek `X-Request-ID` üretir/korur; hata olayları `errors_total` metriği ve `http_exception` JSON olayı olarak kaydedilir.

Prometheus ve Alertmanager isteğe bağlı Compose profiliyle çalışır:

```bash
docker compose --profile app --profile observability up -d
```

- Prometheus: http://localhost:9090
- Alertmanager: http://localhost:9093
- Geliştirme alarm e-postaları: http://localhost:8025 (Mailpit)

Üretimde `observability/alertmanager.yml` içindeki Mailpit alıcısını kurum SMTP/webhook alıcısıyla değiştirin. Alarm kuralları API erişilemezliği, 5xx oranı, ortalama gecikme ve rate-limit sıçramalarını kapsar.
