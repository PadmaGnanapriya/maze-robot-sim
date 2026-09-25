/**
 * Shared data model for the Arduino C++ front end: tokens, the type-descriptor shapes
 * produced by parser.ts's parseType() (and normalized by compiler.ts's resolveType()),
 * and the full AST that parser.ts builds and compiler.ts consumes.
 *
 * A few fields that the compiler computes and stamps onto AST/type nodes after parsing
 * (StructDef.cfields, EnumDef's enumScope, PType's isConst/isStatic flags) are typed as
 * optional rather than split into separate before/after types - splitting them would
 * double the shape count for little benefit, since every consumer already has to handle
 * "not computed yet" during parsing.
 */

/* ------------------------------ tokens ------------------------------ */
export type TokenType = 'id' | 'num' | 'str' | 'chr' | 'op' | 'eof';

export interface Token {
  t: TokenType;
  v: string;
  file: string;
  line: number;
  col: number;
  val?: number;      // num (numeric value), chr (char code)
  isFloat?: boolean;  // num
  suffix?: string;    // num: u/l/ll/f combinations
  hex?: boolean;      // num: written in hex/octal/binary
}

/* ------------------------------ type descriptors ------------------------------ */
export type PrimK = 'void' | 'bool' | 'i8' | 'u8' | 'i16' | 'u16' | 'i32' | 'u32' | 'i64' | 'f32';

interface TypeQuals { isConst?: boolean; isStatic?: boolean; isVolatile?: boolean }

export interface PrimType extends TypeQuals { k: PrimK }
export interface StrType extends TypeQuals { k: 'str'; lit?: boolean; charPtr?: boolean }
export interface ArrayType extends TypeQuals { k: 'array'; elem: PType; dims: (number | null)[] }
export interface EnumType extends TypeQuals { k: 'enum'; name: string; def: EnumDef }
export interface StructType extends TypeQuals { k: 'struct'; name: string; def: StructDef }
export interface ObjType extends TypeQuals { k: 'obj'; cls: string }
export interface AutoType extends TypeQuals { k: 'auto' }
/** The `Serial` global; never produced by parseType(), only by compiler.ts's symbol lookup. */
export interface SerialObjType { k: 'serialObj' }

export type PType = PrimType | StrType | ArrayType | EnumType | StructType | ObjType | AutoType | SerialObjType;

/** A resolved struct field, computed once by ArduinoCompiler.ensureStruct(). */
export interface CField {
  name: string; t: PType; ctype: PType; initConst?: unknown; tok: Token;
}
export interface StructField {
  name: string; type: PType; dims: (Expr | null)[]; init: Expr | InitListNode | null; tok: Token;
}
export interface StructDef {
  name: string; fields: StructField[]; tok: Token;
  /** Populated by ArduinoCompiler.ensureStruct() the first time the struct is used. */
  cfields?: CField[];
}
export interface EnumItem { name: string; value: Expr | null; tok: Token }
export interface EnumDef { name: string; items: EnumItem[]; scoped: boolean; tok: Token }

/* ------------------------------ shared AST pieces ------------------------------ */
export interface Param {
  name: string | null; type: PType; isRef: boolean; dims: (Expr | null)[]; arrayParam: boolean;
  def: Expr | null; tok: Token;
}
export interface Declarator {
  name: string; dims: (Expr | null)[]; init: Expr | InitListNode | null; ctorArgs: Expr[] | null; tok: Token;
}
export interface SwitchCase { test: Expr | null; body: Stmt[]; tok: Token }

