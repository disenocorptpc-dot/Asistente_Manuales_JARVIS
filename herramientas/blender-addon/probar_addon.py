# Prueba headless del addon: escena sintética → linter → export → disección
# del GLB. No asume nada: lee el binario resultante.
#
#   & "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" -b --factory-startup `
#     -P herramientas/blender-addon/probar_addon.py
import importlib.util
import json
import struct
import sys
import tempfile
from pathlib import Path

import bpy

AQUI = Path(__file__).parent
FALLAS = []


def check(nombre, cond, detalle=""):
    print(("  OK   " if cond else "  FALLA") + f" {nombre}" + (f" — {detalle}" if detalle and not cond else ""))
    if not cond:
        FALLAS.append(nombre)


def leer_glb(ruta):
    """Devuelve el chunk JSON del GLB, leído del binario — no de re-import."""
    datos = Path(ruta).read_bytes()
    magia, version, _largo = struct.unpack_from("<III", datos, 0)
    assert magia == 0x46546C67 and version == 2, "no es GLB v2"
    largo_json, tipo = struct.unpack_from("<II", datos, 12)
    assert tipo == 0x4E4F534A, "el primer chunk no es JSON"
    return json.loads(datos[20:20 + largo_json])


# ── registrar el addon desde el archivo ─────────────────────────────
spec = importlib.util.spec_from_file_location("jarvis_glb", AQUI / "jarvis_glb.py")
mod = importlib.util.module_from_spec(spec)
sys.modules["jarvis_glb"] = mod
spec.loader.exec_module(mod)
mod.register()

# ── escena sintética ────────────────────────────────────────────────
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
sc.unit_settings.system = "METRIC"
sc.unit_settings.scale_length = 1.0

em = sc.jarvis_meta
em.pieza_id = "TEST-ADDON-01"
em.pieza_nombre = "Prueba del addon"
em.proyecto = "JARVIS F2"
em.revision = "R1"
em.autor = "probar_addon.py"


def caja(nombre, pos, **meta):
    bpy.ops.mesh.primitive_cube_add(size=0.3, location=pos)
    o = bpy.context.active_object
    o.name = nombre
    m = o.jarvis_meta
    for k, v in meta.items():
        setattr(m, k, v)
    return o


caja("base", (0, 0, 0), pieza_id="01-BASE", pieza_nombre="Base", capa="Estructura",
     material="Acero", proceso="Corte láser", cantidad=1)
caja("placa", (0, 0, 0.4), pieza_id="02-PLACA", pieza_nombre="Placa", capa="Placas",
     material="Aluminio", proceso="CNC", usar_explode=True,
     explode_vector=(1.0, 0.0, 0.0), explode_dist_cm=20.0)
caja("tapa", (0, 0, 0.8), pieza_id="03-TAPA", pieza_nombre="Tapa", capa="Placas",
     material="Aluminio", proceso="Torno", cantidad=4, orden_ensamble=3)
helper = caja("guia_referencia", (2, 2, 0))
helper.jarvis_meta.incluir = False

salida = Path(tempfile.gettempdir()) / "TEST-ADDON-01-R1.glb"
salida.unlink(missing_ok=True)

print("\n== 1. el linter BLOQUEA ==")


def exporta_bloqueado():
    """En -b, un report({'ERROR'}) del operador llega como RuntimeError;
    en UI sería un CANCELLED con mensaje. Ambos cuentan como bloqueado."""
    try:
        r = bpy.ops.export_scene.jarvis_glb(filepath=str(salida), comprimir=True)
        return r == {"CANCELLED"} and not salida.exists()
    except RuntimeError as e:
        return "Linter" in str(e) and not salida.exists()


# unidades mal
sc.unit_settings.scale_length = 2.0
check("unit scale 2.0 bloquea", exporta_bloqueado())
sc.unit_settings.scale_length = 1.0

# pieza sin capa
placa = bpy.data.objects["placa"]
capa_previa = placa.jarvis_meta.capa
placa.jarvis_meta.capa = ""
check("pieza sin capa bloquea", exporta_bloqueado())
placa.jarvis_meta.capa = capa_previa

# pieza_id duplicado
tapa = bpy.data.objects["tapa"]
id_previo = tapa.jarvis_meta.pieza_id
tapa.jarvis_meta.pieza_id = "01-BASE"
check("pieza_id duplicado bloquea", exporta_bloqueado())
tapa.jarvis_meta.pieza_id = id_previo

print("\n== 2. export limpio con Draco ==")
r = bpy.ops.export_scene.jarvis_glb(filepath=str(salida), comprimir=True)
check("export FINISHED", r == {"FINISHED"} and salida.exists())

g = leer_glb(salida)
ext_esc = g.get("scenes", [{}])[0].get("extras", {})
check("palace_schema en escena", ext_esc.get("palace_schema") == 1)
check("unidad m", ext_esc.get("unidad") == "m")
check("pieza_id de escena", ext_esc.get("pieza_id") == "TEST-ADDON-01")
check("revision y fecha", ext_esc.get("revision") == "R1" and "fecha" in ext_esc)
check("bbox_cm presente", isinstance(ext_esc.get("bbox_cm"), list) and len(ext_esc["bbox_cm"]) == 3)

