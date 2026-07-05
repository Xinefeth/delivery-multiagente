"""Evaluación del sistema contra el golden set (PASO 8).

Mide las métricas de éxito definidas en el PASO 1/8:

  1. Precisión de clasificación de intención   (agente LLM — requiere ANTHROPIC_API_KEY)
  2. Exactitud de validación de pago            (lógica determinista — siempre corre)
  3. % de reclamos resueltos sin escalar        (Deep Agent — requiere API key + BD/RAG)
     + nº promedio de iteraciones del Deep Agent
     + tasa de escalamiento a humano (HITL)

Latencia y tokens por invocación se leen desde LangSmith (LANGSMITH_TRACING=true);
este harness reporta acierto/coste lógico y remite a LangSmith para el detalle fino.

Uso:  python -m eval.evaluar
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

from el_trujillano import config
from el_trujillano.nodes.comparar_pago import _nombre_coincide, _numero_coincide

GOLDEN = Path(__file__).resolve().parent / "golden_set.json"


def _cargar() -> dict:
    return json.loads(GOLDEN.read_text(encoding="utf-8"))


# ------------------------- 2) Validación de pago (determinista) -------------------------
def _decidir_pago(pedido_total: float, c: dict) -> bool:
    """Replica la decisión determinista de `comparar_pago` sobre datos ya extraídos."""
    monto = c.get("monto")
    ok_monto = monto is not None and abs(float(monto) - pedido_total) <= config.TOLERANCIA_MONTO
    ok_numero = _numero_coincide(c.get("numero_destinatario"), config.NUMERO_YAPE_RESTAURANTE)
    ok_nombre = _nombre_coincide(c.get("nombre_destinatario"), config.NOMBRE_TITULAR_PAGO)
    return bool(c.get("es_comprobante_valido")) and ok_monto and ok_numero and ok_nombre


def evaluar_comprobantes(casos: list[dict]) -> dict:
    print("\n== 2) Validación de pago (determinista) ==")
    aciertos = 0
    for caso in casos:
        obtenido = _decidir_pago(caso["pedido_total"], caso["comprobante"])
        ok = obtenido == caso["esperado_validado"]
        aciertos += ok
        marca = "✓" if ok else "✗"
        print(f"  {marca} {caso['id']}: esperado={caso['esperado_validado']} obtenido={obtenido}")
    total = len(casos)
    exactitud = aciertos / total if total else 0.0
    print(f"  → Exactitud validación de pago: {aciertos}/{total} = {exactitud:.0%}")
    return {"aciertos": aciertos, "total": total, "exactitud": exactitud}


# ------------------------- 1) Clasificación de intención (agente) -------------------------
def evaluar_intenciones(casos: list[dict]) -> dict | None:
    print("\n== 1) Clasificación de intención (agente LLM) ==")
    if not config.ANTHROPIC_API_KEY:
        print("  ⏭  Omitido: falta ANTHROPIC_API_KEY.")
        return None

    from el_trujillano.nodes.clasificar_intencion import clasificar_intencion

    aciertos = 0
    for caso in casos:
        try:
            salida = clasificar_intencion(
                {"input_usuario": caso["mensaje"], "mensajes": [], "carrito": []}
            )
            obtenido = salida.get("intencion_actual")
        except Exception as e:
            obtenido = f"ERROR({e})"
        ok = obtenido == caso["esperado"]
        aciertos += ok
        marca = "✓" if ok else "✗"
        print(f"  {marca} {caso['id']}: esperado={caso['esperado']:<28} obtenido={obtenido}")
    total = len(casos)
    precision = aciertos / total if total else 0.0
    print(f"  → Precisión de intención: {aciertos}/{total} = {precision:.0%}")
    return {"aciertos": aciertos, "total": total, "precision": precision}


# ------------------------- 3) Reclamos (Deep Agent) -------------------------
def _hay_bd() -> bool:
    try:
        from sqlalchemy import text
        from el_trujillano.db.database import engine

        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return True
    except Exception:
        return False


def evaluar_reclamos(casos: list[dict]) -> dict | None:
    print("\n== 3) Reclamos — Deep Agent (resolución + escalamiento) ==")
    if not config.ANTHROPIC_API_KEY:
        print("  ⏭  Omitido: falta ANTHROPIC_API_KEY.")
        return None
    if not _hay_bd():
        print("  ⏭  Omitido: PostgreSQL/pgvector no disponible (evita gastar tokens sin RAG).")
        return None

    from el_trujillano.graphs.reclamos_graph import grafo_reclamos

    aciertos = 0
    escalados = 0
    iteraciones_tot = 0
    latencias = []
    evaluables = 0
    for caso in casos:
        cfg = {"configurable": {"thread_id": f"eval-{caso['id']}"}}
        t0 = time.time()
        try:
            estado = grafo_reclamos.invoke(
                {"session_id": f"eval-{caso['id']}", "reclamo": caso["reclamo"]}, config=cfg
            )
            dt = time.time() - t0
            latencias.append(dt)
            escalado = bool(estado.get("escalado"))
            iters = int(estado.get("iteraciones", 0))
            escalados += escalado
            iteraciones_tot += iters
            evaluables += 1
            ok = escalado == caso["esperado_escalado"]
            aciertos += ok
            marca = "✓" if ok else "✗"
            print(
                f"  {marca} {caso['id']}: esperado_escalado={caso['esperado_escalado']} "
                f"obtenido={escalado} · iteraciones={iters} · {dt:.1f}s"
            )
        except Exception as e:
            print(f"  ✗ {caso['id']}: ERROR ({e}) — ¿BD/pgvector con políticas ingestadas?")
    if evaluables == 0:
        print("  → Sin casos evaluables (revisa BD y la ingesta de políticas).")
        return {"evaluables": 0}
    pct_resueltos = (evaluables - escalados) / evaluables
    prom_iter = iteraciones_tot / evaluables
    prom_lat = sum(latencias) / len(latencias) if latencias else 0.0
    print(f"  → Acierto escalar/resolver: {aciertos}/{evaluables} = {aciertos / evaluables:.0%}")
    print(f"  → % reclamos resueltos sin humano: {pct_resueltos:.0%}")
    print(f"  → Iteraciones promedio del Deep Agent: {prom_iter:.2f}")
    print(f"  → Latencia promedio: {prom_lat:.1f}s (detalle de tokens en LangSmith)")
    return {
        "aciertos": aciertos,
        "evaluables": evaluables,
        "pct_resueltos_sin_humano": pct_resueltos,
        "iteraciones_promedio": prom_iter,
        "latencia_promedio_s": prom_lat,
    }


def main() -> None:
    data = _cargar()
    print("=" * 64)
    print("EVALUACIÓN — El Trujillano (golden set)")
    print(f"Modelo: {config.CLAUDE_MODEL} · Embeddings: {config.EMBEDDINGS_PROVIDER}")
    import os as _os
    print(f"LangSmith: tokens/latencia finos en el proyecto '{_os.environ.get('LANGSMITH_PROJECT', 'el-trujillano-delivery')}'.")
    print("=" * 64)

    r_pago = evaluar_comprobantes(data["comprobantes"])
    r_int = evaluar_intenciones(data["intenciones"])
    r_rec = evaluar_reclamos(data["reclamos"])

    print("\n" + "=" * 64)
    print("RESUMEN")
    intencion_txt = f"{r_int['precision']:.0%}" if r_int else "omitido (sin API key)"
    print(f"  Validación de pago (determinista): {r_pago['exactitud']:.0%}")
    print(f"  Clasificación de intención:        {intencion_txt}")
    if r_rec and r_rec.get("evaluables"):
        print(f"  Reclamos resueltos sin humano:     {r_rec['pct_resueltos_sin_humano']:.0%}")
        print(f"  Iteraciones promedio Deep Agent:   {r_rec['iteraciones_promedio']:.2f}")
    else:
        print("  Reclamos: omitido (sin API key / BD).")
    print("=" * 64)


if __name__ == "__main__":
    main()
