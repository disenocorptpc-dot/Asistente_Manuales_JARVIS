# PLAYBOOK — WebAR con personaje de video sobre impreso

**Destilado del proyecto Pipo/Wonderwoods (The Palace Company, agosto 2026).**
Todo lo de aquí fue medido o verificado empíricamente en ese proyecto — nada es
teoría de manual. Los números concretos son de ese caso, pero el método y las
trampas aplican a cualquier experiencia del mismo tipo: **un QR en un impreso
abre una web app; un personaje en video con transparencia aparece anclado al
impreso y habla.**

> **Cómo usar este documento:** inyectarlo al inicio de un proyecto nuevo
> (pegarlo en el contexto de Claude, o guardarlo como referencia del repo).
> Contiene las decisiones, el porqué, las trampas no documentadas y el código
> de las piezas críticas. Referencia de implementación completa:
> repo `disenocorptpc-dot/Pipo_wonderwoods` (privado).

---

## 1. El stack ganador

| Capa | Elección | Por qué |
|---|---|---|
| Tracking AR | **8th Wall open source** (binario `@8thwall/engine-binary@1.0.0`) | Ganó comparativa de campo contra MindAR sobre el mismo target: fusión visión+giroscopio y extended tracking vía SLAM. "La estabilidad es brutal." |
| Render | **Three.js** (0.160, ES modules por importmap) | — |
| Personaje | **Video con alpha packing** como billboard | Elimina rig, lip sync y shape keys; corre en H.264 universal |
| Audio | **Embebido en el MP4**, disparado por tap | Sincronía por construcción; esquiva el bloqueo de autoplay de iOS |
| Contenido | `contenido.json` estático | Todo parámetro medible vive ahí, no en el código |
| Hosting | **Cloudflare Worker de assets estáticos** | HTTPS + CDN, sin build step, deploy por push |
| QR | **Dinámico** | Seguro anti-proveedor: si algo muere, se cambia el destino sin reimprimir |

Sin framework, sin npm en el entregable, sin backend. Un `index.html`.

**Plan B de tracking:** MindAR (gratis, solo-visión, techo más bajo — §7).
**Plan C (pago):** Mattercraft de Zappar.
**Nunca:** la plataforma *hosteada* de 8th Wall (retirada 28-feb-2026; sus
experiencias publicadas mueren 28-feb-2027). El open source es otra cosa — §2.

---

## 2. 8th Wall open source — lo que no está documentado

En febrero 2026 Niantic retiró la plataforma hosteada y liberó 8th Wall:

- **MIT:** arquitectura del motor, Image Targets, Face Effects, Sky Effects,
  el CLI de targets, XRExtras.
- **Binario con licencia limited-use:** el motor con SLAM
  (`@8thwall/engine-binary` en npm). Uso comercial y no comercial permitido,
  descargable a perpetuidad, **no** redistribuir modificado. ⚠️ **Antes de
  desplegar a escala: revisión legal del Permitted Use FAQ.**
- **Verificado empíricamente:** el binario NO exige app key y NO valida contra
  ningún servidor. La única referencia a `appKey` en el código es el regex
  legado que la extraía de la URL del script.

### La trampa número uno: el SLAM se carga por chunk

`XR8.XrController` es **literalmente `null`** hasta que llamas:

```js
await XR8.loadChunk('slam');   // importa xr-slam.js, hermano de xr.js en el CDN
```

En la plataforma hosteada esto lo disparaba la URL con appKey; self-hosted hay
que pedirlo explícitamente. No está documentado — salió de leer el código del
loader dentro del binario. Sin esto: `Cannot read properties of null`.
(El chunk de caras es `loadChunk('face')` → `xr-face.js`.)

### Secuencia de arranque completa (probada en campo)

```html
<!-- Versión EXACTA clavada: @1 flotante dejaría que una actualización del
     binario cambie el motor sin avisar. Para subir: cambiar, probar, commitear. -->
<script src="https://cdn.jsdelivr.net/npm/@8thwall/engine-binary@1.0.0/dist/xr.js"
        async crossorigin="anonymous"></script>
```

