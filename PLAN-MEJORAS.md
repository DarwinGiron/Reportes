# Plan de implementación — 4 mejoras solicitadas

> **REGLA OBLIGATORIA:** NO hacer `git commit` ni `git push` de nada hasta que el
> usuario valide explícitamente que cada fase funciona. Trabajar solo en el
> árbol local y verificar en el preview (credenciales admin:
> dgiron@empresasgalindo.com / Admin123, servidor preview ya configurado como
> "sitio-estatico"). El usuario prueba también en su propio servidor
> localhost:3000, así que avisarle cuándo probar.

---

## Fase A — Plano reemplazable subiendo un PDF (desde Configuraciones)

**Objetivo:** el admin sube un PDF (o imagen) del plano oficial; se convierte en
el navegador a PNG con el fondo blanco transparente, se sube a Cloudinary y esa
URL pasa a ser el plano que usan TODAS las vistas (Nuevo reporte, Validación,
Dashboard, calibraciones y pestaña "Plano del reporte").

### A1. Renombrar "Catálogos" a "Configuraciones"
- En las 4 páginas admin (`dashboard.html`, `validacion.html`, `catalogos.html`,
  `informes.html`): cambiar el texto del enlace del menú `Catálogos` →
  `Configuraciones` (el href sigue siendo `catalogos.html`, NO renombrar el
  archivo para no romper enlaces/marcadores).
- En `admin/catalogos.html`: `<title>` → "Configuraciones - COGUSA SGI" y el
  `<h1>` de `.marca-texto` → "Configuraciones".

### A2. Nueva tarjeta "Plano de la planta (archivo)" en la pestaña "Ubicación de planta"
Colocarla ANTES de la tarjeta "1. Calibración del plano", con:
- `<input type="file" accept="application/pdf,image/png,image/jpeg">` estilizado
  (label-botón como el de fotos del inspector).
- Vista previa del plano actual (imagen pequeña) + texto de estado con fecha de
  última actualización (`configuracion/planoArchivo.actualizadoEn`).
- Botón "Usar plano por defecto" que borra la URL personalizada (vuelve al
  asset local `assets/plano-planta-real.png`).
- Aviso en `.ayuda`: al reemplazar el plano hay que **recalibrar** los puntos de
  referencia (Fase de calibración existente) y revisar el tamaño en "Plano del
  reporte", porque los porcentajes guardados corresponden al encuadre anterior.

### A3. Conversión PDF → PNG transparente en el navegador
- Cargar **pdf.js** por CDN SOLO en `admin/catalogos.html` (lazy, al elegir un
  PDF): `https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js` y su
  worker `pdf.worker.min.js` (fijar `GlobalWorkerOptions.workerSrc`). Verificar
  que esas rutas existen con la API de jsdelivr antes de usarlas (lección
  aprendida con docx).
- Flujo en JS (nueva función en `js/catalogos.js` o en el inline de
  catalogos.html):
  1. Si es PDF: renderizar página 1 a canvas con ancho ~2200 px.
     Si es imagen: dibujarla a canvas (máx 2200 px de ancho).
  2. Aplicar transparencia con la MISMA fórmula ya validada en Python:
     `alpha = 255 - min(R,G,B)`; des-premultiplicar contra blanco:
     `fg = (c - (255 - alpha)) * 255 / alpha` (clamp 0-255, alpha mínimo 1 para
     evitar división por cero). Recorrer `ImageData` y `putImageData`.
  3. `canvas.toBlob("image/png")` → subir a Cloudinary con el MISMO preset
     unsigned existente (`CLOUDINARY_CONFIG`, ver `js/cloudinary.js` — reutilizar
     la función de subida existente si acepta blobs; si no, factorizar).
     NO comprimir con browser-image-compression (convierte a JPEG y mata la
     transparencia); subir el PNG tal cual.
  4. Guardar en Firestore `configuracion/planoArchivo`:
     `{ url, ancho, alto, actualizadoPor, actualizadoEn }`.
- Mostrar progreso en un `<span>` de estado ("Convirtiendo…", "Subiendo…",
  "✓ Plano actualizado").

### A4. Consumir la URL configurable en todo el sistema
- En `js/reportes.js`: convertir `rutaPlanoImagenPlanta()` en
  `obtenerUrlPlanoPlanta()` **async** que:
  1. Lee `configuracion/planoImagen`… NO — lee `configuracion/planoArchivo`.
  2. Si existe `url`, la devuelve; si no, devuelve el asset local con la lógica
     rutaBase actual.
  3. Memoizar en una variable de módulo (una lectura por carga de página).
