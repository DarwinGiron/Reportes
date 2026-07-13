// ============================================================================
// CONFIGURACIÓN GLOBAL DE LA APLICACIÓN
// COGUSA - Sistema de Gestión de Reportes de Inspección (SGI)
// ============================================================================
// INSTRUCCIONES: reemplace los valores de ejemplo con sus credenciales reales
// de Firebase y Cloudinary antes de desplegar. Vea README.md sección
// "GUÍA DE DESPLIEGUE" para el paso a paso completo.
// ============================================================================

// --- Credenciales de Firebase --------------------------------------------
// Se obtienen en: Firebase Console > Configuración del proyecto > General
// > Tus apps > SDK de Firebase (config)
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyAn-pxaMeu5R2V8FqMT_Gvrp1KL2XPLUd4",
  authDomain: "reportes-5e94c.firebaseapp.com",
  projectId: "reportes-5e94c",
  storageBucket: "reportes-5e94c.firebasestorage.app",
  messagingSenderId: "596353467554",
  appId: "1:596353467554:web:b1eb2ae5d5072a07eac3fb"
};

// --- Credenciales de Cloudinary (subida NO firmada / unsigned) ------------
// Se obtienen en: Cloudinary Console > Settings > Upload > Upload presets
// El "upload preset" debe estar configurado como "Unsigned".
const CLOUDINARY_CONFIG = {
  cloudName: "o93v6nb1",
  uploadPreset: "cogusa_inspecciones",
  // Carpeta dentro de Cloudinary donde se organizan las fotos (opcional)
  // Nota: como el preset ya tiene su propia "Carpeta de recursos" configurada
  // en Cloudinary, se deja folder en null para no duplicar/entrar en conflicto.
  folder: null
};

// --- Parámetros de compresión de imágenes ---------------------------------
const COMPRESION_CONFIG = {
  maxSizeMB: 0.3,        // 300 KB máximo por foto
  maxWidthOrHeight: 1280, // 1280px máximo en el lado mayor
  useWebWorker: true
};

// --- Datos generales de la empresa (usados en encabezados de informes) ---
const EMPRESA_CONFIG = {
  nombre: "Corrugadora Guatemala, S.A. (COGUSA)",
  sistema: "Sistema de Gestión de Inocuidad Alimentaria - FSSC 22000",
  tituloInforme: "Reporte Semanal de Inspección de Inocuidad",
  // Logo mostrado en el encabezado del Word (ruta relativa a la raíz del sitio)
  logo: "assets/logo-empresa.png",
  // Código y revisión del formulario controlado (esquina superior derecha del
  // encabezado, como en el formato oficial de la empresa). Ajuste según su
  // sistema de gestión documental.
  codigoFormulario: "SIG-FO-114",
  revisionFormulario: "REV. 00"
};

// --- Niveles de gravedad usados en la validación de reportes --------------
const NIVELES_GRAVEDAD = ["Crítico", "Mayor", "Menor", "Observación"];

// Orden numérico de severidad (usado para ordenar tablas y rankings)
const PESO_GRAVEDAD = {
  "Crítico": 4,
  "Mayor": 3,
  "Menor": 2,
  "Observación": 1
};

// --- Turnos disponibles para asignar a cada inspector ---------------------
const NIVELES_TURNO = ["Matutino", "Vespertino", "Nocturno", "Mixto"];

// --- Turnos de trabajo en los que se realiza la inspección (se elige al
// crear cada reporte; es independiente del turno fijo asignado al inspector) --
const NIVELES_TURNO_REPORTE = ["Turno #1", "Turno #2", "Turno #3"];

// --- Ubicación de planta por defecto (se usa solo si el admin todavía no ha
// guardado la ubicación real desde el mapa del dashboard) -----------------
const UBICACION_PLANTA_POR_DEFECTO = { lat: 14.6349, lng: -90.5069 }; // Ciudad de Guatemala

// --- Categorías iniciales del reporte (reemplazan a "puntos de norma") ---
// Se siembran una sola vez si la colección "categorias" está vacía; luego el
// admin puede agregar/desactivar categorías desde Configuraciones.
const CATEGORIAS_INICIALES = [
  "Control de plagas",
  "Inspección de contenedor",
  "Higiene personal",
  "Control de acceso",
  "Limpieza y desinfección",
  "Limpieza de infraestructura"
];
