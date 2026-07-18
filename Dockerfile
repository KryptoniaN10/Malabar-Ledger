FROM node:20-alpine

WORKDIR /app

# Copy api package files
COPY api/package*.json ./

# Install production deps only
RUN npm ci --omit=dev

# Copy api source
COPY api/ .

# Expose port
EXPOSE 3001

# Start
CMD ["node", "src/server.js"]
