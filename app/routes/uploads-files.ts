import { readFile } from "node:fs/promises";
import path from "node:path";

export async function loader({ params }: { params: { "*": string } }) {
  const uploadDir = path.join(process.cwd(), "uploads");
  const filePath = path.resolve(uploadDir, params["*"]);

  // Prevent path traversal: resolved path must stay within uploads/
  if (!filePath.startsWith(uploadDir + path.sep) && filePath !== uploadDir) {
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
