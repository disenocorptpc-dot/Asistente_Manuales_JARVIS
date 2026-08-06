# JARVIS — Visor 3D AR de piezas de producción

Web app AR para previsualizar piezas de diseño industrial (señalización,
mobiliario expositor, esculturas Massivit) sobre el mundo real, a escala 1:1,
con despiece y metadata de producción.
**Coordinación de Diseño Industrial y 3D — The Palace Company.**

## Documentos rectores

1. [HANDOFF-Visor3D-AR.md](HANDOFF-Visor3D-AR.md) — el brief: qué se construye, decisiones cerradas, fases.
2. [PLAYBOOK-WebAR.md](PLAYBOOK-WebAR.md) — destilado empírico de Pipo/Wonderwoods. **Leerlo primero.**
3. [VERIFICACIONES.md](VERIFICACIONES.md) — las 7 verificaciones de §11 con evidencia del binario.
   ⚠️ Incluye una **corrección al handoff**: `scaledWidth` es proporción de aspecto;
   los metros viven en `detail.scale`.

## Correr en local

```bash
python -m http.server 8317 --directory public
```

Abrir `http://localhost:8317/?modo=desktop&debug=1` (el AR requiere HTTPS y
teléfono real — el escritorio no valida tracking, sólo el core).

Parámetros de URL: `?pieza=<pieza_id>` · `?modo=desktop` fuerza el fallback ·
`?debug=1` panel de diagnóstico.

## Estructura

```
public/                  ← lo ÚNICO que se sirve
  index.html             ← entry único, importmap, sin build step
  contenido.json         ← parámetros medidos, con su porqué
  app/
    boot.js              ← arranque: precarga paralela, selección de shell
    ar-shell.js          ← XR8: permisos, canvas, pipeline (único lugar con XR8 junto a anchor-*)
    anchor-marker.js     ← modo A: marcador → pose + escala 1:1 + identidad
    anchor-hittest.js    ← modo B: superficie sin marcador (tabletop)
    desktop-shell.js     ← fallback orbital sin cámara
    core/                ← CERO imports de XR8, CERO DOM
    ui/                  ← HUD paleta Palace (F0 funcional; look completo = F3)
    debug.js             ← ?debug=1
  models/  image-targets/
herramientas/            ← FUERA de public: generador GLB, validador de marcadores
wrangler.jsonc           ← Cloudflare Worker de assets estáticos
```

## Estado de fases (HANDOFF §12)

- **F0 ✅** — verificaciones §11 + shell AR + GLB sintético multi-pieza + core
  (carga, escala, explotado, capas, picking, fichas) verificado en desktop.
- **F1 ⏳** — arte del marcador + compilar target + probar escala 1:1 en teléfono.
- F2 — addon de Blender (el linter). F3 — HUD completo. F4 — captura + deep link.

## Deploy

Cloudflare Worker con static assets (`wrangler deploy`). El AR exige HTTPS:
para teléfono, deploy o túnel — no se prueba pasando el HTML por WhatsApp.
