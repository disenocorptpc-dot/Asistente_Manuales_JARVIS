# HANDOFF — Visor 3D AR de piezas de producción

**Proyecto:** web app AR para previsualizar piezas de diseño industrial (señalización, mobiliario expositor, esculturas Massivit) sobre el mundo real, a escala 1:1, con despiece y metadata de producción.
**Área:** Coordinación de Diseño Industrial y 3D — The Palace Company, Cancún.
**Fecha del handoff:** agosto 2026.
**Documento hermano obligatorio:** `PLAYBOOK-WebAR.md` (destilado de Pipo/Wonderwoods). **Leerlo primero.** Todo lo verificado empíricamente vive allá; aquí sólo está lo que cambia o lo que es nuevo.

---

## 0. Cómo usar este documento

Este es el brief de arranque para Claude Code. Está escrito para que un agente sin contexto previo pueda empezar a construir sin volver a discutir decisiones ya tomadas.

- **§1–§2** definen qué se construye y qué no. No renegociar sin decirlo explícitamente.
- **§3–§5** son las decisiones técnicas duras (anclaje, escala). Aquí está el corazón.
- **§6** es el contrato de datos con Blender. Es lo que hace que el visor no necesite código por proyecto.
- **§7–§9** arquitectura, interfaz y deploy.
- **§10** presupuestos numéricos. Son criterios de aceptación, no sugerencias.
- **§11** lo que hay que verificar leyendo el código del binario ANTES de construir encima. No asumir.

**Regla heredada que aplica a todo:** medir antes de asumir (Playbook §10.1). Las dos trampas más caras de Pipo salieron de leer el código minificado del vendor, no de la documentación.

---

## 1. Qué es y qué no es

**Es:** una web app que se abre desde un QR, pide la cámara, ancla un modelo 3D al mundo real a escala 1:1, y permite explotarlo, apagar capas, tocar una pieza y leer su ficha de producción (material, proceso, cantidad, acabado).

**Dos usuarios, dos momentos distintos:**

| Usuario | Momento | Qué necesita |
|---|---|---|
| Dueños / inmobiliaria | Autorización, en sitio | Ver la pieza **a tamaño real en su lugar** antes de producir. Escala y presencia, no detalle técnico. |
| Taller | Producción, en banco | Despiece, orden de ensamble, material y proceso por pieza. Detalle técnico, no espectáculo. |

El mismo visor sirve a los dos con distinto modo de vista. **El de los dueños es el que justifica el proyecto**; el del taller es el que lo hace útil todos los días.

**No es:** un configurador, un editor 3D, un juego, ni un visor de catálogo. No hay backend de contenido en la fase 1. No hay cuentas de usuario.

**No es Pipo.** No hay personaje, ni video, ni alpha packing, ni billboard, ni narración. Todo el Playbook §3, §4, §6 y §7 **no aplica** a este proyecto. El visor es más simple que Pipo en runtime; la complejidad se muda al pipeline de exportación de Blender.

---

## 2. Decisiones cerradas

| Decisión | Valor | Por qué |
|---|---|---|
| Tracking | **8th Wall open source**, binario `@8thwall/engine-binary@1.0.0` | No negociable. Ya probado en campo, ganó comparativa contra MindAR, y es lo único que da SLAM + iOS. |
| Render | **Three.js** por importmap, sin build step | Herencia de Pipo. Un `index.html`. |
| Anclaje | **Híbrido marker-first**, hitTest como fallback | §3 |
| Escala | **1:1 real, derivada del marcador** | §4 |
| Formato de modelo | **GLB** (nunca FBX en runtime) | FBX es propietario, pesado, sin Draco ni KTX2. FBX puede seguir siendo el master de intercambio. |
| Metadata | **`extras` de glTF, escritos por addon propio de Blender** | §6 |
| Interfaz | **HUD hi-tech en paleta Palace** | §8 |
| Deploy | **Cloudflare Worker con static assets** (no Pages) | §9 |
| Prioridad | **AR primero.** Desktop es el fallback, no el punto de partida | El core tiene que nacer camera-agnostic o luego no entra en AR sin cirugía. |
| Voz | Push-to-talk, fase tardía | Confirmado como deseable, no como bloqueante. |
| Gestos de mano | Fase de R&D, al final | Ver §12. |

