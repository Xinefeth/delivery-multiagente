"""NODO DETERMINISTA `cerrar_pedido`.

NO ES UN AGENTE: marca ENTREGADO -> CERRADO, libera al repartidor y crea un
registro de encuesta vacío. CRUD + transición de estado.
"""
from __future__ import annotations

from ..db.database import get_session
from ..db.models import Driver, Order, Survey
from ..estados import CERRADO, ENTREGADO, transicion_valida


class CierreInvalidoError(Exception):
    pass


def cerrar_pedido(pedido_id: int) -> int:
    """Cierra el pedido entregado y crea la encuesta vacía. Devuelve survey_id."""
    with get_session() as session:
        pedido = session.get(Order, pedido_id)
        if not pedido:
            raise CierreInvalidoError(f"Pedido #{pedido_id} inexistente.")
        if pedido.estado != ENTREGADO:
            raise CierreInvalidoError(
                f"Solo se cierra un pedido ENTREGADO (está en {pedido.estado})."
            )
        if not transicion_valida(pedido.estado, CERRADO):
            raise CierreInvalidoError(f"Transición {pedido.estado} -> {CERRADO} no permitida.")

        pedido.estado = CERRADO

        # Libera al repartidor asignado.
        if pedido.driver_id:
            driver = session.get(Driver, pedido.driver_id)
            if driver:
                driver.disponible = True

        # Crea encuesta vacía para que el cliente la complete luego.
        encuesta = Survey(order_id=pedido.id)
        session.add(encuesta)
        session.flush()
        return encuesta.id
