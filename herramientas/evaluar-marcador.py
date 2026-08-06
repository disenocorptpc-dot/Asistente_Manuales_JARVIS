"""Dice si un diseño va a trackear, ANTES de mandarlo a imprenta.

    python herramientas/evaluar-marcador.py <imagen> <ancho_impreso_cm>

Ejemplo:
    python herramientas/evaluar-marcador.py propuestas/tent-card-v3.png 10

Devuelve cuatro números y un veredicto. La idea es que el equipo de diseño itere
contra esos números en lugar de adivinar, y que nadie se entere de que un target
no sirve cuando ya hay 500 menús impresos.

Qué mide, y por qué esos y no otros:

1. TAMAÑO EN CUADRO. Cuánto del ancho de la imagen de cámara ocupa el impreso a
   distancia de lectura. Es geometría pura: un target chico no tiene arreglo.

2. PUNTOS REPETIBLES. No cuántos puntos de interés hay —eso engaña, el ruido de
   una textura acuarela genera miles— sino cuántos SOBREVIVEN a desenfoque, poca
   luz, ruido de sensor e inclinación. Se degrada la imagen en cuatro niveles y
   sólo cuentan los que reaparecen en su lugar geométrico correcto.

3. COBERTURA. Los puntos deben estar repartidos. Cien puntos apilados en una
   esquina dan una pose mal condicionada; cien repartidos la sostienen.

4. FEATURE POINTS DE MINDAR. El juez final: los cuenta su propio compilador. Se
   compila a la resolución que la cámara REALMENTE resuelve (~32 px/cm a 35 cm),
   no a la máxima posible, porque compilar sobremuestreado obliga a MindAR a
   emparejar en los niveles chicos de su pirámide, donde hay menos puntos y
   peores. Ese error costó la mitad del rendimiento en este proyecto.
"""
import json
import subprocess
import sys
from pathlib import Path

import cv2
import numpy as np

AQUI = Path(__file__).parent

# Cámara trasera típica de teléfono.
ANCHO_SENSOR, FOV = 1280, 60.0
D_REF = 35              # distancia de lectura de referencia, cm
TOLERANCIA_PX = 3.0     # cuánto puede moverse un punto y seguir contando como el mismo

# Umbrales. Salieron de medir este proyecto, no de un manual.
MIN_PCT_CUADRO   = 30      # % del ancho del cuadro que debe ocupar el impreso
MIN_REPETIBLES   = 250
MIN_COBERTURA    = 75      # %
MIN_MINDAR_E1    = 300     # feature points a escala 1


def px_por_cm(distancia_cm):
    return ANCHO_SENSOR / (2 * distancia_cm * np.tan(np.radians(FOV / 2)))


def degradar(img, nivel, rng):
    """nivel 1 = condiciones buenas ... 4 = mesa mal iluminada y mano temblando."""
    h, w = img.shape
    blur      = [0.8, 1.2, 1.8, 2.4][nivel - 1]
    contraste = [0.85, 0.70, 0.55, 0.45][nivel - 1]
    ruido     = [2.0, 3.5, 5.0, 7.0][nivel - 1]
    grados    = [2.0, 4.0, 7.0, 10.0][nivel - 1]

    x = cv2.GaussianBlur(img.astype(np.float32), (0, 0), blur)
    x = (x - 128) * contraste + 128 + 8              # luz tibia y baja
    x = np.clip(x + rng.normal(0, ruido, x.shape), 0, 255).astype(np.uint8)

    d = w * np.tan(np.radians(grados)) * 0.25        # nadie sostiene el teléfono paralelo
    H = cv2.getPerspectiveTransform(
        np.float32([[0, 0], [w, 0], [w, h], [0, h]]),
        np.float32([[d, 0], [w - d, 0], [w, h], [0, h]]))
    return cv2.warpPerspective(x, H, (w, h), borderMode=cv2.BORDER_REPLICATE), H


