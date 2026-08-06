/* Secuencia de arranque, heredada de Pipo (Playbook §2):
   - El motor y el modelo se precargan EN PARALELO desde que abre la página.
   - La cámara se pide UNO MISMO antes de XR8.run, para tener el error real.
   - Fallback sin cámara obligatorio: no es un error, es la experiencia
     menos el AR. */
import * as THREE from 'three';
window.THREE = THREE; // XR8.Threejs espera THREE como global de la página

import { crearVisor } from './core/coordinar.js';
import { iniciarAR } from './ar-shell.js';
import { iniciarDesktop } from './desktop-shell.js';
import { crearHUD } from './ui/hud.js';
import { crearDebug } from './debug.js';

const params = new URLSearchParams(location.search);
const MODO_FORZADO = params.get('modo'); // ?modo=desktop fuerza el fallback

/* El motor arranca a descargarse DESDE YA, en paralelo con el GLB. */
function esperarXR8(ms) {
  return new Promise((res, rej) => {
    if (window.XR8) return res();
    const t = setTimeout(() => rej(new Error('el motor de 8th Wall no cargó (CDN)')), ms);
    window.addEventListener('xrloaded', () => { clearTimeout(t); res(); }, { once: true });
  });
}
const motorListo = (async () => {
  await esperarXR8(15000);
  await XR8.loadChunk('slam'); // sin esto, XR8.XrController es null
  if (!XR8.XrController) throw new Error('el chunk de SLAM no cargó (CDN)');
})();
motorListo.catch(() => {}); // si caemos a desktop, que no truene suelto

const contenido = await fetch('contenido.json').then((r) => r.json());
const registro = params.get('pieza')
  ? contenido.piezas.find((p) => p.pieza_id === params.get('pieza'))
  : contenido.piezas[0];
if (!registro) {
  document.getElementById('estado').textContent = `No existe la pieza "${params.get('pieza')}"`;
  throw new Error('pieza desconocida');
}

const visorPromesa = crearVisor(registro.modelo, contenido);

async function arrancar() {
  const visor = await visorPromesa;
  const hud = crearHUD(visor, registro);
  const debug = crearDebug(visor);

  let shell = null;
  if (MODO_FORZADO !== 'desktop') {
    try {
      shell = await iniciarAR({ visor, hud, debug, registro, contenido, motorListo });
    } catch (e) {
      console.warn('AR no disponible:', e);
      debug.razonFallback(e?.message ?? String(e));
    }
  }
  if (!shell) shell = iniciarDesktop({ visor, hud, debug, contenido });
  debug.conectarShell(shell);
}

arrancar().catch((e) => {
  document.getElementById('estado').textContent = `No se pudo arrancar: ${e.message}`;
  console.error(e);
});
