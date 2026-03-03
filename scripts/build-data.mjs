#!/usr/bin/env node
/**
 * Paragon documentation data generator.
 * Clones the latest v23.x tag of the Paragon repo, then parses component
 * source files, README.md docs, and design tokens into a single
 * components.json for the MCP server.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PARAGON_REPO = 'https://github.com/openedx/paragon.git';
const CLONE_DIR = path.resolve(__dirname, '../.paragon-src');
const OUTPUT_FILE = path.resolve(__dirname, '../data/components.json');

const SKIP_DIRS = new Set([
  '__mocks__', 'hooks', 'i18n', 'utils', 'setupTest.ts',
  'index.ts', 'index.scss', 'withDeprecatedProps.tsx',
]);

const PROP_TYPE_MAP = {
  func: '() => void',
  bool: 'boolean',
  string: 'string',
  number: 'number',
  node: 'React.ReactNode',
  element: 'React.ReactElement',
  array: 'any[]',
  object: 'object',
};

// ─── Shared helpers ──────────────────────────────────────────────────────────

function readFile(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

function cleanJsDoc(comment) {
  return comment.replace(/\s*\*\s*/g, ' ').replace(/\s+/g, ' ').trim();
}

function isEventProp(name, type) {
  return name.startsWith('on') || type.includes('=>') || type.includes('Function');
}

function classifyProp(name, type, description, extra) {
  const entry = { name, type, description, ...extra };
  return isEventProp(name, type)
    ? { kind: 'event', entry }
    : { kind: 'prop', entry };
}

function deduplicateByName(items) {
  const seen = new Set();
  return items.filter(item => {
    if (seen.has(item.name)) return false;
    seen.add(item.name);
    return true;
  });
}

function removeDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}

// ─── Git operations ──────────────────────────────────────────────────────────

function cloneLatestV23() {
  console.log('Fetching tags from paragon repo...');
  const tagsOutput = execSync(`git ls-remote --tags --refs ${PARAGON_REPO}`, { encoding: 'utf-8' });

  const v23Tags = tagsOutput
    .split('\n')
    .map(line => line.trim().split('\t').pop()?.replace('refs/tags/', ''))
    .filter(tag => tag && /^v23\.\d+\.\d+$/.test(tag))
    .sort((a, b) => {
      const pa = a.replace('v', '').split('.').map(Number);
      const pb = b.replace('v', '').split('.').map(Number);
      for (let i = 0; i < 3; i++) {
        if (pa[i] !== pb[i]) return pa[i] - pb[i];
      }
      return 0;
    });

  if (v23Tags.length === 0) {
    throw new Error('No v23.x.x tags found in the paragon repo');
  }

  const latestTag = v23Tags.at(-1);
  console.log(`Latest v23 tag: ${latestTag}`);

  removeDir(CLONE_DIR);

  console.log(`Cloning ${PARAGON_REPO} at tag ${latestTag}...`);
  execSync(
    `git clone --depth 1 --branch ${latestTag} ${PARAGON_REPO} ${CLONE_DIR}`,
    { stdio: 'inherit' }
  );

  return {
    paragonVersion: latestTag,
    srcDir: path.join(CLONE_DIR, 'src'),
    tokensDir: path.join(CLONE_DIR, 'tokens/src/core/components'),
  };
}

function cleanup() {
  if (fs.existsSync(CLONE_DIR)) {
    console.log('Cleaning up cloned repo...');
    removeDir(CLONE_DIR);
  }
}

// ─── Markdown parsing ────────────────────────────────────────────────────────