---

## 3. Anclaje: image target y world tracking NO son excluyentes

**Esta era la duda principal y la respuesta es que no hay que elegir.**

El mismo `XR8.XrController.pipelineModule()` hace world tracking **y** image targets en la misma sesión. De hecho el *extended tracking* documentado en el Playbook §2 —el personaje se queda en su lugar aunque el marcador salga del cuadro— **sólo funciona porque el SLAM está corriendo por debajo sosteniendo la pose mundial del ancla**. O sea: en Pipo ya se estaban usando los dos sistemas a la vez. El marcador daba la pose inicial y la escala; el SLAM la sostenía.

Así que el image target no se descarta. Se **promueve** a modo primario.

### Modo A — Marcador impreso (PRIMARIO)

**Por qué gana para este proyecto:**

1. **Escala 1:1 exacta y gratis.** `detail.scaledWidth` es el ancho del marcador en unidades de mundo. Si sabes que el marcador impreso mide 14.8 cm, tienes el factor unidades/cm **por construcción, sin estimación de nada**. Ver §4.
2. **Identidad.** El marcador dice *qué pieza* es. `detail.name` → carga el GLB correspondiente. El marcador es el índice.
3. **Orientación determinista.** Playbook §2: en un target plano de 8W el **+Y sale de la imagen**, y un modelo Y-up queda de pie sin rotación extra. Verificado en campo, "salió solo a la primera".
4. **Cierra el loop con el entregable que ya existe.** Los manuales de producción ya se hacen en Illustrator y se entregan en PDF. **La hoja del manual ES el marcador.** Un solo impreso lleva el QR que abre la app y el arte que ancla y escala el modelo. Cero material nuevo que producir y distribuir.
5. **Extended tracking.** Playbook §2: en `imagelost` **NO ocultar el modelo.** Crítico aquí, ver abajo.

**Contras y sus mitigaciones:**

- ⚠️ **La trampa de la impresora.** Casi todos los drivers escalan a "ajustar a página". Si la hoja sale al 96%, **todo el modelo mide 4% mal** y el review a 1:1 es una mentira. Mitigación obligatoria: imprimir a **escala 100% / tamaño real**, y el arte del marcador debe llevar una **regla impresa de 10 cm** para verificar con flexómetro antes de usarlo. La app debe pedir esa confirmación una vez.
- ⚠️ **La inclinación es el asesino** (Playbook §6: supervivencia de features 100% a 2°, 18% a 7°, 4% a 10°). Un marcador acostado en el piso se ve siempre oblicuo. Mitigación: **marcador en pared a la altura de los ojos** para señalización — que además es donde la señalización vive de verdad. Para mobiliario y esculturas: tent card o atril, nunca plano en el suelo.

### El protocolo de uso para piezas grandes (importante y contraintuitivo)

El Playbook §6 dice: *"el personaje debe ser MÁS CHICO que el ancho del marcador — fatal sin extended tracking"*. **Esa regla se suspende aquí**, y hay que decirlo porque suena a que se está rompiendo algo.

Era una regla para el caso sin tracking extendido. Nosotros sí lo tenemos, así que el protocolo es:

1. **Engancha de cerca** (~35 cm del marcador). A esa distancia un A5/A6 ocupa >30% del cuadro y el lock es rápido y preciso.
2. **Retrocede.** El marcador sale del cuadro, el SLAM sostiene la pose, y la pieza de 3 m se queda plantada donde debe.
3. Si se pierde, te acercas otra vez y re-enganchas.

Esto significa que el marcador puede ser chico aunque la pieza sea enorme. Sin este protocolo escrito en la UI, el usuario va a intentar encuadrar marcador y pieza al mismo tiempo, va a fallar, y va a concluir que el tracking es malo.

### Modo B — hitTest sin marcador (FALLBACK)

