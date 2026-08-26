import { Fragment, useState, type ReactNode } from 'react';

/**
 * Mise en forme legere des messages.
 *
 * Le texte est transforme en elements React, jamais en HTML injecte. React
 * echappe automatiquement tout ce qu'il rend, donc un message contenant
 * `<img onerror=...>` s'affiche comme du texte au lieu de s'executer. C'est la
 * raison pour laquelle ce fichier n'utilise nulle part `dangerouslySetInnerHTML`.
 */

export interface RichTextContext {
  /** Pseudo en minuscules vers profil, pour resoudre les mentions. */
  usersByUsername: Map<string, { id: string; display_name: string }>;
  /** Nom de salon en minuscules vers salon. */
  channelsByName: Map<string, { id: string; name: string }>;
  /** Pseudo de la personne connectee, pour surligner ses propres mentions. */
  currentUsername: string | null;
  onUserClick?: (userId: string) => void;
  onChannelClick?: (channelId: string) => void;
}

const EMPTY_CONTEXT: RichTextContext = {
  usersByUsername: new Map(),
  channelsByName: new Map(),
  currentUsername: null,
};

/* -------------------------------------------------------------------------- */
/* Niveau bloc                                                                 */
/* -------------------------------------------------------------------------- */

type Block =
  | { type: 'code'; language: string | null; content: string }
  | { type: 'quote'; lines: string[] }
  | { type: 'text'; lines: string[] };

