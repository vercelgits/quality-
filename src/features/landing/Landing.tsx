import { Icon, type IconName } from '@/components/Icon';
import { navigate } from '@/lib/router';

/**
 * Page de presentation.
 *
 * Elle sert a repondre a une seule question : pourquoi celle-ci plutot que
 * Discord. Chaque section montre donc une difference reelle et verifiable dans
 * le produit, jamais une promesse generique — un argument qu'on ne peut pas
 * aller constater soi-meme dans l'application n'a rien a faire ici.
 */

interface Feature {
  icon: IconName;
  title: string;
  body: string;
}

const PILLARS: Feature[] = [
  {
    icon: 'thread',
    title: 'Des fils qui se referment',
    body: "Un fil porte un statut : ouvert ou resolu. Tant qu'il attend une reponse, il remonte dans une barre laterale dediee. Une question posee dans un salon actif ne se perd plus dans le defilement.",
  },
  {
    icon: 'search',
    title: 'Une recherche qui trouve',
    body: 'Index plein texte francais, insensible aux accents : « reunion » trouve « réunion ». Classement par pertinence et par fraicheur, avec des filtres directement dans la barre.',
  },
  {
    icon: 'inbox',
    title: 'Des messages gardes pour soi',
    body: "L'epinglage est collectif : il impose un message a tout le salon. Ici on met aussi de cote pour soi seul, ce qui est le geste le plus courant et que personne ne propose.",
  },
  {
    icon: 'filter',
    title: 'Une moderation qui laisse une trace',
    body: 'Quatre rangs, exclusion de parole, bannissement temporaire, verrouillage, mode lent. Chaque action est journalisee avec son motif et son auteur.',
  },
  {
    icon: 'edit',
    title: 'Un historique des modifications',
    body: "Ailleurs, « modifie » ne dit jamais ce qui a change. Les versions precedentes sont conservees : corriger reste honnete.",
  },
  {
    icon: 'volume',
    title: 'Du vocal en direct',
    body: "Les connexions sont etablies directement entre participants. L'audio ne transite par aucun serveur : la latence est celle d'un lien direct, et la conversation reste privee par construction.",
  },
];

const DETAILS: { label: string; title: string; body: string; points: string[] }[] = [
  {
    label: 'Conversations',
    title: 'Le fil de discussion, enfin utilisable',
    body: "Partout ailleurs, un fil s'ouvre puis disparait sous les messages suivants. Ici il a un cycle de vie.",
    points: [
      'Ouvrir un fil depuis n’importe quel message',
      'Statut ouvert ou resolu, visible d’un coup d’oeil',
      'Barre « A suivre » qui liste ce qui attend une reponse',
      'Marquer resolu est collaboratif : tout membre peut le faire',
    ],
  },
  {
    label: 'Recherche',
    title: 'Retrouver, pas fouiller',
    body: 'La recherche accepte des filtres ecrits directement dans la barre, et classe par pertinence plutot que par date seule.',
    points: [
      'de:camille — les messages d’une personne',
      'dans:general — un salon precis',
      'est:epingle — seulement les epingles',
      'a:fichier — avec piece jointe',
      'avant:2026-01-01 — une periode',
    ],
  },
  {
    label: 'Confidentialite',
    title: 'Les regles vivent dans la base',
    body: "Chaque acces est verifie par Postgres, pas par le navigateur. Un client modifie ne donne acces a rien de plus, parce qu'il n'est jamais celui qui decide.",
    points: [
      'Vingt-et-une tables, toutes protegees ligne par ligne',
      'On n’ecrit qu’aux personnes avec qui on partage un espace',
      'Rejoindre passe par un code, jamais par un identifiant devine',
      'Limitation de debit appliquee cote serveur, moderateurs compris',
    ],
  },
];

