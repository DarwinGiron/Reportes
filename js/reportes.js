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
  return contenedorEl.querySelector(".plano-real-marco");
}

/**
 * Habilita tocar/hacer clic sobre el plano real para elegir el punto exacto
 * del hallazgo. Las coordenadas se guardan como porcentaje (0-100) del ancho y
 * alto mostrados, para que sigan siendo válidas sin importar el tamaño de
 * pantalla o la relación ancho/alto que haya configurado el admin.
 */
function habilitarSeleccionPuntoPlanoReal(marcoEl, onPuntoElegido) {
  const capa = marcoEl.querySelector(".plano-real-capa-puntos");
  marcoEl.addEventListener("click", (evt) => {
    const rect = marcoEl.getBoundingClientRect();
    const x = Math.round(((evt.clientX - rect.left) / rect.width) * 1000) / 10;
    const y = Math.round(((evt.clientY - rect.top) / rect.height) * 1000) / 10;

    capa.innerHTML = "";
    const marcador = document.createElement("div");
    marcador.className = "punto-seleccion-actual-real";
    marcador.style.left = x + "%";
    marcador.style.top = y + "%";
    capa.appendChild(marcador);

    onPuntoElegido({ x, y });
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
