# FinScope — Plateforme Personnelle d'Analyse Fondamentale & Aide à l'Investissement

Plateforme web responsive (PC & smartphone) inspirée de Baggr pour analyser des actions (US & Europe / éligibles PEA) et ETF, noter automatiquement leur qualité fondamentale sur 100, comparer les concurrents directs d'un secteur, suivre un portefeuille PEA/CTO et filtrer un screener intelligent.

---

## Fonctionnalités principales

- **Fiche Entreprise / ETF (`/stock/[ticker]`)**
  - **5 Notes automatiques /100** : Note Globale, Valorisation (vs propre historique 3–5 ans + moyenne sectorielle + PEG), Croissance (CA/BPA/FCF 1A/3A/5A + détection d'accélération/ralentissement), Qualité & Rentabilité (marges, ROE, ROIC, conversion FCF), Santé Financière (adaptée aux banques/assurances et aux ETF : TER, AUM, performance, volatilité, drawdown max).
  - **5 Modules graphiques interactifs (Apache ECharts)** :
    1. Cours avancé (`YTD`, `1A`, `3A`, `5A`, `10A`, `MAX`, range slider, `MM50`/`MM200`, volume, Prix Juste, splits, switch `USD`/`EUR`, export PNG).
    2. Évolution des fondamentaux (CA, Résultat Net, FCF, BPA, Cash vs Dette ; `Annuel`/`Trimestriel`, `Par action`, prévisions analystes).
    3. Surprises trimestrielles (BPA / CA Estimé vs Réel sur 12 trimestres + blocs de surprise `%`).
    4. Segments de CA (quand disponibles) & évolution des marges (`1A`/`2A`/`MAX`).
    5. Calculateur de Prix Juste interactif à 3 sliders (*Croissance attendue*, *Multiple de sortie*, *Rendement exigé*).
  - **Onglet Concurrents du secteur** (chargement à la demande en parallèle) : 4 à 6 concurrents directs, tableau comparatif coloré, moyenne sectorielle, écarts inversés pour les multiples/dette, Radar 4 piliers, phrase de synthèse automatique et ajouts/exclusions manuels persistés en base.
- **Portefeuille & Watchlist (`/portfolio`)**
  - Saisie **Quantité + PRU** ou **Montant investi** par enveloppe (`PEA` / `CTO`).
  - Graphiques Donut (**Position**, **Enveloppe PEA/CTO**, **Secteur**).
  - **Statistiques moyennes pondérées (Actions uniquement)** : Capi moyenne, PER, PER prév., P/FCF, PEG, marges, ROE, ROA, croissance CA/BPA, Dette nette/EBITDA, part Actions vs ETF, poids du Top 5 et Note Globale moyenne `/100`.
  - **Watchlist** avec prix cible perso et alerte visuelle multi-devises quand le cours passe sous la cible.
- **Screener Intelligent (`/screener`)**
  - Univers pré-chargé de 70 valeurs US & Europe (éligibles PEA) + enrichissement automatique à chaque recherche.
  - Filtres combinés + **4 presets en 1 clic** (*Qualité en solde*, *Hyper-croissance rentable*, *Forteresses financières*, *Éligible PEA*).
  - Bouton d'enrichissement en tâche de fond par petits lots (`BackgroundTasks`) pour éviter les timeouts et rate-limits.
- **UX & Ergonomie**
  - Barre de recherche globale `Ctrl+K` / `Cmd+K` accessible partout.
  - Switch **Mode Clair** (par défaut) / **Mode Sombre**.
  - Gestion du *cold start* Render gratuit côté frontend (bannière d'attente + retry automatique).
  - Authentification désactivée par défaut ; code `APP_PIN` optionnel activable via variable d'environnement.

---

## Stack technique

- **Frontend (`frontend/`)** : Next.js (App Router) · TypeScript · Tailwind CSS · Apache ECharts · `next-themes` · `lucide-react` (hébergement prévu : **Vercel**).
- **Backend (`backend/`)** : Python FastAPI · SQLAlchemy 2.0 · `yfinance` · `pandas` · `httpx` (hébergement prévu : **Render**).
- **Base de données & Cache** : SQLite en local (`finscope.db`) · **Supabase PostgreSQL** en production (`CACHE_TTL_QUOTE_MINUTES=15` pour cours & `EURUSD=X`, `CACHE_TTL_FUNDAMENTALS_HOURS=24` pour bilans, segments et pairs).

---

## 1. Démarrage en local

### Prérequis
- **Python 3.11+** (testé avec Python 3.12 / 3.13)
- **Node.js 20+** et `npm`

### Backend (FastAPI)

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

*(Sur macOS / Linux : `source .venv/bin/activate` puis `uvicorn app.main:app --reload --port 8000`.)*

Vérifiez l'API sur `http://localhost:8000/health` et la documentation interactive sur `http://localhost:8000/docs`.

### Frontend (Next.js)

Dans un second terminal :

```powershell
cd frontend
npm.cmd install
npm.cmd run dev
```

*(Note Windows PowerShell : utilisez `npm.cmd` si l'exécution de scripts `npm.ps1` est restreinte ; sur macOS / Linux, utilisez `npm install` et `npm run dev`.)*

Ouvrez ensuite **`http://localhost:3000`**.

### Lancer les tests & vérifier le build

```powershell
# Tests unitaires backend (31 tests)
cd backend
.\.venv\Scripts\python.exe -m pytest -v

# Build de production frontend
cd ..\frontend
npm.cmd run build
```

---

## 2. Clés API gratuites (optionnelles)

La plateforme fonctionne immédiatement avec **`yfinance`** (0 clé requise). Pour enrichir les **concurrents directs**, **logos**, **surprises trimestrielles** et la **ventilation du CA par segment** :

1. **Finnhub** (plan gratuit — 60 req/min) : https://finnhub.io/register
2. **Financial Modeling Prep (FMP)** (plan gratuit — 250 req/jour) : https://site.financialmodelingprep.com/register

Renseignez ensuite `FINNHUB_API_KEY=...` et `FMP_API_KEY=...` dans `backend/.env` (ou dans les variables d'environnement Render).

---

## 3. Déploiement 100 % Gratuit (Supabase + Render + Vercel)

Ce déploiement synchronise automatiquement votre Portefeuille, votre Watchlist et votre cache entre votre PC et votre smartphone.

### Étape 1 — Base de données PostgreSQL sur Supabase (gratuit)

1. Créez un compte sur [supabase.com](https://supabase.com) puis créez un nouveau projet (`finscope`).
2. Allez dans **Connect** (en haut de votre projet Supabase) → onglet **Connection String** → choisissez **Session pooler** *(important : utilisez le **Session Pooler IPv4** sur le port `5432`, car le tier gratuit de Render ne supporte pas toujours IPv6 en connexion directe)*.
3. Copiez l'URL de connexion au format :
   ```text
   postgresql://postgres.<ref>:<mot_de_passe>@aws-0-<region>.pooler.supabase.com:5432/postgres
   ```
   *(Le backend convertit automatiquement `postgresql://` vers le driver `postgresql+psycopg://` et crée les 5 tables automatiquement au premier démarrage).*

### Étape 2 — Backend FastAPI sur Render (gratuit)

1. Poussez ce dépôt sur **GitHub** (privé ou public).
2. Créez un compte sur [render.com](https://render.com) → **New +** → **Web Service** → sélectionnez votre dépôt GitHub.
3. Configurez le service (ou utilisez [backend/render.yaml](backend/render.yaml)) :
   - **Root Directory** : `backend`
   - **Runtime** : `Python 3`
   - **Build Command** : `pip install -r requirements.txt`
   - **Start Command** : `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
   - **Instance Type** : `Free`
   - **Health Check Path** : `/health`
4. Ajoutez les **Environment Variables** sur Render :
   - `PYTHON_VERSION` = `3.12.8`
   - `DATABASE_URL` = *(votre chaîne Supabase Session Pooler)*
   - `CORS_ORIGINS` = `http://localhost:3000` *(vous ajouterez l'URL Vercel juste après l'étape 3)*
   - `FINNHUB_API_KEY` = *(optionnel)*
   - `FMP_API_KEY` = *(optionnel)*
   - `APP_PIN` = *(laisser vide pour accès direct sans login, ou définir un code PIN personnel)*
5. Déployez et vérifiez `https://<votre-backend>.onrender.com/health` → doit renvoyer `{"status": "ok", "db": "ok", ...}`.

> **Astuce anti-mise en veille (optionnel)** : Sur le tier gratuit, Render endort le serveur après 15 min d'inactivité. FinScope gère déjà le réveil automatiquement côté interface (bannière d'attente + retry), mais vous pouvez également configurer un ping gratuit toutes les 14 minutes sur `https://<votre-backend>.onrender.com/health` via [cron-job.org](https://cron-job.org) ou UptimeRobot.

### Étape 3 — Frontend Next.js sur Vercel (gratuit)

1. Créez un compte sur [vercel.com](https://vercel.com) → **Add New... → Project** → importez votre dépôt GitHub.
2. Réglez **Root Directory** sur `frontend`.
3. Ajoutez la variable d'environnement :
   - `NEXT_PUBLIC_API_URL` = `https://<votre-backend>.onrender.com` *(sans slash final)*
4. Cliquez sur **Deploy**.
5. Une fois déployé, copiez votre URL Vercel (`https://<votre-app>.vercel.app`), retournez dans **Render → Environment** et mettez à jour :
   - `CORS_ORIGINS` = `https://<votre-app>.vercel.app,http://localhost:3000`
   Puis redémarrez le service Render.

---

## 4. Premiers pas après déploiement

1. Ouvrez votre URL Vercel sur PC ou smartphone.
2. Allez dans **Screener** (`/screener`) et cliquez sur **Enrichir les manquantes** : le backend remplit les notes `/100` des 70 valeurs US & PEA en tâche de fond par petits lots.
3. Utilisez **`Ctrl+K`** (ou **`Cmd+K`**) n'importe où pour rechercher instantanément n'importe quelle action ou ETF.
4. Si vous activez `APP_PIN` sur Render, une modale discrète vous demandera une seule fois votre code PIN sur chaque appareil (mémorisé localement dans `localStorage`).
