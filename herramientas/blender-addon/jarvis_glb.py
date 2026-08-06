# SPDX-License-Identifier: MIT
"""JARVIS — export GLB con contrato de datos (F2, HANDOFF §6).

El GLB se describe a sí mismo: pieza_id, capa, material, proceso, explotado…
viajan como custom properties → extras de glTF (export_extras=True), y el
visor los lee de userData sin código por proyecto. Verificado en
VERIFICACIONES §6: extras de escena Y de objeto sobreviven al exportador de
Blender 5.2, incluyendo arrays.

El addon hace DOS trabajos (HANDOFF §6):
1. Escribe la metadata — paneles en Objeto y Escena, claves INDIVIDUALES
   (no un JSON-blob): el loader del visor lee userData.pieza_id directo.
2. Es el LINTER del pipeline, y BLOQUEA el export con reporte claro:
   unidades no métricas, piezas sin pieza_id/pieza_nombre/capa, ids
   duplicados o con caracteres que rompen URLs, presupuesto de triángulos
   (§10) y texturas >2048 px. Un GLB que exporta, carga bien en el visor.

Herencia: la arquitectura (PropertyGroups, estampar/restaurar con limpieza
en finally, materiales realmente en uso) se recicló de glb_manuales_addon
(Asistente de Manuales 2.0). El contrato es OTRO — aquél empaca mn_meta como
JSON-blob y su app rellena huecos con IA; el visor JARVIS no adivina nada,
por eso aquí el linter veta en vez de avisar.

Instalación: Edit > Preferences > Add-ons > Install… > este archivo.
Uso: File > Export > GLB JARVIS (.glb). El botón «publicar» corre
herramientas/publicar-modelo.py (configura la ruta del repo en las
preferencias del addon).
"""

import datetime
import json
import re
import subprocess
import sys
from pathlib import Path

import bpy
from bpy.props import (
    BoolProperty,
    EnumProperty,
    FloatProperty,
    FloatVectorProperty,
    IntProperty,
    PointerProperty,
    StringProperty,
)
from bpy.types import AddonPreferences, Operator, Panel, PropertyGroup
from bpy_extras.io_utils import ExportHelper
from mathutils import Vector

bl_info = {
    "name": "JARVIS — GLB con contrato (Palace)",
    "author": "Coordinación de Diseño Industrial y 3D — The Palace Company",
    "version": (1, 1, 0),
    "blender": (4, 2, 0),
    "location": "Propiedades > Objeto / Escena · File > Export > GLB JARVIS",
    "description": "Metadata de producción + linter que bloquea + export GLB "
                   "Draco para el visor 3D AR.",
    "category": "Import-Export",
}

SCHEMA = 1
ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$")

# Presupuestos (HANDOFF §10) — criterios de aceptación, no sugerencias.
TRIS_PRESUPUESTO = 300_000
TRIS_TECHO = 500_000
DRAW_CALLS_MAX = 80
MATERIALES_MAX = 15
TEXTURA_MAX_PX = 2048


# ───────── Datos ─────────

