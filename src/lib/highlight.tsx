import { Fragment, type ReactNode } from 'react';

/**
 * Surlignage des termes trouves, insensible aux accents et a la casse.
 *
 * La difficulte est de comparer sans accents tout en affichant le texte
 * d'origine : ecrire « cafe » a la place de « café » dans un extrait de
 * resultat serait visible et fautif. On construit donc une version repliee du
 * texte accompagnee d'une table qui ramene chaque caractere replie a sa
 * position d'origine. La recherche se fait sur la version repliee, le
 * decoupage sur le texte intact.
 */

interface Folded {
  text: string;
  /** `map[i]` donne l'index, dans la chaine d'origine, du caractere replie `i`. */
  map: number[];
}

function fold(input: string): Folded {
  let text = '';
  const map: number[] = [];

  for (let index = 0; index < input.length; index += 1) {
    const folded = input[index]!
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase();

    // Un caractere peut se replier en plusieurs (ou zero, pour un accent isole) :
    // la table absorbe les deux cas sans decalage.
    for (const character of folded) {
      text += character;
      map.push(index);
    }
  }

  return { text, map };
}

export interface Span {
  start: number;
  end: number;
}

/** Positions, dans le texte d'origine, de tous les termes trouves. */
export function findMatches(content: string, terms: string[]): Span[] {
  const haystack = fold(content);
  const spans: Span[] = [];

  for (const term of terms) {
    const needle = fold(term).text;
    if (needle.length === 0) continue;

    let from = 0;
    while (from <= haystack.text.length - needle.length) {
      const found = haystack.text.indexOf(needle, from);
      if (found === -1) break;

      const start = haystack.map[found];
      const end = haystack.map[found + needle.length - 1];
      if (start !== undefined && end !== undefined) {
        spans.push({ start, end: end + 1 });
      }
      from = found + needle.length;
    }
  }

  // Fusion des chevauchements, pour ne jamais imbriquer deux surlignages.
  spans.sort((a, b) => a.start - b.start);
  const merged: Span[] = [];
  for (const span of spans) {
    const last = merged[merged.length - 1];
    if (last && span.start <= last.end) {
      last.end = Math.max(last.end, span.end);
    } else {
      merged.push({ ...span });
    }
  }
  return merged;
}

/**
 * Extrait une fenetre de texte centree sur la premiere occurrence, puis rend
 * les termes trouves en surbrillance.
 */
export function Snippet({
  content,
  terms,
  radius = 90,
}: {
  content: string;
  terms: string[];
  radius?: number;
}): ReactNode {
  const matches = findMatches(content, terms);

  if (matches.length === 0) {
    const truncated = content.length > radius * 2 ? content.slice(0, radius * 2) + '…' : content;
    return <>{truncated}</>;
  }

  const first = matches[0]!;
  const from = Math.max(0, first.start - radius);
  const to = Math.min(content.length, first.start + radius);

  const visible = matches
    .filter((span) => span.start >= from && span.end <= to)
    .map((span) => ({ start: span.start - from, end: span.end - from }));

  const slice = content.slice(from, to);
  const nodes: ReactNode[] = [];
  let cursor = 0;

  visible.forEach((span, index) => {
    if (span.start > cursor) nodes.push(slice.slice(cursor, span.start));
    nodes.push(<mark key={index}>{slice.slice(span.start, span.end)}</mark>);
    cursor = span.end;
  });

  if (cursor < slice.length) nodes.push(slice.slice(cursor));

  return (
    <>
      {from > 0 ? '…' : null}
      {nodes.map((node, index) => (
        <Fragment key={index}>{node}</Fragment>
      ))}
      {to < content.length ? '…' : null}
    </>
  );
}
