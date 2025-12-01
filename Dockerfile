FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy application files
COPY . .

# Create SSL certificate directory and music directory (for thumbnail cache)
RUN mkdir -p /app/sslcert /app/music/.thumbs

# Generate self-signed SSL certificates for development
RUN apk add --no-cache openssl && \
    openssl genrsa -out /app/sslcert/key.pem 4096 && \
    openssl req -x509 -new -sha256 -nodes \
        -key /app/sslcert/key.pem \
        -days 1095 \
        -out /app/sslcert/cert.pem \
        -subj "/CN=localhost/O=analogarchive/C=US"

# Expose the ports (HTTPS and HTTP redirect)
EXPOSE 55557 55556

# Set default environment variables
ENV SSL_KEY_PATH=/app/sslcert/key.pem
ENV SSL_CERT_PATH=/app/sslcert/cert.pem

# Start the application
CMD ["node", "index.js"]