class JV_PiezaMeta(PropertyGroup):
    """La ficha de producción de una pieza — lo que el taller toca en el visor."""

    incluir: BoolProperty(
        name="Es pieza del manual",
        description="Apágalo en helpers: curvas de referencia, luces de "
                    "estudio, sobras de imports. No se exportan",
        default=True,
    )
    pieza_id: StringProperty(
        name="ID",
        description="Único dentro del ensamble, sin espacios: 01-PLACA-FRONTAL",
        default="",
    )
    pieza_nombre: StringProperty(name="Nombre", default="")
    capa: StringProperty(
        name="Capa",
        description="Grupo de visibilidad en el visor: Estructura, Placas, "
                    "Herrajes… El linter no deja exportar sin capa",
        default="",
    )
    material: StringProperty(
        name="Material",
        description="Acero inox 304 cal. 3 mm, aluminio 6061…",
        default="",
    )
    proceso: StringProperty(
        name="Proceso",
        description="Corte láser + doblez, CNC, torno, soldadura TIG…",
        default="",
    )
    acabado: StringProperty(
        name="Acabado",
        description="Pintura electrostática RAL 7016 mate, anodizado…",
        default="",
    )
    cantidad: IntProperty(
        name="Cantidad",
        description="Piezas iguales que se fabrican (la regla anti-explosión "
                    "de draw calls: tornillería fusionada con cantidad aquí)",
        default=1, min=1,
    )
    orden_ensamble: IntProperty(
        name="Orden de ensamble",
        description="0 = no declarado",
        default=0, min=0,
    )
    nota_taller: StringProperty(name="Nota de taller", default="")

    usar_explode: BoolProperty(
        name="Override de explotado",
        description="Sin esto el visor calcula el despiece procedural "
                    "(radial desde el centro). Enciéndelo exactamente donde "
                    "el radial se ve mal",
        default=False,
    )
    explode_vector: FloatVectorProperty(
        name="Dirección",
        description="En el espacio del modelo, Z-up de Blender (el exportador "
                    "convierte a Y-up del visor)",
        size=3, default=(0.0, 0.0, 1.0), subtype="XYZ",
    )
    explode_dist_cm: FloatProperty(
        name="Distancia (cm)",
        default=12.0, min=0.0, soft_max=100.0,
    )


class JV_EscenaMeta(PropertyGroup):
    """Identidad del ensamble. Se llena una vez y vive en el .blend."""

    pieza_id: StringProperty(
        name="ID del ensamble",
        description="SIG-LOBBY-VILLA-01 — es también el deep link ?pieza= "
                    "y la base del nombre de archivo",
        default="",
    )
    pieza_nombre: StringProperty(name="Nombre", default="")
    proyecto: StringProperty(name="Proyecto", default="")
    anclaje: EnumProperty(
        name="Anclaje",
        description="Dónde queda el pivote al cargar en el visor",
        items=[
            ("base_centro", "Base centro",
             "Se asienta sobre el plano del marcador (default)"),
            ("centro_geometrico", "Centro geométrico",
             "Para piezas colgantes"),
            ("punto_named", "Punto nombrado",
             "Un Empty marca el anclaje — casos raros (señal en voladizo)"),
        ],
        default="base_centro",
    )
    anclaje_punto: StringProperty(
        name="Empty de anclaje",
        description="Nombre del Empty cuando el anclaje es punto nombrado",
        default="__ANCLA__",
    )
    revision: StringProperty(
        name="Revisión",
        description="R1, R2… — viaja en los extras y versiona el archivo",
        default="R1",
    )
    autor: StringProperty(name="Autor", default="")


# ───────── Selección de qué exporta ─────────

TIPOS_GEOMETRIA = {"MESH", "CURVE", "SURFACE", "FONT", "META"}


def piezas_de(context):
    return [o for o in context.scene.objects
            if o.type in TIPOS_GEOMETRIA and o.jarvis_meta.incluir]


def materiales_en_uso(objetos):
    """Sólo los asignados a lo que se exporta: un .blend de trabajo arrastra
    materiales huérfanos que no salen en el GLB — avisar de ellos es ruido."""
    vistos = {}
    for obj in objetos:
        for slot in getattr(obj, "material_slots", []):
            if slot.material is not None:
                vistos.setdefault(slot.material.name, slot.material)
    return list(vistos.values())


# ───────── El linter ─────────

def contar_triangulos(context, objetos):
    """Triángulos REALES: geometría evaluada con modificadores aplicados
    (un subsurf duplica por 4 y el conteo del panel mentiría). Es lo caro
    del linter — se corre al exportar y con el botón Revisar, no en cada
    repintado del panel."""
    dg = context.evaluated_depsgraph_get()
    conteos = []
    for o in objetos:
        try:
            ev = o.evaluated_get(dg)
            malla = ev.to_mesh()
            malla.calc_loop_triangles()
            conteos.append((o.name, len(malla.loop_triangles)))
            ev.to_mesh_clear()
        except RuntimeError:
            conteos.append((o.name, 0))
    return conteos


