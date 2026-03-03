# Paragon MCP Server

MCP server for the [Open edX Paragon](https://paragon-openedx.netlify.app/) design system (v23.x). Gives AI assistants structured access to component documentation — props, events, code examples, and CSS design tokens — so they can write Paragon-based UI code without guessing.

## Installation

The quickest way to use this server is via npx (no clone needed):

```bash
claude mcp add paragon -- npx -y @romkask/paragon-mcp-server
```

Or add it manually to your MCP config (`~/.claude/settings.json` or project `.claude/settings.local.json`):

```json
{
  "mcpServers": {
    "paragon": {
      "command": "npx",
      "args": ["-y", "@romkask/paragon-mcp-server"]
    }
  }
}
```

## Available Tools

| Tool | Description |
|------|-------------|
| `list_components` | List all 63 Paragon components with categories, status, and counts |
| `get_component` | Get full details for a component (description, props, events, subcomponents) |
| `get_component_props` | Get all props with types and descriptions |
| `get_component_events` | Get all callback events (onClose, onToggle, etc.) |
| `list_examples` | List available code examples for a component |
| `get_example` | Get the full JSX code for a specific example |
| `get_components_variables` | Get CSS custom properties / design tokens |

## Data Coverage

- **63 components** (Button, Alert, Card, DataTable, Form, Modal, etc.)
- **410 props** with types and descriptions
- **69 events/callbacks**
- **295 live code examples**
- **443 CSS design token variables**

## Development

```bash
git clone https://github.com/RomkaSk/paragon-mcp-server.git
cd paragon-mcp-server
npm install
npm run build     # generates data + bundles with tsup
npm start         # run server
npm run dev       # dev mode with tsx
```

## License

MIT
