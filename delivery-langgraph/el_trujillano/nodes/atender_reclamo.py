"""NODO PUENTE `atender_reclamo`.

NO razona por sí mismo: delega en el DEEP AGENT de reclamos (sub-grafo
`grafo_reclamos`), que es quien planifica → recupera política (RAG) → genera →
evalúa con auto-corrección y, si no resuelve, escala a un humano (HITL).

Traduce el estado del grafo de ventas a la entrada del sub-grafo y vuelca su
`resolucion` en la `respuesta` del turno. Además le pasa el CONTEXTO de la
conversación (turnos previos) para que el reclamo FLUYA de forma natural en
lugar de responder siempre de cero. El import del sub-grafo es perezoso para no
acoplar la carga del paquete de nodos con la de los grafos.
"""
from __future__ import annotations

from langchain_core.messages import AIMessage

from ..state import VentasState


def _datos_pedido(session_id: str, pedido_id: int | None) -> str:
    """Resumen de los datos REALES del pedido para que el agente confirme sin escalar.

    Sin esto, el Deep Agent (solo texto) no puede resolver frases como 'a la misma
    dirección registrada' y termina escalando por falta de información.
    """
    from ..db.database import get_session
    from ..db.models import Order

    with get_session() as s:
        order = s.get(Order, pedido_id) if pedido_id else None
        if not order:
            order = (
                s.query(Order)
                .filter(Order.session_id == session_id)
                .order_by(Order.id.desc())
                .first()
            )
        if not order:
            return ""
        items = ", ".join(f"{i.cantidad}x {i.nombre}" for i in order.items) or "(sin ítems)"
        fecha = order.created_at.strftime("%d/%m/%Y %H:%M") if order.created_at else "?"
        return (
            f"Pedido #{order.id} | Fecha: {fecha} | Estado: {order.estado}\n"
            f"Cliente: {order.cliente_nombre or '?'} | Teléfono: {order.cliente_telefono or '?'}\n"
            f"Dirección registrada: {order.direccion or '(no registrada)'} "
            f"| Referencia: {order.referencia or '-'}\n"
            f"Productos del pedido: {items} | Total: S/{order.total:.2f}"
        )


def _contexto_conversacion(mensajes: list) -> str:
    """Arma un transcript breve de los turnos PREVIOS (excluye el turno actual).

    El turno actual son los dos últimos mensajes ya añadidos por el clasificador
    (mensaje del cliente + sugerencia). Los recortamos porque el mensaje actual
    ya viaja como `reclamo`. Solo tomamos los últimos turnos para no saturar.
    """
    previos = mensajes[:-2] if len(mensajes) > 2 else []
    previos = previos[-6:]
    lineas = []
    for m in previos:
        rol = "Cliente" if getattr(m, "type", "") == "human" else "Agente"
        contenido = m.content if isinstance(m.content, str) else str(m.content)
        lineas.append(f"{rol}: {contenido}")
    return "\n".join(lineas)


def atender_reclamo(state: VentasState) -> dict:
    mensaje = (state.get("input_usuario") or "").strip()
    # Una foto en pleno reclamo es EVIDENCIA (p. ej. el producto equivocado). El
    # Deep Agent es de texto, así que le señalamos que llegó la foto para que
    # pueda dar por recibida la evidencia y continuar con la solución.
    if state.get("imagen_comprobante"):
        nota = "[El cliente adjuntó una foto del producto recibido como evidencia del reclamo.]"
        mensaje = f"{mensaje} {nota}".strip()
    if not mensaje:
        return {
            "respuesta": "Cuéntame qué pasó con tu pedido para poder ayudarte con tu reclamo.",
            "reclamo_activo": True,
        }
    reclamo = mensaje

    from ..graphs.reclamos_graph import grafo_reclamos

    session_id = state.get("session_id", "")
    # Thread propio para el checkpointer del sub-grafo: no debe colisionar con el
    # hilo del grafo de ventas (mismo session_id, distinto sufijo).
    cfg = {"configurable": {"thread_id": f"{session_id}:reclamo"}}
    contexto = _contexto_conversacion(state.get("mensajes", []))
    datos_pedido = _datos_pedido(session_id, state.get("pedido_id"))
    escalado = False
    try:
        resultado = grafo_reclamos.invoke(
            {
                "session_id": session_id,
                "reclamo": reclamo,
                "order_id": state.get("pedido_id"),
                "contexto_conversacion": contexto,
                "datos_pedido": datos_pedido,
            },
            config=cfg,
        )
        respuesta = resultado.get("resolucion") or (
            "Registré tu reclamo y lo estamos revisando. Te contactaremos pronto. 🙏"
        )
        escalado = bool(resultado.get("escalado"))
    except Exception:
        respuesta = (
            "Tuvimos un problema al procesar tu reclamo automáticamente. "
            "Lo derivé a nuestro equipo de atención, que te contactará a la brevedad. 🙏"
        )
        escalado = True

    # Guardamos la respuesta REAL del Deep Agent en el historial para que el
    # siguiente turno tenga memoria. El modo reclamo sigue activo mientras se
    # conversa; se apaga al ESCALAR (ya pasó a un humano) para no quedar pegado.
    return {
        "respuesta": respuesta,
        "reclamo_activo": not escalado,
        "mensajes": [AIMessage(content=respuesta)],
    }