nodos = {n.get("name"): n.get("extras", {}) for n in g.get("nodes", [])}
check("3 piezas y CERO helpers", "guia_referencia" not in nodos and
      all(n in nodos for n in ("base", "placa", "tapa")),
      f"nodos: {sorted(nodos)}")
check("pieza_id por objeto", nodos.get("base", {}).get("pieza_id") == "01-BASE")
check("capa por objeto", nodos.get("tapa", {}).get("capa") == "Placas")
check("cantidad viaja", nodos.get("tapa", {}).get("cantidad") == 4)
check("orden_ensamble solo si >0", nodos.get("tapa", {}).get("orden_ensamble") == 3
      and "orden_ensamble" not in nodos.get("base", {}))
ev = nodos.get("placa", {}).get("explode_vector")
check("explode_vector sobrevive como array", isinstance(ev, list) and len(ev) == 3 and ev[0] == 1.0, f"= {ev}")
check("explode_dist_cm", nodos.get("placa", {}).get("explode_dist_cm") == 20.0)
check("sin override no hay explode_vector", "explode_vector" not in nodos.get("base", {}))

exts = set(g.get("extensionsRequired", []) + g.get("extensionsUsed", []))
check("Draco activo", "KHR_draco_mesh_compression" in exts, f"extensiones: {exts}")

print("\n== 3. el contrato sale LIMPIO y el .blend queda como estaba ==")
check("sin jarvis_meta duplicado en escena", "jarvis_meta" not in ext_esc)
check("sin jarvis_meta duplicado en nodos",
      all("jarvis_meta" not in x for x in nodos.values()))
check("escena sin residuos", "palace_schema" not in sc.keys() and "pieza_id" not in sc.keys())
check("objetos sin residuos", "pieza_id" not in bpy.data.objects["base"].keys())
check("los paneles conservan sus datos tras exportar",
      bpy.data.objects["placa"].jarvis_meta.explode_dist_cm == 20.0
      and bpy.data.objects["tapa"].jarvis_meta.cantidad == 4
      and sc.jarvis_meta.pieza_id == "TEST-ADDON-01")

print("\n== 4. export sin comprimir también funciona ==")
salida2 = Path(tempfile.gettempdir()) / "TEST-ADDON-01-R1-plano.glb"
salida2.unlink(missing_ok=True)
r = bpy.ops.export_scene.jarvis_glb(filepath=str(salida2), comprimir=False)
g2 = leer_glb(salida2)
exts2 = set(g2.get("extensionsRequired", []) + g2.get("extensionsUsed", []))
check("sin Draco cuando se apaga", "KHR_draco_mesh_compression" not in exts2)

print("\n== 5. prellenar desde nombres ==")
bpy.ops.mesh.primitive_cube_add(size=0.2, location=(3, 0, 0))
nuevo = bpy.context.active_object
nuevo.name = "Perfil_Aluminio.001"
bpy.ops.object.select_all(action="DESELECT")
nuevo.select_set(True)
r = bpy.ops.scene.jarvis_prellenar()
m = nuevo.jarvis_meta
check("prellenar FINISHED", r == {"FINISHED"})
check("id generado válido", bool(mod.ID_RE.match(m.pieza_id)), f'= "{m.pieza_id}"')
check("nombre legible", m.pieza_nombre == "Perfil Aluminio 001", f'= "{m.pieza_nombre}"')
check("capa con fallback General", m.capa == "General", f'= "{m.capa}"')
# lo capturado a mano NO se pisa
m.capa = "Iluminación"
bpy.ops.scene.jarvis_prellenar()
check("no pisa lo capturado", m.capa == "Iluminación")

print("\n== 6. objetos en colección excluida no truenan el export ==")
col = bpy.data.collections.new("Oculta")
sc.collection.children.link(col)
bpy.ops.mesh.primitive_cube_add(size=0.1, location=(5, 0, 0))
fantasma = bpy.context.active_object
fantasma.name = "fantasma_excluido"
for c in list(fantasma.users_collection):
    c.objects.unlink(fantasma)
col.objects.link(fantasma)
bpy.context.view_layer.layer_collection.children["Oculta"].exclude = True

r = mod.lint(bpy.context, con_geometria=False)
check("el linter avisa del fantasma", any("fantasma_excluido" in a for a in r["avisos"]),
      f"avisos: {r['avisos']}")
salida3 = Path(tempfile.gettempdir()) / "TEST-ADDON-01-R1-fantasma.glb"
salida3.unlink(missing_ok=True)
r = bpy.ops.export_scene.jarvis_glb(filepath=str(salida3), comprimir=False)
g3 = leer_glb(salida3)
nombres3 = {n.get("name") for n in g3.get("nodes", [])}
check("export NO truena con el fantasma", r == {"FINISHED"})
check("el fantasma no viaja", "fantasma_excluido" not in nombres3)

print(f"\nGLB de prueba: {salida}  ({salida.stat().st_size} bytes)")
if FALLAS:
    print(f"\n{len(FALLAS)} FALLAS: {FALLAS}")
    sys.exit(1)
print("\nTODO OK")
