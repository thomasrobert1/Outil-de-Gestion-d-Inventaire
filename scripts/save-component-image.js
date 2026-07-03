const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

function slugify(str = "") {
  return str
    .toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "composant";
}

function extFromMime(mime = "") {
  if (mime.includes("png")) return "png";
  if (mime.includes("webp")) return "webp";
  if (mime.includes("gif")) return "gif";
  return "jpg";
}

function main() {
  const body = process.env.ISSUE_BODY || "";
  let payload;

  try {
    payload = JSON.parse(body);
  } catch {
    throw new Error("Issue body invalide (JSON attendu).");
  }

  const { reference, dataUrl } = payload;
  if (!reference || !dataUrl || !dataUrl.startsWith("data:image/")) {
    throw new Error("Payload invalide: reference/dataUrl manquant.");
  }

  const [meta, base64] = dataUrl.split(",");
  const mime = (meta.match(/data:(.*);base64/) || [])[1] || "image/jpeg";
  const ext = extFromMime(mime);

  const date = new Date().toISOString().slice(0, 10);
  const slug = slugify(reference);
  const uid = crypto.randomUUID().split("-")[0];
  const fileName = `${date}_${slug}_${uid}.${ext}`;

  const dir = path.join(process.cwd(), "images", "composants");
  fs.mkdirSync(dir, { recursive: true });

  const relPath = `images/composants/${fileName}`;
  const absPath = path.join(process.cwd(), relPath);
  fs.writeFileSync(absPath, Buffer.from(base64, "base64"));

  fs.writeFileSync(
    path.join(process.cwd(), "tmp-image-result.json"),
    JSON.stringify({ reference, filePath: relPath }, null, 2)
  );
}

main();