def lint(context, con_geometria=True):
    """Devuelve {errores, avisos, stats}. Los ERRORES bloquean el export."""
    sc = context.scene
    em = sc.jarvis_meta
    errores, avisos = [], []
    piezas = piezas_de(context)
    mats = materiales_en_uso(piezas)

    # Unidades: si esto está mal, el 1:1 del visor miente. Fatal.
    u = sc.unit_settings
    if u.system != "METRIC" or abs(u.scale_length - 1.0) > 1e-6:
        errores.append(f"Unidades: sistema {u.system}, unit scale "
                       f"{u.scale_length:g} — el contrato exige métrico 1.0")

    # Identidad del ensamble
    if not ID_RE.match(em.pieza_id.strip()):
        errores.append(f'ID del ensamble inválido: "{em.pieza_id}" '
                       "(letras/números/._-, sin espacios — es URL)")
    if not em.pieza_nombre.strip():
        errores.append("El ensamble no tiene nombre (panel de Escena)")
    if not re.match(r"^R[0-9]{1,3}$", em.revision.strip()):
        errores.append(f'Revisión inválida: "{em.revision}" (R1, R2…)')

    # Piezas
    if not piezas:
        errores.append("No hay ninguna pieza marcada para exportar")
    ids = {}
    for o in piezas:
        m = o.jarvis_meta
        pid = m.pieza_id.strip()
        if not ID_RE.match(pid):
            errores.append(f'{o.name}: pieza_id inválido o vacío ("{pid}")')
        elif pid in ids:
            errores.append(f"pieza_id duplicado: {pid} ({ids[pid]} y {o.name})")
        else:
            ids[pid] = o.name
        if not m.pieza_nombre.strip():
            errores.append(f"{o.name}: sin nombre de pieza")
        if not m.capa.strip():
            errores.append(f"{o.name}: sin capa — el visor agrupa por capa")
        if not m.material.strip() or not m.proceso.strip():
            avisos.append(f"{o.name}: ficha pobre (falta material o proceso)")

    # Anclaje por punto: el Empty tiene que existir, y viajar en el GLB.
    if em.anclaje == "punto_named" and not bpy.data.objects.get(em.anclaje_punto.strip()):
        errores.append(f'Anclaje punto nombrado: no existe el Empty '
                       f'"{em.anclaje_punto}"')

    # Texturas: el techo es del presupuesto de red (§10). Bloquea.
    for mat in mats:
        if not mat.use_nodes:
            continue
        for nodo in mat.node_tree.nodes:
            if nodo.type == "TEX_IMAGE" and nodo.image is not None:
                w, h = nodo.image.size
                if max(w, h) > TEXTURA_MAX_PX:
                    errores.append(f"{mat.name}: textura {nodo.image.name} "
                                   f"de {w}×{h} px (techo {TEXTURA_MAX_PX})")

    # Presupuestos de malla
    draw_calls = sum(max(1, len([s for s in o.material_slots if s.material]))
                     for o in piezas)
    if len(mats) > MATERIALES_MAX:
        avisos.append(f"{len(mats)} materiales únicos (presupuesto {MATERIALES_MAX})")
    if draw_calls > DRAW_CALLS_MAX:
        avisos.append(f"~{draw_calls} draw calls (presupuesto {DRAW_CALLS_MAX}) — "
                      "¿tornillería sin fusionar?")

    tris_total = None
    if con_geometria and piezas:
        conteos = contar_triangulos(context, piezas)
        tris_total = sum(n for _, n in conteos)
        if tris_total > TRIS_TECHO:
            peores = sorted(conteos, key=lambda c: -c[1])[:3]
            errores.append(f"{tris_total:,} triángulos — techo duro "
                           f"{TRIS_TECHO:,}. Los gordos: " +
                           ", ".join(f"{n} ({t:,})" for n, t in peores) +
                           ". Decimado + meshopt no es opcional (§10)")
        elif tris_total > TRIS_PRESUPUESTO:
            peores = sorted(conteos, key=lambda c: -c[1])[:3]
            avisos.append(f"{tris_total:,} triángulos (presupuesto "
                          f"{TRIS_PRESUPUESTO:,}). Los gordos: " +
                          ", ".join(f"{n} ({t:,})" for n, t in peores))

    return {
        "errores": errores,
        "avisos": avisos,
        "stats": {
            "piezas": len(piezas),
            "materiales": len(mats),
            "draw_calls": draw_calls,
            "tris": tris_total,
        },
    }


