/* Sonido del HUD — sintetizado con Web Audio, CERO assets. La estética es
   "instrumento de precisión": chirps limpios de seno/triángulo, un soplo de
   ruido filtrado para el despiece. Nada de samples: el carácter vive en
   parámetros, se afina editando números, y no pesa un byte en la red.

   Reglas:
   - El AudioContext se crea/reanuda en el PRIMER gesto del usuario (política
     de autoplay; en iOS es obligatorio). Los eventos que suenan sin gesto
     (lock del marcador) ya llegan después de ese primer tap.
   - Botón de silencio persistente (localStorage): frente a los dueños el
     drama suma; en el banco del taller ocho horas, no.
   - Volumen master en contenido.json, no aquí. */

export function crearSonido(opciones = {}) {
  const volumenMaster = opciones.volumen ?? 0.2;
  let ctx = null;
  let master = null;

  let activo = true;
  try { activo = localStorage.getItem('jarvis_sonido') !== '0'; } catch { /* modo privado */ }

  function asegurar() {
    if (!ctx) {
      const AC = window.AudioContext ?? window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = volumenMaster;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  }
  // Despertar el contexto con el primer gesto que haya, sea cual sea.
  addEventListener('pointerdown', asegurar, { once: true });

  /* Un tono con envolvente de ataque corto y caída exponencial. */
  function tono({ f0, f1 = f0, dur = 0.1, tipo = 'sine', vol = 0.5, retraso = 0 }) {
    if (!activo || !asegurar()) return;
    const t0 = ctx.currentTime + retraso;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = tipo;
    osc.frequency.setValueAtTime(f0, t0);
    if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), t0 + dur);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(g).connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  /* Soplo: ruido blanco por un pasabanda que barre — el "whoosh" del
     despiece. Un buffer corto generado al vuelo, nada precargado. */
  function soplo({ dur = 0.5, desde = 300, hasta = 1800, vol = 0.6, retraso = 0 }) {
    if (!activo || !asegurar()) return;
    const t0 = ctx.currentTime + retraso;
    const n = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const datos = buf.getChannelData(0);
    for (let i = 0; i < n; i++) datos[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filtro = ctx.createBiquadFilter();
    filtro.type = 'bandpass';
    filtro.Q.value = 1.2;
    filtro.frequency.setValueAtTime(Math.max(desde, 1), t0);
    filtro.frequency.exponentialRampToValueAtTime(Math.max(hasta, 1), t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + dur * 0.15);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    src.connect(filtro);
    filtro.connect(g).connect(master);
    src.start(t0);
    src.stop(t0 + dur + 0.05);
  }

  return {
    get activo() { return activo; },
    alternar() {
      activo = !activo;
      try { localStorage.setItem('jarvis_sonido', activo ? '1' : '0'); } catch { /* ídem */ }
      if (activo) this.tick(); // confirmación audible de que volvió
      return activo;
    },

    // ── UI chica ──────────────────────────────────────────────────
    tick: () => tono({ f0: 1320, f1: 880, dur: 0.05 }),                    // toggles: escala, orientación, capas
    blip: () => tono({ f0: 660, f1: 990, dur: 0.07 }),                     // ficha de pieza
    escucha: () => tono({ f0: 400, f1: 1000, dur: 0.12, vol: 0.45 }),      // mic abierto
    exito() { tono({ f0: 660, dur: 0.06 }); tono({ f0: 990, dur: 0.09, retraso: 0.07 }); },
    error: () => tono({ f0: 200, f1: 140, dur: 0.18, tipo: 'square', vol: 0.35 }),

    // ── Los dramáticos ────────────────────────────────────────────
    lock() {   // marcador enganchado: arpegio ascendente + brillo arriba
      [523, 784, 1047].forEach((f, i) => tono({ f0: f, dur: 0.14, retraso: i * 0.07 }));
      tono({ f0: 2093, dur: 0.3, vol: 0.15, retraso: 0.2 });
    },
    /* El sonido de pérdida de encuadre SE QUITÓ (campo, ronda #3): imagelost
       dispara a cada rato con el protocolo "engancha y retrocede" y el
       doble beep taladraba. La pérdida se comunica sólo por texto del HUD. */
    perdida() {},
    carga: () => // GLB listo: power-up de cuatro notas
      [392, 523, 659, 880].forEach((f, i) => tono({ f0: f, dur: 0.12, vol: 0.45, retraso: i * 0.08 })),
    explota() { // whoosh que abre + golpe grave — MÁS fuerte (campo, ronda #3)
      soplo({ dur: 0.7, desde: 220, hasta: 2600, vol: 1.0 });
      tono({ f0: 100, f1: 45, dur: 0.35, tipo: 'triangle', vol: 0.95 });
      tono({ f0: 1320, f1: 1980, dur: 0.12, vol: 0.4, retraso: 0.05 }); // chispa arriba, se oye en bocina chica
    },
    arma() {    // whoosh inverso + clac al asentar
      soplo({ dur: 0.55, desde: 2200, hasta: 200, vol: 0.85 });
      tono({ f0: 740, f1: 1100, dur: 0.09, vol: 0.6, retraso: 0.5 });
    },
    orbita: (encendida) => encendida
      ? tono({ f0: 300, f1: 600, dur: 0.25, tipo: 'triangle', vol: 0.35 })
      : tono({ f0: 600, f1: 280, dur: 0.22, tipo: 'triangle', vol: 0.35 }),
  };
}
