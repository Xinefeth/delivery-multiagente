"""NODO DETERMINISTA `comparar_pago`.

NO ES UN AGENTE: compara los datos EXTRAÍDOS del comprobante (por el nodo de visión)
contra el pedido. Pura aritmética y comparación de strings:
  - monto dentro de ±S/0.10
  - número de destino coincide (soporta enmascarado '*** *** 977')
  - nombre del destinatario coincide
Decide PAGO_VALIDADO o PAGO_RECHAZADO.
"""
from __future__ import annotations

import re

from .. import config
from ..db.database import get_session
from ..db.models import Order
from ..estados import PAGO_RECHAZADO, PAGO_VALIDADO
from ..state import VentasState


def _solo_digitos(texto: str | None) -> str:
    return re.sub(r"\D", "", texto or "")


def _numero_coincide(extraido: str | None, esperado: str) -> bool:
    """Compara por los últimos dígitos visibles (los comprobantes enmascaran el resto)."""
    d_ext = _solo_digitos(extraido)
    d_esp = _solo_digitos(esperado)
    if not d_ext:
        return False
    n = min(len(d_ext), 3)
    return d_esp.endswith(d_ext[-n:])


def _nombre_coincide(extraido: str | None, esperado: str) -> bool:
    if not extraido:
        return False
    ext = extraido.lower()
    # Coincide si comparten al menos una palabra significativa del titular.
    palabras = [w for w in re.split(r"\W+", esperado.lower()) if len(w) > 2]
    return any(w in ext for w in palabras)


def comparar_pago(state: VentasState) -> dict:
    comprobante = state.get("comprobante") or {}
    pedido_id = state.get("pedido_id")

    if not pedido_id:
        return {"respuesta": "No encuentro un pedido pendiente de pago para validar."}

    with get_session() as session:
        pedido = session.get(Order, pedido_id)
        if not pedido:
            return {"respuesta": "No encuentro el pedido indicado."}

        monto_ext = comprobante.get("monto")
        ok_monto = monto_ext is not None and abs(float(monto_ext) - pedido.total) <= config.TOLERANCIA_MONTO
        ok_numero = _numero_coincide(comprobante.get("numero_destinatario"), config.NUMERO_YAPE_RESTAURANTE)
        ok_nombre = _nombre_coincide(comprobante.get("nombre_destinatario"), config.NOMBRE_TITULAR_PAGO)

        validado = bool(comprobante.get("es_comprobante_valido")) and ok_monto and ok_numero and ok_nombre

        pedido.estado = PAGO_VALIDADO if validado else PAGO_RECHAZADO
        pedido.monto_pagado = monto_ext
        pedido.metodo_pago = comprobante.get("metodo")
        pedido.numero_destino_pago = comprobante.get("numero_destinatario")
        pedido.nombre_destino_pago = comprobante.get("nombre_destinatario")
        nuevo_estado = pedido.estado
        total = pedido.total

    resultado = {
        "validado": validado,
        "ok_monto": ok_monto,
        "ok_numero": ok_numero,
        "ok_nombre": ok_nombre,
    }

    if validado:
        respuesta = (
            f"✅ ¡Pago validado! Tu pedido #{pedido_id} pasa a cocina. "
            f"Te avisaremos cuando salga a reparto."
        )
    else:
        motivos = []
        if not ok_monto:
            motivos.append(f"el monto no coincide (esperado S/{total:.2f})")
        if not ok_numero:
            motivos.append("el número de destino no coincide")
        if not ok_nombre:
            motivos.append("el titular no coincide")
        detalle = "; ".join(motivos) or "no pude validar el comprobante"
        respuesta = (
            f"⚠️ No pude validar tu pago: {detalle}. "
            f"Por favor revisa y reenvía la captura correcta."
        )

    return {
        "estado_pedido": nuevo_estado,
        "resultado_validacion": resultado,
        "respuesta": respuesta,
    }
