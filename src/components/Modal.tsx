import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Icon } from './Icon';

interface ModalProps {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
  /**
   * Retire l'en-tete et les marges internes : la boite devient un simple
   * cadre. Utile quand le contenu est lui-meme une carte dessinee bord a bord.
   */
  bare?: boolean;
}

/**
 * Boite de dialogue batie sur l'element natif `<dialog>`.
 *
 * On evite ainsi de reimplementer a la main le piegeage du focus, la couche
 * d'arriere-plan et la fermeture par Echap : le navigateur le fait deja, et
 * mieux, notamment pour les technologies d'assistance.
 */
export function Modal({
  open,
  title,
  description,
  onClose,
  children,
  footer,
  width = 460,
  bare = false,
}: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);

  /*
   * Un identifiant par boite.
   *
   * Toutes portaient `id="modal-title"`. Plusieurs etant montees en meme temps
   * — la plupart restent dans le document, simplement fermees — le document
   * contenait autant de fois le meme identifiant, et `aria-labelledby` se
   * resolvait sur le premier trouve. Une boite s'annoncait donc sous le titre
   * d'une autre, aux lecteurs d'ecran comme aux tests.
   */
  const titreId = useId();

  /*
   * L'etat demande, lisible depuis les ecouteurs.
   *
   * `dialog.close()` emet `close` sans dire qui l'a demande. En passant d'une
   * boite a une autre — « Modifier mon profil » depuis la fiche — la premiere
   * se fermait, son `close` appelait `onClose`, et `onClose` remettait l'etat
   * a « aucune boite » : celle qu'on venait d'ouvrir disparaissait dans la
   * foulee. Les boutons paraissaient morts alors qu'ils faisaient exactement
   * leur travail.
   *
   * On ne peut pas s'en sortir avec un drapeau pose le temps de l'appel :
   * `close` n'est pas emis sur-le-champ mais dans une tache differee, et le
   * drapeau est deja retombe quand l'ecouteur s'execute.
   *
   * Le critere fiable est l'etat demande au moment ou l'evenement arrive. Une
   * fermeture voulue par la personne — Echap, la croix, le fond — survient
   * alors que la boite est censee etre ouverte. Une fermeture que nous avons
   * declenchee survient alors qu'elle est deja censee etre fermee : il n'y a
   * plus rien a annoncer.
   */
  const ouvertureVoulue = useRef(open);
  ouvertureVoulue.current = open;

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;

    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;

    // `cancel` couvre la touche Echap, `close` toute autre fermeture.
    const handleCancel = (event: Event) => {
      event.preventDefault();
      onClose();
    };
    const handleClose = () => {
      if (!ouvertureVoulue.current) return;
      onClose();
    };

    dialog.addEventListener('cancel', handleCancel);
    dialog.addEventListener('close', handleClose);
    return () => {
      dialog.removeEventListener('cancel', handleCancel);
      dialog.removeEventListener('close', handleClose);
    };
  }, [onClose]);

  return (
    <dialog
      ref={ref}
      className="modal"
      style={{ maxWidth: width }}
      {...(bare ? { 'aria-label': title } : { 'aria-labelledby': titreId })}
      // Un clic sur la zone hors du panneau ferme la boite, comme partout.
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
    >
      <div className={'modal__panel' + (bare ? ' modal__panel--bare' : '')}>
        {bare ? (
          <button
            type="button"
            className="icon-btn modal__close-floating"
            onClick={onClose}
            aria-label="Fermer"
          >
            <Icon name="x" size={16} />
          </button>
        ) : (
        <header className="modal__header">
          <div className="stack" style={{ gap: 'var(--space-1)', minWidth: 0 }}>
            <h2 className="modal__title" id={titreId}>
              {title}
            </h2>
            {description ? <p className="modal__description">{description}</p> : null}
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Fermer">
            <Icon name="x" size={16} />
          </button>
        </header>
        )}

        <div className={'modal__body scroll' + (bare ? ' modal__body--bare' : '')}>
          {children}
        </div>

        {footer ? <footer className="modal__footer">{footer}</footer> : null}
      </div>
    </dialog>
  );
}
