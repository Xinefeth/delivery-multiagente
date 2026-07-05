"""NODO DETERMINISTA `consultar_menu`.

NO ES UN AGENTE: combina búsqueda semántica (RAG) con SQL puro sobre el catálogo
y arma el texto del menú. No hay razonamiento del LLM aquí.
"""
from __future__ import annotations

from ..db.database import get_session
from ..db.models import Product
from ..rag.vectorstore import get_catalogo_store
from ..state import VentasState


def _formatear(productos) -> str:
    por_categoria: dict[str, list] = {}
    for p in productos:
        por_categoria.setdefault(p.category, []).append(p)
    bloques = []
    for cat, items in por_categoria.items():
        lineas = "\n".join(f"  • {p.name} — S/{p.price:.2f}" for p in items)
        bloques.append(f"*{cat}*\n{lineas}")
    return "\n\n".join(bloques)


def consultar_menu(state: VentasState) -> dict:
    intencion = state.get("intencion_actual")

    with get_session() as session:
        if intencion == "SHOW_CATEGORY" and state.get("categoria"):
            categoria = state["categoria"]
            productos = (
                session.query(Product)
                .filter(Product.category.ilike(f"%{categoria}%"))
                .order_by(Product.name)
                .all()
            )
            encabezado = f"Aquí tienes nuestra carta de *{categoria}* 🍽️:"
        else:
            productos = session.query(Product).order_by(Product.category, Product.name).all()
            encabezado = "Este es nuestro menú 🍽️:"

        # RAG: si hay una consulta concreta, prioriza productos relevantes (búsqueda semántica).
        consulta = state.get("input_usuario", "")
        if consulta and intencion not in ("SHOW_MENU", "SHOW_CATEGORY"):
            try:
                docs = get_catalogo_store().similarity_search(consulta, k=5)
                ids = [d.metadata.get("product_id") for d in docs]
                relevantes = [p for p in productos if p.id in ids]
                if relevantes:
                    productos = relevantes
                    encabezado = "Esto es lo que encontré 🔎:"
            except Exception:
                pass

        texto = _formatear(productos) if productos else "No encontré productos para esa categoría."

    return {"respuesta": f"{encabezado}\n\n{texto}\n\n¿Qué te gustaría pedir?"}
