# syntax=docker/dockerfile:1
# Build stage: full toolchain (better-sqlite3 may need to compile on some platforms).
FROM node:22-bookworm AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN pnpm build && pnpm prune --prod

# Runtime stage: no compiler, non-root user, only what the server needs.
FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    TRANSPORT=http \
    BIND_HOST=0.0.0.0 \
    PORT=8787 \
    DATABASE_PATH=/data/edison-x.db
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
# The source register and seed library are configuration: mount your own over these paths to change them.
COPY docs/SOURCES.md ./docs/SOURCES.md
COPY library ./library
RUN mkdir -p /data && chown -R node:node /data /app
USER node
VOLUME ["/data"]
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/index.js"]
