import { readFile } from "node:fs/promises";
import path from "node:path";

const ALLOWED_EXTENSIONS = new Set([".webp", ".jpg", ".jpeg", ".png"]);

const MIME_TYPES: Record<string, string> = {
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
};

export async function loader({ params }: { params: { "*": string } }) {
  const baseDir = path.resolve(process.cwd(), "uploads");
  const filePath = path.resolve(baseDir, params["*"]);

  // Prevent path traversal
  if (!filePath.startsWith(baseDir + path.sep)) {
    return new Response("Forbidden", { status: 403 });
  }

  // Only serve allowed image types
  const ext = path.extname(filePath).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return new Response("Forbidden", { status: 403 });
  }

  try {
    const file = await readFile(filePath);

    return new Response(file, {
      headers: {
        "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
