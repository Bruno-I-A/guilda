/** Slug URL-safe a partir do nome da organização. */
export function slugify(input: string): string {
  const base = input
    .normalize("NFKD")
    // remove diacríticos (acentos) após decomposição NFKD
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return base || "org";
}

/** Slug com sufixo aleatório para evitar colisões entre organizações. */
export function orgSlug(name: string): string {
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${slugify(name)}-${suffix}`;
}