# ───────── Paneles ─────────

class JV_PT_objeto(Panel):
    bl_label = "JARVIS — pieza"
    bl_idname = "OBJECT_PT_jarvis"
    bl_space_type = "PROPERTIES"
    bl_region_type = "WINDOW"
    bl_context = "object"

    @classmethod
    def poll(cls, context):
        return context.object is not None and context.object.type in TIPOS_GEOMETRIA

    def draw(self, context):
        m = context.object.jarvis_meta
        col = self.layout.column()
        col.use_property_split = True
        col.prop(m, "incluir")
        sub = col.column()
        sub.enabled = m.incluir
        sub.prop(m, "pieza_id")
        sub.prop(m, "pieza_nombre")
        sub.prop(m, "capa")
        sub.separator()
        sub.prop(m, "material")
        sub.prop(m, "proceso")
        sub.prop(m, "acabado")
        fila = sub.row(align=True)
        fila.prop(m, "cantidad")
        fila.prop(m, "orden_ensamble")
        sub.prop(m, "nota_taller")
        sub.separator()
        sub.prop(m, "usar_explode")
        exp = sub.column()
        exp.enabled = m.usar_explode
        exp.prop(m, "explode_vector")
        exp.prop(m, "explode_dist_cm")


class JV_PT_escena(Panel):
    bl_label = "JARVIS — ensamble"
    bl_idname = "SCENE_PT_jarvis"
    bl_space_type = "PROPERTIES"
    bl_region_type = "WINDOW"
    bl_context = "scene"

    def draw(self, context):
        em = context.scene.jarvis_meta
        col = self.layout.column()
        col.use_property_split = True
        col.prop(em, "pieza_id")
        col.prop(em, "pieza_nombre")
        col.prop(em, "proyecto")
        col.prop(em, "anclaje")
        if em.anclaje == "punto_named":
            col.prop(em, "anclaje_punto")
        fila = col.row(align=True)
        fila.prop(em, "revision")
        fila.prop(em, "autor")
        col.separator()
        fila = col.row(align=True)
        fila.operator(JV_OT_prellenar.bl_idname, icon="OUTLINER_OB_GROUP_INSTANCE")
        fila.operator(JV_OT_revisar.bl_idname, icon="CHECKMARK")

        # El último veredicto del linter, si existe (lo guarda Revisar/Export).
        wm = context.window_manager
        if "jarvis_lint" in wm:
            r = json.loads(wm["jarvis_lint"])
            caja = self.layout.box()
            s = r["stats"]
            tris = f"{s['tris']:,}" if s["tris"] is not None else "?"
            caja.label(text=f"{s['piezas']} piezas · {s['materiales']} mat · "
                            f"~{s['draw_calls']} draw calls · {tris} tris")
            for e in r["errores"]:
                caja.label(text=e, icon="ERROR")
            for a in r["avisos"]:
                caja.label(text=a, icon="INFO")
            if not r["errores"]:
                caja.label(text="Listo para exportar", icon="CHECKMARK")


