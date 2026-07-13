// ============================================================================
// INICIALIZACIÓN DE FIREBASE (Auth + Firestore)
// Usa el SDK "compat" de Firebase para poder trabajar con <script> simples,
// sin necesidad de bundler (Webpack/Vite), cumpliendo el requisito de
// "sitio 100% estático".
// ============================================================================

firebase.initializeApp(FIREBASE_CONFIG);

const auth = firebase.auth();
const db = firebase.firestore();

// Habilita caché local para que la app funcione mejor con conexión inestable
// (típico en planta industrial con señal wifi débil).
db.enablePersistence({ synchronizeTabs: true }).catch((err) => {
  console.warn("No se pudo habilitar persistencia offline de Firestore:", err.code);
});

// Referencias rápidas a colecciones
const colUsuarios = db.collection("usuarios");
const colReportes = db.collection("reportes");
const colZonas = db.collection("zonas");
const colProcesos = db.collection("procesos");
const colPuntosNorma = db.collection("puntosNorma");
const colCategorias = db.collection("categorias");
const colConfiguracion = db.collection("configuracion");
