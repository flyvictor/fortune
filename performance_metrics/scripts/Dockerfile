FROM node:24-alpine

WORKDIR /scripts
COPY package.json package-lock.json ./
RUN npm install

COPY . .
ENTRYPOINT ["node", "test-performance-metrics.js"]