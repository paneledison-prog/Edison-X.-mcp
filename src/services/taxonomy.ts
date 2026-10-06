/** Controlled vocabulary shared by tools, the sanitizer and the library. */

export const CATEGORIES = [
  "landing-page",
  "dashboard",
  "onboarding",
  "sign-in",
  "e-commerce",
  "product-page",
  "checkout",
  "settings",
  "profile",
  "feed",
  "messaging",
  "search",
  "pricing",
  "blog",
  "portfolio",
  "admin",
  "analytics",
  "calendar",
  "maps",
  "media-player",
  "finance",
  "health-fitness",
  "education",
  "travel",
] as const;

export const STYLES = [
  "minimal",
  "dark",
  "light",
  "playful",
  "editorial",
  "brutalist",
  "glassmorphism",
  "neumorphism",
  "colorful",
  "monochrome",
  "corporate",
  "data-dense",
  "illustrated",
  "retro",
  "futuristic",
  "high-contrast",
] as const;

export const PLATFORMS = ["web", "ios", "android", "desktop"] as const;

export const UI_PATTERNS = [
  "sidebar-navigation",
  "bottom-tab-bar",
  "top-navigation",
  "card-grid",
  "hero-section",
  "stat-cards",
  "data-table",
  "kanban-board",
  "multi-step-form",
  "modal-dialog",
  "empty-state",
  "progress-tracker",
  "command-palette",
  "sticky-header",
  "split-screen",
  "infinite-scroll",
  "carousel",
  "accordion-faq",
  "pricing-table",
  "chat-thread",
  "filter-bar",
  "timeline",
  "map-with-list",
  "player-controls",
] as const;

export interface Taxonomy {
  categories: string[];
  styles: string[];
  platforms: string[];
  ui_patterns: string[];
}

export function getTaxonomy(): Taxonomy {
  return {
    categories: [...CATEGORIES],
    styles: [...STYLES],
    platforms: [...PLATFORMS],
    ui_patterns: [...UI_PATTERNS],
  };
}

export const CATEGORY_SET: ReadonlySet<string> = new Set(CATEGORIES);

export function isCategory(value: string): boolean {
  return CATEGORY_SET.has(value);
}
