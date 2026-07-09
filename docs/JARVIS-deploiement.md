# Jarvis (jarvis-OS) — Diagnostic de déploiement Coolify

> Note prise le 2026-07-09. À traiter **plus tard** — on reste sur Ohipa pour l'instant.
> Ce fichier vit dans le repo Ohipa uniquement comme mémo ; la correction se fera dans `Tutehau/jarvis-OS`.

## Contexte

- **App Coolify** : `jarvis-os` — `https://jarvis.tutehau.cloud`
- **Repo** : `Tutehau/jarvis-OS` (branche `main`)
- **Build pack** : nixpacks · **Port exposé** : 3000
- **Statut observé** : `exited:unhealthy` (le conteneur ne démarre jamais)
- **Dernier déploiement** : `failed` (2026-07-08)

## Cause racine (confirmée par les logs de build)

Le déploiement **échoue au BUILD**, pas au runtime, et **pas** à cause de variables d'environnement.

Chaîne du problème :
1. `jarvis-OS` dépend de **`RealtimeSTT`** (STT temps réel).
2. `RealtimeSTT` tire **`pyaudio`** en dépendance transitive.
3. Dans `uv.lock`, `pyaudio@0.2.14` n'a que des **wheels Windows** → sur Linux, `uv` doit **compiler depuis les sources**.
4. La compilation exige la lib système **portaudio** (`portaudio.h`), **absente** de l'environnement de build nixpacks.

Extrait du log de déploiement :

```
src/pyaudio/device_api.c:9:10: fatal error: portaudio.h: No such file or directory
    9 | #include "portaudio.h"
error: command '/root/.nix-profile/bin/gcc' failed with exit code 1
  Caused by: you need a library that provides "portaudio.h" for pyaudio@0.2.14
ERROR: process "... uv sync --no-dev --frozen" did not complete successfully: exit code: 2
Deployment failed.
```

## Options de correction

### Option A — la plus rapide (aucune modif du repo)
Fournir portaudio au build via une variable Coolify, puis redéployer :
- `NIXPACKS_PKGS=portaudio` (paquet nix, intégré au gcc de nixpacks).
- Levier documenté pour les erreurs « header manquant » des modules natifs Python.
- ⚠️ Débloque le build, mais ne règle pas la question de fond (voir Option C).

### Option B — la plus fiable
Passer `jarvis-os` sur un **Dockerfile** :
```dockerfile
FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    portaudio19-dev build-essential && rm -rf /var/lib/apt/lists/*
# ... uv sync ...
```
Robuste pour toutes les dépendances natives.

### Option C — la plus saine sur le fond (recommandée à terme)
Retirer la **stack matérielle** du déploiement serveur.
`RealtimeSTT`, `pyaudio`, wakeword, `sounddevice`, `hidapi`, `pyusb`, `libusb-package`
servent au **micro et aux périphériques locaux** — inutiles et **non fonctionnels** sur un
conteneur cloud headless.

> Un « Jarvis » vocal tourne normalement **en local** (accès micro/USB). Sur Coolify, seul un
> **backend web/API FastAPI** (le repo utilise `fastapi` + `uvicorn`, port 3000) a du sens.

Piste : isoler ces deps dans un groupe optionnel (`[project.optional-dependencies] local = [...]`)
non installé en production, et ne garder côté serveur que l'API + les intégrations réseau
(LLM providers, LiveKit API, Telegram, etc.).

## Décision à prendre plus tard
1. Le serveur cloud doit-il faire tourner l'agent vocal, ou seulement l'API web ?
   - **Seulement l'API** → Option C (nettoyer les deps) — le mieux.
   - **Tout, y compris audio** → Option B (Dockerfile + portaudio) pour au moins builder,
     en sachant que le micro n'existera pas dans le conteneur.
2. Appliquer la correction dans `Tutehau/jarvis-OS`, puis redéployer sur Coolify.

## Infos techniques utiles
- UUID app Coolify : `wrm1r8jbs21zej9kb8uge61j`
- API Coolify (HTTPS) : `https://coolify.tutehau.cloud/api/v1`
- Déploiement échoué analysé : `g872pzfgzakwyev2j0ve844r`
