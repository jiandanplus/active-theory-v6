import type { SiteContent, SceneContent } from "./content-types";
export type {
  SiteContent,
  ProjectContent,
  SceneContent,
  ContentContract,
} from "./content-types";
/** Throws an Error carrying status 400 and a Chinese validation message. */
export function safeURL(value: unknown, options?: { empty?: boolean }): void;
export function plain(value: string, max?: number): void;
/** Generic site/project/song rules, deliberately independent of scene slots. */
export function validateContent<T extends SiteContent>(
  config: T,
  schema: SiteContent,
): T;
export function validateScenes<T extends SceneContent[]>(
  scenes: T,
  schemaScenes: SceneContent[],
): T;
/** Generic content and template-specific scene validation together. */
export function validateConfig<T extends SiteContent>(
  config: T,
  schema: SiteContent,
): T;
export as namespace SiteContentContract;
