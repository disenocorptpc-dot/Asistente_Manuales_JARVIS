/* Panel ?debug=1 — colapsado por defecto, una línea (modo · ancla · fps),
   expandible. En Pipo un toggle en dispositivo respondió en 5 segundos lo
   que días de opinión no. */
export function crearDebug(visor) {
  const activo = new URLSearchParams(location.search).has('debug');
  const caja = document.getElementById('debug');
  let fallback = '';
  let ancla = '—';
  let shell = null;
  const medidor = { frames: 0, fps: 0, ultimo: performance.now() };

  if (activo) caja.classList.add('on');

  caja.querySelector('#dbg-toggle')?.addEventListener('click', (e) => {
    const min = caja.classList.toggle('min');
    e.target.textContent = min ? '＋' : '－';
  });

  function pintar() {
    caja.querySelector('#dbg-mini').textContent =
      `${shell?.nombre ?? '…'} · ${ancla} · ${medidor.fps} fps`;
    caja.querySelector('#dbg-info').textContent =
      `shell     ${shell?.nombre ?? 'arrancando'}${fallback ? ` (${fallback})` : ''}\n` +
      `ancla     ${ancla}\n` +
      `escala    ${visor.escala.modo} · u/m ${visor.escala.unidadesPorMetro || '—'} · ${visor.grafo.orientacion}\n` +
      `explode   ${visor.explotado ? visor.explotado.factor.toFixed(2) : '—'}${visor.orbita?.activa ? ' · órbita' : ''}\n` +
      `piezas    ${visor.pieza?.piezas.size ?? 0} · capas ${visor.capas?.nombres().length ?? 0}\n` +
      `fps       ${medidor.fps}`;
  }
  if (activo) setInterval(pintar, 250);

  return {
    razonFallback: (r) => { fallback = r; },
    modoAncla: (m) => { ancla = m; },
    conectarShell: (s) => { shell = s; },
    tick() {
      medidor.frames++;
      const ahora = performance.now();
      if (ahora - medidor.ultimo >= 1000) {
        medidor.fps = Math.round((medidor.frames * 1000) / (ahora - medidor.ultimo));
        medidor.frames = 0;
        medidor.ultimo = ahora;
      }
    },
  };
}
