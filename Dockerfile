# Render container for the agora server. The bun workspace at the repo
# root pulls dependencies for every package (server, shared, web, …),
# but we only run server/src/index.ts here — Vercel hosts the web/
# Next.js build separately and proxies /api + /ws back to this service.
#
# Render injects $PORT (typically 10000). server/src/index.ts already
# reads process.env.PORT ?? 8080, so the container honours whatever
# Render hands us.

FROM oven/bun:1-debian AS deps
WORKDIR /app

# Copy workspace manifests first so the dependency layer caches across
# source-only edits. We list every workspace package.json explicitly to
# avoid copying source files at this stage.
COPY package.json bun.lock ./
COPY server/package.json ./server/
COPY web/package.json ./web/
COPY shared/package.json ./shared/
COPY local/package.json ./local/
COPY cli/package.json ./cli/

RUN bun install --frozen-lockfile

# Cross-compile the agorad binary for each platform we ship. The
# /api/cli/install.sh script auto-detects the user's OS/arch and downloads
# the matching binary from /api/cli/download/<os-arch>.
#
# Workspace deps gotcha: bun installs hoist most packages to /app/node_modules
# but ALSO write per-workspace symlinks at /app/{pkg}/node_modules. The
# embedded compiler resolves from the cwd's node_modules first, so we have
# to ship those local symlinks alongside the root tree — otherwise
# `import commander` from local/src/index.ts fails with "Could not resolve".
FROM oven/bun:1-debian AS daemon-bins
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/local/node_modules ./local/node_modules
COPY --from=deps /app/shared/node_modules ./shared/node_modules
COPY package.json bun.lock ./
COPY shared ./shared
COPY local ./local
RUN cd local && bun build src/index.ts --compile --target=bun-darwin-arm64 --outfile dist/agorad-darwin-arm64 \
 && bun build src/index.ts --compile --target=bun-darwin-x64 --outfile dist/agorad-darwin-x64 \
 && bun build src/index.ts --compile --target=bun-linux-x64 --outfile dist/agorad-linux-x64

# Shrink what hits the wire. Two layers:
# 1. UPX (linux only): ~55% in-place size cut, ~50ms startup. macOS
#    Gatekeeper / Mach-O code signing rejects UPX-packed darwin binaries
#    ("killed: 9"), so we limit to linux.
# 2. Pre-gzip alongside the raw file. The download route serves the .gz
#    with Content-Encoding: gzip when the client (curl, install.sh) sent
#    Accept-Encoding: gzip — curl decompresses transparently. Buys an
#    extra 15-25% on darwin where UPX is off the table.
RUN apt-get update && apt-get install -y --no-install-recommends upx-ucl \
 && rm -rf /var/lib/apt/lists/* \
 && upx --best --lzma /app/local/dist/agorad-linux-x64 || true
RUN for bin in /app/local/dist/agorad-darwin-arm64 \
               /app/local/dist/agorad-darwin-x64 \
               /app/local/dist/agorad-linux-x64; do \
      gzip -9 -k -f "$bin"; \
    done && ls -lh /app/local/dist/

FROM oven/bun:1-debian AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=10000
ENV HOSTNAME=0.0.0.0

# Reuse the resolved node_modules from the deps stage and copy the
# source tree the server needs at runtime. We omit web/, e2e/, and cli/
# from the runtime image — they bloat the layer and aren't referenced
# by server/src/index.ts. We DO ship the cross-compiled agorad binaries
# from the daemon-bins stage so /api/cli/install.sh works.
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/server/node_modules ./server/node_modules
COPY --from=deps /app/shared/node_modules ./shared/node_modules
COPY package.json bun.lock ./
COPY server ./server
COPY shared ./shared
COPY --from=daemon-bins /app/local/dist ./local/dist

EXPOSE 10000
CMD ["bun", "run", "server/src/index.ts"]
