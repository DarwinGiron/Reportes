// ============================================================================
// REPORTES.JS - Lógica del formulario del inspector y utilidades compartidas
// de reportes (usadas también por validacion.html y dashboard.html)
// ============================================================================
// MODELO DE DATOS - colección "reportes" (documento por hallazgo):
// {
//   fechaHora: Timestamp,               // editable por el inspector
//   inspectorUid: string, inspectorNombre: string,
//   zona: string, proceso: string,
//   descripcion: string,
//   puntoNormaId: string|null, puntoNormaTexto: string|null, // sugerido o asignado
//   fotos: [string,...],                // URLs de Cloudinary (1 a 3)
//   gps: { lat: number, lng: number } | null,
//   gpsError: string | null,
//   planoPunto: { x: number, y: number } | null, // porcentaje (0-100) del ancho/alto mostrado del plano real
//   estado: "pendiente" | "validado",
//   gravedad: "Crítico"|"Mayor"|"Menor"|"Observación" | null,
//   noAplicaNorma: boolean,
//   validadoPor: string|null, validadoPorNombre: string|null, fechaValidacion: Timestamp|null,
//   historialValidacion: [{ uid, nombre, fecha, cambios }],
//   creadoEn: Timestamp
// }
// ============================================================================

// ---------------------------------------------------------------------------
// COMPONENTE GENÉRICO: autocompletar con creación en línea
// ---------------------------------------------------------------------------
/**
 * Crea un buscador tipo "autocompletar" sobre una colección de catálogo
 * (zonas o procesos) que permite crear un nuevo documento al vuelo si el
 * texto escrito no coincide con ninguna opción existente.
 *
 * @param {Object} opts
 *   inputEl: <input> visible donde el usuario escribe
 *   listaEl: <div> contenedor de sugerencias
 *   coleccion: referencia de Firestore (colZonas o colProcesos)
 *   uidUsuario: uid del inspector autenticado (para metadatos de trazabilidad)
 *   onSeleccion: callback(valorTexto, id) cuando se elige/crea un valor
 */
function crearAutocompletarConCreacion({ inputEl, listaEl, coleccion, uidUsuario, onSeleccion }) {
  let opciones = []; // cache local {id, nombre}
  let valorSeleccionado = null;

  coleccion.where("activo", "!=", false).onSnapshot((snap) => {
    opciones = snap.docs.map((d) => ({ id: d.id, nombre: d.data().nombre }));
  }, () => {
    // Fallback si el índice "activo" no existe aún: trae todo sin filtro
    coleccion.onSnapshot((snap) => {
      opciones = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((d) => d.activo !== false)
        .map((d) => ({ id: d.id, nombre: d.nombre }));
    });
  });

  function normalizar(txt) {
    return (txt || "").trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  }

  function render(textoActual) {
    const q = normalizar(textoActual);
    listaEl.innerHTML = "";
    if (!q) { listaEl.style.display = "none"; return; }

    const coincidencias = opciones.filter((o) => normalizar(o.nombre).includes(q));
    const coincideExacto = opciones.some((o) => normalizar(o.nombre) === q);

    coincidencias.slice(0, 8).forEach((o) => {
      const div = document.createElement("div");
      div.className = "opcion";
      div.textContent = o.nombre;
      div.onclick = () => seleccionar(o.nombre, o.id);
      listaEl.appendChild(div);
    });

    if (!coincideExacto && textoActual.trim().length > 0) {
      const div = document.createElement("div");
      div.className = "opcion opcion-nueva";
      div.innerHTML = '<svg class="icono icono-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> ';
      div.appendChild(document.createTextNode(`Agregar "${textoActual.trim()}" como nueva`));
      div.onclick = () => crearYSeleccionar(textoActual.trim());
      listaEl.appendChild(div);
    }

    listaEl.style.display = (coincidencias.length > 0 || textoActual.trim().length > 0) ? "block" : "none";
  }

  async function crearYSeleccionar(nombre) {
    try {
      const doc = await coleccion.add({
        nombre,
        activo: true,
        creadaPor: uidUsuario,
        fechaCreacion: firebase.firestore.FieldValue.serverTimestamp(),
        origenInspector: true
      });
      seleccionar(nombre, doc.id);
    } catch (e) {
      console.error("Error creando catálogo en línea:", e);
      mostrarAvisoGlobal("No se pudo crear el registro. Verifique su conexión a internet.", "error");
    }
  }

  function seleccionar(nombre, id) {
    inputEl.value = nombre;
    valorSeleccionado = { nombre, id };
    listaEl.style.display = "none";
    listaEl.innerHTML = "";
    if (onSeleccion) onSeleccion(nombre, id);
  }

  inputEl.addEventListener("input", () => {
    valorSeleccionado = null;
    render(inputEl.value);
  });
  inputEl.addEventListener("focus", () => render(inputEl.value));
  document.addEventListener("click", (e) => {
    if (!listaEl.contains(e.target) && e.target !== inputEl) listaEl.style.display = "none";
  });

  return {
    obtenerSeleccion: () => valorSeleccionado,
    obtenerTexto: () => inputEl.value.trim()
  };
}