Playbook §11 lo lista como módulo del binario no usado en Pipo: *"World tracking: colocar contenido en superficies SIN marcador"*.

**Cuándo usarlo:** no hay impreso a mano, o la revisión es en modo *tabletop* (pieza a 1:10 sobre una mesa) donde la precisión de escala no es el punto.

**Su límite real:** sin marcador no hay una referencia física de tamaño conocido, así que la escala absoluta la tiene que **estimar el motor** a partir de la altura de la cámara sobre el piso. Eso requiere coaching ("mueve el teléfono en círculos") y arrastra error. Para un review de autorización a 1:1 no es suficiente; para "quiero ver rápido cómo se ve", perfecto.

**Implementación:** ambos modos comparten el mismo grafo de escena y el mismo core. Sólo cambia quién escribe la pose del grupo ancla. No hay bifurcación arquitectónica.

---

## 4. Escala 1:1 — cómo se garantiza

Requisito confirmado: **1:1 es el default.**

### Contrato con el GLB

El modelo debe venir en **metros**, Y-up. En Blender: *Unit Scale* 1.0, sistema métrico, y export glTF con `+Y up`. El addon (§6) **verifica y escribe la unidad en los `extras`** para que el visor no tenga que adivinar. Si la unidad no viene declarada, el visor debe rechazar el modelo con un error claro, no cargarlo mal en silencio.

### Derivación desde el marcador (modo A)

```js
// detail.scaledWidth = ancho del marcador en unidades de mundo de 8W
// anchoMarcadorCm    = dato físico declarado en extras.marcador.ancho_cm
const unidadesPorCm = detail.scaledWidth / anchoMarcadorCm;
const unidadesPorMetro = unidadesPorCm * 100;

modelo.scale.setScalar(unidadesPorMetro);   // GLB en metros → mundo 8W
```

Todo lo demás —cotas, retícula del piso, distancias de explotado— se dimensiona contra `unidadesPorCm`. **Nunca hardcodear un factor de escala.**

### Anclaje del pivote

Herencia conceptual de Pipo (`geometry.translate(0, 0.5, 0)` para dejar al personaje de pie), pero con GLB el equivalente es:

Recentrar el pivote al **centro-inferior del bounding box** del modelo completo, de modo que se asiente sobre el plano del marcador y rote sobre su propio eje vertical. El addon debe poder declarar un anclaje distinto en `extras.anclaje` (`base_centro` por default; `centro_geometrico` para piezas colgantes; `punto_named` apuntando a un empty de Blender para casos raros como una señal en voladizo).

### Toggle de escala en UI

- **1:1** (default) — modo autorización.
- **1:10 tabletop** — modo mesa, para ver la pieza completa en interior chico.

El toggle debe mostrar la escala activa de forma permanente y muy visible. Que alguien autorice creyendo que ve 1:1 cuando está en tabletop es el peor error posible del proyecto.

---

## 5. Herencia de Pipo — mapa explícito

### Se recicla literal (riesgo ya pagado)

- `await XR8.loadChunk('slam')` antes de tocar `XrController`. Sin esto: `Cannot read properties of null`. **No documentado, no obvio.**
- Pedir `getUserMedia` uno mismo **antes** de `XR8.run`, para tener el error real (permiso negado / sin cámara / ocupada) en vez del `undefined` de XR8.
- Precargar motor y modelo **en paralelo** desde que abre la página, no en serie.
- **La trampa del canvas 300×150.** `ajustarLienzo()` antes de `XR8.run` y en cada `orientationchange`.
- `window.THREE = THREE` como global (XR8.Threejs lo espera).
- Versión de CDN **clavada exacta**, nunca `@1` flotante. Un QR impreso no puede depender de un rango de versiones.
- `antialias: false`, techo de `pixelRatio` **1.5**.
- Nada de `mix-blend-mode` a pantalla completa ni `backdrop-filter` sobre elementos encima del feed. Ver §8, esto pelea con la estética pedida.
- Overlays ocultos con `visibility: hidden` además de `opacity: 0`.
- Panel `?debug=1` **colapsado por defecto**, una línea (motor · estado · fps), expandible, con toggles en dispositivo para las convenciones inciertas.
- **Fallback sin cámara obligatorio.** Permiso negado o equipo viejo → visor orbital 3D sobre fondo neutro. No es un error, es la experiencia menos el AR.
- Telemetría que separa RED de GPU, y las tres fallas de tracking (no engancha / se suelta / tiembla).
- `contenido.json` estático: todo parámetro medido vive ahí con su porqué, no en el código.
- `herramientas/evaluar-marcador.py` para validar el arte del target.

