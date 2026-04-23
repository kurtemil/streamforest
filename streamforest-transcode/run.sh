#!/usr/bin/with-contenv bashio
# Entry point for the StreamForest transcode-proxy HA add-on.
# Reads user-configured options, sets env vars, then execs the Node server.

export ALLOWED_HOSTS="$(bashio::config 'allowed_hosts')"
export H264_ENCODER="$(bashio::config 'h264_encoder')"
export H264_PRESET="$(bashio::config 'h264_preset')"
export VIDEO_MAX_WIDTH="$(bashio::config 'video_max_width')"
export VIDEO_BITRATE="$(bashio::config 'video_bitrate')"
export VIDEO_MAX_BITRATE="$(bashio::config 'video_max_bitrate')"
export AUDIO_BITRATE="$(bashio::config 'audio_bitrate')"
export FFMPEG_LOGLEVEL="$(bashio::config 'log_level')"
export PORT=8787

bashio::log.info "Starting transcode proxy"
bashio::log.info "  allowed_hosts:     ${ALLOWED_HOSTS}"
bashio::log.info "  h264_encoder:      ${H264_ENCODER}"
bashio::log.info "  h264_preset:       ${H264_PRESET}"
bashio::log.info "  video_max_width:   ${VIDEO_MAX_WIDTH}"
bashio::log.info "  video_bitrate:     ${VIDEO_BITRATE}"
bashio::log.info "  video_max_bitrate: ${VIDEO_MAX_BITRATE}"
bashio::log.info "  audio_bitrate:     ${AUDIO_BITRATE}"

exec node /app/server.mjs
