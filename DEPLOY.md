# Guide de déploiement 100 % gratuit — FinScope en production

Ce guide vous permet de mettre **FinScope** en ligne gratuitement afin d'y accéder depuis n'importe quel PC ou téléphone (avec installation façon application mobile) tout en gardant vos données synchronisées en temps réel.

Architecture utilisée (offre gratuite permanente sans carte bancaire requise sur Vercel/Supabase) :
- **Base de données** : **Supabase** (PostgreSQL managé gratuit)
- **Backend API (FastAPI / Python)** : **Render** (Web Service gratuit)
- **Frontend Web & PWA (Next.js)** : **Vercel** (Hobby gratuit)

> **Important sécurité** : le fichier `.gitignore` à la racine bloque déjà `.env`, `frontend/.env.local` et vos bases SQLite locales (`*.db`). Vos clés API et votre portefeuille local ne partiront jamais sur GitHub.

---

## Étape 1 — Créer la base de données PostgreSQL sur Supabase

1. Créez un compte gratuit sur [supabase.com](https://supabase.com) puis cliquez sur **New project**.
2. Choisissez un nom (ex. `finscope`), définissez un **mot de passe de base de données** robuste (notez-le précieusement, évitez les caractères spéciaux compliqués comme `@` ou `#` dans le mot de passe pour simplifier l'URL) et sélectionnez une région proche (ex. **West EU (Paris)** ou **Frankfurt**).
3. Attendez ~1 minute que le projet démarre.
4. En haut de la page, cliquez sur le bouton **Connect** → onglet **URI** → sélectionnez **Transaction pooler** (port **6543**) ou **Session pooler** (port **5432**).
   > **Pourquoi un Pooler ?** Les hébergements gratuits comme Render utilisent souvent IPv4 alors que la connexion directe Supabase est en IPv6. Le **Pooler Supabase** fonctionne en IPv4 sans erreur réseau.
5. Copiez l'URL affichée, qui ressemble à :
   ```text
   postgresql://postgres.votreprojectid:[YOUR-PASSWORD]@aws-0-eu-west-3.pooler.supabase.com:6543/postgres
   ```
6. Remplacez `[YOUR-PASSWORD]` par votre mot de passe réel et gardez cette URL de côté pour l'étape 3 (**ne la partagez jamais**).
   - *Astuce : vous n'avez aucune table à créer à la main — FinScope créera automatiquement toutes ses tables (`portfolio_positions`, `portfolio_lots`, `portfolio_sales`, `watchlist_items`, `user_settings`, etc.) dès le premier démarrage sur Supabase.*

---

## Étape 2 — Pousser le code sur un dépôt GitHub privé

1. Vérifiez rapidement qu'aucun fichier secret (`.env`, `*.db`) ne sera suivi, puis initialisez Git et poussez le projet sur un **nouveau dépôt GitHub privé** (créez un repo vide sans README sur [github.com/new](https://github.com/new)) :

```powershell
cd C:\Users\maxim\.gemini\antigravity\scratch\finscope
git init
git add .
git status
```
2. Vérifiez dans `git status` qu'aucun fichier `.env` ou `.db` n'apparaît dans la liste, puis commitez et poussez :
```powershell
git commit -m "Initial FinScope production-ready setup"
git branch -M main
git remote add origin https://github.com/VOTRE_PSEUDO/finscope.git
git push -u origin main
```

---

## Étape 3 — Déployer le Backend FastAPI sur Render

1. Connectez-vous sur [render.com](https://render.com) avec votre compte GitHub.
2. Cliquez sur **New +** → **Web Service** et sélectionnez votre dépôt `finscope` (ou utilisez **New + → Blueprint** qui détecte automatiquement le fichier `render.yaml` à la racine).
3. Si vous configurez le Web Service manuellement, renseignez exactement :
   - **Name** : `finscope-backend`
   - **Region** : Frankfurt (EU Central)
   - **Root Directory** : `backend`
   - **Runtime** : `Python 3`
   - **Build Command** : `pip install -r requirements.txt`
   - **Start Command** : `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
   - **Instance Type** : `Free`
   - Dans *Advanced* → **Health Check Path** : `/api/health`
4. Ajoutez les **Environment Variables** suivantes dans Render :

| Variable | Valeur à coller | Obligatoire ? |
| :--- | :--- | :--- |
| `DATABASE_URL` | L'URL Pooler Supabase copiée à l'étape 1 | **Oui** |
| `PYTHON_VERSION` | `3.12.8` | Recommandé |
| `APP_PIN` | Votre code secret personnel (ex. `4829` ou mot de passe) | **Fortement recommandé** |
| `FRONTEND_URL` | Laissez vide pour l'instant (on la remplit juste après Vercel à l'étape 4) | Oui (étape 4) |
| `CORS_ORIGINS` | `http://localhost:3000` | Oui |
| `FINNHUB_API_KEY` | Votre clé Finnhub gratuite (si vous en avez une) | Optionnel |
| `FMP_API_KEY` | Votre clé FMP gratuite (si vous en avez une) | Optionnel |

5. Cliquez sur **Create Web Service**. Au bout de 2-3 minutes, votre backend est en ligne !
6. Notez son URL publique en haut à gauche, par exemple :
   `https://finscope-backend.onrender.com`
   Vérifiez dans votre navigateur que `https://finscope-backend.onrender.com/api/health` renvoie bien `{"status":"ok"}`.

### Bonus anti-sommeil (UptimeRobot gratuit — optionnel)
Sur l'offre gratuite de Render, le backend se met en veille après **15 minutes d'inactivité** (d'où le bandeau *"Réveil du serveur en cours (20-30s)..."* affiché automatiquement par FinScope).
Pour garder le serveur réactif en journée gratuitement :
1. Créez un compte gratuit sur [uptimerobot.com](https://uptimerobot.com).
2. **Add New Monitor** → Type `HTTP(s)` → URL `https://finscope-backend.onrender.com/api/health` → Intervalle `10 minutes` (ou `5 minutes`).
3. *Note : les 750 heures gratuites/mois de Render couvrent largement 1 seul service allumé 24h/24 (24 × 31 = 744 h).*

---

## Étape 4 — Déployer le Frontend Next.js sur Vercel

1. Connectez-vous sur [vercel.com](https://vercel.com) avec GitHub → **Add New… → Project** → importez votre dépôt `finscope`.
2. Dans **Configure Project** :
   - **Framework Preset** : `Next.js` (détecté automatiquement)
   - **Root Directory** : cliquez sur *Edit* et choisissez **`frontend`**
3. Ouvrez **Environment Variables** et ajoutez :
   - Name : `NEXT_PUBLIC_API_URL`
   - Value : `https://finscope-backend.onrender.com` *(l'URL Render de l'étape 3, **sans `/` à la fin**)*
4. Cliquez sur **Deploy**. Après ~1 minute, Vercel vous donne votre URL finale (ex. `https://finscope-app.vercel.app`).
5. **Dernière étape CORS indispensable** :
   - Retournez dans **Render → finscope-backend → Environment**.
   - Ajoutez ou modifiez la variable `FRONTEND_URL` avec votre URL Vercel exacte :
     `https://finscope-app.vercel.app` *(sans `/` à la fin)*.
   - Sauvegardez (**Save, rebuild, and deploy**).

---

## Étape 5 — Migrer votre portefeuille local en 10 secondes & installer sur mobile

### A. Copier vos positions locales vers la version en ligne
1. Ouvrez votre **FinScope local** (`http://localhost:3000/portfolio`).
2. En haut à droite, cliquez sur **Exporter → Sauvegarde JSON complète** : un fichier `finscope-backup-AAAA-MM-JJ.json` est téléchargé.
3. Ouvrez maintenant votre **FinScope en ligne** (`https://finscope-app.vercel.app/portfolio`).
4. Si vous avez défini `APP_PIN`, une fenêtre sécurisée vous demande votre code PIN (il restera mémorisé sur cet appareil).
5. Cliquez sur **Exporter → Importer une sauvegarde JSON** et sélectionnez le fichier téléchargé : toutes vos positions PEA/CTO, vos lots d'achat, votre historique des ventes, votre watchlist et vos préférences DCA/projections sont instantanément synchronisés dans Supabase !

### B. Installer FinScope comme application sur votre téléphone (PWA)
- **Sur iPhone (iOS / Safari)** : ouvrez votre URL Vercel dans **Safari** → touchez le bouton **Partager** (carré avec flèche vers le haut) → **Sur l'écran d'accueil** → **Ajouter**.
- **Sur Android (Chrome)** : ouvrez votre URL Vercel dans **Chrome** → touchez le menu `⋮` → **Ajouter à l'écran d'accueil** / **Installer l'application**.

FinScope s'ouvrira désormais en plein écran sans barre de navigateur, connecté en temps réel à votre base Supabase !
