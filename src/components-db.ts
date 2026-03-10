/**
 * Component database and lookup logic.
 *
 * Extracted from index.ts so it can be tested independently of the MCP server.
 */

import componentsData from "../data/components.json";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface FieldDef {
  name: string;
  type: string;
  description: string;
  interface?: string;
}

export interface ExampleDef {
  id: string;
  title: string;
  code: string;
}

export interface CSSVariable {
  name: string;
  value: string;
  type?: string;
  source?: string;
  category: string;
}

export interface ComponentData {
  name: string;
  dirName: string;
  description: string;
  status: string;
  designStatus: string;
  devStatus: string;
  categories: string[];
  subcomponents: string[];
  props: FieldDef[];
  events: FieldDef[];
  examples: ExampleDef[];
  cssVariables: CSSVariable[];
}

export interface ComponentsDB {
  version: string;
  generatedAt: string;
  paragonVersion: string;
  totalComponents: number;
  components: Record<string, ComponentData>;
}

export interface FindResult {
  component: ComponentData;
  /** If the query matched a subcomponent, this is the subcomponent name */
  matchedSubcomponent?: string;
}

// ─── Data & indexes ─────────────────────────────────────────────────────────

export const db = componentsData as ComponentsDB;

// Build O(1) lookup index by name and dirName (case-insensitive)
export const componentIndex = new Map<string, ComponentData>();
// Maps subcomponent name → parent component
export const subcomponentIndex = new Map<string, ComponentData>();

for (const component of Object.values(db.components)) {
  componentIndex.set(component.name.toLowerCase(), component);
  componentIndex.set(component.dirName.toLowerCase(), component);
  for (const sub of component.subcomponents) {
    subcomponentIndex.set(sub.toLowerCase(), component);
  }
}

// ─── Lookup helpers ─────────────────────────────────────────────────────────

export function findComponent(name: string): FindResult | undefined {
  const lower = name.toLowerCase();
  const direct = componentIndex.get(lower);
  if (direct) return { component: direct };

  const parent = subcomponentIndex.get(lower);
  if (parent) {
    // Return the canonical subcomponent name (preserving original casing)
    const subName = parent.subcomponents.find(
      (s) => s.toLowerCase() === lower
    );
    return { component: parent, matchedSubcomponent: subName ?? name };
  }
  return undefined;
}

export function errorResult(msg: string) {
  return {
    content: [{ type: "text" as const, text: `Error: ${msg}` }],
    isError: true as const,
  };
}

export type RequireComponentResult =
  | { component: ComponentData; matchedSubcomponent?: string; error?: never }
  | { error: ReturnType<typeof errorResult>; component?: never };

export function requireComponent(name: string): RequireComponentResult {
  const result = findComponent(name);
  if (!result) {
    return { error: errorResult(`Component "${name}" not found.`) };
  }
  return {
    component: result.component,
    matchedSubcomponent: result.matchedSubcomponent,
  };
}
