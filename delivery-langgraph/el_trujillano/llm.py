"""Fábricas del chat model (Claude) y de los embeddings.

NOTA DE DISEÑO: este módulo NO es un agente. Es infraestructura. Solo construye
clientes. Quien razona es el nodo que invoca a `get_llm(...)`.
"""
from __future__ import annotations

from functools import lru_cache

from langchain_anthropic import ChatAnthropic

from . import config


def get_llm(temperature: float = 0.2, **kwargs) -> ChatAnthropic:
    """Devuelve un ChatAnthropic configurado con el modelo de Claude por defecto.

    El mismo modelo cubre: clasificación de intención, validación de comprobantes
    por visión y el sub-agente crítico del Deep Agent de reclamos.
    """
    config.validar_config_llm()
    return ChatAnthropic(
        model=config.CLAUDE_MODEL,
        temperature=temperature,
        api_key=config.ANTHROPIC_API_KEY,
        max_tokens=kwargs.pop("max_tokens", 1024),
        **kwargs,
    )


@lru_cache(maxsize=1)
def get_embeddings():
    """Devuelve el modelo de embeddings según EMBEDDINGS_PROVIDER.

    Claude/Anthropic NO ofrece embeddings propios, por eso se usa Voyage AI o
    HuggingFace para alimentar pgvector.
    """
    if config.EMBEDDINGS_PROVIDER == "voyage":
        from langchain_voyageai import VoyageAIEmbeddings

        return VoyageAIEmbeddings(
            model=config.VOYAGE_MODEL,
            api_key=config.VOYAGE_API_KEY,
        )

    from langchain_huggingface import HuggingFaceEmbeddings

    return HuggingFaceEmbeddings(model_name=config.HF_EMBEDDINGS_MODEL)
