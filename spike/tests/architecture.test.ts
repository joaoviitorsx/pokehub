import { readdirSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const domainDir = resolve('spike/domain');
const contractsDir = resolve('spike/contracts'); // contratos são tipos compartilhados e obedecem à mesma fronteira
function allowedDomainImport(source: string, specifier: string): boolean {
  if (!specifier.startsWith('./') && !specifier.startsWith('../')) return false;
  const target = resolve(dirname(source), specifier);
  return [domainDir,contractsDir].some(dir => {
    const rel = relative(dir, target);
    return rel !== '..' && !rel.startsWith(`..${sep}`) && !rel.startsWith(sep);
  });
}
function domainFiles(directory: string): string[] {
  return readdirSync(directory,{withFileTypes:true}).flatMap(entry => {
    const path = resolve(directory,entry.name);
    if (entry.isDirectory()) return domainFiles(path);
    return entry.isFile() && /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}
function dependencies(file: string): string[] {
  const source = ts.createSourceFile(file,readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true);
  const imports:string[] = [];
  function visit(node: ts.Node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      imports.push(ts.isStringLiteral(node.moduleSpecifier) ? node.moduleSpecifier.text : '<dinâmico>');
    }
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
      const arg=node.arguments[0]; imports.push(arg && ts.isStringLiteral(arg) ? arg.text : '<dinâmico>');
    }
    ts.forEachChild(node,visit);
  }
  visit(source);
  return imports;
}
describe('fronteira do domínio', () => {
  it('recusa infraestrutura e dependências fora do domínio', () => {
    const file=resolve(domainDir,'example.ts');
    expect(allowedDomainImport(file,'./value')).toBe(true);
    expect(allowedDomainImport(file,'../contracts/grindolino')).toBe(true);
    for (const specifier of ['electron','node:sqlite','react','../electron/main','<dinâmico>']) expect(allowedDomainImport(file,specifier)).toBe(false);
  });
  it('mantém os arquivos de domínio independentes de infraestrutura', () => {
    const files=[...domainFiles(domainDir),...domainFiles(contractsDir)];
    expect(files.length).toBeGreaterThan(0);
    const violations=files.flatMap(file => dependencies(file).filter(specifier => !allowedDomainImport(file,specifier)).map(specifier => `${relative(process.cwd(),file)}: ${specifier}`));
    expect(violations).toEqual([]);
  });
});