/**
 * Autocompletar de solo-lectura sobre puntos de norma (el inspector solo
 * sugiere; no puede crear cláusulas nuevas). Cada opción muestra
 * "NORMA cláusula - descripción corta".
 */
function crearAutocompletarPuntoNorma({ inputEl, listaEl, onSeleccion }) {
  let opciones = [];
  colPuntosNorma.where("activo", "!=", false).onSnapshot((snap) => {
    opciones = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }, () => {
    colPuntosNorma.onSnapshot((snap) => {
      opciones = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((d) => d.activo !== false);
    });
  });

  function etiquetaDe(o) { return `${o.norma} ${o.clausula} — ${o.descripcion}`; }
  function normalizar(t) { return (t || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, ""); }

  function render(texto) {
    const q = normalizar(texto);
    listaEl.innerHTML = "";
    if (!q) { listaEl.style.display = "none"; return; }
    const coincidencias = opciones.filter((o) => normalizar(etiquetaDe(o)).includes(q)).slice(0, 8);
    coincidencias.forEach((o) => {
      const div = document.createElement("div");
      div.className = "opcion";
      div.textContent = etiquetaDe(o);
      div.onclick = () => {
        inputEl.value = etiquetaDe(o);
        listaEl.style.display = "none";
        if (onSeleccion) onSeleccion(o.id, etiquetaDe(o));
      };
      listaEl.appendChild(div);
    });
    listaEl.style.display = coincidencias.length ? "block" : "none";
  }

  inputEl.addEventListener("input", () => { render(inputEl.value); if (onSeleccion) onSeleccion(null, inputEl.value); });
  inputEl.addEventListener("focus", () => render(inputEl.value));
  document.addEventListener("click", (e) => {
    if (!listaEl.contains(e.target) && e.target !== inputEl) listaEl.style.display = "none";
  });
}

// ---------------------------------------------------------------------------
// GEOLOCALIZACIÓN
// ---------------------------------------------------------------------------
function capturarGPS() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve({ gps: null, error: "Este dispositivo/navegador no soporta geolocalización." });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ gps: { lat: pos.coords.latitude, lng: pos.coords.longitude }, error: null }),
      (err) => {
        let msj = "No se pudo obtener la ubicación GPS.";
        if (err.code === err.PERMISSION_DENIED) msj = "Permiso de ubicación denegado. Puede continuar sin GPS usando el plano.";
        resolve({ gps: null, error: msj });
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  });
}

// ---------------------------------------------------------------------------
// PLANO REAL (imagen) INTERACTIVO - carga, tamaño configurable y captura de tap
// ---------------------------------------------------------------------------

/** Ruta de la imagen del plano real, ajustada según la profundidad de carpetas. */
function rutaPlanoImagenPlanta() {
  const rutaBase = window.location.pathname.includes("/admin/") ? "../" : "";
  return rutaBase + "assets/plano-planta-real.png";
}

/** Relación ancho/alto configurada por el admin para mostrar el plano (por
 * defecto, la relación natural de la imagen). Permite "estirarla" a gusto,
 * de forma independiente en ancho y alto, como una imagen en Word. */
async function obtenerTamanoPlanoReporte() {
  try {
    const doc = await colConfiguracion.doc("planoReporte").get();
    if (doc.exists) {
      const datos = doc.data();
      if (datos.ancho > 0 && datos.alto > 0) return { ancho: datos.ancho, alto: datos.alto };
    }
  } catch (err) {
    console.warn("No se pudo leer el tamaño configurado del plano:", err.message);
  }
  return { ancho: 2200, alto: 1555 };
}

