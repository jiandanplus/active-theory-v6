// Types for site-identity.js. The JavaScript is served byte-for-byte as part of
// the public identity.js endpoint, so its types live here instead of in JSDoc.
export interface SiteIdentityFields {
  description: string;
  language: string;
  socialImage: string;
  [key: string]: unknown;
}
export interface PageMeta {
  status: number;
  title: string;
  siteTitle: string;
  description: string;
  language: string;
  image: string;
  url: string;
}
export interface HeadEntry {
  tag: string;
  attributes: Record<string, string>;
  text?: string;
}
export const DEFAULTS: Readonly<{
  description: "";
  language: "en";
  socialImage: "";
}>;
export const LANGUAGES: readonly string[];
export function normalizeSite(site?: object): SiteIdentityFields;
export function normalizeConfig<T extends { site?: object }>(
  config: T,
): T & { site: SiteIdentityFields };
export function validateIdentity<T extends object>(site: T): T;
export function publicPathForState(state: unknown): string | null;
export function pageMetadata(
  config: { site?: object; projects?: object[] },
  origin: string,
  pathname: string,
): PageMeta;
export function headEntries(
  meta: PageMeta,
  options?: { preview?: boolean },
): HeadEntry[];
export function ownedMeta(key: unknown): boolean;
