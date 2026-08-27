import { useEffect, useRef, useState } from 'react';
import { Modal } from '@/components/Modal';
import { Icon } from '@/components/Icon';
import { Avatar } from '@/components/Avatar';
import { useSession } from '@/store/session';
import { uploadProfileImage } from '@/lib/upload';
import { LIMITS } from '@/constants';
import type { ProfileLink } from '@/types/db';

/** Teintes proposees pour personnaliser sa carte. */
const HUES = [
  { hue: 275, name: 'Indigo' },
  { hue: 295, name: 'Violet' },
  { hue: 340, name: 'Rose' },
  { hue: 20, name: 'Corail' },
  { hue: 60, name: 'Ambre' },
  { hue: 150, name: 'Vert' },
  { hue: 195, name: 'Turquoise' },
  { hue: 235, name: 'Bleu' },
];

export function ProfileEditor({ open, onClose }: { open: boolean; onClose: () => void }) {
  const profile = useSession((state) => state.profile);
  const updateProfile = useSession((state) => state.updateProfile);
  const setStatus = useSession((state) => state.setStatus);

  const [displayName, setDisplayName] = useState('');
  const [pronouns, setPronouns] = useState('');
  const [bio, setBio] = useState('');
  const [customStatus, setCustomStatus] = useState('');
  const [links, setLinks] = useState<ProfileLink[]>([]);
  const [hue, setHue] = useState<number | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [bannerUrl, setBannerUrl] = useState<string | null>(null);

  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState<'avatar' | 'banner' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const avatarInput = useRef<HTMLInputElement>(null);
  const bannerInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open || !profile) return;
    setDisplayName(profile.display_name);
    setPronouns(profile.pronouns ?? '');
    setBio(profile.bio ?? '');
    setCustomStatus(profile.custom_status ?? '');
    setLinks(profile.links ?? []);
    setHue(profile.theme_hue);
    setAvatarUrl(profile.avatar_url);
    setBannerUrl(profile.banner_url);
    setError(null);
  }, [open, profile]);

  if (!profile) return null;

  const pickImage = async (file: File, kind: 'avatar' | 'banner') => {
    setUploading(kind);
    setError(null);

    const result = await uploadProfileImage(file, profile.id, kind);
    setUploading(null);

    if ('error' in result) {
      setError(result.error);
      return;
    }
    if (kind === 'avatar') setAvatarUrl(result.url);
    else setBannerUrl(result.url);
  };

  const updateLink = (index: number, patch: Partial<ProfileLink>) => {
    setLinks((current) => current.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  };

  const save = async () => {
    setBusy(true);
    setError(null);

    // Un lien sans adresse valide est ecarte plutot que refuse : la contrainte
    // en base rejetterait tout l'enregistrement pour une ligne laissee vide.
    const cleanLinks = links
      .map((link) => ({ label: link.label.trim(), url: link.url.trim() }))
      .filter((link) => link.label.length > 0 && /^https?:\/\//.test(link.url))
      .slice(0, 5);

    await updateProfile({
      display_name: displayName.trim() || profile.username,
      bio: bio.trim() || null,
      avatar_url: avatarUrl,
      banner_url: bannerUrl,
      pronouns: pronouns.trim() || null,
      links: cleanLinks,
      theme_hue: hue,
    });

    await setStatus(profile.status, customStatus.trim() || null);

    setBusy(false);
    onClose();
  };

  const preview = {
    ...profile,
    display_name: displayName || profile.username,
    avatar_url: avatarUrl,
  };

  return (
    <Modal
      open={open}
      title="Mon profil"
      description="Ce que les autres voient quand ils cliquent sur votre nom."
      onClose={onClose}
      width={560}
      footer={
        <>
          <div className="spacer" />
          <button type="button" className="btn" onClick={onClose}>
            Annuler
          </button>
          <button type="button" className="btn btn--primary" onClick={() => void save()} disabled={busy}>
            {busy ? <span className="spinner" /> : <Icon name="check" size={15} />}
            Enregistrer
          </button>
        </>
      }
    >
      {/* Apercu en direct : on voit le resultat avant d'enregistrer. */}
      <div
        className="editor-preview"
        style={hue !== null ? ({ '--hue-primary': hue } as React.CSSProperties) : undefined}
      >
        <div className="editor-preview__banner">
          {bannerUrl ? (
            <img src={bannerUrl} alt="" />
          ) : (
            <span className="editor-preview__banner-fallback" aria-hidden="true" />
          )}

          <button
            type="button"
            className="editor-preview__banner-btn"
            onClick={() => bannerInput.current?.click()}
            disabled={uploading !== null}
          >
            {uploading === 'banner' ? <span className="spinner" /> : <Icon name="edit" size={14} />}
            Banniere
          </button>
        </div>

        <div className="editor-preview__avatar">
          <Avatar profile={preview} size={76} />
          <button
            type="button"
            className="editor-preview__avatar-btn"
            onClick={() => avatarInput.current?.click()}
            disabled={uploading !== null}
            aria-label="Changer la photo de profil"
          >
            {uploading === 'avatar' ? <span className="spinner" /> : <Icon name="edit" size={14} />}
          </button>
        </div>

        <p className="editor-preview__name">{displayName || profile.username}</p>
        <p className="editor-preview__handle">
          @{profile.username}
          {pronouns ? ` · ${pronouns}` : ''}
        </p>
      </div>

      <p className="field__hint">
        Photo et banniere acceptent les images animees — GIF, WebP, APNG. La
        limite de taille est quadruplee pour ces formats, qui pesent bien plus
        a dimensions egales : 8 Mo pour une photo, 16 Mo pour une banniere.
        Quand elles s'animent se regle dans Apparence.
      </p>

      <input
        ref={avatarInput}
        type="file"
        accept="image/*"
        className="visually-hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void pickImage(file, 'avatar');
          event.target.value = '';
        }}
      />
      <input
        ref={bannerInput}
        type="file"
        accept="image/*"
        className="visually-hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void pickImage(file, 'banner');
          event.target.value = '';
        }}
      />

      {error ? (
        <p className="field__error">
          <Icon name="x" size={14} />
          {error}
        </p>
      ) : null}

      <div className="field">
        <label className="field__label" htmlFor="pf-name">
          Nom affiche
        </label>
        <input
          id="pf-name"
          className="input"
          value={displayName}
          maxLength={LIMITS.displayNameLength}
          onChange={(event) => setDisplayName(event.target.value)}
        />
        <p className="field__hint">
          Votre identifiant <strong>@{profile.username}</strong> ne change pas : c'est lui
          qui sert a vous mentionner.
        </p>
      </div>

      <div className="field">
        <label className="field__label" htmlFor="pf-pronouns">
          Pronoms
        </label>
        <input
          id="pf-pronouns"
          className="input"
          value={pronouns}
          maxLength={32}
          placeholder="iel, elle, il…"
          onChange={(event) => setPronouns(event.target.value)}
        />
      </div>

      <div className="field">
        <label className="field__label" htmlFor="pf-status">
          Statut du moment
        </label>
        <input
          id="pf-status"
          className="input"
          value={customStatus}
          maxLength={LIMITS.customStatusLength}
          placeholder="En reunion jusqu'a 15 h"
          onChange={(event) => setCustomStatus(event.target.value)}
        />
      </div>

      <div className="field">
        <label className="field__label" htmlFor="pf-bio">
          A propos de vous
        </label>
        <textarea
          id="pf-bio"
          className="input"
          rows={3}
          value={bio}
          maxLength={280}
          placeholder="Quelques mots, ce que vous faites, ce qui vous interesse."
          onChange={(event) => setBio(event.target.value)}
        />
        <p className="field__hint">{280 - bio.length} caracteres restants.</p>
      </div>

      <div className="field">
        <span className="field__label">Couleur de votre carte</span>
        <div className="hue-row">
          <button
            type="button"
            className={'hue-dot hue-dot--auto' + (hue === null ? ' is-active' : '')}
            onClick={() => setHue(null)}
            title="Couleur automatique"
            aria-label="Couleur automatique"
            aria-pressed={hue === null}
          >
            <Icon name="sparkles" size={14} />
          </button>

          {HUES.map((option) => (
            <button
              type="button"
              key={option.hue}
              className={'hue-dot' + (hue === option.hue ? ' is-active' : '')}
              style={{ background: `oklch(65% 0.2 ${option.hue})` }}
              onClick={() => setHue(option.hue)}
              title={option.name}
              aria-label={option.name}
              aria-pressed={hue === option.hue}
            />
          ))}
        </div>
      </div>

      <div className="field">
        <span className="field__label">Liens</span>
        <p className="field__hint">
          Jusqu'a cinq liens, affiches sur votre carte. Ils doivent commencer par
          <code> https://</code>.
        </p>

        <ul className="link-editor">
          {links.map((link, index) => (
            <li key={index} className="link-editor__row">
              <input
                className="input"
                value={link.label}
                maxLength={40}
                placeholder="Mon site"
                onChange={(event) => updateLink(index, { label: event.target.value })}
                aria-label={`Libelle du lien ${index + 1}`}
              />
              <input
                className="input"
                value={link.url}
                maxLength={200}
                placeholder="https://exemple.fr"
                onChange={(event) => updateLink(index, { url: event.target.value })}
                aria-label={`Adresse du lien ${index + 1}`}
              />
              <button
                type="button"
                className="icon-btn"
                onClick={() => setLinks((current) => current.filter((_, i) => i !== index))}
                aria-label={`Retirer le lien ${index + 1}`}
              >
                <Icon name="x" size={15} />
              </button>
            </li>
          ))}
        </ul>

        {links.length < 5 ? (
          <button
            type="button"
            className="btn btn--sm btn--ghost"
            onClick={() => setLinks((current) => [...current, { label: '', url: '' }])}
          >
            <Icon name="plus" size={14} />
            Ajouter un lien
          </button>
        ) : null}
      </div>
    </Modal>
  );
}
