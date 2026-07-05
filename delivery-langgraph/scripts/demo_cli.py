"""Demo de línea de comandos para conversar con el grafo de ventas sin levantar la API.

Uso:  python -m scripts.demo_cli
Requiere: BD inicializada + seed + ingesta + ANTHROPIC_API_KEY.
"""
from __future__ import annotations

import sys
import uuid

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

from el_trujillano.graphs.ventas_graph import grafo_ventas


def main() -> None:
    session_id = f"cli-{uuid.uuid4().hex[:8]}"
    cfg = {"configurable": {"thread_id": session_id}}
    print("🍽️  El Trujillano — escribe 'salir' para terminar.\n")
    while True:
        msg = input("Tú> ").strip()
        if msg.lower() in ("salir", "exit", "quit"):
            break
        estado = grafo_ventas.invoke(
            {"session_id": session_id, "input_usuario": msg, "imagen_comprobante": None},
            config=cfg,
        )
        print(f"Bot> {estado.get('respuesta', '')}\n")


if __name__ == "__main__":
    main()
