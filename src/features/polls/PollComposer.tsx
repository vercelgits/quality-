import { useEffect, useState } from 'react';
import { Modal } from '@/components/Modal';
import { Icon } from '@/components/Icon';
import { supabase, errorMessage } from '@/lib/supabase';
import { useChat } from '@/store/chat';
import { useSession } from '@/store/session';
import type { UUID } from '@/types/db';

const DURATIONS = [
  { hours: 0, label: 'Sans limite' },
  { hours: 1, label: '1 heure' },
  { hours: 24, label: '1 jour' },
  { hours: 24 * 7, label: '1 semaine' },
];

/**
 * Creation d'un sondage.
 *
 * Un sondage est un message auquel une question est attachee, et non un type de
 * message a part : il s'epingle, se cite et se retrouve par la recherche comme
 * n'importe quel autre. Le message est donc publie d'abord, le sondage ensuite.
 */
export function PollComposer({
  open,
  channelId,
  threadId,
  onClose,
}: {
  open: boolean;
  channelId: UUID | null;
  threadId: UUID | null;
  onClose: () => void;
}) {
  const profile = useSession((state) => state.profile);
  const loadMessages = useChat((state) => state.loadMessages);

  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState<string[]>(['', '']);
  const [multiChoice, setMultiChoice] = useState(false);
  const [hideResults, setHideResults] = useState(false);
  const [hours, setHours] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setQuestion('');
    setOptions(['', '']);
    setMultiChoice(false);
    setHideResults(false);
    setHours(0);
    setError(null);
  }, [open]);

  const filled = options.map((option) => option.trim()).filter(Boolean);
  const canSubmit = question.trim().length > 0 && filled.length >= 2 && !busy;

  const submit = async () => {
    if (!canSubmit || !channelId || !profile) return;
    setBusy(true);
    setError(null);

    const messageId = crypto.randomUUID();

    // Le message porteur d'abord : sans lui, le sondage n'aurait rien a quoi
    // s'accrocher, et la contrainte de cle etrangere refuserait l'insertion.
    const inserted = await supabase.from('messages').insert({
      id: messageId,
      channel_id: channelId,
      thread_id: threadId,
      author_id: profile.id,
      content: question.trim(),
    });

    if (inserted.error) {
      setBusy(false);
      setError(errorMessage(inserted.error));
      return;
    }

    const created = await supabase.rpc('create_poll', {
      p_message_id: messageId,
      p_question: question.trim(),
      p_options: filled,
      p_multi_choice: multiChoice,
      p_hide_results: hideResults,
      p_closes_at:
        hours === 0 ? null : new Date(Date.now() + hours * 3_600_000).toISOString(),
    });

    setBusy(false);

    if (created.error) {
      // Le message existe deja : le retirer evite de laisser une question
      // orpheline sans ses reponses.
      await supabase.from('messages').delete().eq('id', messageId);
      setError(errorMessage(created.error));
      return;
    }

    await loadMessages(channelId, threadId);
    onClose();
  };

  const updateOption = (index: number, value: string) => {
    setOptions((current) => current.map((item, i) => (i === index ? value : item)));
  };

  return (
    <Modal
      open={open}
      title="Nouveau sondage"
      description="Il apparaitra comme un message : epinglable, citable, retrouvable."
      onClose={onClose}
      width={520}
      footer={
        <>
          <div className="spacer" />
          <button type="button" className="btn" onClick={onClose}>
            Annuler
          </button>
          <button
            type="button"
            className="btn btn--primary"
            disabled={!canSubmit}
            onClick={() => void submit()}
          >
            {busy ? <span className="spinner" /> : null}
            Publier
          </button>
        </>
      }
    >
      {error ? <p className="field__error">{error}</p> : null}

      <div className="field">
        <label className="field__label" htmlFor="poll-question">
          Question
        </label>
        <input
          id="poll-question"
          className="input"
          value={question}
          maxLength={300}
          placeholder="On se retrouve quel jour ?"
          onChange={(event) => setQuestion(event.target.value)}
        />
      </div>

      <div className="field">
        <span className="field__label">Reponses</span>
        <ul className="poll-editor">
          {options.map((option, index) => (
            <li key={index} className="poll-editor__row">
              <span className="poll-editor__index">{index + 1}</span>
              <input
                className="input"
                value={option}
                maxLength={120}
                placeholder={`Reponse ${index + 1}`}
                onChange={(event) => updateOption(index, event.target.value)}
              />
              {options.length > 2 ? (
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => setOptions((current) => current.filter((_, i) => i !== index))}
                  aria-label="Retirer cette reponse"
                >
                  <Icon name="x" size={14} />
                </button>
              ) : null}
            </li>
          ))}
        </ul>

        {options.length < 12 ? (
          <button
            type="button"
            className="btn btn--sm btn--ghost"
            onClick={() => setOptions((current) => [...current, ''])}
          >
            <Icon name="plus" size={13} />
            Ajouter une reponse
          </button>
        ) : null}
      </div>

      <div className="field">
        <span className="field__label">Duree</span>
        <div className="mod-actions__row">
          {DURATIONS.map((duration) => (
            <button
              key={duration.hours}
              type="button"
              className={'btn btn--sm' + (hours === duration.hours ? ' btn--primary' : '')}
              onClick={() => setHours(duration.hours)}
            >
              {duration.label}
            </button>
          ))}
        </div>
      </div>

      <label className="toggle">
        <input
          type="checkbox"
          className="visually-hidden"
          checked={multiChoice}
          onChange={(event) => setMultiChoice(event.target.checked)}
        />
        <span className={'toggle__track' + (multiChoice ? ' is-on' : '')} aria-hidden="true">
          <span className="toggle__thumb" />
        </span>
        <span className="toggle__body">
          <span className="toggle__label">Plusieurs reponses possibles</span>
          <span className="toggle__hint">Chacun peut cocher autant de cases qu’il veut.</span>
        </span>
      </label>

      <label className="toggle">
        <input
          type="checkbox"
          className="visually-hidden"
          checked={hideResults}
          onChange={(event) => setHideResults(event.target.checked)}
        />
        <span className={'toggle__track' + (hideResults ? ' is-on' : '')} aria-hidden="true">
          <span className="toggle__thumb" />
        </span>
        <span className="toggle__body">
          <span className="toggle__label">Masquer les resultats jusqu’a la cloture</span>
          <span className="toggle__hint">
            Empeche les premiers votes d’orienter les suivants.
          </span>
        </span>
      </label>
    </Modal>
  );
}
