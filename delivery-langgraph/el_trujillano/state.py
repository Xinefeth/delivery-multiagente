"""Estado compartido de los grafos (TypedDict).

El estado lo mantiene el GRAFO de LangGraph, no una clase "orquestador". El grafo
decide transiciones y delega en los nodos según este estado.
"""
from __future__ import annotations

from typing import Annotated, Any, TypedDict

from langgraph.graph.message import add_messages


# ----------------------------- GRAFO DE VENTAS -----------------------------
class VentasState(TypedDict, total=False):
    session_id: str

    # Entrada del turno actual
    input_usuario: str
    imagen_comprobante: str | None  # base64 de la captura, si la hay

    # Historial conversacional (se recortan los últimos turnos al clasificar)
    mensajes: Annotated[list, add_messages]

    # Resultado del clasificador (agente)
    intencion_actual: str | None
    categoria: str | None
    productos_mencionados: list[dict]

    # Carrito en sesión: [{product_id, nombre, precio, cantidad}]
    carrito: list[dict]

    # Recopilación de datos del cliente con sub-estado pendingDataStep
    # {nombre, telefono, direccion, referencia, pendingDataStep}
    datos_cliente: dict[str, Any]

    # Pedido
    pedido_id: int | None
    estado_pedido: str | None

    # Pago
    comprobante: dict | None
    resultado_validacion: dict | None

    # Reclamo en curso: mientras esté activo, las fotos y mensajes de seguimiento
    # van al Deep Agent de reclamos (no al validador de pago).
    reclamo_activo: bool

    # Salida del turno hacia el cliente
    respuesta: str


# --------------------- DEEP AGENT DE RECLAMOS (sub-grafo) ---------------------
class ReclamoState(TypedDict, total=False):
    session_id: str
    reclamo: str          # último mensaje del cliente en el reclamo
    order_id: int | None
    contexto_conversacion: str  # turnos previos del reclamo (para que fluya)
    datos_pedido: str     # datos reales del pedido (dirección, ítems, fecha) para confirmar sin escalar

    plan: dict | None     # PlanReclamo serializado
    consulta: str         # consulta de búsqueda actual
    documentos: list[str] # fragmentos de política recuperados
    propuesta: str        # propuesta de solución generada
    veredicto: dict | None  # VeredictoReclamo serializado

    iteraciones: int
    historial: list[str]  # consultas ya intentadas

    # Salida
    resolucion: str
    escalado: bool
