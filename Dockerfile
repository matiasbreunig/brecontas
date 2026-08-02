FROM node:22-slim AS base

# Toolchain to compile better-sqlite3, the only native module here.
#
# The cairo/pango/jpeg/gif/rsvg -dev packages used to live here too, for
# `canvas` — but canvas is not a dependency of this project (it only appears in
# next.config.ts's serverExternalPackages list). pdf.js-extract reads text and
# needs none of them; verified by extracting from a PDF in the final image.
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# The runner deliberately does NOT inherit from `base`: that stage carries the
# build toolchain, which nothing needs at runtime. The native modules arrive
# already compiled from `builder`, against the same base image, so the ABI
# matches and no extra shared library is required.
FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 --ingroup nodejs nextjs

# Copy standalone build
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
COPY --from=builder /app/drizzle ./drizzle

# Data and storage directories (mounted as volumes)
RUN mkdir -p /app/data /app/storage && chown -R nextjs:nodejs /app/data /app/storage

USER nextjs
EXPOSE 3000

CMD ["node", "server.js"]
