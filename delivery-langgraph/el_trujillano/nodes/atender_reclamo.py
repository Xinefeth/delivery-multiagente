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
    try:
        resultado = grafo_reclamos.invoke(
            {
                "session_id": session_id,
                "reclamo": reclamo,
                "order_id": state.get("pedido_id"),
                "contexto_conversacion": contexto,
            },
            config=cfg,
        )
        respuesta = resultado.get("resolucion") or (
            "Registré tu reclamo y lo estamos revisando. Te contactaremos pronto. 🙏"
        )
    except Exception:
        respuesta = (
            "Tuvimos un problema al procesar tu reclamo automáticamente. "
            "Lo derivé a nuestro equipo de atención, que te contactará a la brevedad. 🙏"
        )

    # Guardamos la respuesta REAL del Deep Agent en el historial para que el
    # siguiente turno del reclamo tenga memoria de qué se preguntó/ofreció, y
    # mantenemos el modo reclamo activo (la foto/seguimiento no es un pago).
    return {
        "respuesta": respuesta,
        "reclamo_activo": True,
        "mensajes": [AIMessage(content=respuesta)],
    }
