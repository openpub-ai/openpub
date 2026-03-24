FROM node:20-alpine AS builder

RUN corepack enable && corepack prepare pnpm@8.15.0 --activate

WORKDIR /app

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json ./
COPY packages/types/package.json packages/types/
COPY packages/pub-server/package.json packages/pub-server/

RUN pnpm install --frozen-lockfile

COPY packages/types/ packages/types/
COPY packages/pub-server/ packages/pub-server/

RUN pnpm --filter @openpub/types build
RUN pnpm --filter @openpub/pub-server build

FROM node:20-alpine AS runner

RUN corepack enable && corepack prepare pnpm@8.15.0 --activate

WORKDIR /app

ENV NODE_ENV=production

COPY --from=builder /app/packages/pub-server/dist ./dist
COPY --from=builder /app/packages/pub-server/package.json ./
COPY --from=builder /app/node_modules ./node_modules

EXPOSE 8080

USER node

CMD ["node", "dist/server.js"]
