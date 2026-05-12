FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    intel-media-va-driver \
    vainfo \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json server.mjs ./

ENV PORT=8787
EXPOSE 8787

CMD ["node", "server.mjs"]
