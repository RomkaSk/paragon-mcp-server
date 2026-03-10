import { describe, it, expect } from "vitest";
import {
  db,
  componentIndex,
  subcomponentIndex,
  findComponent,
  requireComponent,
} from "./components-db.js";

// ─── Collect all component & subcomponent names from the DB ─────────────────

const allComponents = Object.values(db.components);
const allComponentNames = allComponents.map((c) => c.name);
const allSubcomponents: { sub: string; parent: string }[] = [];

for (const component of allComponents) {
  for (const sub of component.subcomponents) {
    allSubcomponents.push({ sub, parent: component.name });
  }
}

// ─── Sanity checks ──────────────────────────────────────────────────────────

describe("database integrity", () => {
  it("loads a non-empty component database", () => {
    expect(allComponents.length).toBeGreaterThan(0);
    expect(db.totalComponents).toBe(allComponents.length);
  });

  it("every component has required fields", () => {
    for (const c of allComponents) {
      expect(c.name, `missing name`).toBeTruthy();
      expect(c.dirName, `${c.name}: missing dirName`).toBeTruthy();
      expect(Array.isArray(c.subcomponents), `${c.name}: subcomponents not array`).toBe(true);
      expect(Array.isArray(c.props), `${c.name}: props not array`).toBe(true);
      expect(Array.isArray(c.events), `${c.name}: events not array`).toBe(true);
      expect(Array.isArray(c.examples), `${c.name}: examples not array`).toBe(true);
      expect(Array.isArray(c.cssVariables), `${c.name}: cssVariables not array`).toBe(true);
    }
  });

  it("component index has entries for all components", () => {
    expect(componentIndex.size).toBeGreaterThanOrEqual(allComponents.length);
  });

  it("subcomponent index has entries for all subcomponents", () => {
    expect(subcomponentIndex.size).toBe(allSubcomponents.length);
  });
});

// ─── findComponent: top-level components ────────────────────────────────────

describe("findComponent - top-level components", () => {
  it.each(allComponentNames)("finds %s by exact name", (name) => {
    const result = findComponent(name);
    expect(result).toBeDefined();
    expect(result!.component.name).toBe(name);
    expect(result!.matchedSubcomponent).toBeUndefined();
  });

  it.each(allComponentNames)("finds %s case-insensitively", (name) => {
    const lower = findComponent(name.toLowerCase());
    expect(lower).toBeDefined();
    expect(lower!.component.name).toBe(name);

    const upper = findComponent(name.toUpperCase());
    expect(upper).toBeDefined();
    expect(upper!.component.name).toBe(name);
  });

  it.each(allComponents.map((c) => [c.dirName, c.name]))(
    "finds by dirName %s → %s",
    (dirName, expectedName) => {
      const result = findComponent(dirName);
      expect(result).toBeDefined();
      expect(result!.component.name).toBe(expectedName);
    }
  );
});

// ─── findComponent: subcomponents ───────────────────────────────────────────

describe("findComponent - subcomponents", () => {
  it.each(allSubcomponents.map(({ sub, parent }) => [sub, parent]))(
    "finds subcomponent %s → parent %s",
    (sub, parent) => {
      const result = findComponent(sub);
      expect(result).toBeDefined();
      expect(result!.component.name).toBe(parent);
      expect(result!.matchedSubcomponent).toBe(sub);
    }
  );

  it.each(allSubcomponents.map(({ sub, parent }) => [sub, parent]))(
    "finds subcomponent %s case-insensitively",
    (sub, parent) => {
      const lower = findComponent(sub.toLowerCase());
      expect(lower).toBeDefined();
      expect(lower!.component.name).toBe(parent);
      expect(lower!.matchedSubcomponent).toBe(sub);

      const upper = findComponent(sub.toUpperCase());
      expect(upper).toBeDefined();
      expect(upper!.component.name).toBe(parent);
      expect(upper!.matchedSubcomponent).toBe(sub);
    }
  );
});

// ─── findComponent: not found ───────────────────────────────────────────────

describe("findComponent - not found", () => {
  it.each([
    "NonExistentComponent",
    "FooBar",
    "",
    "ButtonExtra",
    "card-grid-nope",
  ])("returns undefined for %s", (name) => {
    expect(findComponent(name)).toBeUndefined();
  });
});

// ─── requireComponent ───────────────────────────────────────────────────────

describe("requireComponent", () => {
  it("returns component for valid name", () => {
    const result = requireComponent("Button");
    expect(result.error).toBeUndefined();
    expect(result.component).toBeDefined();
    expect(result.component!.name).toBe("Button");
  });

  it("returns component for valid subcomponent", () => {
    const result = requireComponent("CardGrid");
    expect(result.error).toBeUndefined();
    expect(result.component).toBeDefined();
    expect(result.component!.name).toBe("Card");
    expect("matchedSubcomponent" in result && result.matchedSubcomponent).toBe("CardGrid");
  });

  it("returns error for invalid name", () => {
    const result = requireComponent("DoesNotExist");
    expect(result.error).toBeDefined();
    expect(result.error!.isError).toBe(true);
    expect(result.component).toBeUndefined();
  });
});

// ─── No subcomponent name collides with a top-level component ───────────────

describe("index consistency", () => {
  it("top-level components take precedence over subcomponent names", () => {
    // If a name exists as both a top-level component AND a subcomponent,
    // findComponent should return the top-level component (no matchedSubcomponent).
    for (const { sub } of allSubcomponents) {
      const result = findComponent(sub);
      expect(result).toBeDefined();
      if (componentIndex.has(sub.toLowerCase())) {
        // It's also a top-level component — direct match wins
        expect(result!.matchedSubcomponent).toBeUndefined();
      } else {
        // Pure subcomponent
        expect(result!.matchedSubcomponent).toBe(sub);
      }
    }
  });
});