```js
import * as THREE from 'three';
window.THREE = THREE;              // XR8.Threejs espera THREE como global

// 1. Precargar motor y target EN PARALELO desde que abre la página
//    (en serie, el primer enganche tardaba visiblemente más):
const motorListo = (async () => {
  await esperarXR8(15000);         // promesa sobre el evento 'xrloaded'
  await XR8.loadChunk('slam');
  if (!XR8.XrController) throw new Error('chunk SLAM no cargó');
})();
motorListo.catch(() => {});        // sin unhandled rejection si caemos a fallback
const targetPromesa = fetch('image-targets/menu.json').then(r => r.json());

// 2. Pedir la cámara UNO MISMO antes de arrancar XR8: XR8 rechaza con
//    `undefined` cuando getUserMedia falla, y el diagnóstico queda ciego.
//    Pedirla primero da el error real (permiso negado / sin cámara / ocupada)
//    y el permiso queda concedido para XR8.

// 3. Configurar el target y correr:
await motorListo;
const targetJson = await targetPromesa;
targetJson.imagePath = new URL('image-targets/menu_luminance.png', location.href).pathname;
XR8.XrController.configure({ imageTargetData: [targetJson] });

XR8.addCameraPipelineModules([
  XR8.GlTextureRenderer.pipelineModule(),   // pinta el feed de la cámara
  XR8.Threejs.pipelineModule(),             // escena three.js con pose de SLAM
  XR8.XrController.pipelineModule(),        // tracking: mundo + image targets
  {
    name: 'mi-modulo',
    onStart: () => {
      const { scene, camera } = XR8.Threejs.xrScene();
      scene.add(ancla);
      camera.position.set(0, 2, 2);
      XR8.XrController.updateCameraProjectionMatrix({
        origin: camera.position, facing: camera.quaternion });
    },
    onUpdate: () => { /* billboard, subtítulos, telemetría */ },
    onException: (err) => { /* → fallback */ },
    listeners: [
      { event: 'reality.imagefound',   process: alEncontrar },
      { event: 'reality.imageupdated', process: alActualizar },
      { event: 'reality.imagelost',    process: alPerder },
    ],
  },
]);

ajustarLienzo();                   // ¡ANTES de run! ver trampa del canvas
XR8.run({ canvas, allowedDevices: XR8.XrConfig.device().ANY });
```

### La trampa del canvas: 300×150

Un `<canvas>` sin atributos mide **300×150 de buffer**, y XR8 pinta el feed de
la cámara **al tamaño del buffer** — el CSS lo estira borroso, "la cámara no se
ve a pantalla completa". Dimensionar el buffer al viewport antes de `XR8.run`
y en cada `orientationchange`:

```js
function ajustarLienzo(){
  const k = Math.min(devicePixelRatio, 1.5);
  canvas.width  = Math.round(document.documentElement.clientWidth  * k);
  canvas.height = Math.round(document.documentElement.clientHeight * k);
}
```

### Los eventos y sus convenciones (verificadas en campo)

`detail` de `imagefound`/`imageupdated`:
`{ name, position, rotation (quaternion), scale, scaledWidth, scaledHeight }`

- Aplicar a un grupo ancla: `ancla.position.copy(detail.position);
  ancla.quaternion.copy(detail.rotation);`
- **Ejes del target plano: +Y sale de la imagen** (un personaje Y-up queda DE
  PIE sobre el impreso sin rotación extra), el borde superior de la imagen
  apunta a −Z local. *(Verificado: "salió solo" a la primera con rotación 0.)*
- **Escala:** `scaledWidth` = ancho del marcador en unidades de mundo. Todo se
  dimensiona contra eso: `altoPersonaje = scaledWidth × (alturaCm / anchoMarcadorCm)`.
- **Extended tracking — el superpoder:** en `imagelost` **NO ocultar el
  personaje.** El SLAM sostiene la pose mundial del ancla; el personaje se
  queda donde estaba aunque el marcador salga del cuadro. (En MindAR esto es
  imposible: sin marcador visible no hay nada.)

### Compilar image targets: el CLI

```bash
npx @8thwall/image-target-cli@latest
```

