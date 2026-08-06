/* Shell AR: XR8, permisos, canvas, pipeline. Es el ÚNICO lugar (junto con
   los anchor-*) que importa cosas de XR8. El core recibe el grafo y no
   sabe que existe el SLAM. */
import * as THREE from 'three';
import { conectarMarcador } from './anchor-marker.js';
import { conectarHitTest } from './anchor-hittest.js';

export async function iniciarAR({ visor, hud, debug, contenido, motorListo }) {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('el navegador no soporta cámara');
  if (!isSecureContext) throw new Error('se necesita HTTPS');

  /* iOS 13+: el giroscopio requiere permiso explícito y SÓLO se puede pedir
     desde un gesto del usuario — por eso iniciarAR se llama desde el tap del
     portal, y esta petición va PRIMERO, antes de perder la activación.
     Sin gyro el SLAM pierde la fusión visión+sensores y no sostiene la pose. */
  try {
    if (typeof DeviceMotionEvent !== 'undefined'
        && typeof DeviceMotionEvent.requestPermission === 'function') {
      const r = await DeviceMotionEvent.requestPermission();
      if (r !== 'granted') console.warn('[ar] giroscopio negado: tracking degradado');
    }
  } catch (e) {
    console.warn('[ar] permiso de sensores no disponible:', e);
  }

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

  /* Modo A si hay al menos un target compilado; si no, modo B (hitTest). Ambos
     comparten grafo y core: sólo cambia quién escribe la pose del ancla
     (HANDOFF §3).

     El marcador NO está amarrado a una pieza: da pose y escala, nunca
     identidad, así que se cargan TODOS los marcadores de contenido.json sin
     depender de ?pieza=. El GLB llega por su cuenta (botón del HUD). Antes
     esto sólo se activaba con deep link, y sin él el visor caía siempre a
     hitTest — o sea, nunca daba 1:1 real. */
  const targets = [];
  for (const m of contenido.marcadores ?? []) {
    try {
      const json = await fetch(m.target_json).then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      });
      /* imagePath del compilador es relativo a la raíz del sitio; absolutizarlo
         contra la página lo hace sobrevivir a un deploy en subcarpeta. La única
         fuente de verdad es el JSON compilado, no un campo duplicado. */
      json.imagePath = new URL(json.imagePath, location.href).pathname;
      if (!m.ancho_cm) throw new Error('sin ancho_cm: sin él no hay escala 1:1');
      targets.push({ json, anchoCm: m.ancho_cm, id: m.id ?? json.name });
    } catch (e) {
      console.warn(`[ar] marcador ${m.id ?? m.target_json} no cargó:`, e.message);
    }
  }

  const anchor = targets.length
    ? conectarMarcador({ visor, hud, targets, contenido })
    : conectarHitTest({ visor, hud });
  debug.modoAncla(targets.length ? `marcador (${targets.length})` : anchor.nombre);

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
          /* La escena de XR8 nace VACÍA — sin luces. Un GLB con materiales PBR
             se pinta NEGRO sin luz, y en escritorio nunca se nota porque el
             shell de desktop trae las suyas. Mismas luces que desktop-shell.js
             para que la pieza se vea igual en ambos shells. (Materiales con
             metalness alto van a pedir environment map; se decide en F2 con
             el addon, que es quien controla los materiales.) */
          scene.add(new THREE.HemisphereLight(0xEDECE4, 0x254D6E, 1.1));
          const sol = new THREE.DirectionalLight(0xffffff, 1.6);
          sol.position.set(3, 6, 4);
          scene.add(sol);
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
    /* sessionInitBehavior 'fallback' (leído del binario, VERIFICACIONES §8):
       el motor manda a los navegadores llamados "Edge" por la vía WebXR
       (regla pensada para visores), y Edge de Android anuncia immersive-ar
       pero falla al crear la sesión ("session configuration is not
       supported"). Con 'fallback', un session manager que no inicializa se
       salta y se prueba el siguiente — el pipeline de cámara de siempre. */
    XR8.run({
      canvas: lienzo,
      allowedDevices: XR8.XrConfig.device().ANY,
      sessionInitBehavior: 'fallback',
    });

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