class JV_OT_prellenar(Operator):
    """Prellena pieza_id, nombre y capa desde los nombres de objeto y sus
colecciones. Sólo llena lo VACÍO — lo capturado a mano no se toca. Capturar
20 piezas a mano es un castigo; esto deja el linter en verde en un clic y
tú corriges lo que haya adivinado mal"""

    bl_idname = "scene.jarvis_prellenar"
    bl_label = "Prellenar desde nombres"
    bl_options = {"REGISTER", "UNDO"}

    def execute(self, context):
        # La selección manda; sin selección, todas las piezas incluidas.
        base = [o for o in context.selected_objects
                if o.type in TIPOS_GEOMETRIA and o.jarvis_meta.incluir]
        objetivos = base or piezas_de(context)
        if not objetivos:
            self.report({"WARNING"}, "No hay piezas que prellenar")
            return {"CANCELLED"}

        import unicodedata

        def a_id(texto):
            plano = unicodedata.normalize("NFD", texto)
            plano = "".join(c for c in plano if unicodedata.category(c) != "Mn")
            plano = re.sub(r"[^A-Za-z0-9._-]+", "-", plano).strip("-.")
            return plano or "PIEZA"

        llenados = 0
        for i, o in enumerate(sorted(objetivos, key=lambda x: x.name), 1):
            m = o.jarvis_meta
            toco = False
            if not m.pieza_id.strip():
                m.pieza_id = a_id(f"{i:02d}-{o.name}")
                toco = True
            if not m.pieza_nombre.strip():
                m.pieza_nombre = o.name.replace("_", " ").replace(".", " ").strip()
                toco = True
            if not m.capa.strip():
                # La colección ES la capa (HANDOFF §6). Las genéricas de
                # Blender no dicen nada: caen a "General".
                col = o.users_collection[0].name if o.users_collection else ""
                m.capa = col if col not in ("", "Scene Collection", "Collection") else "General"
                toco = True
            if toco:
                llenados += 1

        # La emboscada del primer uso real: con una selección activa sólo se
        # llena la selección, y las piezas de afuera se quedan con huecos sin
        # que nadie lo diga. Se detecta y se avisa con el remedio.
        fuera = []
        if base:
            fuera = [o.name for o in piezas_de(context) if o not in objetivos
                     and not (o.jarvis_meta.pieza_id.strip()
                              and o.jarvis_meta.pieza_nombre.strip()
                              and o.jarvis_meta.capa.strip())]

        # El resultado se revisa de inmediato: el punto es dejar el linter verde.
        r = lint(context, con_geometria=False)
        context.window_manager["jarvis_lint"] = json.dumps(r, ensure_ascii=False)
        faltan = len(r["errores"])
        msg = f"{llenados} piezas prellenadas"
        if fuera:
            msg += (f" · ⚠ {len(fuera)} con huecos FUERA de la selección "
                    f"({', '.join(fuera[:3])}…): deselecciona todo (Alt+A) y repite")
        elif faltan:
            msg += f" · quedan {faltan} errores (ver panel)"
        else:
            msg += " · linter en verde"
        self.report({"WARNING" if fuera else "INFO"}, msg)
        return {"FINISHED"}


class JV_OT_revisar(Operator):
    """Corre el linter completo (con conteo real de triángulos) sin exportar"""

    bl_idname = "scene.jarvis_revisar"
    bl_label = "Revisar pieza"

    def execute(self, context):
        r = lint(context, con_geometria=True)
        context.window_manager["jarvis_lint"] = json.dumps(r, ensure_ascii=False)
        if r["errores"]:
            self.report({"ERROR"}, f"{len(r['errores'])} errores — ver panel JARVIS")
        elif r["avisos"]:
            self.report({"WARNING"}, f"Sin errores; {len(r['avisos'])} avisos")
        else:
            self.report({"INFO"}, "Limpio: listo para exportar")
        return {"FINISHED"}


# ───────── Export ─────────

