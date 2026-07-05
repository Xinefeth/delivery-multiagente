-- Habilita la extensión pgvector en la base PostgreSQL de Render.
-- El backend también la crea automáticamente (db/init_db.py), pero puedes
-- ejecutar esto manualmente desde la consola psql de Render si lo prefieres:
--   psql "$DATABASE_URL" -f scripts/enable_pgvector.sql
CREATE EXTENSION IF NOT EXISTS vector;