Es **interactivo** (ruta → tipo `1`=flat → crop `Y` → carpeta → nombre). Para
automatizar, alimentar por stdin:

```bash
printf 'imagen.png\n1\n\nsalida\nnombre\n' | npx --yes @8thwall/image-target-cli@latest
```

Produce un **JSON de metadatos + imagen de luminancia** (formato transparente:
el motor extrae features en runtime de la luminancia). Solo esos dos archivos
se sirven; el `imagePath` del JSON debe resolver a la URL de la luminancia. El
crop por defecto centra a proporción 3:4.

---

## 3. El personaje: video con alpha packing

**Por qué video y no modelo 3D:** el video ya trae actuación y habla
sincronizadas → cero rig, cero lip sync. **Por qué alpha packing y no alfa
nativo:** H.264 es el único codec universal; HEVC-con-alfa es sólo Safari y
VP9/WebM-con-alfa sólo Chrome. El frame lleva color en una mitad y máscara
en blanco y negro en la otra; un fragment shader lo recompone.
**Nunca chroma key en runtime** (bordes verdes, spill, se rompe en semitransparencias).

### Regla de oro: MEDIR el video, no asumirlo

Del MP4 real de este proyecto, TODO llegó distinto a lo planeado: layout
horizontal (no vertical), máscara a la izquierda (no derecha), polaridad
invertida (blanco = fondo). Se mide con canvas: samplear ambas mitades —
la máscara tiene saturación ~0; las 4 esquinas de la máscara son fondo;
la zona del personaje tiene más varianza de luminancia que el fondo plano.

### La trampa del fondo compuesto (lo que salva los bordes)

Si el lado del color viene compuesto sobre un **fondo sólido** (típico de
salida de IA o editor: aquí era azul `(39,108,181)`), los píxeles
semitransparentes del borde —pelo, alas— traen ese color mezclado (halo).

- **Contraer el alfa (mordida) NO sirve:** medido, sesgo de azul 62 → 58.
  Quita píxeles pero los que quedan siguen contaminados.
- **Lo que sí:** despejar la ecuación del composite (se puede porque el alfa
  exacto viene de la máscara — esto NO es chroma key):

```glsl
// c = (composite − fondo·(1−α)) / α   — medido: sesgo 62 → −8 (8× mejor)
vec3 c = clamp((color - uFondo * (1.0 - alfa)) / max(alfa, 0.04), 0.0, 1.0);
```

- Probar en **espacio codificado** y en luz lineal: aquí ganó codificado
  (−8 contra +14) — típico cuando el composite lo hizo un editor/IA.
- ⚠️ **El color del fondo CAMBIA con cada reencode del MP4** (aquí:
  32,104,183 → 39,108,181). Remedirlo siempre que cambie el archivo.

### Detalles de shader que importan en móvil

- `textura.colorSpace = THREE.LinearSRGBColorSpace` y decodificar sRGB **a
  mano en el shader, sólo para el color**: si Three decodifica todo, la curva
  de gamma también pasa por la máscara y los medios tonos del alfa salen mal.
- **Sin `discard`:** en GPU móviles (tile-based) desactiva el descarte
  temprano para todo el draw call. Mezclar un píxel transparente es más barato.
- La máscara es gris: basta leer un canal (`.r`).
- `transparent: true, depthWrite: false, toneMapped: false`.

### Presupuestos de video

- Bitrate ~1.5 Mbps H.264. Recortar el frame al bounding box del personaje
  (no pagar bitrate por aire). 40 s ≈ 7 MB.
- **Cloudflare rechaza archivos > 25 MB** — el reencode no es optimización,
  es requisito.
- Narración 35–45 s. Sesión total 3–4 min antes de que el teléfono caliente.

---

## 4. Puesta en escena

- **Origen en los pies:** `geometry.translate(0, 0.5, 0)` en un plano 1×1.
  El personaje queda DE PIE sobre el marcador y pivotea sobre su eje.
- **Sombra de contacto** (elipse suave con shader): sin ella el personaje
  flota como calcomanía. Entra en fade con el personaje.