- `cargarPlanoImagenReal()` ya es async: usar `await obtenerUrlPlanoPlanta()`.
- `admin/catalogos.html` pestaña "Plano del reporte": el `<img>` hardcodeado
  (`../assets/plano-planta-real.png`, línea ~177) debe poblarse por JS con la
  misma función.
- Actualizar también `ANCHO_ALTO_NATURAL_PLANO` (usado por "Restablecer
  proporción original"): si `planoArchivo` tiene ancho/alto, usarlos.
- CORS: las imágenes de Cloudinary se usan también en la exportación PDF/Word
  (ya se descargan fotos de Cloudinary hoy, el patrón existente funciona).

---

## Fase B — Proceso como listado cerrado en "Nuevo reporte"

**Objetivo:** el inspector elige el proceso de una lista fija (sin crear); el
admin agrega procesos desde Configuraciones → Procesos (pestaña ya existente,
no se toca).

- `inspector.html`:
  - Reemplazar el input autocompletar de proceso (líneas ~56-58) por un
    `<select id="proceso" required>` con opción inicial "-- Seleccione --".
  - Poblarlo en `inicializarFormulario()` leyendo `colProcesos` where
    `activo == true`, ordenado por nombre (client-side sort, sin orderBy para
    evitar índices). Guardar `procesoSeleccionId` desde el `dataset` de la
    opción seleccionada.
  - Eliminar el bloque `crearAutocompletarConCreacion` del proceso y la
    `lista-proceso`.
- `admin/validacion.html` (modal): reemplazar el autocompletar de proceso por el
  mismo `<select>` poblado igual, con el valor actual del reporte
  preseleccionado (si el proceso del reporte ya no existe en el catálogo,
  agregarlo como opción extra marcada "(histórico)").
- La zona se queda como está (autocompletar con creación).

---

## Fase C — "Categorías" en lugar de "Puntos de norma"

**Objetivo:** sustituir el campo puntoNorma por un campo **Categoría** de lista
cerrada gestionada por el admin. Valores iniciales: Control de plagas,
Inspección de contenedor, Higiene personal, Control de acceso, Limpieza y
desinfección, Limpieza de infraestructura.

### C1. Datos y reglas
- Nueva colección `categorias`: `{ nombre, activo, creadaPor, fechaCreacion }`.
- `js/firebase-init.js`: agregar `const colCategorias = db.collection("categorias");`
- `firestore.rules`: nueva regla dentro del match de documents:
  lectura para autenticados; create/update solo admin; delete false (mismo
  patrón que zonas, PERO sin permiso de creación para inspectores).
  **Entregar el archivo de reglas completo al usuario para que lo pegue en la
  consola Firebase (él publica las reglas, recordárselo explícitamente).**
- Siembra inicial: en `admin/catalogos.html`, al cargar la pestaña de
  Categorías, si la colección está vacía, crear los 6 valores por defecto
  (batch write, solo admin llega ahí). Definir la lista en `js/config.js` como
  `CATEGORIAS_INICIALES`.

### C2. Configuraciones (catalogos.html)
- Renombrar la pestaña "Puntos de norma" → "Categorías" (`data-tab`), con CRUD
  simple de nombre (copiar el patrón de la pestaña Zonas: crear, activar/
  desactivar, fusionar duplicado si aplica el mismo mecanismo).
- Quitar el formulario de puntos de norma (norma/cláusula/descripción) y
  `suscribirNormas()`; crear `suscribirCategorias()`.

### C3. Formularios
- `inspector.html`: reemplazar el campo "Punto de norma (opcional)" por
  `<select id="categoria" required>` "Categoría *" poblado desde
  `colCategorias` (activas). Guardar en el reporte:
  `categoria: <nombre>` (string) y eliminar `puntoNormaId/puntoNormaTexto/
  noAplicaNorma` de los reportes NUEVOS.
- `admin/validacion.html` (modal): reemplazar autocompletar de norma +
  checkbox "No aplica" por el mismo select de categoría. Al guardar:
  `categoria` en `cambios`. Para reportes viejos sin categoría: select vacío
  y mostrar debajo el texto legado `puntoNormaTexto` si existía (solo lectura).
- `js/reportes.js`: eliminar `crearAutocompletarPuntoNorma` cuando ya nadie la
  use; actualizar el comentario del modelo de datos (cabecera del archivo).

### C4. Consumidores
- `admin/dashboard.html`: gráfica "Reportes por punto de norma" → "Reportes por
  categoría": `contarPorCampo(validados, "categoria")` con fallback
  `r.categoria || r.puntoNormaTexto || "Sin categoría"` (hacer un map previo).
- Tabla "Top 10 repetitivos" (`js/dashboard.js` `calcularTopRepetitivos`):
  cambiar la clave `puntoNormaTexto` → categoría con el mismo fallback, y el
  encabezado de columna en dashboard.html.
- `js/export.js`: `textoNorma(r)` → `textoCategoria(r)` con fallback legado;
  etiqueta "Requisito de la Norma" → "Categoría" (ver Fase D, se rediseña).
- Excel: columna "Punto de norma" → "Categoría".

---

## Fase D — Exportación rediseñada estilo tarjetas (PDF y Word)

**Objetivo:** que el informe exportado se parezca a las tarjetas de la app
(captura de referencia del usuario: foto arriba, chip de gravedad, título en
índigo, meta con ícono/autor/fecha/turno), con **1 sola foto por reporte**.

### D1. Contenido de cada tarjeta
- Foto: SOLO la primera (`r.fotos[0]`), formato apaisado recortado (en pdfmake:
  `fit`; en docx: tamaño fijo ~ancho de la tarjeta).
- Chip de gravedad con color (Crítico #a3241b, Mayor #b45309, Menor #8a6100,
  Observación #555, fondo claro correspondiente — reutilizar la paleta WCAG del
  CSS).
- Título: `Categoría — Proceso` en color primario #2b2262, negrita.
- Zona/Área debajo del título (texto suave).
- Descripción (Observaciones) completa.
- Meta:
  - Autor: `inspectorNombre`
  - Revisado por: `validadoPorNombre` o "Pendiente de validación"
  - Fecha y hora: `formatearFechaHora(r.fechaHora)`
  - Turno: `r.turno || "Sin especificar"`

### D2. Layout
- Mantener el encabezado oficial actual (logo Empresas Galindo, título
  "Reporte Semanal de Inspección de Inocuidad", código SIG-FO-114 REV. 00,
  rango de fechas) — eso NO cambia.
- Cuerpo: cuadrícula de tarjetas **2 columnas × 2 filas = 4 tarjetas por
  página** (pdfmake: `table` de 2 columnas con celdas-tarjeta, `layout`
  con bordes suaves #d9d9e3 y `pageBreak` cada 2 filas; docx: tabla 2×N con
  bordes claros y celdas con margen interno).
- Ya NO agrupar por proceso con encabezados "HALLAZGOS" (el título de cada
  tarjeta ya lleva el proceso). Eliminar `agruparPorProceso`/
  `construirPaginasDeHallazgos` si quedan sin uso.
- Excel: sin cambios de estructura, solo el rename de columna (C4).

### D3. Detalles técnicos
- pdfmake no tiene border-radius: aceptar tarjetas rectangulares con borde
  fino y celda de relleno; priorizar jerarquía tipográfica y el chip de color.
- Las fotos se siguen descargando/incrustando con el mecanismo actual
  (dataURL); ahora solo 1 por reporte → el archivo pesa menos.

---

## Orden de ejecución y verificación

1. **Fase B** (más corta) → probar en preview: crear reporte eligiendo proceso
   de la lista.
2. **Fase C** → probar: siembra de categorías, nuevo reporte con categoría,
   validación, dashboard, y entregar `firestore.rules` completo al usuario
   PARA QUE ÉL LO PUBLIQUE antes de probar (sin reglas nuevas, la colección
   no será legible/escribible).
3. **Fase A** → probar subiendo un PDF real (pedir al usuario que lo haga con
   su archivo AutoCAD) y verificar que el plano cambia en inspector, dashboard
   y calibraciones. Recordarle recalibrar.
4. **Fase D** → generar PDF y Word de un rango con reportes y revisarlos
   visualmente (abrir el PDF en el navegador del preview si se puede, y pedir
   validación al usuario).
5. Solo después de la validación del usuario de TODAS las fases: un commit por
   fase (mensajes en español como los del historial) y push.

## Notas de compatibilidad
- Reportes viejos: conservan `puntoNormaId/puntoNormaTexto/noAplicaNorma`; todo
  consumidor debe usar el fallback `r.categoria || r.puntoNormaTexto || "Sin
  categoría"`. NO migrar documentos existentes.
- La colección `puntosNorma` queda huérfana (no borrarla; solo deja de usarse).
- `configuracion/planoArchivo` es un doc nuevo; las reglas actuales de
  `configuracion/{configId}` ya lo cubren (lectura auth, escritura admin).
