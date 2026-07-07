<p align="center">
  <img src="public/logo.png" alt="Ohipa" width="160">
</p>

<h1 align="center">Ohipa</h1>

<p align="center">Gestion du temps de travail — Node.js / Express / SQLite</p>

---

*Ohipa* signifie « travail » en tahitien. Application de saisie et de suivi des
heures de travail, avec espace utilisateur, panneau d'administration, rapports
filtrables et export CSV.

## Fonctionnalités

- **Authentification complète** : connexion, inscription publique avec activation
  par email, réinitialisation de mot de passe, initialisation du super-admin.
- **Saisie des heures** par entreprise, avec édition et suppression.
- **Espace administrateur** : gestion des utilisateurs (rôle, activation,
  suppression), des entreprises (création, renommage, suppression), tableau de
  bord d'activité.
- **Rapports** : filtres par période / entreprise / utilisateur, graphique par
  jour, totaux par entreprise et par utilisateur, **export CSV**.
- **Sécurité** : mots de passe hachés (bcrypt), sessions durcies, rate-limiting,
  échappement anti-XSS, isolation stricte des rôles, garde du dernier admin.

## Stack

| Couche | Techno |
|--------|--------|
| Serveur | Express 5 |
| Base de données | SQLite (`better-sqlite3`) |
| Sessions | `express-session` |
| Emails | `nodemailer` |
| Front | HTML multi-pages + Bootstrap 5 + Bootstrap Icons + Chart.js |

## Démarrage

```bash
npm install
cp .env.example .env      # puis renseigner SESSION_SECRET, SETUP_KEY, SMTP_*
npm start                 # http://localhost:3000
```

Au premier lancement, la page de connexion propose de créer le **super-admin**
(clé `SETUP_KEY`).

### Scripts

| Commande | Effet |
|----------|-------|
| `npm start` | Démarre le serveur |
| `npm run dev` | Démarre avec rechargement automatique (`node --watch`) |
| `npm test` | Lance la suite de tests d'intégration (`node --test`) |

## Configuration (`.env`)

Voir [`.env.example`](.env.example). Variables **obligatoires** : `SESSION_SECRET`
et `SETUP_KEY` (le serveur refuse de démarrer sans). Le SMTP est nécessaire pour
les emails d'activation / invitation / reset.

Générer un secret de session :

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

## Docker

```bash
docker build -t ohipa .
docker run -p 3000:3000 --env-file .env -v ohipa-data:/app/data ohipa
```

Les données SQLite persistent dans le volume monté sur `/app/data`.

## Structure

```
server.js            Point d'entrée (createApp + listen), validation env, logs
db.js                Connexion SQLite, schéma, migration JSON -> SQLite
lib/email.js         Envoi d'emails (nodemailer)
middleware/auth.js   Gardes isAuth / isAdmin
routes/
  auth.js            login, register, activate, reset, setup-admin
  entries.js         saisie + historique (CRUD)
  admin.js           utilisateurs, entreprises, stats
  reports.js         rapports agrégés + export CSV
public/              Front multi-pages (une page par fonctionnalité)
test/api.test.js     Tests d'intégration de l'API
```

## Migration depuis l'ancienne version (stockage JSON)

Au premier démarrage, si d'anciens fichiers `data/*.json` sont présents, leurs
données sont importées automatiquement dans SQLite puis les fichiers sont
renommés en `.migrated`.

## API (aperçu)

| Méthode | Route | Accès |
|---------|-------|-------|
| POST | `/api/login` `/api/register` `/api/logout` | public |
| GET | `/api/activate` · POST `/api/reset-password` `/api/new-password` | public |
| GET/POST | `/api/entries` | connecté |
| PUT/DELETE | `/api/entries/:id` | propriétaire ou admin |
| GET/POST | `/api/companies` | lecture connecté / écriture admin |
| PUT/DELETE | `/api/companies/:id` | admin |
| GET | `/api/admin/users` · `/api/admin/stats` | admin |
| PATCH/DELETE | `/api/admin/users/:id/...` | admin |
| GET | `/api/reports` · `/api/reports/export.csv` | connecté (portée forcée) |
