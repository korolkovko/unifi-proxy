# Multi-stage Dockerfile for Unifi Proxy
# Optimized for Railway deployment

# Stage 1: Dependencies
FROM node:20-alpine AS deps

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies only
RUN npm ci --only=production && \
    npm cache clean --force

# Stage 2: Production
FROM node:20-alpine AS runner

WORKDIR /app

# Create non-root user for security
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 proxyuser

# Copy dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules

# Copy application source
COPY --chown=proxyuser:nodejs src ./src
COPY --chown=proxyuser:nodejs package*.json ./

# Set environment to production
ENV NODE_ENV=production

# Switch to non-root user
USER proxyuser

# Expose ports
# Note: Railway will override PORT via environment variable
EXPOSE 443 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"

# Start the server
CMD ["node", "src/server.js"]
