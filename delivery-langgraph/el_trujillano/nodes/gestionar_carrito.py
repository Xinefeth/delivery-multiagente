"""NODO DETERMINISTA `gestionar_carrito`.

NO ES UN AGENTE: agrega/quita ítems del carrito (estado en sesión) resolviendo el
producto contra la BD. Lógica fija de matching + aritmética.
"""
from __future__ import annotations

from ..db.database import get_session
from ..db.models import Product
from ..rag.vectorstore import get_catalogo_store
from ..state import VentasState


def _resolver_producto(session, nombre: str) -> Product | None:
    """Resuelve el nombre dicho por el cliente a un producto real.

    1) coincidencia exacta/parcial por SQL; 2) fallback a similitud semántica (RAG).
    """
    p = session.query(Product).filter(Product.name.ilike(f"%{nombre}%")).first()
    if p:
        return p
    try:
        docs = get_catalogo_store().similarity_search(nombre, k=1)
        if docs:
            pid = docs[0].metadata.get("product_id")
            return session.get(Product, pid)
    except Exception:
        pass
    return None


def _total(carrito: list[dict]) -> float:
    return sum(i["precio"] * i["cantidad"] for i in carrito)


def gestionar_carrito(state: VentasState) -> dict:
    carrito = [dict(i) for i in state.get("carrito", [])]
    intencion = state.get("intencion_actual")
    pedidos = state.get("productos_mencionados", [])
    quitar = intencion in ("REMOVE_PRODUCT", "REMOVE_PRODUCT_BY_NEGATION")

    no_encontrados: list[str] = []
    with get_session() as session:
        for item in pedidos:
            nombre = item.get("nombre", "")
            cantidad = int(item.get("cantidad", 1))
            producto = _resolver_producto(session, nombre)
            if not producto:
                no_encontrados.append(nombre)
                continue

            existente = next((c for c in carrito if c["product_id"] == producto.id), None)
            if quitar:
                if existente:
                    existente["cantidad"] -= cantidad
                    if existente["cantidad"] <= 0:
                        carrito.remove(existente)
            else:
                if existente:
                    existente["cantidad"] += cantidad
                else:
                    carrito.append(
                        {
                            "product_id": producto.id,
                            "nombre": producto.name,
                            "precio": producto.price,
                            "cantidad": cantidad,
                        }
                    )

    total = _total(carrito)
    if carrito:
        detalle = "\n".join(f"  • {c['cantidad']}x {c['nombre']} — S/{c['precio'] * c['cantidad']:.2f}" for c in carrito)
        respuesta = f"🛒 Tu pedido:\n{detalle}\n\n*Total: S/{total:.2f}*"
    else:
        respuesta = "Tu carrito quedó vacío."
    if no_encontrados:
        respuesta += f"\n\n⚠️ No encontré: {', '.join(no_encontrados)}."
    respuesta += "\n\n¿Deseas agregar algo más o confirmamos el pedido?"

    return {"carrito": carrito, "respuesta": respuesta}
