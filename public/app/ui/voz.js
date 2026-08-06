/* Voz push-to-talk — F5 adelantado, ruta A: Web Speech API (HANDOFF §12).
   Gratis, sin servidor, es-MX. Chrome/Android sólido; iOS Safari existe pero
   frágil (y nada en WebView/PWA standalone) — por eso el botón desaparece
   solo si la API no está, y Whisper por Worker queda como fallback para F6.

   Diseño:
   - PUSH-TO-TALK (mantener presionado): nada de micrófono siempre abierto —
     batería, falsos positivos, y en iOS la API exige gesto del usuario.
   - VOCABULARIO CERRADO: no se transcribe dictado; se busca una de ~15
     palabras esperadas dentro de lo reconocido. La fragilidad del
     reconocimiento importa menos cuando sólo hay 15 respuestas válidas.
   - Los nombres de capa vienen del GLB cargado (extras del contrato §6):
     cada pieza trae sus propios comandos sin tocar código.
   - `emparejar` es función pura y exportada: se prueba sin micrófono. */

const quitarAcentos = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

/* texto reconocido + capas disponibles → {accion, arg} | null.
   El transcript puede traer palabras de más («que explote la pieza»):
   se busca contención con frontera de palabra, no igualdad. */
export function emparejar(texto, capas = []) {
  const t = ` ${quitarAcentos(texto.toLowerCase().trim())} `;
  const tiene = (...palabras) =>
    palabras.some((p) => t.includes(` ${quitarAcentos(p.toLowerCase())} `));

  // Escalas — las frases largas antes que las palabras sueltas.
  if (tiene('uno a uno', 'tamano real', 'escala real')) return { accion: 'escala', arg: '1:1' };
  if (tiene('mitad', 'media', 'cincuenta')) return { accion: 'escala', arg: '1:2' };
  if (tiene('decimo', 'decima', 'miniatura', 'diez')) return { accion: 'escala', arg: '1:10' };

  // Explotado
  if (tiene('explota', 'explotado', 'explosion', 'despiece', 'desarma')) return { accion: 'explotar', arg: 1 };
  if (tiene('arma', 'cierra', 'junta')) return { accion: 'explotar', arg: 0 };

  // Origen: todo a su estado de inicio. VA ANTES que la órbita porque
  // «reinicia» no debe caer en las palabras de girar.
  if (tiene('origen', 'reinicia', 'restaura', 'inicio')) return { accion: 'origen' };

  // Órbita (turntable)
  if (tiene('orbita', 'gira', 'rota')) return { accion: 'orbita', arg: true };
  if (tiene('alto', 'quieto', 'para', 'detente', 'stop')) return { accion: 'orbita', arg: false };

  // Orientación del marcador
  if (tiene('mesa')) return { accion: 'orienta', arg: 'mesa' };
  if (tiene('pared')) return { accion: 'orienta', arg: 'pared' };

  // Capas: vocabulario dinámico del GLB, al final para no taparle
  // palabras a los comandos fijos.
  for (const capa of capas) {
    if (tiene(capa)) return { accion: 'capa', arg: capa };
  }
  return null;
}

export function crearVoz({ visor, hud, sonido = null }) {
  const boton = document.getElementById('hud-voz');
  const SR = window.SpeechRecognition ?? window.webkitSpeechRecognition;
  if (!SR) {
    boton.remove(); // sin API no hay botón: degradar sin ruido
    return null;
  }

  const rec = new SR();
  rec.lang = 'es-MX';
  rec.interimResults = false;
  rec.maxAlternatives = 4; // se intenta emparejar CADA alternativa, no sólo la primera

  /* Cada acción trae su sonido: los toggles del HUD ya hacen tick solos
     (van por la fachada, que dispara el botón real), y el despiece y la
     órbita ponen el drama aquí. */
  const ejecutar = (orden) => {
    switch (orden.accion) {
      case 'explotar':
        if (!visor.cargado) return null;
        visor.explotar(orden.arg, 1.2);
        if (orden.arg) sonido?.explota(); else sonido?.arma();
        return orden.arg ? 'despiece' : 'armado';
      case 'orbita':
        if (orden.arg) visor.orbita.iniciar(); else visor.orbita.detener();
        sonido?.orbita(orden.arg);
        return orden.arg ? 'orbitando' : 'quieta';
      case 'origen': {
        // Estado de inicio: órbita detenida Y de frente (parar deja la pieza
        // en un ángulo aleatorio), despiece cerrado, escala de arranque.
        const habiaDespiece = (visor.explotado?.factor ?? 0) > 0;
        visor.orbita.reiniciar();
        if (visor.cargado) visor.explotar(0, 0.8);
        hud.escalaA(visor.escala.inicial);
        if (habiaDespiece) sonido?.arma(); else sonido?.exito();
        return 'al origen';
      }
      case 'escala':
        sonido?.exito();
        return `escala ${hud.escalaA(orden.arg)}`;
      case 'orienta':
        sonido?.exito();
        return `marcador en ${hud.orientaA(orden.arg)}`;
      case 'capa':
        return hud.alternarCapa(orden.arg) ? `capa ${orden.arg}` : null;
    }
    return null;
  };

  rec.onresult = (ev) => {
    const res = ev.results[0];
    const capas = visor.capas?.nombres() ?? [];
    for (let i = 0; i < res.length; i++) {
      const orden = emparejar(res[i].transcript, capas);
      if (orden) {
        const hecho = ejecutar(orden);
        if (hecho) { hud.estado(`🎤 ${hecho}`); return; }
      }
    }
    sonido?.error();
    hud.estado(`🎤 no entendí «${res[0]?.transcript ?? ''}»`);
  };

  rec.onerror = (ev) => {
    const motivos = {
      'not-allowed': 'permiso de micrófono negado',
      'no-speech': 'no se oyó nada',
      'network': 'el reconocimiento necesita internet',
      'audio-capture': 'no hay micrófono',
    };
    hud.estado(`🎤 ${motivos[ev.error] ?? ev.error}`);
  };

  let escuchando = false;
  rec.onend = () => {
    escuchando = false;
    boton.classList.remove('grabando');
  };

  const empezar = (ev) => {
    ev.preventDefault(); // que el long-press no seleccione ni abra menú
    if (escuchando) return;
    escuchando = true;
    boton.classList.add('grabando');
    sonido?.escucha();
    hud.estado('🎤 escuchando…');
    try { rec.start(); } catch { /* start doble: inofensivo */ }
  };
  const soltar = () => {
    if (escuchando) try { rec.stop(); } catch { /* idem */ }
  };
  boton.addEventListener('pointerdown', empezar);
  boton.addEventListener('pointerup', soltar);
  boton.addEventListener('pointercancel', soltar);
  boton.addEventListener('pointerleave', soltar);
  boton.addEventListener('contextmenu', (e) => e.preventDefault());

  return { ejecutar, emparejar: (t) => emparejar(t, visor.capas?.nombres() ?? []) };
}
