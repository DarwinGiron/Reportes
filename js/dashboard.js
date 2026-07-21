// ============================================================================
// DASHBOARD.JS - Estadísticas, gráficas y mapas de calor del panel admin
// ============================================================================
// CRITERIO DE AGRUPACIÓN PARA "HALLAZGOS MÁS REPETITIVOS":
// Se agrupa por la combinación exacta (normalizada: minúsculas, sin acentos,
// sin espacios sobrantes) de Zona + Proceso + Punto de norma. Esta combinación
// es un buen proxy de "mismo tipo de hallazgo recurrente" porque en una
// planta de manufactura los hallazgos repetidos casi siempre ocurren en la
// misma zona, durante el mismo proceso y contra la misma cláusula de norma
// (p.ej. "Bodega MP / Recepción / ISO22002-4 cláusula 4.3" aparece una y otra
// vez si hay un problema estructural no resuelto). No se agrupa por texto
// libre de la descripción porque cada inspector redacta distinto y eso
// generaría falsos grupos o falsos negativos.
// ============================================================================

let mapaLeaflet = null;
let capaMarcadoresLeaflet = null;
let chartsActivos = {}; // referencia a instancias Chart.js para poder destruirlas al refiltrar

// Defaults del tema oscuro/dorado (css/tema-dorado.css): sin esto, Chart.js
// dibuja texto y líneas de grid oscuros por defecto, invisibles sobre el
// fondo casi negro. Solo dashboard.html carga Chart.js, así que es seguro
// fijarlo aquí de forma global.
if (typeof Chart !== "undefined") {
  Chart.defaults.color = "#A9A79A";
  Chart.defaults.borderColor = "rgba(212,175,55,0.14)";
  Chart.defaults.font.family = "'Manrope', sans-serif";
}

// normalizarClave() vive en reportes.js (compartida con los filtros de
// reportes.html) — reportes.js siempre se carga antes que este archivo.

