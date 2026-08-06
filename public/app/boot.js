/* Secuencia de arranque, heredada de Pipo (Playbook §2) más el portal:
   - El motor se precarga DESDE YA; el GLB llega del botón del HUD.
   - El AR arranca con un TAP ("Iniciar AR"): en iOS el permiso de
     giroscopio sólo se puede pedir desde un gesto, y sin gyro el SLAM
     no trackea. El tap también hace explícito el permiso de cámara.
   - Webview (WhatsApp/Teams/Instagram) no da cámara: se detecta y se
     pide abrir en el navegador de verdad.
   - Toda falla de AR es VISIBLE con reintento — nunca fallback mudo. */
import * as THREE from 'three';
window.THREE = THREE; // XR8.Threejs espera THREE como global de la página

import { crearVisor } from './core/coordinar.js';
import { iniciarAR } from './ar-shell.js';
import { iniciarDesktop } from './desktop-shell.js';
import { crearHUD } from './ui/hud.js';
import { crearDebug } from './debug.js';

const params = new URLSearchParams(location.search);
const MODO_FORZADO = params.get('modo'); // ?modo=desktop fuerza el fallback

/* El motor arranca a descargarse DESDE YA. */
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

/* Deep link ?pieza= (F4): sólo aplica si contenido.json la registra. */
const registro = params.get('pieza')
  ? (contenido.piezas ?? []).find((p) => p.pieza_id === params.get('pieza')) ?? null
  : null;

/* ── Webview embebido: getUserMedia muere ahí sin siquiera preguntar ── */
function esWebview() {
  const ua = navigator.userAgent;
  if (/(WhatsApp|FBAN|FBAV|Instagram|Line\/|MicroMessenger|Twitter|TikTok|Teams)/i.test(ua)) return true;
  if (/; wv\)/.test(ua)) return true; // WebView genérico de Android
  // iOS embebido: es iPhone/iPad pero el UA no trae el token de Safari.
  if (/iPhone|iPad|iPod/.test(ua) && !/Safari\//.test(ua)) return true;
  return false;
}

/* ── Portal: un panel, dos botones, devuelve qué eligió el usuario ── */
const portal = (() => {
  const el = document.getElementById('portal');
  const titulo = document.getElementById('portal-titulo');
  const texto = document.getElementById('portal-texto');
  const prim = document.getElementById('portal-primario');
  const sec = document.getElementById('portal-secundario');
  return {
    mostrar({ titulo: t, texto: x, primario, secundario }) {
      titulo.textContent = t;
      texto.textContent = x;
      if (primario) prim.textContent = primario;
      if (secundario) sec.textContent = secundario;
      el.classList.remove('oculto');
      el.classList.toggle('solo-secundario', !primario);
      el.classList.toggle('solo-primario', !secundario);
      return new Promise((res) => {
        prim.onclick = () => res('primario');
        sec.onclick = () => res('secundario');
      });
    },
    ocultar() { el.classList.add('oculto'); },
  };
})();

async function arrancar() {
  const visor = crearVisor(contenido);
  const hud = crearHUD(visor);
  const debug = crearDebug(visor);

  if (registro) {
    try { await visor.cargar(registro.modelo); }
    catch (e) { hud.estado(`No se pudo cargar ${registro.pieza_id}: ${e.message}`); }
  } else {
    hud.estado('Carga un GLB para empezar');
  }

  let shell = null;
  const puedeAR = MODO_FORZADO !== 'desktop'
    && !!navigator.mediaDevices?.getUserMedia
    && isSecureContext;

  if (puedeAR && esWebview()) {
    await portal.mostrar({
      titulo: 'Ábrelo en tu navegador',
      texto: 'Este navegador embebido no da acceso a la cámara. Toca el menú (⋯ o ⇧) y elige "Abrir en Safari" o "Abrir en Chrome". El enlace ya está en tu barra de direcciones.',
      secundario: 'Continuar sin AR',
    });
  } else if (puedeAR) {
    // Reintentable: permiso negado una vez no debe ser un callejón sin salida.
    while (!shell) {
      const eleccion = await portal.mostrar({
        titulo: 'Visor 3D AR',
        texto: 'Apunta, ancla y revisa la pieza a escala real. Se te pedirá permiso de cámara y sensores.',
        primario: 'Iniciar AR',
        secundario: 'Continuar sin AR',
      });
      if (eleccion === 'secundario') break;
      portal.ocultar();
      try {
        shell = await iniciarAR({ visor, hud, debug, registro, contenido, motorListo });
      } catch (e) {
        console.warn('AR no disponible:', e);
        debug.razonFallback(e?.message ?? String(e));
        const otra = await portal.mostrar({
          titulo: 'No se pudo iniciar el AR',
          texto: `${e?.message ?? e}. Si negaste el permiso, actívalo en el candado/ajustes del navegador y reintenta.`,
          primario: 'Reintentar',
          secundario: 'Continuar sin AR',
        });
        if (otra === 'secundario') break;
      }
    }
  } else if (MODO_FORZADO !== 'desktop') {
    debug.razonFallback(!isSecureContext ? 'se necesita HTTPS' : 'el navegador no soporta cámara');
  }

  portal.ocultar();
  if (!shell) shell = iniciarDesktop({ visor, hud, debug, contenido });
  debug.conectarShell(shell);
}

arrancar().catch((e) => {
  document.getElementById('estado').textContent = `No se pudo arrancar: ${e.message}`;
  console.error(e);
});
