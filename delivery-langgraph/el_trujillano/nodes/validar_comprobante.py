"""NODO-AGENTE `validar_comprobante` (visión).

ES UN AGENTE: el LLM con visión debe LEER e INTERPRETAR la imagen del comprobante
Yape/Plin y extraer datos (incluso si el número está enmascarado como '*** *** 977').
Usa Claude (visión nativa) con salida estructurada.

OJO: este nodo solo EXTRAE datos. La DECISIÓN de aprobar/rechazar es del nodo
determinista `comparar_pago`.
"""
from __future__ import annotations

from langchain_core.messages import HumanMessage

from ..llm import get_llm
from ..schemas.comprobante import ComprobanteExtraido
from ..state import VentasState

_INSTRUCCION = (
    "Esta es una captura de un comprobante de pago por Yape o Plin (apps peruanas). "
    "Extrae el monto en soles, el método (Yape/Plin), el número del destinatario "
    "(conserva el enmascaramiento si lo hay, p. ej. '*** *** 977') y el nombre del "
    "destinatario. Indica si realmente parece un comprobante válido."
)


def validar_comprobante(state: VentasState) -> dict:
    imagen_b64 = state.get("imagen_comprobante")
    if not imagen_b64:
        return {
            "comprobante": None,
            "respuesta": "No recibí la imagen del comprobante. ¿Puedes enviar la captura del Yape/Plin?",
        }

    contenido = [
        {"type": "text", "text": _INSTRUCCION},
        {
            "type": "image",
            "source": {
                "type": "base64",
                "media_type": "image/jpeg",
                "data": imagen_b64,
            },
        },
    ]

    llm = get_llm(temperature=0.0)
    structured = llm.with_structured_output(ComprobanteExtraido)
    extraido: ComprobanteExtraido = structured.invoke([HumanMessage(content=contenido)])

    return {"comprobante": extraido.model_dump()}
