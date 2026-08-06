/* Capas (HANDOFF §6): las colecciones de Blender llegan como nodos padre;
   el campo extras.capa de cada objeto es el respaldo cuando la jerarquía
   no es limpia. Aquí se agrupa por extras.capa, que siempre existe porque
   el linter del addon bloquea exports sin él. */
export function crearCapas(pieza) {
  const capas = new Map(); // nombre → { objetos: [], visible: true }
  for (const obj of pieza.piezas.values()) {
    const nombre = obj.userData.capa ?? 'Sin capa';
    if (!capas.has(nombre)) capas.set(nombre, { objetos: [], visible: true });
    capas.get(nombre).objetos.push(obj);
  }

  return {
    nombres: () => [...capas.keys()],
    visible: (nombre) => capas.get(nombre)?.visible ?? false,
    alternar(nombre) {
      const capa = capas.get(nombre);
      if (!capa) return;
      capa.visible = !capa.visible;
      for (const obj of capa.objetos) obj.visible = capa.visible;
      return capa.visible;
    },
  };
}
