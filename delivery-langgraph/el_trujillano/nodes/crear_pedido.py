"""NODO DETERMINISTA `crear_pedido`.

NO ES UN AGENTE: persiste el pedido en PostgreSQL con estado PAGO_PENDIENTE.
CRUD + aritmética de totales.
"""
from __future__ import annotations

from .. import config
from ..db.database import get_session
from ..db.models import Order, OrderItem
from ..estados import PAGO_PENDIENTE
from ..state import VentasState


def crear_pedido(state: VentasState) -> dict:
    carrito = state.get("carrito", [])
    datos = state.get("datos_cliente") or {}

    if not carrito:
        return {"respuesta": "Tu carrito está vacío, agrega algo antes de confirmar."}

    total = sum(i["precio"] * i["cantidad"] for i in carrito)

    with get_session() as session:
        pedido = Order(
            session_id=state.get("session_id", ""),
            cliente_nombre=datos.get("nombre"),
            cliente_telefono=datos.get("telefono"),
            direccion=datos.get("direccion"),
            referencia=datos.get("referencia"),
            total=total,
            estado=PAGO_PENDIENTE,
        )
        for c in carrito:
            pedido.items.append(
                OrderItem(
                    product_id=c["product_id"],
                    nombre=c["nombre"],
                    precio=c["precio"],
                    cantidad=c["cantidad"],
                )
            )
        session.add(pedido)
        session.flush()
        pedido_id = pedido.id

    respuesta = (
        f"¡Listo! Tu pedido #{pedido_id} fue registrado por *S/{total:.2f}*.\n\n"
        f"Para confirmarlo, realiza el pago por *Yape* o *Plin* al número "
        f"*{config.NUMERO_YAPE_RESTAURANTE}* ({config.NOMBRE_TITULAR_PAGO}) "
        f"y envíame la captura del comprobante 📲."
    )
    return {"pedido_id": pedido_id, "estado_pedido": PAGO_PENDIENTE, "respuesta": respuesta}
