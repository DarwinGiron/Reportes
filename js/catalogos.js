// ============================================================================
// CATALOGOS.JS - Administración de catálogos (zonas, procesos, puntos de
// norma, usuarios) y herramientas de depuración de datos creados por
// inspectores (renombrar, fusionar duplicados, desactivar).
// ============================================================================

// ---------------------------------------------------------------------------
// CRUD GENÉRICO para colecciones simples de catálogo (zonas / procesos)
// ---------------------------------------------------------------------------
async function crearItemCatalogo(coleccion, nombre, uidAdmin) {
  return coleccion.add({
    nombre: nombre.trim(),
    activo: true,
    creadaPor: uidAdmin,
    fechaCreacion: firebase.firestore.FieldValue.serverTimestamp(),
    origenInspector: false
  });
}

async function renombrarItemCatalogo(coleccion, id, nuevoNombre) {
  return coleccion.doc(id).update({ nombre: nuevoNombre.trim() });
}

async function desactivarItemCatalogo(coleccion, id) {
  return coleccion.doc(id).update({ activo: false });
}

async function reactivarItemCatalogo(coleccion, id) {
  return coleccion.doc(id).update({ activo: true });
}

/**
 * Fusiona un catálogo duplicado ("origen") dentro de otro ("destino"):
 * reasigna todos los reportes que usan el nombre de "origen" para que usen
 * el nombre de "destino", y desactiva "origen". Funciona tanto para zonas
 * (campo "zona" en reportes) como procesos (campo "proceso" en reportes).
 * @param {string} campoReporte "zona" | "proceso"
 */
async function fusionarItemsCatalogo(coleccion, campoReporte, idOrigen, nombreOrigen, idDestino, nombreDestino) {
  const afectados = await colReportes.where(campoReporte, "==", nombreOrigen).get();
  const lote = db.batch();
  afectados.docs.forEach((doc) => {
    lote.update(doc.ref, { [campoReporte]: nombreDestino });
  });
  lote.update(coleccion.doc(idOrigen), { activo: false, fusionadaEn: nombreDestino });
  await lote.commit();
  return afectados.size;
}

// ---------------------------------------------------------------------------
// PUNTOS DE NORMA (estructura: norma, clausula, descripcion)
// ---------------------------------------------------------------------------
async function crearPuntoNorma(norma, clausula, descripcion, uidAdmin) {
  return colPuntosNorma.add({
    norma: norma.trim(),
    clausula: clausula.trim(),
    descripcion: descripcion.trim(),
    activo: true,
    creadaPor: uidAdmin,
    fechaCreacion: firebase.firestore.FieldValue.serverTimestamp()
  });
}

async function actualizarPuntoNorma(id, datos) {
  return colPuntosNorma.doc(id).update(datos);
}

// ---------------------------------------------------------------------------
// USUARIOS (solo el admin gestiona; nadie se autorregistra)
// ---------------------------------------------------------------------------
/**
 * Invita a un nuevo inspector: crea la cuenta en Firebase Auth mediante una
 * instancia SECUNDARIA de la app (para no cerrar la sesión del admin) y le
 * envía un correo de restablecimiento de contraseña para que el inspector
 * defina su propia contraseña la primera vez. Crea también su documento en
 * la colección "usuarios" con rol "inspector".
 */
async function invitarInspector(correo, nombre, turno, uidAdmin) {
  const nombreAppSecundaria = "app-invitacion-" + Date.now();
  const appSecundaria = firebase.initializeApp(FIREBASE_CONFIG, nombreAppSecundaria);
  const authSecundaria = appSecundaria.auth();

  try {
    // Contraseña temporal aleatoria: el inspector nunca la usa, siempre
    // establece la suya propia mediante el correo de restablecimiento.
    const contrasenaTemporal = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now();
    const credencial = await authSecundaria.createUserWithEmailAndPassword(correo, contrasenaTemporal);
    const uidNuevo = credencial.user.uid;

    await colUsuarios.doc(uidNuevo).set({
      correo,
      nombre: nombre.trim(),
      turno: turno || null,
      rol: "inspector",
      activo: true,
      creadoPor: uidAdmin,
      fechaCreacion: firebase.firestore.FieldValue.serverTimestamp()
    });

    await authSecundaria.sendPasswordResetEmail(correo);
    await authSecundaria.signOut();
    return uidNuevo;
  } finally {
    await appSecundaria.delete();
  }
}

async function listarUsuarios() {
  // No se usa orderBy() en la consulta: Firestore excluye silenciosamente
  // los documentos que no tengan el campo por el que se ordena (por ejemplo,
  // usuarios creados manualmente en la consola sin fechaCreacion). Se ordena
  // en el cliente para incluir siempre a todos los usuarios.
  const snap = await colUsuarios.get();
  const usuarios = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  usuarios.sort((a, b) => (b.fechaCreacion?.seconds || 0) - (a.fechaCreacion?.seconds || 0));
  return usuarios;
}

async function activarDesactivarUsuario(uid, activo) {
  return colUsuarios.doc(uid).update({ activo });
}

async function actualizarTurnoUsuario(uid, turno) {
  return colUsuarios.doc(uid).update({ turno: turno || null });
}

async function actualizarRolUsuario(uid, rol) {
  return colUsuarios.doc(uid).update({ rol });
}

