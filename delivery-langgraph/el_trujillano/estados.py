"""Estados de la máquina del pedido y transiciones permitidas.

Esto es lógica DETERMINISTA pura (un diccionario de aristas válidas). No es un
agente: no hay razonamiento de lenguaje, solo reglas fijas.
"""
from __future__ import annotations

# Estados del pedido (coinciden con la columna Order.estado en la BD)
PAGO_PENDIENTE = "PAGO_PENDIENTE"
PAGO_ENVIADO = "PAGO_ENVIADO"
PAGO_VALIDADO = "PAGO_VALIDADO"
PAGO_RECHAZADO = "PAGO_RECHAZADO"
EN_COCINA = "EN_COCINA"
LISTO_PARA_REPARTO = "LISTO_PARA_REPARTO"
EN_REPARTO = "EN_REPARTO"
ENTREGADO = "ENTREGADO"
CERRADO = "CERRADO"

# Aristas válidas de la máquina de estados (origen -> destinos permitidos)
TRANSICIONES: dict[str, set[str]] = {
    PAGO_PENDIENTE: {PAGO_ENVIADO},
    PAGO_ENVIADO: {PAGO_VALIDADO, PAGO_RECHAZADO},
    PAGO_RECHAZADO: {PAGO_ENVIADO},  # reenvío del comprobante
    PAGO_VALIDADO: {EN_COCINA},      # REGLA CRÍTICA: solo desde PAGO_VALIDADO
    EN_COCINA: {LISTO_PARA_REPARTO},
    LISTO_PARA_REPARTO: {EN_REPARTO},
    EN_REPARTO: {ENTREGADO},
    ENTREGADO: {CERRADO},
    CERRADO: set(),
}


def transicion_valida(origen: str, destino: str) -> bool:
    """True si `origen -> destino` es una arista permitida."""
    return destino in TRANSICIONES.get(origen, set())