/* ------------------------------ expressions ------------------------------ */
export interface NumNode { k: 'Num'; tok: Token }
export interface ChrNode { k: 'Chr'; val: number; tok: Token }
export interface BoolNode { k: 'Bool'; val: 0 | 1; tok: Token }
export interface StrNode { k: 'Str'; v: string; tok: Token }
export interface ParenNode { k: 'Paren'; e: Expr; tok: Token }
export interface IdentNode { k: 'Ident'; name: string; tok: Token }
export interface QualNode { k: 'Qual'; scope: string; name: string; tok: Token }
export interface BinaryNode { k: 'Binary'; op: string; a: Expr; b: Expr; tok: Token }
export interface LogicalNode { k: 'Logical'; op: '&&' | '||'; a: Expr; b: Expr; tok: Token }
export interface UnaryNode { k: 'Unary'; op: string; a: Expr; tok: Token }
export interface UpdateNode { k: 'Update'; op: '++' | '--'; prefix: boolean; a: Expr; tok: Token }
export interface AssignNode { k: 'Assign'; op: string; target: Expr; value: Expr | InitListNode; tok: Token }
export interface CondNode { k: 'Cond'; test: Expr; a: Expr; b: Expr; tok: Token }
export interface CommaNode { k: 'Comma'; list: Expr[]; tok: Token }
export interface CallNode { k: 'Call'; callee: Expr; args: Expr[]; tok: Token }
export interface IndexNode { k: 'Index'; obj: Expr; index: Expr; tok: Token }
export interface MemberNode { k: 'Member'; obj: Expr; name: string; tok: Token }
export interface CastNode { k: 'Cast'; type: PType; a: Expr; tok: Token; functional?: boolean }
export interface SizeofNode { k: 'Sizeof'; type?: PType; expr?: Expr; tok: Token }
export interface InitListNode { k: 'InitList'; items: (Expr | InitListNode)[]; tok: Token }

export type Expr =
  | NumNode | ChrNode | BoolNode | StrNode | ParenNode | IdentNode | QualNode
  | BinaryNode | LogicalNode | UnaryNode | UpdateNode | AssignNode | CondNode | CommaNode
  | CallNode | IndexNode | MemberNode | CastNode | SizeofNode | InitListNode;

/* ------------------------------ statements ------------------------------ */
export interface EmptyStmt { k: 'Empty'; tok: Token }
export interface BlockStmt { k: 'Block'; body: Stmt[]; tok: Token }
export interface ExprStmt { k: 'Expr'; expr: Expr; tok: Token }
export interface VarStmt { k: 'Var'; type: PType; declarators: Declarator[]; tok: Token; isGlobal?: boolean }
export interface LocalDefsStmt { k: 'LocalDefs'; defs: TypeDeclOnly[]; tok: Token }
export interface TypedefStmt { k: 'Typedef'; name: string; type: PType; defs: TypeDeclOnly[]; tok: Token }
export interface IfStmt { k: 'If'; test: Expr; cons: Stmt; alt: Stmt | null; tok: Token }
export interface WhileStmt { k: 'While'; test: Expr; body: Stmt; tok: Token }
export interface DoWhileStmt { k: 'DoWhile'; test: Expr; body: Stmt; tok: Token }
export interface ForStmt { k: 'For'; init: VarStmt | ExprStmt | null; test: Expr | null; update: Expr | null; body: Stmt; tok: Token }
export interface SwitchStmt { k: 'Switch'; disc: Expr; cases: SwitchCase[]; tok: Token }
export interface BreakStmt { k: 'Break'; tok: Token }
export interface ContinueStmt { k: 'Continue'; tok: Token }
export interface ReturnStmt { k: 'Return'; value: Expr | null; tok: Token }

export type Stmt =
  | EmptyStmt | BlockStmt | ExprStmt | VarStmt | LocalDefsStmt | TypedefStmt
  | IfStmt | WhileStmt | DoWhileStmt | ForStmt | SwitchStmt | BreakStmt | ContinueStmt | ReturnStmt;

/* ------------------------------ top level ------------------------------ */
export interface EnumDecl { k: 'Enum'; def: EnumDef; tok: Token }
export interface StructDecl { k: 'Struct'; def: StructDef; tok: Token }
export interface FuncDecl { k: 'Func'; name: string; ret: PType; params: Param[]; body: BlockStmt; tok: Token }
export interface ProtoDecl { k: 'Proto'; name: string; ret: PType; params: Param[]; tok: Token }

/** A type-only declaration (an enum/struct definition with no variable declared alongside it). */
export type TypeDeclOnly = EnumDecl | StructDecl;
export type TopDecl = TypeDeclOnly | FuncDecl | ProtoDecl | VarStmt | TypedefStmt;

export interface Program { decls: TopDecl[] }
