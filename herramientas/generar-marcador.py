"""Genera el arte del marcador por script, contra las reglas de BRIEF-marcador.md.

    python herramientas/generar-marcador.py --semilla 7

Por qué generativo y no ilustrado: lo que el tracker quiere es lo contrario de
lo que se ve elegante a mano — contraste duro, detalle irregular parejo, cero
repetición, cero simetría, cero áreas planas. Eso es un algoritmo, no un dibujo.
Y siendo determinista por semilla, el arte no es un binario huérfano en el repo:
se regenera, se audita y se itera contra los números de evaluar-marcador.py.

Tres decisiones que NO son estéticas:

1. VERTICAL (portrait), obligatorio. En el binario de 8th Wall (VERIFICACIONES §7)
   scale = max(anchoM, altoM) y scaledWidth = ancho/alto. El producto
   scale × scaledWidth sólo colapsa al ancho real cuando el alto es la dimensión
   mayor. Un target horizontal devuelve ancho²/alto y el 1:1 miente.
   (core/scale.js ya normaliza para cubrir el caso horizontal, pero el camino
   verificado es el vertical — y además el BRIEF lo pide por la inclinación.)

2. 15.0 × 20.0 cm, proporción 3:4 EXACTA. Tres restricciones independientes
   convergen en esa medida, leídas del compilador de 8th Wall
   (@8thwall/image-target-cli@1.0.0, src/crop.js y src/constants.json):

   a) El crop de un target plano se fuerza a 3:4 (`height = width × 4/3`).
      Un arte con otra proporción se RECORTA en silencio, y entonces el área
      trackeada deja de ser el impreso: ancho_cm mentiría y con él el 1:1.
   b) `constants.json` exige mínimo 480 × 640 px de crop y `validateCrop`
      rechaza por debajo. A la resolución correcta de compilado
      (px = cm × 32, HANDOFF §10) eso es exactamente 15 × 20 cm. Un A5 de
      14.8 cm da 474 px y falla por 6 px.
   c) evaluar-marcador.py exige ≥30% del ancho del cuadro a 35 cm, donde la
      cámara abarca 40.4 cm → mínimo geométrico 12.1 cm. 15 cm da 37%.

   Bonus: 480 × 640 es también el tamaño de la imagen de luminancia que
   emite el compilador, así que el target no se remuestrea ni una vez.
   (El HANDOFF §6 traía 14.8 de ejemplo — un A5. No sobrevive a (a) ni (b).)

3. La regla de 10 cm y el QR van en los MÁRGENES de la hoja, nunca dentro del
   arte. Una regla es una trama regular de ticks idénticos: para el tracker son
   gemelos indistinguibles, exactamente lo que el BRIEF prohíbe. El área
   trackeada es sólo el rectángulo del arte, y es la que define ancho_cm.

Salidas (en --salida, por default herramientas/marcadores/):
  <id>-target-300dpi.png   master del arte trackeado, para imprimir/colocar
  <id>-target-32ppcm.png   el mismo arte a px = cm × 32, para el compilador
  <id>-hoja-A4-300dpi.png  hoja lista para imprimir: arte + regla + protocolo
  <id>.json                qué se generó y con qué parámetros
"""
import argparse
import json
import math
import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

# ── Paleta Palace. Para el tracker sólo cuenta la LUMINANCIA, así que lo que
#    importa no son los matices sino la distancia de valor entre vecinos.
TINTA = (11, 26, 38)       # lum ~24  — casi negro, azul océano hundido
PERLA = (237, 236, 228)    # lum ~236
OCEANO = (37, 77, 110)     # lum ~71
BRONCE = (184, 143, 105)   # lum ~148
DELTA_MIN = 70             # distancia de valor mínima entre una forma y su fondo


def lum(c):
    return 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]


