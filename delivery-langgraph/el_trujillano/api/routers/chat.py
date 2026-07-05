"""Router del chatbot. Adapta el grafo de ventas (LangGraph) al contrato del widget.

El widget espera de POST /api/chat/message: { message, type, orderStatus, orderId, quickReplies? }.
Maneja también la imagen del comprobante (multipart) y el polling de repartidor/encuesta.
"""
from __future__ import annotations

import base64
import os
import time

from fastapi import APIRouter, File, Form, UploadFile
from sqlalchemy.orm import joinedload, selectinload

from ... import config
from ...db.database import get_session
from ...db.models import Notification, Order
from ...estados import CERRADO, EN_REPARTO, ENTREGADO
from ...graphs.ventas_graph import grafo_ventas
from ..serializers import order_to_dict

router = APIRouter()

# Quick replies contextuales según la intención detectada por el clasificador.
_QUICK_REPLIES = {
    "ADD_PRODUCT": ["Confirmar pedido", "Agregar más productos"],
    "REMOVE_PRODUCT": ["Confirmar pedido", "Agregar más productos"],
    "REMOVE_PRODUCT_BY_NEGATION": ["Confirmar pedido", "Agregar más productos"],
    "VIEW_CART": ["Confirmar pedido", "Agregar más productos"],
    "GREETING": ["Ver menú", "Ver mi carrito"],
    "SHOW_MENU": ["Ver mi carrito"],
}


def _derivar_order_status(state: dict) -> str:
    if state.get("estado_pedido"):
        return state["estado_pedido"]
    paso = (state.get("datos_cliente") or {}).get("pendingDataStep")
    if paso and paso != "DONE":
        return "ESPERANDO_DATOS_CLIENTE"
    if state.get("carrito"):
        return "CARRITO_ACTIVO"
    return "INICIO"


async def _procesar(session_id: str, message: str, file: UploadFile | None) -> dict:
    imagen_b64 = None
    proof_url = None
    if file is not None:
        contenido = await file.read()
        os.makedirs(config.UPLOADS_DIR, exist_ok=True)
        nombre = f"{int(time.time() * 1000)}-{(file.filename or 'comprobante').replace(' ', '_')}"
        ruta = os.path.join(config.UPLOADS_DIR, nombre)
        with open(ruta, "wb") as f:
            f.write(contenido)
        imagen_b64 = base64.b64encode(contenido).decode("ascii")
        proof_url = f"/uploads/{nombre}"

    cfg = {"configurable": {"thread_id": session_id}}
    state = grafo_ventas.invoke(
        {"session_id": session_id, "input_usuario": message, "imagen_comprobante": imagen_b64},
        config=cfg,
    )

    # Guarda la ruta del comprobante en el pedido para que el admin lo vea.
    pedido_id = state.get("pedido_id")
    if proof_url and pedido_id:
        with get_session() as s:
            order = s.get(Order, pedido_id)
            if order:
                order.payment_proof_url = proof_url

    intencion = state.get("intencion_actual")
    return {
        "message": state.get("respuesta", "No pude procesar tu solicitud."),
        "type": "text",
        "orderStatus": _derivar_order_status(state),
        "orderId": str(pedido_id) if pedido_id else None,
        "intent": intencion,
        "quickReplies": _QUICK_REPLIES.get(intencion, []),
    }


@router.post("/message")
async def smart_message(
    sessionId: str = Form(...),
    message: str = Form(""),
    attachment: UploadFile | None = File(None),
):
    return await _procesar(sessionId, message, attachment)


@router.post("")
async def chat_legacy(
    sessionId: str = Form(...),
    message: str = Form(""),
    attachment: UploadFile | None = File(None),
):
    # Alias del chatbot inteligente (antes era el OrchestratorAgent legacy).
    return await _procesar(sessionId, message, attachment)


def _ultimo_pedido(session, session_id: str) -> Order | None:
    return (
        session.query(Order)
        .options(selectinload(Order.items), joinedload(Order.driver))
        .filter(Order.session_id == session_id)
        .order_by(Order.id.desc())
        .first()
    )


@router.get("/status/{session_id}")
def chat_status(session_id: str):
    with get_session() as session:
        order = _ultimo_pedido(session, session_id)
        return {
            "order": order_to_dict(order) if order else None,
            "chatState": order.estado if order else "INICIO",
        }


@router.get("/driver-check/{session_id}")
def driver_check(session_id: str):
    with get_session() as session:
        order = _ultimo_pedido(session, session_id)
        if order and order.estado == EN_REPARTO and order.driver:
            return {
                "assigned": True,
                "message": (
                    f"Tu pedido está en camino 🛵\n\n*Repartidor:* {order.driver.name}\n"
                    f"*Teléfono:* {order.driver.phone}\n\n¡Ya casi llega!"
                ),
            }
        return {"assigned": False}


@router.get("/survey-check/{session_id}")
def survey_check(session_id: str):
    with get_session() as session:
        order = _ultimo_pedido(session, session_id)
        if order and order.estado in (ENTREGADO, CERRADO):
            return {
                "survey": True,
                "message": (
                    "🎉 ¡Tu pedido fue entregado! Gracias por preferir *El Trujillano*.\n\n"
                    "⭐ ¿Cómo calificarías tu experiencia? Escribe un número del *1 al 5*."
                ),
            }
        return {"survey": False}


@router.get("/notifications/{order_id}")
def notifications(order_id: int):
    with get_session() as session:
        notifs = (
            session.query(Notification)
            .filter(Notification.order_id == order_id, Notification.canal == "cliente")
            .order_by(Notification.created_at.asc())
            .all()
        )
        return [
            {"id": str(n.id), "message": n.mensaje, "channel": n.canal, "sent_at": n.created_at.isoformat() if n.created_at else None}
            for n in notifs
        ]
