import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/server/auth";
import fs from "fs";
import path from "path";

export const dynamic = "force-dynamic";

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

  // Resolve first, then check ownership against the resolved path. Checking the
  // raw path first let ".." slip through: "<myId>/%2e%2e/<otherId>/receipt.pdf"
  // passed the prefix check and only then collapsed into the other user's
  // directory. Segments arrive already URL-decoded from the App Router.
  const uploadsRoot = path.resolve(process.cwd(), "data", "uploads");
  const userRoot = path.join(uploadsRoot, session.user.id);
  const absPath = path.resolve(uploadsRoot, ...pathSegments);

  if (absPath !== userRoot && !absPath.startsWith(userRoot + path.sep)) {
    return NextResponse.json({ error: "Acesso negado" }, { status: 403 });
  }

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
