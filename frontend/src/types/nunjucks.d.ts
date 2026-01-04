/**
 * Type declarations for nunjucks internals not covered by @types/nunjucks.
 *
 * The nunjucks parser and nodes are used for AST-based template variable extraction.
 * We use `any` for node types since the AST structure varies by node type and
 * we use runtime instanceof checks for type safety.
 */

declare module 'nunjucks' {
  /**
   * Parser module for parsing templates into AST.
   */
  export const parser: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    parse(src: string, extensions?: unknown, opts?: unknown): any
  }

  /**
   * Node type constructors for instanceof checks.
   * We use `any` since node properties vary by type.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type NodeConstructor = new (...args: any[]) => any

  /**
   * Available node types in nunjucks AST.
   */
  export const nodes: {
    Node: NodeConstructor
    Root: NodeConstructor
    NodeList: NodeConstructor
    Value: NodeConstructor
    Literal: NodeConstructor
    Symbol: NodeConstructor
    Group: NodeConstructor
    Array: NodeConstructor
    Pair: NodeConstructor
    Dict: NodeConstructor
    Output: NodeConstructor
    Capture: NodeConstructor
    TemplateData: NodeConstructor
    If: NodeConstructor
    IfAsync: NodeConstructor
    InlineIf: NodeConstructor
    For: NodeConstructor
    AsyncEach: NodeConstructor
    AsyncAll: NodeConstructor
    Macro: NodeConstructor
    Caller: NodeConstructor
    Import: NodeConstructor
    FromImport: NodeConstructor
    FunCall: NodeConstructor
    Filter: NodeConstructor
    FilterAsync: NodeConstructor
    KeywordArgs: NodeConstructor
    Block: NodeConstructor
    Super: NodeConstructor
    Extends: NodeConstructor
    Include: NodeConstructor
    Set: NodeConstructor
    Switch: NodeConstructor
    Case: NodeConstructor
    LookupVal: NodeConstructor
    BinOp: NodeConstructor
    In: NodeConstructor
    Is: NodeConstructor
    Or: NodeConstructor
    And: NodeConstructor
    Not: NodeConstructor
    Add: NodeConstructor
    Concat: NodeConstructor
    Sub: NodeConstructor
    Mul: NodeConstructor
    Div: NodeConstructor
    FloorDiv: NodeConstructor
    Mod: NodeConstructor
    Pow: NodeConstructor
    Neg: NodeConstructor
    Pos: NodeConstructor
    Compare: NodeConstructor
    CompareOperand: NodeConstructor
    CallExtension: NodeConstructor
    CallExtensionAsync: NodeConstructor
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    printNodes(node: any): void
  }
}
