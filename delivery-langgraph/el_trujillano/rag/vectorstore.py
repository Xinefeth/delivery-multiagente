"""Acceso a las colecciones de pgvector vía PGVector de LangChain.

Infraestructura determinista. Dos colecciones:
  - catalogo_productos: para `consultar_menu` (RAG semántico del menú).
  - politicas_restaurante: para el Deep Agent de reclamos (PDF de políticas).
"""
from __future__ import annotations

from functools import lru_cache

from langchain_postgres import PGVector

from .. import config
from ..llm import get_embeddings


def _get_store(collection_name: str) -> PGVector:
    return PGVector(
        embeddings=get_embeddings(),
        collection_name=collection_name,
        connection=config.DATABASE_URL,
        use_jsonb=True,
    )


@lru_cache(maxsize=2)
def get_catalogo_store() -> PGVector:
    return _get_store(config.COLLECTION_CATALOGO)


@lru_cache(maxsize=2)
def get_politicas_store() -> PGVector:
    return _get_store(config.COLLECTION_POLITICAS)
