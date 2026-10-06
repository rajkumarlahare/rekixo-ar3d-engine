FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    PORT=8080

WORKDIR /app

# Install only production workspace dependencies. The FBX converter resolves the
# exact Three.js version owned by apps/public so server conversion stays aligned
# with the viewer without introducing a second model stack.
COPY package.json package-lock.json ./
COPY apps/admin/package.json ./apps/admin/package.json
COPY apps/public/package.json ./apps/public/package.json
COPY packages/contracts/package.json ./packages/contracts/package.json
COPY packages/engine-core/package.json ./packages/engine-core/package.json
COPY packages/model-profiles/package.json ./packages/model-profiles/package.json
RUN npm ci --omit=dev --ignore-scripts \
    && npm cache clean --force

COPY apps/public/package.json ./apps/public/package.json
COPY scripts/asset-pipeline/convert-source-fbx.mjs ./scripts/asset-pipeline/convert-source-fbx.mjs
COPY services/model-processor/server.mjs ./services/model-processor/server.mjs

USER node
EXPOSE 8080
CMD ["node", "/app/services/model-processor/server.mjs"]
