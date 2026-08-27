import { useCallback, useEffect, useRef, useState } from 'react';
import {
  useDevices,
  audioConstraints,
  videoConstraints,
  type MediaPreferences,
} from '@/store/devices';
import { byteToDecibels, ANALYSER_FLOOR, ANALYSER_CEILING } from '@/features/voice/useVoice';
import { Icon } from '@/components/Icon';

/**
 * Reglages voix et video.
 *
 * Les listes d'appareils ne servent a rien sans moyen de verifier son choix :
 * un micro nomme « Realtek Audio 2 » ne dit pas s'il capte quelque chose. D'ou
 * un test en direct et un apercu de camera, qui ouvrent leur propre flux et le
 * relachent des qu'on quitte la page.
 */

export function VoiceSettings() {
  const media = useDevices((state) => state.media);
  const setMedia = useDevices((state) => state.setMedia);
  const microphones = useDevices((state) => state.microphones);
  const speakers = useDevices((state) => state.speakers);
  const cameras = useDevices((state) => state.cameras);
  const labelled = useDevices((state) => state.labelled);
  const enumerating = useDevices((state) => state.enumerating);
  const error = useDevices((state) => state.error);
  const refreshDevices = useDevices((state) => state.refreshDevices);
  const watchDevices = useDevices((state) => state.watchDevices);

  useEffect(() => {
    void refreshDevices(false);
    return watchDevices();
  }, [refreshDevices, watchDevices]);

  return (
    <div className="settings__page">
      <h1 className="settings__title">Voix et video</h1>

      {error ? (
        <p className="settings__alert" role="alert">
          {error}
        </p>
      ) : null}

      {!labelled ? (
        <div className="settings__notice">
          <p>
            Les noms de vos appareils ne sont visibles qu’apres autorisation du
            micro. Sans elle, la liste n’afficherait que des numeros.
          </p>
          <button
            type="button"
            className="btn btn--primary btn--sm"
            disabled={enumerating}
            onClick={() => void refreshDevices(true)}
          >
            {enumerating ? <span className="spinner" /> : <Icon name="mic" size={14} />}
            Autoriser et afficher mes appareils
          </button>
        </div>
      ) : null}

      <section className="settings__group">
        <h2 className="settings__group-title">Peripheriques</h2>

        <DeviceSelect
          id="mic"
          label="Peripherique d’entree"
          icon="mic"
          value={media.microphoneId}
          options={microphones}
          onChange={(value) => setMedia('microphoneId', value)}
        />

        <DeviceSelect
          id="speaker"
          label="Peripherique de sortie"
          icon="headphones"
          value={media.speakerId}
          options={speakers}
          onChange={(value) => setMedia('speakerId', value)}
          hint={
            typeof HTMLMediaElement !== 'undefined' &&
            !('setSinkId' in HTMLMediaElement.prototype)
              ? 'Ce navigateur ne permet pas de choisir la sortie : le son suivra le peripherique par defaut du systeme.'
              : undefined
          }
        />

        <DeviceSelect
          id="camera"
          label="Camera"
          icon="video"
          value={media.cameraId}
          options={cameras}
          onChange={(value) => setMedia('cameraId', value)}
        />

        <button
          type="button"
          className="btn btn--ghost btn--sm settings__inline-btn"
          disabled={enumerating}
          onClick={() => void refreshDevices(false)}
        >
          <Icon name="refresh" size={14} />
          Actualiser la liste
        </button>
      </section>

      <section className="settings__group">
        <h2 className="settings__group-title">Volumes</h2>

        <Slider
          label="Volume des voix"
          value={Math.round(media.outputVolume * 100)}
          min={0}
          max={100}
          step={1}
          suffix=" %"
          onChange={(value) => setMedia('outputVolume', value / 100)}
        />

        <Slider
          label="Sensibilite du detecteur de parole"
          value={media.speakingThreshold}
          min={ANALYSER_FLOOR}
          max={ANALYSER_CEILING}
          step={1}
          suffix=" dB"
          hint="Au-dessus de ce niveau, votre pastille s’allume. Montez-le si un bruit de fond la declenche."
          onChange={(value) => setMedia('speakingThreshold', value)}
        />
      </section>

      <MicrophoneTest media={media} />

      <section className="settings__group">
        <h2 className="settings__group-title">Traitement du micro</h2>

        <SwitchRow
          label="Annulation de l’echo"
          hint="Empeche le son de vos haut-parleurs de repartir dans votre micro."
          checked={media.echoCancellation}
          onChange={(value) => setMedia('echoCancellation', value)}
        />
        <SwitchRow
          label="Reduction du bruit"
          hint="Attenue le bruit de fond constant : ventilateur, clavier, rue."
          checked={media.noiseSuppression}
          onChange={(value) => setMedia('noiseSuppression', value)}
        />
        <SwitchRow
          label="Gain automatique"
          hint="Egalise le niveau de votre voix. A couper si vous utilisez deja un compresseur."
          checked={media.autoGainControl}
          onChange={(value) => setMedia('autoGainControl', value)}
        />
        <p className="settings__hint">
          Ces reglages sont appliques par le navigateur a l’ouverture du micro :
          un changement prend effet a votre prochaine entree en vocal.
        </p>
      </section>

      <CameraPreview media={media} />

      <section className="settings__group">
        <h2 className="settings__group-title">Partage d’ecran</h2>

        <Choice
          label="Definition"
          value={media.screenQuality}
          options={[
            { value: '720p', label: '720p' },
            { value: '1080p', label: '1080p' },
            { value: 'source', label: 'Source' },
          ]}
          onChange={(value) => setMedia('screenQuality', value)}
        />

        <Choice
          label="Images par seconde"
          value={String(media.screenFrameRate)}
          options={[
            { value: '15', label: '15' },
            { value: '30', label: '30' },
            { value: '60', label: '60' },
          ]}
          onChange={(value) =>
            setMedia('screenFrameRate', Number(value) as MediaPreferences['screenFrameRate'])
          }
        />

        <p className="settings__hint">
          Ce sont des demandes, pas des garanties : la source peut refuser, et le
          navigateur baisse la definition si le reseau ne suit pas.
        </p>
      </section>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Test du micro                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Barre de niveau alimentee par le micro choisi.
 *
 * Le niveau est peint dans une variable CSS via une reference, sans passer par
 * l'etat React : a 60 images par seconde, un rendu complet par mesure ferait
 * ramer toute la page de parametres.
 */
function MicrophoneTest({ media }: { media: MediaPreferences }) {
  const [testing, setTesting] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const barRef = useRef<HTMLDivElement>(null);
  const markRef = useRef<HTMLDivElement>(null);
  const stopRef = useRef<(() => void) | null>(null);

  const stop = useCallback(() => {
    stopRef.current?.();
    stopRef.current = null;
    setTesting(false);
    if (barRef.current) barRef.current.style.setProperty('--level', '0');
  }, []);

  const start = useCallback(async () => {
    setFailure(null);

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: audioConstraints(media),
        video: false,
      });
    } catch {
      setFailure('Micro inaccessible. Verifiez l’autorisation du navigateur.');
      return;
    }

    const context = new AudioContext();
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.5;
    analyser.minDecibels = ANALYSER_FLOOR;
    analyser.maxDecibels = ANALYSER_CEILING;
    source.connect(analyser);

    const buffer = new Uint8Array(analyser.frequencyBinCount);
    let frame = 0;

    const tick = () => {
      analyser.getByteFrequencyData(buffer);

      let peak = 0;
      for (let index = 0; index < buffer.length; index += 1) {
        if (buffer[index]! > peak) peak = buffer[index]!;
      }

      barRef.current?.style.setProperty('--level', String(peak / 255));

      const decibels = byteToDecibels(peak);
      markRef.current?.classList.toggle(
        'is-live',
        decibels > useDevices.getState().media.speakingThreshold,
      );

      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);

    stopRef.current = () => {
      cancelAnimationFrame(frame);
      stream.getTracks().forEach((track) => track.stop());
      void context.close();
      markRef.current?.classList.remove('is-live');
    };

    setTesting(true);
  }, [media]);

  // Le flux ne doit pas survivre a la page : un micro laisse ouvert garderait
  // la pastille d'enregistrement allumee dans l'onglet.
  useEffect(() => stop, [stop]);

  return (
    <section className="settings__group">
      <h2 className="settings__group-title">Tester le micro</h2>

      <div className="mictest">
        <button
          type="button"
          className={'btn btn--sm' + (testing ? ' btn--danger' : '')}
          onClick={() => (testing ? stop() : void start())}
        >
          <Icon name={testing ? 'square' : 'play'} size={14} />
          {testing ? 'Arreter le test' : 'Verifions'}
        </button>

        <div className="mictest__bar" ref={barRef}>
          <div className="mictest__fill" />
        </div>

        <div className="mictest__mark" ref={markRef} aria-hidden="true">
          <Icon name="mic" size={15} />
        </div>
      </div>

      <p className="settings__hint">
        Parlez : la barre doit bouger, et l’icone s’allumer quand vous depassez
        le seuil regle plus haut.
      </p>

      {failure ? (
        <p className="settings__alert" role="alert">
          {failure}
        </p>
      ) : null}
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Apercu de la camera                                                         */
/* -------------------------------------------------------------------------- */

function CameraPreview({ media }: { media: MediaPreferences }) {
  const setMedia = useDevices((state) => state.setMedia);
  const [live, setLive] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setLive(false);
  }, []);

  const start = useCallback(async () => {
    setFailure(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: videoConstraints(media),
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      setLive(true);
    } catch {
      setFailure('Camera inaccessible. Verifiez l’autorisation du navigateur.');
    }
  }, [media]);

  useEffect(() => stop, [stop]);

  // Changer de camera ou de definition pendant l'apercu doit se voir tout de
  // suite : sinon on regle a l'aveugle.
  useEffect(() => {
    if (!live) return;
    stop();
    void start();
    // `start` et `stop` changent avec `media`, ce qui relancerait en boucle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [media.cameraId, media.videoQuality]);

  return (
    <section className="settings__group">
      <h2 className="settings__group-title">Camera</h2>

      <div className="campreview">
        <video
          ref={videoRef}
          className={'campreview__video' + (live ? ' is-live' : '')}
          muted
          playsInline
        />
        {!live ? (
          <div className="campreview__idle">
            <Icon name="video" size={26} />
            <span>Apercu eteint</span>
          </div>
        ) : null}
      </div>

      <div className="settings__row">
        <button
          type="button"
          className={'btn btn--sm' + (live ? ' btn--danger' : '')}
          onClick={() => (live ? stop() : void start())}
        >
          <Icon name={live ? 'square' : 'play'} size={14} />
          {live ? 'Arreter l’apercu' : 'Tester ma camera'}
        </button>

        <Choice
          label="Definition"
          value={media.videoQuality}
          options={[
            { value: '480p', label: '480p' },
            { value: '720p', label: '720p' },
            { value: '1080p', label: '1080p' },
          ]}
          onChange={(value) =>
            setMedia('videoQuality', value as MediaPreferences['videoQuality'])
          }
        />
      </div>

      {failure ? (
        <p className="settings__alert" role="alert">
          {failure}
        </p>
      ) : null}
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Briques                                                                     */
/* -------------------------------------------------------------------------- */

function DeviceSelect({
  id,
  label,
  icon,
  value,
  options,
  onChange,
  hint,
}: {
  id: string;
  label: string;
  icon: Parameters<typeof Icon>[0]['name'];
  value: string | null;
  options: { deviceId: string; label: string }[];
  onChange: (value: string | null) => void;
  hint?: string;
}) {
  return (
    <div className="settings__field">
      <label className="settings__label" htmlFor={`device-${id}`}>
        <Icon name={icon} size={14} />
        {label}
      </label>

      <select
        id={`device-${id}`}
        className="settings__select"
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value || null)}
      >
        <option value="">Par defaut du systeme</option>
        {options.map((option) => (
          <option key={option.deviceId} value={option.deviceId}>
            {option.label}
          </option>
        ))}
      </select>

      {options.length === 0 ? (
        <p className="settings__hint">Aucun appareil detecte.</p>
      ) : null}
      {hint ? <p className="settings__hint">{hint}</p> : null}
    </div>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  suffix,
  hint,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix: string;
  hint?: string;
  onChange: (value: number) => void;
}) {
  return (
    <div className="settings__field">
      <label className="settings__label">
        {label}
        <span className="settings__value">
          {value}
          {suffix}
        </span>
      </label>
      <input
        type="range"
        className="settings__range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      {hint ? <p className="settings__hint">{hint}</p> : null}
    </div>
  );
}

export function SwitchRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="switchrow">
      <span className="switchrow__body">
        <span className="switchrow__label">{label}</span>
        {hint ? <span className="switchrow__hint">{hint}</span> : null}
      </span>
      <input
        type="checkbox"
        className="visually-hidden"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className={'switchrow__track' + (checked ? ' is-on' : '')} aria-hidden="true">
        <span className="switchrow__thumb" />
      </span>
    </label>
  );
}

function Choice<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="settings__field">
      <span className="settings__label">{label}</span>
      <div className="settings__segmented">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            className={'settings__seg' + (value === option.value ? ' is-active' : '')}
            aria-pressed={value === option.value}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export { Choice, Slider };
