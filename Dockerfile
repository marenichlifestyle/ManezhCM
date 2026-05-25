FROM node:20-alpine

WORKDIR /app

ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .
RUN mkdir -p data errors

CMD ["npm", "run", "start"]
