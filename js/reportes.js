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
//   planoPunto: { x: number, y: number } | null, // coordenadas 0-1000 / 0-600
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
// PLANO SVG INTERACTIVO - carga y captura de clic
// ---------------------------------------------------------------------------
async function cargarPlanoSVG(contenedorEl) {
  // Ruta relativa a la raíz del sitio: se ajusta sola si la página que
  // llama a esta función vive dentro de /admin/ (una carpeta más profunda).
  const rutaBase = window.location.pathname.includes("/admin/") ? "../" : "";
  const resp = await fetch(rutaBase + "assets/plano-planta.svg");
  const texto = await resp.text();
  contenedorEl.innerHTML = texto;
  return contenedorEl.querySelector("svg");
}

/**
 * Habilita clic/touch sobre el plano para elegir el punto exacto del hallazgo.
 * Devuelve las coordenadas en el sistema de referencia del viewBox (0-1000, 0-600).
 */
function habilitarSeleccionPuntoPlano(svgEl, onPuntoElegido) {
  const capa = svgEl.querySelector("#capa-puntos");
  svgEl.addEventListener("click", (evt) => {
    const pt = svgEl.createSVGPoint();
    pt.x = evt.clientX;
    pt.y = evt.clientY;
    const ctm = svgEl.getScreenCTM().inverse();
    const puntoTransformado = pt.matrixTransform(ctm);
    const x = Math.round(puntoTransformado.x);
    const y = Math.round(puntoTransformado.y);

    capa.innerHTML = "";
    const circulo = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circulo.setAttribute("cx", x);
    circulo.setAttribute("cy", y);
    circulo.setAttribute("r", 10);
    circulo.setAttribute("class", "punto-seleccion-actual");
    capa.appendChild(circulo);

    // Detecta en qué zona cayó el punto (para autocompletar la zona si aún no se eligió)
    const elementoDebajo = document.elementFromPoint(evt.clientX, evt.clientY);
    const zonaId = elementoDebajo && elementoDebajo.closest ? elementoDebajo.closest(".zona-poligono")?.dataset.zonaId : null;

    onPuntoElegido({ x, y }, zonaId || null);
  });
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
