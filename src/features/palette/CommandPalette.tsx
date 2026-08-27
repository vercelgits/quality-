import { useEffect, useMemo, useRef, useState } from 'react';
import { useChat } from '@/store/chat';
import { useUI } from '@/store/ui';

/** Cycle des themes, et leur nom tel qu'il est annonce dans la palette. */
const NEXT_THEME: Record<Theme, Theme> = {
  light: 'dark',
  dark: 'black',
  black: 'system',
  system: 'light',
};

const THEME_LABELS: Record<Theme, string> = {
  light: 'clair',
  dark: 'sombre',
  black: 'noir',
  system: 'du systeme',
};
import { useSession, type Theme } from '@/store/session';
import { Icon, type IconName } from '@/components/Icon';
import { Avatar } from '@/components/Avatar';

interface Command {
  id: string;
  label: string;
  hint?: string;
  icon: IconName;
  group: string;
  /** Texte supplementaire pris en compte par le filtre. */
  keywords?: string;
  run: () => void;
}

/**
 * Palette de commandes, ouverte par Ctrl+K.
 *
 * Elle sert de point d'entree unique : aller a un salon, ouvrir un profil,
 * changer de theme, lancer une recherche. Une application ou tout se fait au
 * clavier evite l'aller-retour permanent vers la souris, et c'est ce qui
 * distingue le plus un outil qu'on utilise huit heures par jour.
 */
