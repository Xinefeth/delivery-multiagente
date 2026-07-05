"""NODO DETERMINISTA `validar_estado_cocina` — REGLA CRÍTICA.

NO ES UN AGENTE: es una guarda con un `if`. Rechaza cualquier pedido que NO esté
en PAGO_VALIDADO antes de pasar a EN_COCINA. Cero razonamiento de lenguaje.
"""
from __future__ import annotations

from ..db.database import get_session
from ..db.models import Order
from ..estados import EN_COCINA, PAGO_VALIDADO, transicion_valida


class EstadoInvalidoError(Exception):
    """El pedido no cumple la regla crítica para entrar a cocina."""


def validar_estado_cocina(pedido_id: int) -> bool:
    """Devuelve True y mueve el pedido a EN_COCINA solo si está en PAGO_VALIDADO."""
    with get_session() as session:
        pedido = session.get(Order, pedido_id)
        if not pedido:
            raise EstadoInvalidoError(f"Pedido #{pedido_id} inexistente.")

        if pedido.estado != PAGO_VALIDADO:
            raise EstadoInvalidoError(
                f"REGLA CRÍTICA: el pedido #{pedido_id} está en '{pedido.estado}', "
                f"solo se acepta en cocina si está en '{PAGO_VALIDADO}'."
            )
        if not transicion_valida(pedido.estado, EN_COCINA):
            raise EstadoInvalidoError(f"Transición {pedido.estado} -> {EN_COCINA} no permitida.")

        pedido.estado = EN_COCINA
    return True
