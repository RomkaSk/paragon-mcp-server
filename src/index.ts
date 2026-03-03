/**
 * MCP Server for OpenedX Paragon Design System.
 *
 * Provides tools to query Paragon component documentation including
 * props, events, examples, and CSS variables.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import componentsData from "../data/components.json";

// ─── Types ───────────────────────────────────────────────────────────────────

interface FieldDef {
  name: string;
  type: string;
  description: string;
  interface?: string;
}

interface ExampleDef {
  id: string;
  title: string;
  code: string;
}

interface CSSVariable {
  name: string;
  value: string;
  type?: string;
  source?: string;
  category: string;
}

interface ComponentData {
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

interface ComponentsDB {
  version: string;
  generatedAt: string;
  paragonVersion: string;
  totalComponents: number;
  components: Record<string, ComponentData>;
}

// ─── Data & helpers ──────────────────────────────────────────────────────────

const db = componentsData as ComponentsDB;

// Build O(1) lookup index by name and dirName (case-insensitive)
const componentIndex = new Map<string, ComponentData>();
for (const component of Object.values(db.components)) {
  componentIndex.set(component.name.toLowerCase(), component);
  componentIndex.set(component.dirName.toLowerCase(), component);
}

const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

const componentSchema = z
  .string()
  .describe("Component name (e.g., 'Button', 'Alert', 'DataTable')");

function findComponent(name: string): ComponentData | undefined {
  return componentIndex.get(name.toLowerCase());
}

type RequireComponentResult =
  | { component: ComponentData; error?: never }
  | { error: ReturnType<typeof errorResult>; component?: never };

function requireComponent(name: string): RequireComponentResult {
  const component = findComponent(name);
  if (!component) {
    return { error: errorResult(`Component "${name}" not found.`) };
  }
  return { component };
}

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

function jsonResult(data: unknown) {
  return textResult(JSON.stringify(data, null, 2));
}

function errorResult(msg: string) {
  return {
    content: [{ type: "text" as const, text: `Error: ${msg}` }],
    isError: true as const,
  };
}

// ─── Server ──────────────────────────────────────────────────────────────────

const server = new McpServer({
  name: "paragon-mcp-server",
  version: "1.0.0",
});

// ─── list_components ─────────────────────────────────────────────────────────

server.registerTool(
  "list_components",
  {
    title: "List Paragon Components",
    description:
      "List all Paragon components with categories and status. Optionally filter by category.",
    inputSchema: {
      category: z
        .string()
        .optional()
        .describe("Filter by category (e.g., 'Buttonlike', 'Content')"),
    },
    annotations: READ_ONLY_ANNOTATIONS,
  },
  async ({ category }) => {
    let components = Object.values(db.components);

    if (category) {
      const lower = category.toLowerCase();
      components = components.filter((c) =>
        c.categories.some((cat) => cat.toLowerCase().includes(lower))
      );
    }

    return jsonResult({
      total: components.length,
      categories: [...new Set(components.flatMap((c) => c.categories))].sort(),
      components: [...components]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((c) => ({
          name: c.name,
          categories: c.categories,
          status: c.status,
          propsCount: c.props.length,
          eventsCount: c.events.length,
          examplesCount: c.examples.length,
          subcomponents: c.subcomponents,
        })),
    });
  }
);

// ─── get_component ───────────────────────────────────────────────────────────

server.registerTool(
  "get_component",
  {
    title: "Get Paragon Component",
    description:
      "Get detailed component info: description, status, props, events, examples, and CSS variables.",
    inputSchema: { component: componentSchema },
    annotations: READ_ONLY_ANNOTATIONS,
  },
  async ({ component: name }) => {
    const result = requireComponent(name);
    if (result.error) return result.error;
    const { component } = result;

    return jsonResult({
      name: component.name,
      description: component.description,
      status: component.status,
      designStatus: component.designStatus,
      devStatus: component.devStatus,
      categories: component.categories,
      subcomponents: component.subcomponents,
      import: `import { ${component.name} } from '@openedx/paragon';`,
      props: component.props.map(({ name, type, description }) => ({
        name,
        type,
        description,
      })),
      events: component.events.map(({ name, type, description }) => ({
        name,
        type,
        description,
      })),
      examplesCount: component.examples.length,
      exampleTitles: component.examples.map((e) => e.title),
      cssVariablesCount: component.cssVariables.length,
    });
  }
);

// ─── get_component_props ─────────────────────────────────────────────────────

server.registerTool(
  "get_component_props",
  {
    title: "Get Component Props",
    description:
      "Get all props for a component with names, types, and descriptions.",
    inputSchema: { component: componentSchema },
    annotations: READ_ONLY_ANNOTATIONS,
  },
  async ({ component: name }) => {
    const result = requireComponent(name);
    if (result.error) return result.error;
    const { component } = result;

    return jsonResult({
      component: component.name,
      total: component.props.length,
      props: component.props,
    });
  }
);

// ─── get_component_events ────────────────────────────────────────────────────

server.registerTool(
  "get_component_events",
  {
    title: "Get Component Events",
    description:
      "Get all callback events (onClose, onClick, etc.) for a component.",
    inputSchema: { component: componentSchema },
    annotations: READ_ONLY_ANNOTATIONS,
  },
  async ({ component: name }) => {
    const result = requireComponent(name);
    if (result.error) return result.error;
    const { component } = result;

    return jsonResult({
      component: component.name,
      total: component.events.length,
      events: component.events,
    });
  }
);

// ─── list_examples ───────────────────────────────────────────────────────────

server.registerTool(
  "list_examples",
  {
    title: "List Component Examples",
    description:
      "List example IDs and titles for a component. Use get_example for full code.",
    inputSchema: { component: componentSchema },
    annotations: READ_ONLY_ANNOTATIONS,
  },
  async ({ component: name }) => {
    const result = requireComponent(name);
    if (result.error) return result.error;
    const { component } = result;

    return jsonResult({
      component: component.name,
      total: component.examples.length,
      examples: component.examples.map(({ id, title }) => ({ id, title })),
    });
  }
);

// ─── get_example ─────────────────────────────────────────────────────────────

server.registerTool(
  "get_example",
  {
    title: "Get Component Example",
    description:
      "Get full JSX code for a specific example. Search by ID or title (partial match).",
    inputSchema: {
      component: componentSchema,
      example_id: z
        .string()
        .optional()
        .describe("Example ID (e.g., 'example-0')"),
      title: z
        .string()
        .optional()
        .describe("Example title to search (partial match)"),
    },
    annotations: READ_ONLY_ANNOTATIONS,
  },
  async ({ component: name, example_id, title }) => {
    const result = requireComponent(name);
    if (result.error) return result.error;
    const { component } = result;

    if (component.examples.length === 0) {
      return errorResult(`No examples found for "${component.name}".`);
    }

    let example: ExampleDef | undefined;

    if (example_id) {
      example = component.examples.find((e) => e.id === example_id);
    } else if (title) {
      const lower = title.toLowerCase();
      example = component.examples.find((e) =>
        e.title.toLowerCase().includes(lower)
      );
    } else {
      example = component.examples[0];
    }

    if (!example) {
      const available = component.examples
        .map((e) => `${e.id}: ${e.title}`)
        .join(", ");
      return errorResult(`Example not found. Available: ${available}`);
    }

    return jsonResult({
      component: component.name,
      id: example.id,
      title: example.title,
      code: example.code,
    });
  }
);

// ─── get_components_variables ────────────────────────────────────────────────

server.registerTool(
  "get_components_variables",
  {
    title: "Get Component CSS Variables",
    description:
      "Get CSS custom properties (design tokens) for a component. Filter by category.",
    inputSchema: {
      component: componentSchema,
      category: z
        .string()
        .optional()
        .describe(
          "Filter by category (e.g., 'spacing', 'typography', 'size')"
        ),
    },
    annotations: READ_ONLY_ANNOTATIONS,
  },
  async ({ component: name, category }) => {
    const result = requireComponent(name);
    if (result.error) return result.error;
    const { component } = result;

    let variables = component.cssVariables;

    if (category) {
      const lower = category.toLowerCase();
      variables = variables.filter((v) => v.category.toLowerCase() === lower);
    }

    return jsonResult({
      component: component.name,
      total: variables.length,
      categories: [...new Set(variables.map((v) => v.category))].sort(),
      variables,
    });
  }
);

// ─── Start server ────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(
    `Paragon MCP server running (${db.totalComponents} components loaded)`
  );
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
