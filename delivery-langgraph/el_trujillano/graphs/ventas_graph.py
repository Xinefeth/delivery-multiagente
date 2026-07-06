"""GRAFO DE VENTAS (StateGraph de LangGraph).

EL ORQUESTADOR ES ESTE GRAFO: no existe una clase "OrchestratorAgent". El propio
StateGraph mantiene el estado, decide las transiciones (aristas condicionales) y
delega en los nodos. Un turno del cliente = una invocación del grafo.

Routing:
  START
    ├─(hay imagen de comprobante)──────────────► validar_comprobante ► comparar_pago ► fin
    ├─(pendingDataStep en curso)───────────────► recopilar_datos_cliente ─┐
    └─(caso general)──► clasificar_intencion(AGENTE) ──► router_intencion  │
                                                                           │
  router_intencion despacha al nodo determinista según la intención.       │
  recopilar_datos_cliente, al completar (DONE), encadena ► crear_pedido ◄──┘
"""
from __future__ import annotations

from langgraph.graph import END, START, StateGraph

from .checkpointer import build_checkpointer
from ..nodes.atender_reclamo import atender_reclamo
from ..nodes.clasificar_intencion import clasificar_intencion
from ..nodes.comparar_pago import comparar_pago
from ..nodes.consultar_menu import consultar_menu
from ..nodes.crear_pedido import crear_pedido
from ..nodes.extras import (
    cancelar_pedido,
    consultar_estado,
    responder_directo,
    ver_carrito,
)
from ..nodes.gestionar_carrito import gestionar_carrito
from ..nodes.guardar_notificacion import guardar_notificacion_node
from ..nodes.recopilar_datos_cliente import PASO_DONE, recopilar_datos_cliente
from ..nodes.validar_comprobante import validar_comprobante
from ..state import VentasState

# --------------------------- Aristas condicionales ---------------------------


def route_entry(state: VentasState) -> str:
    """Decide el punto de entrada del turno (determinista)."""
    if state.get("imagen_comprobante"):
        # Una foto durante un reclamo es EVIDENCIA del reclamo, no un comprobante
        # de pago. Solo se interpreta como comprobante si NO hay reclamo en curso.
        if state.get("reclamo_activo"):
            return "atender_reclamo"
        return "validar_comprobante"
    paso = (state.get("datos_cliente") or {}).get("pendingDataStep")
    if paso and paso != PASO_DONE:
        return "recopilar_datos_cliente"
    return "clasificar_intencion"


_DESTINO_INTENCION = {
    "SHOW_MENU": "consultar_menu",
    "SHOW_CATEGORY": "consultar_menu",
    "ADD_PRODUCT": "gestionar_carrito",
    "REMOVE_PRODUCT": "gestionar_carrito",
    "REMOVE_PRODUCT_BY_NEGATION": "gestionar_carrito",
    "VIEW_CART": "ver_carrito",
    "CONFIRM_ORDER": "recopilar_datos_cliente",
    "CHECK_ORDER_STATUS": "consultar_estado",
    "CANCEL_ORDER": "cancelar_pedido",
    "FILE_COMPLAINT": "atender_reclamo",
    "SELECT_PAYMENT_YAPE": "responder_directo",
    "SELECT_PAYMENT_PLIN": "responder_directo",
    "PAYMENT_MADE": "responder_directo",
    "GREETING": "responder_directo",
    "REJECT_ADDITION": "responder_directo",
    "OUT_OF_SCOPE": "responder_directo",
}


def route_intencion(state: VentasState) -> str:
    return _DESTINO_INTENCION.get(state.get("intencion_actual"), "responder_directo")


# Nodos destino posibles del despacho por intención (para el mapa de la arista
# condicional, que espera los NOMBRES DE NODO, no las claves de intención).
_DESTINOS_INTENCION = sorted(set(_DESTINO_INTENCION.values()))


def route_post_datos(state: VentasState) -> str:
    """Si ya se confirmaron los datos (DONE), crea el pedido; si no, termina el turno."""
    paso = (state.get("datos_cliente") or {}).get("pendingDataStep")
    return "crear_pedido" if paso == PASO_DONE else "finalizar"


# ------------------------------ Construcción --------------------------------


def construir_grafo_ventas(checkpointer=None):
    g = StateGraph(VentasState)

    # Nodos
    g.add_node("clasificar_intencion", clasificar_intencion)       # AGENTE
    g.add_node("validar_comprobante", validar_comprobante)         # AGENTE (visión)
    g.add_node("consultar_menu", consultar_menu)
    g.add_node("gestionar_carrito", gestionar_carrito)
    g.add_node("ver_carrito", ver_carrito)
    g.add_node("recopilar_datos_cliente", recopilar_datos_cliente)
    g.add_node("crear_pedido", crear_pedido)
    g.add_node("comparar_pago", comparar_pago)
    g.add_node("consultar_estado", consultar_estado)
    g.add_node("cancelar_pedido", cancelar_pedido)
    g.add_node("atender_reclamo", atender_reclamo)                  # PUENTE al Deep Agent
    g.add_node("responder_directo", responder_directo)
    g.add_node("finalizar", guardar_notificacion_node)

    # Entrada condicional
    g.add_conditional_edges(
        START,
        route_entry,
        {
            "validar_comprobante": "validar_comprobante",
            "atender_reclamo": "atender_reclamo",
            "recopilar_datos_cliente": "recopilar_datos_cliente",
            "clasificar_intencion": "clasificar_intencion",
        },
    )

    # Despacho por intención
    g.add_conditional_edges("clasificar_intencion", route_intencion, _DESTINOS_INTENCION)

    # Flujo de pago
    g.add_edge("validar_comprobante", "comparar_pago")
    g.add_edge("comparar_pago", "finalizar")

    # Flujo de datos -> creación de pedido
    g.add_conditional_edges(
        "recopilar_datos_cliente",
        route_post_datos,
        {"crear_pedido": "crear_pedido", "finalizar": "finalizar"},
    )
    g.add_edge("crear_pedido", "finalizar")

    # Nodos terminales -> finalizar (persiste notificación al cliente)
    for nodo in (
        "consultar_menu",
        "gestionar_carrito",
        "ver_carrito",
        "consultar_estado",
        "cancelar_pedido",
        "atender_reclamo",
        "responder_directo",
    ):
        g.add_edge(nodo, "finalizar")

    g.add_edge("finalizar", END)

    return g.compile(checkpointer=checkpointer or build_checkpointer())


# Instancia por defecto. El checkpointer lo decide LANGGRAPH_CHECKPOINTER
# (MemorySaver en desarrollo/tests; PostgresSaver en producción/Render).
grafo_ventas = construir_grafo_ventas()
