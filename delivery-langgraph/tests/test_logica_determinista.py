"""Pruebas de la lógica DETERMINISTA (sin LLM ni BD).

Verifican las reglas críticas: comparación de pago con número enmascarado y la
máquina de estados del pedido. Ejecutar:  python -m tests.test_logica_determinista
"""
from __future__ import annotations

from el_trujillano.estados import (
    EN_COCINA,
    PAGO_ENVIADO,
    PAGO_PENDIENTE,
    PAGO_VALIDADO,
    transicion_valida,
)
from el_trujillano.nodes.comparar_pago import _nombre_coincide, _numero_coincide


def test_numero_enmascarado_coincide():
    # El comprobante enmascara y muestra solo los últimos dígitos.
    assert _numero_coincide("*** *** 977", "938749977") is True
    assert _numero_coincide("977", "938749977") is True
    assert _numero_coincide("*** *** 123", "938749977") is False
    assert _numero_coincide(None, "938749977") is False


def test_nombre_coincide():
    assert _nombre_coincide("Restaurante El Trujillano", "Restaurante El Trujillano") is True
    assert _nombre_coincide("EL TRUJILLANO SAC", "Restaurante El Trujillano") is True
    assert _nombre_coincide("Otra Empresa", "Restaurante El Trujillano") is False
    assert _nombre_coincide(None, "Restaurante El Trujillano") is False


def test_regla_critica_cocina():
    # Solo se entra a cocina desde PAGO_VALIDADO.
    assert transicion_valida(PAGO_VALIDADO, EN_COCINA) is True
    assert transicion_valida(PAGO_PENDIENTE, EN_COCINA) is False
    assert transicion_valida(PAGO_ENVIADO, EN_COCINA) is False


def test_maquina_estados_basica():
    assert transicion_valida(PAGO_PENDIENTE, PAGO_ENVIADO) is True
    assert transicion_valida(PAGO_ENVIADO, PAGO_VALIDADO) is True
    assert transicion_valida(PAGO_VALIDADO, PAGO_PENDIENTE) is False


def _run():
    fns = [v for k, v in globals().items() if k.startswith("test_") and callable(v)]
    for fn in fns:
        fn()
        print(f"  ✓ {fn.__name__}")
    print(f"\n✅ {len(fns)} pruebas deterministas pasaron.")


if __name__ == "__main__":
    import sys

    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    _run()
