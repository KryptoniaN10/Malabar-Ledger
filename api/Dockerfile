FROM node:20-slim

# Build tools needed as fallback if prebuilt binary isn't available
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies first (layer caching)
COPY package*.json ./
RUN npm install --omit=dev

# Copy source code
COPY src ./src

EXPOSE 3001

CMD ["node", "src/server.js"]
