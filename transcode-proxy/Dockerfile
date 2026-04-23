FROM node:20-alpine

RUN apk add --no-cache ffmpeg

WORKDIR /app
COPY package.json server.mjs ./

ENV PORT=8787
EXPOSE 8787

CMD ["node", "server.mjs"]
