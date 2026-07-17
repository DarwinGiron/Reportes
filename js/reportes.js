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
//   categoria: string|null,             // lista cerrada gestionada en Configuraciones
//   puntoNormaId: string|null, puntoNormaTexto: string|null, // LEGADO: solo en reportes creados antes de "categoria"
//   fotos: [string,...],                // URLs de Cloudinary (1 a 3)
//   gps: { lat: number, lng: number } | null,
//   gpsError: string | null,
//   planoPunto: { x: number, y: number } | null, // porcentaje (0-100) del ancho/alto mostrado del plano real
//   estado: "pendiente" | "validado",
//   gravedad: "Crítico"|"Mayor"|"Menor"|"Observación" | null,
//   noAplicaNorma: boolean,
//   validadoPor: string|null, validadoPorNombre: string|null, fechaValidacion: Timestamp|null,
//   historialValidacion: [{ uid, nombre, fecha, cambios }],
//   cambioSinVer: boolean,               // true si el admin corrigió/validó y el inspector no lo ha visto
//   ultimoCambioAdmin: { uid, nombre, fecha: Timestamp, mensaje: string|null,
//     campos: [{ etiqueta, antes, despues, cambio: boolean },...], ubicacionCorregida: boolean } | null,
//   creadoEn: Timestamp
// }
// ============================================================================

// ---------------------------------------------------------------------------
// SELECT DE PROCESOS (lista cerrada, gestionada por el admin en Configuraciones)
// ---------------------------------------------------------------------------
/**
 * Llena un <select> con los procesos activos (orden alfabético). Si se pasa
 * procesoActual y ya no existe entre los activos (proceso desactivado o
 * renombrado), se agrega como opción adicional marcada "(histórico)" para no
 * perder el valor guardado en un reporte existente.
 */
async function poblarSelectProcesos(selectEl, procesoActual) {
  const snap = await colProcesos.get();
  const procesos = snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((p) => p.activo !== false)
    .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));

  selectEl.innerHTML = '<option value="">-- Seleccione --</option>';
  procesos.forEach((p) => {
    const opt = document.createElement("option");
    opt.value = p.nombre;
    opt.dataset.id = p.id;
    opt.textContent = p.nombre;
    selectEl.appendChild(opt);
  });

  if (procesoActual && !procesos.some((p) => p.nombre === procesoActual)) {
    const opt = document.createElement("option");
    opt.value = procesoActual;
    opt.textContent = procesoActual + " (histórico)";
    selectEl.appendChild(opt);
  }
  if (procesoActual) selectEl.value = procesoActual;
}

/**
 * Llena un <select> con las categorías activas (orden alfabético). Reemplaza
 * al antiguo "punto de norma"; misma lógica de opción histórica que
 * poblarSelectProcesos para no perder el valor de reportes ya guardados.
 */
async function poblarSelectCategorias(selectEl, categoriaActual) {
  const snap = await colCategorias.get();
  const categorias = snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((c) => c.activo !== false)
    .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));

  selectEl.innerHTML = '<option value="">-- Seleccione --</option>';
  categorias.forEach((c) => {
    const opt = document.createElement("option");
    opt.value = c.nombre;
    opt.dataset.id = c.id;
    opt.textContent = c.nombre;
    selectEl.appendChild(opt);
  });

  if (categoriaActual && !categorias.some((c) => c.nombre === categoriaActual)) {
    const opt = document.createElement("option");
    opt.value = categoriaActual;
    opt.textContent = categoriaActual + " (histórico)";
    selectEl.appendChild(opt);
  }
  if (categoriaActual) selectEl.value = categoriaActual;
}

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


// ---------------------------------------------------------------------------
// GEOLOCALIZACIÓN
// ---------------------------------------------------------------------------

/**
 * Corrección de calibración del GPS configurada por el admin en
 * Catálogos → Ubicación de planta (diferencia entre donde el GPS ubica a la
 * persona y donde realmente está). Se suma a toda captura de GPS nueva.
 */