### Cambia de naturaleza

- **El presupuesto de rendimiento se invierte.** En Pipo la geometría era un rectángulo y el cuello era fragmentos + bitrate. Aquí no hay video, pero hay malla real: el cuello se muda a **triángulos, draw calls y materiales**. Ver §10.
- **El pivote**: de `translate(0,0.5,0)` en un plano a recentrado de bbox en un GLB. §4.
- **Los eventos de imagen** ahora disparan carga de modelo e identidad, no arranque de video.

### No aplica en absoluto

Playbook §3 completo (alpha packing, despeje del composite, polaridad de máscara, presupuestos de video), §4 completo (billboard, el bug de los 245°, sombra de contacto de shader), §7 completo (MindAR). La ciencia de targets de §6 **sí aplica** para diseñar el arte del marcador, y es directamente el brief para el equipo de diseño.

---

## 6. El addon de Blender — el contrato de datos

Idea del usuario, y es la decisión más elegante del proyecto: **si el GLB se describe a sí mismo, el visor no necesita código por proyecto.** Un archivo nuevo no toca una línea de JavaScript.

El addon hace dos trabajos: **escribe metadata** y **actúa como linter del pipeline**.

### Metadata a nivel escena

En los `extras` de la escena (o en un empty `__PALACE_META__` si el exportador no los propaga — **verificar cuál sobrevive al export**):

```json
{
  "palace_schema": 1,
  "pieza_id": "SIG-LOBBY-VILLA-01",
  "pieza_nombre": "Señalización direccional Lobby Villa",
  "proyecto": "Villa del Palmar — Lobby",
  "unidad": "m",
  "y_up": true,
  "anclaje": "base_centro",
  "bbox_cm": [120, 240, 8],
  "marcador": {
    "id": "villa_lobby_01",
    "ancho_cm": 14.8,
    "montaje": "pared"
  },
  "revision": "R3",
  "fecha": "2026-08-05",
  "autor": "Homero Hernández"
}
```

### Metadata a nivel objeto

En los `extras` de cada objeto — las *custom properties* de Blender se exportan a `extras` en glTF, así que esto es un camino soportado, no un hack:

```json
{
  "pieza_nombre": "Placa frontal",
  "pieza_id": "01-PLACA-FRONTAL",
  "capa": "Estructura",
  "material": "Acero inox 304, cal. 3 mm",
  "proceso": "Corte láser + doblez",
  "acabado": "Pintura electrostática RAL 7016 mate",
  "cantidad": 2,
  "orden_ensamble": 3,
  "explode_vector": [0, 0, 1],
  "explode_dist_cm": 12,
  "nota_taller": "Soldar antes de pintar"
}
```

### La regla clave del explotado: default procedural, override opcional

- Si el objeto **no** trae `explode_vector`, el visor calcula el desplazamiento procedural: vector desde el centro del ensamble hacia el centro del bbox de la pieza, escalado por un slider 0–1. Funciona con cualquier modelo bien nombrado, cero autoría.
- Si **sí** lo trae, el override manda.

Esto da control artístico exactamente donde el radial se ve mal, sin obligar a autorear el despiece completo de cada pieza. Con los tiempos de entrega del área, autorear todo no es opción.

### El addon como linter (esto es lo que evita el desperdicio)

Antes de exportar, el addon debe **bloquear con reporte claro** si:

