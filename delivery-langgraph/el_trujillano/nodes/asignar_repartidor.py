"""NODO DETERMINISTA `asignar_repartidor`.

NO ES UN AGENTE: toma el primer repartidor disponible en una TRANSACCIÓN ATÓMICA
(SELECT ... FOR UPDATE SKIP LOCKED) para evitar doble asignación. Pura lógica BD.
"""
from __future__ import annotations

from sqlalchemy import select

from ..db.database import get_session
from ..db.models import Driver, Order
from ..estados import EN_REPARTO, LISTO_PARA_REPARTO, transicion_valida


class SinRepartidorError(Exception):
    pass


def asignar_repartidor(pedido_id: int) -> dict:
    """Asigna atómicamente un repartidor disponible y pasa el pedido a EN_REPARTO."""
    with get_session() as session:
        pedido = session.get(Order, pedido_id)
        if not pedido:
            raise SinRepartidorError(f"Pedido #{pedido_id} inexistente.")
        if pedido.estado != LISTO_PARA_REPARTO:
            raise SinRepartidorError(
                f"El pedido #{pedido_id} debe estar en {LISTO_PARA_REPARTO} (está en {pedido.estado})."
            )

        # Bloqueo de fila para garantizar exclusividad bajo concurrencia.
        stmt = (
            select(Driver)
            .where(Driver.disponible.is_(True))
            .order_by(Driver.id)
            .limit(1)
            .with_for_update(skip_locked=True)
        )
        driver = session.execute(stmt).scalar_one_or_none()
        if not driver:
            raise SinRepartidorError("No hay repartidores disponibles en este momento.")

        if not transicion_valida(pedido.estado, EN_REPARTO):
            raise SinRepartidorError(f"Transición {pedido.estado} -> {EN_REPARTO} no permitida.")

        driver.disponible = False
        pedido.driver_id = driver.id
        pedido.estado = EN_REPARTO

        return {"driver_id": driver.id, "driver_nombre": driver.name, "driver_phone": driver.phone}
