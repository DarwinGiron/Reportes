// ============================================================================
// EXPORT.JS - Exportación de informes en PDF (pdfmake), Word (.docx) y
// Excel (.xlsx). Incluye TODOS los reportes del período elegido (pendientes
// + validados) con todas sus fotografías (1 a 3 por reporte).
//
// El PDF y el Word replican el formato del reporte semanal oficial de la
// empresa (SIG-FO-114): logo + código de formulario en el encabezado, título
// centrado y los hallazgos agrupados por PROCESO dentro de tablas con esta
// estructura por cada hallazgo:
//   ┌─────────────────────────────────────────────┐
//   │                  HALLAZGOS                  │
//   │              NOMBRE DEL PROCESO             │
//   ├──────────────────────┬──────────────────────┤
//   │ Requisito de la      │ [fotografías]        │
//   │ Norma: ...           │                      │
//   │ Proceso: ...         │                      │
//   │ Área/Máquina: ...    │                      │
//   ├──────────────────────┴──────────────────────┤
//   │ Observaciones: ...                          │
//   └─────────────────────────────────────────────┘
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

/** Agrupa los reportes por proceso (un bloque "HALLAZGOS" por proceso,
 * igual que el formato oficial de la empresa). */
function agruparPorProceso(reportes) {
  const grupos = new Map();
  reportes.forEach((r) => {
    const clave = r.proceso || "Sin proceso";
    if (!grupos.has(clave)) grupos.set(clave, []);
    grupos.get(clave).push(r);
  });
  return grupos;
}

function textoEstado(r) {
  return r.estado === "validado" ? "Validado" : "Pendiente";
}

const HALLAZGOS_POR_PAGINA = 2;

/**
 * Aplana los reportes agrupados por proceso en una lista única (conservando
 * el orden por proceso) y la divide en "páginas" de máximo
 * HALLAZGOS_POR_PAGINA hallazgos cada una, para que el PDF/Word impreso
 * muestre como máximo 2 reportes por hoja.
 */
function construirPaginasDeHallazgos(reportes) {
  const grupos = agruparPorProceso(reportes);
  const plano = [];
  for (const [proceso, lista] of grupos) {
    lista.forEach((reporte) => plano.push({ proceso, reporte }));
  }
  const paginas = [];
  for (let i = 0; i < plano.length; i += HALLAZGOS_POR_PAGINA) {
    paginas.push(plano.slice(i, i + HALLAZGOS_POR_PAGINA));
  }
  return paginas;
}

