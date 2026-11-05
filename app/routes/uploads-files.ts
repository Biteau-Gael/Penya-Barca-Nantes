import { readFile } from "node:fs/promises";
import path from "node:path";

const UPLOAD_BASE = path.join(process.cwd(), "uploads");

const ALLOWED_EXTENSIONS = new Set([".webp", ".jpg", ".jpeg", ".png"]);

const MIME_TYPES: Record<string, string> = {
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
};

export async function loader({ params }: { params: { "*": string } }) {
  const rawParam = params["*"] ?? "";

  // Reject any path that contains traversal sequences before resolving
  if (rawParam.includes("..") || rawParam.includes("\0")) {
    return new Response("Not found", { status: 404 });
  }

  const filePath = path.resolve(UPLOAD_BASE, rawParam);

  // Ensure the resolved path stays inside the uploads directory
  if (!filePath.startsWith(UPLOAD_BASE + path.sep) && filePath !== UPLOAD_BASE) {
    return new Response("Not found", { status: 404 });
  }

  const ext = path.extname(filePath).toLowerCase();

  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return new Response("Not found", { status: 404 });
  }

  try {
    const file = await readFile(filePath);

    return new Response(file, {
      headers: {
        "Content-Type": MIME_TYPES[ext],
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
