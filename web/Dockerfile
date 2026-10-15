# tu empresa — apm-web
#
# Dos etapas. La primera compila con Vite; la segunda es solo nginx con los
# estáticos dentro. Node NO llega a producción: por eso React no cuesta RAM
# en esta VPS, que es la condición con la que se aprobó el stack
# (docs/RESEARCH.md §2, decisión 1).

FROM node:22-alpine@sha256:16e22a550f3863206a3f701448c45f7912c6896a62de43add43bb9c86130c3e2 AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM nginx:1.29-alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO- http://127.0.0.1/ > /dev/null || exit 1
