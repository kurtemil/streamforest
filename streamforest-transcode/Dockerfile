ARG BUILD_FROM
FROM $BUILD_FROM

RUN apk add --no-cache nodejs ffmpeg

WORKDIR /app
COPY server.mjs run.sh ./
RUN chmod a+x /app/run.sh

CMD ["/app/run.sh"]