- *Unit Scale* ≠ 1.0 o el sistema no es métrico.
- Algún objeto visible carece de `pieza_nombre` o `capa`.
- Hay `pieza_id` duplicados.
- El conteo de triángulos excede el presupuesto de §10 (semáforo por objeto, para saber a quién decimar).
- Hay texturas sin comprimir o >2048 px.
- Hay nombres de objeto con caracteres que rompen JSON o URLs.

Y al exportar debe aplicar **Draco o meshopt + KTX2** de forma automática, no como paso manual que alguien va a olvidar.

**Capas:** las colecciones de Blender se mapean a nodos padre en glTF y de ahí a los toggles del UI. El campo `capa` en cada objeto es el respaldo para cuando la jerarquía no sea limpia.

---

## 7. Arquitectura de código

```
public/                      ← lo ÚNICO que se sirve (regla Playbook §9)
  index.html                 ← entry único, importmap, sin build step
  app/
    boot.js                  ← secuencia de arranque XR8 (adaptada de Pipo)
    ar-shell.js              ← pipeline modules, permisos, canvas sizing
    anchor-marker.js         ← modo A: image target → pose + escala + identidad
    anchor-hittest.js        ← modo B: superficie → pose + escala estimada
    desktop-shell.js         ← fallback orbital sin cámara
    core/                    ← ⚠️ CERO imports de XR8 y cero DOM
      scene.js               ← grafo. NUNCA toca la cámara.
      loader.js              ← GLB → índice de piezas + parseo de extras
      explode.js             ← procedural + override
      layers.js              ← toggles por capa
      pick.js                ← raycast → pieza → ficha
      scale.js               ← 1:1 desde marcador / desde estimación
    ui/
      hud.js  hud.css        ← §8
    debug.js                 ← ?debug=1
  contenido.json             ← parámetros medidos, comentados con su porqué
  models/  targets/
wrangler.jsonc
_headers
herramientas/                ← FUERA de public/
  blender-addon/
  evaluar-marcador.py
```

### La regla dura de arquitectura

**`core/` no importa nada de XR8 ni toca el DOM.** Recibe `{scene, camera, renderer}` desde el shell y opera sobre el grafo. Nunca escribe `camera.position` — en AR la cámara la mueve el SLAM en cada frame.

Esa única regla es lo que permite tres cosas: que el shell de desktop sea trivial, que el día que el binario de SLAM se rompa se cambie el shell y no el visor, y que el core se pueda probar sin teléfono.

`XR8.run()` maneja el `requestAnimationFrame`. El core expone un `update(dt)` que el shell llama desde `onUpdate`.

---

## 8. Interfaz — HUD hi-tech en paleta Palace

**Dirección pedida:** hi-tech tipo HUD de Tony Stark. Alta densidad de información, retículas, leader lines, cotas, sensación de instrumento.

### La jugada: Stark en colores Palace, no cian genérico

El cian de Iron Man es el default de todo mundo y no dice nada de la empresa. La versión elegante es el mismo lenguaje visual en la paleta corporativa:

- Fondo / paneles: **Azul Océano `#254D6E`** a baja opacidad, sobre casi-negro.
- Líneas, retículas, cotas, datos activos: **Bronce `#B88F69`**. Este es el acento. Es el que hace que se vea Palace y no Marvel.
- Texto principal: **Perla `#EDECE4`**.
- Estados secundarios / inactivos: **Azul Ligero `#E0E5E5`**.

Resultado: se lee como instrumento de precisión y es inconfundiblemente corporativo. Eso importa porque esta herramienta se va a usar frente a los dueños: tiene que verse como aparato de trabajo de la compañía, no como demo de videojuego.

### ⚠️ La estética pelea con el rendimiento — cómo resolverlo

Un HUD Stark se construye normalmente con `backdrop-filter: blur()`, glows por `filter: drop-shadow` y `mix-blend-mode`. **El Playbook §5 los prohíbe explícitamente**: se recalculan cada frame encima del feed de cámara y producen jank medible. Así que:

