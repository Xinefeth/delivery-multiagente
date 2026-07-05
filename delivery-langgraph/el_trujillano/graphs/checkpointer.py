"""Fábrica del checkpointer de LangGraph (memoria de corto plazo por sesión).

NO ES UN AGENTE: es infraestructura de persistencia del estado del grafo entre
turnos. Según el PASO 5 (memoria), la conversación y el carrito viven en el estado
del grafo + un checkpointer:

  - "memory"   -> MemorySaver (en proceso; ideal para desarrollo y pruebas).
  - "postgres" -> PostgresSaver sobre la MISMA base PostgreSQL (producción / Render).

El selector es determinista (variable de entorno LANGGRAPH_CHECKPOINTER). Si el
PostgresSaver no puede inicializarse (falta la dependencia o la BD), se degrada a
MemorySaver con una advertencia, para no romper el arranque ni los tests.
"""
from __future__ import annotations

from langgraph.checkpoint.memory import MemorySaver

from .. import config


def _dsn_psycopg(database_url: str) -> str:
    """Convierte la URL SQLAlchemy 'postgresql+psycopg://...' al DSN plano que
    espera psycopg/PostgresSaver ('postgresql://...')."""
    return database_url.replace("postgresql+psycopg://", "postgresql://").replace(
        "postgresql+psycopg2://", "postgresql://"
    )


def build_checkpointer():
    """Devuelve el checkpointer configurado (PostgresSaver o MemorySaver)."""
    if config.LANGGRAPH_CHECKPOINTER != "postgres":
        return MemorySaver()

    try:
        from psycopg import Connection  # type: ignore
        from psycopg.rows import dict_row  # type: ignore
        from langgraph.checkpoint.postgres import PostgresSaver  # type: ignore

        conn = Connection.connect(
            _dsn_psycopg(config.DATABASE_URL),
            autocommit=True,
            prepare_threshold=0,
            row_factory=dict_row,
        )
        saver = PostgresSaver(conn)
        saver.setup()  # crea las tablas de checkpoints si no existen
        return saver
    except Exception as e:  # pragma: no cover - depende del entorno/BD
        print(
            f"[checkpointer] PostgresSaver no disponible ({e}); "
            f"usando MemorySaver como fallback."
        )
        return MemorySaver()
