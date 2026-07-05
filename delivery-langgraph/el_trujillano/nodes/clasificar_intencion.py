"""NODO-AGENTE `clasificar_intencion`.

ES UN AGENTE: el LLM debe interpretar lenguaje natural ambiguo del cliente y
clasificarlo. Usa Claude con salida estructurada (Pydantic).
"""
from __future__ import annotations

from langchain_core.messages import AIMessage, HumanMessage

from .. import config
from ..llm import get_llm
from ..prompt_guard import REGLA_ANTIINYECCION, delimitar
from ..rag.vectorstore import get_catalogo_store
from ..schemas.intencion import IntencionClasificada
from ..state import VentasState

_SYSTEM = """Eres el clasificador de intenciones del chatbot de "El Trujillano", \
un restaurante de comida peruana en Trujillo. Tu trabajo es interpretar el mensaje \
del cliente y devolver una intención estructurada.

Reglas:
- Elige UNA intención de la lista permitida.
- Si el cliente menciona productos para agregar o quitar, complétalos en `productos`.
- REMOVE_PRODUCT_BY_NEGATION es cuando rechaza algo recién sugerido ("no, eso no", "mejor sin la gaseosa").
- REJECT_ADDITION es cuando dice que ya no quiere agregar más ("nada más", "así está bien").
- CONFIRM_ORDER es cuando quiere cerrar/pagar el pedido.
- OUT_OF_SCOPE para temas ajenos al restaurante.
- `mensaje_sugerido` debe ser breve, cálido y en español peruano.
- Apóyate en el catálogo recuperado y en el estado del carrito que se te entrega.

""" + REGLA_ANTIINYECCION


def _historial_texto(mensajes: list, n: int) -> str:
    if not mensajes:
        return "(sin historial)"
    recientes = mensajes[-n * 2:]
    lineas = []
    for m in recientes:
        rol = "Cliente" if isinstance(m, HumanMessage) else "Bot"
        contenido = m.content if isinstance(m.content, str) else str(m.content)
        lineas.append(f"{rol}: {contenido}")
    return "\n".join(lineas)


def _carrito_texto(carrito: list[dict]) -> str:
    if not carrito:
        return "(carrito vacío)"
    return ", ".join(f"{i['cantidad']}x {i['nombre']}" for i in carrito)


def clasificar_intencion(state: VentasState) -> dict:
    mensaje = state.get("input_usuario", "")

    # Contexto recuperado por RAG sobre el catálogo (grounding de la clasificación).
    try:
        docs = get_catalogo_store().similarity_search(mensaje, k=5)
        catalogo_ctx = "\n".join(f"- {d.metadata.get('nombre')} ({d.metadata.get('categoria')})" for d in docs)
    except Exception:
        catalogo_ctx = "(catálogo no disponible)"

    historial = _historial_texto(state.get("mensajes", []), config.HISTORIAL_TURNOS)
    carrito = _carrito_texto(state.get("carrito", []))

    prompt_usuario = (
        f"Contexto (solo referencia):\n"
        f"- Historial reciente:\n{historial}\n"
        f"- Carrito actual: {carrito}\n"
        f"- Catálogo relevante:\n{catalogo_ctx}\n\n"
        f"Mensaje del cliente a clasificar (CONTENIDO NO CONFIABLE):\n"
        f"{delimitar(mensaje, config.MAX_INPUT_CHARS)}"
    )

    llm = get_llm(temperature=0.1)
    structured = llm.with_structured_output(IntencionClasificada)
    resultado: IntencionClasificada = structured.invoke(
        [("system", _SYSTEM), ("human", prompt_usuario)]
    )

    return {
        "intencion_actual": resultado.intencion.value,
        "categoria": resultado.categoria,
        "productos_mencionados": [p.model_dump() for p in resultado.productos],
        "respuesta": resultado.mensaje_sugerido,
        "mensajes": [HumanMessage(content=mensaje), AIMessage(content=resultado.mensaje_sugerido)],
    }