export function CommandPalette() {
  const open = useUI((state) => state.paletteOpen);
  const setOpen = useUI((state) => state.setPaletteOpen);
  const selectChannel = useUI((state) => state.selectChannel);
  const selectSpace = useUI((state) => state.selectSpace);
  const setPanel = useUI((state) => state.setPanel);
  const openModal = useUI((state) => state.openModal);
  const setSearchQuery = useUI((state) => state.setSearchQuery);

  const channels = useChat((state) => state.channels);
  const spaces = useChat((state) => state.spaces);
  const profiles = useChat((state) => state.profiles);

  const ranks = useChat((state) => state.ranks);
  const activeSpaceId = useUI((state) => state.activeSpaceId);

  const preferences = useSession((state) => state.preferences);
  const setPreference = useSession((state) => state.setPreference);
  const signOut = useSession((state) => state.signOut);

  const [query, setQuery] = useState('');
  const [highlighted, setHighlighted] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setHighlighted(0);
    // Le focus doit attendre que l'element soit reellement affiche.
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  const commands = useMemo((): Command[] => {
    const list: Command[] = [];

    for (const space of spaces) {
      const spaceChannels = channels.filter((channel) => channel.space_id === space.id);
      for (const channel of spaceChannels) {
        list.push({
          id: `channel:${channel.id}`,
          label: `${channel.kind === 'voice' ? '' : '#'}${channel.name}`,
          hint: space.name,
          icon: channel.kind === 'voice' ? 'volume' : 'hash',
          group: 'Salons',
          keywords: `${space.name} ${channel.topic ?? ''}`,
          run: () => {
            selectSpace(space.id);
            selectChannel(channel.id);
          },
        });
      }
    }

    for (const space of spaces) {
      list.push({
        id: `space:${space.id}`,
        label: space.name,
        hint: 'Espace',
        icon: 'compass',
        group: 'Espaces',
        run: () => selectSpace(space.id),
      });
    }

    for (const profile of Object.values(profiles)) {
      list.push({
        id: `profile:${profile.id}`,
        label: profile.display_name,
        hint: `@${profile.username}`,
        icon: 'users',
        group: 'Personnes',
        keywords: profile.username,
        run: () => openModal({ kind: 'profile', userId: profile.id }),
      });
    }

    list.push(
      {
        id: 'action:search',
        label: 'Rechercher dans les messages',
        hint: 'Ouvre le panneau de recherche',
        icon: 'search',
        group: 'Actions',
        keywords: 'trouver chercher',
        run: () => {
          setSearchQuery('');
          setPanel('search');
        },
      },
      {
        id: 'action:theme',
        // Le cycle annonce ou il mene : « changer de theme » obligerait a
        // cliquer pour savoir ce qu'on obtient.
        label: `Passer au theme ${THEME_LABELS[NEXT_THEME[preferences.theme]]}`,
        icon: preferences.theme === 'light' ? 'moon' : 'sun',
        group: 'Actions',
        keywords: 'theme sombre clair noir systeme apparence',
        run: () => setPreference('theme', NEXT_THEME[preferences.theme]),
      },
      {
        id: 'action:density',
        label: `Densite : ${preferences.density === 'compact' ? 'passer a confortable' : preferences.density === 'cozy' ? 'passer a aeree' : 'passer a compacte'}`,
        icon: 'filter',
        group: 'Actions',
        keywords: 'densite espacement compact',
        run: () =>
          setPreference(
            'density',
            preferences.density === 'compact'
              ? 'cozy'
              : preferences.density === 'cozy'
                ? 'spacious'
                : 'compact',
          ),
      },
      {
        id: 'action:bookmarks',
        label: 'Messages sauvegardes',
        hint: 'Visibles de vous seul',
        icon: 'inbox',
        group: 'Actions',
        keywords: 'signets garder cote favoris',
        run: () => openModal({ kind: 'bookmarks' }),
      },
      {
        id: 'action:preferences',
        label: 'Ouvrir les preferences',
        icon: 'settings',
        group: 'Actions',
        keywords: 'reglages parametres options',
        run: () => useUI.getState().openSettings(),
      },
      {
        id: 'action:create-space',
        label: 'Creer un espace',
        icon: 'plus',
        group: 'Actions',
        run: () => openModal({ kind: 'create-space' }),
      },
      {
        id: 'action:join-space',
        label: 'Rejoindre un espace avec un code',
        icon: 'compass',
        group: 'Actions',
        keywords: 'invitation code',
        run: () => openModal({ kind: 'join-space' }),
      },
      {
        id: 'action:signout',
        label: 'Se deconnecter',
        icon: 'log-out',
        group: 'Actions',
        keywords: 'quitter deconnexion',
        run: () => void signOut(),
      },
    );

    // La console n'apparait que pour qui peut s'en servir : proposer une
    // commande qui echouerait ensuite ne rend service a personne.
    if (activeSpaceId && (ranks[activeSpaceId] ?? 0) >= 1) {
      list.push({
        id: 'action:moderation',
        label: 'Console de moderation',
        hint: 'Membres, signalements, journal',
        icon: 'filter',
        group: 'Actions',
        keywords: 'bannir exclure silence signalement',
        run: () => openModal({ kind: 'moderation', spaceId: activeSpaceId }),
      });
    }

    return list;
  }, [
    spaces,
    channels,
    profiles,
    preferences,
    ranks,
    activeSpaceId,
    selectSpace,
    selectChannel,
    setPanel,
    openModal,
    setPreference,
    setSearchQuery,
    signOut,
  ]);

  /**
   * Filtrage par sous-sequence : « gnl » trouve « general ». C'est plus
   * permissif qu'une simple inclusion et evite d'avoir a taper le mot exact.
   */
  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle.length === 0) return commands.slice(0, 24);

    const scored = commands
      .map((command) => {
        const haystack = `${command.label} ${command.hint ?? ''} ${command.keywords ?? ''}`.toLowerCase();

        const direct = haystack.indexOf(needle);
        if (direct !== -1) return { command, score: 1000 - direct };

        let cursor = 0;
        let gaps = 0;
        for (const character of needle) {
          const found = haystack.indexOf(character, cursor);
          if (found === -1) return null;
          gaps += found - cursor;
          cursor = found + 1;
        }
        return { command, score: 500 - gaps };
      })
      .filter((entry): entry is { command: Command; score: number } => entry !== null)
      .sort((a, b) => b.score - a.score)
      .slice(0, 24);

    return scored.map((entry) => entry.command);
  }, [commands, query]);

  useEffect(() => setHighlighted(0), [query]);

  useEffect(() => {
    listRef.current
      ?.querySelector('[data-highlighted="true"]')
      ?.scrollIntoView({ block: 'nearest' });
  }, [highlighted]);

  if (!open) return null;

  const choose = (command: Command) => {
    command.run();
    setOpen(false);
  };

  let lastGroup = '';

  return (
    <div
      className="palette-backdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) setOpen(false);
      }}
    >
      <div className="palette surface" role="dialog" aria-modal="true" aria-label="Palette de commandes">
        <div className="palette__input-row">
          <Icon name="search" size={17} />
          <input
            ref={inputRef}
            className="palette__input"
            value={query}
            placeholder="Aller a un salon, une personne, une action…"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setHighlighted((index) => (index + 1) % Math.max(1, results.length));
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                setHighlighted(
                  (index) => (index - 1 + results.length) % Math.max(1, results.length),
                );
              } else if (event.key === 'Enter') {
                event.preventDefault();
                const chosen = results[highlighted];
                if (chosen) choose(chosen);
              } else if (event.key === 'Escape') {
                event.preventDefault();
                setOpen(false);
              }
            }}
            aria-label="Commande"
          />
          <span className="kbd">Echap</span>
        </div>

        <ul className="palette__list scroll" ref={listRef}>
          {results.length === 0 ? (
            <li className="palette__empty">Rien ne correspond a « {query} ».</li>
          ) : (
            results.map((command, index) => {
              const showGroup = command.group !== lastGroup;
              lastGroup = command.group;
              const profileId = command.id.startsWith('profile:')
                ? command.id.slice('profile:'.length)
                : null;

              return (
                <li key={command.id}>
                  {showGroup ? <p className="palette__group">{command.group}</p> : null}
                  <button
                    type="button"
                    className={'palette__item' + (index === highlighted ? ' is-highlighted' : '')}
                    data-highlighted={index === highlighted}
                    onMouseEnter={() => setHighlighted(index)}
                    onClick={() => choose(command)}
                  >
                    {profileId ? (
                      <Avatar profile={profiles[profileId]} size={20} />
                    ) : (
                      <Icon name={command.icon} size={16} />
                    )}
                    <span className="palette__label truncate">{command.label}</span>
                    {command.hint ? (
                      <span className="palette__hint truncate">{command.hint}</span>
                    ) : null}
                  </button>
                </li>
              );
            })
          )}
        </ul>

        <footer className="palette__footer">
          <span>
            <span className="kbd">↑</span>
            <span className="kbd">↓</span> naviguer
          </span>
          <span>
            <span className="kbd">Entree</span> ouvrir
          </span>
          <span>
            <span className="kbd">Ctrl</span>
            <span className="kbd">K</span> fermer
          </span>
        </footer>
      </div>
    </div>
  );
}