| Efecto que se quiere | Cómo NO hacerlo | Cómo sí |
|---|---|---|
| Paneles de vidrio | `backdrop-filter: blur()` | Relleno semitransparente plano + borde de 1px bronce. Se ve igual de bien sobre un feed de cámara que ya es ruidoso. |
| Glow / halo | `filter: drop-shadow` animado | `box-shadow` estático en elementos chicos; o mejor, glows **dentro de la escena WebGL** como sprites con blending aditivo (baratísimos en GPU comparado con recomponer el DOM). |
| Retículas, corchetes, leader lines | Imágenes con filtros | **SVG con `stroke`**, estático, sin filtros. |
| Scanline / barrido | animar `background-position` o filtros | animar `transform: translateY` (compositado en GPU). |
| Aparición de elementos | animar `filter` o `box-shadow` | animar `opacity` y `transform` únicamente. |

### Componentes del HUD

- **Leader lines a las piezas:** etiqueta 2D anclada a la posición 3D proyectada, unida por línea quebrada estilo blueprint. Esto *es* el look Stark y al mismo tiempo *es* el despiece. Función y estética resueltas por la misma pieza.
- **Ficha de pieza** al tocar: nombre, material, proceso, acabado, cantidad, orden de ensamble, nota de taller. Todo viene de los `extras`.
- **Slider de explotado** 0–1, físico y grande (se usa con una mano sosteniendo el teléfono).
- **Panel de capas** con toggles.
- **Indicador de escala permanente y prominente** — `1:1` o `1:10`. Ver §4.
- **Cotas en el mundo** (alto/ancho/profundo en cm) dibujadas en 3D junto a la pieza. Refuerza el 1:1 y es lo primero que pregunta cualquiera.
- **Retícula de piso** sutil bajo la pieza, en bronce. Ancla visualmente y comunica "esto está medido".
- **Coaching de tracking**: cuando el ángulo entre la normal del marcador y la línea de vista pasa de 40°, avisar (Playbook §6).
- **Botones de captura**: foto y video. Ver §12.

Ergonomía: todo control primario en el **tercio inferior** y alcanzable con el pulgar. El usuario sostiene el teléfono con una mano y a veces apunta con la otra.

---

## 9. Deploy — Worker, y no fue error

**Pregunta del usuario:** Pipo vive como Worker y no como Page, "eso fue más un error que otra cosa".

**No fue error. Fue la decisión correcta, y hoy es la recomendación oficial de Cloudflare.**

- Desde marzo 2026 **Workers con static assets tiene paridad de features con Pages** para assets estáticos, SSR y dominios custom.
- La recomendación de Cloudflare para **proyectos nuevos es arrancar en Workers**, no en Pages. Pages sigue soportado, pero es la plataforma en modo mantenimiento.
- Todo lo nuevo aterriza **sólo en Workers**: Durable Objects, Workflows, Containers, Secrets Store.
- Los requests de assets estáticos son gratis, igual que en Pages.

**Y para este proyecto en particular hay una razón concreta que sella la decisión:** la integración con SharePoint (§12) necesita un endpoint server-side que intercambie el token de Graph, para **no exponer credenciales en el cliente**. Con un Worker eso es la misma unidad de deploy — assets + una ruta `/api/model/:id`. Con Pages sería Pages Functions, justo el camino que Cloudflare ya no empuja. Migrar después sería trabajo tirado.

**Recomendación: Worker, mismo patrón que Pipo.** Copiar el `wrangler.jsonc` de Pipo tal cual, con sus dos trampas ya resueltas:

- `assets: { directory: "./public", not_found_handling: "none" }` — **nunca** `"single-page-application"`, que vuelve invisibles los 404.
- `observability: enabled` — la analítica del prototipo es el argumento presupuestal de la fase 2.

`_headers`: `X-Robots-Tag: noindex` global, assets inmutables con `max-age=31536000` (versionar por nombre de archivo), HTML/JSON en `no-cache`.

Recordatorio: `getUserMedia` exige HTTPS. No se prueba pasando el HTML por WhatsApp. `localhost` sirve en escritorio; para teléfono, deploy o túnel.

---

## 10. Presupuestos y criterios de aceptación

