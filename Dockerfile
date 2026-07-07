FROM node:20-slim

# better-sqlite3 est compilé nativement : outils de build nécessaires.
RUN apt-get update && apt-get install -y --no-install-recommends python3 build-essential \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

# Les données SQLite persistent dans un volume monté sur /app/data.
VOLUME ["/app/data"]
ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "server.js"]
