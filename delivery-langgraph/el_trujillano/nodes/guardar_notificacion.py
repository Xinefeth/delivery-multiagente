"""NODO DETERMINISTA `guardar_notificacion`.

NO ES UN AGENTE: inserta una fila de notificación por canal. CRUD puro.
"""
from __future__ import annotations

from ..db.database import get_session
from ..db.models import Notification
from ..state import VentasState


def guardar_notificacion(order_id: int | None, canal: str, mensaje: str) -> int:
    """Persiste una notificación y devuelve su id."""
    with get_session() as session:
        notif = Notification(order_id=order_id, canal=canal, mensaje=mensaje)
        session.add(notif)
        session.flush()
        return notif.id


def guardar_notificacion_node(state: VentasState) -> dict:
    """Variante usable como nodo del grafo: notifica al cliente la respuesta del turno."""
    respuesta = state.get("respuesta", "")
    if respuesta:
        guardar_notificacion(state.get("pedido_id"), "cliente", respuesta)
    return {}
