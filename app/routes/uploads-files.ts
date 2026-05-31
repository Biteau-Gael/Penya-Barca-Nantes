import { readFile } from "node:fs/promises";
import path from "node:path";

const UPLOAD_ROOT = path.join(process.cwd(), "uploads");

export async function loader({ params }: { params: { "*": string } }) {
  const filePath = path.resolve(UPLOAD_ROOT, params["*"]);

  // Prevent path traversal: reject any path that escapes the uploads directory
  if (!filePath.startsWith(UPLOAD_ROOT + path.sep) && filePath !== UPLOAD_ROOT) {
    return new Response("Forbidden", { status: 403 });
  }

  try {
    const file = await readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();

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
