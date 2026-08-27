import { useEffect, useMemo, useState } from 'react';
import { Modal } from '@/components/Modal';
import { Icon } from '@/components/Icon';
import { supabase, errorMessage } from '@/lib/supabase';
import { useChat } from '@/store/chat';
import { useUI } from '@/store/ui';
import { LIMITS } from '@/constants';
import type { UUID } from '@/types/db';

type Tab = 'general' | 'categories' | 'danger';

/**
 * Parametres d'un espace.
 *
 * Chaque action passe par la politique RLS correspondante : le formulaire ne
 * s'affiche que pour qui peut administrer, mais c'est la base qui refuse, pas
 * l'interface.
 */
export function SpaceSettings({
  open,
  spaceId,
  onClose,
}: {
  open: boolean;
  spaceId: UUID | null;
  onClose: () => void;
}) {
  const spaces = useChat((state) => state.spaces);
  const categories = useChat((state) => state.categories);
  const channels = useChat((state) => state.channels);
  const ranks = useChat((state) => state.ranks);
  const bootstrap = useChat((state) => state.bootstrap);
  const selectSpace = useUI((state) => state.selectSpace);

  const [tab, setTab] = useState<Tab>('general');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [newCategory, setNewCategory] = useState('');
  const [confirmName, setConfirmName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const space = spaces.find((item) => item.id === spaceId) ?? null;
  const rank = spaceId ? (ranks[spaceId] ?? 0) : 0;
  const isOwner = rank >= 3;

  const spaceCategories = useMemo(
    () => categories.filter((item) => item.space_id === spaceId),
    [categories, spaceId],
  );

  useEffect(() => {
    if (!open || !space) return;
    setTab('general');
    setName(space.name);
    setDescription(space.description ?? '');
    setNewCategory('');
    setConfirmName('');
    setError(null);
  }, [open, space]);

  if (!space || !spaceId) return null;

  const dirty = name.trim() !== space.name || description.trim() !== (space.description ?? '');

  const save = async () => {
    setBusy(true);
    setError(null);

    const { error: failure } = await supabase
      .from('spaces')
      .update({
        name: name.trim() || space.name,
        description: description.trim() || null,
      })
      .eq('id', spaceId);

    setBusy(false);

    if (failure) {
      setError(errorMessage(failure));
      return;
    }
    await bootstrap();
  };

  const addCategory = async () => {
    const label = newCategory.trim();
    if (!label) return;

    setBusy(true);
    const { error: failure } = await supabase.from('categories').insert({
      space_id: spaceId,
      name: label,
      position: spaceCategories.length,
    });
    setBusy(false);

    if (failure) {
      setError(errorMessage(failure));
      return;
    }
    setNewCategory('');
    await bootstrap();
  };

  const removeCategory = async (categoryId: UUID) => {
    setBusy(true);
    const { error: failure } = await supabase.from('categories').delete().eq('id', categoryId);
    setBusy(false);

    if (failure) {
      setError(errorMessage(failure));
      return;
    }
    await bootstrap();
  };

  const destroy = async () => {
    setBusy(true);
    setError(null);

    const { error: failure } = await supabase.from('spaces').delete().eq('id', spaceId);
    setBusy(false);

    if (failure) {
      setError(errorMessage(failure));
      return;
    }

    onClose();
    selectSpace(null);
    await bootstrap();
  };

  return (
    <Modal
      open={open}
      title={`Parametres — ${space.name}`}
      onClose={onClose}
      width={620}
      footer={
        tab === 'general' ? (
          <>
            <div className="spacer" />
            <button type="button" className="btn" onClick={onClose}>
              Fermer
            </button>
            <button
              type="button"
              className="btn btn--primary"
              disabled={!dirty || busy}
              onClick={() => void save()}
            >
              {busy ? <span className="spinner" /> : null}
              Enregistrer
            </button>
          </>
        ) : undefined
      }
    >
      <nav className="mod-tabs" role="tablist">
        {(
          [
            ['general', 'General', 'settings'],
            ['categories', 'Categories', 'hash'],
            ['danger', 'Zone sensible', 'trash'],
          ] as const
        ).map(([id, label, icon]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={'mod-tab' + (tab === id ? ' is-active' : '')}
            onClick={() => setTab(id)}
          >
            <Icon name={icon} size={15} />
            {label}
          </button>
        ))}
      </nav>

      {error ? (
        <p className="mod-error" role="alert">
          <Icon name="x" size={14} />
          {error}
        </p>
      ) : null}

      {tab === 'general' ? (
        <>
          <div className="field">
            <label className="field__label" htmlFor="space-settings-name">
              Nom de l’espace
            </label>
            <input
              id="space-settings-name"
              className="input"
              value={name}
              maxLength={LIMITS.spaceNameLength}
              onChange={(event) => setName(event.target.value)}
            />
          </div>

          <div className="field">
            <label className="field__label" htmlFor="space-settings-description">
              Description
            </label>
            <textarea
              id="space-settings-description"
              className="input"
              rows={3}
              value={description}
              maxLength={280}
              placeholder="A quoi sert cet espace ?"
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>

          <div className="field">
            <span className="field__label">Code d’invitation</span>
            <div className="invite">
              <code className="invite__code">{space.invite_code}</code>
              <button
                type="button"
                className="btn btn--sm"
                onClick={() => useUI.getState().openModal({ kind: 'invite', spaceId })}
              >
                <Icon name="link" size={14} />
                Gerer
              </button>
            </div>
          </div>
        </>
      ) : null}

      {tab === 'categories' ? (
        <>
          <p className="field__hint">
            Une categorie regroupe des salons dans la barre laterale. Supprimer une
            categorie ne supprime pas ses salons : ils remontent simplement en haut
            de la liste.
          </p>

          {spaceCategories.length === 0 ? (
            <div className="empty">
              <span className="empty__icon">
                <Icon name="hash" size={22} />
              </span>
              <p className="empty__title">Aucune categorie</p>
              <p className="empty__body">
                Les salons apparaissent tous au meme niveau. Creez-en une pour les
                regrouper.
              </p>
            </div>
          ) : (
            <ul className="mod-list">
              {spaceCategories.map((category) => {
                const count = channels.filter((c) => c.category_id === category.id).length;
                return (
                  <li className="mod-row" key={category.id}>
                    <div className="mod-row__head">
                      <Icon name="hash" size={15} />
                      <div className="mod-row__identity">
                        <span className="mod-row__name">{category.name}</span>
                        <span className="mod-row__handle">
                          {count === 0
                            ? 'Aucun salon'
                            : count === 1
                              ? '1 salon'
                              : `${count} salons`}
                        </span>
                      </div>
                      <button
                        type="button"
                        className="icon-btn icon-btn--danger"
                        onClick={() => void removeCategory(category.id)}
                        aria-label={`Supprimer la categorie ${category.name}`}
                      >
                        <Icon name="trash" size={15} />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          <div className="field">
            <label className="field__label" htmlFor="space-new-category">
              Nouvelle categorie
            </label>
            <div className="mod-actions__row">
              <input
                id="space-new-category"
                className="input"
                style={{ flex: 1, minWidth: '200px' }}
                value={newCategory}
                maxLength={64}
                placeholder="Projets"
                onChange={(event) => setNewCategory(event.target.value)}
                onKeyDown={(event) => event.key === 'Enter' && void addCategory()}
              />
              <button
                type="button"
                className="btn btn--primary"
                disabled={!newCategory.trim() || busy}
                onClick={() => void addCategory()}
              >
                <Icon name="plus" size={15} />
                Ajouter
              </button>
            </div>
          </div>
        </>
      ) : null}

      {tab === 'danger' ? (
        <div className="danger-zone">
          <h3 className="danger-zone__title">Supprimer cet espace</h3>
          <p className="danger-zone__body">
            Tous ses salons, messages, fils, sondages et pieces jointes seront
            effaces. Les membres en perdront l’acces immediatement.{' '}
            <strong>Cette action est definitive.</strong>
          </p>

          {isOwner ? (
            <>
              <div className="field">
                <label className="field__label" htmlFor="space-confirm">
                  Pour confirmer, tapez <strong>{space.name}</strong>
                </label>
                <input
                  id="space-confirm"
                  className="input"
                  value={confirmName}
                  placeholder={space.name}
                  onChange={(event) => setConfirmName(event.target.value)}
                  autoComplete="off"
                />
              </div>

              <button
                type="button"
                className="btn btn--danger"
                disabled={confirmName !== space.name || busy}
                onClick={() => void destroy()}
              >
                {busy ? <span className="spinner" /> : <Icon name="trash" size={15} />}
                Supprimer definitivement
              </button>
            </>
          ) : (
            <p className="field__hint">
              Seul le proprietaire de l’espace peut le supprimer.
            </p>
          )}
        </div>
      ) : null}
    </Modal>
  );
}