def contrastar(rng, fondo, paleta=(TINTA, PERLA, OCEANO, BRONCE)):
    """Elige un color que contraste en VALOR contra el fondo. Tonos medios del
    mismo matiz no aportan nada: el tracker ve en escala de grises."""
    opciones = [c for c in paleta if abs(lum(c) - lum(fondo)) >= DELTA_MIN]
    # Sesgo hacia el par de máximo contraste: es el que sobrevive al desenfoque.
    opciones.sort(key=lambda c: -abs(lum(c) - lum(fondo)))
    return rng.choice(opciones[:2]) if len(opciones) > 1 else opciones[0]


# ══════════════════════════════════════════════════════════════════════════
#  Formas. Todas de bordes duros y esquinas geométricas: son los puntos que
#  aguantan el desenfoque de una mano temblando. Cero círculos, cero curvas
#  suaves, cero degradados.
# ══════════════════════════════════════════════════════════════════════════

def _rot(pts, cx, cy, ang):
    co, si = math.cos(ang), math.sin(ang)
    return [(cx + (x - cx) * co - (y - cy) * si,
             cy + (x - cx) * si + (y - cy) * co) for x, y in pts]


def forma(rng, cx, cy, r):
    """Un polígono irregular de esquinas duras, centrado en (cx,cy), radio ~r.
    Los parámetros son continuos: dos llamadas nunca dan la misma forma, que es
    justo lo que evita motivos gemelos."""
    ang = rng.uniform(0, math.tau)
    kind = rng.choice(('triangulo', 'cuna', 'ele', 'cruz', 'galon', 'trapecio'))

    if kind == 'triangulo':
        pts = [(cx + r * rng.uniform(.55, 1) * math.cos(ang + i * math.tau / 3 + rng.uniform(-.5, .5)),
                cy + r * rng.uniform(.55, 1) * math.sin(ang + i * math.tau / 3 + rng.uniform(-.5, .5)))
               for i in range(3)]

    elif kind == 'cuna':  # rectángulo con una esquina desplazada
        w, h = r * rng.uniform(.7, 1.8), r * rng.uniform(.5, 1.4)
        pts = [(cx - w, cy - h), (cx + w, cy - h * rng.uniform(.2, 1)),
               (cx + w * rng.uniform(.3, 1), cy + h), (cx - w, cy + h)]
        pts = _rot(pts, cx, cy, ang)

    elif kind == 'ele':
        w, h = r * rng.uniform(.9, 1.7), r * rng.uniform(.9, 1.7)
        g = rng.uniform(.3, .6)   # grosor del brazo, asimétrico
        pts = [(cx - w, cy - h), (cx - w + w * 2 * g, cy - h),
               (cx - w + w * 2 * g, cy + h - h * 2 * g), (cx + w, cy + h - h * 2 * g),
               (cx + w, cy + h), (cx - w, cy + h)]
        pts = _rot(pts, cx, cy, ang)

    elif kind == 'cruz':  # dos barras cruzadas en ángulo irregular
        return [_barra(rng, cx, cy, r, ang), _barra(rng, cx, cy, r, ang + rng.uniform(.6, 2.1))]

    elif kind == 'galon':  # chevron
        w, h = r * rng.uniform(.8, 1.6), r * rng.uniform(.6, 1.2)
        g = h * rng.uniform(.35, .6)
        pts = [(cx - w, cy - h), (cx, cy + h * rng.uniform(-.2, .3)), (cx + w, cy - h),
               (cx + w, cy - h + g), (cx, cy + h + g * rng.uniform(.5, 1)), (cx - w, cy - h + g)]
        pts = _rot(pts, cx, cy, ang)

    else:  # trapecio muy asimétrico
        w, h = r * rng.uniform(.8, 1.7), r * rng.uniform(.5, 1.3)
        pts = [(cx - w, cy + h), (cx + w, cy + h),
               (cx + w * rng.uniform(.1, .8), cy - h), (cx - w * rng.uniform(.1, .8), cy - h)]
        pts = _rot(pts, cx, cy, ang)

    return [pts]


