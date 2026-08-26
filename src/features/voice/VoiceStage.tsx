import { useEffect, useRef, useState } from 'react';
import { useVoice } from './useVoice';
import { useChat } from '@/store/chat';
import { useSession } from '@/store/session';
import { Icon } from '@/components/Icon';
import { Avatar } from '@/components/Avatar';
import { formatDuration } from '@/lib/time';
import type { Channel, UUID } from '@/types/db';

/** Vue principale d'un salon vocal : les participants et leurs partages. */
export function VoiceStage({ channel }: { channel: Channel }) {
  const profile = useSession((state) => state.profile);
  const profiles = useChat((state) => state.profiles);

  const channelId = useVoice((state) => state.channelId);
  const connecting = useVoice((state) => state.connecting);
  const error = useVoice((state) => state.error);
  const participants = useVoice((state) => state.participantsByChannel[channel.id] ?? []);
  const remoteStreams = useVoice((state) => state.remoteStreams);
  const speaking = useVoice((state) => state.speaking);
  const muted = useVoice((state) => state.muted);
  const deafened = useVoice((state) => state.deafened);
  const sharing = useVoice((state) => state.sharing);

  const join = useVoice((state) => state.join);
  const leave = useVoice((state) => state.leave);
  const toggleMute = useVoice((state) => state.toggleMute);
  const toggleDeafen = useVoice((state) => state.toggleDeafen);
  const toggleScreenShare = useVoice((state) => state.toggleScreenShare);

  const connected = channelId === channel.id;
  const [joinedAt] = useState(() => Date.now());
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!connected) return;
    const timer = window.setInterval(() => setElapsed(Date.now() - joinedAt), 1000);
    return () => window.clearInterval(timer);
  }, [connected, joinedAt]);

  const screenShares = participants.filter((participant) => participant.sharing);

  if (!connected) {
    return (
      <div className="voice-stage voice-stage--idle">
        <span className="voice-stage__mark" aria-hidden="true">
          <Icon name="volume" size={30} />
        </span>
        <h2 className="voice-stage__title">{channel.name}</h2>

        {participants.length > 0 ? (
          <>
            <p className="voice-stage__sub">
              {participants.length} personne{participants.length > 1 ? 's' : ''} en ligne
            </p>
            <ul className="voice-stage__preview">
              {participants.map((participant) => (
                <li key={participant.user_id}>
                  <Avatar profile={profiles[participant.user_id]} size={34} />
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="voice-stage__sub">Personne pour l’instant.</p>
        )}

        {error ? (
          <p className="voice-stage__error" role="alert">
            {error}
          </p>
        ) : null}

        <button
          type="button"
          className="btn btn--primary"
          onClick={() => profile && void join(channel.id, profile.id)}
          disabled={connecting}
        >
          {connecting ? <span className="spinner" /> : <Icon name="volume" size={15} />}
          Rejoindre le salon vocal
        </button>
      </div>
    );
  }

  return (
    <div className="voice-stage">
      {screenShares.length > 0 ? (
        <div className="voice-stage__screens">
          {screenShares.map((participant) => (
            <ScreenTile
              key={participant.user_id}
              stream={remoteStreams[participant.user_id]}
              label={profiles[participant.user_id]?.display_name ?? 'Partage'}
            />
          ))}
        </div>
      ) : null}

      <ul className="voice-grid">
        {participants.map((participant) => {
          const person = profiles[participant.user_id];
          const isMe = participant.user_id === profile?.id;
          const isSpeaking = speaking[participant.user_id] ?? false;

          return (
            <li
              key={participant.user_id}
              className={
                'voice-tile' +
                (isSpeaking && !participant.muted ? ' is-speaking' : '') +
                (participant.muted ? ' is-muted' : '')
              }
            >
              <Avatar profile={person} size={64} />
              <span className="voice-tile__name truncate">
                {person?.display_name ?? 'Quelqu’un'}
                {isMe ? ' (vous)' : ''}
              </span>
              <span className="voice-tile__icons">
                {participant.muted ? <Icon name="mic-off" size={14} /> : null}
                {participant.deafened ? <Icon name="headphones-off" size={14} /> : null}
                {participant.sharing ? <Icon name="screen" size={14} /> : null}
              </span>
              {!isMe ? <RemoteAudio stream={remoteStreams[participant.user_id]} muted={deafened} /> : null}
            </li>
          );
        })}
      </ul>

      <div className="voice-controls surface">
        <span className="voice-controls__timer" title="Duree de connexion">
          <span className="voice-controls__pulse" aria-hidden="true" />
          {formatDuration(elapsed)}
        </span>

        <button
          type="button"
          className={'icon-btn' + (muted ? ' is-active' : '')}
          onClick={toggleMute}
          aria-pressed={muted}
          title={muted ? 'Reactiver le micro' : 'Couper le micro'}
        >
          <Icon name={muted ? 'mic-off' : 'mic'} size={18} />
        </button>

        <button
          type="button"
          className={'icon-btn' + (deafened ? ' is-active' : '')}
          onClick={toggleDeafen}
          aria-pressed={deafened}
          title={deafened ? 'Reactiver le son' : 'Couper le son'}
        >
          <Icon name={deafened ? 'headphones-off' : 'headphones'} size={18} />
        </button>

        <button
          type="button"
          className={'icon-btn' + (sharing ? ' is-active' : '')}
          onClick={() => void toggleScreenShare()}
          aria-pressed={sharing}
          title={sharing ? 'Arreter le partage' : 'Partager l’ecran'}
        >
          <Icon name="screen" size={18} />
        </button>

        <button
          type="button"
          className="btn btn--sm btn--danger"
          onClick={() => void leave()}
        >
          <Icon name="phone-off" size={14} />
          Quitter
        </button>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * Element audio invisible qui joue le flux d'un pair.
 *
 * React ne sait pas assigner un `MediaStream` par attribut : il faut passer par
 * la propriete `srcObject`, donc par une reference.
 */
function RemoteAudio({ stream, muted }: { stream: MediaStream | undefined; muted: boolean }) {
  const ref = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node || !stream) return;
    node.srcObject = stream;
    void node.play().catch(() => {
      // La lecture automatique peut etre refusee tant que l'utilisateur n'a pas
      // interagi avec la page ; le prochain clic la debloquera.
    });
  }, [stream]);

  return <audio ref={ref} autoPlay muted={muted} />;
}

function ScreenTile({ stream, label }: { stream: MediaStream | undefined; label: string }) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node || !stream) return;
    node.srcObject = stream;
    void node.play().catch(() => undefined);
  }, [stream]);

  return (
    <figure className="screen-tile">
      <video ref={ref} className="screen-tile__video" autoPlay playsInline muted />
      <figcaption className="screen-tile__label">
        <Icon name="screen" size={13} />
        {label}
      </figcaption>
    </figure>
  );
}

export type { UUID };
