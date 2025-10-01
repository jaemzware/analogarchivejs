FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy application files
COPY . .

# Create SSL certificate directory
RUN mkdir -p /app/ssl

# Generate self-signed SSL certificates
RUN apk add --no-cache openssl && \
    openssl genrsa -out /app/ssl/server.key 4096 && \
    openssl req -x509 -new -sha256 -nodes \
        -key /app/ssl/server.key \
        -days 1095 \
        -out /app/ssl/server.cert \
        -subj "/CN=localhost/O=analogarchivejs/C=US"

# Expose the port the app runs on
EXPOSE 55557

# Set default environment variables
ENV SSL_KEY_PATH=/app/ssl/server.key
ENV SSL_CERT_PATH=/app/ssl/server.cert

# Start the application
CMD ["node", "index.js"]
