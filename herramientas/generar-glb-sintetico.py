# GLB sintético multi-pieza con extras poblados (HANDOFF §12, F0 / Playbook §10.5:
# separar riesgo técnico de riesgo creativo — el asset real sólo reemplaza el archivo).
#
# Genera una señalización direccional de 2.1 m con 6 piezas en 3 capas,
# extras de escena y de objeto según el contrato §6, en metros y Y-up.
#
#   & "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" -b --factory-startup `
#     -P herramientas/generar-glb-sintetico.py -- public/models/SIG-DEMO-01.glb
import bpy, sys

out = sys.argv[sys.argv.index("--") + 1]

bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
sc.unit_settings.system = 'METRIC'
sc.unit_settings.scale_length = 1.0

# ── Metadata de escena (contrato §6) ─────────────────────────────────
sc["palace_schema"] = 1
sc["pieza_id"] = "SIG-DEMO-01"
sc["pieza_nombre"] = "Señalización direccional demo"
sc["proyecto"] = "JARVIS — GLB sintético F0"
sc["unidad"] = "m"
sc["y_up"] = True
sc["anclaje"] = "base_centro"
sc["bbox_cm"] = [60, 210, 12]
sc["revision"] = "R0"
sc["fecha"] = "2026-08-05"
sc["autor"] = "generar-glb-sintetico.py"


def pieza(nombre, tipo, dims, pos, extras, color):
    """Crea una caja/cilindro en METROS (Blender es Z-up; el exportador convierte a Y-up)."""
    if tipo == 'cilindro':
        bpy.ops.mesh.primitive_cylinder_add(radius=dims[0], depth=dims[2], location=pos, vertices=24)
    else:
        bpy.ops.mesh.primitive_cube_add(size=1, location=pos)
        bpy.context.active_object.scale = (dims[0], dims[1], dims[2])
        bpy.ops.object.transform_apply(scale=True)
    ob = bpy.context.active_object
    ob.name = nombre
    mat = bpy.data.materials.new(nombre)
    mat.use_nodes = True
    mat.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (*color, 1)
    ob.data.materials.append(mat)
    for k, v in extras.items():
        ob[k] = v
    return ob


ACERO = (0.62, 0.63, 0.65)
BRONCE = (0.72, 0.56, 0.41)
OCEANO = (0.145, 0.30, 0.43)

# Placa base al piso, poste, dos placas direccionales, tapa y "tornillería"
# fusionada en una sola pieza con cantidad en la ficha (presupuesto de draw calls).
pieza("placa_base", 'caja', (0.35, 0.35, 0.012), (0, 0, 0.006), {
    "pieza_id": "01-PLACA-BASE", "pieza_nombre": "Placa base", "capa": "Estructura",
    "material": "Acero inox 304, cal. 6 mm", "proceso": "Corte láser",
    "acabado": "Cepillado", "cantidad": 1, "orden_ensamble": 1,
    "nota_taller": "Anclar a piso con taquete expansivo 3/8\"",
}, ACERO)

pieza("poste", 'cilindro', (0.038, 0.038, 2.0), (0, 0, 1.012), {
    "pieza_id": "02-POSTE", "pieza_nombre": "Poste principal", "capa": "Estructura",
    "material": "Tubo acero inox 3\" ced. 40", "proceso": "Corte + soldadura TIG",
    "acabado": "Cepillado", "cantidad": 1, "orden_ensamble": 2,
    "nota_taller": "Soldar a placa base antes de acabado",
}, ACERO)

pieza("placa_direccional_a", 'caja', (0.60, 0.018, 0.15), (0.19, 0, 1.75), {
    "pieza_id": "03-PLACA-DIR-A", "pieza_nombre": "Placa direccional A", "capa": "Placas",
    "material": "Aluminio 6061, cal. 4 mm", "proceso": "Corte CNC + doblez",
    "acabado": "Pintura electrostática RAL 7016 mate", "cantidad": 1, "orden_ensamble": 4,
    "explode_vector": [1.0, 0.0, 0.0], "explode_dist_cm": 30,
    "nota_taller": "Vinil de corte se aplica después de pintura",
}, OCEANO)

pieza("placa_direccional_b", 'caja', (0.50, 0.018, 0.13), (-0.16, 0, 1.52), {
    "pieza_id": "04-PLACA-DIR-B", "pieza_nombre": "Placa direccional B", "capa": "Placas",
    "material": "Aluminio 6061, cal. 4 mm", "proceso": "Corte CNC + doblez",
    "acabado": "Pintura electrostática RAL 7016 mate", "cantidad": 1, "orden_ensamble": 5,
    "explode_vector": [-1.0, 0.0, 0.0], "explode_dist_cm": 30,
}, OCEANO)

pieza("tapa_poste", 'cilindro', (0.042, 0.042, 0.02), (0, 0, 2.022), {
    "pieza_id": "05-TAPA", "pieza_nombre": "Tapa de poste", "capa": "Placas",
    "material": "Aluminio torneado", "proceso": "Torno",
    "acabado": "Anodizado bronce", "cantidad": 1, "orden_ensamble": 6,
    "explode_vector": [0.0, 0.0, 1.0], "explode_dist_cm": 15,
}, BRONCE)

# Herrajes: una sola malla, cantidad en la ficha — la regla anti-explosión
# de draw calls: lo no-interactivo se fusiona.
h1 = pieza("herraje_1", 'caja', (0.05, 0.05, 0.05), (0.05, 0, 1.75), {}, BRONCE)
h2 = pieza("herraje_2", 'caja', (0.05, 0.05, 0.05), (-0.05, 0, 1.52), {}, BRONCE)
bpy.ops.object.select_all(action='DESELECT')
h1.select_set(True); h2.select_set(True)
bpy.context.view_layer.objects.active = h1
bpy.ops.object.join()
herrajes = bpy.context.active_object
herrajes.name = "herrajes"
for k, v in {
    "pieza_id": "06-HERRAJES", "pieza_nombre": "Herrajes de sujeción", "capa": "Herrajes",
    "material": "Abrazadera inox + tornillería M6", "proceso": "Comercial",
    "acabado": "Natural", "cantidad": 8, "orden_ensamble": 3,
    "nota_taller": "Par de apriete 9 N·m",
}.items():
    herrajes[k] = v

bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_extras=True)
print(f"OK -> {out}")
