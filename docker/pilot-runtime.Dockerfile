# Derleme: docker build -f docker/pilot-runtime.Dockerfile -t tekirextra-pilot-runtime:<tarih> docker/
# SEC-05: pilot çalışma imajı. Kod ve Chromium tarayıcıları compose ile bağlanır;
# imaj yalnız Node 22, Chromium sistem kütüphaneleri ve yazı tiplerini taşır.
FROM node:22-bookworm-slim
RUN apt-get update \
  && apt-get upgrade -y \
  && apt-get install -y --no-install-recommends openssl ca-certificates fonts-noto-core fonts-dejavu-core fonts-liberation \
  && npx -y playwright@1.61.1 install-deps chromium \
  && apt-get purge -y --auto-remove \
  && rm -rf /var/lib/apt/lists/* /root/.npm /tmp/* \
  # Çalışırken paket yöneticisi gerekmez (npm'in kendi bağımlılıklarındaki açıklar da gider).
  && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /opt/yarn* /usr/local/bin/yarn /usr/local/bin/yarnpkg
ENV NODE_ENV=production