async function obtenerCalibracionGPS() {
  try {
    const doc = await colConfiguracion.doc("calibracionGPS").get();
    if (doc.exists) {
      const datos = doc.data();
      if (typeof datos.dLat === "number" && typeof datos.dLng === "number") {
        return { dLat: datos.dLat, dLng: datos.dLng };
      }
    }
  } catch (err) {
    console.warn("No se pudo leer la calibración del GPS:", err.message);
  }
  return null;
}

async function guardarCalibracionGPS(dLat, dLng, uidAdmin) {
  return colConfiguracion.doc("calibracionGPS").set({
    dLat, dLng, actualizadoPor: uidAdmin, actualizadoEn: firebase.firestore.FieldValue.serverTimestamp()
  });
}

/**
 * Captura la posición GPS cruda del dispositivo, sin aplicar calibración.
 * @param {boolean} altaPrecision Si es true, usa el modo de máxima precisión
 *   del GPS (más exacto pero consume bastante más batería, sobre todo en
 *   interiores con mala señal). Se deja en true por defecto para las
 *   calibraciones del admin (uso ocasional, donde la exactitud importa más),
 *   y se pasa false explícitamente para el flujo normal de reportes de los
 *   inspectores (uso repetido muchas veces por turno).
 */
function capturarGPSCrudo(altaPrecision = true) {
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
      { enableHighAccuracy: altaPrecision, timeout: altaPrecision ? 10000 : 8000, maximumAge: 60000 }
    );
  });
}

/** Captura GPS para reportes: posición del dispositivo + calibración del
 * admin. Usa precisión normal (no alta) para cuidar la batería, ya que los
 * inspectores la usan muchas veces por turno y el plano permite corregir el
 * punto a mano si el GPS queda unos metros impreciso. */
async function capturarGPS() {
  const [resultado, calibracion] = await Promise.all([capturarGPSCrudo(false), obtenerCalibracionGPS()]);
  if (resultado.gps && calibracion) {
    resultado.gps = {
      lat: resultado.gps.lat + calibracion.dLat,
      lng: resultado.gps.lng + calibracion.dLng
    };
  }
  return resultado;
}

// ---------------------------------------------------------------------------
// PLANO REAL (imagen) INTERACTIVO - carga, tamaño configurable y captura de tap
// ---------------------------------------------------------------------------

/** Ruta de la imagen del plano real, ajustada según la profundidad de carpetas. */
/** Ruta del plano local por defecto (usado si el admin no ha subido uno propio). */
function rutaPlanoImagenPorDefecto() {
  const rutaBase = window.location.pathname.includes("/admin/") ? "../" : "";
  return rutaBase + "assets/plano-planta-real.png";
}

let _cachePlanoArchivo = null;
/**
 * URL de la imagen del plano a usar en todo el sistema: si el admin subió un
 * plano propio (PDF o imagen, convertido y alojado en Cloudinary desde
 * Configuraciones → Ubicación de planta), se usa esa URL; si no, el asset
 * local por defecto. Memoizado: solo se lee Firestore una vez por carga de
 * página (llamar a invalidarCachePlanoArchivo() tras guardar/quitar el plano).
 */
async function obtenerUrlPlanoPlanta() {
  if (_cachePlanoArchivo !== null) return _cachePlanoArchivo.url || rutaPlanoImagenPorDefecto();
  try {
    const doc = await colConfiguracion.doc("planoArchivo").get();
    _cachePlanoArchivo = doc.exists ? doc.data() : {};
  } catch (err) {
    console.warn("No se pudo leer el plano configurado:", err.message);
    _cachePlanoArchivo = {};
  }
  return _cachePlanoArchivo.url || rutaPlanoImagenPorDefecto();
}

