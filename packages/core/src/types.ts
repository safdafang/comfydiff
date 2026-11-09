
export type Value = string | number | boolean | null | Value[] | { [k: string]: Value };

export type NodeMode = 'active' | 'muted' | 'bypassed';


export interface LinkRef {
  
  from: string;
  
  slot: number;
}

export interface NormNode {
  id: string;
  
  type: string;
  
  title?: string;
  mode: NodeMode;
  
  params: Record<string, Value>;
  
  namedParams: boolean;
  
  inputs: Record<string, LinkRef>;
  
  outputNames?: string[];
  
  inputTypes?: Record<string, string>;
  outputTypes?: string[];
  
  layout?: NodeLayout;
  
  group?: string;
}

export interface NodeLayout {
  pos?: [number, number];
  size?: [number, number];
  color?: string;
  bgcolor?: string;
  collapsed?: boolean;
}

export type SourceFormat = 'api' | 'editor' | 'api+editor';

export interface NormGraph {
  format: SourceFormat;
  nodes: Map<string, NormNode>;
  
  groups: string[];
  
  notes: Map<string, string>;
  
  warnings: string[];
}

export interface WordToken {
  op: 'eq' | 'add' | 'del';
  text: string;
}

export interface ParamChange {
  name: string;
  
  named: boolean;
  from?: Value;
  to?: Value;
  
  words?: WordToken[];
}

export interface NodeRef {
  
  idA?: string;
  
  idB?: string;
  type: string;
  
  label: string;
}

export interface NodeParamChanges {
  node: NodeRef;
  changes: ParamChange[];
  
  seedChanged?: boolean;
}

export interface NodeSummary {
  node: NodeRef;
  
  keyParams: string[];
  mode: NodeMode;
}

export interface LinkChange {
  
  node: NodeRef;
  input: string;
  
  from?: { node: NodeRef; output: string };
  to?: { node: NodeRef; output: string };
}

export interface ModeChange {
  node: NodeRef;
  from: NodeMode;
  to: NodeMode;
}

export interface CosmeticSummary {
  moved: number;
  resized: number;
  recolored: number;
  retitled: number;
  collapsed: number;
  notesChanged: number;
  groupsChanged: number;
  total: number;
}

export interface DiffReport {
  
  significant: boolean;
  formats: { a: SourceFormat; b: SourceFormat };
  params: NodeParamChanges[];
  added: NodeSummary[];
  removed: NodeSummary[];
  links: LinkChange[];
  modes: ModeChange[];
  cosmetic: CosmeticSummary;
  
  unnamedTypes: string[];
  warnings: string[];
  stats: { nodesA: number; nodesB: number; matched: number; matchedById: number };
}
