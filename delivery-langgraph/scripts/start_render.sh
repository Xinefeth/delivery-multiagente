#!/usr/bin/env bash
# ============================================================
#  Script de arranque en Render (PASO 7).
#  1) Crea pgvector + tablas y siembra catálogo/usuarios (idempotente, rápido).
#  2) Arranca uvicorn de inmediato para abrir el puerto que Render escanea ($PORT).
#  3) Ejecuta la ingesta RAG en SEGUNDO PLANO (no bloquea el bind del puerto).
#
#  Nota: la ingesta RAG puede tardar varios minutos (llamadas a la API de
#  embeddings). Si se corre ANTES de uvicorn, Render no detecta puerto abierto
#  y marca el deploy como "Timed out". Por eso aquí va en background.
# ============================================================
set -euo pipefail

echo "==> [1/3] Esquema + seed (pgvector, tablas, catálogo, usuarios)..."
python -m scripts.seed_catalog

if [ "${RUN_INGEST_ON_START:-false}" = "true" ]; then
  echo "==> [2/3] Ingesta RAG en segundo plano (catálogo + PDF -> pgvector)..."
  # Se lanza en background: uvicorn abre el puerto sin esperar a que termine.
  # No tumba el arranque si el proveedor de embeddings no está configurado.
  (
    python -m scripts.run_ingest \
      && echo "✅ Ingesta RAG completada." \
      || echo "⚠️  Ingesta RAG falló; el chat funciona, reintenta 'python -m scripts.run_ingest' por Shell."
  ) &
else
  echo "==> [2/3] Ingesta RAG omitida (RUN_INGEST_ON_START != true)."
fi

echo "==> [3/3] Iniciando API en 0.0.0.0:${PORT:-8000}..."
exec uvicorn el_trujillano.api.main:app --host 0.0.0.0 --port "${PORT:-8000}"
