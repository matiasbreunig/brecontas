"use client";

import { useCallback, useRef, useState } from "react";
import { Upload, Camera, FileImage, FileText, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";

interface FileUploadProps {
  onUpload: (file: File) => Promise<void>;
  isUploading?: boolean;
  accept?: string;
  className?: string;
}

const ACCEPT_STRING = "image/jpeg,image/png,image/heic,image/heif,application/pdf,.heic,.heif";

export function FileUpload({ onUpload, isUploading, className }: FileUploadProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const isMobile = useIsMobile();

  const handleFile = useCallback(
    async (file: File) => {
      setFileName(file.name);

      // Generate preview for images
      if (file.type.startsWith("image/") && !file.type.includes("heic")) {
        const url = URL.createObjectURL(file);
        setPreview(url);
      } else if (file.type === "application/pdf") {
        setPreview(null);
      }

      try {
        await onUpload(file);
      } finally {
        setFileName(null);
        setPreview(null);
      }
    },
    [onUpload]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFile(file);
      e.target.value = "";
    },
    [handleFile]
  );

  if (isUploading) {
    return (
      <div className={cn("flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-primary/30 bg-primary/5 p-6", className)}>
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <div className="text-center">
          <p className="text-sm font-medium">Processando...</p>
          {fileName && <p className="text-xs text-muted-foreground mt-1">{fileName}</p>}
        </div>
        {preview && (
          <img src={preview} alt="Preview" className="h-20 w-20 object-cover rounded-lg mt-2" />
        )}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "relative rounded-xl border-2 border-dashed transition-colors",
        isDragging
          ? "border-primary bg-primary/5"
          : "border-muted-foreground/20 hover:border-muted-foreground/40",
        className
      )}
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPT_STRING}
        onChange={handleInputChange}
        className="hidden"
      />
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleInputChange}
        className="hidden"
      />

      <div className="flex flex-col items-center gap-3 p-4 sm:p-6">
        <div className="flex items-center gap-2">
          <FileImage className="h-5 w-5 text-muted-foreground" />
          <FileText className="h-5 w-5 text-muted-foreground" />
        </div>

        <div className="text-center">
          <p className="text-sm font-medium">
            {isDragging ? "Solte o arquivo aqui" : "Arraste um arquivo ou"}
          </p>
          {!isDragging && (
            <p className="text-xs text-muted-foreground mt-1">
              JPG, PNG, HEIC ou PDF até 10MB
            </p>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            className="min-h-[44px]"
          >
            <Upload className="h-4 w-4 mr-2" />
            Escolher
          </Button>

          {isMobile && (
            <Button
              type="button"
              variant="default"
              size="sm"
              onClick={() => cameraInputRef.current?.click()}
              className="min-h-[44px]"
            >
              <Camera className="h-4 w-4 mr-2" />
              Câmera
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
