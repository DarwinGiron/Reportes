// ============================================================================
// AUTH.JS - Autenticación y control de roles
// ============================================================================
// Modelo de datos: colección "usuarios", documento con ID = uid de Firebase Auth
// { correo: string, rol: "admin"|"inspector", activo: bool, nombre: string,
//   creadoPor: uid, fechaCreacion: timestamp }
// ============================================================================

/**
 * Devuelve el documento de usuario (rol, activo, nombre) del usuario autenticado.
 * Si no existe el documento o el usuario está inactivo, cierra la sesión.
 */
async function obtenerPerfilUsuario(uid) {
  const doc = await colUsuarios.doc(uid).get();
  if (!doc.exists) return null;
  return { id: doc.id, ...doc.data() };
}

/**
 * Protege una página: exige sesión iniciada y, opcionalmente, un rol específico.
 * Redirige a index.html si no cumple. Devuelve el perfil vía callback.
 * @param {string|null} rolRequerido "admin", "inspector" o null (cualquiera)
 * @param {function} callback recibe (user, perfil)
 */
function protegerPagina(rolRequerido, callback) {
  auth.onAuthStateChanged(async (user) => {
    if (!user) {
      window.location.href = rutaRelativaIndex();
      return;
    }
    try {
      const perfil = await obtenerPerfilUsuario(user.uid);
      if (!perfil) {
        mostrarErrorSesion("Su cuenta no tiene un perfil asignado en el sistema. Contacte al coordinador SGI.");
        return;
      }
      if (perfil.activo === false) {
        mostrarErrorSesion("Su cuenta ha sido desactivada. Contacte al coordinador SGI.");
        return;
      }
      if (rolRequerido && perfil.rol !== rolRequerido) {
        // Redirige a la página que le corresponde según su rol
        window.location.href = perfil.rol === "admin" ? rutaAdminDashboard() : rutaInspector();
        return;
      }
      callback(user, perfil);
    } catch (e) {
      console.error("Error validando sesión:", e);
      mostrarErrorSesion("Error de conexión al validar su sesión. Verifique su internet e intente de nuevo.");
    }
  });
}

function rutaRelativaIndex() {
  // Calcula ruta relativa a index.html según profundidad de carpetas
  return window.location.pathname.includes("/admin/") ? "../index.html" : "index.html";
}
function rutaAdminDashboard() {
  return window.location.pathname.includes("/admin/") ? "dashboard.html" : "admin/dashboard.html";
}
function rutaInspector() {
  return window.location.pathname.includes("/admin/") ? "../inspector.html" : "inspector.html";
}

function mostrarErrorSesion(mensaje) {
  const cont = document.getElementById("app") || document.body;
  cont.innerHTML = `
    <div class="pantalla-error">
      <p>⚠️ ${mensaje}</p>
      <button onclick="cerrarSesionYSalir()" class="btn btn-primario">Cerrar sesión</button>
    </div>`;
}

function cerrarSesionYSalir() {
  auth.signOut().finally(() => (window.location.href = rutaRelativaIndex()));
}

/**
 * Inicia sesión con correo/contraseña. Usado desde index.html.
 */
async function iniciarSesion(correo, contrasena) {
  return auth.signInWithEmailAndPassword(correo, contrasena);
}

/**
 * Envía correo de restablecimiento de contraseña (usado también para que el
 * inspector recién invitado establezca su contraseña la primera vez).
 */
async function enviarRestablecimiento(correo) {
  return auth.sendPasswordResetEmail(correo);
}
