import { ImageUploadField, type ImageUploadPayload } from "./ImageUploadField";
import { useStudio } from "@/store/StudioStore";

type StudioCaptureUploadProps = {
  ideaId: string;
  disabled?: boolean;
};

/**
 * Ponte entre ImageUploadField e uploadRenderInput do StudioStore.
 * Use no StudioPage no lugar do input de captura atual.
 */
export function StudioCaptureUpload({ ideaId, disabled }: StudioCaptureUploadProps) {
  const { uploadRenderInput, isUploadingRenderInput } = useStudio();

  const handleUpload = async (payload: ImageUploadPayload) => {
    await new Promise<void>((resolve, reject) => {
      try {
        uploadRenderInput({
          ideaId,
          fileName: payload.fileName,
          contentType: payload.contentType,
          base64: payload.base64,
        });
        // A mutation do store não expoe promise tipada; o loading global cobre o resto.
        resolve();
      } catch (error) {
        reject(error);
      }
    });
  };

  return (
    <ImageUploadField
      disabled={disabled}
      isUploading={isUploadingRenderInput}
      onUpload={handleUpload}
      label="Captura para o render"
      helpText="PNG, JPG ou WebP · até 2 MB · máx. 4096px"
    />
  );
}
