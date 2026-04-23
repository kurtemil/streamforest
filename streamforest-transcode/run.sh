#!/usr/bin/with-contenv bashio
# Entry point for the StreamForest transcode-proxy HA add-on.
# Reads user-configured options, sets env vars, then execs the Node server.

export ALLOWED_HOSTS="$(bashio::config 'allowed_hosts')"
export H264_ENCODER="$(bashio::config 'h264_encoder')"
export H264_PRESET="$(bashio::config 'h264_preset')"
export FFMPEG_LOGLEVEL="$(bashio::config 'log_level')"
export PORT=8787

bashio::log.info "Starting transcode proxy"
bashio::log.info "  allowed_hosts: ${ALLOWED_HOSTS}"
bashio::log.info "  h264_encoder:  ${H264_ENCODER}"
bashio::log.info "  h264_preset:   ${H264_PRESET}"

exec node /app/server.mjs
