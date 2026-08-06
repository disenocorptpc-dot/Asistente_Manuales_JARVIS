/* HUD funcional de F0: cargar GLB, indicador de escala permanente, slider de
   explotado, panel de capas, ficha de pieza y avisos de tracking. El look
   hi-tech completo (leader lines, cotas 3D, retículas) es F3 — HANDOFF §8.
   Regla de rendimiento heredada: sin backdrop-filter, sin mix-blend-mode;
   sólo se animan opacity y transform. */

export function crearHUD(visor) {
  const $ = (id) => document.getElementById(id);
  const el = {
    escala: $('hud-escala'),
    estado: $('estado'),
    slider: $('hud-explode'),
    capas: $('hud-capas'),
    ficha: $('hud-ficha'),
    coaching: $('hud-coaching'),
    titulo: $('hud-titulo'),
    cargar: $('hud-cargar'),
    archivo: $('hud-archivo'),
    abajo: $('hud-abajo'),
  };

  // ── Cargar GLB: el recurso llega del usuario, no de un catálogo.
  el.cargar.addEventListener('click', () => el.archivo.click());
  el.archivo.addEventListener('change', async () => {
    const f = el.archivo.files?.[0];
    if (!f) return;
    estado(`Cargando ${f.name}…`);
    const url = URL.createObjectURL(f);
    try {
      await visor.cargar(url, f.name);
    } catch (e) {
      estado(`No se pudo cargar: ${e.message}`);
      console.error(e);
    } finally {
      URL.revokeObjectURL(url);
      el.archivo.value = ''; // permitir recargar el mismo archivo
    }
  });

  // Al cargar (de donde sea): título, capas, slider a cero, avisos.
  visor.onCargar((pieza) => {
    el.titulo.textContent = pieza.nombre;
    el.slider.valueAsNumber = 0;
    reconstruirCapas();
    mostrarFicha(null);
    el.abajo.classList.add('visible');
    estado(pieza.avisos.length ? `⚠ ${pieza.avisos.join(' · ')}` : `${pieza.piezas.size} piezas`);
  });

  // ── Escala: visible SIEMPRE. Autorizar en tabletop creyendo ver 1:1
  //    es el peor error posible del proyecto (HANDOFF §4).
  function pintarEscala() {
    el.escala.textContent = visor.escala.modo;
    el.escala.classList.toggle('tabletop', visor.escala.modo !== '1:1');
  }
  el.escala.addEventListener('click', () => {
    visor.escala.cambiarModo(visor.escala.modo === '1:1' ? '1:10' : '1:1');
    pintarEscala();
  });
  pintarEscala();

  // ── Explotado: slider físico y grande, tercio inferior, para el pulgar.
  el.slider.addEventListener('input', () => {
    visor.explotado?.aplicar(el.slider.valueAsNumber / 100);
  });

  // ── Capas
  function reconstruirCapas() {
    el.capas.textContent = '';
    if (!visor.capas) return;
    for (const nombre of visor.capas.nombres()) {
      const b = document.createElement('button');
      b.textContent = nombre;
      b.className = 'capa activa';
      b.addEventListener('click', () => {
        const visible = visor.capas.alternar(nombre);
        b.classList.toggle('activa', visible);
      });
      el.capas.appendChild(b);
    }
  }

  // ── Ficha de pieza
  const ETIQUETAS = {
    pieza_id: 'ID', capa: 'Capa', material: 'Material', proceso: 'Proceso',
    acabado: 'Acabado', cantidad: 'Cantidad', orden_ensamble: 'Orden de ensamble',
    nota_taller: 'Nota de taller',
  };
  function mostrarFicha(hit) {
    if (!hit) { el.ficha.classList.remove('visible'); return; }
    const f = hit.ficha;
    el.ficha.innerHTML =
      `<h2>${f.pieza_nombre ?? f.pieza_id}</h2>` +
      Object.entries(ETIQUETAS)
        .filter(([campo]) => f[campo] !== undefined)
        .map(([campo, etiqueta]) => `<div class="dato"><span>${etiqueta}</span><b>${f[campo]}</b></div>`)
        .join('');
    el.ficha.classList.add('visible');
  }

  function estado(texto) { el.estado.textContent = texto; }

  return {
    mostrarFicha,
    estado,
    trackingEnganchado: () => estado('Anclado al marcador'),
    trackingExtendido: () => estado('Sostenido por SLAM — reacércate al marcador si se desvía'),
    modoSinMarcador: () => { if (visor.cargado) estado('Sin marcador: escala estimada, no para autorización 1:1'); },
    coaching: (mal) => el.coaching.classList.toggle('visible', mal),
    update() {},
  };
}
