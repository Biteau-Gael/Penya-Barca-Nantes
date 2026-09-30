import { readFile } from "node:fs/promises";
import path from "node:path";

export async function loader({ params }: { params: { "*": string } }) {
  const uploadRoot = path.join(process.cwd(), "uploads");
  const filePath = path.resolve(uploadRoot, params["*"]);

  // Guard against path traversal: resolved path must stay inside uploadRoot
  if (!filePath.startsWith(uploadRoot + path.sep) && filePath !== uploadRoot) {
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
