FROM node:22-bookworm-slim AS libredwg-build

ARG LIBREDWG_VERSION=0.14
ARG LIBREDWG_SHA256=62ebb73b984f865960f20ed26619ea5f8789d5e3fd088fa40a2598384da81275

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    xz-utils \
    build-essential \
    autoconf \
    automake \
    libtool \
    pkg-config \
    libxml2-dev \
    libpcre2-dev \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /tmp/libredwg
RUN curl --fail --location --retry 3 \
      "https://github.com/LibreDWG/libredwg/releases/download/${LIBREDWG_VERSION}/libredwg-${LIBREDWG_VERSION}.tar.xz" \
      --output libredwg.tar.xz \
  && echo "${LIBREDWG_SHA256}  libredwg.tar.xz" | sha256sum -c - \
  && tar -xJf libredwg.tar.xz --strip-components=1 \
  && ./configure \
      --prefix=/opt/libredwg \
      --enable-release \
      --disable-bindings \
      --disable-docs \
      --disable-shared \
  && make -j2 \
  && make install \
  && /opt/libredwg/bin/dwgread --version

FROM node:22-bookworm-slim AS runtime

ARG LIBREDWG_VERSION=0.14
ENV NODE_ENV=production \
    PORT=8080 \
    LIBREDWG_VERSION=${LIBREDWG_VERSION} \
    PATH="/opt/libredwg/bin:${PATH}"

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    libxml2 \
    libpcre2-8-0 \
    libpcre2-16-0 \
  && rm -rf /var/lib/apt/lists/*

COPY --from=libredwg-build /opt/libredwg /opt/libredwg
COPY services/dwg-processor/server.mjs /app/server.mjs
COPY services/dwg-processor/THIRD_PARTY_NOTICES.md /app/THIRD_PARTY_NOTICES.md

WORKDIR /app
USER node
EXPOSE 8080
CMD ["node", "/app/server.mjs"]