def _barra(rng, cx, cy, r, ang):
    largo = r * rng.uniform(1.0, 2.0)
    grueso = r * rng.uniform(.22, .42)
    pts = [(cx - largo, cy - grueso), (cx + largo, cy - grueso),
           (cx + largo, cy + grueso), (cx - largo, cy + grueso)]
    return _rot(pts, cx, cy, ang)


def particionar(rng, x0, y0, x1, y1, minimo, profundidad=0):
    """BSP con cortes en posiciones irregulares: bloques grandes de valor
    repartidos por toda la superficie, sin trama regular ni celda repetida."""
    w, h = x1 - x0, y1 - y0
    if profundidad >= 5 or (w < minimo * 2 and h < minimo * 2) or rng.random() < .07:
        return [(x0, y0, x1, y1)]
    vertical = w > h if abs(w - h) > minimo * .4 else rng.random() < .5
    if vertical and w >= minimo * 2:
        c = x0 + w * rng.uniform(.3, .7)
        return (particionar(rng, x0, y0, c, y1, minimo, profundidad + 1)
                + particionar(rng, c, y0, x1, y1, minimo, profundidad + 1))
    if not vertical and h >= minimo * 2:
        c = y0 + h * rng.uniform(.3, .7)
        return (particionar(rng, x0, y0, x1, c, minimo, profundidad + 1)
                + particionar(rng, x0, c, x1, y1, minimo, profundidad + 1))
    return [(x0, y0, x1, y1)]


# ══════════════════════════════════════════════════════════════════════════
#  El arte trackeado
# ══════════════════════════════════════════════════════════════════════════

