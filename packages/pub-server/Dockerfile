FROM node:20-alpine AS builder

RUN corepack enable && corepack prepare pnpm@8.15.0 --activate

WORKDIR /app

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json ./
COPY packages/types/package.json packages/types/
COPY packages/pub-server/package.json packages/pub-server/
COPY packages/create-openpub/package.json packages/create-openpub/

RUN pnpm install --frozen-lockfile

COPY packages/types/ packages/types/
COPY packages/pub-server/ packages/pub-server/

RUN pnpm --filter @openpub-ai/types build
RUN pnpm --filter @openpub-ai/pub-server build

# Create a self-contained production bundle
RUN pnpm --filter @openpub-ai/pub-server deploy --prod /app/deployed

# Copy built types into the deployed bundle (pnpm deploy creates broken
# symlinks for workspace dependencies even when versioned on npm)
RUN rm -rf /app/deployed/node_modules/@openpub-ai/types && \
    mkdir -p /app/deployed/node_modules/@openpub-ai/types && \
    cp -r /app/packages/types/dist /app/deployed/node_modules/@openpub-ai/types/dist && \
    cp /app/packages/types/package.json /app/deployed/node_modules/@openpub-ai/types/package.json

FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

COPY --from=builder /app/deployed ./

EXPOSE 8080

USER node

CMD ["node", "dist/server.js"]