/** Trae los reportes validados dentro de un rango de fechas [desde, hasta]. */
async function obtenerReportesValidados(desde, hasta) {
  const snap = await colReportes
    .where("estado", "==", "validado")
    .where("fechaHora", ">=", firebase.firestore.Timestamp.fromDate(desde))
    .where("fechaHora", "<=", firebase.firestore.Timestamp.fromDate(hasta))
    .get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/** Trae TODOS los reportes (para el KPI pendientes vs validados) del rango. */
async function obtenerTodosReportesRango(desde, hasta) {
  const snap = await colReportes
    .where("fechaHora", ">=", firebase.firestore.Timestamp.fromDate(desde))
    .where("fechaHora", "<=", firebase.firestore.Timestamp.fromDate(hasta))
    .get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// ---------------------------------------------------------------------------
// KPIs
// ---------------------------------------------------------------------------
function calcularKPIs(todos) {
  const pendientes = todos.filter((r) => r.estado === "pendiente").length;
  const validados = todos.filter((r) => r.estado === "validado").length;
  return { total: todos.length, pendientes, validados };
}

// ---------------------------------------------------------------------------
// AGRUPACIÓN COMPARTIDA POR ZONA+PROCESO+CATEGORÍA (usada por el top de
// repetitivos, el top de riesgo, y la tasa de reincidencia)
// ---------------------------------------------------------------------------
function agruparPorZonaProcesoCategoria(validados) {
  const grupos = {};
  validados.forEach((r) => {
    const categoria = textoCategoria(r);
    const clave = [normalizarClave(r.zona), normalizarClave(r.proceso), normalizarClave(categoria)].join(" | ");
    if (!grupos[clave]) {
      grupos[clave] = {
        zona: r.zona, proceso: r.proceso, categoria,
        cantidad: 0, gravedadMax: r.gravedad, pesoMax: PESO_GRAVEDAD[r.gravedad] || 0
      };
    }
    grupos[clave].cantidad++;
    const peso = PESO_GRAVEDAD[r.gravedad] || 0;
    if (peso > grupos[clave].pesoMax) { grupos[clave].pesoMax = peso; grupos[clave].gravedadMax = r.gravedad; }
  });
  return Object.values(grupos);
}

// ---------------------------------------------------------------------------
// TOP 10 HALLAZGOS MÁS REPETITIVOS (ver criterio arriba)
// ---------------------------------------------------------------------------
function calcularTopRepetitivos(validados) {
  return agruparPorZonaProcesoCategoria(validados)
    .sort((a, b) => b.cantidad - a.cantidad)
    .slice(0, 10);
}

// ---------------------------------------------------------------------------
// TASA DE CIERRE DE HALLAZGOS: % de reportes validados cuyo seguimiento
// propio del inspector (estadoHallazgo) ya quedó en "corregido". Es el
// indicador más directo de eficacia del sistema para una auditoría FSSC
// 22000 — no basta con validar el dato, hay que demostrar que el hallazgo
// físico se resolvió en planta.
// ---------------------------------------------------------------------------
function calcularTasaCierre(validados) {
  if (!validados.length) return { corregidos: 0, total: 0, tasa: 0 };
  const corregidos = validados.filter((r) => r.estadoHallazgo === "corregido").length;
  return { corregidos, total: validados.length, tasa: Math.round((corregidos / validados.length) * 100) };
}

// ---------------------------------------------------------------------------
// TASA DE REINCIDENCIA: % de combinaciones zona+proceso+categoría que se
// repitieron más de una vez en el período (mismo agrupamiento que el top de
// repetitivos, expresado como porcentaje sobre el total de combinaciones).
// ---------------------------------------------------------------------------
function calcularTasaReincidencia(validados) {
  const grupos = agruparPorZonaProcesoCategoria(validados);
  if (!grupos.length) return { reincidentes: 0, total: 0, tasa: 0 };
  const reincidentes = grupos.filter((g) => g.cantidad > 1).length;
  return { reincidentes, total: grupos.length, tasa: Math.round((reincidentes / grupos.length) * 100) };
}

// ---------------------------------------------------------------------------
// TIEMPO PROMEDIO DE VALIDACIÓN (días entre que el inspector crea el reporte
// y el coordinador lo valida). Mide la disciplina de revisión del propio SGI,
// no requiere campos nuevos: usa creadoEn y fechaValidacion, ya existentes.
// ---------------------------------------------------------------------------
function calcularTiempoPromedioValidacion(validados) {
  const conFechas = validados.filter((r) => r.creadoEn?.toMillis && r.fechaValidacion?.toMillis);
  if (!conFechas.length) return null;
  const totalDias = conFechas.reduce((suma, r) => {
    const dias = (r.fechaValidacion.toMillis() - r.creadoEn.toMillis()) / 86400000;
    return suma + Math.max(dias, 0);
  }, 0);
  return totalDias / conFechas.length;
}

// ---------------------------------------------------------------------------
// HALLAZGOS CRÍTICOS/MAYORES ABIERTOS: lista de "aging" con los hallazgos más
// graves que el inspector todavía no marca como corregidos, ordenados por
// antigüedad. Es lo primero que pide un auditor FSSC: demostrar que lo grave
// se atiende rápido, no que "algún día" se valida.
// ---------------------------------------------------------------------------
function calcularHallazgosAbiertosCriticos(todos) {
  const ahoraMs = Date.now();
  return todos
    .filter((r) => (r.gravedad === "Crítico" || r.gravedad === "Mayor") && r.estadoHallazgo !== "corregido")
    .map((r) => {
      const creadoMs = r.creadoEn?.toMillis ? r.creadoEn.toMillis() : ahoraMs;
      return { ...r, diasAbierto: Math.max(Math.floor((ahoraMs - creadoMs) / 86400000), 0) };
    })
    .sort((a, b) => b.diasAbierto - a.diasAbierto);
}

function claseAntiguedad(dias) {
  if (dias > 7) return "critico";
  if (dias >= 3) return "mayor";
  return "menor";
}

// ---------------------------------------------------------------------------
// DISTRIBUCIÓN DE GRAVEDAD POR SEMANA (para ver si la severidad baja con el
// tiempo, no solo la cantidad). Semana = lunes de esa semana, formato dd/mm.
// ---------------------------------------------------------------------------
function inicioDeSemana(fecha) {
  const d = new Date(fecha);
  const dia = d.getDay();
  const diff = (dia === 0 ? -6 : 1) - dia; // lunes como inicio de semana
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function etiquetaSemanaCorta(fecha) {
  const inicio = inicioDeSemana(fecha);
  return `${String(inicio.getDate()).padStart(2, "0")}/${String(inicio.getMonth() + 1).padStart(2, "0")}`;
}

function calcularGravedadPorSemana(validados) {
  const niveles = ["Crítico", "Mayor", "Menor", "Observación"];
  const semanas = {}; // clave semana -> { nivel: cantidad }
  validados.forEach((r) => {
    if (!r.fechaHora?.toDate) return;
    const clave = etiquetaSemanaCorta(r.fechaHora.toDate());
    if (!semanas[clave]) semanas[clave] = { "Crítico": 0, "Mayor": 0, "Menor": 0, "Observación": 0, _orden: inicioDeSemana(r.fechaHora.toDate()).getTime() };
    const nivel = niveles.includes(r.gravedad) ? r.gravedad : "Observación";
    semanas[clave][nivel]++;
  });
  const etiquetas = Object.keys(semanas).sort((a, b) => semanas[a]._orden - semanas[b]._orden);
  return {
    etiquetas,
    series: niveles.map((nivel) => ({ nivel, datos: etiquetas.map((e) => semanas[e][nivel]) }))
  };
}

// ---------------------------------------------------------------------------
// TOP 10 DE MAYOR RIESGO: ordenado por gravedad (peso) y luego por recurrencia
// ---------------------------------------------------------------------------
function calcularTopRiesgo(validados) {
  return agruparPorZonaProcesoCategoria(validados)
    .sort((a, b) => (b.pesoMax - a.pesoMax) || (b.cantidad - a.cantidad))
    .slice(0, 10);
}

// ---------------------------------------------------------------------------
// AGRUPACIONES SIMPLES (para gráficas de barras/pastel)
// ---------------------------------------------------------------------------
function contarPorCampo(lista, campo) {
  const conteo = {};
  lista.forEach((r) => {
    const valor = r[campo] || "Sin dato";
    conteo[valor] = (conteo[valor] || 0) + 1;
  });
  return conteo;
}

// ---------------------------------------------------------------------------
// GRÁFICAS CHART.JS
// ---------------------------------------------------------------------------
function renderizarGraficaBarras(idCanvas, etiquetas, datos, colorBase = "#1e5f8c") {
  if (chartsActivos[idCanvas]) chartsActivos[idCanvas].destroy();
  const ctx = document.getElementById(idCanvas).getContext("2d");
  chartsActivos[idCanvas] = new Chart(ctx, {
    type: "bar",
    data: { labels: etiquetas, datasets: [{ label: "Cantidad", data: datos, backgroundColor: colorBase }] },
    options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } }
  });
}

/** Gráfica de barras apiladas por semana, una serie por nivel de gravedad
 * (usa los mismos colores que las etiquetas .etiqueta-gravedad del resto
 * de la app, para que el lenguaje visual sea consistente). */
function renderizarGraficaGravedadPorSemana(idCanvas, { etiquetas, series }) {
  if (chartsActivos[idCanvas]) chartsActivos[idCanvas].destroy();
  const colorPorNivel = { "Crítico": "#D96A5A", "Mayor": "#E0B84B", "Menor": "#E0B84B", "Observación": "#A9A79A" };
  const ctx = document.getElementById(idCanvas).getContext("2d");
  chartsActivos[idCanvas] = new Chart(ctx, {
    type: "bar",
    data: {
      labels: etiquetas,
      datasets: series.map((s) => ({ label: s.nivel, data: s.datos, backgroundColor: colorPorNivel[s.nivel] }))
    },
    options: {
      responsive: true,
      plugins: { legend: { display: true, position: "bottom" } },
      scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true, ticks: { precision: 0 } } }
    }
  });
}

