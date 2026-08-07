/* Carga del GLB y parseo del contrato de datos (HANDOFF §6).
   GLTFLoader de three copia extras de escena a gltf.scene.userData y extras
   de nodo a object.userData (verificado en VERIFICACIONES.md §6).

   Contrato: un GLB del pipeline trae palace_schema=1 y unidad "m". Un GLB
   ajeno (prueba, intercambio) se carga igual pero en MODO INSPECCIÓN: cada
   mesh se vuelve pieza por su nombre y los avisos se muestran en el HUD —
   degradar avisando, nunca cargar mal en silencio. */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

const ANCLAJES = new Set(['base_centro', 'centro_geometrico', 'punto_named']);

/* El addon (F2) comprime con Draco al exportar — sin el decoder registrado,
   GLTFLoader truena con "No DRACOLoader instance provided". El decoder (wasm)
   viene del MISMO paquete de three clavado en el importmap: una sola versión
   que subir cuando toque. Un GLB sin comprimir carga igual: el decoder sólo
   se usa si el archivo trae la extensión. */
const draco = new DRACOLoader()
  .setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/libs/draco/');
const cargador = new GLTFLoader().setDRACOLoader(draco);

export async function cargarPieza(url, nombreArchivo = '') {
  const gltf = await cargador.loadAsync(url);
  const modelo = gltf.scene;
  const meta = modelo.userData ?? {};
  const avisos = [];

  const conContrato = meta.palace_schema === 1;
  if (!conContrato) {
    avisos.push('GLB sin contrato palace_schema — modo inspección');
  } else if (meta.unidad !== 'm') {
    // Con contrato declarado, la unidad equivocada SÍ es fatal: el 1:1 miente.
    throw new Error(`GLB declara unidad "${meta.unidad}" — el contrato exige metros.`);
  }
  if (!conContrato) avisos.push('escala asumida: 1 unidad = 1 m');

  // Índice de piezas: con contrato, todo nodo con pieza_id; sin contrato,
  // cada mesh por su nombre. La raíz trae los extras de ESCENA, no es pieza.
  const piezas = new Map();
  modelo.traverse((obj) => {
    if (obj === modelo) return;
    if (conContrato) {
      const d = obj.userData;
      if (d?.pieza_id && !piezas.has(d.pieza_id)) piezas.set(d.pieza_id, obj);
    } else if (obj.isMesh) {
      const id = obj.name || `mesh_${piezas.size + 1}`;
      if (!piezas.has(id)) {
        obj.userData.pieza_id = id;
        obj.userData.pieza_nombre = obj.userData.pieza_nombre ?? id;
        piezas.set(id, obj);
      }
    }
  });
  if (piezas.size === 0)
    throw new Error('GLB sin piezas utilizables — ni pieza_id en extras ni meshes con nombre.');

  recentrarPivote(modelo, meta.anclaje ?? 'base_centro');

  // Posición y orientación de reposo de cada pieza, para que el explotado tenga a dónde volver.
  const reposo = new Map();
  const reposoRot = new Map();
  for (const [id, obj] of piezas) {
    reposo.set(id, obj.position.clone());
    reposoRot.set(id, obj.quaternion.clone());
  }

  const nombre = meta.pieza_nombre ?? nombreArchivo ?? 'GLB';
  return { modelo, meta, piezas, reposo, reposoRot, avisos, conContrato, nombre };
}

/* El equivalente GLB del translate(0,0.5,0) de Pipo: la pieza se asienta
   sobre el plano del marcador y rota sobre su propio eje vertical. */
function recentrarPivote(modelo, anclaje) {
  if (!ANCLAJES.has(anclaje)) anclaje = 'base_centro';

  if (anclaje === 'punto_named') {
    const punto = modelo.getObjectByName(modelo.userData.anclaje_punto ?? '__ANCLA__');
    if (punto) {
      const p = new THREE.Vector3();
      punto.getWorldPosition(p);
      modelo.position.sub(p);
      return;
    }
    anclaje = 'base_centro'; // el empty no vino: caer al default, avisando
    console.warn('[loader] anclaje punto_named sin empty; usando base_centro');
  }

  const caja = new THREE.Box3().setFromObject(modelo);
  const centro = caja.getCenter(new THREE.Vector3());
  const y = anclaje === 'centro_geometrico' ? centro.y : caja.min.y;
  modelo.position.sub(new THREE.Vector3(centro.x, y, centro.z));
}
