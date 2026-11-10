/*
  DJYum — server-side validation for product image uploads.
  The browser compresses/resizes the file and posts a base64 data URL, so no
  extra upload middleware or dependency is required.
*/
const ALLOWED = ["image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif"];
const DATA_URL = /^data:(image\/(?:png|jpe?g|webp|gif));base64,([A-Za-z0-9+/=\s]+)$/i;

export const validateImagePayload = (raw, maxBytes = 2 * 1024 * 1024) => {
  if (raw === undefined || raw === null || raw === "") return { value: undefined };

  const dataUrl = String(raw).trim();
  if (dataUrl === "__REMOVE__") return { value: null };
  if (dataUrl.length > maxBytes * 1.4) {
    return { error: "Product image is too large. Please use an image under 2 MB." };
  }

  const match = dataUrl.match(DATA_URL);
  if (!match) return { error: "Product image must be a PNG, JPG, WEBP or GIF file." };
  if (!ALLOWED.includes(match[1].toLowerCase())) {
    return { error: "Unsupported image format." };
  }

  const base64 = match[2].replace(/\s/g, "");
  const bytes = Math.floor((base64.length * 3) / 4);
  if (bytes > maxBytes) {
    return { error: "Product image is too large. Please use an image under 2 MB." };
  }

  return { value: `data:${match[1].toLowerCase()};base64,${base64}` };
};
