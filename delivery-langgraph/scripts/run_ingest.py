"""Ejecuta la ingesta RAG completa: catálogo + PDF de políticas. Determinista.

Uso:  python -m scripts.run_ingest
Genera el PDF si no existe (a partir del .md de ejemplo).
"""
from __future__ import annotations

import sys
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

from el_trujillano.rag.ingest import ingestar_catalogo, ingestar_politicas

RAIZ = Path(__file__).resolve().parents[1]
PDF = RAIZ / "data" / "politicas_el_trujillano.pdf"
MD = RAIZ / "data" / "politicas_el_trujillano.md"


def main() -> None:
    ingestar_catalogo()

    fuente = PDF
    if not PDF.exists():
        try:
            from scripts.generar_pdf_politicas import generar

            fuente = generar()
        except Exception as e:
            print(f"⚠️ No se pudo generar el PDF ({e}); se ingestará el .md de respaldo.")
            fuente = MD
    ingestar_politicas(fuente)
    print("✅ Ingesta RAG completa.")


if __name__ == "__main__":
    main()
