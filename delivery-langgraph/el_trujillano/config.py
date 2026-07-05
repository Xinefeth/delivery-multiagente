"""Configuración central leída desde variables de entorno (.env).

No contiene lógica de negocio: solo constantes y settings. Es determinista.
"""
from __future__ import annotations

import os

from dotenv import load_dotenv

load_dotenv()

# --- Modelo de Claude (Anthropic) ---
ANTHROPIC_API_KEY: str | None = os.environ.get("ANTHROPIC_API_KEY")
CLAUDE_MODEL: str = os.environ.get("CLAUDE_MODEL", "claude-haiku-4-5-20251001")

# --- Base de datos ---
def _normalizar_database_url(url: str) -> str:
    """Fuerza el dialecto psycopg3 que usa SQLAlchemy + langchain-postgres.

    Render (y muchos proveedores) entregan la URL como 'postgres://' o
    'postgresql://', que en SQLAlchemy resuelven al driver psycopg2 (no instalado).
    Se reescribe a 'postgresql+psycopg://' salvo que ya traiga un driver explícito.
    """
    if url.startswith("postgres://"):
        url = "postgresql://" + url[len("postgres://"):]
    if url.startswith("postgresql://"):
        url = "postgresql+psycopg://" + url[len("postgresql://"):]
    return url


DATABASE_URL: str = _normalizar_database_url(
    os.environ.get(
        "DATABASE_URL",
        "postgresql+psycopg://postgres:postgres@localhost:5432/el_trujillano",
    )
)

# --- Embeddings ---
EMBEDDINGS_PROVIDER: str = os.environ.get("EMBEDDINGS_PROVIDER", "voyage").lower()
VOYAGE_API_KEY: str | None = os.environ.get("VOYAGE_API_KEY")
VOYAGE_MODEL: str = os.environ.get("VOYAGE_MODEL", "voyage-3")
HF_EMBEDDINGS_MODEL: str = os.environ.get(
    "HF_EMBEDDINGS_MODEL",
    "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2",
)

# --- Colecciones de pgvector ---
COLLECTION_CATALOGO: str = "catalogo_productos"
COLLECTION_POLITICAS: str = "politicas_restaurante"

# --- Reglas de negocio ---
TOLERANCIA_MONTO: float = 0.10  # ±S/0.10 al comparar el pago
NUMERO_YAPE_RESTAURANTE: str = os.environ.get("NUMERO_YAPE_RESTAURANTE", "938749977")
NOMBRE_TITULAR_PAGO: str = os.environ.get("NOMBRE_TITULAR_PAGO", "Restaurante El Trujillano")
MAX_ITERACIONES_RECLAMO: int = int(os.environ.get("MAX_ITERACIONES_RECLAMO", "3"))

# --- Ventana de historial enviada al clasificador (últimos N turnos) ---
HISTORIAL_TURNOS: int = 6

# --- Límites anti-inyección / control de costo (caracteres de entrada no confiable) ---
MAX_INPUT_CHARS: int = int(os.environ.get("MAX_INPUT_CHARS", "2000"))
MAX_RECLAMO_CHARS: int = int(os.environ.get("MAX_RECLAMO_CHARS", "4000"))

# --- Checkpointer de LangGraph (memoria de corto plazo por sesión) ---
# "memory" (por defecto, para desarrollo/tests) o "postgres" (PostgresSaver sobre
# la misma base PostgreSQL, recomendado en producción/Render).
LANGGRAPH_CHECKPOINTER: str = os.environ.get("LANGGRAPH_CHECKPOINTER", "memory").lower()

# --- Autenticación del panel (JWT) ---
JWT_SECRET: str = os.environ.get("JWT_SECRET", "cambia-esto-en-produccion")
JWT_ALGORITHM: str = "HS256"
JWT_EXPIRE_HOURS: int = int(os.environ.get("JWT_EXPIRE_HOURS", "8"))

# --- Carpeta de subidas (capturas de comprobantes) ---
UPLOADS_DIR: str = os.environ.get(
    "UPLOADS_DIR",
    os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "uploads"),
)


def validar_config_llm() -> None:
    """Lanza un error claro si falta la API key (se llama justo antes de usar el LLM)."""
    if not ANTHROPIC_API_KEY:
        raise RuntimeError(
            "Falta ANTHROPIC_API_KEY. Copia .env.example a .env y completa la clave de la API de Claude."
        )
