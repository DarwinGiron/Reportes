// ============================================================================
// EXPORT.JS - Exportación de informes en PDF (pdfmake), Word (.docx) y
// Excel (.xlsx). Incluye TODOS los reportes del período elegido (pendientes
// + validados).
//
// El PDF y el Word usan un diseño de TARJETAS (una por hallazgo, 4 por
// página en cuadrícula 2x2), parecido a las tarjetas de la app: una sola
// fotografía, chip de color según la gravedad, título "Categoría — Proceso",
// zona/área, descripción completa y los metadatos (autor, revisado por,
// fecha/hora, turno). El encabezado oficial (logo, código SIG-FO-114,
// período) se mantiene igual que antes.
// El Excel es solo tabular y no incluye imágenes.
// ============================================================================

/** Descarga una URL de imagen y la convierte a base64 (dataURL). */
async function urlAImagenBase64(url) {
  try {
    const resp = await fetch(url);
    const blob = await resp.blob();
    return await new Promise((resolve, reject) => {
      const lector = new FileReader();
      lector.onload = () => resolve(lector.result);
      lector.onerror = reject;
      lector.readAsDataURL(blob);
    });
  } catch (e) {
    console.warn("No se pudo descargar imagen para el informe:", url, e);
    return null;
  }
}

function textoPeriodo(desde, hasta) {
  const f = (d) => d.toLocaleDateString("es-GT", { year: "numeric", month: "long", day: "numeric" });
  return `${f(desde)} al ${f(hasta)}`;
}

/** Ruta del logo, ajustada según la profundidad de carpetas de la página actual. */
function rutaLogoEmpresa() {
  const rutaBase = window.location.pathname.includes("/admin/") ? "../" : "";
  return rutaBase + EMPRESA_CONFIG.logo;
}

function textoEstado(r) {
  return r.estado === "validado" ? "Validado" : "Pendiente";
}

/** Colores del chip de gravedad, iguales a los usados en la app (css/styles.css). */
function coloresGravedad(g) {
  const paleta = {
    "Crítico": { bg: "#fbe4e1", fg: "#a3241b" },
    "Mayor": { bg: "#fdecd8", fg: "#9a5610" },
    "Menor": { bg: "#fff6e0", fg: "#8a6100" },
    "Observación": { bg: "#e9eaed", fg: "#495057" }
  };
  return paleta[g] || paleta["Observación"];
}

const TARJETAS_POR_PAGINA = 4; // cuadrícula 2x2

/** Ordena por fecha (más antiguo primero) y divide en páginas de 4 tarjetas. */
function construirPaginasDeTarjetas(reportes) {
  const ordenados = [...reportes].sort((a, b) => {
    const ta = a.fechaHora?.toMillis ? a.fechaHora.toMillis() : 0;
    const tb = b.fechaHora?.toMillis ? b.fechaHora.toMillis() : 0;
    return ta - tb;
  });
  const paginas = [];
  for (let i = 0; i < ordenados.length; i += TARJETAS_POR_PAGINA) {
    paginas.push(ordenados.slice(i, i + TARJETAS_POR_PAGINA));
  }
  return paginas;
}

