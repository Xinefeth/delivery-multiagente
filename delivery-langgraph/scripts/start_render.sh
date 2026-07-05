#!/usr/bin/env bash
# ============================================================
#  Script de arranque en Render (PASO 7).
#  1) Crea pgvector + tablas y siembra catálogo/usuarios (idempotente).
#  2) Ejecuta la ingesta RAG la primera vez (RUN_INGEST_ON_START=true).
#  3) Arranca uvicorn en el puerto que Render inyecta ($PORT).
# ============================================================
set -euo pipefail

echo "==> [1/3] Esquema + seed (pgvector, tablas, catálogo, usuarios)..."
python -m scripts.seed_catalog

if [ "${RUN_INGEST_ON_START:-false}" = "true" ]; then
  echo "==> [2/3] Ingesta RAG (catálogo + PDF de políticas -> pgvector)..."
  # No bloquea el arranque si el proveedor de embeddings no está configurado.
  python -m scripts.run_ingest || echo "⚠️  Ingesta RAG falló; el chat funciona, reintenta el job luego."
else
  echo "==> [2/3] Ingesta RAG omitida (RUN_INGEST_ON_START != true)."
fi

echo "==> [3/3] Iniciando API en 0.0.0.0:${PORT:-8000}..."
exec uvicorn el_trujillano.api.main:app --host 0.0.0.0 --port "${PORT:-8000}"
