"""NODO DETERMINISTA `recopilar_datos_cliente`.

NO ES UN AGENTE: máquina de pasos NAME -> PHONE -> ADDRESS -> REFERENCE ->
CONFIRMING con validaciones fijas (teléfono = 9 dígitos). Sin LLM.
"""
from __future__ import annotations

import re

from ..state import VentasState

PASO_NAME = "NAME"
PASO_PHONE = "PHONE"
PASO_ADDRESS = "ADDRESS"
PASO_REFERENCE = "REFERENCE"
PASO_CONFIRMING = "CONFIRMING"
PASO_DONE = "DONE"

_PREGUNTAS = {
    PASO_NAME: "Para registrar tu pedido, ¿a nombre de quién lo hacemos?",
    PASO_PHONE: "¿Cuál es tu número de celular? (9 dígitos)",
    PASO_ADDRESS: "¿A qué dirección lo enviamos?",
    PASO_REFERENCE: "¿Alguna referencia de la dirección? (color de fachada, cerca de...)",
}


def _resumen(datos: dict) -> str:
    return (
        f"Confirmemos tus datos:\n"
        f"  • Nombre: {datos.get('nombre')}\n"
        f"  • Celular: {datos.get('telefono')}\n"
        f"  • Dirección: {datos.get('direccion')}\n"
        f"  • Referencia: {datos.get('referencia')}\n\n"
        f"¿Está todo correcto? Responde *sí* para crear el pedido."
    )


def recopilar_datos_cliente(state: VentasState) -> dict:
    datos = dict(state.get("datos_cliente") or {})
    paso = datos.get("pendingDataStep")
    entrada = (state.get("input_usuario") or "").strip()

    # Inicio del flujo: no pedir datos si no hay nada que confirmar. Evita el
    # dead-end de recopilar nombre/teléfono/dirección para un carrito vacío.
    if not paso:
        if not (state.get("carrito") or []):
            return {
                "respuesta": "Tu carrito está vacío 🛒. Agrega algún plato del menú antes de confirmar el pedido.",
            }
        datos["pendingDataStep"] = PASO_NAME
        return {"datos_cliente": datos, "respuesta": _PREGUNTAS[PASO_NAME]}

    # Guarda la respuesta del paso anterior y avanza
    if paso == PASO_NAME:
        if not entrada:
            return {"datos_cliente": datos, "respuesta": _PREGUNTAS[PASO_NAME]}
        datos["nombre"] = entrada
        datos["pendingDataStep"] = PASO_PHONE
        return {"datos_cliente": datos, "respuesta": _PREGUNTAS[PASO_PHONE]}

    if paso == PASO_PHONE:
        telefono = re.sub(r"\D", "", entrada)
        if len(telefono) != 9:
            return {
                "datos_cliente": datos,
                "respuesta": "El celular debe tener 9 dígitos. ¿Me lo repites?",
            }
        datos["telefono"] = telefono
        datos["pendingDataStep"] = PASO_ADDRESS
        return {"datos_cliente": datos, "respuesta": _PREGUNTAS[PASO_ADDRESS]}

    if paso == PASO_ADDRESS:
        if not entrada:
            return {"datos_cliente": datos, "respuesta": _PREGUNTAS[PASO_ADDRESS]}
        datos["direccion"] = entrada
        datos["pendingDataStep"] = PASO_REFERENCE
        return {"datos_cliente": datos, "respuesta": _PREGUNTAS[PASO_REFERENCE]}

    if paso == PASO_REFERENCE:
        datos["referencia"] = entrada or "Sin referencia"
        datos["pendingDataStep"] = PASO_CONFIRMING
        return {"datos_cliente": datos, "respuesta": _resumen(datos)}

    if paso == PASO_CONFIRMING:
        if re.search(r"\b(si|sí|correcto|ok|dale|confirmo)\b", entrada.lower()):
            datos["pendingDataStep"] = PASO_DONE
            return {"datos_cliente": datos, "respuesta": ""}  # listo para crear_pedido
        # Reinicia la captura si algo está mal
        datos["pendingDataStep"] = PASO_NAME
        return {"datos_cliente": datos, "respuesta": "Corrijamos. " + _PREGUNTAS[PASO_NAME]}

    return {"datos_cliente": datos, "respuesta": ""}
