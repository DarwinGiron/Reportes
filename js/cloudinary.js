// ============================================================================
// CLOUDINARY.JS - Compresión y subida de fotografías (unsigned upload)
// NUNCA se usa Firebase Storage: las fotos van a Cloudinary y solo se
// guarda la URL resultante en Firestore.
// ============================================================================

/**
 * Comprime un archivo de imagen en el navegador antes de subirlo.
 * Usa la librería browser-image-compression (cargada por CDN en el HTML).
 * @param {File} archivo
 * @returns {Promise<File>} archivo comprimido (<=300KB, <=1280px lado mayor)
 */
async function comprimirImagen(archivo) {
  try {
    const comprimido = await imageCompression(archivo, COMPRESION_CONFIG);
    return comprimido;
  } catch (error) {
    console.error("Error al comprimir imagen:", error);
    throw new Error("No se pudo procesar la fotografía. Intente con otra imagen.");
  }
}

/**
 * Sube un archivo (ya comprimido) a Cloudinary usando un preset "unsigned".
 * Devuelve la URL segura (https) de la imagen alojada.
 * @param {File|Blob} archivoComprimido
 * @param {function} onProgreso callback(porcentaje) opcional
 * @param {string} [nombreArchivo] nombre a usar si archivoComprimido es un
 *   Blob "pelado" sin nombre (ej. generado con canvas.toBlob), para que
 *   Cloudinary reciba una extensión razonable.
 */
function subirACloudinary(archivoComprimido, onProgreso, nombreArchivo) {
  return new Promise((resolve, reject) => {
    const formData = new FormData();
    if (nombreArchivo) formData.append("file", archivoComprimido, nombreArchivo);
    else formData.append("file", archivoComprimido);
    formData.append("upload_preset", CLOUDINARY_CONFIG.uploadPreset);
    if (CLOUDINARY_CONFIG.folder) {
      formData.append("folder", CLOUDINARY_CONFIG.folder);
    }

    const xhr = new XMLHttpRequest();
    const url = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CONFIG.cloudName}/image/upload`;
    xhr.open("POST", url, true);

    xhr.upload.onprogress = (evt) => {
      if (evt.lengthComputable && onProgreso) {
        onProgreso(Math.round((evt.loaded / evt.total) * 100));
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        const respuesta = JSON.parse(xhr.responseText);
        resolve(respuesta.secure_url);
      } else {
        reject(new Error("Error al subir la foto a Cloudinary (HTTP " + xhr.status + ")."));
      }
    };

    xhr.onerror = () => reject(new Error("Error de red al subir la fotografía. Verifique su conexión."));
    xhr.send(formData);
  });
}

/**
 * Flujo completo: comprime y sube una foto, con reintentos automáticos
 * ante fallas de red (hasta 2 reintentos).
 */
async function procesarYSubirFoto(archivo, onProgreso, intentos = 2) {
  const comprimida = await comprimirImagen(archivo);
  let ultimoError;
  for (let i = 0; i <= intentos; i++) {
    try {
      return await subirACloudinary(comprimida, onProgreso);
    } catch (err) {
      ultimoError = err;
      await new Promise((r) => setTimeout(r, 1000 * (i + 1))); // espera progresiva
    }
  }
  throw ultimoError;
}