// ---------------------------------------------------------------------------
// EXPORTACIÓN A PDF (pdfmake) - mismo formato tabular que el Word oficial
// ---------------------------------------------------------------------------
async function exportarInformePDF(reportes, desde, hasta, perfilAdmin) {
  if (!reportes.length) { mostrarAvisoGlobal("No hay reportes en el período seleccionado.", "advertencia"); return; }

  // Solo la primera fotografía de cada reporte (diseño de tarjeta)
  const fotoPorReporte = {};
  for (const r of reportes) {
    if (r.fotos && r.fotos.length) {
      const b64 = await urlAImagenBase64(r.fotos[0]);
      if (b64) fotoPorReporte[r.id] = b64;
    }
  }

  // Logo para el encabezado (opcional: si falla, se muestra el nombre en texto)
  const logoB64 = await urlAImagenBase64(rutaLogoEmpresa());

  function tarjetaPDF(r) {
    const colores = coloresGravedad(r.gravedad);
    const foto = fotoPorReporte[r.id];
    const contenido = [
      foto
        ? { image: foto, fit: [230, 140], alignment: "center", margin: [0, 0, 0, 8] }
        : { text: "(sin fotografía)", italics: true, color: "#999", alignment: "center", margin: [0, 0, 0, 8] },
      {
        table: { widths: ["auto"], body: [[{ text: (r.gravedad || "SIN GRAVEDAD").toUpperCase(), color: colores.fg, fillColor: colores.bg, bold: true, fontSize: 8, margin: [6, 3, 6, 3] }]] },
        layout: "noBorders",
        margin: [0, 0, 0, 6]
      },
      { text: `${textoCategoria(r)} — ${r.proceso}`, bold: true, color: "#2b2262", fontSize: 11, margin: [0, 0, 0, 2] },
      { text: r.zona, color: "#666", fontSize: 9, margin: [0, 0, 0, 6] },
      { text: r.descripcion, fontSize: 9, margin: [0, 0, 0, 8] },
      { columns: [
        { text: [{ text: "Autor: ", bold: true }, { text: r.inspectorNombre }], fontSize: 8 },
        { text: [{ text: "Turno: ", bold: true }, { text: r.turno || "Sin especificar" }], fontSize: 8 }
      ], margin: [0, 0, 0, 3] },
      { columns: [
        { text: [{ text: "Revisado por: ", bold: true }, { text: r.validadoPorNombre || "Pendiente de validación" }], fontSize: 8 },
        { text: [{ text: "Fecha: ", bold: true }, { text: formatearFechaHora(r.fechaHora) }], fontSize: 8 }
      ] }
    ];
    return {
      table: { widths: ["*"], body: [[{ stack: contenido, margin: [8, 8, 8, 8] }]] },
      layout: { hLineWidth: () => 1, vLineWidth: () => 1, hLineColor: () => "#d9d9e3", vLineColor: () => "#d9d9e3" },
      margin: [0, 0, 10, 14]
    };
  }

  // --- Cuadrícula de tarjetas, 4 por página (2x2) ---
  const bloquesTarjetas = [];
  const paginas = construirPaginasDeTarjetas(reportes);

  paginas.forEach((pagina, indicePagina) => {
    const filas = [];
    for (let i = 0; i < pagina.length; i += 2) {
      const izq = pagina[i], der = pagina[i + 1];
      filas.push([tarjetaPDF(izq), der ? tarjetaPDF(der) : {}]);
    }
    bloquesTarjetas.push({
      table: { widths: ["50%", "50%"], body: filas },
      layout: "noBorders",
      pageBreak: indicePagina > 0 ? "before" : undefined
    });
  });

  const docDefinicion = {
    pageSize: "LETTER",
    pageMargins: [50, 70, 50, 50],
    header: {
      margin: [50, 20, 50, 0],
      columns: [
        logoB64
          ? { image: logoB64, width: 180 }
          : { text: EMPRESA_CONFIG.nombre, bold: true, fontSize: 11 },
        {
          stack: [
            { text: EMPRESA_CONFIG.codigoFormulario, alignment: "right", fontSize: 8 },
            { text: EMPRESA_CONFIG.revisionFormulario, alignment: "right", fontSize: 8 }
          ]
        }
      ]
    },
    content: [
      { text: EMPRESA_CONFIG.tituloInforme.toUpperCase(), style: "titulo" },
      { text: `Período: ${textoPeriodo(desde, hasta)}`, style: "meta" },
      { text: `Fecha de generación: ${new Date().toLocaleString("es-GT")}`, style: "meta" },
      { text: `Elaborado por: ${perfilAdmin.nombre || perfilAdmin.correo}`, style: "meta", margin: [0, 0, 0, 16] },
      ...bloquesTarjetas
    ],
    styles: {
      titulo: { fontSize: 14, bold: true, alignment: "center", margin: [0, 6, 0, 10] },
      meta: { fontSize: 9, alignment: "center", color: "#555" }
    },
    defaultStyle: { fontSize: 9 }
  };

  pdfMake.createPdf(docDefinicion).download(`Reporte_Semanal_Inocuidad_COGUSA_${new Date().toISOString().slice(0, 10)}.pdf`);
}