- **Billboard sólo en Y** (2.5D asumido: siempre de frente, nunca acostado).
  Calcular pasando la cámara al espacio local del padre con `worldToLocal` —
  restar `parent.rotation.y` sólo funciona si el padre está alineado al mundo,
  y un ancla de AR nunca lo está.

### El bug del billboard que parece tracking roto

Con el impreso plano en la mesa, la cámara queda casi sobre el eje vertical
del personaje → `atan2(dx, dz)` con dx,dz≈0 es inestable. **Medido: ruido
sub-milimétrico en la pose producía 245° de giro.** Y girar un plano en Y se
ve como que se ensancha/angosta → se percibe como tracking pésimo aunque el
tracking esté bien. Arreglo (rango 245° → 0.2°):

```js
// Zona muerta: si la cámara está a <12° del eje vertical, congelar el
// último ángulo bueno en lugar de recalcular basura.
if (dist > 1e-6 && horiz / dist > Math.sin(degToRad(12))) { objetivo = Math.atan2(dx, dz); }
// Suavizado por el camino corto (cruzar +179°→−179° sin dar vuelta entera):
let delta = objetivo - actual;
delta = Math.atan2(Math.sin(delta), Math.cos(delta));
actual += delta * Math.min(1, dt * 6);
```

---

## 5. Rendimiento móvil (todo esto se midió como jank real)

- `antialias: false` — el MSAA suaviza bordes de GEOMETRÍA y aquí la única
  geometría es un rectángulo; los bordes del personaje salen del alfa.
- `pixelRatio` techo **1.5** — en DPR 3 recorta ~44% del trabajo de
  fragmentos; el límite de nitidez real es el MP4, no el canvas.
- **Nada de `mix-blend-mode`** a pantalla completa ni **`backdrop-filter`**
  sobre elementos que viven encima del video: se recalculan cada frame.
- Overlays ocultos con `visibility:hidden` además de `opacity:0` (un elemento
  en opacity 0 con backdrop-filter se sigue componiendo).

### Telemetría que separa las dos causas de "se traba"

Se arreglan AL REVÉS, así que adivinar sale caro:

- **RED** (bajar peso del MP4): eventos `waiting`/`stalled` + buffer corto;
  audio e imagen se cortan JUNTOS.
- **GPU** (bajar trabajo de render): `getVideoPlaybackQuality().droppedVideoFrames`
  y FPS bajo; la imagen brinca pero el audio sigue liso.

Y para el tracking, tres fallas que se sienten igual y se arreglan distinto:
tarda en enganchar (target chico/pobre) / engancha y se suelta (tolerancia,
marcador fuera de cuadro) / engancha y tiembla (suavizado). Contar: ms al
primer lock, enganches/pérdidas, tiempo pegado vs total.

---

## 6. Targets: la ciencia de qué trackea

### Lo contraintuitivo primero

- **Un QR es el PEOR target posible** para feature tracking: miles de
  esquinas idénticas de cuadritos idénticos → descriptores ambiguos. Lo mismo
  que lo hace legible para un lector lo hace ilegible para un tracker. El QR
  va DENTRO de la pieza como pasajero; el arte alrededor trackea.
- **El tracker ve en escala de grises:** contraste de VALOR (oscuros casi
  negros vs claros), no de matiz. Verde sobre verde = hoja en blanco (medido:
  fondo acuarela = 0–11 puntos útiles).
- **Motivos repetidos/espejeados = veneno:** descriptores gemelos.
- **El ruido fino engaña dos veces:** genera miles de puntos de interés
  (métrica de conteo: inútil) y cada mancha es única (métrica de unicidad:
  inútil). Lo que importa es la **repetibilidad**: degradar la imagen
  (blur 0.8–2.4px, contraste 85–45%, ruido, inclinación 2–10°) y contar sólo
  los puntos que reaparecen en su lugar geométrico. Validar la métrica con
  un control de zona vacía: debe dar ~0.

### La aritmética de la cámara (evita el error más caro)

```
ancho visible ≈ 1.15 × distancia          (FOV ~60°)
px/cm que resuelve = 1280 / ancho_visible ≈ 32 px/cm a 35 cm
```

