#!/bin/sh
# Generates a self-signed cert covering localhost, 127.0.0.1, and the machine's
# current LAN IP as Subject Alternative Names, so browsers accept it whether you
# connect via https://localhost:PORT or https://<lan-ip>:PORT.

LAN_IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}')

mkdir -p sslcert
openssl genrsa -out sslcert/key.pem 4096
openssl req -x509 -new -sha256 -nodes -key sslcert/key.pem -days 1095 -out sslcert/cert.pem \
    -subj "/CN=localhost/O=Jaemzware LLC/C=US" \
    -addext "subjectAltName=DNS:localhost,IP:127.0.0.1${LAN_IP:+,IP:$LAN_IP}"

echo "Generated cert with SAN: DNS:localhost,IP:127.0.0.1${LAN_IP:+,IP:$LAN_IP}"