// ---------------------------------------------------------------------------
// PUNTOS DE HALLAZGOS SOBRE EL PLANO REAL (imagen)
// ---------------------------------------------------------------------------

/**
 * Dibuja un punto por cada hallazgo validado sobre el plano real (imagen),
 * posicionado por porcentaje (0-100) para que no dependa del tamaño de
 * pantalla ni de la relación ancho/alto configurada por el admin. El color
 * refleja la gravedad, igual que los pines del mapa GPS.
 *
 * Los reportes creados antes de que el plano usara porcentajes guardaron
 * planoPunto en la escala vieja (0-1000 del esquema anterior); esos valores
 * quedan fuera de 0-100 y se recalculan desde el GPS con la calibración
 * plano↔mapa, si está disponible.
 */
async function pintarPuntosPlanoReal(marco, validados, onClicZona) {
  const capa = marco.querySelector(".plano-real-capa-puntos");
  capa.innerHTML = "";
  const colorPeso = { "Crítico": "#D96A5A", "Mayor": "#E0B84B", "Menor": "#E0B84B", "Observación": "#A9A79A" };

  const necesitaEsquinas = validados.some((r) => !esPlanoPuntoValido(r.planoPunto) && r.gps);
  const esquinas = necesitaEsquinas ? await obtenerEsquinasPlanoGPS() : null;

  validados.forEach((r) => {
    let punto = esPlanoPuntoValido(r.planoPunto) ? r.planoPunto : null;
    if (!punto && r.gps && esquinas) punto = gpsAPuntoPlano(r.gps, esquinas);
    if (!punto) return;

    const el = document.createElement("div");
    el.className = "punto-hallazgo-real";
    el.style.left = punto.x + "%";
    el.style.top = punto.y + "%";
    el.style.background = colorPeso[r.gravedad] || "#2b2262";
    el.title = `${r.zona} · ${r.proceso}`;
    el.onclick = (e) => { e.stopPropagation(); onClicZona(r.zona, [r]); };
    capa.appendChild(el);
  });
}

