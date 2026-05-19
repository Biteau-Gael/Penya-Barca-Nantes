import { readFile } from "node:fs/promises";
import path from "node:path";

const UPLOADS_DIR = path.resolve(process.cwd(), "uploads");

export async function loader({ params }: { params: { "*": string } }) {
  const filePath = path.resolve(UPLOADS_DIR, params["*"]);

  // Prevent path traversal: reject any path outside uploads/
  if (!filePath.startsWith(UPLOADS_DIR + path.sep)) {
    return new Response("Not found", { status: 404 });
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
