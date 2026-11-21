// One-time recovery of the user-approved published design, never an application runtime.
// Usage: node scripts/recover-polymet.mjs <downloaded-bundle.js> <new-output-directory>
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { parseSync, traverse, types as t, generate } from "@babel/core";

const [input, output] = process.argv.slice(2);
if (!input || !output)
  throw new Error(
    "Indica el bundle descargado y una carpeta nueva de destino.",
  );
if (fs.existsSync(output))
  throw new Error(
    "No se sobrescribe código recuperado o ya integrado. Usa una carpeta nueva y compara.",
  );
const reference = JSON.parse(
  fs.readFileSync(
    new URL("../docs/design/polymet-reference.json", import.meta.url),
  ),
);
const source = fs.readFileSync(input, "utf8");
if (
  createHash("sha256").update(source).digest("hex") !== reference.bundleSha256
) {
  throw new Error(
    "La versión no coincide con la referencia aprobada. Revisa la procedencia antes de importar.",
  );
}
const ast = parseSync(source, {
  sourceType: "module",
  configFile: false,
  babelrc: false,
});
const boundaries = ast.comments.filter(
  (c) =>
    c.type === "CommentLine" &&
    /^ (?:\.temp\/|\.cache\/|node_modules|src\/)/.test(c.value),
);
const owners = new Map();
const modules = new Map();
let index = 0,
  current = "";
const isProject = (name) =>
  /\/src\//.test(name) &&
  !name.includes("node_modules") &&
  !/src\/utils\.js$/.test(name);
