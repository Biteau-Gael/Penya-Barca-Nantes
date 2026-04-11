import sharp from "sharp";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const UPLOAD_DIR = path.join(process.cwd(), "uploads", "avatars");
const MAX_SIZE = 2 * 1024 * 1024; // 2 Mo
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];

export async function processAvatar(
  file: File,
  userId: string,
): Promise<string> {
  if (!ALLOWED_TYPES.includes(file.type)) {
    throw new Error("Format non supporté. Utilisez JPEG, PNG ou WebP.");
  }

  if (file.size > MAX_SIZE) {
    throw new Error("Le fichier dépasse la taille maximale de 2 Mo.");
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  const webpBuffer = await sharp(buffer)
    .resize(256, 256, { fit: "cover" })
    .webp({ quality: 80 })
    .toBuffer();

  await mkdir(UPLOAD_DIR, { recursive: true });

  const filename = `${userId}.webp`;
  const filepath = path.join(UPLOAD_DIR, filename);
  await writeFile(filepath, webpBuffer);

  return `/uploads/avatars/${filename}`;
}
