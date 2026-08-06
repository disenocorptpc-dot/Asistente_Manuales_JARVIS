/* Carga del GLB y parseo del contrato de datos (HANDOFF §6).
   El GLB se describe a sí mismo vía extras; aquí se valida y se indexa.
   GLTFLoader de three copia extras de escena a gltf.scene.userData y
   extras de nodo a object.userData (verificado en VERIFICACIONES.md §6). */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const ANCLAJES = new Set(['base_centro', 'centro_geometrico', 'punto_named']);

export async function cargarPieza(url) {
  const gltf = await new GLTFLoader().loadAsync(url);
  const modelo = gltf.scene;
  const meta = modelo.userData ?? {};

  // Rechazar en voz alta, nunca cargar mal en silencio (HANDOFF §4).
  if (meta.palace_schema !== 1)
    throw new Error(`GLB sin palace_schema=1 en extras de escena (${url}). ¿Se exportó con el addon?`);
  if (meta.unidad !== 'm')
    throw new Error(`GLB declara unidad "${meta.unidad}" — el contrato exige metros.`);

  // Índice de piezas: todo mesh con pieza_id en sus extras (o en su ancestro
  // directo, para meshes multi-material que glTF parte en primitivas).
  const piezas = new Map();
  modelo.traverse((obj) => {
    if (obj === modelo) return; // la raíz trae los extras de ESCENA, no es pieza
    const d = obj.userData;
    if (d?.pieza_id && !piezas.has(d.pieza_id)) piezas.set(d.pieza_id, obj);
  });
  if (piezas.size === 0)
    throw new Error('GLB sin ninguna pieza con pieza_id en extras — no hay nada que despiezar.');

  recentrarPivote(modelo, meta.anclaje ?? 'base_centro');

  // Posición de reposo de cada pieza, para que el explotado tenga a dónde volver.
  const reposo = new Map();
  for (const [id, obj] of piezas) reposo.set(id, obj.position.clone());

  return { modelo, meta, piezas, reposo };
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
