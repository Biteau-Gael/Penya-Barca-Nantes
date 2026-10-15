import { readFile } from "node:fs/promises";
import path from "node:path";

const UPLOAD_BASE = path.join(process.cwd(), "uploads");

const ALLOWED_EXTENSIONS = new Set([".webp", ".jpg", ".jpeg", ".png"]);

export async function loader({ params }: { params: { "*": string } }) {
  const filePath = path.join(UPLOAD_BASE, params["*"]);

  // Prevent path traversal: resolved path must stay within uploads directory
  if (!filePath.startsWith(UPLOAD_BASE + path.sep) && filePath !== UPLOAD_BASE) {
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
