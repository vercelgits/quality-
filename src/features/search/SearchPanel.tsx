import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useChat } from '@/store/chat';
import { useUI } from '@/store/ui';
import { Icon } from '@/components/Icon';
import { Avatar } from '@/components/Avatar';
import { Snippet } from '@/lib/highlight';
import { formatRelative } from '@/lib/time';
import { LIMITS } from '@/constants';
import type { SearchRow } from '@/types/db';

/**
 * Filtres inline reconnus dans la barre de recherche.
 *
 * Ils sont analyses ici plutot qu'en SQL parce que la resolution d'un
 * `de:camille` en identifiant demande l'annuaire deja charge cote client : la
 * base recoit donc des parametres deja resolus et n'a aucune chaine a
 * interpreter.
 */
const FILTER_PATTERN = /\b(de|from|dans|in|a|has|est|is|avant|before|apres|after):(\S+)/gi;

interface ParsedQuery {
  text: string;
  author: string | null;
  channel: string | null;
  hasAttachment: boolean;
  pinnedOnly: boolean;
  before: string | null;
  after: string | null;
}

function parseQuery(raw: string): ParsedQuery {
  const parsed: ParsedQuery = {
    text: '',
    author: null,
    channel: null,
    hasAttachment: false,
    pinnedOnly: false,
    before: null,
    after: null,
  };

  const rest = raw.replace(FILTER_PATTERN, (_match, key: string, value: string) => {
    const lower = value.toLowerCase();
    switch (key.toLowerCase()) {
      case 'de':
      case 'from':
        parsed.author = lower.replace(/^@/, '');
        break;
      case 'dans':
      case 'in':
        parsed.channel = lower.replace(/^#/, '');
        break;
      case 'a':
      case 'has':
        if (lower === 'fichier' || lower === 'file') parsed.hasAttachment = true;
        break;
      case 'est':
      case 'is':
        if (lower === 'epingle' || lower === 'pinned') parsed.pinnedOnly = true;
        break;
      case 'avant':
      case 'before': {
        const time = Date.parse(value);
        if (Number.isFinite(time)) parsed.before = new Date(time).toISOString();
        break;
      }
      case 'apres':
      case 'after': {
        const time = Date.parse(value);
        if (Number.isFinite(time)) parsed.after = new Date(time).toISOString();
        break;
      }
    }
    return ' ';
  });

  parsed.text = rest.trim().replace(/\s+/g, ' ');
  return parsed;
}

export function SearchPanel() {
  const query = useUI((state) => state.searchQuery);
  const setQuery = useUI((state) => state.setSearchQuery);
  const activeSpaceId = useUI((state) => state.activeSpaceId);
  const selectChannel = useUI((state) => state.selectChannel);
  const setPanel = useUI((state) => state.setPanel);

  const profiles = useChat((state) => state.profiles);
  const channels = useChat((state) => state.channels);

  const [rows, setRows] = useState<SearchRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [tookMs, setTookMs] = useState(0);
  const [scopeAll, setScopeAll] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const requestId = useRef(0);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const run = useCallback(
    async (raw: string) => {
      const parsed = parseQuery(raw);

      if (parsed.text.length === 0 && !parsed.pinnedOnly && !parsed.hasAttachment && !parsed.author) {
        setRows(null);
        return;
      }

      const ticket = ++requestId.current;
      setBusy(true);
      const startedAt = performance.now();

      const authorId = parsed.author
        ? (Object.values(profiles).find(
            (item) =>
              item.username.toLowerCase() === parsed.author ||
              item.display_name.toLowerCase() === parsed.author,
          )?.id ?? null)
        : null;

      const channelId = parsed.channel
        ? (channels.find((item) => item.name.toLowerCase() === parsed.channel)?.id ?? null)
        : null;

      const { data, error } = await supabase.rpc('search_messages', {
        p_query: parsed.text,
        p_space_id: scopeAll ? null : activeSpaceId,
        p_author_id: authorId,
        p_channel_id: channelId,
        p_has_attachment: parsed.hasAttachment,
        p_pinned_only: parsed.pinnedOnly,
        p_before: parsed.before,
        p_after: parsed.after,
        p_limit: LIMITS.searchPageSize,
        p_offset: 0,
      });

      // Une reponse plus lente d'une frappe precedente ne doit pas ecraser un
      // resultat plus recent.
      if (ticket !== requestId.current) return;

      setTookMs(Math.round(performance.now() - startedAt));
      setBusy(false);
      setRows(error ? [] : ((data ?? []) as SearchRow[]));
    },
    [profiles, channels, activeSpaceId, scopeAll],
  );

  // Recherche differee : on attend une pause dans la frappe pour ne pas lancer
  // une requete par caractere.
  useEffect(() => {
    const timer = window.setTimeout(() => void run(query), 220);
    return () => window.clearTimeout(timer);
  }, [query, run]);

  const terms = parseQuery(query).text.split(/\s+/).filter(Boolean);
  const total = rows?.[0]?.total_count ?? 0;

  return (
    <div className="search">
      <div className="search__bar">
        <Icon name="search" size={16} />
        <input
          ref={inputRef}
          className="search__input"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Rechercher…  de:camille  dans:general  est:epingle"
          aria-label="Rechercher dans les messages"
        />
        {query ? (
          <button
            type="button"
            className="icon-btn"
            onClick={() => setQuery('')}
            aria-label="Effacer"
          >
            <Icon name="x" size={14} />
          </button>
        ) : null}
      </div>

      <div className="search__scope">
        <button
          type="button"
          className={'chip' + (!scopeAll ? ' is-active' : '')}
          onClick={() => setScopeAll(false)}
        >
          Cet espace
        </button>
        <button
          type="button"
          className={'chip' + (scopeAll ? ' is-active' : '')}
          onClick={() => setScopeAll(true)}
        >
          Partout
        </button>

        {rows !== null ? (
          <span className="search__stats">
            {busy ? (
              <span className="spinner" />
            ) : (
              `${total} resultat${total > 1 ? 's' : ''} · ${tookMs} ms`
            )}
          </span>
        ) : null}
      </div>

      <div className="search__results scroll">
        {rows === null ? (
          <div className="panel-empty">
            <Icon name="search" size={26} />
            <p>Cherchez dans tout l’historique.</p>
            <ul className="search__tips">
              <li>
                <span className="kbd">de:camille</span> les messages d’une personne
              </li>
              <li>
                <span className="kbd">dans:general</span> un salon precis
              </li>
              <li>
                <span className="kbd">est:epingle</span> uniquement les epingles
              </li>
              <li>
                <span className="kbd">a:fichier</span> avec piece jointe
              </li>
              <li>
                <span className="kbd">apres:2026-01-01</span> une periode
              </li>
            </ul>
            <p className="panel-empty__hint">
              Les accents sont ignores : « reunion » trouve « réunion ».
            </p>
          </div>
        ) : rows.length === 0 ? (
          <div className="panel-empty">
            <Icon name="search" size={26} />
            <p>Aucun resultat.</p>
            <p className="panel-empty__hint">Essayez moins de mots, ou retirez un filtre.</p>
          </div>
        ) : (
          <ul className="search__list">
            {rows.map((row) => {
              const author = profiles[row.author_id];
              return (
                <li key={row.id}>
                  <button
                    type="button"
                    className="search-hit"
                    onClick={() => {
                      selectChannel(row.channel_id);
                      setPanel('none');
                      window.setTimeout(() => {
                        document
                          .getElementById(`message-${row.id}`)
                          ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                      }, 400);
                    }}
                  >
                    <div className="search-hit__head">
                      <Avatar profile={author} size={20} />
                      <span className="search-hit__author">
                        {author?.display_name ?? 'Inconnu'}
                      </span>
                      <span className="search-hit__channel">#{row.channel_name}</span>
                      {row.pinned ? <Icon name="pin" size={11} /> : null}
                      <span className="search-hit__time">{formatRelative(row.created_at)}</span>
                    </div>
                    <p className="search-hit__body">
                      <Snippet content={row.content} terms={terms} />
                    </p>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
