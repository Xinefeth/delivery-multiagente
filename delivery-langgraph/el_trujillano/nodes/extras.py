"""Nodos DETERMINISTAS auxiliares del grafo de ventas.

NINGUNO es agente: leen estado/BD y arman texto fijo.
"""
from __future__ import annotations

from .. import config
from ..db.database import get_session
from ..db.models import Order
from ..estados import CERRADO, ENTREGADO, PAGO_PENDIENTE
from ..state import VentasState


def ver_carrito(state: VentasState) -> dict:
    carrito = state.get("carrito", [])
    if not carrito:
        return {"respuesta": "Tu carrito está vacío. ¿Te muestro el menú?"}
    detalle = "\n".join(
        f"  • {c['cantidad']}x {c['nombre']} — S/{c['precio'] * c['cantidad']:.2f}" for c in carrito
    )
    total = sum(c["precio"] * c["cantidad"] for c in carrito)
    return {"respuesta": f"🛒 Tu pedido:\n{detalle}\n\n*Total: S/{total:.2f}*\n\n¿Confirmamos?"}


def responder_directo(state: VentasState) -> dict:
    """Para GREETING, REJECT_ADDITION, OUT_OF_SCOPE y selección de pago.

    La respuesta ya la generó el clasificador (mensaje_sugerido); este nodo solo
    añade instrucciones fijas si se eligió método de pago.
    """
    intencion = state.get("intencion_actual")
    if intencion in ("SELECT_PAYMENT_YAPE", "SELECT_PAYMENT_PLIN"):
        metodo = "Yape" if intencion == "SELECT_PAYMENT_YAPE" else "Plin"
        return {
            "respuesta": (
                f"Perfecto, paga con *{metodo}* al número *{config.NUMERO_YAPE_RESTAURANTE}* "
                f"({config.NOMBRE_TITULAR_PAGO}) y envíame la captura del comprobante 📲."
            )
        }
    if intencion == "PAYMENT_MADE":
        # El cliente dice que ya pagó, pero validar requiere ver el comprobante.
        if state.get("estado_pedido"):
            return {
                "respuesta": (
                    "¡Genial! Para validar tu pago necesito la captura del comprobante "
                    "(Yape/Plin) 📲. ¿Me la envías, por favor?"
                )
            }
        return {
            "respuesta": (
                "No encuentro un pedido pendiente de pago a tu nombre. Si ya hiciste un "
                "pedido, envíame la captura del comprobante y lo valido 📲."
            )
        }
    return {}  # conserva el mensaje_sugerido del clasificador


def consultar_estado(state: VentasState) -> dict:
    with get_session() as session:
        pedido = (
            session.query(Order)
            .filter(Order.session_id == state.get("session_id", ""))
            .order_by(Order.id.desc())
            .first()
        )
        if not pedido:
            return {"respuesta": "No encuentro pedidos asociados a esta conversación."}
        estado = pedido.estado
        pid = pedido.id
    return {"respuesta": f"Tu pedido #{pid} está en estado: *{estado}*."}


def cancelar_pedido(state: VentasState) -> dict:
    with get_session() as session:
        pedido = (
            session.query(Order)
            .filter(Order.session_id == state.get("session_id", ""))
            .order_by(Order.id.desc())
            .first()
        )
        if not pedido:
            return {"respuesta": "No encuentro un pedido para cancelar."}
        if pedido.estado in (ENTREGADO, CERRADO):
            return {"respuesta": f"El pedido #{pedido.id} ya está {pedido.estado}, no se puede cancelar."}
        if pedido.estado != PAGO_PENDIENTE:
            return {
                "respuesta": (
                    f"El pedido #{pedido.id} ya está en preparación ({pedido.estado}); "
                    f"para cancelarlo contacta con el restaurante."
                )
            }
        pedido.estado = "CANCELADO"
        pid = pedido.id
    return {"respuesta": f"Tu pedido #{pid} fue cancelado. ¡Esperamos verte pronto!", "carrito": []}
