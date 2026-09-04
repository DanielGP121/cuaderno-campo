/**
 * File in, file out, on a phone: pick a workbook from the device, and hand results to
 * the share sheet (OneDrive, mail, WhatsApp) or to a download when sharing files is
 * not available. No server, no accounts.
 */

export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.style.display = "none";
    input.addEventListener("change", () => {
      resolve(input.files?.[0] ?? null);
      input.remove();
    });
    input.addEventListener("cancel", () => {
      resolve(null);
      input.remove();
    });
    document.body.appendChild(input);
    input.click();
  });
}

export async function readBytes(file: File): Promise<Uint8Array> {
  return new Uint8Array(await file.arrayBuffer());
}

export async function readText(file: File): Promise<string> {
  return file.text();
}

export type SaveOutcome = "shared" | "downloaded";

function download(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 2000);
}

/** Share a file through the system sheet when the browser allows it, else download it. */
export async function saveFile(name: string, data: Uint8Array | string, mime: string, share = true): Promise<SaveOutcome> {
  const blob = new Blob([data as BlobPart], { type: mime });
  const file = new File([blob], name, { type: mime });
  if (share && typeof navigator.share === "function" && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name });
      return "shared";
    } catch (e) {
      if ((e as DOMException)?.name === "AbortError") return "shared";
      // fall through to a download
    }
  }
  download(name, blob);
  return "downloaded";
}

export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
