import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const uploadsDirectory = fileURLToPath(new URL("../uploads/", import.meta.url));

function pdfPath(fileName) {
  return path.join(uploadsDirectory, path.basename(fileName));
}

export async function savePdf(fileName, body) {
  await mkdir(uploadsDirectory, { recursive: true });
  await writeFile(pdfPath(fileName), body);
}

export function readPdf(fileName) {
  return readFile(pdfPath(fileName));
}

export async function deletePdf(fileName) {
  if (!fileName) return;
  await unlink(pdfPath(fileName)).catch((error) => {
    if (error.code !== "ENOENT") throw error;
  });
}
