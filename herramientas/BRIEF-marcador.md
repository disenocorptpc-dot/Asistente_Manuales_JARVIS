# Brief: diseñar el impreso que Pipo va a reconocer

Para el equipo de diseño industrial. Esto no es una preferencia estética: son las
condiciones para que la cámara de un teléfono pueda reconocer la pieza y anclar
al personaje encima. Un diseño que no las cumple no falla "un poco" — no engancha.

Todo lo de aquí salió de medir el menú actual, no de un manual.

---

## Cómo piensa el tracker (y por qué te va a sorprender)

El teléfono no reconoce dibujos. Busca **puntos distintivos** —esquinas, cruces
de líneas, cambios bruscos— y los describe por su vecindario. Luego los busca
otra vez, cuadro a cuadro. De ahí salen tres consecuencias contraintuitivas:

**1. Ve en escala de grises.** Tu paleta de matices no existe para él. Verde
sobre verde del mismo tono es, literalmente, una hoja en blanco. Lo que necesita
es **contraste de valor**: oscuros casi negros contra claros.

**2. La repetición lo ciega.** Si un motivo aparece dos veces, sus dos copias
producen descriptores idénticos y el tracker no puede distinguirlos. Se confunde
y da poses falsas.

**3. El ruido fino no le sirve.** Una textura acuarela con miles de motitas
genera muchísimos puntos, pero ninguno sobrevive al desenfoque de una mano
temblando ni a la luz tibia de un restaurante.

---

## Qué medimos en el menú actual

| zona | puntos utilizables |
|---|---|
| Fondo acuarela verde | **0 – 11** |
| El duende junto al QR | 145 |
| El árbol de los anillos | 197 |
| El pergamino de postres | 206 |

El fondo —que es la mayor parte de la superficie— no aporta **nada**. Todo el
trabajo lo cargan cuatro ilustraciones que son islas en un mar vacío.

Y el dato que más pesa, el aguante a la inclinación del teléfono:

| inclinación | puntos que sobreviven |
|---|---|
| 2° | 100% |
| 4° | 70% |
| 7° | **18%** |
| 10° | **4%** |

Se desploma. Y un menú acostado en la mesa **siempre** se ve inclinado.

---

## Las reglas

### Formato

- **Tent card vertical**, no una hoja acostada. Es la regla más importante de
  este documento. Una pieza que se para queda casi paralela a la cámara de
  alguien sentado de frente; un menú en la mesa se ve siempre en ángulo agudo,
  que es donde el tracking pierde el 80% de su información.
- **10 × 14 cm** (A6). Medida estándar, económica de imprimir. No menos de 10 cm
  de ancho: abajo de eso el impreso ocupa muy poco del cuadro.
- **Acabado mate. Nunca brillante, nunca UV.** El reflejo especular de la lámpara
  del restaurante borra los puntos justo donde pega la luz — y en un restaurante
  la luz viene de arriba, reflejando hacia la cara del comensal.

### Color

- **Contraste de valor obligatorio.** Oscuros casi negros (verdes de bosque
  profundo, cafés de corteza) contra claros (pergamino, crema). Si entrecierras
  los ojos y todo se ve del mismo gris, no sirve.
- La paleta de Wonderwoods se puede conservar; lo que hay que cambiar es el
  **rango de luminosidad**, no el matiz.

### Composición

- **Detalle denso y parejo en toda la superficie.** No un dibujo al centro
  rodeado de fondo liso. Cada cuadrante debe tener contenido.
- **Cero áreas planas grandes.** Ni fondos lisos ni degradados suaves como
  contenido principal.
- **Asimetría total.** Ningún motivo repetido, ninguna simetría espejo, ninguna
  trama regular. Los ornamentos de esquina espejeados del menú actual son
  activamente dañinos: para el tracker son gemelos indistinguibles.
- **Un borde irregular con esquinas duras.** Muescas asimétricas, no un marco
  parejo. Las esquinas geométricas dan puntos estables que aguantan el
  desenfoque.

### El QR

- **2.5 – 3 cm de lado.** El del menú actual mide 1.55 cm, lo que obliga a
  acercar el teléfono a ~15 cm. Con 2.5 cm se lee cómodo a 25–30 cm.
- **Corrección de errores nivel H (30%).** No es opcional: la W del logo tapa el
  centro del código y se come parte de ese presupuesto. Con nivel M o Q va a
  leer bien en el monitor y va a fallar con papel doblado y una mancha de salsa.
- El QR **no** es el target. Es un pasajero dentro de la pieza. Un código QR es
  el peor caso posible para tracking: miles de esquinas idénticas de cuadritos
  idénticos.

---

## Cómo se valida antes de imprimir

Exporta la propuesta como PNG y córrela:

```bash
python herramientas/evaluar-marcador.py propuestas/tent-card-v1.png 10
```

Devuelve cuatro números con su meta:

| criterio | meta |
|---|---|
| Tamaño en cuadro a 35 cm | ≥ 30% del ancho |
| Puntos repetibles | ≥ 250 |
| Cobertura (detalle repartido) | ≥ 75% |
| Feature points de MindAR a escala 1 | ≥ 300 |

Más el aguante a la inclinación, que se reporta aparte y es el que más conviene
vigilar.

**Advertencia honesta:** cumplir estos mínimos es *necesario, no suficiente*. La
herramienta degrada un render digital; no captura tinta, trama de impresión,
textura de papel, reflejos ni el comportamiento real de la cámara. Sirve para
descartar diseños malos temprano y para iterar contra un número en lugar de una
corazonada — no para certificar que un diseño va a funcionar. La prueba final es
siempre imprimir y medir en una mesa.

---

## En una frase

Lo que el tracker quiere es lo contrario de lo que suele verse elegante: **mucho
contraste duro, mucho detalle irregular, nada repetido, nada suave, y de pie.**
