"""SUB-GRAFO del Deep Agent de reclamos (StateGraph de LangGraph).

    START ► planificar ► recuperar ► generar ► evaluar ─┬─(suficiente)──────► responder ► END
                              ▲                          │
                              └──(insuficiente y quedan  │
                                   reintentos: vuelve    │
                                   con nueva_consulta)───┘
                                                         └─(MAX_ITERACIONES)─► escalar (HITL) ► END

Memoria en el estado: `historial` (consultas intentadas) e `iteraciones`.
Límite operativo: MAX_ITERACIONES_RECLAMO (por defecto 3).
"""
from __future__ import annotations

from langgraph.graph import END, START, StateGraph

from .checkpointer import build_checkpointer
from ..reclamos.nodos import (
    escalar,
    evaluar,
    generar,
    planificar,
    recuperar,
    responder,
    route_evaluacion,
)
from ..state import ReclamoState


def construir_grafo_reclamos(checkpointer=None):
    g = StateGraph(ReclamoState)

    g.add_node("planificar", planificar)   # AGENTE
    g.add_node("recuperar", recuperar)     # DETERMINISTA (RAG)
    g.add_node("generar", generar)         # AGENTE
    g.add_node("evaluar", evaluar)         # AGENTE crítico
    g.add_node("responder", responder)     # DETERMINISTA
    g.add_node("escalar", escalar)         # DETERMINISTA (HITL)

    g.add_edge(START, "planificar")
    g.add_edge("planificar", "recuperar")
    g.add_edge("recuperar", "generar")
    g.add_edge("generar", "evaluar")

    # Bucle de auto-corrección / negociación (generar <-> evaluar a través de recuperar).
    g.add_conditional_edges(
        "evaluar",
        route_evaluacion,
        {"responder": "responder", "recuperar": "recuperar", "escalar": "escalar"},
    )

    g.add_edge("responder", END)
    g.add_edge("escalar", END)

    return g.compile(checkpointer=checkpointer or build_checkpointer())


grafo_reclamos = construir_grafo_reclamos()
