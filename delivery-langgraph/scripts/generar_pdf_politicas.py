"""Genera un PDF de políticas a partir de data/politicas_el_trujillano.md.

Es solo una utilidad para tener un PDF de ejemplo que ingestar en el RAG de
reclamos. En producción se usaría el PDF oficial del restaurante.

Uso:  python -m scripts.generar_pdf_politicas
"""
from __future__ import annotations

import sys
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer

RAIZ = Path(__file__).resolve().parents[1]
ORIGEN = RAIZ / "data" / "politicas_el_trujillano.md"
DESTINO = RAIZ / "data" / "politicas_el_trujillano.pdf"


def generar() -> Path:
    texto = ORIGEN.read_text(encoding="utf-8")
    estilos = getSampleStyleSheet()
    doc = SimpleDocTemplate(str(DESTINO), pagesize=A4)
    flujo = []
    for linea in texto.splitlines():
        linea = linea.rstrip()
        if not linea:
            flujo.append(Spacer(1, 6))
        elif linea.startswith("# "):
            flujo.append(Paragraph(linea[2:], estilos["Title"]))
        elif linea.startswith("## "):
            flujo.append(Paragraph(linea[3:], estilos["Heading2"]))
        elif linea.startswith("- "):
            flujo.append(Paragraph("• " + linea[2:], estilos["Normal"]))
        else:
            flujo.append(Paragraph(linea, estilos["Normal"]))
    doc.build(flujo)
    print(f"✅ PDF de políticas generado en: {DESTINO}")
    return DESTINO


if __name__ == "__main__":
    generar()
