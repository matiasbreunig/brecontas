import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/server/auth";
import fs from "fs";
import path from "path";

const MIME_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".pdf": "application/pdf",
  ".heic": "image/heic",
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const pathSegments = (await params).path;
  const filePath = pathSegments.join("/");

  // Security: ensure the path starts with the user's ID
  if (!filePath.startsWith(session.user.id)) {
    return NextResponse.json({ error: "Acesso negado" }, { status: 403 });
  }

  // Prevent path traversal
  const normalizedPath = path.normalize(filePath);
  if (normalizedPath.includes("..")) {
    return NextResponse.json({ error: "Caminho inválido" }, { status: 400 });
  }

  const absPath = path.join(process.cwd(), "data", "uploads", normalizedPath);

  if (!fs.existsSync(absPath)) {
    return NextResponse.json({ error: "Arquivo não encontrado" }, { status: 404 });
  }

  const buffer = fs.readFileSync(absPath);
  const ext = path.extname(absPath).toLowerCase();
  const contentType = MIME_TYPES[ext] || "application/octet-stream";

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "private, max-age=3600",
    },
  });
}
