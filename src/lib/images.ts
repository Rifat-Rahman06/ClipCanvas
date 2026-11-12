export interface CompressedImage {
  blob: Blob;
  width: number;
  height: number;
  mimeType: string;
}

const MAX_IMAGE_EDGE = 1800;
const IMAGE_QUALITY = 0.84;

/**
 * Normalizes pasted images to a bounded WebP (or JPEG fallback) so a few
 * screenshots do not consume the whole extension storage quota.
 */
export async function compressImage(file: Blob): Promise<CompressedImage> {
  const bitmap = await loadBitmap(file);
  const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) {
    closeBitmap(bitmap);
    throw new Error('This browser could not prepare the image.');
  }
  context.drawImage(bitmap, 0, 0, width, height);
  closeBitmap(bitmap);

  let blob = await canvasToBlob(canvas, 'image/webp', IMAGE_QUALITY);
  let mimeType = 'image/webp';
  if (!blob) {
    blob = await canvasToBlob(canvas, 'image/jpeg', IMAGE_QUALITY);
    mimeType = 'image/jpeg';
  }
  if (!blob) {
    throw new Error('This image could not be converted for the notebook.');
  }
  return { blob, width, height, mimeType };
}

async function loadBitmap(file: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file);
    } catch {
      // Fall through to the HTMLImageElement path for formats such as SVG.
    }
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('This image format is not supported.'));
    };
    image.src = url;
  });
}

function closeBitmap(bitmap: ImageBitmap | HTMLImageElement): void {
  if ('close' in bitmap && typeof bitmap.close === 'function') bitmap.close();
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality: number,
): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), type, quality);
  });
}
