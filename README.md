# Sistema de Gestión de Reportes de Inspección — COGUSA

Aplicación web estática (sin backend propio) para el registro, validación y
análisis de hallazgos de inspección de planta, alineada a FSSC 22000 v6,
ISO 22000:2018 e ISO/TS 22002-4.

## Stack

- **Frontend:** HTML + CSS + JavaScript vanilla (sitio 100% estático).
- **Base de datos:** Firebase Firestore (plan Spark, gratuito).
- **Autenticación:** Firebase Authentication (correo/contraseña).
- **Fotos:** Cloudinary (unsigned upload preset) — **nunca** Firebase Storage.
- **Compresión de imágenes:** `browser-image-compression` (300 KB / 1280px máx, en el navegador, antes de subir).
- **Mapa GPS:** Leaflet + OpenStreetMap (sin API key).
- **Gráficas:** Chart.js.
- **Exportación:** PDF con `pdfmake`, Word con `docx`.
- **Idioma:** Español.

## Estructura del proyecto

```
/index.html                  Login
/inspector.html               Formulario del inspector (mobile-first)
/admin/dashboard.html         Estadísticas y mapas de calor
/admin/validacion.html        Bandeja de validación de reportes
/admin/catalogos.html         CRUD de zonas, procesos, normas y usuarios
/css/styles.css                Estilos globales
/js/config.js                  Credenciales Firebase/Cloudinary (EDITAR)
/js/firebase-init.js           Inicialización de Firebase
/js/auth.js                    Autenticación y control de roles
/js/reportes.js                 Lógica de reportes, autocompletar, GPS, plano SVG
/js/cloudinary.js               Compresión y subida de fotos
/js/dashboard.js                Estadísticas, agrupaciones, mapas de calor
/js/catalogos.js                CRUD de catálogos e invitación de usuarios
/js/export.js                   Exportación PDF y Word
/assets/plano-planta-real.png   Plano real de distribución de áreas (fondo transparente)
/firestore.rules                Reglas de seguridad
/firestore.indexes.json         Índices compuestos necesarios
```

## Modelo de datos (Firestore)

- **usuarios/{uid}**: `correo, nombre, rol ("admin"|"inspector"), activo, creadoPor, fechaCreacion`
- **reportes/{id}**: `fechaHora, inspectorUid, inspectorNombre, zona, proceso, descripcion, puntoNormaId, puntoNormaTexto, noAplicaNorma, fotos[], gps{lat,lng}, gpsError, planoPunto{x,y}, estado ("pendiente"|"validado"), gravedad, validadoPor, validadoPorNombre, fechaValidacion, historialValidacion[], creadoEn`
- **zonas/{id}**: `nombre, activo, creadaPor, fechaCreacion, origenInspector`
- **procesos/{id}**: igual estructura que zonas
- **puntosNorma/{id}**: `norma, clausula, descripcion, activo, creadaPor, fechaCreacion`

Las reglas completas están en [`firestore.rules`](firestore.rules) y los
índices compuestos requeridos en [`firestore.indexes.json`](firestore.indexes.json).

## Plano real usado para marcar el hallazgo (Nuevo reporte)

El archivo [`assets/plano-planta-real.png`](assets/plano-planta-real.png) (el
plano oficial de distribución de áreas por proceso, con el fondo blanco del
papel vuelto transparente) es el que usa el **inspector** para marcar el
punto exacto del hallazgo tocando la pantalla del celular, y el que se usa en
el mapa de calor "Plano de planta" del Dashboard. Funciona sin conexión a
mapas externos.

El punto marcado se guarda como porcentaje (0-100) del ancho/alto mostrado
del plano (`planoPunto.x`, `planoPunto.y`), por lo que sigue siendo válido
sin importar el tamaño de pantalla.

**Para reemplazar la imagen** (por ejemplo, si se actualiza el plano
oficial): sustituya `assets/plano-planta-real.png` por la nueva imagen (mismo
nombre; debe tener fondo transparente en formato PNG) y vuelva a calibrar el
tamaño desde **Catálogos → Plano del reporte** si la proporción cambió.