// ---------------------------------------------------------------------------
// EXPORTACIÓN A WORD (.docx) usando la librería "docx"
// ---------------------------------------------------------------------------
async function exportarInformeWord(reportes, desde, hasta, perfilAdmin) {
  if (!reportes.length) { mostrarAvisoGlobal("No hay reportes en el período seleccionado.", "advertencia"); return; }

  const { Document, Packer, Paragraph, HeadingLevel, Table, TableRow, TableCell, TextRun, AlignmentType, ImageRun, WidthType, Header, BorderStyle, VerticalAlign, PageBreak } = docx;

  // Ancho útil de página Carta con márgenes de 1": 9360 DXA
  const ANCHO_TABLA = 9360;
  const ANCHO_COL = 4680; // dos columnas iguales (cuadrícula 2x2 de tarjetas)

  function parrafo(texto, opciones = {}) {
    return new Paragraph({
      alignment: opciones.centrado ? AlignmentType.CENTER : AlignmentType.LEFT,
      spacing: opciones.spacing,
      children: [new TextRun({ text: texto, bold: !!opciones.negrita, italics: !!opciones.cursiva, size: opciones.size, color: opciones.color })]
    });
  }

  // --- Logo para el encabezado (si no se puede cargar, el Word se genera sin él) ---
  let logoBytes = null;
  try {
    const resp = await fetch(rutaLogoEmpresa());
    logoBytes = new Uint8Array(await resp.arrayBuffer());
  } catch (e) {
    console.warn("No se pudo cargar el logo para el encabezado del Word:", e);
  }

  const sinBordes = { top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE }, insideHorizontal: { style: BorderStyle.NONE }, insideVertical: { style: BorderStyle.NONE } };

  const encabezadoDocx = new Header({
    children: [
      new Table({
        width: { size: ANCHO_TABLA, type: WidthType.DXA },
        columnWidths: [7000, 2360],
        borders: sinBordes,
        rows: [
          new TableRow({
            children: [
              new TableCell({
                width: { size: 7000, type: WidthType.DXA },
                children: logoBytes
                  ? [new Paragraph({ children: [new ImageRun({ data: logoBytes, type: "png", transformation: { width: 220, height: 40 } })] })]
                  : [new Paragraph({ children: [new TextRun({ text: EMPRESA_CONFIG.nombre, bold: true })] })]
              }),
              new TableCell({
                width: { size: 2360, type: WidthType.DXA },
                children: [
                  new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: EMPRESA_CONFIG.codigoFormulario, size: 16 })] }),
                  new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: EMPRESA_CONFIG.revisionFormulario, size: 16 })] })
                ]
              })
            ]
          })
        ]
      })
    ]
  });

  const bordeTarjeta = { style: BorderStyle.SINGLE, size: 4, color: "D9D9E3" };
  const bordesTarjeta = { top: bordeTarjeta, bottom: bordeTarjeta, left: bordeTarjeta, right: bordeTarjeta, insideHorizontal: bordeTarjeta, insideVertical: bordeTarjeta };

  /** Contenido de una tarjeta (una celda de la cuadrícula 2x2): foto única,
   * chip de gravedad, título "Categoría — Proceso", zona, descripción y
   * metadatos (autor, revisado por, fecha/hora, turno). */
  async function contenidoTarjetaWord(r) {
    const hijos = [];
    if (r.fotos && r.fotos.length) {
      const dataUrl = await urlAImagenBase64(r.fotos[0]);
      if (dataUrl) {
        const base64 = dataUrl.split(",")[1];
        const binario = atob(base64);
        const bytes = new Uint8Array(binario.length);
        for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
        hijos.push(new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new ImageRun({ data: bytes, type: "jpg", transformation: { width: 260, height: 155 } })],
          spacing: { after: 120 }
        }));
      }
    }
    if (!hijos.length) {
      hijos.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 120 }, children: [new TextRun({ text: "(sin fotografía)", italics: true, color: "999999" })] }));
    }

    const colores = coloresGravedad(r.gravedad);
    hijos.push(new Paragraph({
      shading: { fill: colores.bg.replace("#", "") },
      spacing: { after: 120 },
      children: [new TextRun({ text: (r.gravedad || "SIN GRAVEDAD").toUpperCase(), bold: true, color: colores.fg.replace("#", ""), size: 16 })]
    }));

    hijos.push(new Paragraph({ spacing: { after: 40 }, children: [new TextRun({ text: `${textoCategoria(r)} — ${r.proceso}`, bold: true, color: "2B2262", size: 22 })] }));
    hijos.push(new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: r.zona, color: "666666", size: 18 })] }));
    hijos.push(new Paragraph({ spacing: { after: 160 }, children: [new TextRun({ text: r.descripcion, size: 18 })] }));

    hijos.push(new Paragraph({ spacing: { after: 40 }, children: [new TextRun({ text: "Autor: ", bold: true, size: 16 }), new TextRun({ text: r.inspectorNombre, size: 16 })] }));
    hijos.push(new Paragraph({ spacing: { after: 40 }, children: [new TextRun({ text: "Revisado por: ", bold: true, size: 16 }), new TextRun({ text: r.validadoPorNombre || "Pendiente de validación", size: 16 })] }));
    hijos.push(new Paragraph({ spacing: { after: 40 }, children: [new TextRun({ text: "Fecha y hora: ", bold: true, size: 16 }), new TextRun({ text: formatearFechaHora(r.fechaHora), size: 16 })] }));
    hijos.push(new Paragraph({ children: [new TextRun({ text: "Turno: ", bold: true, size: 16 }), new TextRun({ text: r.turno || "Sin especificar", size: 16 })] }));

    return hijos;
  }

  // --- Cuadrícula de tarjetas, 4 por página (2x2) ---
  const bloquesTarjetas = [];
  const paginas = construirPaginasDeTarjetas(reportes);

  for (let indicePagina = 0; indicePagina < paginas.length; indicePagina++) {
    const pagina = paginas[indicePagina];
    const filas = [];

    for (let i = 0; i < pagina.length; i += 2) {
      const izq = pagina[i], der = pagina[i + 1];
      filas.push(new TableRow({
        children: [
          new TableCell({
            width: { size: ANCHO_COL, type: WidthType.DXA },
            verticalAlign: VerticalAlign.TOP,
            margins: { top: 120, bottom: 120, left: 150, right: 150 },
            children: await contenidoTarjetaWord(izq)
          }),
          new TableCell({
            width: { size: ANCHO_COL, type: WidthType.DXA },
            verticalAlign: VerticalAlign.TOP,
            margins: { top: 120, bottom: 120, left: 150, right: 150 },
            children: der ? await contenidoTarjetaWord(der) : [new Paragraph({ text: "" })]
          })
        ]
      }));
    }

    bloquesTarjetas.push(new Table({
      width: { size: ANCHO_TABLA, type: WidthType.DXA },
      columnWidths: [ANCHO_COL, ANCHO_COL],
      borders: bordesTarjeta,
      rows: filas
    }));

    // Salto de página entre cada página de tarjetas (máx. 4 por hoja)
    if (indicePagina < paginas.length - 1) {
      bloquesTarjetas.push(new Paragraph({ children: [new PageBreak()] }));
    } else {
      bloquesTarjetas.push(new Paragraph({ text: "", spacing: { after: 300 } }));
    }
  }

  const documento = new Document({
    styles: {
      default: { document: { run: { font: "Arial", size: 20 } } } // 10pt, como el formato original
    },
    sections: [{
      properties: {
        page: {
          size: { width: 12240, height: 15840 },
          margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 }
        }
      },
      headers: { default: encabezadoDocx },
      children: [
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 200, after: 200 },
          children: [new TextRun({ text: EMPRESA_CONFIG.tituloInforme.toUpperCase(), bold: true, size: 28 })]
        }),
        parrafo(`Período: ${textoPeriodo(desde, hasta)}`, { centrado: true }),
        parrafo(`Fecha de generación: ${new Date().toLocaleString("es-GT")}`, { centrado: true }),
        parrafo(`Elaborado por: ${perfilAdmin.nombre || perfilAdmin.correo}`, { centrado: true, spacing: { after: 300 } }),
        ...bloquesTarjetas
      ]
    }]
  });

  const blob = await Packer.toBlob(documento);
  const enlace = document.createElement("a");
  enlace.href = URL.createObjectURL(blob);
  enlace.download = `Reporte_Semanal_Inocuidad_COGUSA_${new Date().toISOString().slice(0, 10)}.docx`;
  enlace.click();
}