function invalidarCachePlanoArchivo() {
  _cachePlanoArchivo = null;
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
  const [tamano, urlPlano] = await Promise.all([obtenerTamanoPlanoReporte(), obtenerUrlPlanoPlanta()]);
  contenedorEl.innerHTML = `
    <div class="plano-real-marco" style="aspect-ratio:${tamano.ancho}/${tamano.alto};">
      <img src="${urlPlano}" class="plano-real-img" alt="Plano de distribución de áreas por proceso COGUSA">
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
const ZOOM_MAXIMO_PLANO = 15; // antes 6; el plano ahora se sube hasta 3600px, alcanza para más detalle

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
    const nueva = Math.min(ZOOM_MAXIMO_PLANO, Math.max(1, estado.escala * factor));
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
      // Con 2 dedos siempre es un gesto de pinza: aquí sí conviene capturar
      // desde ya para no perder el segundo puntero si se mueve rápido.
      contenedor.setPointerCapture(e.pointerId);
    }
    // OJO: con un solo puntero NO se captura aquí. Si se captura en cada
    // pointerdown (incluyendo un simple toque sin arrastre), Chrome/Edge
    // reasignan el "click" resultante al contenedor en vez de al plano,
    // y el toque para marcar un punto deja de funcionar por completo. Solo
    // se captura más abajo, en pointermove, si de verdad hay arrastre.
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
      if (Math.abs(dx) + Math.abs(dy) > 2) {
        if (!estado.huboArrastre) contenedor.setPointerCapture(e.pointerId);
        estado.huboArrastre = true;
      }
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
  estado.escala = Math.min(ZOOM_MAXIMO_PLANO, Math.max(1, escala));
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
 * Guarda la calibración del plano: las 4 esquinas derivadas Y los puntos de
 * referencia originales con los que se calculó (para poder mostrarlos de
 * nuevo al recargar, auditar la calibración activa y reajustarla sin
 * empezar de cero).
 */
async function guardarEsquinasPlanoGPS(corners, uidAdmin, extras = {}) {
  return colConfiguracion.doc("planoImagen").set({
    corners: corners.map((c) => ({ lat: c.lat, lng: c.lng })),
    puntosReferencia: extras.puntosReferencia || null,
    errorMaximo: typeof extras.errorMaximo === "number" ? extras.errorMaximo : null,
    actualizadoPor: uidAdmin,
    actualizadoEn: firebase.firestore.FieldValue.serverTimestamp()
  });
}

// ---------------------------------------------------------------------------
// CALIBRACIÓN DEL PLANO POR PUNTOS DE REFERENCIA (3-4 puntos)
// En vez de arrastrar/rotar/escalar el plano a ojo sobre un mapa de calles,
// el admin marca N puntos conocidos en el plano y captura el GPS parado
// físicamente en cada uno. Con esos pares (plano, GPS) se ajusta por mínimos
// cuadrados una transformación afín plano→GPS, de la que se derivan las
// mismas "4 esquinas" que usa el resto del sistema (gpsAPuntoPlano,
// puntoPlanoAGPS), así que todo lo demás sigue funcionando sin cambios.
// ---------------------------------------------------------------------------

/** Resuelve el sistema 3x3 A·x = b por la regla de Cramer. */
function resolverSistema3x3(A, b) {
  const det3 = (m) =>
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);

  const d = det3(A);
  if (!d) return null;

  const conCol = (col) => A.map((fila, i) => fila.map((v, j) => (j === col ? b[i] : v)));
  return [det3(conCol(0)) / d, det3(conCol(1)) / d, det3(conCol(2)) / d];
}

/** Ajusta t ≈ a·u + b·v + c por mínimos cuadrados (ecuaciones normales). */
function ajustarPlanoAfin(puntosUV, valores) {
  let Suu = 0, Suv = 0, Su = 0, Svv = 0, Sv = 0, S1 = puntosUV.length;
  let Sut = 0, Svt = 0, St = 0;
  puntosUV.forEach(({ u, v }, i) => {
    const t = valores[i];
    Suu += u * u; Suv += u * v; Su += u;
    Svv += v * v; Sv += v;
    Sut += u * t; Svt += v * t; St += t;
  });
  const A = [[Suu, Suv, Su], [Suv, Svv, Sv], [Su, Sv, S1]];
  return resolverSistema3x3(A, [Sut, Svt, St]);
}

/**
 * A partir de puntos de referencia [{x, y, lat, lng}] (x,y en % 0-100 del
 * plano), calcula las 4 esquinas equivalentes [NO, NE, SO, SE] que produce
 * el mismo resultado que si se hubieran ajustado a mano. Requiere mínimo 3
 * puntos (con exactamente 3 el ajuste es exacto; con 4+ es mínimos cuadrados).
 * Devuelve también el error residual de cada punto, en metros, para mostrar
 * qué tan buena quedó la calibración.
 */
function ajustarEsquinasDesdeCorrespondencias(puntos) {
  if (puntos.length < 3) return null;
  const puntosUV = puntos.map((p) => ({ u: p.x / 100, v: p.y / 100 }));
  const coefLat = ajustarPlanoAfin(puntosUV, puntos.map((p) => p.lat));
  const coefLng = ajustarPlanoAfin(puntosUV, puntos.map((p) => p.lng));
  if (!coefLat || !coefLng) return null;

  const [a1, b1, c1] = coefLat, [a2, b2, c2] = coefLng;
  const enUV = (u, v) => ({ lat: a1 * u + b1 * v + c1, lng: a2 * u + b2 * v + c2 });
  const corners = [enUV(0, 0), enUV(1, 0), enUV(0, 1), enUV(1, 1)]; // NO, NE, SO, SE

  const cosLat = Math.cos((corners[0].lat * Math.PI) / 180);
  const distanciaMetros = (a, b) => {
    const dy = (b.lat - a.lat) * 111320;
    const dx = (b.lng - a.lng) * 111320 * cosLat;
    return Math.hypot(dx, dy);
  };
  const errores = puntos.map((p, i) => distanciaMetros(p, enUV(puntosUV[i].u, puntosUV[i].v)));

  return { corners, errores, errorMaximo: Math.max(...errores) };
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

/**
 * Inversa de gpsAPuntoPlano: dado un punto del plano (porcentaje 0-100),
 * devuelve la coordenada GPS que le correspondería según la calibración
 * (4 esquinas lat/lng). Es una combinación afín exacta, sin aproximaciones.
 */
function puntoPlanoAGPS(punto, corners) {
  const u = punto.x / 100, v = punto.y / 100;
  return {
    lat: corners[0].lat + u * (corners[1].lat - corners[0].lat) + v * (corners[2].lat - corners[0].lat),
    lng: corners[0].lng + u * (corners[1].lng - corners[0].lng) + v * (corners[2].lng - corners[0].lng)
  };
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

/** Texto de categoría a mostrar, con respaldo para reportes creados antes de
 * que existiera el campo "categoria" (usaban "punto de norma" en su lugar). */
function textoCategoria(r) {
  return r.categoria || r.puntoNormaTexto || "Sin categoría";
}

/**
 * Compara el reporte original contra los cambios que el admin está por
 * guardar en Validación, y devuelve una lista de descripciones en español
 * de lo que cambió (para mostrarle al inspector como retroalimentación).
 * No incluye gps/planoPunto en el texto (solo un aviso genérico), porque las
 * coordenadas exactas no le dicen nada útil al inspector.
 */
/**
 * Arma una comparación campo por campo entre lo que el inspector registró
 * originalmente y lo que el admin dejó al validar, para mostrarla como
 * tabla "cómo lo registraste tú" vs "cómo quedó" (no como una simple lista
 * de texto). Cada fila indica si ese campo específico cambió, para
 * resaltarlo en la vista del inspector.
 */
function construirComparacionCambios(original, cambios) {
  const distinto = (a, b) => (a || null) !== (b || null);
  // La gravedad NO se incluye: es un campo que solo asigna el coordinador
  // (el inspector nunca la llena), así que no es una "corrección" de lo que
  // él registró — no debe generar el aviso de retroalimentación por sí sola.
  const campos = [
    { etiqueta: "Turno", antes: original.turno || "Sin especificar", despues: cambios.turno || "Sin especificar" },
    { etiqueta: "Zona", antes: original.zona, despues: cambios.zona },
    { etiqueta: "Proceso", antes: original.proceso, despues: cambios.proceso },
    { etiqueta: "Categoría", antes: textoCategoria(original), despues: cambios.categoria || "Sin categoría" }
  ].map((c) => ({ ...c, cambio: distinto(c.antes, c.despues) }));

  const gpsOriginal = original.gps ? `${original.gps.lat.toFixed(5)},${original.gps.lng.toFixed(5)}` : null;
  const gpsNuevo = cambios.gps ? `${cambios.gps.lat.toFixed(5)},${cambios.gps.lng.toFixed(5)}` : null;
  const ubicacionCorregida = gpsOriginal !== gpsNuevo;

  return { campos, ubicacionCorregida, hayDiferencias: campos.some((c) => c.cambio) || ubicacionCorregida };
}

// ---------------------------------------------------------------------------
// CAMPANA DE NOTIFICACIONES DEL ADMIN (reportes pendientes de validar).
// Se inyecta en el nav de cada página admin (antes del botón "Salir") para no
// duplicar el marcado en los 4 HTML de admin/. Se llama una vez desde el
// protegerPagina(...) de cada página.
// ---------------------------------------------------------------------------
function inicializarCampanaAdmin() {
  const btnSalir = document.querySelector(".btn-salir");
  if (!btnSalir || document.getElementById("btn-campana-admin")) return;

  const wrapper = document.createElement("div");
  wrapper.className = "campana-contenedor";
  wrapper.innerHTML = `
    <button class="btn-campana" id="btn-campana-admin" type="button" aria-label="Notificaciones">
      <svg class="icono" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
      <span class="campana-badge" id="campana-badge-admin" style="display:none;">0</span>
    </button>
    <div class="campana-panel" id="campana-panel-admin" style="display:none;"></div>
  `;
  btnSalir.parentElement.insertBefore(wrapper, btnSalir);

  colReportes.where("estado", "==", "pendiente").orderBy("creadoEn", "desc").onSnapshot((snap) => {
    renderizarCampanaAdmin(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  }, (err) => console.warn("No se pudo cargar la campana de admin:", err.message));

  document.getElementById("btn-campana-admin").addEventListener("click", (e) => {
    e.stopPropagation();
    const btn = document.getElementById("btn-campana-admin");
    const panel = document.getElementById("campana-panel-admin");
    if (panel.style.display === "none") {
      const rect = btn.getBoundingClientRect();
      panel.style.top = (rect.bottom + 8) + "px";
      panel.style.right = (window.innerWidth - rect.right) + "px";
      panel.style.display = "block";
    } else {
      panel.style.display = "none";
    }
  });
  document.addEventListener("click", (e) => {
    const panel = document.getElementById("campana-panel-admin");
    const btn = document.getElementById("btn-campana-admin");
    if (panel && panel.style.display !== "none" && !panel.contains(e.target) && !btn.contains(e.target)) {
      panel.style.display = "none";
    }
  });
}

function renderizarCampanaAdmin(reportes) {
  const badge = document.getElementById("campana-badge-admin");
  const panel = document.getElementById("campana-panel-admin");
  if (!badge || !panel) return;
  const n = reportes.length;
  badge.style.display = n ? "inline-flex" : "none";
  badge.textContent = n;

  if (!n) {
    panel.innerHTML = `<p class="ayuda" style="padding:12px; margin:0;">No hay reportes pendientes de validar.</p>`;
    return;
  }
  const rutaValidacion = window.location.pathname.includes("/admin/") ? "validacion.html" : "admin/validacion.html";
  const visibles = reportes.slice(0, 8);
  panel.innerHTML = visibles.map((r) => `
    <a class="campana-item" href="${rutaValidacion}">
      <p>Nuevo reporte de <strong>${r.zona}</strong> (${r.inspectorNombre || "Inspector"}) del día ${formatearFechaHora(r.fechaHora)}.</p>
    </a>
  `).join("") + (n > visibles.length ? `<p class="ayuda" style="padding:8px 14px; margin:0;">y ${n - visibles.length} más...</p>` : "");
}

// ---------------------------------------------------------------------------
// CAMPANA DE NOTIFICACIONES DEL INSPECTOR (avisos de cambios del admin en SUS
// propios reportes). Se usa en inspector.html y reportes.html — 2 páginas
// reales distintas, por eso vive aquí compartida en vez de repetirse en cada
// una. El botón/panel (#btn-campana / #campana-panel) sí está declarado en
// el HTML de cada página, solo la lógica de datos y apertura/cierre es común.
// ---------------------------------------------------------------------------
function inicializarCampanaInspector(uid) {
  const btn = document.getElementById("btn-campana");
  const panel = document.getElementById("campana-panel");
  if (!btn || !panel) return;

  colReportes.where("inspectorUid", "==", uid).where("cambioSinVer", "==", true)
    .onSnapshot((snap) => {
      renderizarCampanaInspector(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    }, (err) => console.warn("No se pudo cargar la campana:", err.message));

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (panel.style.display === "none") {
      const rect = btn.getBoundingClientRect();
      panel.style.top = (rect.bottom + 8) + "px";
      panel.style.right = (window.innerWidth - rect.right) + "px";
      panel.style.display = "block";
    } else {
      panel.style.display = "none";
    }
  });
  document.addEventListener("click", (e) => {
    if (panel.style.display !== "none" && !panel.contains(e.target) && !btn.contains(e.target)) {
      panel.style.display = "none";
    }
  });
}

function renderizarCampanaInspector(reportes) {
  const badge = document.getElementById("campana-badge");
  const panel = document.getElementById("campana-panel");
  const n = reportes.length;
  badge.style.display = n ? "inline-flex" : "none";
  badge.textContent = n;

  if (!n) {
    panel.innerHTML = `<p class="ayuda" style="padding:12px; margin:0;">No tiene avisos nuevos.</p>`;
    return;
  }
  panel.innerHTML = reportes.map((r) => `
    <a class="campana-item" href="reportes.html#reporte-${r.id}" data-id="${r.id}">
      <p>${(r.ultimoCambioAdmin?.nombre || "El coordinador SGI")} modificó el reporte de <strong>${r.zona}</strong> del día ${formatearFechaHora(r.fechaHora)}.</p>
    </a>
  `).join("");
  panel.querySelectorAll("a[data-id]").forEach((a) => {
    a.addEventListener("click", () => {
      colReportes.doc(a.dataset.id).update({ cambioSinVer: false })
        .catch((err) => console.error("No se pudo marcar el aviso como visto:", err));
    });
  });
}

// ---------------------------------------------------------------------------
// REPORTES: suscripción a los reportes propios del inspector + lista con
// vista previa y estado del hallazgo. El detalle de qué corrigió el admin
// (campo por campo) se muestra inline en el modal de reportes.html.
// ---------------------------------------------------------------------------
function suscribirReportesPropios(uid, callback, onError) {
  return colReportes.where("inspectorUid", "==", uid).onSnapshot((snap) => {
    // Se ordena en el cliente (no con .orderBy en la consulta) para no
    // depender de un índice compuesto de Firestore.
    const reportes = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.creadoEn?.toMillis?.() || 0) - (a.creadoEn?.toMillis?.() || 0));
    callback(reportes);
  }, onError);
}

const ETIQUETAS_ESTADO_HALLAZGO = { abierto: "Abierto", en_proceso: "En proceso", corregido: "Corregido" };

function renderizarListaReportes(reportesPropios, alClic) {
  const cont = document.getElementById("lista-reportes");
  if (!reportesPropios.length) {
    cont.innerHTML = `<p class="ayuda">Todavía no tiene reportes registrados.</p>`;
    return;
  }

  cont.innerHTML = reportesPropios.map((r) => {
    const estadoHallazgo = r.estadoHallazgo || "abierto";
    return `
      <div class="tarjeta tarjeta-reporte" data-id="${r.id}" style="cursor:pointer;">
        <div class="foto-portada">
          ${r.fotos && r.fotos[0] ? `<img src="${r.fotos[0]}">` : ""}
          ${r.gravedad ? `<span class="etiqueta-gravedad ${claseGravedad(r.gravedad)}">${r.gravedad}</span>` : ""}
        </div>
        <div class="cuerpo">
          <h3>${r.zona} — ${r.proceso}</h3>
          <p>${(r.descripcion || "").slice(0, 90)}${r.descripcion && r.descripcion.length > 90 ? "..." : ""}</p>
          <div class="meta"><p>${formatearFechaHora(r.fechaHora)}${r.turno ? " · " + r.turno : ""}</p></div>
          <div class="meta"><span class="etiqueta-hallazgo ${estadoHallazgo}">${ETIQUETAS_ESTADO_HALLAZGO[estadoHallazgo]}</span></div>
        </div>
      </div>
    `;
  }).join("");

  cont.querySelectorAll(".tarjeta-reporte").forEach((el) => {
    el.addEventListener("click", () => alClic(reportesPropios.find((r) => r.id === el.dataset.id)));
  });
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
