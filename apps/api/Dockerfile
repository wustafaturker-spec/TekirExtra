# Monorepo kökünden build edilir: docker build -f apps/api/Dockerfile .
# Alpine yerine bookworm-slim: Playwright/Chromium (T-02 PDF) glibc ister.
FROM node:22-bookworm-slim AS build
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm turbo build --filter=@tekirextra/api

FROM node:22-bookworm-slim
WORKDIR /repo
COPY --from=build /repo /repo
# T-02: PDF üretimi için Chromium ve sistem bağımlılıkları
RUN cd apps/api && npx playwright install --with-deps chromium \
  && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
EXPOSE 3001
CMD ["node", "apps/api/dist/main.js"]
