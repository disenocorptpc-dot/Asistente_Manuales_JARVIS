/* Shell AR: XR8, permisos, canvas, pipeline. Es el ÚNICO lugar (junto con
   los anchor-*) que importa cosas de XR8. El core recibe el grafo y no
   sabe que existe el SLAM. */
import * as THREE from 'three';
import { conectarMarcador } from './anchor-marker.js';
import { conectarHitTest } from './anchor-hittest.js';

export async function iniciarAR({ visor, hud, debug, registro, contenido, motorListo }) {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('el navegador no soporta cámara');
  if (!isSecureContext) throw new Error('se necesita HTTPS');

  /* La cámara se pide ANTES de XR8: XR8 rechaza con undefined cuando
     getUserMedia falla y el diagnóstico queda ciego. */
  try {
    const prueba = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    prueba.getTracks().forEach((t) => t.stop());
  } catch (e) {
    const motivos = {
      NotAllowedError: 'permiso de cámara negado',
      NotFoundError: 'el equipo no tiene cámara',
      NotReadableError: 'la cámara está ocupada por otra app',
      OverconstrainedError: 'no hay cámara trasera',
    };
    throw new Error(motivos[e.name] ?? `cámara: ${e.name}`);
  }

  await motorListo;

  /* Modo A si hay target compilado; si no, modo B (hitTest). Ambos comparten
     grafo y core: sólo cambia quién escribe la pose del ancla (HANDOFF §3). */
  let anchor;
  const marcador = registro?.marcador ?? {};
  try {
    const targetJson = await fetch(marcador.target_json).then((r) => {
      if (!r.ok) throw new Error('sin target');
      return r.json();
    });
    targetJson.imagePath = new URL(marcador.luminancia, location.href).pathname;
    anchor = conectarMarcador({ visor, hud, targetJson, anchoCm: marcador.ancho_cm, contenido });
  } catch {
    anchor = conectarHitTest({ visor, hud });
  }
  debug.modoAncla(anchor.nombre);

  const lienzo = document.getElementById('lienzo');

  /* La trampa del canvas 300×150: buffer al viewport ANTES de run y en cada
     rotación, o el feed sale chico y borroso. */
  const techoPR = contenido.render?.pixel_ratio_techo ?? 1.5;
  function ajustarLienzo() {
    const k = Math.min(devicePixelRatio, techoPR);
    lienzo.width = Math.round(document.documentElement.clientWidth * k);
    lienzo.height = Math.round(document.documentElement.clientHeight * k);
  }
  addEventListener('resize', () => setTimeout(ajustarLienzo, 120));
  addEventListener('orientationchange', () => setTimeout(ajustarLienzo, 300));

  const reloj = new THREE.Clock();

  return new Promise((resolver, rechazar) => {
    let arranco = false;
    let camaraXR = null;

    XR8.addCameraPipelineModules([
      XR8.GlTextureRenderer.pipelineModule(), // pinta el feed de la cámara
      XR8.Threejs.pipelineModule(),           // escena three.js con pose del SLAM
      XR8.XrController.pipelineModule(),      // tracking: mundo + image targets
      {
        name: 'jarvis-visor',
        onStart: () => {
          const { scene, camera } = XR8.Threejs.xrScene();
          scene.add(visor.grafo.ancla);
          camera.position.set(0, 1.6, 2);
          XR8.XrController.updateCameraProjectionMatrix({
            origin: camera.position, facing: camera.quaternion,
          });
          camaraXR = camera;
          arranco = true;
          document.body.classList.add('ar');
          resolver(shell);
        },
        onUpdate: () => {
          const dt = Math.min(reloj.getDelta(), 0.1);
          anchor.onUpdate?.(dt, camaraXR);
          visor.grafo.update(dt);
          hud.update(dt, camaraXR);
          debug.tick(dt);
        },
        onException: (err) => {
          console.warn('XR8 exception:', err);
          if (!arranco) rechazar(new Error(`XR8: ${err?.message ?? err}`));
        },
        listeners: anchor.listeners ?? [],
      },
    ]);

    ajustarLienzo();
    XR8.run({ canvas: lienzo, allowedDevices: XR8.XrConfig.device().ANY });

    /* Picking por tap: el shell traduce el evento a NDC; el core raycastea. */
    lienzo.addEventListener('pointerdown', (ev) => {
      if (!camaraXR || !visor.picker) return;
      const x = (ev.clientX / innerWidth) * 2 - 1;
      const y = -(ev.clientY / innerHeight) * 2 + 1;
      const hit = visor.picker.tocar(x, y, camaraXR);
      hud.mostrarFicha(hit);
    });

    const shell = {
      nombre: 'ar',
      get camara() { return camaraXR; },
      anchor,
    };
  });
}
