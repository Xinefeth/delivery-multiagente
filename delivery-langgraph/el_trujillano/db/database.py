"""Conexión a PostgreSQL vía SQLAlchemy.

Infraestructura determinista. Las tablas relacionales (pedidos, repartidores,
notificaciones, encuestas) se consultan por SQL/ORM, NO por la base vectorial.
"""
from __future__ import annotations

from contextlib import contextmanager

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from .. import config


class Base(DeclarativeBase):
    pass


engine = create_engine(config.DATABASE_URL, pool_pre_ping=True, future=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False, future=True)


@contextmanager
def get_session():
    """Sesión transaccional: commit al salir bien, rollback si hay excepción."""
    session = SessionLocal()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