function esPlanoPuntoValido(p) {
  return p && p.x >= 0 && p.x <= 100 && p.y >= 0 && p.y <= 100;
}

// ---------------------------------------------------------------------------
// MAPA LEAFLET CON PINES GPS
// ---------------------------------------------------------------------------
function inicializarMapaLeaflet(idContenedor, centro) {
  if (mapaLeaflet) return mapaLeaflet;
  const puntoInicial = centro || UBICACION_PLANTA_POR_DEFECTO;
  mapaLeaflet = L.map(idContenedor).setView([puntoInicial.lat, puntoInicial.lng], 16);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap contributors",
    maxZoom: 19
  }).addTo(mapaLeaflet);
  capaMarcadoresLeaflet = L.layerGroup().addTo(mapaLeaflet);
  return mapaLeaflet;
}

// ---------------------------------------------------------------------------
// UBICACIÓN FIJA DE LA PLANTA (marcador arrastrable, se guarda en Firestore
// en configuracion/planta y se usa como centro por defecto del mapa GPS)
// ---------------------------------------------------------------------------
async function obtenerUbicacionPlanta() {
  try {
    const doc = await colConfiguracion.doc("planta").get();
    if (doc.exists && doc.data().lat && doc.data().lng) return doc.data();
  } catch (err) {
    console.warn("No se pudo leer la ubicación guardada de la planta, se usa la ubicación por defecto:", err.message);
  }
  return UBICACION_PLANTA_POR_DEFECTO;
}

async function guardarUbicacionPlanta(lat, lng, uidAdmin) {
  return colConfiguracion.doc("planta").set({
    lat, lng,
    actualizadoPor: uidAdmin,
    actualizadoEn: firebase.firestore.FieldValue.serverTimestamp()
  });
}

let marcadorPlantaLeaflet = null;

/**
 * Agrega (si no existe) un marcador arrastrable que representa la ubicación
 * fija de la planta COGUSA. onMovido(lat,lng) se dispara cada vez que el
 * admin suelta el marcador en una nueva posición, para poder guardarla.
 */
