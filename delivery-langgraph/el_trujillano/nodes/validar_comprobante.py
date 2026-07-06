"""NODO-AGENTE `validar_comprobante` (visión).

ES UN AGENTE: el LLM con visión debe LEER e INTERPRETAR la imagen del comprobante
Yape/Plin y extraer datos (incluso si el número está enmascarado como '*** *** 977').
Usa Claude (visión nativa) con salida estructurada.

OJO: este nodo solo EXTRAE datos. La DECISIÓN de aprobar/rechazar es del nodo
determinista `comparar_pago`.
"""
from __future__ import annotations

import base64

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


# Formatos que la API de Claude acepta directamente.
_SOPORTADOS = {"image/jpeg", "image/png", "image/gif", "image/webp"}


def _detectar_media_type(imagen_b64: str) -> str | None:
    """Detecta el tipo real de la imagen por sus magic bytes.

    Claude exige que el media_type coincida con el contenido; enviar 'image/jpeg'
    para un PNG (u otro formato) provoca un 400. Devuelve None si el formato no se
    reconoce entre los soportados (jpeg, png, gif, webp).
    """
    try:
        cabecera = base64.b64decode(imagen_b64[:24])
    except Exception:
        return None
    if cabecera.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if cabecera[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if cabecera[:4] == b"GIF8":
        return "image/gif"
    if cabecera[:4] == b"RIFF" and cabecera[8:12] == b"WEBP":
        return "image/webp"
    return None


def _preparar_imagen(imagen_b64: str) -> tuple[str, str]:
    """Devuelve (media_type, base64) listos para Claude.

    Si el formato ya es soportado, se envía tal cual. Si no (BMP, TIFF, HEIC de
    iPhone, etc.), se convierte a PNG con Pillow para que igual funcione. Así el
    bot acepta prácticamente cualquier formato de imagen que suba el cliente.
    """
    media = _detectar_media_type(imagen_b64)
    if media in _SOPORTADOS:
        return media, imagen_b64
    try:
        import io

        from PIL import Image

        raw = base64.b64decode(imagen_b64)
        img = Image.open(io.BytesIO(raw)).convert("RGB")
        salida = io.BytesIO()
        img.save(salida, format="PNG")
        return "image/png", base64.b64encode(salida.getvalue()).decode("ascii")
    except Exception:
        # Último recurso: enviar como PNG y dejar que la API decida.
        return "image/png", imagen_b64


def validar_comprobante(state: VentasState) -> dict:
    imagen_b64 = state.get("imagen_comprobante")
    if not imagen_b64:
        return {
            "comprobante": None,
            "respuesta": "No recibí la imagen del comprobante. ¿Puedes enviar la captura del Yape/Plin?",
        }

    media_type, imagen_b64 = _preparar_imagen(imagen_b64)
    contenido = [
        {"type": "text", "text": _INSTRUCCION},
        {
            "type": "image",
            "source": {
                "type": "base64",
                "media_type": media_type,
                "data": imagen_b64,
            },
        },
    ]

    llm = get_llm(temperature=0.0)
    structured = llm.with_structured_output(ComprobanteExtraido)
    extraido: ComprobanteExtraido = structured.invoke([HumanMessage(content=contenido)])

    return {"comprobante": extraido.model_dump()}
