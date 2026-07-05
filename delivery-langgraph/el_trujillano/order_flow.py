"""Transiciones de back-office de la máquina de estados del pedido.

Esta es la parte de la máquina que NO depende del chat con el cliente, sino de
eventos de cocina/repartidor/admin. Es 100% DETERMINISTA: orquesta los nodos
deterministas (validar_estado_cocina, asignar_repartidor, guardar_notificacion,
cerrar_pedido) respetando las aristas de `estados.TRANSICIONES`.

PAGO_VALIDADO ─(validar_estado_cocina, REGLA CRÍTICA)─► EN_COCINA
EN_COCINA ─► LISTO_PARA_REPARTO ─(asignar_repartidor, atómico)─► EN_REPARTO
EN_REPARTO ─► ENTREGADO ─(cerrar_pedido)─► CERRADO
"""
from __future__ import annotations

from .db.database import get_session
from .db.models import Order
from .estados import (
    EN_COCINA,
    EN_REPARTO,
    ENTREGADO,
    LISTO_PARA_REPARTO,
    transicion_valida,
)
from .nodes.asignar_repartidor import asignar_repartidor
from .nodes.cerrar_pedido import cerrar_pedido
from .nodes.guardar_notificacion import guardar_notificacion
from .nodes.validar_estado_cocina import validar_estado_cocina


def _mover_estado(pedido_id: int, destino: str) -> None:
    with get_session() as session:
        pedido = session.get(Order, pedido_id)
        if not pedido:
            raise ValueError(f"Pedido #{pedido_id} inexistente.")
        if not transicion_valida(pedido.estado, destino):
            raise ValueError(f"Transición {pedido.estado} -> {destino} no permitida.")
        pedido.estado = destino


def enviar_a_cocina(pedido_id: int) -> dict:
    """Aplica la REGLA CRÍTICA y pasa el pedido a EN_COCINA."""
    validar_estado_cocina(pedido_id)  # lanza si no está en PAGO_VALIDADO
    guardar_notificacion(pedido_id, "cocina", f"Nuevo pedido #{pedido_id} en cocina.")
    return {"pedido_id": pedido_id, "estado": EN_COCINA}


def marcar_listo(pedido_id: int) -> dict:
    """Cocina marca el pedido como LISTO_PARA_REPARTO."""
    _mover_estado(pedido_id, LISTO_PARA_REPARTO)
    guardar_notificacion(pedido_id, "admin", f"Pedido #{pedido_id} listo para reparto.")
    return {"pedido_id": pedido_id, "estado": LISTO_PARA_REPARTO}


def despachar(pedido_id: int) -> dict:
    """Asigna repartidor (transacción atómica) y pasa a EN_REPARTO."""
    info = asignar_repartidor(pedido_id)  # mueve a EN_REPARTO dentro de la transacción
    guardar_notificacion(
        pedido_id, "repartidor", f"Pedido #{pedido_id} asignado a {info['driver_nombre']}."
    )
    guardar_notificacion(pedido_id, "cliente", "Tu pedido salió a reparto 🛵.")
    return {"pedido_id": pedido_id, "estado": EN_REPARTO, **info}


def marcar_entregado(pedido_id: int) -> dict:
    """Repartidor confirma la entrega: EN_REPARTO -> ENTREGADO."""
    _mover_estado(pedido_id, ENTREGADO)
    guardar_notificacion(pedido_id, "cliente", "¡Tu pedido fue entregado! Buen provecho 😋.")
    return {"pedido_id": pedido_id, "estado": ENTREGADO}


def cerrar(pedido_id: int) -> dict:
    """Cierra el pedido y crea la encuesta vacía."""
    survey_id = cerrar_pedido(pedido_id)
    guardar_notificacion(pedido_id, "cliente", "¿Cómo estuvo todo? Déjanos tu calificación ⭐.")
    return {"pedido_id": pedido_id, "estado": "CERRADO", "survey_id": survey_id}