- El impreso debe ocupar **≥30% del ancho del cuadro** a distancia de uso
  (regla rápida: target ≥ ⅓ de la distancia).
- **Compilar el target a la resolución de la cámara, no a la máxima:**
  `px_objetivo = cm_del_target × 32`. Compilado sobremuestreado (aquí:
  128 px/cm), el matcher trabaja en los niveles chicos de su pirámide con la
  mitad de los puntos. Corregirlo duplicó los puntos útiles (244 → 475) sin
  tocar el arte.
- **El personaje debe ser MÁS CHICO que el ancho del marcador** — si no,
  encuadrarlo saca el marcador del cuadro (fatal sin extended tracking).

### La inclinación es el asesino

Supervivencia de features medida: **100% a 2°, 70% a 4°, 18% a 7°, 4% a 10°.**
Un impreso acostado en mesa SIEMPRE se ve oblicuo → **tent card vertical** es
la mejora física #1. Mientras tanto: coaching en UI ("Ponlo más de frente")
cuando el ángulo entre la normal del papel y la línea de vista pasa de 40°.

### Reglas de arte para un target (brief al equipo de diseño)

Tent card A6 (10×14 cm) vertical · **acabado MATE** (el brillo borra features
justo donde pega la lámpara) · contraste de valor · detalle denso y parejo en
toda la superficie (cobertura >75% en rejilla 4×4) · asimetría total, cero
motivos repetidos · borde irregular con esquinas duras · QR de 2.5–3 cm con
**corrección de errores H** si lleva logo encima (módulos ≥0.7 mm).
Distancia máxima de escaneo de un QR ≈ 10× su lado.

Umbrales de aceptación (necesarios, no suficientes — la prueba final es
imprimir y medir): ≥30% del cuadro · ≥250 puntos repetibles · cobertura ≥75% ·
≥300 feature points del compilador a escala 1.
Herramientas listas en el repo: `herramientas/evaluar-marcador.py` (veredicto
automático) y `herramientas/BRIEF-marcador.md`.

---

## 7. MindAR (plan B) — sus trampas, por si se usa

- Gratis, MIT, pero **solo-visión**: sin giroscopio, sin extended tracking.
  Techo conocido: "buen punto de entrada, por debajo del estándar comercial".
- **Importmap debe mapear `three/addons/`** (importa CSS3DRenderer de ahí);
  sin eso el AR cae a fallback EN SILENCIO.
- **Pide la cámara sin resolución → muchos móviles dan 640×480.** Envolver
  `getUserMedia` durante el arranque para forzar `ideal: 1920×1080`
  (verificado en campo: pasó a 1080×1920).
- **El ancla entrega el marcador en plano XY con +Z saliendo del papel**
  (distinto a 8W): un personaje Y-up queda ACOSTADO. Grupo intermedio con
  `rotation.x = 90°`.
- Suavizado: los defaults (`filterMinCF 0.001 / filterBeta 1000`) privilegian
  respuesta; para un personaje en mesa conviene al revés (0.0001 / 50).
  `missTolerance` ~12 para que no parpadee.
- Compilar `.mind` en Node sin la dependencia nativa `canvas` (que en Windows
  exige Visual Studio): `npm install mind-ar --ignore-scripts` y subclasear
  `CompilerBase` con un canvas falso que entrega píxeles ya decodificados —
  el canvas sólo se usaba para pasar a gris. 7 s vs 25 del navegador.
  (Listo en `herramientas/compilar-en-node.mjs`.)
- Leer del compilado los puntos POR NIVEL de pirámide: importan las escalas
  chicas (≤0.25), no el total.

---

## 8. UX no negociable

- **El personaje habla tras un TAP del usuario, nunca solo.** La restricción
  de iOS es sobre autoplay, no reproducción: si arranca de un gesto, el audio
  embebido suena. Además el tap = dato de analítica (qué eligen).
