FROM node:22-bookworm-slim
LABEL org.opencontainers.image.source="https://github.com/ScriptHost/funscript-player" \
      org.opencontainers.image.description="Funscript Player – The Handy and Satisfyer in sync with the video, with Stash"

# ffmpeg + Intel media driver (iHD) for the HQ stream on Intel graphics (VAAPI / Quick Sync).
# The "non-free" driver contains all encoder features of newer Intel GPUs (e.g. N100/N305).
RUN sed -i 's/^Components: main$/Components: main non-free non-free-firmware/' /etc/apt/sources.list.d/debian.sources \
 && apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg intel-media-va-driver-non-free ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY server.js VERSION ./
COPY lib ./lib
COPY public ./public
# Data folder writable for any user: this also allows a custom user via "user:" in docker-compose.yml
RUN mkdir -p /app/data && chown node:node /app/data && chmod 0777 /app/data

ENV PORT=8080 \
    MEDIA_DIR=/media \
    DATA_DIR=/app/data \
    LIBVA_DRIVER_NAME=iHD \
    NODE_ENV=production

USER node
EXPOSE 8080

# Short interval: reverse proxies (e.g. Traefik) only forward to "healthy" containers – with 30 s the page waited after every start
# Checked with Node itself (no extra wget package in the image)
HEALTHCHECK --interval=5s --timeout=3s --retries=3 CMD ["node", "-e", "require('http').get('http://127.0.0.1:8080/healthz', (r) => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"]

CMD ["node", "server.js"]