def medir_repetibles(gris):
    orb = cv2.ORB_create(nfeatures=6000, scaleFactor=1.2, nlevels=6, fastThreshold=18)
    bf = cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=True)
    rng = np.random.default_rng(7)

    kps, des = orb.detectAndCompute(gris, None)
    if des is None or len(kps) < 10:
        return 0, 0.0, 0, []
    pts = np.float32([k.pt for k in kps]).reshape(-1, 1, 2)
    sobrevive = np.zeros(len(kps), dtype=int)
    por_nivel = []

    for nivel in (1, 2, 3, 4):
        deg, H = degradar(gris, nivel, rng)
        kd, dd = orb.detectAndCompute(deg, None)
        if dd is None:
            por_nivel.append(0)
            continue
        esperado = cv2.perspectiveTransform(pts, H).reshape(-1, 2)
        ok = 0
        for m in bf.match(des, dd):
            if np.linalg.norm(np.array(kd[m.trainIdx].pt) - esperado[m.queryIdx]) <= TOLERANCIA_PX:
                sobrevive[m.queryIdx] += 1
                ok += 1
        por_nivel.append(ok)

    rep = sobrevive >= 2          # aguanta al menos dos niveles de degradación
    P = np.float32([k.pt for k in kps])[rep]
    cobertura = 0.0
    if len(P):
        gx = np.clip((P[:, 0] / gris.shape[1] * 4).astype(int), 0, 3)
        gy = np.clip((P[:, 1] / gris.shape[0] * 4).astype(int), 0, 3)
        cobertura = 100.0 * len(set(zip(gx.tolist(), gy.tolist()))) / 16
    return int(rep.sum()), cobertura, len(kps), por_nivel


