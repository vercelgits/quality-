import { useEffect, useState } from 'react';
import { Modal } from '@/components/Modal';
import { Icon } from '@/components/Icon';
import { useChat } from '@/store/chat';
import type { UUID } from '@/types/db';

const PRESETS = [
  'Spam ou publicite',
  'Harcelement ou insultes',
  'Contenu haineux',
  'Contenu sexuel non sollicite',
  'Hors sujet dans ce salon',
  'Divulgation de donnees personnelles',
];

/**
 * Signalement d'un message.
 *
 * Les motifs proposes couvrent la majorite des cas et evitent le champ vide
 * devant lequel on renonce a signaler. Le texte reste modifiable : un motif
 * precis vaut mieux qu'une categorie approximative pour qui devra trancher.
 */
export function ReportModal({
  open,
  messageId,
  onClose,
}: {
  open: boolean;
  messageId: UUID | null;
  onClose: () => void;
}) {
  const reportMessage = useChat((state) => state.reportMessage);
  const messages = useChat((state) => state.messages);
  const profiles = useChat((state) => state.profiles);

  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (open) {
      setReason('');
      setDone(false);
    }
  }, [open]);

  const target = messageId
    ? Object.values(messages)
        .flat()
        .find((item) => item.id === messageId)
    : undefined;

  const submit = async () => {
    if (!messageId || !reason.trim() || busy) return;
    setBusy(true);
    const ok = await reportMessage(messageId, reason.trim());
    setBusy(false);
    if (ok) {
      setDone(true);
      window.setTimeout(onClose, 1400);
    }
  };

  return (
    <Modal
      open={open}
      title="Signaler ce message"
      description="Le signalement part a l’equipe de moderation de l’espace. La personne concernee n’en est pas informee."
      onClose={onClose}
      footer={
        done ? undefined : (
          <>
            <div className="spacer" />
            <button type="button" className="btn" onClick={onClose}>
              Annuler
            </button>
            <button
              type="button"
              className="btn btn--danger"
              disabled={!reason.trim() || busy}
              onClick={() => void submit()}
            >
              {busy ? <span className="spinner" /> : null}
              Envoyer le signalement
            </button>
          </>
        )
      }
    >
      {done ? (
        <p className="report-done">
          <Icon name="check-circle" size={20} />
          Signalement transmis. Merci.
        </p>
      ) : (
        <>
          {target ? (
            <blockquote className="report-quote">
              <span className="report-quote__author">
                {profiles[target.author_id]?.display_name ?? 'Inconnu'}
              </span>
              <span className="report-quote__text">{target.content.slice(0, 300)}</span>
            </blockquote>
          ) : null}

          <div className="field">
            <span className="field__label">Motif</span>
            <div className="report-presets">
              {PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  className={'chip' + (reason === preset ? ' is-active' : '')}
                  onClick={() => setReason(preset)}
                >
                  {preset}
                </button>
              ))}
            </div>
          </div>

          <div className="field">
            <label className="field__label" htmlFor="report-reason">
              Precisions
            </label>
            <textarea
              id="report-reason"
              className="input"
              rows={3}
              value={reason}
              maxLength={500}
              placeholder="Ce qui pose probleme, en une phrase."
              onChange={(event) => setReason(event.target.value)}
            />
          </div>
        </>
      )}
    </Modal>
  );
}