**Para ajustar el tamaño/proporción** con la que se muestra (ancho y alto
independientes entre sí, como al redimensionar una imagen en Word): vaya a
**Catálogos → Plano del reporte**, arrastre la esquina del recuadro punteado
y presione "Guardar tamaño". Este tamaño se guarda en Firestore
(`configuracion/planoReporte`) y se aplica tanto en "Nuevo reporte" como en
el Dashboard.

## Plano real superpuesto sobre el mapa GPS (Dashboard)

Además del plano interactivo, el Dashboard muestra el **plano real de la
planta** superpuesto directamente sobre el mapa de calle real (OpenStreetMap),
georreferenciado, para que los pines GPS de los hallazgos aparezcan en su
ubicación exacta dentro del plano.

Esto se logra con la librería [Leaflet.DistortableImage](https://github.com/publiclab/Leaflet.DistortableImage)
(cargada por CDN, sin instalación), que permite fijar una imagen sobre 4
puntos lat/lng. Las 4 esquinas quedan guardadas en Firestore
(`configuracion/planoImagen`) y son la base que usa la calibración del GPS
(ver más abajo) para convertir una coordenada GPS en su posición dentro del
plano. La pantalla para editar esas esquinas arrastrando/rotando/escalando ya
no está expuesta en Catálogos (se retiró para simplificar la interfaz); si
alguna vez es necesario volver a mover la posición del plano sobre el mapa,
puede restaurarse esa vista o editarse el documento `configuracion/planoImagen`
directamente en la consola de Firebase.

**Para reemplazar la imagen del plano real** (por ejemplo, si se actualiza el
plano oficial): sustituya `assets/plano-planta-real.png` por la nueva imagen
(mismo nombre, con fondo transparente) y vuelva a ajustar la calibración si
las proporciones cambiaron.

## Calibración del GPS (Catálogos → Ubicación de planta)

El GPS de los celulares puede ubicar a la persona en un punto ligeramente
distinto de donde realmente está (más notorio dentro de naves industriales
con techo metálico). Desde **Catálogos → Ubicación de planta** el admin
puede corregir ese error:

1. Presione **"Usar mi ubicación actual"** parado en un punto conocido de la
   planta. El pin aparece solo sobre el plano (igual que en "Nuevo reporte"),
   en el lugar donde el GPS cree que está.
2. Si no coincide con su posición real, toque el plano en el punto correcto.
3. Presione **"Guardar calibración"**. La corrección (diferencia de
   latitud/longitud) se guarda en `configuracion/calibracionGPS` y
   `capturarGPS()` la suma automáticamente a toda captura nueva, tanto al
   guardar el reporte como al ubicar el pin automático en el plano.
4. "Quitar calibración" regresa a usar el GPS tal como lo entrega el
   dispositivo, sin corrección.

---

## GUÍA DE DESPLIEGUE PASO A PASO

### 1. Crear el proyecto Firebase

1. Vaya a https://console.firebase.google.com y cree un proyecto nuevo.
2. En **Compilación > Authentication**, haga clic en "Comenzar" y habilite
   el proveedor **Correo electrónico/contraseña**.
3. En **Compilación > Firestore Database**, cree la base de datos en modo
   **producción** (las reglas de este repo la protegen igual) y elija la
   región más cercana (ej. `us-central1`).
4. En **Configuración del proyecto > General > Tus apps**, agregue una app
   web (ícono `</>`), asígnele un nombre y copie el objeto `firebaseConfig`.

### 2. Configurar credenciales en `js/config.js`

Abra [`js/config.js`](js/config.js) y reemplace los valores de
`FIREBASE_CONFIG` con los que copió en el paso anterior.

### 3. Publicar las reglas e índices de Firestore

Opción A — desde la consola web:
- Vaya a **Firestore Database > Reglas**, pegue el contenido de
  [`firestore.rules`](firestore.rules) y publique.
- Vaya a **Firestore Database > Índices** y cree manualmente los índices
  compuestos listados en [`firestore.indexes.json`](firestore.indexes.json)
  (Firestore también le ofrecerá crearlos automáticamente la primera vez
  que una consulta los necesite y falle, mostrando un enlace directo).

Opción B — con Firebase CLI (si tiene Node.js instalado):
```bash
npm install -g firebase-tools
firebase login
firebase init firestore   # seleccione el proyecto, acepte usar los archivos existentes
firebase deploy --only firestore:rules,firestore:indexes
```

### 4. Crear el primer usuario administrador

Como nadie puede autorregistrarse, el primer admin se crea manualmente
una única vez:

1. En **Authentication > Users**, haga clic en "Agregar usuario", ingrese
   su correo y una contraseña temporal.
2. Copie el **UID** generado.
3. En **Firestore Database > Datos**, cree la colección `usuarios` con un
   documento cuyo ID sea ese UID, con los campos:
   ```
   correo: "coordinador@cogusa.com"
   nombre: "Nombre del Coordinador SGI"
   rol: "admin"
   activo: true
   fechaCreacion: (timestamp actual)
   ```
4. Inicie sesión con ese correo/contraseña en `index.html`. Desde
   **Catálogos > Usuarios** ya podrá invitar a los inspectores (el resto
   de usuarios se gestionan desde la app, nunca manualmente).

### 5. Precargar catálogos iniciales (opcional pero recomendado)

Desde **Catálogos** (ya con sesión de admin), agregue zonas y procesos
base: Corrugación, Convertidoras, Bodega MP, Bodega PT, Despacho,
Mantenimiento, Oficinas, Comedor; y cargue los puntos de norma de FSSC
22000 v6 / ISO 22000:2018 / ISO/TS 22002-4 que utilice su organización.

### 6. Crear cuenta de Cloudinary y el "unsigned upload preset"

1. Cree una cuenta gratuita en https://cloudinary.com.
2. En el **Dashboard**, copie el **Cloud name**.
3. Vaya a **Settings (⚙) > Upload > Upload presets > Add upload preset**.
4. Configure:
   - **Signing Mode:** `Unsigned` (obligatorio, para subir sin backend).
   - **Folder:** opcional, ej. `cogusa_inspecciones`.
   - Guarde y copie el **nombre del preset**.
5. En [`js/config.js`](js/config.js), complete `CLOUDINARY_CONFIG.cloudName`
   y `CLOUDINARY_CONFIG.uploadPreset`.

### 7. Probar localmente

Sirva la carpeta con cualquier servidor estático (no puede abrirse con
`file://` porque el navegador bloquea `fetch` al SVG y a módulos):

```bash
npx serve .
# o
python -m http.server 8080
```

Abra `http://localhost:PUERTO/index.html`.

### 8. Publicar en GitHub Pages

1. Suba el proyecto a un repositorio de GitHub.
2. En **Settings > Pages**, seleccione la rama (ej. `main`) y la carpeta
   raíz (`/`).
3. GitHub Pages publicará el sitio en `https://usuario.github.io/repo/`.
4. En **Authentication > Settings > Authorized domains** de Firebase,
   agregue ese dominio de GitHub Pages.

### 9. Publicar en Vercel (alternativa)

1. Cree una cuenta gratuita en https://vercel.com e importe el repositorio.
2. Como es un sitio estático, no requiere configuración de build (Framework
   Preset: "Other" / "Static").
3. Al desplegar, Vercel le dará un dominio `https://proyecto.vercel.app`.
4. Agregue también ese dominio en **Authentication > Settings > Authorized
   domains** de Firebase.

### 10. Costos y límites del plan gratuito

- **Firebase Spark:** gratuito; Firestore incluye 1 GiB de almacenamiento y
  50,000 lecturas / 20,000 escrituras diarias — más que suficiente para el
  volumen típico de reportes de una planta.
- **Cloudinary Free:** 25 créditos mensuales (~25 GB de almacenamiento o
  transformaciones), de sobra gracias a la compresión previa a 300 KB.
- **GitHub Pages / Vercel:** gratuitos para sitios estáticos personales u
  organizacionales pequeños.

---

## Notas de seguridad

- Las fotos nunca pasan por un servidor propio: se comprimen en el
  navegador del inspector y se suben directo a Cloudinary con un preset
  *unsigned* (no requiere ni expone API secret).
- Las reglas de Firestore (`firestore.rules`) son la única barrera real de
  seguridad de datos, ya que no existe backend intermedio: verifíquelas y
  pruébelas con el **Simulador de reglas** de la consola de Firebase antes
  de ir a producción.