def compilar(img_rgb, nombre):
    """Compila con el compilador real de MindAR y devuelve sus feature points."""
    nm = AQUI / "node_modules" / "mind-ar"
    rgba_path = AQUI / f"_{nombre}.rgba"
    mind_path = AQUI / f"_{nombre}.mind"
    h, w = img_rgb.shape[:2]
    cv2.cvtColor(img_rgb, cv2.COLOR_BGR2RGBA).tofile(rgba_path)

    if not nm.exists():
        print("\n  (MindAR no instalado — para el veredicto completo:)")
        print(f"    cd herramientas && npm install --ignore-scripts")
        print(f"    node herramientas/compilar-en-node.mjs {rgba_path.name} {w} {h} salida.mind")
        return None

    r = subprocess.run(
        ["node", str(AQUI / "compilar-en-node.mjs"), str(rgba_path), str(w), str(h), str(mind_path)],
        capture_output=True, text=True, cwd=AQUI)
    rgba_path.unlink(missing_ok=True)
    if r.returncode != 0:
        print("\n  error al compilar:", (r.stderr or "")[-400:])
        return None

    niveles = []
    for linea in r.stdout.splitlines():
        p = linea.split()
        if len(p) == 3 and "x" in p[1]:
            try:
                niveles.append((float(p[0]), p[1], int(p[2])))
            except ValueError:
                pass
    kb = mind_path.stat().st_size / 1024 if mind_path.exists() else 0
    return {"niveles": niveles, "kb": kb, "mind": mind_path}


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)
    ruta = Path(sys.argv[1])
    ancho_cm = float(sys.argv[2])
    original = cv2.imread(str(ruta), cv2.IMREAD_COLOR)
    if original is None:
        print(f"no pude leer {ruta}")
        sys.exit(1)

    h0, w0 = original.shape[:2]
    alto_cm = ancho_cm * h0 / w0
    print("=" * 72)
    print(f"  {ruta.name}")
    print(f"  impreso: {ancho_cm:.1f} x {alto_cm:.1f} cm   ({w0}x{h0} px en el archivo)")
    print("=" * 72)

    # 1. Tamaño en cuadro
    print("\n1. TAMANO EN CUADRO")
    pct35 = None
    for d in (25, 35, 50):
        visible_cm = 2 * d * np.tan(np.radians(FOV / 2))
        pct = 100 * ancho_cm / visible_cm
        if d == D_REF:
            pct35 = pct
        print(f"   a {d} cm: la camara abarca {visible_cm:.0f} cm  ->  el impreso ocupa {pct:.0f}% del ancho")

    # Reescalado a lo que la cámara resuelve a 35 cm: todo lo demás se mide ahí.
    esc = px_por_cm(D_REF) * ancho_cm / w0
    vista = cv2.resize(original, (max(1, round(w0 * esc)), max(1, round(h0 * esc))),
                       interpolation=cv2.INTER_AREA if esc < 1 else cv2.INTER_CUBIC)
    gris = cv2.cvtColor(vista, cv2.COLOR_BGR2GRAY)
    print(f"\n   como lo ve la camara a {D_REF} cm: {vista.shape[1]}x{vista.shape[0]} px"
          f"  ({px_por_cm(D_REF):.1f} px/cm)")

    # 2 y 3. Repetibilidad y cobertura
    rep, cob, crudos, por_nivel = medir_repetibles(gris)
    print("\n2. PUNTOS REPETIBLES  (sobreviven a desenfoque, poca luz, ruido e inclinacion)")
    print(f"   crudos detectados : {crudos}")
    print(f"   REPETIBLES        : {rep}")
    etiquetas = ["2 grados", "4 grados", "7 grados", "10 grados"]
    for e, n in zip(etiquetas, por_nivel):
        print(f"     sobreviven a {e:<10}: {n}"
              + ("   <- la inclinacion es lo que mas mata" if e == "7 grados" else ""))
    print(f"\n3. COBERTURA        : {cob:.0f}%   (repartidos, no apilados en una esquina)")

    # 4. El juez final
    print("\n4. FEATURE POINTS DE MINDAR  (su propio compilador, a la resolucion correcta)")
    comp = compilar(vista, ruta.stem.replace(" ", "-"))
    e1 = None
    if comp and comp["niveles"]:
        e1 = comp["niveles"][0][2]
        print(f"   .mind: {comp['kb']:.0f} KB   ->  {comp['mind'].name}")
        print(f"   {'escala':>7}  {'px':>10}  {'puntos':>7}")
        for s, px, n in comp["niveles"]:
            print(f"   {s:>7}  {px:>10}  {n:>7}")

    # Veredicto
    print("\n" + "=" * 72)
    pruebas = [
        ("tamano en cuadro", f"{pct35:.0f}%", pct35 >= MIN_PCT_CUADRO, f">={MIN_PCT_CUADRO}%"),
        ("puntos repetibles", str(rep), rep >= MIN_REPETIBLES, f">={MIN_REPETIBLES}"),
        ("cobertura", f"{cob:.0f}%", cob >= MIN_COBERTURA, f">={MIN_COBERTURA}%"),
    ]
    if e1 is not None:
        pruebas.append(("feature points a escala 1", str(e1), e1 >= MIN_MINDAR_E1, f">={MIN_MINDAR_E1}"))

    for nombre, valor, ok, meta in pruebas:
        print(f"  {'OK  ' if ok else 'FALLA'}  {nombre:<28} {valor:>8}   (meta {meta})")

    fallan = [p[0] for p in pruebas if not p[2]]
    print("=" * 72)

    # La inclinación va aparte y sin umbral inventado, porque es el criterio que
    # decide en campo y el que no sé calibrar contra la realidad todavía.
    if len(por_nivel) == 4 and por_nivel[0]:
        r7  = 100 * por_nivel[2] / por_nivel[0]
        r10 = 100 * por_nivel[3] / por_nivel[0]
        print(f"  AGUANTE A LA INCLINACION: queda {r7:.0f}% a 7 grados, {r10:.0f}% a 10.")
        if r7 < 35:
            print("    Se desploma. Este es el criterio que mas falla en la mesa, porque")
            print("    un menu acostado SIEMPRE se ve oblicuo. Un tent card vertical lo")
            print("    resuelve de golpe; mas contraste de valor tambien ayuda.")

    print("\n  OJO CON ESTE VEREDICTO: esta simulacion degrada un render digital.")
    print("  No captura tinta, trama de impresion, textura de papel, reflejos")
    print("  especulares ni el auto-exposure de la camara. Cumplir estos minimos")
    print("  es NECESARIO, no suficiente: sirve para descartar disenos malos")
    print("  temprano, no para certificar que uno bueno va a funcionar.")

    print()
    if not fallan:
        print("  VEREDICTO: cumple los minimos. Vale la pena imprimir una prueba y medirla en la mesa.")
    else:
        print(f"  VEREDICTO: no cumple todavia. Falla en: {', '.join(fallan)}")
        print("\n  Que mueve cada numero:")
        if pct35 < MIN_PCT_CUADRO:
            print(f"   - tamano: imprimirlo mas grande. Minimo {MIN_PCT_CUADRO/100*2*D_REF*np.tan(np.radians(FOV/2)):.0f} cm de ancho.")
        if rep < MIN_REPETIBLES:
            print("   - repetibles: mas CONTRASTE DE VALOR (oscuros casi negros contra claros).")
            print("     Tonos medios del mismo matiz no aportan: el tracker ve en escala de grises.")
        if cob < MIN_COBERTURA:
            print("   - cobertura: reparte el detalle por toda la superficie.")
            print("     Nada de un dibujo bonito al centro rodeado de fondo liso.")
        if e1 is not None and e1 < MIN_MINDAR_E1:
            print("   - feature points: mas detalle no repetitivo. Cero motivos espejeados,")
            print("     cero tramas regulares. Si un elemento aparece dos veces, cambialo.")
    print()


if __name__ == "__main__":
    main()