/** Decoupe le message en blocs de code, citations et paragraphes. */
function splitBlocks(input: string): Block[] {
  const blocks: Block[] = [];
  const lines = input.split('\n');
  let index = 0;

  while (index < lines.length) {
    const line = lines[index]!;
    const fence = /^```(\w+)?\s*$/.exec(line);

    if (fence) {
      const language = fence[1] ?? null;
      const content: string[] = [];
      index += 1;

      while (index < lines.length && !/^```\s*$/.test(lines[index]!)) {
        content.push(lines[index]!);
        index += 1;
      }
      index += 1; // consomme la cloture

      blocks.push({ type: 'code', language, content: content.join('\n') });
      continue;
    }

    if (line.startsWith('> ') || line === '>') {
      const quoted: string[] = [];
      while (index < lines.length) {
        const candidate = lines[index]!;
        if (!candidate.startsWith('> ') && candidate !== '>') break;
        quoted.push(candidate.replace(/^>\s?/, ''));
        index += 1;
      }
      blocks.push({ type: 'quote', lines: quoted });
      continue;
    }

    const text: string[] = [];
    while (index < lines.length) {
      const candidate = lines[index]!;
      if (/^```(\w+)?\s*$/.test(candidate) || candidate.startsWith('> ') || candidate === '>') break;
      text.push(candidate);
      index += 1;
    }
    if (text.length > 0) blocks.push({ type: 'text', lines: text });
  }

  return blocks;
}

/* -------------------------------------------------------------------------- */
/* Niveau ligne                                                                */
/* -------------------------------------------------------------------------- */

interface Matcher {
  pattern: RegExp;
  render: (match: RegExpExecArray, context: RichTextContext, key: string) => ReactNode;
}

/**
 * L'ordre compte : le code litteral passe en premier pour que son contenu
 * echappe a toute autre interpretation, exactement comme on l'attend en Markdown.
 */
const MATCHERS: Matcher[] = [
  {
    pattern: /`([^`\n]+)`/,
    render: (match, _context, key) => (
      <code className="rt-code" key={key}>
        {match[1]}
      </code>
    ),
  },
  {
    pattern: /\|\|([\s\S]+?)\|\|/,
    render: (match, context, key) => (
      <Spoiler key={key} content={match[1] ?? ''} context={context} />
    ),
  },
  {
    pattern: /\*\*\*([^\n]+?)\*\*\*/,
    render: (match, context, key) => (
      <strong key={key}>
        <em>{renderInline(match[1] ?? '', context, key)}</em>
      </strong>
    ),
  },
  {
    pattern: /\*\*([^\n]+?)\*\*/,
    render: (match, context, key) => (
      <strong key={key}>{renderInline(match[1] ?? '', context, key)}</strong>
    ),
  },
  {
    pattern: /~~([^\n]+?)~~/,
    render: (match, context, key) => (
      <s key={key}>{renderInline(match[1] ?? '', context, key)}</s>
    ),
  },
  {
    pattern: /__([^\n]+?)__/,
    render: (match, context, key) => (
      <u key={key}>{renderInline(match[1] ?? '', context, key)}</u>
    ),
  },
  {
    pattern: /(?<![\w*])\*([^*\n]+?)\*(?![\w*])/,
    render: (match, context, key) => (
      <em key={key}>{renderInline(match[1] ?? '', context, key)}</em>
    ),
  },
  {
    pattern: /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/,
    render: (match, _context, key) => (
      <a key={key} href={match[2]} target="_blank" rel="noopener noreferrer nofollow">
        {match[1]}
      </a>
    ),
  },
  {
    pattern: /https?:\/\/[^\s<>()]+[^\s<>().,;:!?]/,
    render: (match, _context, key) => (
      <a key={key} href={match[0]} target="_blank" rel="noopener noreferrer nofollow">
        {shortenUrl(match[0])}
      </a>
    ),
  },
  {
    pattern: /@([a-zA-Z0-9_.-]{2,32})/,
    render: (match, context, key) => {
      const raw = (match[1] ?? '').toLowerCase();
      const isBroadcast = raw === 'everyone' || raw === 'here' || raw === 'tous';
      const profile = context.usersByUsername.get(raw);

      if (!profile && !isBroadcast) return <Fragment key={key}>{match[0]}</Fragment>;

      const isMe =
        isBroadcast || (context.currentUsername !== null && raw === context.currentUsername);

      return (
        <button
          key={key}
          type="button"
          className={'rt-mention' + (isMe ? ' rt-mention--self' : '')}
          onClick={profile ? () => context.onUserClick?.(profile.id) : undefined}
          disabled={!profile}
        >
          @{profile ? profile.display_name : raw}
        </button>
      );
    },
  },
  {
    pattern: /#([a-zA-Z0-9_-]{1,48})/,
    render: (match, context, key) => {
      const channel = context.channelsByName.get((match[1] ?? '').toLowerCase());
      if (!channel) return <Fragment key={key}>{match[0]}</Fragment>;

      return (
        <button
          key={key}
          type="button"
          className="rt-channel"
          onClick={() => context.onChannelClick?.(channel.id)}
        >
          #{channel.name}
        </button>
      );
    },
  },
];

/** Trouve le motif qui commence le plus tot dans le texte restant. */
function firstMatch(text: string): { matcher: Matcher; match: RegExpExecArray } | null {
  let best: { matcher: Matcher; match: RegExpExecArray } | null = null;

  for (const matcher of MATCHERS) {
    const match = matcher.pattern.exec(text);
    if (!match) continue;
    if (best === null || match.index < best.match.index) {
      best = { matcher, match };
    }
  }
  return best;
}

function renderInline(text: string, context: RichTextContext, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let remaining = text;
  let offset = 0;
  // Garde-fou : un motif pathologique ne doit pas figer l'onglet.
  let iterations = 0;

  while (remaining.length > 0 && iterations < 500) {
    iterations += 1;
    const found = firstMatch(remaining);

    if (!found) {
      nodes.push(remaining);
      break;
    }

    if (found.match.index > 0) {
      nodes.push(remaining.slice(0, found.match.index));
    }

    nodes.push(found.matcher.render(found.match, context, `${keyPrefix}-${offset}`));

    const consumed = found.match.index + found.match[0].length;
    remaining = remaining.slice(consumed);
    offset += consumed;
  }

  if (iterations >= 500 && remaining.length > 0) nodes.push(remaining);
  return nodes;
}

/** Raccourcit une URL trop longue pour ne pas casser la mise en page. */
function shortenUrl(url: string): string {
  if (url.length <= 62) return url;
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname.slice(0, 24)}…`;
  } catch {
    return `${url.slice(0, 58)}…`;
  }
}

/* -------------------------------------------------------------------------- */
/* Composants                                                                  */
/* -------------------------------------------------------------------------- */

function Spoiler({ content, context }: { content: string; context: RichTextContext }) {
  const [revealed, setRevealed] = useState(false);

  return (
    <button
      type="button"
      className={'rt-spoiler' + (revealed ? ' is-revealed' : '')}
      onClick={() => setRevealed(true)}
      aria-label={revealed ? undefined : 'Contenu masque, cliquer pour afficher'}
    >
      {revealed ? renderInline(content, context, 'spoiler') : content}
    </button>
  );
}

export function RichText({
  content,
  context = EMPTY_CONTEXT,
}: {
  content: string;
  context?: RichTextContext;
}) {
  const blocks = splitBlocks(content);

  return (
    <div className="rt">
      {blocks.map((block, index) => {
        if (block.type === 'code') {
          return (
            <pre className="rt-block-code" key={index}>
              {block.language ? <span className="rt-block-code__lang">{block.language}</span> : null}
              <code>{block.content}</code>
            </pre>
          );
        }

        if (block.type === 'quote') {
          return (
            <blockquote className="rt-quote" key={index}>
              {block.lines.map((line, lineIndex) => (
                <p key={lineIndex}>{renderInline(line, context, `q-${index}-${lineIndex}`)}</p>
              ))}
            </blockquote>
          );
        }

        return (
          <p className="rt-text" key={index}>
            {block.lines.map((line, lineIndex) => (
              <Fragment key={lineIndex}>
                {lineIndex > 0 ? <br /> : null}
                {renderInline(line, context, `t-${index}-${lineIndex}`)}
              </Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}

/** Extrait les pseudos mentionnes, pour les notifications cote client. */
export function mentionedUsernames(content: string): string[] {
  return [...content.matchAll(/@([a-zA-Z0-9_.-]{2,32})/g)].map((match) => match[1]!.toLowerCase());
}
