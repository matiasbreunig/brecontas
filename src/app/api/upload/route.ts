import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/server/auth";
import { db } from "@/server/db";
import { inboxItems, attachments } from "@/server/db/schema";
import { generateId } from "@/lib/id";
import { nowTimestamp } from "@/lib/date";
import { extractFromImage, formatOcrSummary } from "@/server/services/ocr/extractor";
import fs from "fs";
import path from "path";

const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/heic",
  "image/heif",
  "application/pdf",
]);

const MAX_SIZE = 10 * 1024 * 1024; // 10MB

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const userId = session.user.id;

  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "Nenhum arquivo enviado" }, { status: 400 });
    }

    // Validate type
    let mimeType = file.type.toLowerCase();
    const originalName = file.name;
    const ext = path.extname(originalName).toLowerCase();

    // Handle HEIC without proper mime type
    if (ext === ".heic" || ext === ".heif") {
      mimeType = "image/heic";
    }

    if (!ALLOWED_TYPES.has(mimeType)) {
      return NextResponse.json(
        { error: `Tipo não suportado: ${mimeType}. Use JPG, PNG, HEIC ou PDF.` },
        { status: 400 }
      );
    }

    if (file.size > MAX_SIZE) {
      return NextResponse.json({ error: "Arquivo muito grande. Máximo 10MB." }, { status: 400 });
    }

    // Read file buffer
    const arrayBuffer = await file.arrayBuffer();
    let buffer = Buffer.from(arrayBuffer);
    let finalExt = ext;
    let finalMimeType = mimeType;

    // Convert HEIC to JPEG
    if (mimeType === "image/heic" || mimeType === "image/heif") {
      try {
        const heicConvert = (await import("heic-convert")).default;
        const jpegBuffer = await heicConvert({
          buffer: new Uint8Array(buffer),
          format: "JPEG",
          quality: 0.85,
        });
        buffer = Buffer.from(jpegBuffer);
        finalExt = ".jpg";
        finalMimeType = "image/jpeg";
      } catch (e) {
        console.error("HEIC conversion failed, storing original:", e);
        // Store as-is, OCR might not work but file is preserved
      }
    }

    // Store file
    const now = new Date();
    const year = now.getFullYear().toString();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const fileId = generateId();
    const filename = `${fileId}${finalExt}`;
    const relDir = path.join(userId, year, month);
    const absDir = path.join(process.cwd(), "data", "uploads", relDir);

    fs.mkdirSync(absDir, { recursive: true });
    const absPath = path.join(absDir, filename);
    fs.writeFileSync(absPath, buffer);

    const storagePath = path.join(relDir, filename);
    const timestamp = nowTimestamp();

    // Create inbox item
    const inboxItemId = generateId();
    db.insert(inboxItems)
      .values({
        id: inboxItemId,
        userId,
        createdByUserId: userId,
        rawContent: `[Processando OCR...] ${originalName}`,
        source: "receipt",
        status: "processing",
        createdAt: timestamp,
      })
      .run();

    // Create attachment
    const attachmentId = generateId();
    db.insert(attachments)
      .values({
        id: attachmentId,
        userId,
        inboxItemId,
        filename,
        originalFilename: originalName,
        mimeType: finalMimeType,
        size: buffer.length,
        storagePath,
        createdByUserId: userId,
        createdAt: timestamp,
      })
      .run();

    // Run OCR (async — don't block response for too long, but try inline for single files)
    processOcr(inboxItemId, attachmentId, absPath).catch((err) => {
      console.error("OCR processing failed:", err);
    });

    return NextResponse.json({
      inboxItemId,
      attachmentId,
      filename: originalName,
      status: "processing",
    });
  } catch (error) {
    console.error("Upload error:", error);
    return NextResponse.json({ error: "Erro no upload" }, { status: 500 });
  }
}

async function processOcr(inboxItemId: string, attachmentId: string, filePath: string) {
  try {
    const result = await extractFromImage(filePath);

    // Store extracted data in attachment
    db.update(attachments)
      .set({ extractedText: JSON.stringify(result) })
      .where(
        (await import("drizzle-orm")).eq(attachments.id, attachmentId)
      )
      .run();

    // Update inbox item based on confidence
    const summary = formatOcrSummary(result);

    if (result.confidence >= 0.4) {
      db.update(inboxItems)
        .set({
          rawContent: summary,
          status: "pending",
        })
        .where(
          (await import("drizzle-orm")).eq(inboxItems.id, inboxItemId)
        )
        .run();
    } else {
      db.update(inboxItems)
        .set({
          rawContent: `[Imagem anexada — revisão manual necessária] ${result.rawText || ""}`.trim(),
          status: "pending",
        })
        .where(
          (await import("drizzle-orm")).eq(inboxItems.id, inboxItemId)
        )
        .run();
    }
  } catch (error) {
    console.error("OCR extraction failed:", error);
    // Mark as pending with fallback message — image is still accessible
    const { eq } = await import("drizzle-orm");
    db.update(inboxItems)
      .set({
        rawContent: "[Imagem anexada — OCR falhou, revisão manual necessária]",
        status: "pending",
      })
      .where(eq(inboxItems.id, inboxItemId))
      .run();
  }
}
