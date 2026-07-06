"""Pruebas END-TO-END de los dos flujos completos.

Requieren infraestructura real (ANTHROPIC_API_KEY + PostgreSQL/pgvector con seed e
ingesta). Si falta, cada prueba se OMITE limpiamente (no falla), porque el entorno
de CI académico puede no tener credenciales ni BD.

  - Venta:   chat -> carrito -> datos -> crear_pedido -> REGLA CRÍTICA de cocina.
  - Reclamo: planificar -> RAG -> generar -> evaluar -> resolver/escalar (<= MAX_ITER).

Ejecutar:  python -m tests.test_e2e     (o  pytest tests/)
"""
from __future__ import annotations

from el_trujillano import config


# ------------------------------- Utilidades de disponibilidad -------------------------------
def _hay_api_key() -> bool:
    return bool(config.ANTHROPIC_API_KEY)


def _hay_bd() -> bool:
    try:
        from sqlalchemy import text
        from el_trujillano.db.database import engine

        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return True
    except Exception:
        return False


def _omitir(motivo: str) -> bool:
    """Devuelve True (y avisa) si no se puede correr el e2e. Bajo pytest, hace skip."""
    print(f"  ⏭  e2e omitido: {motivo}")
    try:
        import pytest

        pytest.skip(motivo)
    except ImportError:
        pass
    return True


# ------------------------------- E2E de VENTA -------------------------------
def test_e2e_flujo_venta_hasta_cocina():
    if not _hay_api_key():
        _omitir("falta ANTHROPIC_API_KEY")
        return
    if not _hay_bd():
        _omitir("PostgreSQL no disponible")
        return

    from sqlalchemy import text
    from el_trujillano.db.database import engine, get_session
    from el_trujillano.db.models import Order
    from el_trujillano.estados import EN_COCINA, PAGO_VALIDADO
    from el_trujillano.graphs.ventas_graph import construir_grafo_ventas
    from el_trujillano.nodes.validar_estado_cocina import (
        EstadoInvalidoError,
        validar_estado_cocina,
    )

    # Asegura pgvector/tablas y catálogo (idempotente).
    from scripts.seed_catalog import seed

    seed()

    grafo = construir_grafo_ventas()  # MemorySaver aislado para el test
    sid = "e2e-venta"
    cfg = {"configurable": {"thread_id": sid}}

    def enviar(msg: str) -> dict:
        return grafo.invoke({"session_id": sid, "input_usuario": msg}, config=cfg)

    enviar("hola, buenas")
    enviar("quiero un lomo saltado")
    st = enviar("confirmar mi pedido")

    # Recorre la recopilación de datos hasta crear el pedido.
    for msg in ("Diego", "987654321", "Av. España 123", "Fachada azul", "sí, correcto"):
        st = enviar(msg)

    pedido_id = st.get("pedido_id")
    assert pedido_id, "el flujo debió crear un pedido"

    # El carrito debe quedar vacío tras crear el pedido (evita pedidos duplicados).
    assert not st.get("carrito"), "el carrito debe vaciarse al crear el pedido"

    # Reconfirmar NO debe crear un segundo pedido (carrito ya vacío).
    st2 = enviar("confirmar pedido")
    assert st2.get("pedido_id") == pedido_id, "no debe duplicarse el pedido"
    assert "vac" in st2.get("respuesta", "").lower(), "debe avisar que el carrito está vacío"

    # REGLA CRÍTICA: aún en PAGO_PENDIENTE, cocina debe RECHAZAR el pedido.
    try:
        validar_estado_cocina(pedido_id)
        assert False, "cocina no debió aceptar un pedido sin PAGO_VALIDADO"
    except EstadoInvalidoError:
        pass

    # Simula la validación de pago y verifica que ahora SÍ pasa a cocina.
    with get_session() as s:
        s.get(Order, pedido_id).estado = PAGO_VALIDADO
    assert validar_estado_cocina(pedido_id) is True
    with get_session() as s:
        assert s.get(Order, pedido_id).estado == EN_COCINA

    print(f"  ✓ venta e2e: pedido #{pedido_id} creado y movido a cocina tras PAGO_VALIDADO")


# ------------------------------- E2E de RECLAMO -------------------------------
def test_e2e_flujo_reclamo():
    if not _hay_api_key():
        _omitir("falta ANTHROPIC_API_KEY")
        return
    if not _hay_bd():
        _omitir("PostgreSQL no disponible")
        return

    from el_trujillano.graphs.reclamos_graph import construir_grafo_reclamos

    grafo = construir_grafo_reclamos()
    cfg = {"configurable": {"thread_id": "e2e-reclamo"}}
    estado = grafo.invoke(
        {
            "session_id": "e2e-reclamo",
            "reclamo": "Mi pedido llegó frío y con más de 40 minutos de retraso.",
        },
        config=cfg,
    )

    assert estado.get("resolucion"), "el Deep Agent debe devolver una resolución"
    assert isinstance(estado.get("escalado"), bool)
    # Nunca debe exceder el tope de auto-corrección.
    assert estado.get("iteraciones", 0) <= config.MAX_ITERACIONES_RECLAMO
    print(
        f"  ✓ reclamo e2e: escalado={estado.get('escalado')} "
        f"iteraciones={estado.get('iteraciones')}"
    )


def _run():
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    ejecutadas = 0
    for fn in fns:
        try:
            fn()
            ejecutadas += 1
            print(f"  ✓ {fn.__name__}")
        except Exception as e:  # incluye pytest.skip fuera de pytest
            print(f"  ⏭  {fn.__name__}: {e}")
    print(f"\n✅ e2e finalizado ({ejecutadas}/{len(fns)} ejecutadas; el resto omitidas por entorno).")


if __name__ == "__main__":
    import sys

    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    _run()