// ---------------------------------------------------------------------------
// EXPORTACIÓN A EXCEL (.xlsx) usando SheetJS - SIN imágenes, solo datos
// tabulares de TODOS los reportes del período (pendientes + validados).
// ---------------------------------------------------------------------------
function exportarInformeExcel(reportes, desde, hasta) {
  if (!reportes.length) { mostrarAvisoGlobal("No hay reportes en el período seleccionado.", "advertencia"); return; }

  const filas = reportes.map((r) => ({
    "Fecha": formatearFechaHora(r.fechaHora),
    "Turno": r.turno || "Sin especificar",
    "Estado": textoEstado(r),
    "Inspector": r.inspectorNombre,
    "Zona": r.zona,
    "Proceso": r.proceso,
    "Descripción": r.descripcion,
    "Categoría": textoCategoria(r),
    "Gravedad": r.gravedad || "-"
  }));

  const hoja = XLSX.utils.json_to_sheet(filas);
  hoja["!cols"] = [{ wch: 18 }, { wch: 12 }, { wch: 12 }, { wch: 22 }, { wch: 16 }, { wch: 18 }, { wch: 50 }, { wch: 32 }, { wch: 12 }];

  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, hoja, "Reportes del periodo");
  XLSX.writeFile(libro, `Reporte_Semanal_Inocuidad_COGUSA_${new Date().toISOString().slice(0, 10)}.xlsx`);
}