function habilitarMarcadorPlantaArrastrable(centro, onMovido) {
  if (marcadorPlantaLeaflet) {
    marcadorPlantaLeaflet.setLatLng([centro.lat, centro.lng]);
    return marcadorPlantaLeaflet;
  }
  const iconoPlanta = L.divIcon({
    className: "",
    html: '<div style="background:#2b2262;color:#c9a227;border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center;border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,0.4);"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21V10l5 3V9l5 3V6l5 3v9"/><path d="M3 21h18"/></svg></div>',
    iconSize: [28, 28],
    iconAnchor: [14, 14]
  });
  marcadorPlantaLeaflet = L.marker([centro.lat, centro.lng], { draggable: true, icon: iconoPlanta, zIndexOffset: 1000 }).addTo(mapaLeaflet);
  marcadorPlantaLeaflet.bindPopup("Ubicación de planta COGUSA (arrástrame y guarda la posición)");
  marcadorPlantaLeaflet.on("dragend", () => {
    const pos = marcadorPlantaLeaflet.getLatLng();
    if (onMovido) onMovido(pos.lat, pos.lng);
  });
  return marcadorPlantaLeaflet;
}

function pintarPinesLeaflet(validados, onClicPin) {
  capaMarcadoresLeaflet.clearLayers();
  const conGps = validados.filter((r) => r.gps && r.gps.lat && r.gps.lng);
  const bounds = [];

  conGps.forEach((r) => {
    const colorPeso = { "Crítico": "red", "Mayor": "orange", "Menor": "gold", "Observación": "gray" }[r.gravedad] || "blue";
    const marcador = L.circleMarker([r.gps.lat, r.gps.lng], {
      radius: 8, color: "#333", weight: 1, fillColor: colorPeso, fillOpacity: 0.85
    }).addTo(capaMarcadoresLeaflet);
    marcador.bindPopup(`<strong>${r.zona}</strong> - ${r.proceso}<br>${r.gravedad || ""}<br>${(r.descripcion || "").slice(0, 80)}`);
    marcador.on("click", () => onClicPin(r));
    bounds.push([r.gps.lat, r.gps.lng]);
  });

  if (bounds.length) mapaLeaflet.fitBounds(bounds, { padding: [30, 30] });
}

// ---------------------------------------------------------------------------
// PLANO REAL DE PLANTA SUPERPUESTO SOBRE EL MAPA (Leaflet.DistortableImage)
// Permite montar la imagen del plano oficial (AutoCAD exportado) sobre el
// mapa de calle real, georreferenciado. El admin puede arrastrar, rotar y
// escalar la imagen libremente desde Catálogos hasta que quede alineada con
// las calles/edificios reales; la posición final (4 esquinas lat/lng) se
// guarda en Firestore y se reutiliza en modo solo-lectura en el Dashboard.
// ---------------------------------------------------------------------------

/** Ruta de la imagen del plano real, ajustada según la profundidad de carpetas. */
function rutaPlanoImagenReal() {
  const rutaBase = window.location.pathname.includes("/admin/") ? "../" : "";
  return rutaBase + "assets/plano-planta-real.png";
}

/** Carga (una sola vez) el CSS/JS del plugin Leaflet.DistortableImage desde CDN. */
let _promesaDistortable = null;
function cargarLibreriaImagenDistorsionable() {
  if (_promesaDistortable) return _promesaDistortable;
  _promesaDistortable = (async () => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://cdn.jsdelivr.net/npm/leaflet-distortableimage@0.21.9/dist/leaflet.distortableimage.css";
    document.head.appendChild(link);

    const cargarScript = (src) => new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error("No se pudo cargar " + src));
      document.head.appendChild(s);
    });
    await cargarScript("https://cdn.jsdelivr.net/npm/leaflet-distortableimage@0.21.9/dist/vendor.js");
    await cargarScript("https://cdn.jsdelivr.net/npm/leaflet-distortableimage@0.21.9/dist/leaflet.distortableimage.js");
  })();
  return _promesaDistortable;
}

/** Lee la posición (4 esquinas) guardada del plano, si el admin ya la configuró. */
async function obtenerPosicionPlanoImagen() {
  try {
    const doc = await colConfiguracion.doc("planoImagen").get();
    const datos = doc.data();
    if (doc.exists && Array.isArray(datos.corners) && datos.corners.length === 4) {
      return datos.corners.map((c) => L.latLng(c.lat, c.lng));
    }
  } catch (err) {
    console.warn("No se pudo leer la posición guardada del plano:", err.message);
  }
  return null;
}