function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};

  const result = {};
  const lines = match[1].split('\n');
  let currentKey = null;
  let listItems = [];

  for (const line of lines) {
    const keyMatch = line.match(/^(\w+):\s*(.*)$/);
    if (keyMatch) {
      if (currentKey && listItems.length > 0) {
        result[currentKey] = listItems;
        listItems = [];
      }
      const [, key, value] = keyMatch;
      if (value.startsWith("'") || value.startsWith('"')) {
        result[key] = value.replace(/^['"]|['"]$/g, '');
      } else if (value === '|' || value === '') {
        currentKey = key;
        listItems = [];
      } else {
        result[key] = value;
      }
    } else if (line.match(/^- /)) {
      listItems.push(line.replace(/^- /, '').replace(/^['"]|['"]$/g, '').trim());
    }
  }
  if (currentKey && listItems.length > 0) {
    result[currentKey] = listItems;
  }

  return result;
}

function stripFrontmatter(content) {
  return content.replace(/^---[\s\S]*?---\n*/, '');
}

function extractExamples(content) {
  const examples = [];
  const body = stripFrontmatter(content);
  const lines = body.split('\n');

  let currentHeading = 'Basic Usage';
  let inCodeBlock = false;
  let codeLines = [];

  for (const line of lines) {
    const headingMatch = line.match(/^#{1,3}\s+(.+)/);
    if (headingMatch && !inCodeBlock) {
      currentHeading = headingMatch[1].trim();
    }

    if (line.match(/^```jsx\s*live/)) {
      inCodeBlock = true;
      codeLines = [];
      continue;
    }

    if (inCodeBlock && line.match(/^```\s*$/)) {
      inCodeBlock = false;
      examples.push({
        id: `example-${examples.length}`,
        title: currentHeading,
        code: codeLines.join('\n').trim(),
      });
      continue;
    }

    if (inCodeBlock) {
      codeLines.push(line);
    }
  }

  return examples;
}

function extractDescription(content) {
  const lines = stripFrontmatter(content).split('\n');
  const descLines = [];
  for (const line of lines) {
    if (line.match(/^#{1,3}\s/) || line.match(/^```/)) break;
    descLines.push(line);
  }
  return descLines.join('\n').trim();
}

// ─── Props parsing ───────────────────────────────────────────────────────────

function propTypeToString(propType) {
  for (const [prefix, mapped] of Object.entries(PROP_TYPE_MAP)) {
    if (propType.startsWith(prefix)) return mapped;
  }

  const oneOfMatch = propType.match(/oneOf\(\[(.*?)\]\)/);
  if (oneOfMatch) return oneOfMatch[1].trim();

  const oneOfTypeMatch = propType.match(/oneOfType\(\[(.*?)\]\)/);
  if (oneOfTypeMatch) {
    return oneOfTypeMatch[1]
      .split(',')
      .map(t => propTypeToString(t.trim().replace('PropTypes.', '')))
      .join(' | ');
  }

  const arrayOfMatch = propType.match(/arrayOf\(PropTypes\.(\w+)\)/);
  if (arrayOfMatch) return `${propTypeToString(arrayOfMatch[1])}[]`;

  return propType.replace('.isRequired', '').trim();
}

function parseTypeScriptProps(content) {
  const props = [];
  const events = [];
  const interfaceRegex = /export\s+interface\s+(\w+Props)\s+(?:extends\s+[\w<>,\s.'|]+\s*)?\{([\s\S]*?)\n\}/g;
  let match;

  while ((match = interfaceRegex.exec(content)) !== null) {
    const interfaceName = match[1];
    const propRegex = /\/\*\*\s*([\s\S]*?)\s*\*\/\s*\n\s*(\w+)\??\s*:\s*([^;]+);/g;
    let propMatch;

    while ((propMatch = propRegex.exec(match[2])) !== null) {
      const description = cleanJsDoc(propMatch[1]);
      const name = propMatch[2];
      const type = propMatch[3].trim().replace(/\s+/g, ' ');
      const { kind, entry } = classifyProp(name, type, description, { interface: interfaceName });

      (kind === 'event' ? events : props).push(entry);
    }
  }

  return { props, events };
}

function parsePropTypes(content) {
  const props = [];
  const events = [];
  const propTypesRegex = /\.propTypes\s*=\s*\{([\s\S]*?)\n\};/g;
  let match;

  while ((match = propTypesRegex.exec(content)) !== null) {
    const propRegex = /\/\*\*\s*([\s\S]*?)\s*\*\/\s*\n\s*(\w+)\s*:\s*PropTypes\.([^,]+)/g;
    let propMatch;

    while ((propMatch = propRegex.exec(match[1])) !== null) {
      const description = cleanJsDoc(propMatch[1]);
      const name = propMatch[2];
      const type = propTypeToString(propMatch[3].trim());
      const { kind, entry } = classifyProp(name, type, description);

      (kind === 'event' ? events : props).push(entry);
    }
  }

  return { props, events };
}

function parseSourceFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  return filePath.endsWith('.tsx')
    ? parseTypeScriptProps(content)
    : parsePropTypes(content);
}

// ─── Design tokens ───────────────────────────────────────────────────────────

function extractCSSVariables(tokenPath) {
  const variables = [];

  function walkTokens(obj, prefix = '') {
    if (!obj || typeof obj !== 'object') return;

    if ('$value' in obj || 'source' in obj) {
      const source = obj.source || '';
      const cssVar = source ? `--pgn-${prefix.replace(/\./g, '-')}` : '';

      if (cssVar || source) {
        variables.push({
          name: cssVar || source,
          value: String(obj.$value || ''),
          type: obj.$type || undefined,
          source: source || undefined,
          category: prefix.split('.')[0] || 'other',
        });
      }
      return;
    }

    for (const [key, val] of Object.entries(obj)) {
      if (key.startsWith('$')) continue;
      walkTokens(val, prefix ? `${prefix}-${key}` : key);
    }
  }

  try {
    const stat = fs.statSync(tokenPath);
    const files = stat.isDirectory()
      ? fs.readdirSync(tokenPath).filter(f => f.endsWith('.json')).map(f => path.join(tokenPath, f))
      : [tokenPath];

    for (const file of files) {
      walkTokens(JSON.parse(fs.readFileSync(file, 'utf-8')));
    }
  } catch {
    // No tokens for this component
  }

  return variables;
}

function resolveComponentTokens(dirName, tokensDir) {
  // Try directory first, then single file — extractCSSVariables handles errors
  const dirPath = path.join(tokensDir, dirName);
  try {
    if (fs.statSync(dirPath).isDirectory()) {
      return extractCSSVariables(dirPath);
    }
  } catch { /* not a directory or doesn't exist */ }

  const filePath = path.join(tokensDir, `${dirName}.json`);
  try {
    fs.statSync(filePath);
    return extractCSSVariables(filePath);
  } catch {
    return [];
  }
}

// ─── Component processing ────────────────────────────────────────────────────

function parseComponentDocs(componentDir, dirEntries) {
  let frontmatter = {};
  let examples = [];
  let description = '';

  const readmeContent = readFile(path.join(componentDir, 'README.md'));
  if (readmeContent) {
    frontmatter = parseFrontmatter(readmeContent);
    examples = extractExamples(readmeContent);
    description = extractDescription(readmeContent);
  }

  for (const entry of dirEntries) {
    if (entry.endsWith('.mdx')) {
      examples.push(...extractExamples(fs.readFileSync(path.join(componentDir, entry), 'utf-8')));
    }
  }

  return { frontmatter, description, examples };
}

function parseComponentProps(componentDir, dirName, dirEntries) {
  const allProps = [];
  const allEvents = [];

  const sourceFiles = [];
  for (const entry of dirEntries) {
    if (!entry.endsWith('.tsx') && !entry.endsWith('.jsx')) continue;
    const isIndex = entry === 'index.tsx' || entry === 'index.jsx';
    sourceFiles.push({
      path: path.join(componentDir, entry),
      name: isIndex ? dirName : path.basename(entry, path.extname(entry)),
    });
  }

  for (const { path: filePath } of sourceFiles) {
    const { props, events } = parseSourceFile(filePath);
    allProps.push(...props);
    allEvents.push(...events);
  }

  return {
    props: deduplicateByName(allProps),
    events: deduplicateByName(allEvents),
  };
}

function processComponent(dirName, srcDir, tokensDir) {
  const componentDir = path.join(srcDir, dirName);
  const dirEntries = fs.readdirSync(componentDir);

  const { frontmatter, description, examples } = parseComponentDocs(componentDir, dirEntries);
  const { props, events } = parseComponentProps(componentDir, dirName, dirEntries);
  const cssVariables = resolveComponentTokens(dirName, tokensDir);

  return {
    name: frontmatter.title || dirName,
    dirName,
    description,
    status: frontmatter.status || 'Unknown',
    designStatus: frontmatter.designStatus || 'Unknown',
    devStatus: frontmatter.devStatus || 'Unknown',
    categories: Array.isArray(frontmatter.categories) ? frontmatter.categories : [],
    subcomponents: Array.isArray(frontmatter.components) ? frontmatter.components.slice(1) : [],
    props,
    events,
    examples,
    cssVariables,
  };
}

// ─── Main ────────────────────────────────────────────────────────────────────

function main() {
  const { paragonVersion, srcDir, tokensDir } = cloneLatestV23();

  try {
    console.log(`Parsing Paragon docs from: ${CLONE_DIR}`);

    const components = {};
    for (const entry of fs.readdirSync(srcDir)) {
      if (SKIP_DIRS.has(entry)) continue;
      if (!fs.statSync(path.join(srcDir, entry)).isDirectory()) continue;

      const component = processComponent(entry, srcDir, tokensDir);
      if (component) {
        components[component.name] = component;
      }
    }

    const output = {
      version: '1.0.0',
      generatedAt: new Date().toISOString(),
      paragonVersion,
      totalComponents: Object.keys(components).length,
      components,
    };

    fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));

    const allComponents = Object.values(components);
    const sum = (fn) => allComponents.reduce((acc, c) => acc + fn(c), 0);

    console.log(`Generated ${OUTPUT_FILE}`);
    console.log(`  Paragon version: ${paragonVersion}`);
    console.log(`  Components: ${allComponents.length}`);
    console.log(`  Props: ${sum(c => c.props.length)}`);
    console.log(`  Events: ${sum(c => c.events.length)}`);
    console.log(`  Examples: ${sum(c => c.examples.length)}`);
    console.log(`  CSS Variables: ${sum(c => c.cssVariables.length)}`);
  } finally {
    cleanup();
  }
}

main();
