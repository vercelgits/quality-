import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/store/session';
import { Icon } from '@/components/Icon';
import { formatRelative } from '@/lib/time';
import type { Poll, PollResult } from '@/types/db';

/**
 * Affichage et vote d'un sondage attache a un message.
 *
 * Les decomptes viennent d'une fonction SQL et non d'une lecture directe de la
 * table des votes : c'est elle qui decide si les resultats sont visibles. Un
 * sondage a resultats masques ne laisse donc rien filtrer, meme a qui
 * inspecterait les requetes reseau.
 */
export function PollCard({ poll }: { poll: Poll }) {
  const myId = useSession((state) => state.profile?.id);

  const [results, setResults] = useState<PollResult[] | null>(null);
  const [busy, setBusy] = useState(false);

  const closed =
    poll.closed || (poll.closes_at !== null && new Date(poll.closes_at).getTime() <= Date.now());

  const load = useCallback(async () => {
    const { data } = await supabase.rpc('poll_results', { p_poll_id: poll.id });
    setResults((data ?? []) as PollResult[]);
  }, [poll.id]);

  useEffect(() => {
    void load();
  }, [load]);

  // Les votes des autres arrivent en temps reel : le sondage se met a jour
  // sans qu'on ait a recharger la page.
  useEffect(() => {
    const channel = supabase
      .channel(`orbit:poll:${poll.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'poll_votes', filter: `poll_id=eq.${poll.id}` },
        () => void load(),
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [poll.id, load]);

  const vote = async (optionId: string) => {
    if (closed || busy) return;
    setBusy(true);
    await supabase.rpc('cast_vote', { p_option_id: optionId });
    await load();
    setBusy(false);
  };

  const close = async () => {
    await supabase.rpc('close_poll', { p_poll_id: poll.id });
    await load();
  };

  const total = (results ?? []).reduce((sum, item) => sum + item.votes, 0);
  const hidden = poll.hide_results && !closed && poll.created_by !== myId;

  return (
    <section className={'poll' + (closed ? ' is-closed' : '')}>
      <header className="poll__head">
        <Icon name="filter" size={14} />
        <h4 className="poll__question">{poll.question}</h4>
        {closed ? <span className="chip">Clos</span> : null}
      </header>

      {results === null ? (
        <span className="spinner" />
      ) : (
        <ul className="poll__options">
          {results.map((option) => {
            // Une barre a zero pour cent est invisible : on garde un liseré
            // minimal pour que chaque reponse reste une cible cliquable claire.
            const share = total > 0 ? Math.round((option.votes / total) * 100) : 0;

            return (
              <li key={option.option_id}>
                <button
                  type="button"
                  className={'poll-option' + (option.voted ? ' is-chosen' : '')}
                  onClick={() => void vote(option.option_id)}
                  disabled={closed || busy}
                  aria-pressed={option.voted}
                >
                  {!hidden ? (
                    <span
                      className="poll-option__fill"
                      style={{ width: `${share}%` }}
                      aria-hidden="true"
                    />
                  ) : null}

                  <span className="poll-option__mark" aria-hidden="true">
                    {option.voted ? <Icon name="check" size={12} /> : null}
                  </span>

                  <span className="poll-option__label">{option.label}</span>

                  {!hidden ? (
                    <span className="poll-option__count">
                      {option.votes} · {share} %
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <footer className="poll__foot">
        <span>
          {hidden
            ? 'Resultats masques jusqu’a la cloture'
            : `${total} vote${total > 1 ? 's' : ''}`}
          {poll.multi_choice ? ' · plusieurs reponses' : ''}
        </span>

        {poll.closes_at && !closed ? (
          <span>Se termine {formatRelative(poll.closes_at)}</span>
        ) : null}

        {poll.created_by === myId && !closed ? (
          <button type="button" className="btn btn--sm btn--ghost" onClick={() => void close()}>
            Clore maintenant
          </button>
        ) : null}
      </footer>
    </section>
  );
}
