import { readFile } from "node:fs/promises";
import path from "node:path";

const UPLOAD_BASE = path.resolve(process.cwd(), "uploads");

const ALLOWED_EXTENSIONS = new Set([".webp", ".jpg", ".jpeg", ".png"]);

const MIME_TYPES: Record<string, string> = {
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
};

export async function loader({ params }: { params: { "*": string } }) {
  const requestedPath = params["*"];

  // Reject paths with null bytes
  if (requestedPath.includes("\0")) {
    return new Response("Not found", { status: 404 });
  }

  const filePath = path.resolve(UPLOAD_BASE, requestedPath);

  // Prevent path traversal: resolved path must stay inside uploads/
  if (!filePath.startsWith(UPLOAD_BASE + path.sep) && filePath !== UPLOAD_BASE) {
    return new Response("Not found", { status: 404 });
  }

  const ext = path.extname(filePath).toLowerCase();

  // Only serve allowed image types
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
