# Monorepo kökünden build edilir: docker build -f apps/api/Dockerfile .
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm turbo build --filter=@tekirextra/api

FROM node:22-alpine
WORKDIR /repo
COPY --from=build /repo /repo
ENV NODE_ENV=production
EXPOSE 3001
CMD ["node", "apps/api/dist/main.js"]