- **Subtítulos siempre visibles** (restaurante = ruido) con cues en el JSON.
- **Fallback sin cámara obligatorio:** permiso negado o equipo viejo → el
  personaje cuenta la historia igual sobre un fondo ilustrado. No es un error,
  es la experiencia menos el AR. Mismo grupo de escena colgado de otro padre.
- Diseñar para "adulto sostiene, niño ve".
- Panel de diagnóstico tras `?debug=1`: **colapsado por defecto** (una línea:
  motor · estado · fps; expandible), con toggles en el dispositivo para las
  convenciones inciertas (orientación 0/90/−90, billboard on/off, extendido
  on/off). Probar convenciones de ejes en el teléfono con un botón vale más
  que adivinarlas en el escritorio.
- Al perder tracking a media historia, **no pausar el audio**: castigar el
  temblor de la mano del papá arruina la experiencia del niño.

---

## 9. Deploy y repo

- **Cloudflare Worker de assets estáticos** (no Pages; Cloudflare migra todo
  a Workers): `wrangler.jsonc` con `assets: { directory: "./public",
  not_found_handling: "none" }` (nunca "single-page-application": vuelve
  invisibles los 404) y `observability: enabled` (la analítica del prototipo
  es el argumento de la fase 2). Conectado al repo = deploy por push.
- **`public/` es lo ÚNICO servido.** README, playbooks, material fuente y
  herramientas viven FUERA.
- `_headers`: `X-Robots-Tag: noindex` global (robots.txt es cortesía, el
  header no) · assets inmutables `max-age=31536000` (versionar por nombre de
  archivo) · HTML/JSON en `no-cache`.
- `getUserMedia` exige HTTPS: no se puede probar pasando el HTML por WhatsApp.
  `localhost` sirve en escritorio; para teléfono, deploy o túnel.
- Git: masters pesados (PDF/PSD/MP4 fuente) en `.gitignore` **con patrones
  anclados a la raíz** (`/*.mp4` para no matar `public/assets/*.mp4`). GitHub
  rechaza >100 MB. Si un blob pesado se coló y se des-commiteó:
  `git reflog expire --expire=now --all && git gc --prune=now` (139 MB → 22).
- Token en push sin persistirlo:
  `git -c http.extraheader="AUTHORIZATION: Basic <b64(x-access-token:PAT)>" push`.
- Timeout 408 en push con binarios: `http.postBuffer 524288000` + `http.version HTTP/1.1`.

---

## 10. El método que produjo estos resultados

1. **Medir antes de asumir.** Layout del video, polaridad de la máscara, color
   del fondo, features del target, resolución real de la cámara: todo llegó
   distinto a lo esperado. El instrumento fue siempre un canvas + unas líneas
   de análisis.
2. **Desconfiar de la métrica hasta que el control dé ~0.** Contar puntos dio
   17,000 (ruido); unicidad dijo que el fondo vacío trackeaba como un dibujo
   (falso). La métrica buena distingue el vacío del arte.
3. **Una variable a la vez** — y cuando se rompe la regla (tres arreglos al
   mismo mecanismo en un deploy), decirlo explícitamente.
4. **Instrumentar para separar fallas que se sienten igual:** red vs GPU;
   no-engancha vs se-suelta vs tiembla; billboard vs tracking (un toggle que
   apaga el billboard responde en 5 segundos lo que días de opinión no).
5. **Separar riesgo técnico de riesgo creativo:** validar shader/tracking con
   assets sintéticos o provisionales; el asset final sólo reemplaza un archivo.
6. **Los parámetros medidos viven en el JSON de contenido, comentados con su
   porqué** — no enterrados en el código. Cambiar de asset no toca código.
7. **Clavar versiones exactas de dependencias de CDN.** Un QR impreso no puede
   depender de un `@1` flotante.
8. Leer el código minificado del vendor cuando la doc no existe: las dos
   trampas más caras de 8W (`loadChunk('slam')`, canvas 300×150) salieron
   de ahí.

---

## 11. Mapa del ecosistema 8th Wall OSS (para explotar en otros desarrollos)

Barrido completo del monorepo `github.com/8thwall/8thwall` (5,417 archivos,
ago 2026). El proyecto Pipo usó ~10% de lo que hay. El resto:

