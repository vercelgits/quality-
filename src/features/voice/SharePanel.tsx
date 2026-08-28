import { Modal } from '@/components/Modal';
import { Icon } from '@/components/Icon';
import { useDevices } from '@/store/devices';

/**
 * Ce qu'on regle avant de partager son ecran.
 *
 * La definition, la cadence et le son sont fixes a l'ouverture du flux : une
 * fois la capture lancee, les changer impose de tout relancer, ce qui coupe le
 * partage sous les yeux de ceux qui regardent. Les demander avant evite cet
 * aller-retour.
 *
 * Reserve connue, et elle est entiere : le choix de *ce qu'on partage* — quel
 * ecran, quelle fenetre — n'est pas a nous. `getDisplayMedia` ouvre toujours la
 * fenetre de selection du systeme, et c'est deliberе : une page web ne doit pas
 * pouvoir designer elle-meme ce qu'elle va filmer. Aucune application web ne
 * peut la remplacer, et une qui le pourrait serait une faille. Ce panneau
 * regle donc tout le reste, puis lui passe la main.
 */

const DEFINITIONS = [
  { valeur: '720p', titre: '720p', detail: 'Leger, sur une liaison modeste' },
  { valeur: '1080p', titre: '1080p', detail: 'Le bon compromis' },
  { valeur: 'source', titre: 'Source', detail: 'La definition de votre ecran' },
] as const;

const CADENCES = [
  { valeur: 30, titre: '30 i/s', detail: 'Du texte, du code, une presentation' },
  { valeur: 60, titre: '60 i/s', detail: 'Un jeu, une video' },
] as const;

export function SharePanel({
  open,
  onClose,
  onStart,
}: {
  open: boolean;
  onClose: () => void;
  onStart: () => void;
}) {
  const media = useDevices((state) => state.media);
  const setMedia = useDevices((state) => state.setMedia);

  return (
    <Modal
      open={open}
      title="Partager votre ecran"
      description="Reglez la qualite, puis choisissez la fenetre a partager."
      onClose={onClose}
      width={560}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Annuler
          </button>
          <button type="button" className="btn btn--primary" onClick={onStart}>
            <Icon name="screen" size={15} />
            Continuer
          </button>
        </>
      }
    >
      <div className="share-panel">
        <section className="share-panel__group">
          <h3 className="share-panel__title">Definition</h3>
          <div className="share-panel__choices">
            {DEFINITIONS.map((option) => (
              <button
                key={option.valeur}
                type="button"
                className={
                  'share-choice' + (media.screenQuality === option.valeur ? ' is-active' : '')
                }
                onClick={() => setMedia('screenQuality', option.valeur)}
                aria-pressed={media.screenQuality === option.valeur}
              >
                <span className="share-choice__title">{option.titre}</span>
                <span className="share-choice__detail">{option.detail}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="share-panel__group">
          <h3 className="share-panel__title">Fluidite</h3>
          <div className="share-panel__choices">
            {CADENCES.map((option) => (
              <button
                key={option.valeur}
                type="button"
                className={
                  'share-choice' + (media.screenFrameRate === option.valeur ? ' is-active' : '')
                }
                onClick={() => setMedia('screenFrameRate', option.valeur)}
                aria-pressed={media.screenFrameRate === option.valeur}
              >
                <span className="share-choice__title">{option.titre}</span>
                <span className="share-choice__detail">{option.detail}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="share-panel__group">
          <h3 className="share-panel__title">Priorite de l&rsquo;image</h3>
          <p className="share-panel__hint">
            A debit egal, on ne peut pas tout garder : soit le mouvement reste
            fluide, soit les details restent nets.
          </p>

          <div className="share-panel__choices">
            {(
              [
                { valeur: 'motion', titre: 'Fluidite', detail: 'Le mouvement passe avant la nettete' },
                { valeur: 'detail', titre: 'Nettete', detail: 'Le texte reste lisible' },
              ] as const
            ).map((option) => (
              <button
                key={option.valeur}
                type="button"
                className={
                  'share-choice' + (media.screenPriority === option.valeur ? ' is-active' : '')
                }
                onClick={() => setMedia('screenPriority', option.valeur)}
                aria-pressed={media.screenPriority === option.valeur}
              >
                <span className="share-choice__title">{option.titre}</span>
                <span className="share-choice__detail">{option.detail}</span>
              </button>
            ))}
          </div>
        </section>

        <label className="switchrow share-panel__audio">
          <span className="switchrow__body">
            <span className="switchrow__label">Partager le son de l&rsquo;ordinateur</span>
            <span className="switchrow__hint">
              Le son du systeme part avec l&rsquo;image. Selon la fenetre choisie,
              le systeme peut le refuser — le partage continue alors sans lui.
            </span>
          </span>
          <input
            type="checkbox"
            className="visually-hidden"
            checked={media.shareSystemAudio}
            onChange={(event) => setMedia('shareSystemAudio', event.target.checked)}
          />
          <span
            className={'switchrow__track' + (media.shareSystemAudio ? ' is-on' : '')}
            aria-hidden="true"
          >
            <span className="switchrow__thumb" />
          </span>
        </label>
      </div>
    </Modal>
  );
}
