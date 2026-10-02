FROM debian:bookworm-slim AS libredwg

ARG LIBREDWG_VERSION=0.14
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl xz-utils build-essential pkg-config libtool automake autoconf \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /build
RUN curl -fsSLO "https://ftp.gnu.org/gnu/libredwg/libredwg-${LIBREDWG_VERSION}.tar.xz" \
  && tar -xf "libredwg-${LIBREDWG_VERSION}.tar.xz" \
  && cd "libredwg-${LIBREDWG_VERSION}" \
  && ./configure --disable-shared --enable-static \
  && make -j2 \
  && make install

FROM node:22-bookworm-slim
COPY --from=libredwg /usr/local/ /usr/local/
WORKDIR /app
COPY package.json server.mjs cad-normalizer.mjs ./
ENV NODE_ENV=production
ENV PORT=8080
ENV DWG2DXF_BIN=/usr/local/bin/dwg2dxf
ENV DWG2DXF_VERSION=0.14
EXPOSE 8080
CMD ["node", "server.mjs"]
