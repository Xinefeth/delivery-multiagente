"""Pruebas de INTEGRACIÓN de las transiciones de los grafos (sin LLM ni BD).

Verifican el cableado de las aristas condicionales (la "máquina de estados" que
implementa el grafo) y la regla de escalamiento del Deep Agent:

  - route_entry / route_intencion / route_post_datos  (grafo de ventas)
  - route_evaluacion                                   (Deep Agent de reclamos)
  - sub-máquina de recopilar_datos_cliente             (NAME->...->DONE)

Ejecutar:  python -m tests.test_integracion_grafos   (o  pytest tests/)
"""
from __future__ import annotations

from el_trujillano import config
from el_trujillano.graphs.ventas_graph import (
    route_entry,
    route_intencion,
    route_post_datos,
)
from el_trujillano.nodes.recopilar_datos_cliente import (
    PASO_CONFIRMING,
    PASO_DONE,
    recopilar_datos_cliente,
)
from el_trujillano.reclamos.nodos import route_evaluacion


# ------------------------------- Grafo de ventas: entrada -------------------------------
def test_route_entry_prioriza_comprobante():
    # Si hay imagen de comprobante, va directo a validarlo (rama de pago).
    assert route_entry({"imagen_comprobante": "b64..."}) == "validar_comprobante"


def test_route_entry_continua_recopilacion_datos():
    estado = {"datos_cliente": {"pendingDataStep": "PHONE"}}
    assert route_entry(estado) == "recopilar_datos_cliente"


def test_route_entry_caso_general_va_al_clasificador():
    assert route_entry({"input_usuario": "hola"}) == "clasificar_intencion"
    # DONE ya no es "en curso": vuelve al clasificador.
    assert route_entry({"datos_cliente": {"pendingDataStep": PASO_DONE}}) == "clasificar_intencion"


# ------------------------------- Grafo de ventas: despacho por intención -------------------------------
def test_route_intencion_mapea_cada_intencion():
    casos = {
        "SHOW_MENU": "consultar_menu",
        "ADD_PRODUCT": "gestionar_carrito",
        "REMOVE_PRODUCT_BY_NEGATION": "gestionar_carrito",
        "VIEW_CART": "ver_carrito",
        "CONFIRM_ORDER": "recopilar_datos_cliente",
        "CHECK_ORDER_STATUS": "consultar_estado",
        "CANCEL_ORDER": "cancelar_pedido",
        "OUT_OF_SCOPE": "responder_directo",
    }
    for intencion, destino in casos.items():
        assert route_intencion({"intencion_actual": intencion}) == destino


def test_route_intencion_desconocida_responde_directo():
    assert route_intencion({"intencion_actual": "INEXISTENTE"}) == "responder_directo"


# ------------------------------- Grafo de ventas: post-datos -------------------------------
def test_route_post_datos_crea_pedido_solo_si_DONE():
    assert route_post_datos({"datos_cliente": {"pendingDataStep": PASO_DONE}}) == "crear_pedido"
    assert route_post_datos({"datos_cliente": {"pendingDataStep": PASO_CONFIRMING}}) == "finalizar"


# ------------------------------- Deep Agent: escalamiento tras MAX_ITERACIONES -------------------------------
def test_route_evaluacion_resuelve_si_suficiente():
    assert route_evaluacion({"veredicto": {"suficiente": True}, "iteraciones": 1}) == "responder"


def test_route_evaluacion_reintenta_si_quedan_intentos():
    estado = {"veredicto": {"suficiente": False}, "iteraciones": 1}
    assert route_evaluacion(estado) == "recuperar"


def test_route_evaluacion_escala_tras_max_iteraciones():
    # Regla del PASO 4: supera MAX_ITERACIONES -> HITL (escalar).
    estado = {"veredicto": {"suficiente": False}, "iteraciones": config.MAX_ITERACIONES_RECLAMO}
    assert route_evaluacion(estado) == "escalar"


# ------------------------------- Sub-máquina recopilar_datos_cliente (integración de pasos) -------------------------------
def test_recopilar_datos_flujo_completo():
    estado = {"datos_cliente": {}, "input_usuario": ""}

    # Arranque -> pregunta el nombre
    out = recopilar_datos_cliente(estado)
    assert out["datos_cliente"]["pendingDataStep"] == "NAME"

    # NAME -> PHONE
    out = recopilar_datos_cliente({"datos_cliente": out["datos_cliente"], "input_usuario": "Diego"})
    assert out["datos_cliente"]["nombre"] == "Diego"
    assert out["datos_cliente"]["pendingDataStep"] == "PHONE"

    # PHONE inválido (no 9 dígitos) -> se queda en PHONE
    out = recopilar_datos_cliente({"datos_cliente": out["datos_cliente"], "input_usuario": "123"})
    assert out["datos_cliente"]["pendingDataStep"] == "PHONE"

    # PHONE válido -> ADDRESS
    out = recopilar_datos_cliente({"datos_cliente": out["datos_cliente"], "input_usuario": "987654321"})
    assert out["datos_cliente"]["telefono"] == "987654321"
    assert out["datos_cliente"]["pendingDataStep"] == "ADDRESS"

    # ADDRESS -> REFERENCE
    out = recopilar_datos_cliente({"datos_cliente": out["datos_cliente"], "input_usuario": "Av. España 123"})
    assert out["datos_cliente"]["pendingDataStep"] == "REFERENCE"

    # REFERENCE -> CONFIRMING (muestra el resumen)
    out = recopilar_datos_cliente({"datos_cliente": out["datos_cliente"], "input_usuario": "Fachada azul"})
    assert out["datos_cliente"]["pendingDataStep"] == PASO_CONFIRMING

    # CONFIRMING con "sí" -> DONE (listo para crear_pedido)
    out = recopilar_datos_cliente({"datos_cliente": out["datos_cliente"], "input_usuario": "sí, correcto"})
    assert out["datos_cliente"]["pendingDataStep"] == PASO_DONE
    # Y el router post-datos ya despacharía a crear_pedido:
    assert route_post_datos(out) == "crear_pedido"


def _run():
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for fn in fns:
        fn()
        print(f"  ✓ {fn.__name__}")
    print(f"\n✅ {len(fns)} pruebas de integración pasaron.")


if __name__ == "__main__":
    import sys

    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    _run()
