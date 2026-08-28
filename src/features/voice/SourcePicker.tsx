import { useEffect, useState } from 'react';
import { Modal } from '@/components/Modal';
import { Icon } from '@/components/Icon';
import { useDevices } from '@/store/devices';

/**
 * Notre propre selecteur de partage.
 *
 * Les sources viennent du systeme, pas du moteur web : une commande Rust
 * enumere les ecrans et les fenetres, vignette comprise. C'est ce que le
 * navigateur ne nous laisse pas faire, et ce qu'une application de bureau a le
 * droit de faire.
 *
 * La fenetre du moteur ne s'ouvre plus : il lui est demande au demarrage de
 * prendre l'ecran entier sans rien afficher. Choisir une fenetre ici revient
 * donc a n'emettre que la portion correspondante de cette image — voir
 * `decoupe.ts`.
 *
 * Ce que cela ne sait pas faire : ce qui recouvre la fenetre partagee est
 * diffuse avec elle, puisque le systeme ne nous donne que l'image finale de
 * l'ecran. Isoler une fenetre demanderait une capture native, qui reste a
 * ecrire.
 */

interface Source {
  id: string;
  titre: string;
  genre: 'fenetre' | 'ecran';
  largeur: number;
  hauteur: number;
  vignette: string;
}

const DANS_TAURI = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export function SourcePicker({
  open,
  onClose,
  onStart,
}: {
  open: boolean;
  onClose: () => void;
  onStart: (source: Source | null) => void;
}) {
  const media = useDevices((state) => state.media);
  const setMedia = useDevices((state) => state.setMedia);

  const [sources, setSources] = useState<Source[] | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [onglet, setOnglet] = useState<'ecran' | 'fenetre'>('ecran');
  const [choisie, setChoisie] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !DANS_TAURI) return;

    let annule = false;
    setSources(null);
    setErreur(null);
    setChoisie(null);

    void (async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const liste = await invoke<Source[]>('sources_partageables');
        if (!annule) setSources(liste);
      } catch (cause) {
        if (!annule) setErreur(String(cause));
      }
    })();

    return () => {
      annule = true;
    };
  }, [open]);

  const visibles = (sources ?? []).filter((source) => source.genre === onglet);
  const selection = (sources ?? []).find((source) => source.id === choisie) ?? null;

  return (
    <Modal
      open={open}
      title="Partager votre ecran"
      description="Choisissez ce que les autres verront."
      onClose={onClose}
      width={880}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Annuler
          </button>
          <button
            type="button"
            className="btn btn--primary"
            disabled={selection === null}
            onClick={() => onStart(selection)}
          >
            <Icon name="screen" size={15} />
            Partager
          </button>
        </>
      }
    >
      <div className="picker">
        <nav className="picker__tabs" aria-label="Type de source">
          {(
            [
              { id: 'ecran', label: 'Ecran entier', icone: 'monitor' },
              { id: 'fenetre', label: 'Applications', icone: 'square' },
            ] as const
          ).map((entree) => (
            <button
              key={entree.id}
              type="button"
              className={'picker__tab' + (onglet === entree.id ? ' is-active' : '')}
              aria-current={onglet === entree.id ? 'page' : undefined}
              onClick={() => setOnglet(entree.id)}
            >
              <Icon name={entree.icone} size={15} />
              {entree.label}
            </button>
          ))}
        </nav>

        {!DANS_TAURI ? (
          <p className="picker__note">
            Cette liste vient du systeme : elle n&rsquo;existe que dans
            l&rsquo;application de bureau. Dans un navigateur, c&rsquo;est lui qui
            demande ce que vous voulez partager.
          </p>
        ) : erreur ? (
          <p className="picker__note picker__note--erreur">
            Les sources n&rsquo;ont pas pu etre listees : {erreur}
          </p>
        ) : sources === null ? (
          <div className="picker__grid">
            {[0, 1, 2, 3].map((index) => (
              <span className="skeleton picker__squelette" key={index} />
            ))}
          </div>
        ) : visibles.length === 0 ? (
          <p className="picker__note">
            {onglet === 'fenetre'
              ? 'Aucune fenetre partageable. Les fenetres reduites ne comptent pas : leur contenu n’existe plus a l’ecran.'
              : 'Aucun ecran detecte.'}
          </p>
        ) : (
          <ul className="picker__grid">
            {visibles.map((source) => (
              <li key={source.id}>
                <button
                  type="button"
                  className={'picker__source' + (choisie === source.id ? ' is-active' : '')}
                  onClick={() => setChoisie(source.id)}
                  aria-pressed={choisie === source.id}
                >
                  <span className="picker__apercu">
                    {source.vignette ? (
                      <img src={source.vignette} alt="" />
                    ) : (
                      <span className="picker__apercu-vide" aria-hidden="true">
                        <Icon name="monitor" size={22} />
                      </span>
                    )}
                  </span>
                  <span className="picker__titre truncate">{source.titre}</span>
                  <span className="picker__taille">
                    {source.largeur} × {source.hauteur}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="picker__reglages">
          <div className="picker__reglage">
            <span className="picker__etiquette">Definition</span>
            <div className="picker__choix">
              {(['720p', '1080p', 'source'] as const).map((valeur) => (
                <button
                  key={valeur}
                  type="button"
                  className={
                    'picker__pastille' + (media.screenQuality === valeur ? ' is-active' : '')
                  }
                  onClick={() => setMedia('screenQuality', valeur)}
                >
                  {valeur === 'source' ? 'Source' : valeur}
                </button>
              ))}
            </div>
          </div>

          <div className="picker__reglage">
            <span className="picker__etiquette">Fluidite</span>
            <div className="picker__choix">
              {([30, 60] as const).map((valeur) => (
                <button
                  key={valeur}
                  type="button"
                  className={
                    'picker__pastille' + (media.screenFrameRate === valeur ? ' is-active' : '')
                  }
                  onClick={() => setMedia('screenFrameRate', valeur)}
                >
                  {valeur} i/s
                </button>
              ))}
            </div>
          </div>

          <label className="picker__son">
            <input
              type="checkbox"
              checked={media.shareSystemAudio}
              onChange={(event) => setMedia('shareSystemAudio', event.target.checked)}
            />
            Partager le son de l&rsquo;ordinateur
          </label>
        </div>
      </div>
    </Modal>
  );
}
