"""Crea la extensión pgvector y todas las tablas relacionales. Determinista."""
from __future__ import annotations

import sys

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

from sqlalchemy import text

from . import models  # noqa: F401  (registra los modelos en Base.metadata)
from .database import Base, engine


def init_db() -> None:
    with engine.begin() as conn:
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
    Base.metadata.create_all(engine)
    print("✅ Extensión pgvector y tablas relacionales creadas.")


if __name__ == "__main__":
    init_db()
