import sharp from 'sharp';

/**
 * Huella perceptual SIMPLE (dHash de 64 bits, 16 caracteres hexadecimales) con sharp, sin dependencias nuevas:
 * se reduce la imagen a 9×8 en escala de grises y cada bit dice si un píxel es más claro que el de su derecha.
 * Dos fotos casi iguales (otro tamaño, recompresión, un ligero recorte de bordes) dan huellas a pocos bits de distancia
 * (ver `hammingHex` y `NEAR_DUPLICATE_DISTANCE`). Limitaciones: no detecta la misma escena con otro encuadre ni un giro/espejo.
 */
export async function perceptualHash(bytes: Uint8Array): Promise<string> {
  // Dos pasos (72×64 y luego 9×8 con un desenfoque leve): una reducción directa a 9×8 es muy sensible al reescalado y a la recompresión.
  const big = await sharp(bytes, { failOn: 'none' })
    .rotate()
    .flatten({ background: '#ffffff' })
    .resize(72, 64, { fit: 'fill' })
    .toColourspace('b-w')
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { data, info } = await sharp(big.data, { raw: { width: 72, height: 64, channels: big.info.channels } })
    .blur(0.8)
    .resize(9, 8, { fit: 'fill' })
    .toColourspace('b-w')
    .raw()
    .toBuffer({ resolveWithObject: true });
  const stride = info.channels;
  let hex = '';
  for (let y = 0; y < 8; y++) {
    let nibble = 0;
    for (let x = 0; x < 8; x++) {
      const left = data[(y * 9 + x) * stride]!;
      const right = data[(y * 9 + x + 1) * stride]!;
      nibble = (nibble << 1) | (left > right ? 1 : 0);
      if (x % 4 === 3) { hex += nibble.toString(16); nibble = 0; }
    }
  }
  return hex;
}
