import { useEffect, useRef, type ReactNode } from 'react';
import { Icon } from './Icon';

interface ModalProps {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
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
}: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);

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
    const handleClose = () => onClose();

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
      aria-labelledby="modal-title"
      // Un clic sur la zone hors du panneau ferme la boite, comme partout.
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
    >
      <div className="modal__panel">
        <header className="modal__header">
          <div className="stack" style={{ gap: 'var(--space-1)', minWidth: 0 }}>
            <h2 className="modal__title" id="modal-title">
              {title}
            </h2>
            {description ? <p className="modal__description">{description}</p> : null}
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Fermer">
            <Icon name="x" size={16} />
          </button>
        </header>

        <div className="modal__body scroll">{children}</div>

        {footer ? <footer className="modal__footer">{footer}</footer> : null}
      </div>
    </dialog>
  );
}