class JV_OT_export(Operator, ExportHelper):
    """Exporta GLB con el contrato JARVIS embebido (y opcionalmente publica)"""

    bl_idname = "export_scene.jarvis_glb"
    bl_label = "Exportar GLB JARVIS"
    bl_options = {"PRESET"}

    filename_ext = ".glb"
    filter_glob: StringProperty(default="*.glb", options={"HIDDEN"})

    comprimir: BoolProperty(
        name="Comprimir (Draco)",
        description="Automático a propósito (§6): no es un paso manual que "
                    "alguien olvide. El visor ya trae el decoder",
        default=True,
    )
    publicar: BoolProperty(
        name="Publicar al visor",
        description="Corre herramientas/publicar-modelo.py al terminar: "
                    "copia al repo de modelos, registra en el catálogo y "
                    "despliega. Configura la ruta del repo en las "
                    "preferencias del addon",
        default=False,
    )

    def invoke(self, context, event):
        em = context.scene.jarvis_meta
        if em.pieza_id.strip():
            self.filepath = f"{em.pieza_id.strip()}-{em.revision.strip() or 'R1'}.glb"
        return super().invoke(context, event)

    def draw(self, context):
        col = self.layout.column()
        col.prop(self, "comprimir")
        col.prop(self, "publicar")
        # Chequeo BARATO en el diálogo (sin evaluar geometría — eso jankea el
        # repintado). El conteo real de triángulos corre al confirmar.
        r = lint(context, con_geometria=False)
        caja = self.layout.box()
        s = r["stats"]
        caja.label(text=f"{s['piezas']} piezas · {s['materiales']} materiales")
        for e in r["errores"][:6]:
            caja.label(text=e, icon="ERROR")
        if len(r["errores"]) > 6:
            caja.label(text=f"…y {len(r['errores']) - 6} errores más", icon="ERROR")
        for a in r["avisos"][:3]:
            caja.label(text=a, icon="INFO")

    def execute(self, context):
        sc = context.scene
        em = sc.jarvis_meta

        # ⚠ REGLA DE VIDA: todo lo que se lee de jarvis_meta se lee AQUÍ, a
        # escalares planos, ANTES de ocultar las system properties. Leer un
        # PropertyGroup cuyo respaldo se borró es un puntero colgante y
        # Blender revienta con ACCESS_VIOLATION (pasó: el enum de anclaje).
        v_pieza_id = em.pieza_id.strip()
        v_pieza_nombre = em.pieza_nombre.strip()
        v_proyecto = em.proyecto.strip()
        v_autor = em.autor.strip()
        v_revision = em.revision.strip()
        v_anclaje = em.anclaje
        v_anclaje_punto = em.anclaje_punto.strip()

        # El linter completo manda: con errores NO hay archivo. Es la línea
        # que separa "exportó" de "cargará bien en el visor".
        r = lint(context, con_geometria=True)
        context.window_manager["jarvis_lint"] = json.dumps(r, ensure_ascii=False)
        if r["errores"]:
            self.report({"ERROR"}, "Linter: " + " · ".join(r["errores"][:4]) +
                        (f" (+{len(r['errores']) - 4})" if len(r["errores"]) > 4 else ""))
            return {"CANCELLED"}

        piezas = piezas_de(context)

        # bbox del ensamble en cm, en mundo (informativo, contrato §6).
        # Blender es Z-up: [ancho X, alto Z, fondo Y]; el export convierte a Y-up.
        minimos = [float("inf")] * 3
        maximos = [float("-inf")] * 3
        for o in piezas:
            for esquina in o.bound_box:
                p = o.matrix_world @ Vector(esquina)
                for i in range(3):
                    minimos[i] = min(minimos[i], p[i])
                    maximos[i] = max(maximos[i], p[i])
        bbox_cm = [round((maximos[0] - minimos[0]) * 100, 1),
                   round((maximos[2] - minimos[2]) * 100, 1),
                   round((maximos[1] - minimos[1]) * 100, 1)]

        # Estampar y SIEMPRE restaurar: el .blend queda como estaba, sin
        # basura acumulada por export (patrón heredado de glb_manuales_addon).
        estampados = []

        def estampar(bloque, valores):
            for clave, valor in valores.items():
                previo = bloque.get(clave, None) if clave in bloque.keys() else None
                estampados.append((bloque, clave, previo))
                bloque[clave] = valor

        escena_extras = {
            "palace_schema": SCHEMA,
            "pieza_id": v_pieza_id,
            "pieza_nombre": v_pieza_nombre,
            "unidad": "m",           # el linter ya garantizó métrico 1.0
            "y_up": True,            # export_yup=True abajo
            "anclaje": v_anclaje,
            "bbox_cm": bbox_cm,
            "revision": v_revision,
            "fecha": datetime.date.today().isoformat(),
        }
        if v_proyecto:
            escena_extras["proyecto"] = v_proyecto
        if v_autor:
            escena_extras["autor"] = v_autor
        if v_anclaje == "punto_named":
            escena_extras["anclaje_punto"] = v_anclaje_punto

        seleccion_previa = list(context.selected_objects)
        activo_previo = context.view_layer.objects.active

        # El exportador vuelca TAMBIÉN las system properties (donde vive la
        # PropertyGroup desde Blender 4.x — extras.py del exportador itera
        # bl_system_properties_get() con sólo una lista negra fija), así que
        # jarvis_meta saldría DUPLICADA en cada nodo. Se quita durante el
        # export y se restaura idéntica del respaldo — los paneles ni se
        # enteran. Verificado diseccionando el GLB en probar_addon.py.
        ocultos = []

        def ocultar_meta(bloque):
            if not hasattr(bloque, "bl_system_properties_get"):
                return  # Blender viejo: la duplicación es cosmética, no fatal
            props = bloque.bl_system_properties_get()
            if props and "jarvis_meta" in props.keys():
                ocultos.append((bloque, props["jarvis_meta"].to_dict()))
                del props["jarvis_meta"]

        try:
            estampar(sc, escena_extras)
            for o in piezas:
                m = o.jarvis_meta
                extras = {
                    "pieza_id": m.pieza_id.strip(),
                    "pieza_nombre": m.pieza_nombre.strip(),
                    "capa": m.capa.strip(),
                    "cantidad": m.cantidad,
                }
                for campo in ("material", "proceso", "acabado", "nota_taller"):
                    v = getattr(m, campo).strip()
                    if v:
                        extras[campo] = v
                if m.orden_ensamble > 0:
                    extras["orden_ensamble"] = m.orden_ensamble
                if m.usar_explode:
                    extras["explode_vector"] = list(m.explode_vector)
                    extras["explode_dist_cm"] = round(m.explode_dist_cm, 2)
                estampar(o, extras)

            # Exportar sólo las piezas (+ el Empty de anclaje si aplica):
            # el filtro del exportador glTF es la selección.
            a_exportar = list(piezas)
            if v_anclaje == "punto_named":
                punto = bpy.data.objects.get(v_anclaje_punto)
                if punto is not None:
                    a_exportar.append(punto)
            # Ocultar AL FINAL, cuando ya nadie va a leer jarvis_meta.
            ocultar_meta(sc)
            for o in a_exportar:
                ocultar_meta(o)
            bpy.ops.object.select_all(action="DESELECT")
            for o in a_exportar:
                o.select_set(True)
            context.view_layer.objects.active = a_exportar[0]

            bpy.ops.export_scene.gltf(
                filepath=self.filepath,
                export_format="GLB",
                export_extras=True,   # sin esto, el contrato no viaja
                export_yup=True,
                export_apply=True,    # modificadores aplicados: lo que contó el linter
                use_selection=True,
                export_draco_mesh_compression_enable=self.comprimir,
            )
        except Exception as e:  # noqa: BLE001 — se reporta y se limpia
            self.report({"ERROR"}, f"Falló el export: {e}")
            return {"CANCELLED"}
        finally:
            for bloque, datos in ocultos:
                bloque.bl_system_properties_get()["jarvis_meta"] = datos
            for bloque, clave, previo in reversed(estampados):
                if previo is None:
                    if clave in bloque.keys():
                        del bloque[clave]
                else:
                    bloque[clave] = previo
            try:
                bpy.ops.object.select_all(action="DESELECT")
                for o in seleccion_previa:
                    o.select_set(True)
                context.view_layer.objects.active = activo_previo
            except RuntimeError:
                pass  # headless sin contexto de vista; no vale abortar

        mb = Path(self.filepath).stat().st_size / 1048576
        aviso = f" · ⚠ {mb:.1f} MB > presupuesto 15" if mb > 15 else ""
        self.report({"INFO"}, f"GLB: {len(piezas)} piezas, {mb:.1f} MB{aviso}")

        if self.publicar:
            # Escalares, no el PropertyGroup: tras ocultar/restaurar, el
            # wrapper viejo no es de fiar.
            return self._publicar(context, v_pieza_id, v_pieza_nombre, v_revision)
        return {"FINISHED"}

    def _publicar(self, context, pieza_id, pieza_nombre, revision):
        # Corriendo como script suelto (headless, pruebas) el addon no está en
        # preferences.addons — degradar avisando, no tronar.
        entrada = context.preferences.addons.get(__name__)
        repo = entrada.preferences.repo_codigo if entrada else ""
        script = Path(repo) / "herramientas" / "publicar-modelo.py"
        if not repo or not script.exists():
            self.report({"WARNING"},
                        "GLB exportado, pero no encuentro publicar-modelo.py — "
                        "configura la ruta del repo en las preferencias del addon")
            return {"FINISHED"}
        # sys.executable en Blender es su Python embebido; el script sólo usa
        # stdlib + git/npx del PATH, así que corre tal cual.
        r = subprocess.run(
            [sys.executable, str(script), self.filepath,
             "--id", pieza_id,
             "--nombre", pieza_nombre,
             "--rev", revision],
            capture_output=True, text=True, timeout=600,
            cwd=str(repo),
        )
        cola = (r.stdout + r.stderr).strip().splitlines()
        if r.returncode != 0:
            self.report({"WARNING"}, "Export OK pero publicar falló: " +
                        (cola[-1] if cola else f"código {r.returncode}"))
        else:
            self.report({"INFO"}, cola[-2] if len(cola) > 1 else "Publicado")
        return {"FINISHED"}


