# syntax=docker/dockerfile:1
FROM node:22-alpine AS base

# Install libc compatibility if needed
RUN apk add --no-cache libc6-compat
WORKDIR /app

# Dependencies stage
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

# Builder stage
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Set environment to production for Next.js build
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN npm run build

# Runner stage
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Create non-root user for security
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Create persistent data directory and set permissions
RUN mkdir -p /app/data && chown -R nextjs:nodejs /app/data

# Copy built standalone Next.js application
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Also copy sample-data if present so auto-seeding can access CSV fallback
COPY --from=builder --chown=nextjs:nodejs /app/sample-data ./sample-data

USER nextjs

EXPOSE 3000

VOLUME ["/app/data"]

CMD ["node", "server.js"]