Son criterios, no sugerencias. El linter del addon los valida.

**Malla (el presupuesto nuevo de este proyecto):**

- Triángulos: **≤300k** total para 60 fps cómodo en móvil de gama media. Techo duro 500k.
- Draw calls: **≤80**. Consolidar materiales; cada material distinto es un draw call.
- Materiales únicos: **≤15**.
- Las esculturas Massivit salen con millones de triángulos. **Decimado + meshopt no es optimización, es requisito** — exactamente igual que el reencode del MP4 era requisito en Pipo por el límite de 25 MB.

**Peso y red:**

- GLB **≤15 MB**. Cloudflare rechaza >25 MB, y en 4G un GLB de 20 MB son ~30 s de espera con la cámara ya encendida.
- Texturas en **KTX2/basis**, ≤2048 px.

**Runtime:**

- `pixelRatio` techo 1.5, `antialias: false`.
- Sesión útil **3–4 min** antes de que el teléfono caliente y throttlee. Diseñar el flujo para eso: la revisión es corta y va al grano.

**Tracking (métricas a instrumentar, Playbook §5):**

- ms al primer lock, enganches/pérdidas, tiempo pegado vs total.
- Target ≥30% del ancho del cuadro a distancia de enganche.
- ≥250 puntos repetibles, cobertura ≥75%, ≥300 feature points del compilador a escala 1.
- Compilar el target **a la resolución de la cámara**, no a la máxima: `px_objetivo = cm_del_target × 32`. En Pipo corregir esto duplicó los puntos útiles (244 → 475) sin tocar el arte.

---

## 11. A verificar en el código del binario ANTES de construir

Aplicando el método del Playbook §10.8 — las dos trampas más caras salieron de leer el vendor minificado, no de la doc. Dumpear el API de `xr.js` y confirmar:

1. **¿Existe modo de escala absoluta?** Buscar `XR8.XrController.configure({ scale: ... })` y los valores aceptados (`'absolute'` / `'responsive'`). El Playbook §11 menciona un `coaching-overlay` para *Absolute Scale*, lo que sugiere que sigue ahí. **Determina si el modo B es viable para 1:1 o queda sólo para tabletop.**
2. **Firma exacta de `XR8.XrController.hitTest`** — parámetros, tipos de resultado, si requiere que el SLAM haya converjido.
3. **¿`loadChunk('slam')` habilita hitTest**, o hay un chunk aparte? Es exactamente la clase de trampa que costó caro en Pipo.
4. **¿Conviven `imageTargetData` y hitTest en la misma sesión?** El diseño de §3 lo asume. Confirmarlo antes de escribir el shell.
5. **¿Hand Tracking está en el binario?** El Playbook §11 lo lista como propietario junto con SLAM y VPS, pero VPS está explícitamente *excluido* del binario. Si Hand Tracking sí viene incluido, cambia por completo el plan de §12 — sería gratis en vez de reimplementarlo con MediaPipe.
6. **¿`extras` de escena sobreviven al exportador de glTF de Blender?** Si no, usar el empty `__PALACE_META__`. Probar antes de escribir el addon.

---

## 12. Fases

| # | Entregable | Notas |
|---|---|---|
| **F0** | Verificaciones de §11 + arranque del shell AR con GLB sintético multi-pieza | Método Playbook §10.5: separar riesgo técnico de riesgo creativo. El asset final sólo reemplaza un archivo. |
| **F1** | Marcador + pose + **escala 1:1** + protocolo de enganche + fallback sin cámara | Aquí ya hay algo que enseñar. |
| **F2** | Addon de Blender + `extras` + explotado + capas + picking + fichas | El contrato de datos de §6. |
| **F3** | HUD Palace completo (§8) | El *WOW*. |
| **F4** | `CanvasScreenshot` + `MediaRecorder` + deep link `?pieza=` + QR en el manual | Ver abajo — barato y de altísimo retorno. |
| **F5** | Voz push-to-talk | ~15 comandos, vocabulario cerrado. `webkitSpeechRecognition` existe en iOS Safari pero es frágil y **no funciona en WebView ni PWA standalone**; fallback a Whisper por API con blob de 2–3 s. El micrófono NO pelea con la cámara. |
| **F6** | SharePoint vía proxy en el Worker | Graph `?select=@microsoft.graph.downloadUrl` (preautenticada, sin preflight CORS, caduca ~1 h). El endpoint `/content` **no** sirve: responde 302 y el redirect está prohibido con header `Authorization`. Requiere app registration en Azure AD → es política de IT, no ingeniería. |
| **F7** | Gestos de mano, MediaPipe Hands sobre el frame del pipeline | Sólo si §11.5 confirma que el módulo propietario no está disponible. **Una cámara, dos consumidores** — no hay forma de abrir dos cámaras simultáneas en móvil, ni en iOS ni en Android. |

