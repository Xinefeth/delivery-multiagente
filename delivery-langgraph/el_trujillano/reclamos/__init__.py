"""Deep Agent de reclamos.

Es UN SOLO agente (un sub-grafo) con el patrón planificar -> recuperar -> generar
-> evaluar y bucle de auto-corrección. La "negociación" NO es otro agente: es la
fase generar <-> evaluar dentro de este mismo agente.
"""