// ---------------------------------------------------------------------------
// EXPORTACIÓN A PDF (pdfmake) - mismo formato tabular que el Word oficial
// ---------------------------------------------------------------------------
async function exportarInformePDF(reportes, desde, hasta, perfilAdmin) {
  if (!reportes.length) { mostrarAvisoGlobal("No hay reportes en el período seleccionado.", "advertencia"); return; }

  // Prepara TODAS las fotos de cada reporte en base64 (1 a 3 por reporte)
  const fotosPorReporte = {};
  for (const r of reportes) {
    if (r.fotos && r.fotos.length) {
      fotosPorReporte[r.id] = [];
      for (const url of r.fotos) {
        const b64 = await urlAImagenBase64(url);
        if (b64) fotosPorReporte[r.id].push(b64);
      }
    }
  }

  // Logo para el encabezado (opcional: si falla, se muestra el nombre en texto)
  const logoB64 = await urlAImagenBase64(rutaLogoEmpresa());

  // --- Tablas de hallazgos, máximo 2 reportes por página (formato oficial) ---
  const bloquesHallazgos = [];
  const paginas = construirPaginasDeHallazgos(reportes);

  paginas.forEach((pagina, indicePagina) => {
    const body = [];
    let procesoPrevio = null;

    pagina.forEach(({ proceso, reporte: r }) => {
      if (proceso !== procesoPrevio) {
        body.push([{ text: "HALLAZGOS", bold: true, alignment: "center", colSpan: 2 }, {}]);
        body.push([{ text: proceso.toUpperCase(), bold: true, alignment: "center", colSpan: 2 }, {}]);
        procesoPrevio = proceso;
      }

      body.push([
        {
          stack: [
            { text: "Categoría:", bold: true },
            { text: textoCategoria(r), margin: [0, 0, 0, 8] },
            { text: "Proceso:", bold: true },
            { text: r.proceso, margin: [0, 0, 0, 8] },
            { text: "Área/Máquina:", bold: true },
            { text: r.zona, margin: [0, 0, 0, 8] },
            { text: "Turno:", bold: true },
            { text: r.turno || "Sin especificar" }
          ],
          margin: [2, 4, 2, 4]
        },
        {
          stack: (fotosPorReporte[r.id] || []).map((b64) => ({ image: b64, width: 190, margin: [0, 0, 0, 6] })),
          margin: [2, 4, 2, 4]
        }
      ]);
      body.push([
        { text: [{ text: "Observaciones: ", bold: true }, { text: r.descripcion }], colSpan: 2, margin: [2, 4, 2, 6] },
        {}
      ]);
    });

    bloquesHallazgos.push({
      table: { widths: ["38%", "62%"], body },
      margin: [0, 0, 0, 18],
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
      ...bloquesHallazgos
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
  const ANCHO_COL_IZQ = 3560;
  const ANCHO_COL_DER = 5800;

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

  // --- Tablas de hallazgos, máximo 2 reportes por página (formato oficial) ---
  const bloquesHallazgos = [];
  const paginas = construirPaginasDeHallazgos(reportes);

  for (let indicePagina = 0; indicePagina < paginas.length; indicePagina++) {
    const pagina = paginas[indicePagina];
    const filas = [];
    let procesoPrevio = null;

    for (const { proceso, reporte: r } of pagina) {
      if (proceso !== procesoPrevio) {
        filas.push(new TableRow({
          children: [new TableCell({
            columnSpan: 2,
            width: { size: ANCHO_TABLA, type: WidthType.DXA },
            margins: { top: 80, bottom: 80, left: 120, right: 120 },
            children: [parrafo("HALLAZGOS", { negrita: true, centrado: true })]
          })]
        }));
        filas.push(new TableRow({
          children: [new TableCell({
            columnSpan: 2,
            width: { size: ANCHO_TABLA, type: WidthType.DXA },
            margins: { top: 80, bottom: 80, left: 120, right: 120 },
            children: [parrafo(proceso.toUpperCase(), { negrita: true, centrado: true })]
          })]
        }));
        procesoPrevio = proceso;
      }

      // Celda derecha: solo las fotos del reporte
      const contenidoDerecha = [];
      if (r.fotos && r.fotos.length) {
        for (const url of r.fotos) {
          const dataUrl = await urlAImagenBase64(url);
          if (!dataUrl) continue;
          const base64 = dataUrl.split(",")[1];
          const binario = atob(base64);
          const bytes = new Uint8Array(binario.length);
          for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
          contenidoDerecha.push(new Paragraph({
            children: [new ImageRun({ data: bytes, type: "jpg", transformation: { width: 280, height: 210 } })],
            spacing: { after: 100 }
          }));
        }
      }

      filas.push(new TableRow({
        children: [
          new TableCell({
            width: { size: ANCHO_COL_IZQ, type: WidthType.DXA },
            verticalAlign: VerticalAlign.TOP,
            margins: { top: 80, bottom: 80, left: 120, right: 120 },
            children: [
              parrafo("Categoría:", { negrita: true }),
              parrafo(textoCategoria(r), { spacing: { after: 150 } }),
              parrafo("Proceso:", { negrita: true }),
              parrafo(r.proceso, { spacing: { after: 150 } }),
              parrafo("Área/Máquina:", { negrita: true }),
              parrafo(r.zona, { spacing: { after: 150 } }),
              parrafo("Turno:", { negrita: true }),
              parrafo(r.turno || "Sin especificar")
            ]
          }),
          new TableCell({
            width: { size: ANCHO_COL_DER, type: WidthType.DXA },
            verticalAlign: VerticalAlign.TOP,
            margins: { top: 80, bottom: 80, left: 120, right: 120 },
            children: contenidoDerecha
          })
        ]
      }));

      filas.push(new TableRow({
        children: [new TableCell({
          columnSpan: 2,
          width: { size: ANCHO_TABLA, type: WidthType.DXA },
          margins: { top: 80, bottom: 80, left: 120, right: 120 },
          children: [new Paragraph({
            children: [
              new TextRun({ text: "Observaciones: ", bold: true }),
              new TextRun({ text: r.descripcion })
            ]
          })]
        })]
      }));
    }

    bloquesHallazgos.push(new Table({
      width: { size: ANCHO_TABLA, type: WidthType.DXA },
      columnWidths: [ANCHO_COL_IZQ, ANCHO_COL_DER],
      rows: filas
    }));

    // Salto de página entre cada página de hallazgos (máx. 2 por hoja)
    if (indicePagina < paginas.length - 1) {
      bloquesHallazgos.push(new Paragraph({ children: [new PageBreak()] }));
    } else {
      bloquesHallazgos.push(new Paragraph({ text: "", spacing: { after: 300 } }));
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
        ...bloquesHallazgos
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
