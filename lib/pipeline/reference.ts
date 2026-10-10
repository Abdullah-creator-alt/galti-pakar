import { qualityBasisSchema, type QualityBasis } from "./benchmark.types.ts";

export interface ReferenceMeta {
  title: string;
  topic: string;
  theme: string;
  source: string;
  permission: string;
  qualityBasis: QualityBasis;
}

export interface ParsedReference {
  meta: ReferenceMeta;
  text: string;
}

const REQUIRED = ["title", "topic", "theme", "source", "permission", "quality_basis"] as const;
const PERMISSION = /^(own|permission-granted|public-domain|openly-licensed:\S.*)$/;

export class ReferenceError extends Error {
  problems: string[];
  constructor(problems: string[]) {
    super(problems.join("; "));
    this.problems = problems;
  }
}

/** Parses "--- key: value ---" front matter followed by the essay text. Throws ReferenceError listing every problem. */
export function parseReference(raw: string, themeKeys: string[]): ParsedReference {
  const m = raw.replace(/^﻿/, "").match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) throw new ReferenceError(["missing front matter (expected --- ... --- at the top)"]);
  const fields: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i > 0) fields[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
  }
  const problems: string[] = [];
  for (const k of REQUIRED) if (!fields[k]) problems.push(`missing ${k}`);
  if (fields.permission && !PERMISSION.test(fields.permission)) problems.push(`invalid permission "${fields.permission}" (own | permission-granted | openly-licensed:<licence> | public-domain)`);
  if (fields.quality_basis && !qualityBasisSchema.safeParse(fields.quality_basis).success) problems.push(`invalid quality_basis "${fields.quality_basis}"`);
  if (fields.theme && !themeKeys.includes(fields.theme)) problems.push(`unknown theme "${fields.theme}" (see data/themes.json)`);
  const text = m[2].trim();
  if (text.split(/\s+/).filter(Boolean).length < 150) problems.push("essay text is shorter than 150 words");
  if (problems.length) throw new ReferenceError(problems);
  return {
    meta: {
      title: fields.title,
      topic: fields.topic,
      theme: fields.theme,
      source: fields.source,
      permission: fields.permission,
      qualityBasis: fields.quality_basis as QualityBasis,
    },
    text,
  };
}
