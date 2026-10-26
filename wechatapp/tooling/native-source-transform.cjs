const ts = require('typescript');
// Only the Mini Program build changes browser confirmations into awaited native
// dialogs. Making the nearest event handler async preserves cancellation guards.
exports.transformNativeSource = (source, filename) => {
  const compression = /[\\/]services[\\/]arrival-images\.service\.ts$/.test(filename);
  if (!source.includes('window.confirm') && !compression) return source;
  const file = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const result = ts.transform(file, [context => {
    const f = context.factory;
    let owner;
    const visit = node => {
      if(compression && ts.isVariableDeclaration(node) && node.name.getText(file)==='compressArrivalImage'){
        const replacement=ts.createSourceFile('native.ts','const compressArrivalImage = async (file: File): Promise<ProcessedArrivalImage> => window.__storehubCompressImage(file);',ts.ScriptTarget.Latest,true,ts.ScriptKind.TS).statements[0].declarationList.declarations[0].initializer;
        return f.updateVariableDeclaration(node,node.name,node.exclamationToken,node.type,replacement);
      }
      if (ts.isFunctionLike(node) && node.body) {
        const previous = owner;
        owner = { changed: false };
        let updated = ts.visitEachChild(node, visit, context);
        const changed = owner.changed;
        owner = previous;
        if (changed && !updated.modifiers?.some(m => m.kind === ts.SyntaxKind.AsyncKeyword)) {
          const mods = f.createNodeArray([...(updated.modifiers || []), f.createModifier(ts.SyntaxKind.AsyncKeyword)]);
          if (ts.isArrowFunction(updated)) updated = f.updateArrowFunction(updated, mods, updated.typeParameters, updated.parameters, updated.type, updated.equalsGreaterThanToken, updated.body);
          else if (ts.isFunctionDeclaration(updated)) updated = f.updateFunctionDeclaration(updated, mods, updated.asteriskToken, updated.name, updated.typeParameters, updated.parameters, updated.type, updated.body);
          else if (ts.isFunctionExpression(updated)) updated = f.updateFunctionExpression(updated, mods, updated.asteriskToken, updated.name, updated.typeParameters, updated.parameters, updated.type, updated.body);
          else throw new Error('Review native dialog owner in '+filename);
        }
        return updated;
      }
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
        && node.expression.expression.getText(file) === 'window' && node.expression.name.text === 'confirm') {
        if (!owner) throw new Error('Native confirmation requires an event handler in '+filename);
        owner.changed = true;
        const call = f.updateCallExpression(node, f.createPropertyAccessExpression(f.createIdentifier('window'), '__storehubConfirm'), node.typeArguments, node.arguments.map(arg => ts.visitNode(arg, visit)));
        return f.createAwaitExpression(call);
      }
      return ts.visitEachChild(node, visit, context);
    };
    return root => ts.visitNode(root, visit);
  }]);
  try { return ts.createPrinter().printFile(result.transformed[0]); } finally { result.dispose(); }
};
