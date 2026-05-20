import type { CoreMessage } from 'ai';
import type { RagSearchResult } from '@modules/rag/dto/rag-search-result.dto';
import type { CitationItem, MessageTurn } from '../types';
import { INJECTION_GUARD } from './prompts/injection-guard.prompt';
import { REWRITE_SYSTEM } from './prompts/system-rewrite.prompt';
import { ANSWER_SYSTEM } from './prompts/system-answer.prompt';

const USER_INSTRUCTION_HEADER = 'Additional guidance from administrator:';

function appendUserInstruction(
  base: string,
  userInstruction: string | null | undefined,
): string {
  if (!userInstruction || userInstruction.trim().length === 0) return base;
  return `${base}\n\n---\n${USER_INSTRUCTION_HEADER}\n${userInstruction.trim()}`;
}

export function buildRewritePrompt(
  history: MessageTurn[],
  userMessage: string,
  userInstruction: string | null = null,
): string {
  const lines: string[] = [
    appendUserInstruction(REWRITE_SYSTEM, userInstruction),
    '',
  ];
  if (history.length > 0) {
    lines.push('Conversation so far:');
    for (const turn of history) {
      lines.push(
        `${turn.role === 'user' ? 'User' : 'Assistant'}: ${turn.content}`,
      );
    }
    lines.push('');
  }
  lines.push(`Latest user message: ${userMessage}`);
  lines.push('Rewritten query:');
  return lines.join('\n');
}

function pickContent(hit: RagSearchResult): string {
  const parent = (hit.parentContent ?? '').trim();
  if (parent.length > 0) return parent;
  return hit.childContent ?? '';
}

function formatBreadcrumbs(citation: CitationItem): string {
  const trail = [...citation.breadcrumbs];
  if (citation.heading && !trail.includes(citation.heading)) {
    trail.push(citation.heading);
  }
  return trail.join(' > ');
}

function buildRagBlock(
  citations: CitationItem[],
  hits: RagSearchResult[],
  userMessage: string,
): string {
  const tocLines = citations.map((c) => {
    const title = c.title.replace(/"/g, "'");
    const crumbs = formatBreadcrumbs(c);
    const tail = crumbs.length > 0 ? ` — ${crumbs}` : '';
    return `[${c.index}] [${c.typeLabel}] "${title}"${tail}`;
  });

  const contentBlocks = citations.map((c, i) => {
    const hit = hits[i];
    const text = hit ? pickContent(hit) : '';
    return `[${c.index}] CONTENT:\n${text}`;
  });

  return [
    'Retrieved sources (cite by [n]):',
    ...tocLines,
    '',
    ...contentBlocks.map((b, i) => (i === 0 ? b : `\n${b}`)),
    '',
    `USER QUESTION:\n${userMessage}`,
  ].join('\n');
}

export function buildChatMessages(
  history: MessageTurn[],
  userMessage: string,
  citations: CitationItem[],
  ragHits: RagSearchResult[],
  userInstruction: string | null,
): CoreMessage[] {
  const messages: CoreMessage[] = [];
  const baseSystem = `${INJECTION_GUARD}\n\n${ANSWER_SYSTEM}`;
  messages.push({
    role: 'system',
    content: appendUserInstruction(baseSystem, userInstruction),
  });

  for (const turn of history) {
    messages.push({ role: turn.role, content: turn.content });
  }

  if (citations.length > 0) {
    messages.push({
      role: 'user',
      content: buildRagBlock(citations, ragHits, userMessage),
    });
  } else {
    messages.push({ role: 'user', content: userMessage });
  }

  return messages;
}
