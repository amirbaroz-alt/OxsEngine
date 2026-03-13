const MAX_DIMENSION = 1600;
const JPEG_QUALITY = 0.8;

const FORCE_JPEG_TYPES = new Set([
  "image/heic", "image/heif", "image/bmp", "image/tiff", "image/tif",
]);

function shouldConvertToJpeg(mimeType: string): boolean {
  return mimeType === "image/jpeg" || FORCE_JPEG_TYPES.has(mimeType);
}

export async function compressImageFile(file: File): Promise<File> {
  if (!file.type.startsWith("image/")) return file;

  const needsResize = await needsResizing(file);
  const convertToJpeg = shouldConvertToJpeg(file.type);

  if (!needsResize && !convertToJpeg) return file;
  if (!needsResize && file.type === "image/jpeg") return file;

  const img = await loadImage(file);
  let { width, height } = img;

  const scale = Math.min(MAX_DIMENSION / width, MAX_DIMENSION / height, 1);
  width = Math.round(width * scale);
  height = Math.round(height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0, width, height);

  const outType = convertToJpeg ? "image/jpeg" : file.type;
  const outExt = convertToJpeg ? ".jpg" : file.name.match(/\.[^.]+$/)?.[0] || ".png";

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("toBlob failed"))),
      outType,
      outType === "image/jpeg" ? JPEG_QUALITY : undefined,
    );
  });

  const originalName = file.name.replace(/\.[^.]+$/, "");
  return new File([blob], `${originalName}${outExt}`, { type: outType });
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(img.src);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(img.src);
      reject(new Error("Failed to load image"));
    };
    img.src = URL.createObjectURL(file);
  });
}

async function needsResizing(file: File): Promise<boolean> {
  const img = await loadImage(file);
  return img.width > MAX_DIMENSION || img.height > MAX_DIMENSION;
}
