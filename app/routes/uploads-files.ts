import { readFile } from "node:fs/promises";
import path from "node:path";

const UPLOADS_BASE = path.join(process.cwd(), "uploads");

export async function loader({ params }: { params: { "*": string } }) {
  const requested = path.normalize(params["*"] ?? "");
  const filePath = path.join(UPLOADS_BASE, requested);

  // Prevent path traversal outside the uploads directory
  if (!filePath.startsWith(UPLOADS_BASE + path.sep)) {
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