async function guardarTamanoPlanoReporte(ancho, alto, uidAdmin) {
  return colConfiguracion.doc("planoReporte").set({
    ancho, alto, actualizadoPor: uidAdmin, actualizadoEn: firebase.firestore.FieldValue.serverTimestamp()
  });
}

/**
 * Carga el plano real de la planta (imagen) dentro de contenedorEl, respetando
 * la relación ancho/alto configurada por el admin. Devuelve el elemento "marco"
 * sobre el cual se detectan los toques y se dibujan los puntos.
 */
async function cargarPlanoImagenReal(contenedorEl) {
  const tamano = await obtenerTamanoPlanoReporte();
  contenedorEl.innerHTML = `
    <div class="plano-real-marco" style="aspect-ratio:${tamano.ancho}/${tamano.alto};">
      <img src="${rutaPlanoImagenPlanta()}" class="plano-real-img" alt="Plano de distribución de áreas por proceso COGUSA">
      <div class="plano-real-capa-puntos"></div>
    </div>
  `;
  const marco = contenedorEl.querySelector(".plano-real-marco");
  habilitarZoomPlano(marco);
  return marco;
}

/**
 * Zoom y desplazamiento del plano dentro de su propio recuadro:
 * - Botones +/− y "ver completo" (esquina superior derecha).
 * - Rueda del mouse en computadora.
 * - Pellizco con dos dedos y arrastre con un dedo (cuando está ampliado) en celular/tablet.
 * El estado queda en marcoEl._zoomPlano para que otras funciones (auto-enfoque
 * por GPS, selección de punto) puedan consultarlo.
 */