def dibujar_arte(ancho_cm, alto_cm, dpi, semilla, supersample=2):
    """Devuelve el arte del marcador como Image RGB al dpi pedido."""
    rng = random.Random(semilla)
    ppc = dpi * supersample / 2.54                     # px por cm de trabajo
    W, H = round(ancho_cm * ppc), round(alto_cm * ppc)
    img = Image.new('RGB', (W, H), PERLA)
    d = ImageDraw.Draw(img)

    def cm(v):
        return v * ppc

    # ── Capa 1: bloques de valor. La partición garantiza que el detalle grande
    #    llegue a los cuatro cuadrantes; la cobertura no se deja al azar.
    celdas = particionar(rng, 0, 0, W, H, cm(1.8))
    fondos = {}
    for (x0, y0, x1, y1) in celdas:
        # Alternancia de valor entre vecinos por paridad espacial: dos celdas
        # contiguas casi nunca comparten valor, así no se forman manchones
        # planos grandes. Los cortes son irregulares, así que esto NO produce
        # un tablero de ajedrez (que sería trama regular = motivos gemelos).
        cx_, cy_ = (x0 + x1) / 2, (y0 + y1) / 2
        par = (int(cx_ / cm(2.6)) + int(cy_ / cm(2.6))) % 2
        if rng.random() < .22:
            par = 1 - par
        c = (rng.choices([TINTA, OCEANO], weights=[74, 26])[0] if par
             else rng.choices([PERLA, BRONCE], weights=[72, 28])[0])
        d.rectangle([x0, y0, x1, y1], fill=c)
        fondos[(x0, y0, x1, y1)] = c

    # ── Capa 2: formas medianas. La densidad va por ÁREA, sin tope: un tope
    #    fijo dejaba las celdas grandes casi vacías, que es el "dibujo al
    #    centro rodeado de fondo liso" que el BRIEF prohíbe explícitamente.
    #    Una forma por cada ~2.2 cm² mantiene el detalle parejo a cualquier
    #    tamaño de celda.
    for (x0, y0, x1, y1) in celdas:
        fondo = fondos[(x0, y0, x1, y1)]
        w, h = x1 - x0, y1 - y0
        n = max(2, round((w * h) / (cm(1.5) ** 2) * rng.uniform(.85, 1.3)))
        for _ in range(n):
            r = rng.uniform(cm(.26), max(cm(.34), min(cm(1.1), max(w, h) * .3)))
            cx = rng.uniform(x0 + r * .3, x1 - r * .3)
            cy = rng.uniform(y0 + r * .3, y1 - r * .3)
            # El fondo real bajo la forma puede ser otra forma ya dibujada:
            # se muestrea el pixel, no la celda, para no perder contraste.
            base = img.getpixel((min(W - 1, max(0, int(cx))), min(H - 1, max(0, int(cy)))))
            color = contrastar(rng, base if abs(lum(base) - lum(fondo)) > 20 else fondo)
            for pts in forma(rng, cx, cy, r):
                d.polygon(pts, fill=color)

    # ── Capa 3: barras chicas por rejilla jitereada. Fuerza detalle en las 16
    #    celdas que mide la cobertura, sin caer en trama: posición, largo,
    #    grosor y ángulo son continuos y distintos en cada una.
    #    Grosor mínimo 1.5 mm = ~5 px a la resolución de cámara (32 px/cm):
    #    más fino que eso lo borra el desenfoque y no cuenta como repetible.
    gx, gy = 6, 9
    for i in range(gx):
        for j in range(gy):
            for _ in range(rng.randint(1, 3)):
                cx = (i + rng.uniform(.15, .85)) * W / gx
                cy = (j + rng.uniform(.15, .85)) * H / gy
                fondo = img.getpixel((min(W - 1, int(cx)), min(H - 1, int(cy))))
                color = contrastar(rng, fondo)
                largo = rng.uniform(cm(.18), cm(.5))
                grueso = rng.uniform(cm(.075), cm(.14))
                ang = rng.uniform(0, math.tau)
                pts = [(cx - largo, cy - grueso), (cx + largo, cy - grueso),
                       (cx + largo, cy + grueso), (cx - largo, cy + grueso)]
                d.polygon(_rot(pts, cx, cy, ang), fill=color)

    # ── Capa 4: borde irregular con esquinas duras. Muescas asimétricas, conteo
    #    distinto por lado — un marco parejo sería simetría espejo, dañina.
    banda = cm(rng.uniform(.32, .5))
    d.rectangle([0, 0, W, banda], fill=TINTA)
    d.rectangle([0, H - banda * rng.uniform(.7, 1.3), W, H], fill=TINTA)
    d.rectangle([0, 0, banda * rng.uniform(.8, 1.2), H], fill=TINTA)
    d.rectangle([W - banda, 0, W, H], fill=TINTA)
    for lado, n in (('arriba', rng.randint(4, 7)), ('abajo', rng.randint(5, 8)),
                    ('izq', rng.randint(6, 10)), ('der', rng.randint(4, 8))):
        for _ in range(n):
            prof = rng.uniform(cm(.2), cm(.85))
            largo = rng.uniform(cm(.35), cm(1.5))
            if lado in ('arriba', 'abajo'):
                x = rng.uniform(0, W - largo)
                y0_, y1_ = (0, prof) if lado == 'arriba' else (H - prof, H)
                d.rectangle([x, y0_, x + largo, y1_], fill=PERLA if rng.random() < .55 else BRONCE)
            else:
                y = rng.uniform(0, H - largo)
                x0_, x1_ = (0, prof) if lado == 'izq' else (W - prof, W)
                d.rectangle([x0_, y, x1_, y + largo], fill=PERLA if rng.random() < .55 else BRONCE)

    # Esquinas: cuatro escuadras de tamaño DISTINTO. Anclas estables que además
    # rompen cualquier simetría de rotación (el tracker no puede confundir
    # orientaciones si las cuatro esquinas no se parecen).
    def caja(xa, xb, ya, yb, col):
        d.rectangle([min(xa, xb), min(ya, yb), max(xa, xb), max(ya, yb)], fill=col)

    for k, (ex, ey) in enumerate(((0, 0), (W, 0), (W, H), (0, H))):
        t = cm(rng.uniform(.7, 1.5))
        g = cm(rng.uniform(.16, .3))
        sx, sy = (1 if ex == 0 else -1), (1 if ey == 0 else -1)
        col = TINTA if k % 2 == 0 else OCEANO
        caja(ex, ex + sx * t, ey, ey + sy * g, col)   # brazo horizontal
        caja(ex, ex + sx * g, ey, ey + sy * t, col)   # brazo vertical

    if supersample > 1:
        img = img.resize((round(ancho_cm * dpi / 2.54), round(alto_cm * dpi / 2.54)),
                         Image.LANCZOS)
    return img