export function Landing() {
  return (
    <div className="landing">
      <header className="landing__bar">
        <a className="landing__brand" href="/" onClick={(e) => { e.preventDefault(); navigate('/'); }}>
          <span className="landing__logo" aria-hidden="true">
            <Icon name="compass" size={20} />
          </span>
          Orbit
        </a>

        <nav className="landing__nav" aria-label="Sections">
          <a href="#fonctionnalites">Fonctionnalites</a>
          <a href="#detail">En detail</a>
          <a href="#vocal">Vocal</a>
        </nav>

        <div className="landing__bar-actions">
          <button type="button" className="btn btn--ghost" onClick={() => navigate('/connexion')}>
            Se connecter
          </button>
          <button type="button" className="btn btn--primary" onClick={() => navigate('/connexion')}>
            Commencer
          </button>
        </div>
      </header>

      <main>
        {/* ------------------------------------------------------------ Hero */}
        <section className="hero">
          <p className="hero__eyebrow">Discussion d’equipe en temps reel</p>

          <h1 className="hero__title">
            Tout ce qu’on aime dans Discord.
            <br />
            <span className="hero__title-accent">Sans ce qui fait renoncer.</span>
          </h1>

          <p className="hero__lede">
            L’historique illisible, la recherche approximative et les trois gigaoctets
            de memoire. Orbit garde l’efficacite, corrige le reste.
          </p>

          <div className="hero__actions">
            <button
              type="button"
              className="btn btn--primary btn--lg"
              onClick={() => navigate('/connexion')}
            >
              Creer un compte
              <Icon name="chevron-right" size={16} />
            </button>
            <button
              type="button"
              className="btn btn--lg"
              onClick={() => navigate('/connexion')}
            >
              J’ai deja un compte
            </button>
          </div>

          <p className="hero__note">
            Gratuit. Aucune carte demandee. Votre premier espace est cree
            automatiquement.
          </p>

          <AppPreview />
        </section>

        {/* --------------------------------------------------- Fonctionnalites */}
        <section className="section" id="fonctionnalites">
          <div className="section__head">
            <p className="section__label">Fonctionnalites</p>
            <h2 className="section__title">Six differences que l’on constate le premier jour</h2>
          </div>

          <ul className="pillars">
            {PILLARS.map((item) => (
              <li className="pillar" key={item.title}>
                <span className="pillar__icon" aria-hidden="true">
                  <Icon name={item.icon} size={19} />
                </span>
                <h3 className="pillar__title">{item.title}</h3>
                <p className="pillar__body">{item.body}</p>
              </li>
            ))}
          </ul>
        </section>

        {/* ---------------------------------------------------------- Detail */}
        <section className="section section--alt" id="detail">
          <div className="details">
            {DETAILS.map((block) => (
              <article className="detail" key={block.title}>
                <p className="section__label">{block.label}</p>
                <h2 className="detail__title">{block.title}</h2>
                <p className="detail__body">{block.body}</p>

                <ul className="detail__points">
                  {block.points.map((point) => (
                    <li key={point}>
                      <Icon name="check" size={15} />
                      <span>{point}</span>
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </section>

        {/* ----------------------------------------------------------- Vocal */}
        <section className="section" id="vocal">
          <div className="section__head">
            <p className="section__label">Vocal et partage d’ecran</p>
            <h2 className="section__title">Parler et montrer, sans intermediaire</h2>
            <p className="section__lede">
              Les participants se connectent directement les uns aux autres. Le serveur
              ne relaie que la mise en relation : ni la voix, ni l’image ne passent par
              lui.
            </p>
          </div>

          <ul className="voice-features">
            {[
              { icon: 'mic' as const, label: 'Micro', note: 'Reduction de bruit et annulation d’echo' },
              { icon: 'screen' as const, label: 'Partage d’ecran', note: 'Une fenetre ou l’ecran entier, 30 images/s' },
              { icon: 'video' as const, label: 'Camera', note: 'Video en direct, coupable a tout moment' },
              { icon: 'headphones' as const, label: 'Casque', note: 'Se rendre sourd coupe aussi le micro' },
            ].map((item) => (
              <li className="voice-feature" key={item.label}>
                <span className="voice-feature__icon" aria-hidden="true">
                  <Icon name={item.icon} size={18} />
                </span>
                <div>
                  <h3 className="voice-feature__label">{item.label}</h3>
                  <p className="voice-feature__note">{item.note}</p>
                </div>
              </li>
            ))}
          </ul>

          <p className="section__footnote">
            Le maillage direct convient jusqu’a six ou huit participants. Au-dela, la
            charge monte au carre du nombre de personnes — c’est une limite du procede,
            pas un reglage.
          </p>
        </section>

        {/* ------------------------------------------------------------ Poids */}
        <section className="section section--alt">
          <div className="weights">
            <div className="weight">
              <span className="weight__value">168 ko</span>
              <span className="weight__label">Application web, compressee</span>
            </div>
            <div className="weight">
              <span className="weight__value">3,4 Mo</span>
              <span className="weight__label">Executable de bureau</span>
            </div>
            <div className="weight">
              <span className="weight__value">1 requete</span>
              <span className="weight__label">Pour afficher toute l’interface</span>
            </div>
          </div>

          <p className="section__footnote">
            La version bureau s’appuie sur le moteur de rendu deja present dans le
            systeme au lieu d’embarquer le sien. Elle occupe environ 390 Mo de memoire
            vive a l’usage : moins que la plupart, mais pas d’un ordre de grandeur.
          </p>
        </section>

        {/* -------------------------------------------------------- Invitation */}
        <section className="cta">
          <h2 className="cta__title">Prenez-la en main</h2>
          <p className="cta__body">
            Un compte suffit. Votre espace de demarrage est cree avec ses salons, et
            vous pouvez inviter du monde dans la minute.
          </p>
          <button
            type="button"
            className="btn btn--primary btn--lg"
            onClick={() => navigate('/connexion')}
          >
            Creer un compte
            <Icon name="chevron-right" size={16} />
          </button>
        </section>
      </main>

      <footer className="landing__footer">
        <div className="landing__brand">
          <span className="landing__logo" aria-hidden="true">
            <Icon name="compass" size={18} />
          </span>
          Orbit
        </div>
        <p>Discussion d’equipe en temps reel.</p>
      </footer>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * Apercu de l'interface.
 *
 * Dessine en HTML plutot qu'en capture d'ecran : une image se perime a la
 * premiere retouche de style, alors que cet apercu suit automatiquement les
 * jetons de design du produit et reste juste.
 */
function AppPreview() {
  return (
    <div className="preview" role="img" aria-label="Apercu de l’interface d’Orbit">
      <div className="preview__frame">
        <div className="preview__rail">
          <span className="preview__rail-dot preview__rail-dot--home" />
          <span className="preview__rail-divider" />
          <span className="preview__rail-dot preview__rail-dot--a" />
          <span className="preview__rail-dot preview__rail-dot--b" />
          <span className="preview__rail-dot preview__rail-dot--c" />
        </div>

        <div className="preview__sidebar">
          <div className="preview__space-name" />
          <span className="preview__section-label" />
          <span className="preview__thread" />
          <span className="preview__thread preview__thread--short" />
          <span className="preview__section-label" />
          <span className="preview__channel preview__channel--active" />
          <span className="preview__channel" />
          <span className="preview__channel" />
        </div>

        <div className="preview__main">
          <div className="preview__header" />
          <div className="preview__messages">
            {[0, 1, 2, 3].map((index) => (
              <div className="preview__message" key={index}>
                <span className="preview__avatar" />
                <span className="preview__lines">
                  <span className="preview__line preview__line--name" />
                  <span className="preview__line" />
                  {index % 2 === 0 ? <span className="preview__line preview__line--short" /> : null}
                </span>
              </div>
            ))}
          </div>
          <div className="preview__composer" />
        </div>
      </div>
    </div>
  );
}
