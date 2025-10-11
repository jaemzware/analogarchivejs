mkdir sslcert
openssl genrsa -out sslcert/key.pem 4096
openssl req -x509 -new -sha256 -nodes -key sslcert/key.pem -days 1095 -out sslcert/cert.pem -subj "/CN=localhost/O=analogarchive/C=US"