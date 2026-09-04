#!/bin/bash
set -e

# Wait for Ollama to be ready
echo "Waiting for Ollama..."
until curl -sf http://ollama:11434/api/tags >/dev/null; do
  sleep 2
done

# Pull default model
echo "Pulling llama3.1:8b..."
ollama pull llama3.1:8b

echo "Model pull complete."