async function guardarPosicionPlanoImagen(corners, uidAdmin) {
  return colConfiguracion.doc("planoImagen").set({
    corners: corners.map((c) => ({ lat: c.lat, lng: c.lng })),
    actualizadoPor: uidAdmin,
    actualizadoEn: firebase.firestore.FieldValue.serverTimestamp()
  });
}

/** Genera un cuadro inicial razonable (≈500m x 350m) alrededor de un centro,
 * usado la primera vez que se configura el plano (antes de que el admin lo
 * ajuste manualmente). Orden: noroeste, noreste, suroeste, sureste. */
function esquinasPorDefectoPlano(centro) {
  const dLat = 0.0016, dLng = 0.0025;
  return [
    L.latLng(centro.lat + dLat, centro.lng - dLng),
    L.latLng(centro.lat + dLat, centro.lng + dLng),
    L.latLng(centro.lat - dLat, centro.lng - dLng),
    L.latLng(centro.lat - dLat, centro.lng + dLng)
  ];
}

/**
 * Rota las 4 esquinas de la imagen alrededor de su centro geométrico.
 * Se proyecta cada esquina a píxeles de pantalla (donde la rotación es una
 * operación 2D exacta), se rota y se vuelve a convertir a lat/lng. Así el
 * giro se ve "limpio" sin importar la latitud del punto.
 */
function rotarEsquinasPlano(corners, mapa, grados) {
  const zoom = mapa.getZoom();
  const puntos = corners.map((c) => mapa.project(c, zoom));
  const cx = puntos.reduce((s, p) => s + p.x, 0) / 4;
  const cy = puntos.reduce((s, p) => s + p.y, 0) / 4;
  const rad = (grados * Math.PI) / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  return puntos.map((p) => {
    const dx = p.x - cx, dy = p.y - cy;
    const nuevo = L.point(cx + dx * cos - dy * sin, cy + dx * sin + dy * cos);
    return mapa.unproject(nuevo, zoom);
  });
}

/**
 * Escala las 4 esquinas de la imagen alrededor de su centro geométrico
 * (factor > 1 agranda, factor < 1 achica), manteniendo la forma/proporción
 * y el giro actuales.
 */
function escalarEsquinasPlano(corners, mapa, factor) {
  const zoom = mapa.getZoom();
  const puntos = corners.map((c) => mapa.project(c, zoom));
  const cx = puntos.reduce((s, p) => s + p.x, 0) / 4;
  const cy = puntos.reduce((s, p) => s + p.y, 0) / 4;
  return puntos.map((p) => {
    const nuevo = L.point(cx + (p.x - cx) * factor, cy + (p.y - cy) * factor);
    return mapa.unproject(nuevo, zoom);
  });
}

let overlayPlanoImagen = null;

/** Muestra el plano real en modo EDITABLE (Catálogos): el admin puede
 * arrastrar, rotar y distorsionar la imagen para alinearla con el mapa. */
async function habilitarPlanoImagenEditable(mapa, centroFallback) {
  await cargarLibreriaImagenDistorsionable();
  const corners = (await obtenerPosicionPlanoImagen()) || esquinasPorDefectoPlano(centroFallback);
  overlayPlanoImagen = L.distortableImageOverlay(rutaPlanoImagenReal(), { corners }).addTo(mapa);
  overlayPlanoImagen.editing.enable();
  return overlayPlanoImagen;
}

/** Muestra el plano real en modo SOLO LECTURA (Dashboard): sin controles de
 * edición. Devuelve null si el admin todavía no ha configurado la posición. */
async function mostrarPlanoImagenFijo(mapa) {
  const corners = await obtenerPosicionPlanoImagen();
  if (!corners) return null;
  await cargarLibreriaImagenDistorsionable();
  return L.distortableImageOverlay(rutaPlanoImagenReal(), { corners, actions: [] }).addTo(mapa);
}
