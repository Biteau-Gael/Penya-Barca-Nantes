import { readFile } from "node:fs/promises";
import path from "node:path";

const UPLOADS_DIR = path.join(process.cwd(), "uploads");

const ALLOWED_EXTENSIONS = new Set([".webp", ".jpg", ".jpeg", ".png"]);

export async function loader({ params }: { params: { "*": string } }) {
  const requestedPath = params["*"];

  // Prevent path traversal: reject if the normalized path escapes uploads dir
  const filePath = path.resolve(UPLOADS_DIR, requestedPath);
  if (!filePath.startsWith(UPLOADS_DIR + path.sep) && filePath !== UPLOADS_DIR) {
    return new Response("Not found", { status: 404 });
  }

  const ext = path.extname(filePath).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return new Response("Not found", { status: 404 });
  }

  try {
    const file = await readFile(filePath);

    const mimeTypes: Record<string, string> = {
      ".webp": "image/webp",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".png": "image/png",
    };

    return new Response(file, {
      headers: {
        "Content-Type": mimeTypes[ext] || "application/octet-stream",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
