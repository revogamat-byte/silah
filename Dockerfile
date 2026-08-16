FROM node:22-slim

WORKDIR /app

COPY package.json ./
COPY server ./server
COPY public ./public
COPY seed ./seed

RUN mkdir -p /app/data

ENV PORT=3000
ENV HOST=0.0.0.0
ENV NODE_ENV=production

EXPOSE 3000

VOLUME ["/app/data"]

CMD ["node", "server/app.js"]
