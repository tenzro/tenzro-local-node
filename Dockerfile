# Dockerfile
FROM node:18-slim AS builder

# Install build dependencies
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files
COPY package*.json ./
RUN npm ci

# Copy source files and build
COPY . .
RUN npm run build

# Production image
FROM node:18-slim

WORKDIR /app

# Install production dependencies and curl for healthcheck
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    tini \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy package files and install production dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy built files from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/.env.example ./.env

# Create non-root user
RUN useradd -r -u 1001 -g node tenzro
USER tenzro

# Expose port
EXPOSE 8080

# Use tini as entrypoint
ENTRYPOINT ["/usr/bin/tini", "--"]

# Set healthcheck
HEALTHCHECK --interval=30s --timeout=30s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8080/health || exit 1

# Start the application
CMD ["node", "dist/main.js"]
