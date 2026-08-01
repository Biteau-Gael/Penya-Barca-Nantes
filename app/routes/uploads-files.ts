import { readFile } from "node:fs/promises";
import path from "node:path";

const UPLOADS_BASE = path.resolve(process.cwd(), "uploads");

const ALLOWED_EXTENSIONS: Record<string, string> = {
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
};

export async function loader({ params }: { params: { "*": string } }) {
  const requested = params["*"] ?? "";
  const filePath = path.resolve(UPLOADS_BASE, requested);

  // Prevent path traversal: resolved path must stay inside uploads/
  if (!filePath.startsWith(UPLOADS_BASE + path.sep) && filePath !== UPLOADS_BASE) {
    return new Response("Forbidden", { status: 403 });
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = ALLOWED_EXTENSIONS[ext];

  // Reject unknown file extensions
  if (!contentType) {
    return new Response("Forbidden", { status: 403 });
  }

  try {
    const file = await readFile(filePath);
    return new Response(file, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
