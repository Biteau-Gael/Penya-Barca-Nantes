import { readFile } from "node:fs/promises";
import path from "node:path";

export async function loader({ params }: { params: { "*": string } }) {
  const uploadsDir = path.resolve(process.cwd(), "uploads");
  const requestedPath = path.resolve(uploadsDir, params["*"]);

  // Prevent path traversal: ensure resolved path stays within uploads directory
  if (!requestedPath.startsWith(uploadsDir + path.sep) && requestedPath !== uploadsDir) {
    return new Response("Not found", { status: 404 });
  }

  const filePath = requestedPath;

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
