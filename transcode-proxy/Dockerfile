FROM node:20-bookworm-slim

# intel-media-va-driver-non-free, not intel-media-va-driver.
#
# Debian's DFSG build of the Intel media driver ships without the pre-compiled
# GPU kernels, and those kernels are the whole VME encoder. Measured on the
# ProDesk with the free build, vainfo offers exactly one H.264 encode entrypoint:
#
#   VAProfileH264High : VAEntrypointEncSliceLP
#
# and asking that entrypoint for a bitrate gets
#
#   Driver does not support any RC mode compatible with selected options
#   (supported modes: CQP)
#
# — which is why this server encoded at a fixed QP with no ceiling. The non-free
# build of the same version adds VAEntrypointEncSlice and, with it, AVBR, CBR and
# QVBR (and HEVC encode, unused so far). The chip was never the limit; the
# package was. non-free lives outside the base image's `main`-only sources, so
# the component has to be added first — the image uses the deb822 format, hence
# the sed rather than a new .list file.
RUN sed -i 's/^Components: main$/Components: main non-free non-free-firmware/' \
      /etc/apt/sources.list.d/debian.sources \
    && apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    intel-media-va-driver-non-free \
    vainfo \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json server.mjs ./

ENV PORT=8787
EXPOSE 8787

CMD ["node", "server.mjs"]