**En paralelo desde el día uno, no como fase:** el pipeline Blender → GLB (nombres, `extras`, decimado, KTX2). Es lo único que puede matar el proyecto en silencio y no depende de que el AR funcione.

### F4 merece un párrafo

`CanvasScreenshot` y `MediaRecorder` ya vienen en el binario. El Playbook §11 marca `MediaRecorder` como *probablemente el feature de mayor ROI no explotado*. Aquí significa que el del taller captura la vista con el despiece y la pega en WhatsApp, y que el director graba la señalización a escala real en el lobby y la manda por correo. Cuesta casi nada y es lo que hace que la herramienta circule sola dentro de la empresa.

---

## 13. Checklist de arranque para Claude Code

1. Leer `PLAYBOOK-WebAR.md` completo. No es opcional.
2. Resolver las seis verificaciones de §11. Documentar cada respuesta en el repo con la evidencia.
3. Scaffold: `public/index.html` con importmap, `wrangler.jsonc`, `_headers`, `contenido.json`.
4. Portar la secuencia de arranque del Playbook §2, con `loadChunk('slam')`, `getUserMedia` propio y `ajustarLienzo()` antes de `run`.
5. Generar un **GLB sintético multi-pieza con `extras` ya poblados** (script, no modelado) para desarrollar todo el core sin depender de un asset real.
6. Panel `?debug=1` desde el primer commit, con toggles en dispositivo para cada convención incierta. En Pipo, un toggle que apaga el billboard respondió en 5 segundos lo que días de opinión no.
7. Deploy temprano y probar **en teléfono real**. El escritorio no sirve para validar tracking.

### Preguntas abiertas para el usuario

- Pieza piloto: ¿una señalización sencilla o una escultura Massivit? Determina el peso del pipeline de decimado desde el arranque. **Recomendación: señalización** — geometría limpia, poco polígono, y es el caso donde el 1:1 en pared vale más.
- Marcador: ¿se puede meter el arte del target en la plantilla de manual de Illustrator que ya usa el área? Si sí, el marcador deja de ser material nuevo.
- Acceso al repo de Pipo para copiar `wrangler.jsonc` y el bootstrap exacto.

---

## Fuentes externas consultadas

- [8thwall/8thwall — monorepo y licencias](https://github.com/8thwall/8thwall)
- [8thwall/engine — binario distribuido con SLAM](https://github.com/8thwall/engine/tree/main)
- [8th Wall — Open Source docs](https://8thwall.org/docs/open-source)
- [Migrate from Pages to Workers — Cloudflare docs](https://developers.cloudflare.com/workers/static-assets/migration-guides/migrate-from-pages/)
- [Full-stack development on Cloudflare Workers — Cloudflare Blog](https://blog.cloudflare.com/full-stack-development-on-cloudflare-workers/)
- [CORS support — OneDrive/SharePoint API, Microsoft Learn](https://learn.microsoft.com/en-us/onedrive/developer/rest-api/concepts/working-with-cors?view=odsp-graph-online)
- [Download driveItem content — Microsoft Graph v1.0](https://learn.microsoft.com/en-us/graph/api/driveitem-get-content?view=graph-rest-1.0)
- [SpeechRecognition — MDN](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition)
