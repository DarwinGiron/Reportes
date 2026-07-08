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

function normalizarClave(txt) {
  return (txt || "").toString().trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

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
// TOP 10 HALLAZGOS MÁS REPETITIVOS (ver criterio arriba)
// ---------------------------------------------------------------------------
function calcularTopRepetitivos(validados) {
  const grupos = {};
  validados.forEach((r) => {
    const clave = [normalizarClave(r.zona), normalizarClave(r.proceso), normalizarClave(r.puntoNormaTexto || "sin-norma")].join(" | ");
    if (!grupos[clave]) {
      grupos[clave] = { zona: r.zona, proceso: r.proceso, puntoNorma: r.puntoNormaTexto || "Sin punto de norma", cantidad: 0 };
    }
    grupos[clave].cantidad++;
  });
  return Object.values(grupos).sort((a, b) => b.cantidad - a.cantidad).slice(0, 10);
}

// ---------------------------------------------------------------------------
// TOP 10 DE MAYOR RIESGO: ordenado por gravedad (peso) y luego por recurrencia
// ---------------------------------------------------------------------------
function calcularTopRiesgo(validados) {
  const grupos = {};
  validados.forEach((r) => {
    const clave = [normalizarClave(r.zona), normalizarClave(r.proceso), normalizarClave(r.puntoNormaTexto || "sin-norma")].join(" | ");
    if (!grupos[clave]) {
      grupos[clave] = {
        zona: r.zona, proceso: r.proceso, puntoNorma: r.puntoNormaTexto || "Sin punto de norma",
        cantidad: 0, gravedadMax: r.gravedad, pesoMax: PESO_GRAVEDAD[r.gravedad] || 0
      };
    }
    grupos[clave].cantidad++;
    const peso = PESO_GRAVEDAD[r.gravedad] || 0;
    if (peso > grupos[clave].pesoMax) { grupos[clave].pesoMax = peso; grupos[clave].gravedadMax = r.gravedad; }
  });
  return Object.values(grupos).sort((a, b) => (b.pesoMax - a.pesoMax) || (b.cantidad - a.cantidad)).slice(0, 10);
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

// ---------------------------------------------------------------------------
// MAPA DE CALOR SOBRE EL PLANO SVG
// ---------------------------------------------------------------------------
function colorPorDensidad(cantidad, maximo) {
  if (!cantidad) return "#dbe9f5";
  const ratio = maximo > 0 ? cantidad / maximo : 0;
  if (ratio <= 0.33) return "#8bd18b";   // verde = bajo
  if (ratio <= 0.66) return "#e6b84a";   // ámbar = medio
  return "#e05c4a";                       // rojo = alto
}

async function pintarPlanoCalor(svg, validados, onClicZona) {
  const conteoZonas = contarPorCampo(validados, "zona");
  const maximo = Math.max(0, ...Object.values(conteoZonas));

  svg.querySelectorAll(".zona-poligono").forEach((el) => {
    const zonaId = el.dataset.zonaId;
    const cantidad = Object.entries(conteoZonas).find(([k]) => normalizarClave(k) === normalizarClave(zonaId))?.[1] || 0;
    el.setAttribute("fill", colorPorDensidad(cantidad, maximo));
    el.style.cursor = "pointer";
    el.onclick = () => onClicZona(zonaId, validados.filter((r) => normalizarClave(r.zona) === normalizarClave(zonaId)));
  });

  // Dibuja los puntos exactos de cada hallazgo
  const capa = svg.querySelector("#capa-puntos");
  capa.innerHTML = "";
  validados.forEach((r) => {
    if (!r.planoPunto) return;
    const circulo = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circulo.setAttribute("cx", r.planoPunto.x);
    circulo.setAttribute("cy", r.planoPunto.y);
    circulo.setAttribute("r", 6);
    circulo.setAttribute("class", "punto-hallazgo");
    circulo.style.cursor = "pointer";
    circulo.onclick = (e) => { e.stopPropagation(); onClicZona(r.zona, [r]); };
    capa.appendChild(circulo);
  });
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
    html: '<div style="background:#1e5f8c;color:#fff;border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center;border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,0.4);font-size:14px;">🏭</div>',
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
