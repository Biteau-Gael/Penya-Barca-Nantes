import { readFile } from "node:fs/promises";
import path from "node:path";

const UPLOAD_DIR = path.join(process.cwd(), "uploads");

export async function loader({ params }: { params: { "*": string } }) {
  const requested = params["*"];

  // Reject empty paths, absolute paths, or traversal sequences
  if (!requested || path.isAbsolute(requested) || requested.includes("..")) {
    return new Response("Not found", { status: 404 });
  }

  const filePath = path.join(UPLOAD_DIR, requested);

  // Final check: resolved path must stay within uploads directory
  if (!filePath.startsWith(UPLOAD_DIR + path.sep)) {
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
