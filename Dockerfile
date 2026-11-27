FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3000 DB_FILE=/data/taskflow.db
COPY package*.json ./
RUN npm ci --omit=dev
COPY server ./server
COPY --from=build /app/client/dist ./client/dist
VOLUME /data
EXPOSE 3000
CMD ["node", "--disable-warning=ExperimentalWarning", "server/index.js"]
