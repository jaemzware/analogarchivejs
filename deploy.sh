#!/bin/bash
rsync -avz --progress \
  --exclude 'node_modules' \
  --exclude '.git' \
  --exclude '.env' \
  --exclude 'music' \
  --exclude 'sslcert' \
  --exclude 'output.log' \
  --exclude '.DS_Store' \
  ./ james@159.195.246.69:/home/james/analogarchivejs/
