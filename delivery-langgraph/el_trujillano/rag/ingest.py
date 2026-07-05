"""Pipeline de ingesta para pgvector. Determinista (no usa chat model).

Vectoriza dos fuentes:
  (a) catálogo de productos (nombre + descripción) -> colección catalogo_productos
  (b) PDF de políticas del restaurante           -> colección politicas_restaurante
"""
from __future__ import annotations

from pathlib import Path

from langchain_core.documents import Document
from langchain_text_splitters import RecursiveCharacterTextSplitter

from ..db.database import get_session
from ..db.models import Product
from .vectorstore import get_catalogo_store, get_politicas_store


def ingestar_catalogo() -> int:
    """Indexa todos los productos de la BD en la colección del catálogo."""
    store = get_catalogo_store()
    with get_session() as session:
        productos = session.query(Product).all()
        docs = [
            Document(
                page_content=f"{p.name}. {p.description}",
                metadata={
                    "product_id": p.id,
                    "nombre": p.name,
                    "categoria": p.category,
                    "precio": p.price,
                },
            )
            for p in productos
        ]
    if docs:
        store.add_documents(docs)
    print(f"✅ Catálogo indexado: {len(docs)} productos.")
    return len(docs)


def ingestar_politicas(ruta_pdf: str | Path) -> int:
    """Indexa el PDF (o .md) de políticas en la colección de políticas."""
    ruta = Path(ruta_pdf)
    if not ruta.exists():
        raise FileNotFoundError(
            f"No existe el archivo de políticas: {ruta}. "
            "Genera el PDF con scripts/generar_pdf_politicas.py o coloca el tuyo."
        )

    if ruta.suffix.lower() == ".pdf":
        from langchain_community.document_loaders import PyPDFLoader

        documentos = PyPDFLoader(str(ruta)).load()
    else:
        texto = ruta.read_text(encoding="utf-8")
        documentos = [Document(page_content=texto, metadata={"source": str(ruta)})]

    splitter = RecursiveCharacterTextSplitter(chunk_size=800, chunk_overlap=120)
    chunks = splitter.split_documents(documentos)
    for c in chunks:
        c.metadata["fuente"] = "politicas_restaurante"

    store = get_politicas_store()
    store.add_documents(chunks)
    print(f"✅ Políticas indexadas: {len(chunks)} fragmentos desde {ruta.name}.")
    return len(chunks)