class JV_Preferencias(AddonPreferences):
    bl_idname = __name__

    repo_codigo: StringProperty(
        name="Carpeta LOCAL del repo del visor",
        description="La carpeta en tu disco donde está clonado "
                    "Asistente_Manuales_JARVIS (NO la URL de GitHub). El botón "
                    "publicar corre herramientas/publicar-modelo.py de ahí, y "
                    "espera el clon de JARVIS-Modelos como carpeta hermana",
        subtype="DIR_PATH",
        default="",
    )

    def draw(self, context):
        col = self.layout.column()
        col.prop(self, "repo_codigo")
        ruta = Path(self.repo_codigo) if self.repo_codigo else None
        if not self.repo_codigo:
            col.label(text="Elige la CARPETA del clon (icono de folder), no la URL de GitHub.",
                      icon="INFO")
        elif not (ruta / "herramientas" / "publicar-modelo.py").exists():
            col.label(text="Ahí no veo herramientas/publicar-modelo.py — ¿es la carpeta correcta?",
                      icon="ERROR")
        elif not (ruta.parent / "JARVIS-Modelos" / "public" / "piezas.json").exists():
            col.label(text="Falta el clon hermano JARVIS-Modelos junto a esta carpeta.",
                      icon="ERROR")
        else:
            col.label(text="Listo: script y repo de modelos encontrados.", icon="CHECKMARK")


def menu_export(self, context):
    self.layout.operator(JV_OT_export.bl_idname, text="GLB JARVIS (.glb)")


# ───────── Registro ─────────

CLASSES = (
    JV_PiezaMeta,
    JV_EscenaMeta,
    JV_PT_objeto,
    JV_PT_escena,
    JV_OT_prellenar,
    JV_OT_revisar,
    JV_OT_export,
    JV_Preferencias,
)


def register():
    for cls in CLASSES:
        bpy.utils.register_class(cls)
    bpy.types.Object.jarvis_meta = PointerProperty(type=JV_PiezaMeta)
    bpy.types.Scene.jarvis_meta = PointerProperty(type=JV_EscenaMeta)
    bpy.types.TOPBAR_MT_file_export.append(menu_export)


def unregister():
    bpy.types.TOPBAR_MT_file_export.remove(menu_export)
    del bpy.types.Scene.jarvis_meta
    del bpy.types.Object.jarvis_meta
    for cls in reversed(CLASSES):
        bpy.utils.unregister_class(cls)


if __name__ == "__main__":
    register()
