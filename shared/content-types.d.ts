export interface SiteContent {
  site: Record<string, unknown>;
  projects: ProjectContent[];
  scenes: SceneContent[];
  songs: { title: string; src: string }[];
}
export interface ProjectContent {
  slug: string;
  name: string;
  description?: string;
  tags: string;
  clientName?: string;
  completionDate: string;
  uiColor?: string;
  priority?: number;
  projectURL?: string;
  caseStudyURL?: string;
  video: { url: string; thumbnail: string };
  projectLogo: { url: string; thumbnail?: string };
  image?: { url: string; thumbnail?: string };
}
export interface SceneContent {
  id: string;
  label: string;
  fields: {
    key: string;
    label: string;
    type: string;
    value: string | number;
  }[];
}
export interface ContentContract {
  safeURL(value: unknown, options?: { empty?: boolean }): void;
  plain(value: unknown, max?: number): void;
  validateContent<T extends SiteContent>(config: T, schema: SiteContent): T;
  validateScenes<T extends SceneContent[]>(
    scenes: T,
    schemaScenes: SceneContent[],
  ): T;
  validateConfig<T extends SiteContent>(config: T, schema: SiteContent): T;
}
