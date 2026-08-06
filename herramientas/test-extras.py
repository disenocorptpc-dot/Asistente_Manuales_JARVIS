# Verificación §11.6: ¿los extras de ESCENA sobreviven al exportador glTF de Blender?
# Se corre headless: blender -b --factory-startup -P test_extras.py -- salida.glb
import bpy, json, struct, sys

out = sys.argv[sys.argv.index("--") + 1]

bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene

# Custom properties a nivel escena (candidato A del handoff §6)
sc["palace_schema"] = 1
sc["pieza_id"] = "TEST-01"
sc["unidad"] = "m"

# Empty __PALACE_META__ (candidato B, fallback)
empty = bpy.data.objects.new("__PALACE_META__", None)
bpy.context.collection.objects.link(empty)
empty["palace_schema"] = 1
empty["pieza_id"] = "TEST-01-EMPTY"

# Objetos con custom properties (camino documentado: extras por objeto)
for i in range(2):
    bpy.ops.mesh.primitive_cube_add(location=(i * 3, 0, 0))
    ob = bpy.context.active_object
    ob.name = f"pieza_{i}"
    ob["pieza_nombre"] = f"Pieza {i}"
    ob["capa"] = "Estructura"
    ob["cantidad"] = 2
    ob["explode_vector"] = [0.0, 0.0, 1.0]

bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_extras=True)

# Leer de vuelta el GLB y reportar qué sobrevivió
with open(out, "rb") as f:
    data = f.read()
json_len = struct.unpack_from("<I", data, 12)[0]
g = json.loads(data[20:20 + json_len])

print("=== RESULTADO ===")
print("SCENE extras:", json.dumps(g["scenes"][0].get("extras")))
for n in g.get("nodes", []):
    print(f"NODE {n.get('name')}: extras={json.dumps(n.get('extras'))}")
