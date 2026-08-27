import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '@/components/Icon';
import {
  EMOJI_CATEGORIES,
  rememberEmoji,
  recentEmojis,
  searchEmojis,
} from '@/lib/emoji';

/**
 * Selecteur d'emoji.
 *
 * Une seule implementation sert au compositeur et aux reactions : deux
 * variantes finiraient toujours par diverger, et c'est le meme geste.
 */
export function EmojiPicker({
  onPick,
  onClose,
  align = 'left',
}: {
  onPick: (char: string) => void;
  onClose: () => void;
  /** Cote d'ancrage, pour ne pas deborder du bord de la fenetre. */
  align?: 'left' | 'right';
}) {
  const [query, setQuery] = useState('');
  const [recent, setRecent] = useState<string[]>(() => recentEmojis());
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Fermeture au clic exterieur et a Echap : sans cela, le panneau resterait
  // ouvert derriere ce qu'on essaie de faire ensuite.
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose]);

  const results = useMemo(() => (query.trim() ? searchEmojis(query) : null), [query]);

  const choose = (char: string) => {
    rememberEmoji(char);
    setRecent(recentEmojis());
    onPick(char);
  };

  return (
    <div
      ref={ref}
      className={'emoji-picker surface emoji-picker--' + align}
      role="dialog"
      aria-label="Choisir un emoji"
    >
      <div className="emoji-picker__search">
        <Icon name="search" size={15} />
        <input
          ref={inputRef}
          className="emoji-picker__input"
          value={query}
          placeholder="Rechercher : pouce, fete, bug…"
          onChange={(event) => setQuery(event.target.value)}
          aria-label="Rechercher un emoji"
        />
      </div>

      <div className="emoji-picker__body scroll">
        {results ? (
          results.length === 0 ? (
            <p className="emoji-picker__empty">
              Aucun emoji pour « {query.trim()} ».
            </p>
          ) : (
            <Section label="Resultats" emojis={results.map((item) => item.char)} onPick={choose} />
          )
        ) : (
          <>
            {recent.length > 0 ? (
              <Section label="Recents" emojis={recent} onPick={choose} />
            ) : null}

            {EMOJI_CATEGORIES.map((category) => (
              <Section
                key={category.id}
                label={category.label}
                emojis={category.emojis.map((item) => item.char)}
                onPick={choose}
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
}

function Section({
  label,
  emojis,
  onPick,
}: {
  label: string;
  emojis: string[];
  onPick: (char: string) => void;
}) {
  return (
    <section className="emoji-section">
      <h3 className="emoji-section__label">{label}</h3>
      <div className="emoji-section__grid">
        {emojis.map((char, index) => (
          <button
            type="button"
            key={`${char}-${index}`}
            className="emoji-section__item"
            onClick={() => onPick(char)}
            aria-label={char}
          >
            {char}
          </button>
        ))}
      </div>
    </section>
  );
}