const relative = (name) =>
  name
    .replace(/^.*?\/src\//, "")
    .replace(/\.tsx$/, ".jsx")
    .replace(/\.ts$/, ".js");
for (const statement of ast.program.body) {
  while (index < boundaries.length && boundaries[index].end <= statement.start)
    current = boundaries[index++].value.trim();
  owners.set(statement, current);
  if (isProject(current)) {
    if (!modules.has(current))
      modules.set(current, {
        body: [],
        imports: new Map(),
        exports: new Set(),
      });
    modules.get(current).body.push(statement);
  }
}
const top = (p) =>
  p.findParent((parent) => parent.parentPath?.isProgram()) ??
  (p.parentPath?.isProgram() ? p : null);
function addImport(module, from, imported, local = imported, kind = "named") {
  const key = `${from}:${local}`;
  module.imports.set(key, { from, imported, local, kind });
}
function externalImport(binding, module) {
  if (
    binding.path.isImportSpecifier() ||
    binding.path.isImportDefaultSpecifier() ||
    binding.path.isImportNamespaceSpecifier()
  ) {
    const declaration = binding.path.parentPath.node;
    const spec = binding.path.node;
    // JSX is reconstructed below; only Fragment survives from the JSX runtime.
    if (declaration.source.value.includes("jsx")) {
      if (spec.imported?.name === "Fragment")
        addImport(module, "react", "Fragment", spec.local.name);
      return;
    }
    addImport(
      module,
      declaration.source.value,
      spec.imported?.name,
      spec.local.name,
      t.isImportDefaultSpecifier(spec)
        ? "default"
        : t.isImportNamespaceSpecifier(spec)
          ? "namespace"
          : "named",
    );
    return;
  }
  const origin = owners.get(top(binding.path)?.node) || "";
  const match = origin.match(/\/node_modules\/((?:@[^/]+\/)?[^/]+)\//);
  if (!match)
    throw new Error(
      `Dependencia sin resolver: ${binding.identifier.name} (${origin})`,
    );
  let pkg = match[1];
  if (pkg === "react-router") pkg = "react-router-dom";
  const local = binding.identifier.name;
  const overrides = { j: "useTheme", $e: "Toaster", ue: "toast" };
  addImport(
    module,
    pkg,
    overrides[local] ||
      (pkg === "lucide-react" ? local : local.replace(/\d+$/, "")),
    local,
  );
}
traverse(ast, {
  ReferencedIdentifier(p) {
    const user = owners.get(top(p)?.node);
    if (!modules.has(user)) return;
    const binding = p.scope.getBinding(p.node.name);
    if (!binding || !binding.scope.path.isProgram()) return;
    const dependency = owners.get(top(binding.path)?.node);
    if (dependency === user) return;
    const module = modules.get(user);
    if (modules.has(dependency)) {
      let specifier = path.posix.relative(
        path.posix.dirname(relative(user)),
        relative(dependency),
      );
      if (!specifier.startsWith(".")) specifier = "./" + specifier;
      addImport(module, specifier, p.node.name);
      modules.get(dependency).exports.add(p.node.name);
    } else externalImport(binding, module);
  },
});

function jsxName(node) {
  if (t.isStringLiteral(node)) return t.jsxIdentifier(node.value);
  if (t.isIdentifier(node)) return t.jsxIdentifier(node.name);
  if (t.isMemberExpression(node) && !node.computed)
    return t.jsxMemberExpression(jsxName(node.object), jsxName(node.property));
  throw new Error(`Tipo JSX no reconocido: ${node.type}`);
}
function child(node) {
  if (!node) return t.jsxExpressionContainer(t.nullLiteral());
  return t.isJSXElement(node) || t.isJSXFragment(node)
    ? node
    : t.jsxExpressionContainer(node);
}
traverse(ast, {
  CallExpression: {
    exit(p) {
      if (
        !/^jsxDEV\d*$/.test(p.node.callee.name || "") ||
        !modules.has(owners.get(top(p)?.node))
      )
        return;
      const [type, props, key] = p.node.arguments;
      if (!t.isObjectExpression(props))
        throw new Error("Se esperaba un objeto de propiedades JSX.");
      const attributes = [],
        children = [];
      for (const prop of props.properties) {
        if (t.isSpreadElement(prop)) {
          attributes.push(t.jsxSpreadAttribute(prop.argument));
          continue;
        }
        const name = prop.key.name || prop.key.value;
        if (name === "children") {
          if (t.isArrayExpression(prop.value))
            children.push(...prop.value.elements.map(child));
          else children.push(child(prop.value));
        } else
          attributes.push(
            t.jsxAttribute(
              t.jsxIdentifier(name),
              t.isStringLiteral(prop.value)
                ? prop.value
                : t.jsxExpressionContainer(prop.value),
            ),
          );
      }
      if (
        key &&
        !(t.isIdentifier(key, { name: "undefined" }) || t.isNullLiteral(key))
      ) {
        attributes.push(
          t.jsxAttribute(t.jsxIdentifier("key"), t.jsxExpressionContainer(key)),
        );
      }
      const name = jsxName(type);
      const result = t.jsxElement(
        t.jsxOpeningElement(name, attributes, children.length === 0),
        children.length ? t.jsxClosingElement(name) : null,
        children,
        children.length === 0,
      );
      p.replaceWith(result);
    },
  },
});

const packages = new Set();
let files = 0;
for (const [name, module] of modules) {
  const filename = relative(name);
  if (filename.includes("/examples/")) continue;
  for (const statement of module.body.filter((node) =>
    t.isImportDeclaration(node),
  )) {
    for (const spec of statement.specifiers) {
      if (statement.source.value.includes("jsx")) {
        if (spec.imported?.name === "Fragment")
          addImport(module, "react", "Fragment", spec.local.name);
      } else
        addImport(
          module,
          statement.source.value,
          spec.imported?.name,
          spec.local.name,
          t.isImportDefaultSpecifier(spec)
            ? "default"
            : t.isImportNamespaceSpecifier(spec)
              ? "namespace"
              : "named",
        );
    }
  }
  const imports = [...module.imports.values()].map((i) => {
    packages.add(i.from.startsWith(".") ? "" : i.from);
    const local = t.identifier(i.local);
    const spec =
      i.kind === "namespace"
        ? t.importNamespaceSpecifier(local)
        : i.kind === "default"
          ? t.importDefaultSpecifier(local)
          : t.importSpecifier(local, t.identifier(i.imported));
    return t.importDeclaration([spec], t.stringLiteral(i.from));
  });
  const body = module.body.filter((node) => !t.isImportDeclaration(node));
  const exports = [...module.exports].map((name) =>
    t.exportSpecifier(t.identifier(name), t.identifier(name)),
  );
  const fileAst = t.file(
    t.program([
      ...imports,
      ...body,
      ...(exports.length ? [t.exportNamedDeclaration(null, exports)] : []),
    ]),
  );
  traverse(fileAst, {
    enter(p) {
      p.node.leadingComments = null;
      p.node.innerComments = null;
      p.node.trailingComments = null;
    },
    Program(p) {
      for (const statement of p.get("body")) {
        if (
          !statement.isImportDeclaration() ||
          statement.node.source.value !== "react"
        )
          continue;
        const spec = statement.node.specifiers[0];
        const clean = t.isImportNamespaceSpecifier(spec)
          ? "React"
          : t.isImportSpecifier(spec)
            ? spec.imported.name
            : "React";
        if (spec.local.name !== clean && !p.scope.hasBinding(clean))
          p.scope.rename(spec.local.name, clean);
      }
    },
  });
  const target = path.resolve(output, filename);
  if (!target.startsWith(path.resolve(output) + path.sep))
    throw new Error("Ruta de módulo fuera del destino.");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(
    target,
    `// Recovered from the approved Polymet reference; see docs/design/polymet-reference.json.\n${generate(fileAst, { comments: false }).code}\n`,
  );
  files++;
}
const css = source.match(/s\.textContent = ("(?:\\.|[^"\\])*")/);
if (!css) throw new Error("No se encontró el CSS de la referencia.");
const stylesheet = JSON.parse(css[1]).replace(
  /@import url\("https:\/\/fonts\.googleapis\.com[^\n]+\n/,
  "",
);
fs.writeFileSync(path.join(output, "polymet.css"), stylesheet);
console.log(
  JSON.stringify(
    { files, dependencies: [...packages].filter(Boolean).sort() },
    null,
    2,
  ),
);
