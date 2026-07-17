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
 * Lee configuracion/permisosInspector (los permisos configurables del rol
 * Inspector, editados por el admin desde Configuraciones -> Permisos).
 * Si el documento no existe todavía, devuelve un objeto vacío (sin permisos).
 */
async function obtenerPermisosInspector() {
  const doc = await colConfiguracion.doc("permisosInspector").get();
  return doc.exists ? doc.data() : {};
}

/**
 * Protege una página: exige sesión iniciada y, opcionalmente, un módulo
 * específico habilitado para el rol del usuario.
 * Redirige a index.html si no hay sesión, o a la página que le corresponde
 * si no tiene acceso al módulo pedido.
 * @param {string|null} modulo clave del módulo requerido ("dashboard",
 *   "validacion", "configuraciones", "informes") o null (cualquier usuario
 *   autenticado y activo, admin o inspector, sin importar permisos: usado
 *   por inspector.html, que siempre es de acceso obligatorio).
 * @param {function} callback recibe (user, perfil, permisos)
 */
function protegerPagina(modulo, callback) {
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

      // El admin siempre tiene acceso a todo; nunca se le exige permiso.
      if (!modulo || perfil.rol === "admin") {
        const permisos = perfil.rol === "admin" ? null : await obtenerPermisosInspector();
        callback(user, perfil, permisos);
        return;
      }

      // Un inspector: verificar que el módulo pedido esté habilitado.
      const permisos = await obtenerPermisosInspector();
      if (permisos[modulo] !== true) {
        window.location.href = rutaInspector();
        return;
      }
      callback(user, perfil, permisos);
    } catch (e) {
      console.error("Error validando sesión:", e);
      mostrarErrorSesion("Error de conexión al validar su sesión. Verifique su internet e intente de nuevo.");
    }
  });
}

/**
 * Oculta del menú los enlaces <a data-modulo="..."> a los que el usuario
 * actual (inspector) no tiene acceso. El admin y los enlaces sin
 * data-modulo (ej. "Nuevo reporte") nunca se ocultan.
 * @param {object} perfil perfil del usuario actual
 * @param {object|null} permisos permisos del inspector (null para admin)
 */
function aplicarVisibilidadNav(perfil, permisos) {
  document.querySelectorAll("[data-modulo]").forEach((el) => {
    const clave = el.getAttribute("data-modulo");
    const tieneAcceso = perfil.rol === "admin" || (permisos && permisos[clave] === true);
    el.style.display = tieneAcceso ? "" : "none";
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