function habilitarZoomPlano(marcoEl) {
  const contenedor = marcoEl.parentElement;
  const estado = { escala: 1, tx: 0, ty: 0, huboArrastre: false };
  marcoEl._zoomPlano = estado;
  marcoEl.style.transformOrigin = "0 0";
  contenedor.style.position = "relative";

  function aplicar() {
    if (estado.escala <= 1.001) { estado.escala = 1; estado.tx = 0; estado.ty = 0; }
    const w = contenedor.clientWidth, h = marcoEl.offsetHeight;
    estado.tx = Math.min(0, Math.max(w - estado.escala * w, estado.tx));
    estado.ty = Math.min(0, Math.max(h - estado.escala * h, estado.ty));
    marcoEl.style.transform = `translate(${estado.tx}px, ${estado.ty}px) scale(${estado.escala})`;
    marcoEl.style.setProperty("--zoom", estado.escala);
    // Con zoom, el navegador no debe interceptar los gestos táctiles (los usa
    // el pan/pinza); sin zoom, se permite el scroll vertical normal de la página.
    contenedor.style.touchAction = estado.escala > 1 ? "none" : "pan-y";
  }
  estado.aplicar = aplicar;

  /** Acerca/aleja multiplicando la escala, manteniendo fijo el punto (cx,cy)
   * dado en píxeles relativos al recuadro visible. */
  function zoomHacia(factor, cx, cy) {
    const nueva = Math.min(6, Math.max(1, estado.escala * factor));
    const f = nueva / estado.escala;
    estado.tx = cx - f * (cx - estado.tx);
    estado.ty = cy - f * (cy - estado.ty);
    estado.escala = nueva;
    aplicar();
  }
  estado.zoomHacia = zoomHacia;

  const controles = document.createElement("div");
  controles.className = "plano-zoom-controles";
  controles.innerHTML = `
    <button type="button" data-accion="mas" aria-label="Acercar" title="Acercar">+</button>
    <button type="button" data-accion="menos" aria-label="Alejar" title="Alejar">−</button>
    <button type="button" data-accion="completo" aria-label="Ver plano completo" title="Ver plano completo">⛶</button>
  `;
  contenedor.appendChild(controles);
  controles.addEventListener("click", (e) => {
    const accion = e.target.closest("button")?.dataset.accion;
    if (!accion) return;
    e.stopPropagation();
    const w = contenedor.clientWidth, h = marcoEl.offsetHeight;
    if (accion === "mas") zoomHacia(1.4, w / 2, h / 2);
    if (accion === "menos") zoomHacia(1 / 1.4, w / 2, h / 2);
    if (accion === "completo") { estado.escala = 1; aplicar(); }
  });

  contenedor.addEventListener("wheel", (e) => {
    e.preventDefault();
    const rect = contenedor.getBoundingClientRect();
    zoomHacia(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX - rect.left, e.clientY - rect.top);
  }, { passive: false });

  // Pan con un puntero (si hay zoom) y pinza con dos (Pointer Events cubre
  // mouse y táctil por igual). Si el dedo se movió, se marca huboArrastre para
  // que el click posterior NO se interprete como "marcar punto".
  const punteros = new Map();
  let distanciaPinza = null;
  contenedor.addEventListener("pointerdown", (e) => {
    if (e.target.closest(".plano-zoom-controles")) return;
    punteros.set(e.pointerId, { x: e.clientX, y: e.clientY });
    estado.huboArrastre = false;
    if (punteros.size === 2) {
      const [a, b] = [...punteros.values()];
      distanciaPinza = Math.hypot(a.x - b.x, a.y - b.y);
    }
    contenedor.setPointerCapture(e.pointerId);
  });
  contenedor.addEventListener("pointermove", (e) => {
    const previo = punteros.get(e.pointerId);
    if (!previo) return;
    const actual = { x: e.clientX, y: e.clientY };
    punteros.set(e.pointerId, actual);

    if (punteros.size === 2 && distanciaPinza) {
      const [a, b] = [...punteros.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (dist > 0) {
        const rect = contenedor.getBoundingClientRect();
        zoomHacia(dist / distanciaPinza, (a.x + b.x) / 2 - rect.left, (a.y + b.y) / 2 - rect.top);
        distanciaPinza = dist;
        estado.huboArrastre = true;
      }
    } else if (punteros.size === 1 && estado.escala > 1) {
      const dx = actual.x - previo.x, dy = actual.y - previo.y;
      if (Math.abs(dx) + Math.abs(dy) > 2) estado.huboArrastre = true;
      estado.tx += dx;
      estado.ty += dy;
      aplicar();
    }
  });
  const soltarPuntero = (e) => { punteros.delete(e.pointerId); distanciaPinza = null; };
  contenedor.addEventListener("pointerup", soltarPuntero);
  contenedor.addEventListener("pointercancel", soltarPuntero);

  aplicar();
}

/**
 * Acerca el plano automáticamente alrededor de un punto (porcentaje 0-100),
 * dejándolo centrado en el recuadro. Se usa cuando el GPS marca el pin solo.
 */
function enfocarPuntoPlano(marcoEl, punto, escala = 2.2) {
  const estado = marcoEl._zoomPlano;
  if (!estado) return;
  const contenedor = marcoEl.parentElement;
  const w = contenedor.clientWidth, h = marcoEl.offsetHeight;
  estado.escala = Math.min(6, Math.max(1, escala));
  estado.tx = w / 2 - estado.escala * (punto.x / 100) * w;
  estado.ty = h / 2 - estado.escala * (punto.y / 100) * h;
  estado.aplicar();
}

/**
 * Dibuja el pin de ubicación (estilo "gota" de mapa) sobre el plano real, en
 * el punto dado como porcentaje (0-100) del ancho/alto. Reemplaza cualquier
 * pin anterior: en el flujo de reporte solo existe UN punto de hallazgo.
 */
function marcarPinEnPlano(marcoEl, punto) {
  const capa = marcoEl.querySelector(".plano-real-capa-puntos");
  capa.innerHTML = "";
  const pin = document.createElement("div");
  pin.className = "pin-plano";
  pin.style.left = punto.x + "%";
  pin.style.top = punto.y + "%";
  pin.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M12 1.5a7.5 7.5 0 0 0-7.5 7.5c0 5.4 6.2 12.3 6.9 13.1a.8.8 0 0 0 1.2 0c.7-.8 6.9-7.7 6.9-13.1A7.5 7.5 0 0 0 12 1.5z"/><circle cx="12" cy="9" r="2.8" fill="#fff"/></svg>`;
  capa.appendChild(pin);
}

/**
 * Habilita tocar/hacer clic sobre el plano real para elegir el punto exacto
 * del hallazgo. Las coordenadas se guardan como porcentaje (0-100) del ancho y
 * alto mostrados, para que sigan siendo válidas sin importar el tamaño de
 * pantalla o la relación ancho/alto que haya configurado el admin.
 */
function habilitarSeleccionPuntoPlanoReal(marcoEl, onPuntoElegido) {
  marcoEl.addEventListener("click", (evt) => {
    // Si el gesto fue un arrastre/pinza de zoom, no es una selección de punto.
    if (marcoEl._zoomPlano && marcoEl._zoomPlano.huboArrastre) return;
    const rect = marcoEl.getBoundingClientRect();
    const x = Math.round(((evt.clientX - rect.left) / rect.width) * 1000) / 10;
    const y = Math.round(((evt.clientY - rect.top) / rect.height) * 1000) / 10;
    marcarPinEnPlano(marcoEl, { x, y });
    onPuntoElegido({ x, y });
  });
}

// ---------------------------------------------------------------------------
// GPS → PUNTO EN EL PLANO
// Usa la calibración hecha por el admin en Catálogos → Ubicación de planta
// (las 4 esquinas lat/lng del plano montado sobre el mapa real, guardadas en
// configuracion/planoImagen) para convertir una coordenada GPS en su posición
// equivalente dentro de la imagen del plano de distribución.
// ---------------------------------------------------------------------------

/** Lee las 4 esquinas calibradas del plano ([NO, NE, SO, SE] en lat/lng). */
async function obtenerEsquinasPlanoGPS() {
  try {
    const doc = await colConfiguracion.doc("planoImagen").get();
    const datos = doc.data();
    if (doc.exists && Array.isArray(datos.corners) && datos.corners.length === 4) {
      return datos.corners;
    }
  } catch (err) {
    console.warn("No se pudo leer la calibración del plano:", err.message);
  }
  return null;
}

/**
 * Convierte una coordenada GPS a porcentaje (0-100) dentro del plano,
 * resolviendo la posición relativa respecto a los ejes de la imagen
 * (esquina NO→NE = eje X, esquina NO→SO = eje Y). Funciona aunque el plano
 * esté rotado o escalado. Devuelve null si el punto cae fuera del plano.
 */
function gpsAPuntoPlano(gps, corners) {
  // Coordenadas planas locales: la longitud se corrige por la latitud para
  // que 1 unidad valga lo mismo en ambos ejes (aprox. válido a escala de planta).
  const cosLat = Math.cos((corners[0].lat * Math.PI) / 180);
  const aX = (p) => (p.lng - corners[0].lng) * cosLat;
  const aY = (p) => (p.lat - corners[0].lat);
  const e1 = { x: aX(corners[1]), y: aY(corners[1]) }; // NO → NE (ancho de la imagen)
  const e2 = { x: aX(corners[2]), y: aY(corners[2]) }; // NO → SO (alto de la imagen)
  const p = { x: aX(gps), y: aY(gps) };

  const det = e1.x * e2.y - e1.y * e2.x;
  if (!det) return null;
  const u = (p.x * e2.y - p.y * e2.x) / det;
  const v = (e1.x * p.y - e1.y * p.x) / det;
  if (u < 0 || u > 1 || v < 0 || v > 1) return null;

  return { x: Math.round(u * 1000) / 10, y: Math.round(v * 1000) / 10 };
}

// ---------------------------------------------------------------------------
// UTILIDADES DE FORMATO
// ---------------------------------------------------------------------------
function formatearFechaHora(timestamp) {
  if (!timestamp) return "";
  const d = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  return d.toLocaleString("es-GT", { dateStyle: "medium", timeStyle: "short" });
}

function claseGravedad(g) {
  return { "Crítico": "critico", "Mayor": "mayor", "Menor": "menor", "Observación": "observacion" }[g] || "observacion";
}

// ---------------------------------------------------------------------------
// AVISOS FLOTANTES (reemplazan a alert()/confirm(), que bloquean la página
// y dan mala experiencia, especialmente en el flujo mobile-first)
// ---------------------------------------------------------------------------
function mostrarAvisoGlobal(mensaje, tipo = "info") {
  let contenedor = document.getElementById("aviso-flotante-global");
  if (!contenedor) {
    contenedor = document.createElement("div");
    contenedor.id = "aviso-flotante-global";
    contenedor.style.cssText = "position:fixed; top:16px; left:50%; transform:translateX(-50%); z-index:300; max-width:92%; width:420px;";
    document.body.appendChild(contenedor);
  }
  const aviso = document.createElement("div");
  aviso.className = "aviso aviso-" + tipo;
  aviso.style.cssText = "box-shadow:0 4px 14px rgba(0,0,0,0.25); margin-bottom:8px;";
  aviso.textContent = mensaje;
  contenedor.appendChild(aviso);
  setTimeout(() => aviso.remove(), 5000);
}