### El hallazgo estratégico: se puede compilar un motor 100% MIT

`packages/engine` documenta que **el código fuente del motor está en el repo**
(`reality/engine/`: tracking, imagedetection, features, pose, deepnets, depth,
faces, hittest, lighting, selfie-segmentation) bajo **MIT — sólo SLAM, VPS y
Hand Tracking siguen siendo propietarios** (por eso el binario). Y se compila:

```bash
bazel build --config=wasmreleasesimd //reality/app/xr/js:bundle
```

Consecuencia: si la revisión legal del binario limited-use se atora, **existe
un plan B totalmente MIT con image targets, face tracking y sky segmentation**
— perdiendo sólo el SLAM/extended tracking. Prometen releases oficiales del
motor abierto vía npm. Esto cambia el análisis de riesgo de proveedor: el
único componente no-libre es exactamente uno, y es reemplazable.

### Módulos del binario que Pipo NO usó (verificados en el API de xr.js)

| Módulo | Qué hace | Idea de explotación (Palace) |
|---|---|---|
| `MediaRecorder` | Graba MP4 de la experiencia AR en el dispositivo | El huésped graba su momento con el personaje y se lo lleva → compartir en redes = marketing orgánico. Probablemente EL feature de mayor ROI no explotado. |
| `CanvasScreenshot` | Foto del canvas AR | Souvenir instantáneo, foto con el personaje |
| `FaceController` (`loadChunk('face')` → xr-face.js) | Face tracking con puntos de anclaje | Filtros de cara temáticos para eventos, cenas, fiestas infantiles |
| `XrController.hitTest` | World tracking: colocar contenido en superficies SIN marcador | Previews de producto/espacios, personajes en cualquier mesa, tie-in con piezas físicas (Massivit) |
| Sky Effects (segmentación de cielo) | Reemplaza el cielo en vivo | Cielos mágicos/atardeceres imposibles en áreas abiertas del resort |
| `LayersController` | Segmentación semántica por capas | Oclusión: el personaje DETRÁS de objetos reales |
| `AFrame` / `Babylonjs` / `PlayCanvas` | Adaptadores oficiales | No estamos casados con Three.js |
| `Vps` | Posicionamiento visual Niantic | **Excluido** del binario — no contar con él |

### Los paquetes hermanos (todos MIT, todos en CDN/npm)

- **`@8thwall/ecs`** — el motor de juegos detrás de 8th Wall Studio: FLECS
  (estado) + Three.js (render) + **Jolt (física)**. Para experiencias
  interactivas de verdad — juegos, físicas, colisiones — no sólo "personaje
  que habla". CDN: `@8thwall/ecs@3/dist/runtime.js`.
- **8th Wall Desktop** (Electron, Win/Mac, en 8thwall.org/downloads) — editor
  3D + Studio. Dato para equipos con pipeline Blender: **live-reload desde
  Blender** — guardas el .blend y el viewport de Studio se actualiza solo.
- **`@8thwall/xrextras`** — módulos para necesidades comunes: pantallas de
  carga, manejo de errores. CDN: `@8thwall/xrextras@1`. Evaluar antes de
  escribir UI de carga propia.
- **`landing-page`** — fallback para escritorio/no soportados (muestra un QR
  para abrir en móvil). Resuelve el "¿y si lo abren en laptop?".
- **`coaching-overlay`** — prompts de guía (Absolute Scale, Sky Effects).
- **`image-target-cli`** (§2) y **`dev8`** (dev server de Studio).

### Dónde buscar cuando falte algo

- **Ejemplos oficiales** (repos aparte): `studio-image-targets-example`,
  `studio-face-effects-example`, `studio-world-effects-example`,
  `aframe-*-example`, `threejs-world-effects-example`.
- **`github.com/8thwall/web`** — la colección de ejemplos de la era hosteada
  (necesitan migración al formato nuevo, pero es el mayor acervo de patrones).
- **`github.com/8thwall/archive`** — código aún no absorbido al monorepo.
- **Soporte:** Discord (8th.io/discord) y GitHub Discussions. Sin SLA — es
  comunidad, no contrato.
