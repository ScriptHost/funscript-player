FROM node:22-bookworm-slim

# ffmpeg + Intel-Mediatreiber (iHD) für den HQ-Stream über die Intel-Grafik (VAAPI / Quick Sync).
# Der „non-free“-Treiber enthält alle Encoder-Funktionen der neueren Intel-GPUs (z. B. N100/N305).
RUN sed -i 's/^Components: main$/Components: main non-free non-free-firmware/' /etc/apt/sources.list.d/debian.sources \
 && apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg intel-media-va-driver-non-free vainfo wget ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY server.js VERSION ./
COPY public ./public
# Datenordner für jeden Benutzer beschreibbar: so geht auch ein eigener Benutzer per „user:“ in der docker-compose.yml
RUN mkdir -p /app/data && chown node:node /app/data && chmod 0777 /app/data

ENV PORT=8080 \
    MEDIA_DIR=/media \
    DATA_DIR=/app/data \
    LIBVA_DRIVER_NAME=iHD \
    NODE_ENV=production

USER node
EXPOSE 8080

# Kurzer Abstand: Traefik leitet erst an „healthy“ Container weiter – mit 30 s wartete die Seite nach jedem Start
HEALTHCHECK --interval=5s --timeout=3s --retries=3 CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1

CMD ["node", "server.js"]