# ══════════════════════════════════════════════════════════════════════════
#  La hoja imprimible: arte a tamaño exacto + regla + protocolo de enganche
# ══════════════════════════════════════════════════════════════════════════

A4 = (21.0, 29.7)


def tipo(px, negrita=False):
    for nombre in (('arialbd.ttf', 'ariblk.ttf') if negrita else ('arial.ttf',)):
        try:
            return ImageFont.truetype(f'C:/Windows/Fonts/{nombre}', px)
        except OSError:
            continue
    try:
        return ImageFont.truetype('DejaVuSans.ttf', px)
    except OSError:
        return ImageFont.load_default()


def dibujar_hoja(arte, marcador_id, ancho_cm, alto_cm, dpi, semilla):
    ppc = dpi / 2.54
    W, H = round(A4[0] * ppc), round(A4[1] * ppc)
    hoja = Image.new('RGB', (W, H), (255, 255, 255))
    d = ImageDraw.Draw(hoja)

    ax = round((W - arte.width) / 2)
    ay = round(1.1 * ppc)
    hoja.paste(arte, (ax, ay))

    # Marcas de corte FUERA del arte: verifican la escala de impresión sin
    # meter un solo pixel dentro del área trackeada.
    m, gr = round(.45 * ppc), max(1, round(.02 * ppc))
    for x in (ax, ax + arte.width):
        for y in (ay, ay + arte.height):
            d.line([x - m, y, x - gr * 3, y], fill=(0, 0, 0), width=gr)
            d.line([x + gr * 3, y, x + m, y], fill=(0, 0, 0), width=gr)
            d.line([x, y - m, x, y - gr * 3], fill=(0, 0, 0), width=gr)
            d.line([x, y + gr * 3, x, y + m], fill=(0, 0, 0), width=gr)

    f_ch, f_md, f_bd = tipo(round(.26 * ppc)), tipo(round(.30 * ppc)), tipo(round(.40 * ppc), True)

    # El texto vive en la franja que queda bajo el arte. Presupuesto explícito:
    # el arte NO se encoge para que quepa la letra — mide 14.8 cm o no sirve.
    zona_y0 = ay + arte.height + round(.55 * ppc)
    zona_y1 = H - round(.55 * ppc)
    y = zona_y0

    d.text((ax, y), f'{marcador_id}   ·   {ancho_cm:.1f} × {alto_cm:.1f} cm   ·   vertical',
           font=f_bd, fill=(0, 0, 0))
    y += round(.62 * ppc)

    # ── La regla. Va aquí y no dentro del arte: ticks idénticos repetidos son
    #    exactamente el motivo gemelo que el BRIEF prohíbe.
    rx, ry = ax, y + round(.42 * ppc)
    largo = 10.0
    d.line([rx, ry, rx + largo * ppc, ry], fill=(0, 0, 0), width=max(1, round(.025 * ppc)))
    for k in range(int(largo * 2) + 1):
        x = rx + k * .5 * ppc
        alto_t = .30 if k % 2 == 0 else .16
        d.line([x, ry, x, ry - alto_t * ppc], fill=(0, 0, 0), width=max(1, round(.022 * ppc)))
        if k % 2 == 0:
            d.text((x + round(.04 * ppc), ry + round(.04 * ppc)), str(k // 2), font=f_ch, fill=(0, 0, 0))
    d.text((rx + (largo + .3) * ppc, ry - round(.26 * ppc)), 'cm', font=f_ch, fill=(0, 0, 0))
    y = ry + round(.52 * ppc)

    # ── Dos columnas: la escala de impresión a la izquierda, el protocolo de
    #    enganche a la derecha. En una sola columna el bloque se desbordaba.
    col_a, col_b = ax, ax + round(9.0 * ppc)
    izq = [
        ('IMPRIME AL 100% (tamaño real).', True),
        ('Sin "ajustar a página".', False),
        ('Mide la regla con flexómetro: si no da', False),
        ('10.0 cm exactos, la escala del visor va a', False),
        ('mentir en la misma proporción.', False),
    ]
    der = [
        ('CÓMO ENGANCHAR', True),
        ('1. Acércate a ~35 cm, de frente.', False),
        ('2. Retrocede: el SLAM sostiene la pieza', False),
        ('   aunque el marcador salga del cuadro.', False),
        ('3. Si se desvía, re-engancha de cerca.', False),
    ]
    for columna, x0 in ((izq, col_a), (der, col_b)):
        yy = y
        for texto, negrita in columna:
            d.text((x0, yy), texto, font=(f_md if negrita else f_ch), fill=(0, 0, 0))
            yy += round((.44 if negrita else .38) * ppc)
    y += round(.44 * ppc) + 4 * round(.38 * ppc) + round(.22 * ppc)

    for texto in ('Mate, nunca brillante ni UV: el reflejo de una lámpara borra los puntos.',
                  'De pie o en pared a la altura de los ojos, nunca acostado: a 10° de '
                  'inclinación sobrevive el 4%.'):
        d.text((ax, y), texto, font=f_ch, fill=(0, 0, 0))
        y += round(.36 * ppc)

    # Espacio reservado del QR (F4: deep link ?pieza= + QR en el manual).
    qr = round(2.6 * ppc)
    qx = ax + arte.width - qr
    qy = zona_y1 - qr - round(.34 * ppc)
    d.rectangle([qx, qy, qx + qr, qy + qr], outline=(150, 150, 150), width=max(1, round(.02 * ppc)))
    d.text((qx, qy + qr + round(.06 * ppc)), 'QR — F4 · 2.6 cm · nivel H', font=f_ch, fill=(130, 130, 130))

    pie = zona_y1 - round(.30 * ppc)
    d.text((ax, pie), f'semilla {semilla} · regenerable con herramientas/generar-marcador.py',
           font=f_ch, fill=(140, 140, 140))

    # Si el texto invade el pie o se sale de la hoja, el impreso saldría cortado
    # y nadie lo notaría hasta tenerlo en la mano.
    if y > pie:
        raise SystemExit(f'la hoja se desborda: el texto llega a {y/ppc:.1f} cm y el pie '
                         f'está en {pie/ppc:.1f} cm. Acorta el texto o baja el cuerpo.')
    return hoja


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('--semilla', type=int, default=7)
    p.add_argument('--ancho-cm', type=float, default=15.0,
                   help='15.0 por default: 3:4 exacto y 480 px a 32 px/cm')
    p.add_argument('--alto-cm', type=float, default=20.0)
    p.add_argument('--dpi', type=int, default=300)
    p.add_argument('--ppcm-compilador', type=int, default=32,
                   help='px = cm × 32: la resolución que la cámara REALMENTE resuelve a 35 cm')
    p.add_argument('--id', default=None)
    p.add_argument('--salida', default=str(Path(__file__).parent / 'marcadores'))
    a = p.parse_args()

    # ── Las cuatro condiciones que hacen imposible un marcador que compile mal
    #    o que mienta en la escala. Cada una falla en silencio si no se revisa
    #    aquí: la (a) recorta el arte, la (b) revienta en el compilador, la (c)
    #    no engancha en campo y la (d) rompe la fórmula del 1:1.
    wc, hc = round(a.ancho_cm * a.ppcm_compilador), round(a.alto_cm * a.ppcm_compilador)
    MIN_W, MIN_H = 480, 640          # constants.json del CLI de 8th Wall
    MIN_ANCHO_CM = 12.1              # ≥30% del cuadro a 35 cm

    if a.alto_cm <= a.ancho_cm:
        p.error('el marcador debe ser VERTICAL (alto > ancho): scale × scaledWidth sólo '
                'colapsa al ancho real si el alto es la dimensión mayor (VERIFICACIONES §7).')
    if abs(a.alto_cm / a.ancho_cm - 4 / 3) > 0.002:
        p.error(f'la proporción debe ser 3:4 exacta y {a.ancho_cm}×{a.alto_cm} da '
                f'1:{a.alto_cm/a.ancho_cm:.4f}. El compilador de 8th Wall fuerza el crop de un '
                f'target plano a height = width × 4/3 (src/crop.js), así que el resto del arte '
                f'se recorta EN SILENCIO y el área trackeada deja de medir ancho_cm — con lo '
                f'que el 1:1 miente. Para ancho {a.ancho_cm} cm el alto es '
                f'{a.ancho_cm*4/3:.2f} cm.')
    if wc < MIN_W or hc < MIN_H:
        p.error(f'a {a.ppcm_compilador} px/cm el target daría {wc}×{hc} px y el compilador '
                f'exige mínimo {MIN_W}×{MIN_H} (constants.json; validateCrop lo rechaza). '
                f'Mínimo {MIN_W/a.ppcm_compilador:.1f} × {MIN_H/a.ppcm_compilador:.1f} cm.')
    if a.ancho_cm < MIN_ANCHO_CM:
        p.error(f'{a.ancho_cm} cm de ancho ocupan sólo '
                f'{100*a.ancho_cm/40.4:.0f}% del cuadro a 35 cm; se necesita ≥30% '
                f'(≥{MIN_ANCHO_CM} cm). Un target chico no tiene arreglo por diseño.')

    marcador_id = a.id or f'JARVIS-M{a.semilla}'
    salida = Path(a.salida)
    salida.mkdir(parents=True, exist_ok=True)

    arte = dibujar_arte(a.ancho_cm, a.alto_cm, a.dpi, a.semilla)
    f_master = salida / f'{marcador_id}-target-{a.dpi}dpi.png'
    arte.save(f_master)

    # El del compilador se saca por downsample del master, no dibujando otra vez:
    # así es la misma imagen que la cámara va a ver del papel, no una variante.
    f_comp = salida / f'{marcador_id}-target-{a.ppcm_compilador}ppcm.png'
    arte.resize((wc, hc), Image.LANCZOS).save(f_comp)

    hoja = dibujar_hoja(arte, marcador_id, a.ancho_cm, a.alto_cm, a.dpi, a.semilla)
    f_hoja = salida / f'{marcador_id}-hoja-A4-{a.dpi}dpi.png'
    hoja.save(f_hoja)

    meta = {
        'marcador_id': marcador_id, 'semilla': a.semilla,
        'ancho_cm': a.ancho_cm, 'alto_cm': a.alto_cm,
        'orientacion': 'vertical', 'proporcion': '3:4', 'dpi': a.dpi,
        'ppcm_compilador': a.ppcm_compilador,
        'target_compilador_px': [wc, hc],
        'hoja': 'A4 vertical, imprimir al 100%',
        '_porque_vertical': 'scale × scaledWidth sólo da el ancho real si alto > ancho (VERIFICACIONES §7)',
        '_porque_3_4': 'el compilador fuerza el crop plano a height = width × 4/3; otra proporción se recorta en silencio',
        '_porque_15x20': '480 × 640 px a 32 px/cm = el mínimo de constants.json y el tamaño nativo de la imagen de luminancia',
    }
    (salida / f'{marcador_id}.json').write_text(json.dumps(meta, indent=2, ensure_ascii=False), encoding='utf-8')

    print(f'{marcador_id}  {a.ancho_cm} x {a.alto_cm} cm  vertical  semilla {a.semilla}')
    for f in (f_master, f_comp, f_hoja):
        print(f'  {f.stat().st_size/1024:7.0f} KB  {f.relative_to(Path.cwd()) if f.is_relative_to(Path.cwd()) else f}')
    print(f'\nvalidar:  python herramientas/evaluar-marcador.py "{f_master}" {a.ancho_cm}')


if __name__ == '__main__':
    main()
